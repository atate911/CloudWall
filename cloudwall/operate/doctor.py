"""`cloudwall doctor`: is everything working, and if not, what to do. Each check below looks at one
part, from outside the running CloudWall (so it works when CloudWall itself doesn't start), and
names what it finds wrong by its code in core/troubles.py, which says what it means and what to do.
The running CloudWall's own findings (app/watch.py) and the survey of the machine (survey.py) are
added, so one command sees everything. `--fix` hands the findings to guide.py.

Nothing here changes anything. Databases are opened read-only, so running doctor as root never
leaves files the service can't write.
"""
import copy
import os
import shutil
import socket
import sqlite3
import sys
import time
import urllib.error
from pathlib import Path

from .. import __version__
from ..core import config, health
from ..core.health import Finding, off, ok, trouble
from ..core.http import get_json


WAKE_S = 20                     # how long a woken CloudWall is given to fetch its first positions


class Context:
    """What the checks look at: the settings as CloudWall would read them, and where its files are."""

    def __init__(self, config_path=None, offline=False, ask=None):
        self.config_path = config.find(config_path)
        self.offline = offline
        self.ask = ask                      # run a read-only command: System.ask (None: don't)
        self.error = None
        self.unreadable = False
        try:
            self.cfg = config.load(config_path)
        except PermissionError:             # the installed settings are the service's: not ours to read
            self.unreadable = True
            self.cfg = copy.deepcopy(config.DEFAULTS)
            self.cfg["_problems"] = []
        except Exception as e:              # a broken file: the other checks go on with the defaults
            self.error = e
            self.cfg = copy.deepcopy(config.DEFAULTS)
            self.cfg["_problems"] = []
        db = self.cfg["storage"]["db_path"] or config.default_db_path()
        self.db = Path(db).expanduser()
        self.data = self.db.parent
        self.cache = config.cache_dir(self.cfg, str(self.db))


def settings(ctx):
    path = ctx.config_path
    if ctx.unreadable:
        yield Finding("settings", health.WARN, f"{path} is the service's and you can't read it, so the settings weren't checked",
                      "Only the settings, and what depends on them, go unchecked.", "Run it with sudo: `sudo cloudwall doctor`.")
        return
    if ctx.error:
        good = Path(f"{path}.good")
        yield trouble("settings.broken", f"{path} can't be used: {ctx.error}"
                      + (f" (CloudWall falls back on {good}, the last that started)" if good.exists() else
                         " (and there is no copy that started to fall back on: CloudWall won't start)"))
        return
    if path is None:
        yield trouble("settings.placeholder", "no settings file: CloudWall runs on its built-in defaults, "
                      "the example's house in Vancouver, WA")
        return
    for problem in ctx.cfg.get("_problems", []):
        yield trouble("settings.ignored", problem)
    home = ctx.cfg["home"]
    if (home.get("lat"), home.get("lon")) == (config.DEFAULTS["home"]["lat"], config.DEFAULTS["home"]["lon"]):
        yield trouble("settings.placeholder", f"[home] in {path} is still the example's placeholder")
    else:
        yield ok("settings", f"read from {path}")
    mode = path.stat().st_mode & 0o777 if path.exists() else 0
    c = ctx.cfg
    if mode & 0o004 and (c["server"]["key"] or c["flightradar24"]["api_key"] or c["flightaware"]["api_key"]):
        yield trouble("settings.readable", f"{path} holds keys and every account on this machine can read it (mode {mode:o})")


def storage(ctx):
    if not ctx.data.exists():
        yield off("storage", f"{ctx.data} doesn't exist yet: it is made when CloudWall first starts")
        return
    free = shutil.disk_usage(ctx.data).free
    if free < 200e6:
        yield trouble("storage.full", f"{free / 1e6:.0f} MB free where the logbooks are ({ctx.data})")
    elif free < 1e9:
        yield trouble("storage.low", f"{free / 1e9:.2f} GB free where the logbooks are ({ctx.data})")
    else:
        yield ok("storage", f"{free / 1e9:.1f} GB free where the logbooks are ({ctx.data})")
    for db in sorted(ctx.data.glob("*.db")):
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            try:
                state = con.execute("PRAGMA quick_check").fetchone()[0]
                version = con.execute("PRAGMA user_version").fetchone()[0]
                n = con.execute("SELECT COUNT(*) FROM sightings").fetchone()[0] \
                    if con.execute("SELECT 1 FROM sqlite_master WHERE name='sightings'").fetchone() else None
            finally:
                con.close()
        except sqlite3.Error as e:
            state, version, n = str(e), None, None
        if state == "ok":
            yield ok("storage", f"{db.name}: readable" + (f", {n} flyovers logged" if n is not None else "")
                     + f" ({db.stat().st_size / 1e6:.1f} MB, version {version})")
        else:
            yield trouble("storage.damaged", f"{db.name} is damaged: {state}")
    aside = sorted(ctx.data.glob("*.damaged-*"))
    if aside:
        yield trouble("storage.set-aside", f"set aside: {', '.join(p.name for p in aside[:3])}")


