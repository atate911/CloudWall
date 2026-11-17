import argparse
import logging
import threading
import time

from . import config, sources, weather
from .enrich import Enricher
from .server import make_server
from .store import Store
from .tracker import Tracker

log = logging.getLogger("cloudwall")


def main():
    ap = argparse.ArgumentParser(prog="cloudwall", description="Flight board for the sky over your house")
    ap.add_argument("--config", help="path to config.toml (default: ./config.toml if present)")
    ap.add_argument("--demo", action="store_true", help="simulated traffic, no network needed")
    ap.add_argument("--port", type=int)
    ap.add_argument("--db", help="override the logbook database path")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    cfg = config.load(args.config)
    if args.port:
        cfg["server"]["port"] = args.port
    db = args.db or (":memory:" if args.demo else cfg["storage"]["db_path"])
    store = Store(db)
    source = sources.Demo() if args.demo else sources.Readsb(cfg["source"]["url"], cfg["source"]["name"])
    tracker = Tracker(cfg, store, Enricher(store, demo=source if args.demo else None))
    home, trk = cfg["home"], cfg["tracking"]

    def poll():
        while True:
            try:
                tracker.update(source.fetch(home["lat"], home["lon"], trk["radius_nm"]), source.name)
            except Exception as e:
                log.warning("position fetch failed: %s", e)
                tracker.failed(source.name, e)
            time.sleep(1 if args.demo else trk["poll_seconds"])

    def wx():
        while True:
            try:
                tracker.weather = weather.fetch_metar(cfg["airport"]["icao"])
            except Exception as e:
                log.warning("weather fetch failed: %s", e)
            time.sleep(600)

    threading.Thread(target=poll, daemon=True).start()
    if not args.demo:
        threading.Thread(target=wx, daemon=True).start()
    server = make_server(cfg, tracker, store)
    log.info("CloudWall on http://%s:%s (source: %s)", cfg["server"]["host"], cfg["server"]["port"], source.name)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
