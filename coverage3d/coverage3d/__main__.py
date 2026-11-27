"""Command line: python -m coverage3d [--config FILE] [--demo] [--import PATH ...]"""
from __future__ import annotations

import argparse
import logging
import signal
import socket
import sys
import threading

from . import __version__, config as config_mod, demo as demo_mod, importer
from .feeds import ReadsbFeed
from .sampler import Sampler
from .server import App, serve
from .store import Store

log = logging.getLogger("coverage3d")


def port_in_use(bind, port) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1" if bind in ("0.0.0.0", "") else bind, port)) == 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="coverage3d", description=__doc__)
    ap.add_argument("--config", default="/etc/coverage3d/config.toml")
    ap.add_argument("--db", help="override storage.db_path")
    ap.add_argument("--port", type=int, help="override server.port")
    ap.add_argument("--bind", help="override server.bind")
    ap.add_argument("--demo", action="store_true",
                    help="synthetic traffic and a throw-away demo database (never touches the real one)")
    ap.add_argument("--import", dest="imports", nargs="+", metavar="PATH",
                    help="back-fill from history files or directories, then exit")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--version", action="version", version=__version__)
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")      # journald adds timestamps
    cfg = config_mod.load(a.config)
    if a.db:
        cfg.storage["db_path"] = a.db
    if a.port:
        cfg.server["port"] = a.port
    if a.bind:
        cfg.server["bind"] = a.bind
    if a.demo and not a.db:
        cfg.storage["db_path"] = "coverage3d-demo.db"
        if not a.bind:
            cfg.server["bind"] = "127.0.0.1"

    store = Store(cfg.storage["db_path"])

    if a.imports:
        from .station import build_station
        feed = ReadsbFeed(cfg.sources[0].name, cfg.sources[0].band, cfg.sources[0].urls, cfg.sources[0].files)
        try:
            rec = feed.receiver()
        except Exception:
            rec = None
        print(importer.import_files(cfg, store, build_station(cfg, rec), a.imports, cfg.sources[0].band))
        return 0

    if not a.demo and port_in_use(cfg.server["bind"], int(cfg.server["port"])):
        log.error("port %s is already in use (check with: ss -ltn); set server.port in the config",
                  cfg.server["port"])
        return 2

    if a.demo:
        from .station import Station
        st = Station(cfg.station["lat"], cfg.station["lon"], cfg.station["ground_elevation_m"],
                     cfg.station["antenna_height_m"], "demo")
        feeds = [demo_mod.DemoFeed(st)]
        if not store.total_points():
            log.info("demo: generating synthetic history (about a minute)...")
            n = demo_mod.fill_database(cfg, store, st)
            store.aggregate_days(cfg.coverage["sector_deg"], cfg.coverage["band_ft"], cfg.coverage["max_alt_ft"])
            log.info("demo: %d synthetic points written to %s", n, cfg.storage["db_path"])
        cfg.station["position_source"] = "config"
    else:
        feeds = [ReadsbFeed(s.name, s.band, s.urls, s.files, cfg.sampler["http_timeout_s"]) for s in cfg.sources]

    sampler = Sampler(cfg, store, feeds)
    if not a.demo:
        res = importer.backfill_on_first_start(cfg, store, sampler.station)
        if res:
            log.info("first start: back-filled from tar1090 history: %s", res)
    app = App(cfg, store, sampler, feeds, demo=a.demo)
    srv = serve(app)
    sampler.start()

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    threading.Thread(target=srv.serve_forever, name="http", daemon=True).start()
    log.info("Coverage3D %s serving http://%s:%s/  (db %s%s)", __version__, cfg.server["bind"],
             cfg.server["port"], cfg.storage["db_path"], ", DEMO" if a.demo else "")
    stop.wait()
    log.info("shutting down")
    srv.shutdown()
    sampler.stop()
    sampler.join(10)
    return 0


if __name__ == "__main__":
    sys.exit(main())
