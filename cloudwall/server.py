"""HTTP server: JSON API plus the static touchscreen UI."""
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import airports

WEB = Path(__file__).resolve().parent / "web"


def make_server(cfg, places, charts=None, logos=None):
    """places: a place.Places. Each screen says which place it shows with ?place=; without one,
    the kiosk (?kiosk=1) gets its configured place and any other screen the first. Screens can
    also set up places (POST /api/places) and remove the ones they set up (DELETE)."""

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
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
                return body if isinstance(body, dict) else {}
            except ValueError:
                return None

        def do_GET(self):
            path = self.path.split("?")[0]
            q = parse_qs(urlsplit(self.path).query)
            if path == "/api/locate":
                return self._locate((q.get("q") or [""])[0])
            place = self._place(q)
            tracker = place.tracker
            if path in ("/api/state", "/api/weather"):
                place.activity.touch()                # a screen is showing this place
            if path == "/api/state":
                try:
                    tracker.want_range(int(q.get("range", ["0"])[0]), q.get("square") == ["1"])   # the radar's range on this screen
                except ValueError:
                    pass
                pin = q.get("pin", [None])[0]                            # the flight this screen follows
                tracker.want_pin(pin)
                return self._send(200, dict(tracker.snapshot(pin), place=place.id, places=places.summaries()))
            if path == "/api/weather":
                return self._send(200, dict(tracker.weather_full or {}, contrails=tracker.contrails,
                                            tfrs=tracker.tfrs))
            if path == "/api/heat":
                return self._send(200, tracker.heatmap())
            if path == "/api/logbook":
                return self._send(200, place.store.logbook(time.strftime("%Y-%m-%d")))
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
            try:
                places.remove((q.get("id") or [""])[0])
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"places": places.summaries()})

    s = cfg["server"]
    return ThreadingHTTPServer((s["host"], s["port"]), Handler)