def cache(ctx):
    tiles = ctx.cache / "tiles"
    if not tiles.exists():
        yield off("cache", "no map tiles downloaded yet")
        return
    size = sum(f.stat().st_size for f in tiles.rglob("*") if f.is_file())
    limit = ctx.cfg["map"]["cache_mb"] * 1e6
    if limit and size > limit * 1.2:
        yield trouble("cache.over", f"map tiles take {size / 1e6:.0f} MB, over the {ctx.cfg['map']['cache_mb']} MB allowed")
    else:
        yield ok("cache", f"map tiles take {size / 1e6:.0f} MB of the {ctx.cfg['map']['cache_mb']} MB allowed")


def server(ctx):
    if ctx.unreadable:                  # without the settings, the private link's key isn't known
        yield off("server", "not checked: the settings aren't yours to read (run it with sudo)")
        return
    s = ctx.cfg["server"]
    port, key = s["port"], s["key"]
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=3):
            pass
    except OSError:
        yield trouble("server.not-answering", f"nothing is answering on port {port}")
        return
    try:
        url = f"http://127.0.0.1:{port}" + (f"/k/{key}" if key else "") + "/api/state"
        st = (get_json(url, timeout=10) or {}).get("status") or {}
        # Asking counts as a screen looking: a CloudWall paused with no screen open (or only just
        # started) wakes and fetches. Give it a moment to before judging, or it would always look
        # offline to the first doctor after a quiet spell or a restart.
        waited = 0
        while not st.get("ok") and waited < WAKE_S:
            time.sleep(2)
            waited += 2
            st = (get_json(url, timeout=10) or {}).get("status") or {}
        age = time.time() - (st.get("updated") or 0)
        if st.get("ok"):
            yield ok("server", f"answering on port {port}; positions from {st.get('source')} {age:.0f} s ago")
        elif not st.get("updated"):
            yield trouble("feeds.no-positions", f"answering on port {port}, but no positions have arrived since it started"
                          + (f": {st.get('error')}" if st.get("error") else ""))
        elif age > 300:
            yield trouble("feeds.no-positions", f"answering on port {port}, but no positions for {age / 60:.0f} min"
                          + (f": {st.get('error')}" if st.get("error") else ""))
    except urllib.error.HTTPError as e:
        yield trouble("server.port-taken", f"port {port} answered HTTP {e.code}: another program has it, or the key differs")
    except Exception as e:
        yield trouble("server.port-taken", f"port {port} is open but didn't answer as CloudWall: {e}")
    if s["host"] in ("0.0.0.0", "::", "") and not key and s.get("address"):
        yield trouble("access.open", f"listening on every address with no private link, as {s['address']}")


def feeds(ctx):
    if ctx.unreadable:
        yield off("feeds", "not checked: the settings aren't yours to read (run it with sudo)")
        return
    if ctx.offline:
        yield off("feeds", "not checked (--offline)")
        return
    home = ctx.cfg["home"]
    if "lat" not in home and home.get("zip"):
        from ..reference import placing
        home = placing.locate_home(home)
    urls = ctx.cfg["source"]["urls"]
    merged = ctx.cfg["source"].get("merge") and len(urls) > 1
    for i, url in enumerate(urls):
        mine = merged and i == 0
        label = "your receiver" if mine else "public feed"
        u = url.format(lat=f"{home['lat']:.4f}", lon=f"{home['lon']:.4f}", radius=5)
        host = u.split("/")[2] if "//" in u else u
        t = time.time()
        try:
            data = get_json(u, timeout=10) or {}
            n = len(data.get("aircraft") or data.get("ac") or [])
            made = data.get("now")
            lag = (time.time() - (made / 1000 if made > 1e11 else made)) if isinstance(made, (int, float)) else None
            if lag is not None and lag > 60:
                yield trouble("feeds.stale", f"{label} {host} answers, but with data {lag:.0f} s old")
            elif lag is not None and abs(lag) > 15:
                yield trouble("clock.skew", f"{label} {host}'s clock is {-lag:+.0f} s from this machine's")
            else:
                yield ok("feeds", f"{label} {host}: answered in {time.time() - t:.1f} s, {n} aircraft within 5 nm")
        except Exception as e:
            yield trouble("feeds.receiver-down" if mine else "feeds.public-down", f"{label} {host} didn't answer: {e}",
                          part="receiver" if mine else "feeds")


