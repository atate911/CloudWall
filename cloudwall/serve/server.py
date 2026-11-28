"""HTTP server: JSON API plus the static touchscreen UI."""
import gzip
import hashlib
import json
import logging
import mimetypes
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from ..core import keys, paths
from ..reference import about, airports
from . import access

CODE = paths.PACKAGE
WEB = paths.WEB
CODE_CHECK_S = 60
MAX_BODY = 16 * 1024        # bytes: a place to set up is a few dozen
# API version (API.md): raised when a key is removed or changes meaning; adding a key doesn't.
API = 1
log = logging.getLogger("cloudwall")
# health before the watcher has looked (or where there is none)
QUIET = {"worst": "ok", "problems": 0, "checked": None, "major": None, "major_title": None, "subtle": None}
# what a request without the key is told: that there is a key, and nothing else
PRIVATE = (b"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>CloudWall</title>"
           b"<body style='font:1.1rem system-ui,sans-serif;margin:18vh auto;max-width:26rem;padding:0 1.5rem;line-height:1.5'>"
           b"<h1 style='font-size:1.4rem'>This CloudWall is private</h1><p>Open it with its own link, the one ending in its key.</p>")


def code_stamp():
    """A fingerprint of CloudWall's Python code as it is on disk now."""
    h = hashlib.sha1()
    for f in sorted(CODE.rglob("*.py")):
        try:
            h.update(str(f.relative_to(CODE)).encode() + b"\0" + f.read_bytes())
        except OSError:
            pass
    return h.hexdigest()


class CodeWatch:
    """Has the code changed on disk since the server started? Pages are read from disk per request
    but Python only at start, so after an update without a restart new pages meet the old server.
    Screens are told (restart in /api/state). Checked at most once a minute, while a screen asks."""

    def __init__(self):
        self.started, self.checked, self.changed = code_stamp(), time.time(), False

    def __call__(self):
        if not self.changed and time.time() - self.checked >= CODE_CHECK_S:
            self.checked = time.time()
            if code_stamp() != self.started:
                self.changed = True
                log.warning("CloudWall's code has changed since it started: restart it to run the new version")
        return self.changed


_files = {}       # (path, gzipped) -> (etag, bytes): the page's files as last read, until they change on disk


def _static(f, tag, zipped):
    kept = _files.get((f, zipped))
    if not kept or kept[0] != tag:
        data = f.read_bytes()
        kept = _files[(f, zipped)] = (tag, gzip.compress(data, 6) if zipped else data)
    return kept[1]


class _Nowhere:
    """Where the body of an answer to HEAD is written."""
    def write(self, data):
        return len(data)

    def flush(self):
        pass


