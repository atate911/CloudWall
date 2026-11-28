"""The health watcher: CloudWall checking itself every WATCH_S seconds (is it working? is it true?).

Findings become incidents (health.Monitor); major ones go to [health] notify_url; repairs marked
`auto` in the catalogue are made at once. Also feeds systemd its status line and a watchdog ping
while the place threads are alive, so a hung CloudWall is restarted.
"""
import logging
import os
import shutil
import socket
import threading
import time
from pathlib import Path

from .. import __version__
from ..core import config, health
from ..core.health import OK
from ..core.http import post_json
from ..gather import tiles

log = logging.getLogger("cloudwall.health")
WATCH_S = 30
DOWN_AFTER_S = 120          # a feed failing this long is a problem (a blip isn't)
NO_POSITIONS_S = 120        # a watched board with no positions this long is offline
DEAF_CHECKS = 10            # checks in a row (5 minutes) of a receiver hearing almost nothing
FROZEN_ANSWERS = 3          # identical answers in a row, with aircraft moving
SKEW_S = 15
LAG_S = 8
WEATHER_STALE_S = 3 * 3600
SUSPECT_AFTER_S = 3 * 3600  # hours of traffic before "none came near" means anything
SUSPECT_NM = 8


def sd_notify(message):
    """Tell systemd something (READY=1, WATCHDOG=1, STATUS=...); False if it isn't listening."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return False
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
            s.connect(addr)
            s.sendall(message.encode())
        return True
    except OSError:
        return False


class Watch:
    def __init__(self, cfg, places, provider=None, demo=False, code_changed=None, incidents=None,
                 data_dir=None, cache_dir=None, clock=time.time):
        self.cfg, self.places, self.provider, self.demo = cfg, places, provider, demo
        self.code_changed = code_changed
        self.data_dir = Path(data_dir) if data_dir else None
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.clock = clock
        self.monitor = health.Monitor(incidents, clock)
        self.started = clock()
        path = cfg.get("_path")
        self.config_path = Path(path) if path else None
        self.config_stamp = self._stamp()
        self.deaf = {}              # place id -> checks in a row its receiver has heard almost nothing
        self.watched_since = {}     # place id -> when a screen (or "log") began keeping it fetching
        self.storage_failures = {}  # place id -> checks in a row its logbook couldn't be saved
        self.notify_url = cfg.get("health", {}).get("notify_url") or ""
        self.stopped = threading.Event()

    def _stamp(self):
        try:
            st = self.config_path.stat()
            return (st.st_mtime, st.st_size)
        except (AttributeError, OSError):
            return None

    # -- the checks --
    def checks(self):
        out = []
        for part, fn in (("settings", self.settings), ("storage", self.storage), ("service", self.service),
                         ("routes", self.routes), ("clock", self.timezone)):
            out += health.run(None, [(part, lambda _ctx, fn=fn: fn())])
        for place in list(self.places):
            out += health.run(None, [("feeds", lambda _ctx, p=place: self.feeds(p))])
        return out

    def settings(self):
        for problem in self.cfg.get("_problems", []):
            code = "settings.broken" if "can't be used" in problem else "settings.ignored"
            yield health.trouble(code, problem)
        home = self.cfg["home"]
        if (home.get("lat"), home.get("lon")) == (config.DEFAULTS["home"]["lat"], config.DEFAULTS["home"]["lon"]) and not self.demo:
            yield health.trouble("settings.placeholder")
        stamp = self._stamp()
        if stamp and stamp != self.config_stamp:
            try:
                config.load(self.config_path)
                yield health.trouble("settings.changed", f"{self.config_path} changed since CloudWall started")
            except Exception as e:
                yield health.trouble("settings.changed-broken", f"{self.config_path} was changed and can't be used: {e}")
        if self.demo:
            yield health.trouble("display.demo", "CloudWall was started with --demo: every aircraft is simulated")

    def storage(self):
        if self.data_dir and self.data_dir.exists():
            free = shutil.disk_usage(self.data_dir).free
            if free < 200e6:
                yield health.trouble("storage.full", f"{free / 1e6:.0f} MB free where the logbooks are")
            elif free < 1e9:
                yield health.trouble("storage.low", f"{free / 1e9:.2f} GB free where the logbooks are")
        for place in list(self.places):
            err = place.tracker.storage_error
            n = self.storage_failures[place.id] = self.storage_failures.get(place.id, 0) + 1 if err else 0
            if err:
                yield health.trouble("storage.failing", f"{place.name}: {err}" + (f" ({n} checks running)" if n > 1 else ""))

    def service(self):
        if self.code_changed and self.code_changed():
            yield health.trouble("service.restart-needed")
        now = self.clock()
        for place in list(self.places):
            recent = [t for t in getattr(place, "restarts", []) if now - t < 3600]
            if len(recent) >= 3:
                yield health.trouble("service.crashing", f"{place.name}: a thread was restarted {len(recent)} times in the last hour")

    def routes(self):
        p = self.provider
        if not p or not getattr(p, "enabled", False):
            return
        if getattr(p, "sandbox", False):
            yield health.trouble("routes.sandbox")
        st = p.status()
        if st.get("problem"):
            yield health.trouble("routes.key-rejected", f"{p.label}: {st['problem']}")
        if st.get("period_budget") and st.get("period_used", 0) >= 0.95 * st["period_budget"]:
            yield health.trouble("routes.budget-low", f"{p.label}: {st['period_used']} of this period's "
                                 f"{st['period_budget']} {p.unit} used; the plan renews {st.get('resets')}")

    def timezone(self):
        home = self.cfg["home"]
        if self.demo or "lon" not in home:
            return
        here = time.localtime().tm_gmtoff / 3600
        expected = home["lon"] / 15                    # solar time: real zones are within ~2 h of it
        if abs(here - expected) > 2.5:
            yield health.trouble("clock.timezone", f"this machine's clock is UTC{here:+.0f}, the house is near UTC{expected:+.0f}")

    def feeds(self, place):
        now = self.clock()
        watched = not place.activity.idle() or place.when_idle == "log"
        if not watched:
            self.watched_since.pop(place.id, None)
        else:
            self.watched_since.setdefault(place.id, now)
        st = place.tracker.status
        # judged only after fetching a while: just after an idle pause the last positions are hours old, no fault
        fetching = now - max(self.watched_since.get(place.id, now), self.started)
        since = max(st.get("updated") or 0, self.watched_since.get(place.id, now), self.started)
        if watched and not self.demo and fetching > NO_POSITIONS_S and now - since > NO_POSITIONS_S:
            yield health.trouble("feeds.no-positions", f"{place.name}: no positions for {now - since:.0f} s"
                                 + (f" ({st['error']})" if st.get("error") else ""))
        parts = getattr(place.source, "parts", {}) or {}
        merged = "the public feed" in parts
        for label, feed in parts.items():
            v = feed.vitals
            mine = label == "your receiver"
            if v.down_since and now - v.down_since > DOWN_AFTER_S:
                code = "feeds.receiver-down" if mine and merged else "feeds.public-down"
                yield health.trouble(code, f"{place.name}: {label} hasn't answered for {(now - v.down_since) / 60:.0f} min ({v.error})",
                                     part="receiver" if mine and merged else "feeds")
                continue
            if v.ok_at is None or now - v.ok_at > DOWN_AFTER_S:
                continue
            if v.same >= FROZEN_ANSWERS:
                yield health.trouble("feeds.frozen", f"{place.name}: {label} ({v.host}) gave the same {v.count} aircraft "
                                     f"{v.same + 1} times running, {v.moving} of them moving")
            if v.skew_s is not None and abs(v.skew_s) > SKEW_S:
                yield health.trouble("clock.skew", f"{place.name}: {label}'s clock is {v.skew_s:+.0f} s from this machine's")
            if mine and merged and v.lag_s is not None and v.lag_s > LAG_S:
                yield health.trouble("receiver.lagging", f"{place.name}: your receiver's positions are {v.lag_s:.0f} s old on arrival")
        if merged:
            rx, pub = parts["your receiver"].vitals, parts["the public feed"].vitals
            deaf = rx.ok_at and pub.ok_at and now - rx.ok_at < DOWN_AFTER_S and pub.count >= 8 and rx.count < max(1, 0.1 * pub.count)
            n = self.deaf[place.id] = self.deaf.get(place.id, 0) + 1 if deaf else 0
            if n >= DEAF_CHECKS:
                yield health.trouble("receiver.deaf", f"{place.name}: your receiver has {rx.count} aircraft, the public feed "
                                     f"{pub.count}, for {n * WATCH_S / 60:.0f} min", part="receiver")
        tv = place.tracker.vitals
        if (not self.demo and now - tv["since"] > SUSPECT_AFTER_S and tv["aircraft"] > 500
                and (tv["closest_nm"] or 0) > max(SUSPECT_NM, 2 * place.cfg["tracking"]["overhead_nm"])):
            yield health.trouble("home.suspect", f"{place.name}: {tv['aircraft']} aircraft-updates over "
                                 f"{(now - tv['since']) / 3600:.0f} h, the closest {tv['closest_nm']:.0f} nm away")
        w = place.weather or {}
        t = w.get("time")
        if isinstance(t, (int, float)) and not self.demo and now - t > WEATHER_STALE_S:
            yield health.trouble("weather.stale", f"{place.name}: the latest report is {(now - t) / 3600:.0f} h old")

    def repair(self, finding):
        """The safe repairs, made without asking. Returns what was done, in words, or None."""
        if finding.code in ("storage.full", "storage.low", "cache.over") and self.cache_dir:
            limit = self.cfg["map"]["cache_mb"] * 1e6
            target = limit * (0.25 if finding.code == "storage.full" else 0.5) if limit else 500e6
            removed, kept = tiles.sweep(self.cache_dir / "tiles", target)
            return f"trimmed the map cache: {removed} files removed, {kept / 1e6:.0f} MB kept" if removed else None
        if finding.code == "storage.failing":
            for place in list(self.places):
                if place.tracker.storage_error and self.storage_failures.get(place.id, 0) >= 3:
                    place.store.reopen()
                    self.storage_failures[place.id] = 0
                    return f"{place.name}: reopened its logbook file"
        return None

    # -- the loop --
    def check_once(self):
        findings = self.checks()
        changes = self.monitor.observe(findings)
        for f in self.monitor.last:
            if f.auto and f.state != OK:
                try:
                    done = self.repair(f)
                    if done:
                        log.warning("repaired: %s", done)
                except Exception as e:
                    log.warning("the repair for %s failed: %s", f.code, e)
        for what, f in changes:
            if f.major and self.notify_url:
                self._notify(what, f)
        majors = self.monitor.majors()
        sd_notify("STATUS=" + (f"PROBLEM: {majors[0].summary}" if majors else
                               f"{len(self.monitor.open)} thing(s) worth a look (cloudwall doctor)" if self.monitor.open
                               else "all well"))
        return changes

    def alive(self):
        """Is every place's positions thread running and its loop still turning? Gates the systemd
        watchdog ping (a fault in a check is no reason to be restarted)."""
        now = time.monotonic()
        for p in list(self.places):
            if not all(t.is_alive() for t in p.threads[:1]):
                return False
            beat = getattr(p, "beat", None)       # None: not started yet
            if p.threads and beat is not None and now - beat > 3 * p.cfg["tracking"]["poll_seconds"] + 300:
                return False
        return True

    def _notify(self, what, f):
        body = {"cloudwall": __version__, "host": socket.gethostname(), "event": what, "major": f.major,
                "title": f.summary, "means": f.detail, "steps": f.steps, "code": f.code}
        try:
            post_json(self.notify_url, body, timeout=10)
        except Exception as e:
            log.warning("the alert to [health] notify_url couldn't be sent: %s", e)

    def run(self):
        while not self.stopped.wait(WATCH_S):
            try:
                self.check_once()
            except Exception:
                log.exception("the health watcher's check failed: carrying on")
            if self.alive():
                sd_notify("WATCHDOG=1")

    def start(self):
        try:
            self.check_once()
        except Exception:
            log.exception("the health watcher's first check failed: carrying on")
        threading.Thread(target=self.run, daemon=True, name="health").start()

    def report(self):
        return self.monitor.report()
