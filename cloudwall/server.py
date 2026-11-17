"""HTTP server: JSON API plus the static touchscreen UI."""
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

WEB = Path(__file__).resolve().parent / "web"


def make_server(cfg, tracker, store, tiles=None, logos=None, activity=None):
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

        def do_GET(self):
            path = self.path.split("?")[0]
            if activity and path in ("/api/state", "/api/weather"):
                activity.touch()                      # a screen is open
            if path == "/api/state":
                q = parse_qs(urlsplit(self.path).query)
                try:
                    tracker.want_range(int(q.get("range", ["0"])[0]))   # the radar's range on this screen
                except ValueError:
                    pass
                return self._send(200, tracker.snapshot())
            if path == "/api/weather":
                return self._send(200, dict(tracker.weather_full or {}, contrails=tracker.contrails,
                                            tfrs=tracker.tfrs))
            if path == "/api/heat":
                return self._send(200, tracker.heatmap())
            if path == "/api/logbook":
                return self._send(200, store.logbook(time.strftime("%Y-%m-%d")))
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

        def _tile(self, path):
            parts = path.split("/")[2:]
            if not tiles or len(parts) != 3 or not all(p.isdigit() for p in parts):
                return self._send(404, {"error": "no such tile"})
            got = tiles.get(*map(int, parts))
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
            if self.path != "/api/pin":
                return self._send(404, {"error": "not found"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad json"})
            hexid = body.get("hex")
            tracker.pin(hexid if isinstance(hexid, str) else None)
            self._send(200, {"pinned": tracker.pinned})

    s = cfg["server"]
    return ThreadingHTTPServer((s["host"], s["port"]), Handler)