def make_server(cfg, places, charts=None, logos=None):
    """places: a place.Places. A screen names its place with ?place=; without one, the kiosk
    (?kiosk=1) gets its configured place and any other screen the first. With [server] key set,
    everything is answered only under /k/<key>/ (access.py)."""

    code_changed = CodeWatch()
    started = int(time.time())
    key = keys.tidy(cfg["server"].get("key"))
    display = {"basemap": charts.map.info() if charts else None, "charts": charts.info() if charts else None,
               "logos": bool(logos and logos.enabled)}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def handle_one_request(self):
            # a screen that goes away mid-answer is no fault: nothing to log
            try:
                super().handle_one_request()
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True

        def _send(self, code, body, ctype="application/json", headers=None):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _redirect(self, to):
            query = urlsplit(self.path).query
            self.send_response(308)
            self.send_header("Location", to + (f"?{query}" if query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _admin(self, method):
            path = self.path.split("?")[0]
            if not path.startswith("/api/admin/"):
                return False
            if srv.admin is None:
                self._send(404, {"error": "the control board isn't running"})
            else:
                srv.admin.handle(self, method, path)
            return True

        def _admitted(self):
            """With a key set, answer only under /k/<key>/ (prefix stripped). Every request method
            must come through here first."""
            if not key:
                return True
            how, to = access.admit(self.path, key)
            if how == "in":
                self.path = to
                return True
            if how == "slash":
                self.send_response(308)
                self.send_header("Location", to)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return False
            self._send(401, PRIVATE, "text/html; charset=utf-8")
            return False

        def _place(self, q):
            return places.get((q.get("place") or [""])[0]) or (places.kiosk() if q.get("kiosk") else places.first)

        def _body(self):
            """The request's JSON object; None if it isn't one, or is over MAX_BODY."""
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if not 0 <= n <= MAX_BODY:
                    return None
                body = json.loads(self.rfile.read(n) or b"{}")
                return body if isinstance(body, dict) else None
            except ValueError:
                return None

        def _foreign(self):
            """Was this request made by another site's page? Screens need no login, so without this
            any web page open on the home network could change places here (CSRF). Judged by
            Origin: CloudWall's own page names this server; a script or curl names none."""
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                return True
            origin = self.headers.get("Origin")
            if not origin:
                return False
            ours = {self.headers.get("Host"), self.headers.get("X-Forwarded-Host")}     # X-Forwarded-Host: its name behind a proxy
            return urlsplit(origin).netloc not in ours

        def do_GET(self):
            if not self._admitted() or self._admin("GET"):
                return
            path = self.path.split("?")[0]
            if path in ("/receiver", "/coverage"):          # the pages want their closing slash
                return self._redirect(path.lstrip("/") + "/")
            if path.startswith(("/receiver/", "/coverage/")):
                if srv.admin is None:
                    return self._send(404, {"error": "not found"})
                return srv.admin.relay(self, path)
            q = parse_qs(urlsplit(self.path).query)
            if path == "/api/locate":
                return self._locate((q.get("q") or [""])[0])
            place = self._place(q)
            if path == "/api/state":
                try:
                    nm = int(q.get("range", ["0"])[0])
                except ValueError:
                    nm = 0
                pin = q.get("pin", [None])[0]
                try:
                    reach = float(q.get("reach", ["1"])[0])              # how much further the Map view's corners reach
                except ValueError:
                    reach = 1.0
                reach = reach if reach == reach else 1.0                 # not NaN
                return self._send(200, dict(place.state(pin, nm, q.get("square") == ["1"], reach), **display, api=API,
                                            places=places.summaries(), restart=code_changed(), started=started,
                                            health=srv.watch.monitor.summary() if srv.watch else QUIET))
            if path == "/api/health":
                return self._send(200, srv.watch.report() if srv.watch else dict(QUIET, open=[], findings=[]))
            if path == "/api/weather":
                return self._send(200, place.weather_report())
            if path == "/api/heat":
                return self._send(200, place.heatmap())
            if path == "/api/logbook":
                return self._send(200, place.logbook())
            if path == "/api/type":
                code = (q.get("type") or [""])[0].strip().upper()
                hexid = (q.get("hex") or [""])[0].strip().lower()
                if not about.CODE.match(code):
                    return self._send(400, {"error": "type must be an ICAO type designator, such as B39M"})
                return self._send(200, place.about_type(code, hexid if re.fullmatch(r"[0-9a-f]{1,8}", hexid) else None))
            if path.startswith("/tiles/"):
                return self._tile(path)
            if path.startswith("/logos/"):
                data = logos.get(path[7:].upper()) if logos else None
                if not data:
                    return self._send(404, {"error": "no logo"})
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=604800")
                self.end_headers()
                return self.wfile.write(data)
            if path in ("/kiosk/", "/admin/"):
                # with the slash the page's relative addresses would break; redirect relatively, so it
                # works under /k/<key>/ and behind a proxy too
                return self._redirect("../" + path.strip("/"))
            if path.rstrip("/") == "/kiosk":
                path = "/index.html"                  # same page; the script switches to kiosk mode
            elif path.rstrip("/") == "/admin":
                path = "/admin.html"
            try:
                f = (WEB / (path.lstrip("/") or "index.html")).resolve()
                found = WEB in f.parents and f.is_file()
            except (OSError, ValueError):             # a name too long, or with a NUL in it
                found = False
            if not found:
                return self._send(404, {"error": "not found"})
            # The page's own files: kept by the browser but asked about each time (no-cache), so a
            # reload costs a 304 per file, not the file; text is sent gzipped (a third the size).
            st = f.stat()
            tag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            small = ctype.startswith("text/") or ctype.split(";")[0] in ("application/json", "image/svg+xml", "application/javascript")
            zipped = small and "gzip" in (self.headers.get("Accept-Encoding") or "")
            self.send_response(304 if self.headers.get("If-None-Match") == tag else 200)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-cache")
            if small:
                self.send_header("Vary", "Accept-Encoding")
            if self.headers.get("If-None-Match") == tag:
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            body = _static(f, tag, zipped)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            if zipped:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(body)

        def _locate(self, text):
            """Where a typed ZIP code or pair of coordinates is, and the airline airports near it."""
            loc = airports.locate(text)
            if not loc:
                return self._send(400, {"error": "Type a US ZIP code (98683) or coordinates (45.63, -122.66)"})
            near = airports.airline_nearby(loc["lat"], loc["lon"])
            return self._send(200, dict(loc, auto=airports.pick_airport(loc["lat"], loc["lon"]), airports=[
                {k: a[k] for k in ("icao", "iata", "name", "city", "size", "dist_nm")} for a in near]))

        def _tile(self, path):
            """/tiles/<layer>/z/x/y for a chart layer, or /tiles/z/x/y for the radar's map."""
            parts = path.split("/")[2:]
            layer = parts.pop(0) if len(parts) == 4 else "map"
            if not charts or len(parts) != 3 or not all(p.isdigit() for p in parts):
                return self._send(404, {"error": "no such tile"})
            got = charts.get(layer, *map(int, parts))
            if not got:
                return self._send(404, {"error": "no such tile"})
            data, ctype = got
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=604800")
            self.end_headers()
            self.wfile.write(data)

        def end_headers(self):
            super().end_headers()
            if self.command == "HEAD":                # headers only: discard the body
                self.wfile = _Nowhere()

        def do_HEAD(self):
            real = self.wfile
            try:
                self.do_GET()
            finally:
                self.wfile = real

        def do_POST(self):
            if not self._admitted() or self._admin("POST"):
                return
            path = self.path.split("?")[0]
            if path != "/api/places":
                return self._send(404, {"error": "not found"})
            if self._foreign():
                return self._send(403, {"error": "Places can only be changed from CloudWall's own page"})
            if srv.admin is not None and not srv.admin.may_change(self):
                return self._send(403, {"error": "Only the owner can set up places: sign in on the control board (/admin)"})
            body = self._body()
            if body is None:
                return self._send(400, {"error": "bad json"})
            loc = airports.locate(body.get("q") or "")
            if not loc:
                return self._send(400, {"error": "Type a US ZIP code (98683) or coordinates (45.63, -122.66)"})
            try:
                place = places.add({"name": str(body.get("name") or "").strip()[:40], **loc,
                                    "airport": str(body.get("airport") or "auto").strip()})
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"place": place.summary()})

        def do_DELETE(self):
            if not self._admitted() or self._admin("DELETE"):
                return
            q = parse_qs(urlsplit(self.path).query)
            if self.path.split("?")[0] != "/api/places":
                return self._send(404, {"error": "not found"})
            if self._foreign():
                return self._send(403, {"error": "Places can only be changed from CloudWall's own page"})
            if srv.admin is not None and not srv.admin.may_change(self):
                return self._send(403, {"error": "Only the owner can remove places: sign in on the control board (/admin)"})
            try:
                places.remove((q.get("id") or [""])[0])
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"places": places.summaries()})

    s = cfg["server"]
    srv = ThreadingHTTPServer((s["host"], s["port"]), Handler)
    srv.watch = None                    # app/watch.py's Watch, set by main
    srv.admin = None                    # app/admin.py's Admin, likewise
    srv.code_changed = code_changed
    return srv