def service(ctx):
    """The system install's service (the survey looks for every other way CloudWall may be set up)."""
    if not ctx.ask or not Path("/etc/systemd/system/cloudwall.service").exists():
        return
    got = ctx.ask(["systemctl", "is-active", "cloudwall"])
    if got is not None and got.stdout.strip() == "active":
        yield ok("service", "cloudwall.service is running")


def clock(ctx):
    home = ctx.cfg["home"]
    if "lon" in home:
        here, expected = time.localtime().tm_gmtoff / 3600, home["lon"] / 15
        if abs(here - expected) > 2.5:
            yield trouble("clock.timezone", f"this machine's clock is UTC{here:+.0f}, the house is near UTC{expected:+.0f}")
    if not ctx.ask:
        return
    got = ctx.ask(["timedatectl", "show", "-p", "NTPSynchronized", "--value"])
    if got is None or got.returncode != 0:
        return
    if got.stdout.strip() == "yes":
        yield ok("clock", "the clock is synchronised")
    else:
        yield trouble("clock.unsynced")


def providers(ctx):
    found = False
    for name, env in (("flightradar24", "CLOUDWALL_FR24_KEY"), ("flightaware", "CLOUDWALL_FLIGHTAWARE_KEY")):
        c = ctx.cfg[name]
        if c["api_key"] or os.environ.get(env):
            found = True
            if c.get("sandbox"):
                yield trouble("routes.sandbox", f"{name}: sandbox = true")
            else:
                yield ok("routes", f"{name}: a key is set ({c['mode']} mode)")
    if not found:
        yield off("routes", "no paid route provider: routes come from the free database (often right, sometimes not)")


def python(ctx):
    v = sys.version_info
    if v >= (3, 11):
        yield ok("system", f"CloudWall {__version__} on Python {v.major}.{v.minor}")
    else:
        yield Finding("system", health.FAIL, f"Python {v.major}.{v.minor}: CloudWall needs 3.11 or later",
                      "CloudWall won't run on it.", "Install a newer Python (apt install python3).", major=True)


def from_server(ctx):
    """What the running CloudWall's own watcher has found (app/watch.py), when it is running: the
    problems only it can see (a frozen feed, a deaf receiver, a logbook that stopped saving)."""
    if ctx.unreadable:
        return
    s = ctx.cfg["server"]
    try:
        got = get_json(f"http://127.0.0.1:{s['port']}" + (f"/k/{s['key']}" if s["key"] else "") + "/api/health", timeout=10)
    except Exception:
        return
    for f in (got or {}).get("open", []):
        known = {k: f.get(k) for k in Finding.__dataclass_fields__ if k in f}
        yield Finding(**{**known, "part": f"running: {known.get('part')}"})


for _part, _check in (("system", python), ("settings", settings), ("service", service), ("server", server),
                      ("running", from_server), ("feeds", feeds), ("storage", storage), ("cache", cache),
                      ("clock", clock), ("routes", providers)):
    health.register(_part, _check)


def doctor(config_path=None, offline=False, ask=None, machine=None):
    """(findings, the worst state): every registered check of CloudWall's settings and parts, the
    running CloudWall's own findings, and the survey of this machine (operate/survey.py)."""
    from .survey import Machine, survey
    ctx = Context(config_path, offline, ask)
    found = health.run(ctx)
    # what the running CloudWall says and doctor's own checks find the same problems: said once
    own = {f.code for f in found if f.code and not f.part.startswith("running:")}
    found = [f for f in found if not (f.part.startswith("running:") and f.code in own)]
    mine = {(f.code, _file(f.summary)) for f in found if f.code}
    # the survey looks at every install's files: one this check has already said is said once
    found += [f for f in survey(machine or Machine(ask=ask)) if not (f.code and (f.code, _file(f.summary)) in mine)]
    return found, health.worst(found)


def _file(text):
    """The first file a finding names, as an absolute path (for telling two findings of it apart)."""
    import re
    m = re.search(r"(/[\w./-]+|[\w.-]+\.toml)", text or "")
    return str(Path(m.group(1)).resolve()) if m else None
