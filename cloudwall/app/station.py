"""`cloudwall station`: a receiver's own state, for the wall. On the receiver (a Raspberry Pi with
its USB stick, its decoder and its feeders), it answers GET /station.json on 127.0.0.1:8095 with
what the machine says about itself (sense/station.py: power, temperature, clock, SD card, the
stick, the decoder, the feeders, the tunnel). The feed tunnel carries that port to the wall
(pi-tunnel.sh --station: the wall's 127.0.0.1:18095), whose control board shows it on the
Receiver page and whose health watcher judges it, so a weak power supply or a feeder that
dropped off reaches the Overview and the owner's phone.

It only reads, answers only on the receiver itself (the tunnel is how the wall reaches it), and
says nothing secret: no keys, no addresses. Installed by `sudo cloudwall install --role station`
as cloudwall-station.service.

`cloudwall station --check` says the same at a terminal, as findings (exit 2 when something has
failed); `--json` prints the facts.
"""
import argparse
import json
import logging
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .. import __version__
from ..core import health
from ..sense import station as sensed
from .watch import sd_notify

log = logging.getLogger("cloudwall.station")
CACHE_S = 15            # the facts are gathered at most this often, however often they're asked for


class Station:
    def __init__(self, gather=sensed.facts):
        self.gather = gather
        self.lock = threading.Lock()
        self.cached = (0, None)

    def facts(self):
        with self.lock:
            at, f = self.cached
            if f is None or time.time() - at > CACHE_S:
                f = self.gather()
                self.cached = (time.time(), f)
            return f


def make_server(host, port, station):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"CloudWallStation/{__version__}"

        def log_message(self, fmt, *args):
            log.debug("%s " + fmt, self.client_address[0], *args)

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/station.json":
                try:
                    return self._send(200, station.facts())
                except Exception as e:                 # a fact that failed in itself: said, not a crash
                    log.exception("gathering the receiver's state failed")
                    return self._send(500, {"error": str(e)})
            if path == "/healthz":
                return self._send(200, {"ok": True, "cloudwall": __version__})
            return self._send(404, {"error": "not found: /station.json"})

        def do_POST(self):
            self._send(405, {"error": "the station only reads"})

        do_PUT = do_DELETE = do_POST
    return ThreadingHTTPServer((host, port), Handler)


def main(argv):
    ap = argparse.ArgumentParser(prog="cloudwall station",
                                 description="This receiver's state (power, temperature, clock, SD card, USB stick, "
                                             "decoder, feeders, tunnel), for the wall's control board.")
    ap.add_argument("--check", action="store_true", help="say how this receiver stands, and exit")
    ap.add_argument("--json", action="store_true", help="print what the station reports, and exit")
    ap.add_argument("--host", default="127.0.0.1", help="where to answer (default: this machine only; the tunnel carries it)")
    ap.add_argument("--port", type=int, default=sensed.PORT, help=f"(default {sensed.PORT})")
    args = ap.parse_args(argv)
    if args.json:
        print(json.dumps(sensed.facts(), indent=1))
        return
    if args.check:
        f = sensed.facts()
        found = sensed.findings(f) if sensed.is_receiver(f) else []
        if not found:
            print("Nothing to say: this doesn't look like a receiver (no stick, decoder or feeders found).")
            return
        print(health.render(found))
        worst = health.worst(found)
        print({"ok": "\nThe receiver is well.", "warn": "\nWorking, with something worth a look above.",
               "fail": "\nSomething above needs fixing."}.get(worst, ""))
        sys.exit(2 if worst == health.FAIL else 0)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    srv = make_server(args.host, args.port, Station())
    log.info("CloudWall station %s answering on http://%s:%d/station.json", __version__, args.host, args.port)
    sd_notify("READY=1")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
