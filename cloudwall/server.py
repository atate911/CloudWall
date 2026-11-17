"""HTTP server: JSON API plus the static touchscreen UI."""
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"


def make_server(cfg, tracker, store, tiles=None):
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
            if path == "/api/state":
                return self._send(200, tracker.snapshot())
            if path == "/api/heat":
                return self._send(200, tracker.heatmap())
            if path == "/api/logbook":
                return self._send(200, store.logbook(time.strftime("%Y-%m-%d")))
            if path.startswith("/tiles/"):
                return self._tile(path)
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
