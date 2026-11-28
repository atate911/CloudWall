"""The control board's API (/api/admin/...): everything the owner can see and do from the web page,
from how things stand to changing a setting, fixing a problem, backing up and restarting.

It joins the layers below it: the settings (core/schema.py, config.write_setting), CloudWall's
check of itself (app/watch.py and the incident log), doctor and its guided fixes (operate/doctor,
guide, repair), backups, the private link, and the root helper for what needs root. The server
hands every /api/admin/ request here (srv.admin), so the server itself knows nothing of it.

Everything but whoami and sign-in is the owner's alone (serve/auth.py). A request naming a host
CloudWall doesn't answer to is refused, and so is one a browser says comes from another site.
"""
import logging
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .. import __version__
from ..core import config, keys, logs, schema, troubles
from ..operate import backup as backups, doctor as doc, guide, helper, repair
from ..operate.survey import Machine, installs
from ..operate.system import System
from ..serve import auth

# Sections only the control board uses: read from the file as saved, so they need no restart.
LIVE = {"receiver"}

log = logging.getLogger("cloudwall")
UNDER_SYSTEMD = bool(os.environ.get("INVOCATION_ID"))


class Admin:
    def __init__(self, cfg, places, watch=None, store=None, incidents=None, provider=None, demo=False):
        self.cfg, self.places, self.watch, self.incidents = cfg, places, watch, incidents
        self.provider, self.demo = provider, demo
        self.owner = auth.Owner(cfg, store)
        self.started = time.time()
        self.doctor_cache = (0, None)
        self.lock = threading.Lock()

    # -- who may ----------------------------------------------------------------------------
    @staticmethod
    def proxied(h):
        return any(h.headers.get(k) for k in ("X-Forwarded-For", "X-Real-IP", "Forwarded"))

    @staticmethod
    def _visitor(h):
        """Whose wrong passwords these are counted as: the address asking, or, when that is a
        proxy on this machine (Caddy), the visitor it says it is asking for. (Otherwise everyone
        behind the proxy would be one address, and a stranger's guesses would lock the owner out.)"""
        address = h.client_address[0]
        said = (h.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
        return said if said and auth.is_local(address) else address

    def role(self, h):
        return self.owner.role(auth.cookies_of(h.headers.get("Cookie")), h.client_address[0], self.proxied(h))

    def may_change(self, h):
        """For the screens' own changes (places): anyone, until there is an owner; then the owner."""
        return not self.owner.exists() or self.role(h) == "owner"

    def _secure(self, h):
        return h.headers.get("X-Forwarded-Proto") == "https"

    # -- the API ----------------------------------------------------------------------------
    def handle(self, h, method, path):
        q = parse_qs(urlsplit(h.path).query)
        name = path[len("/api/admin/"):].strip("/")
        if not self.owner.host_ok(h.headers.get("Host"), self.proxied(h)):
            return h._send(403, {"error": "The control board answers only to this machine's own names and addresses "
                                          "(or through a proxy such as Caddy). Open it by the machine's address, or set "
                                          "[server] address to the name you use."})
        if method != "GET" and h._foreign():
            return h._send(403, {"error": "Only CloudWall's own page can do that"})
        if name == "whoami":
            return h._send(200, self.whoami(h))
        if name == "signin" and method == "POST":
            body = h._body() or {}
            try:
                token = self.owner.sign_in(str(body.get("password") or ""), self._visitor(h))
            except ValueError as e:
                time.sleep(0.5)
                return h._send(403, {"error": str(e)})
            return h._send(200, {"ok": True}, headers={"Set-Cookie": auth.cookie_header(token, self._secure(h))})
        if name == "signout" and method == "POST":
            self.owner.sign_out(auth.cookies_of(h.headers.get("Cookie")).get(auth.COOKIE))
            return h._send(200, {"ok": True}, headers={"Set-Cookie": auth.cookie_header("", self._secure(h), clear=True)})
        if self.role(h) != "owner":
            return h._send(401, {"error": "Sign in as the owner first", **self.whoami(h)})
        body = h._body() if method in ("POST", "DELETE") else {}
        if body is None:
            return h._send(400, {"error": "bad json"})
        try:
            got = self.route(method, name, q, body or {})
        except (guide.Answered, ValueError, PermissionError) as e:
            return h._send(400, {"error": str(e)})
        except Exception as e:                 # anything else is still answered, not a dropped connection
            log.exception("admin: %s %s failed", method, name)
            return h._send(400 if isinstance(e, (KeyError, TypeError)) else 500, {"error": f"That didn't work ({type(e).__name__}: {e})"})
        if method == "POST" and name == "password":      # every session was the old password's: this one carries over
            self.owner.carry_over(auth.cookies_of(h.headers.get("Cookie")).get(auth.COOKIE))
        if isinstance(got, tuple) and got[0] == "file":
            _, data, ctype, filename = got
            return h._send(200, data, ctype, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
        if isinstance(got, tuple) and got[0] == "restart":
            h._send(200, got[1])
            threading.Timer(0.6, os._exit, [0]).start()        # systemd starts it again (Restart=always)
            return None
        return h._send(200 if got is not None else 404, got if got is not None else {"error": "not found"})

    def route(self, method, name, q, body):
        get = method == "GET"
        if get and name == "overview":
            return self.overview()
        if get and name == "settings":
            return self.settings()
        if method == "POST" and name == "settings":
            return self.set_setting(body)
        if method == "POST" and name == "tidy":
            return self.tidy(body)
        if get and name == "health":
            return self.watch.report() if self.watch else {"open": [], "findings": []}
        if get and name == "incidents":
            return {"incidents": self.incidents.recent(200) if self.incidents else []}
        if get and name == "doctor":
            return self.run_doctor(fresh=q.get("fresh") == ["1"])
        if get and name == "log":
            return {"lines": logs.RECENT.since(int((q.get("after") or ["0"])[0] or 0), (q.get("level") or [None])[0])}
        if get and name == "catalogue":
            return {"troubles": {code: {"title": t.title, "means": t.means, "causes": list(t.causes), "steps": list(t.steps),
                                        "major": t.major, "subtle": t.subtle, "repair": t.repair, "auto": t.auto,
                                        "asks": [a.__dict__ for a in t.asks]} for code, t in troubles.CATALOGUE.items()},
                    "repairs": {k: {"does": v[0], "root": v[1]} for k, v in repair.REPAIRS.items()}}
        if method == "POST" and name == "fix":
            return self.fix(body)
        if method == "POST" and name == "repair":
            return self.repair(body)
        if get and name.startswith("requests/"):
            return helper.result(name.split("/", 1)[1])
        if method == "POST" and name == "restart":
            if not UNDER_SYSTEMD:
                raise ValueError("CloudWall isn't running as a service here, so it can't start itself again: restart it by hand")
            return ("restart", {"ok": True, "said": "CloudWall is restarting: the page reconnects in a few seconds"})
        if get and name == "backups":
            return self.list_backups()
        if method == "POST" and name == "backups":
            out = backups.backup(self.cfg.get("_path"), say=lambda *a: None, cfg=self.cfg)
            return {"ok": True, "said": f"backup written: {out.name}", "name": out.name}
        if get and name.startswith("backups/"):
            return self.download_backup(name.split("/", 1)[1])
        if method == "POST" and name == "private-link":
            return self.private_link(body)
        if method == "POST" and name == "password":
            keys.set_password(str(body.get("password") or ""), self.cfg.get("_path"))
            return {"ok": True, "said": "the owner's password is changed; anyone else signed in is signed out"}
        if get and name == "receiver":
            return self.receiver()
        if method == "POST" and name == "alert-test":
            return self.alert_test()
        return None

    def alert_test(self):
        """Send a test alert to [health] notify_url, so the owner sees it arrive on their phone."""
        from ..core.http import post_json
        url = (self.saved().get("health") or {}).get("notify_url")      # as saved: test it before restarting
        if not url:
            raise ValueError("No alert address is saved yet")
        try:
            post_json(url, {"cloudwall": __version__, "event": "test", "major": False,
                            "title": "A test alert from CloudWall's control board",
                            "means": "If this reached you, problems that stop CloudWall working will too."}, timeout=10)
        except Exception as e:
            raise ValueError(f"The alert address didn't take it: {e}") from None
        return {"ok": True, "said": "Test alert sent: it should reach you within a few seconds"}

    # -- your receiver ---------------------------------------------------------------------------
    def saved(self):
        """The settings as saved (not as running): for the settings only the board uses, which
        take effect as soon as they're saved. Read again at most every few seconds."""
        at, cfg = getattr(self, "_saved", (0, None))
        path = self.cfg.get("_path")
        if not path:
            return self.cfg
        if time.time() - at > 3 or cfg is None:
            try:
                cfg = config.load(path)
            except Exception:
                cfg = self.cfg
            self._saved = (time.time(), cfg)
        return cfg

    def receiver_urls(self, cfg=None):
        """(the receiver's web server, Coverage3D's), as reached from this machine, or None each."""
        cfg = cfg or self.saved()
        r = cfg.get("receiver") or {}
        url = (r.get("url") or "").rstrip("/")
        src = cfg["source"]
        if not url and src.get("merge") and src["urls"]:
            first = src["urls"][0]
            url = first.split("/data/")[0] if "/data/" in first else ""
        cov = (r.get("coverage_url") or "").rstrip("/")
        if not cov and url:
            m = re.match(r"^(https?://[^/:]+):(\d+)$", url)
            # through the tunnel the receiver is 127.0.0.1:18080 and Coverage3D the port after the
            # receiver's own (18090); at home, the receiver's address on Coverage3D's own port, 8090
            cov = f"{m.group(1)}:{int(m.group(2)) + 10}" if m and m.group(2) == "18080" else \
                (f"{m.group(1)}:8090" if m else "")
        return url or None, cov or None

    def receiver(self):
        """How the receiver is doing, from its own files (receiver.json, stats.json, outline.json),
        with the board's own reading of them."""
        from ..core.http import get_json
        url, cov = self.receiver_urls()
        out = {"url": url, "coverage_url": cov, "home_url": (self.saved().get("receiver") or {}).get("home_url") or None,
               "reachable": False, "coverage": False}
        if not url:
            return out
        try:
            rec = get_json(f"{url}/data/receiver.json", timeout=8) or {}
            stats = get_json(f"{url}/data/stats.json", timeout=8) or {}
            out["reachable"] = True
        except Exception as e:
            out["error"] = str(e)
            return out
        try:
            outline = get_json(f"{url}/data/outline.json", timeout=8) or {}
        except Exception:
            outline = {}
        out["receiver"] = {"lat": rec.get("lat"), "lon": rec.get("lon"), "version": rec.get("version")}
        out["now"] = stats.get("now")
        out["gain_db"] = stats.get("gain_db")
        out["ppm"] = stats.get("estimated_ppm")
        out["with_pos"] = stats.get("aircraft_with_pos")
        out["without_pos"] = stats.get("aircraft_without_pos")
        out["by_type"] = {k: v for k, v in (stats.get("aircraft_count_by_type") or {}).items() if v}
        for span, secs in (("last1min", 60), ("last15min", 900)):
            p = stats.get(span) or {}
            local = p.get("local") or {}
            accepted = sum(local.get("accepted") or [0])
            out[span] = {"messages_s": round((p.get("messages") or 0) / secs, 1), "signal": local.get("signal"),
                         "noise": local.get("noise"), "peak": local.get("peak_signal"),
                         "strong_pct": round(100 * (local.get("strong_signals") or 0) / accepted, 1) if accepted else None,
                         "max_nm": round((p.get("max_distance") or 0) / 1852, 1) if p.get("max_distance") else None}
        pts = (((outline.get("actualRange") or {}).get("last24h") or {}).get("points")) or outline.get("points") or []
        out["outline"] = [[round(p[0], 4), round(p[1], 4)] for p in pts
                          if isinstance(p, list) and len(p) >= 2 and all(isinstance(x, (int, float)) for x in p[:2])][:720]
        if cov:
            try:
                got = get_json(f"{cov}/healthz", timeout=4)
                out["coverage"] = got is not None
            except Exception:
                out["coverage"] = False
        return out

    def relay(self, h, path):
        """/receiver/... and /coverage/...: the receiver's live map and Coverage3D, as pages of the
        board, for the owner. Only GET; only below the address set; nothing of the board's own
        (its cookie) passed on."""
        from ..core.http import relay
        if not self.owner.host_ok(h.headers.get("Host"), self.proxied(h)):      # (as handle: no page under another name)
            return h._send(403, {"error": "The control board answers only to this machine's own names and addresses"})
        if self.role(h) != "owner":
            return h._send(401, b"<!doctype html><meta charset=utf-8><p style='font:1rem sans-serif;margin:2rem'>"
                                b"Sign in on the control board first.</p>", "text/html; charset=utf-8")
        which, _, rest = path.lstrip("/").partition("/")
        url, cov = self.receiver_urls()
        base = url if which == "receiver" else cov
        if not base:
            return h._send(404, {"error": f"no {which} is set up: see the control board's Your receiver page"})
        query = urlsplit(h.path).query
        if ".." in rest.split("/") or "://" in rest or rest.startswith("/"):
            return h._send(400, {"error": "not a path"})
        try:
            status, back, data = relay(f"{base}/{rest}" + (f"?{query}" if query else ""), h.headers)
        except Exception as e:
            return h._send(502, {"error": f"the {which} didn't answer: {e}"})
        h.send_response(status)
        for k, v in back.items():
            h.send_header(k, v)
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)

    # -- what the board shows ------------------------------------------------------------------
    def whoami(self, h):
        return {"role": self.role(h), "owner_set": self.owner.exists(), "local": auth.is_local(h.client_address[0]),
                "version": __version__, "demo": self.demo}

    def overview(self):
        now = time.time()
        places = []
        for p in list(self.places):
            st = p.tracker.status
            feeds = {}
            for label, f in (getattr(p.source, "parts", {}) or {}).items():
                v = f.vitals
                feeds[label] = {"host": v.host, "ok_at": v.ok_at, "down_since": v.down_since, "error": v.error,
                                "count": v.count, "moving": v.moving, "skew_s": v.skew_s, "lag_s": v.lag_s, "same": v.same}
            places.append({"id": p.id, "name": p.name, "airport": p.cfg["airport"].get("icao"), "added": p.added,
                           "status": st, "aircraft": len(p.tracker.aircraft), "beyond": len(p.tracker.beyond),
                           "today": p.tracker.today[0], "watched": not p.activity.idle(), "feeds": feeds,
                           "vitals": p.tracker.vitals, "restarts": len([t for t in p.restarts if now - t < 86400]),
                           "weather_at": (p.weather or {}).get("time")})
        path = self.cfg.get("_path")
        data = Path(self.cfg["storage"]["db_path"] or config.default_db_path()).expanduser().parent
        disk = None
        try:
            import shutil
            u = shutil.disk_usage(data)
            disk = {"free": u.free, "total": u.total}
        except OSError:
            pass
        files = {f.name: f.stat().st_size for f in data.glob("*.db")} if data.is_dir() else {}
        return {"version": __version__, "started": self.started, "now": now, "under_systemd": UNDER_SYSTEMD,
                "demo": self.demo, "settings_file": path, "settings_problems": self.cfg.get("_problems", []),
                "health": self.watch.report() if self.watch else None,
                "incidents": self.incidents.recent(20) if self.incidents else [],
                "places": places, "provider": self.provider.status() if self.provider and self.provider.enabled else None,
                "storage": {"folder": str(data), "disk": disk, "files": files, "cache": self.cache_size(),
                            "last_backup": self.last_backup()}, "helper": helper.available(),
                "installs": installs(Machine()), "private_link": bool(self.cfg["server"]["key"]),
                "home": {k: self.cfg["home"].get(k) for k in ("name", "lat", "lon")},
                "tracking": {k: self.cfg["tracking"][k] for k in ("radius_nm", "overhead_nm", "when_idle")},
                "map": {"style": self.cfg["map"]["style"], "cache_mb": self.cfg["map"]["cache_mb"]},
                "alerts": bool(self.cfg.get("health", {}).get("notify_url")),
                "address": self.cfg["server"].get("address") or None}

    def cache_size(self):
        """The map tiles' and logos' size on disk (counted at most every ten minutes: it walks a folder)."""
        at, size = getattr(self, "_cache_size", (0, None))
        if time.time() - at > 600:
            folder = config.cache_dir(self.cfg, str(self.cfg["storage"]["db_path"] or config.default_db_path()))
            size = 0
            for sub in ("tiles", "logos"):
                for root, _, names in os.walk(folder / sub):
                    for n in names:
                        try:
                            size += os.path.getsize(os.path.join(root, n))
                        except OSError:
                            pass
            self._cache_size = (time.time(), size)
        return size

    def last_backup(self):
        folder = backups.default_folder(self.cfg)
        times = [p.stat().st_mtime for p in folder.glob("cloudwall-*.tar.gz")] if folder.is_dir() else []
        return max(times) if times else None

    def settings(self):
        path = self.cfg.get("_path")
        on_disk = config.load(path) if path else self.cfg
        running = {s["name"]: {st["key"]: st["value"] for st in s["settings"]} for s in schema.describe(self.cfg)}
        for s in schema.describe(on_disk):
            if s["name"] in LIVE:          # used as saved: nothing waits for a restart
                running[s["name"]] = {st["key"]: st["value"] for st in s["settings"]}
            for st in s["settings"]:       # given on the command line: not the file's to change
                if f'{s["name"]}.{st["key"]}' in self.cfg.get("_cli", []):
                    running[s["name"]][st["key"]] = st["value"]
        return {"file": path, "pages": [{"name": n, "label": l} for n, l in schema.PAGES],
                "sections": schema.describe(on_disk), "live": sorted(LIVE), "running": running,
                "strays": [dict(x, value=x["value"] if not re.search(r"key|token|password|secret|url", x["key"]) else "(hidden)")
                           for x in config.strays(path)] if path else [],
                "left_out": on_disk.get("_problems", [])}

    def tidy(self, body):
        """A line of the settings file that does nothing: moved under the heading it belongs to (only
        when the setting isn't already set there), or taken out."""
        path = self.cfg.get("_path")
        section, key, action = str(body.get("section") or ""), str(body.get("key") or ""), body.get("action")
        stray = next((x for x in config.strays(path) if x["section"] == section and x["key"] == key), None) if path else None
        if not stray:
            raise ValueError(f"[{section}] {key} isn't a stray line in the settings file")
        if action == "move":
            home = stray["belongs"]
            if not home:
                raise ValueError(f"{key} isn't a setting of any one section: it can only be taken out")
            here = config.load(path)
            import tomllib
            with open(path, "rb") as f:
                already = key in tomllib.load(f).get(home, {})
            if already:
                config.remove_setting(path, section, key)
                return {"ok": True, "said": f"[{home}] {key} was already set (to {here[home][key]!r}): the stray line under [{section}] is taken out",
                        "restart": True}
            config.write_setting(path, home, key, stray["value"])
            config.remove_setting(path, section, key)
            self._saved = (0, None)
            return {"ok": True, "said": f"{key} moved from [{section}] to [{home}]. Restart CloudWall for it to take effect.", "restart": True}
        if action == "remove":
            config.remove_setting(path, section, key)
            self._saved = (0, None)
            return {"ok": True, "said": f"[{section}] {key} taken out of the settings file (it did nothing)"}
        raise ValueError("action must be move or remove")

    def _settings_file(self):
        """The settings file changes go to: the one CloudWall started from, or, started without
        one, the user's own, begun now and from here on the one the board reads."""
        if not self.cfg.get("_path"):
            path = str(config.user_config_path())
            config.init(path)
            self.cfg["_path"] = path
        return self.cfg["_path"]

    def set_setting(self, body):
        section, key = str(body.get("section") or ""), str(body.get("key") or "")
        st = schema.find(section, key)
        if not st:
            raise ValueError(f"[{section}] {key} isn't a setting")
        path = self._settings_file()
        value = body.get("value")
        if value is None:                  # back to not set at all (undoing a setting that had no value)
            config.remove_setting(path, section, key)
            self._saved = (0, None)
            return {"ok": True, "said": f"{st.label} is no longer set"} if section in LIVE else \
                {"ok": True, "said": f"{st.label} is no longer set. Restart CloudWall for it to take effect.", "restart": True}
        kind = config.kind_of(section, key)
        if kind == "bool":
            value = value in (True, "true", "on", "1", 1)
        elif kind == "number" and isinstance(value, str):
            try:
                value = float(value) if "." in value or "e" in value.lower() else int(value)
            except ValueError:
                raise ValueError(f"{st.label} must be a number") from None
        elif kind == "list" and isinstance(value, str):
            value = [v.strip() for v in value.splitlines() if v.strip()]
        if key == "key" and section == "server" and value and keys.problem(value):
            raise ValueError(f"the key {keys.problem(value)}")
        config.write_setting(path, section, key, value)
        self._saved = (0, None)
        if section in LIVE:
            return {"ok": True, "said": f"{st.label} saved"}
        return {"ok": True, "said": f"{st.label} saved. Restart CloudWall for it to take effect."
                + (f" Note: {st.costs}." if st.costs else ""), "restart": True}

    def run_doctor(self, fresh=False):
        """doctor's findings (cached a minute: it asks the feeds)."""
        with self.lock:
            at, found = self.doctor_cache
            if fresh or not found or time.time() - at > 60:
                found, _ = doc.doctor(self.cfg.get("_path"), offline=False, ask=System().ask)
                self.doctor_cache = (time.time(), found)
        return {"checked": self.doctor_cache[0], "findings": [f.to_dict() for f in found]}

    def fix(self, body):
        code, name, value = body.get("code"), body.get("name"), body.get("value")
        if code not in troubles.CATALOGUE:
            raise ValueError("no such problem")
        finding = next((f for f in (self.watch.monitor.last if self.watch else []) if f.code == code), None)
        if finding is None and body.get("summary"):
            from ..core.health import trouble
            finding = trouble(code, str(body["summary"]))
        if code == "clock.timezone":                 # needs root: through the helper
            zone = helper._zone({"zone": value})     # (raises ValueError, said to the owner, if it isn't one)
            if not helper.available():
                raise ValueError(f"Set it at the machine: sudo timedatectl set-timezone {zone}")
            return {"ok": True, "request": helper.ask("set-timezone", {"zone": zone}), "said": "asked the root helper"}
        said = guide.answer(code, name, value, doc.Context(self.cfg.get("_path"), True), None, Machine(), finding)
        return {"ok": True, "said": said or "left as it was"}

    def repair(self, body):
        name = body.get("name")
        if name not in repair.REPAIRS:
            raise ValueError("no such repair")
        words, root, fn = repair.REPAIRS[name]
        if name in ("reopen-store", "trim-cache") and self.watch:
            from ..core.health import trouble
            code = {"reopen-store": "storage.failing", "trim-cache": "storage.low"}[name]
            said = self.watch.repair(trouble(code)) if name == "trim-cache" else None
            if name == "reopen-store":
                for p in list(self.places):
                    p.store.reopen()
                said = "reopened every logbook file"
            return {"ok": True, "said": said or "nothing needed doing"}
        if name == "restart-service":
            raise ValueError("use Restart on the control board's System page")
        if root:
            if name not in helper.ALLOWED:
                raise ValueError(f"{words}: do this at the machine (`sudo cloudwall doctor --fix`)")
            if not helper.available():
                raise ValueError(f"{words} needs root, and the root helper isn't installed: run `sudo cloudwall install`")
            return {"ok": True, "request": helper.ask(name), "said": "asked the root helper"}
        return {"ok": True, "said": fn(System(say=lambda *a: None), Machine()) or "nothing needed doing"}

    def list_backups(self):
        folder = backups.default_folder(self.cfg)
        items = sorted(folder.glob("cloudwall-*.tar.gz"), reverse=True) if folder.is_dir() else []
        return {"folder": str(folder), "backups": [{"name": p.name, "size": p.stat().st_size, "made": p.stat().st_mtime}
                                                   for p in items]}

    def download_backup(self, name):
        if not re.fullmatch(r"cloudwall-[A-Za-z0-9._-]+\.tar\.gz", name):
            return None
        p = backups.default_folder(self.cfg) / name
        return ("file", p.read_bytes(), "application/gzip", name) if p.is_file() else None

    def private_link(self, body):
        action = body.get("action")
        if action == "new":
            key = keys.new_key()
            config.write_setting(self._settings_file(), "server", "key", key)
            return {"ok": True, "key": key, "said": "A new private link is saved. Restart CloudWall, then open the new link on each screen.",
                    "restart": True}
        if action == "off":
            config.write_setting(self._settings_file(), "server", "key", "")
            return {"ok": True, "said": "The private link is taken away (after a restart CloudWall is open to whoever can reach it).",
                    "restart": True}
        if action == "show":
            return {"ok": True, "key": self.cfg["server"]["key"] or None}
        raise ValueError("new, off or show")

