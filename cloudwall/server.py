"""HTTP server: JSON API plus the static touchscreen UI."""
import hashlib
import json
import logging
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import airports

CODE = Path(__file__).resolve().parent
WEB = CODE / "web"
CODE_CHECK_S = 60
MAX_BODY = 16 * 1024        # bytes: a place to set up is a few dozen
# The shape of what the API answers, as API.md sets it out. Raised when a key is taken away or
# comes to mean something else, so that anything else reading it can tell; adding a key doesn't.
API = 1
log = logging.getLogger("cloudwall")


def code_stamp():
    """A fingerprint of CloudWall's Python code as it is on disk now."""
    h = hashlib.sha1()
    for f in sorted(CODE.glob("*.py")):
        try:
            h.update(f.name.encode() + b"\0" + f.read_bytes())
        except OSError:
            pass
    return h.hexdigest()


class CodeWatch:
    """Has the code changed on disk since the server started? The pages are read from disk on
    each request but the Python only when the server starts, so after an update (git pull)
    without a restart, screens get the new pages from the old server, and whatever is new on
    both sides answers "not found". Screens are told (restart in /api/state) so they can say so.
    Checked at most once a minute, and only while a screen asks."""

    def __init__(self):
        self.started, self.checked, self.changed = code_stamp(), time.time(), False

    def __call__(self):
        if not self.changed and time.time() - self.checked >= CODE_CHECK_S:
            self.checked = time.time()
            if code_stamp() != self.started:
                self.changed = True
                log.warning("CloudWall's code has changed since it started: restart it to run the new version")
        return self.changed


def make_server(cfg, places, charts=None, logos=None):
    """places: a place.Places; all the server asks of a place is its state, weather report,
    heatmap and logbook. Each screen says which place it shows with ?place=; without one,
    the kiosk (?kiosk=1) gets its configured place and any other screen the first. Screens can
    also set up places (POST /api/places) and remove the ones they set up (DELETE)."""

    code_changed = CodeWatch()
    # what the displays may draw with, the same for every place: the radar's map, the chart layers, logos
    display = {"basemap": charts.map.info() if charts else None, "charts": charts.info() if charts else None,
               "logos": bool(logos and logos.enabled)}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _place(self, q):
            return places.get((q.get("place") or [""])[0]) or (places.kiosk() if q.get("kiosk") else places.first)

        def _body(self):
            """The request's JSON object; None if it isn't one, or is longer than any real one."""
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if not 0 <= n <= MAX_BODY:
                    return None
                body = json.loads(self.rfile.read(n) or b"{}")
                return body if isinstance(body, dict) else {}
            except ValueError:
                return None

        def _foreign(self):
            """Was this request made by a page from somewhere else? CloudWall has no logins, so
            without this any web page open in a browser on the home network could add or remove
            places here. A browser names the page's site in Origin on such requests; a page of
            CloudWall's own names this server, and a script or curl names none."""
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                return True
            origin = self.headers.get("Origin")
            if not origin:
                return False
            ours = {self.headers.get("Host"), self.headers.get("X-Forwarded-Host")}     # behind a proxy, the address it is known by
            return urlsplit(origin).netloc not in ours

        def do_GET(self):
            path = self.path.split("?")[0]
            q = parse_qs(urlsplit(self.path).query)
            if path == "/api/locate":
                return self._locate((q.get("q") or [""])[0])
            place = self._place(q)
            if path == "/api/state":
                try:
                    nm = int(q.get("range", ["0"])[0])                   # the radar's range on this screen
                except ValueError:
                    nm = 0
                pin = q.get("pin", [None])[0]                            # the flight this screen follows
                return self._send(200, dict(place.state(pin, nm, q.get("square") == ["1"]), **display, api=API,
                                            places=places.summaries(), restart=code_changed()))
            if path == "/api/weather":
                return self._send(200, place.weather_report())
            if path == "/api/heat":
                return self._send(200, place.heatmap())
            if path == "/api/logbook":
                return self._send(200, place.logbook())
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
            if path.rstrip("/") == "/kiosk":
                path = "/index.html"                  # same page; the script switches to kiosk mode
            f = (WEB / (path.lstrip("/") or "index.html")).resolve()
            if WEB not in f.parents or not f.is_file():
                return self._send(404, {"error": "not found"})
            self._send(200, f.read_bytes(),
                       mimetypes.guess_type(f.name)[0] or "application/octet-stream")

        def _locate(self, text):
            """Where a typed ZIP code or pair of coordinates is, and the airline airports near it,
            for a screen setting up a place."""
            loc = airports.locate(text)
            if not loc:
                return self._send(400, {"error": "Type a US ZIP code (98683) or coordinates (45.63, -122.66)"})
            near = airports.airline_nearby(loc["lat"], loc["lon"])
            return self._send(200, dict(loc, auto=airports.pick_airport(loc["lat"], loc["lon"]), airports=[
                {k: a[k] for k in ("icao", "iata", "name", "city", "size", "dist_nm")} for a in near]))

        def _tile(self, path):
            """/tiles/<layer>/z/x/y for a chart layer (charts.py), or /tiles/z/x/y for the radar's map."""
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

        def do_POST(self):
            path = self.path.split("?")[0]
            if path != "/api/places":
                return self._send(404, {"error": "not found"})
            if self._foreign():
                return self._send(403, {"error": "Places can only be changed from CloudWall's own page"})
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
            q = parse_qs(urlsplit(self.path).query)
            if self.path.split("?")[0] != "/api/places":
                return self._send(404, {"error": "not found"})
            if self._foreign():
                return self._send(403, {"error": "Places can only be changed from CloudWall's own page"})
            try:
                places.remove((q.get("id") or [""])[0])
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"places": places.summaries()})

    s = cfg["server"]
    return ThreadingHTTPServer((s["host"], s["port"]), Handler)
