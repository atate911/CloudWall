import argparse
import logging
import threading
import time

from pathlib import Path

from . import __version__, config, sources, weather
from .enrich import Enricher
from .flightaware import FlightAware
from .flightradar24 import Flightradar24
from .server import make_server
from .logos import Logos
from .tiles import Tiles
from .store import Store
from .tracker import Tracker

log = logging.getLogger("cloudwall")


def main():
    ap = argparse.ArgumentParser(prog="cloudwall", description="Flight board for the sky over your house")
    ap.add_argument("--config", help="path to config.toml (default: ./config.toml if present)")
    ap.add_argument("--demo", action="store_true", help="simulated traffic, no network needed")
    ap.add_argument("--host", help="address to listen on (default 0.0.0.0)")
    ap.add_argument("--port", type=int, help="port to listen on (default 5050)")
    ap.add_argument("--db", help="override the logbook database path")
    ap.add_argument("--init-config", action="store_true",
                    help="write a starter config file (to --config, or the user config dir) and exit")
    ap.add_argument("--version", action="version", version=f"cloudwall {__version__}")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    if args.init_config:
        path, created = config.init(args.config)
        print(f"{'Wrote' if created else 'Already exists, left unchanged:'} {path}")
        return

    cfg = config.load(args.config)
    if args.host:
        cfg["server"]["host"] = args.host
    if args.port:
        cfg["server"]["port"] = args.port
    db = args.db or (":memory:" if args.demo else cfg["storage"]["db_path"] or config.default_db_path())
    if db != ":memory:":
        Path(db).expanduser().parent.mkdir(parents=True, exist_ok=True)
        db = str(Path(db).expanduser())
    store = Store(db)
    source = sources.Demo() if args.demo else sources.Feeds(cfg["source"]["urls"])
    tiles_dir = (Path(db).parent if db != ":memory:" else config.default_db_path().parent) / "tiles"
    tiles = Tiles(cfg, tiles_dir)
    logos = Logos(cfg, tiles_dir.parent / "logos")
    providers = [Flightradar24(cfg, store), FlightAware(cfg, store)]
    fa = next((p for p in providers if p.enabled), None)    # first one with a key wins
    tracker = Tracker(cfg, store, Enricher(store, demo=source if args.demo else None, live=fa))
    tracker.basemap = tiles.info()
    tracker.logos = logos.enabled
    home, trk = cfg["home"], cfg["tracking"]

    def poll():
        while True:
            try:
                tracker.update(source.fetch(home["lat"], home["lon"], trk["radius_nm"]), source.name)
            except Exception as e:
                log.warning("no position feed is answering (last error: %s)", e)
                tracker.failed(source.name, e)
            time.sleep(1 if args.demo else trk["poll_seconds"])

    def wx():
        while True:
            try:
                short, full = weather.fetch_all(cfg["airport"]["icao"])
                if short:
                    tracker.weather, tracker.weather_full = short, full
            except Exception as e:
                log.warning("weather fetch failed: %s", e)
            time.sleep(300)

    threading.Thread(target=poll, daemon=True).start()
    if not args.demo:
        threading.Thread(target=wx, daemon=True).start()
    else:
        tracker.weather, tracker.weather_full = weather.demo()
    server = make_server(cfg, tracker, store, tiles, logos)
    log.info("CloudWall %s on http://%s:%s (source: %s)", __version__, cfg["server"]["host"], cfg["server"]["port"], source.name)
    if fa and not args.demo:
        b = fa.budget()
        log.info("live routes: %s (%s mode) - %s", fa.label, fa.mode,
                 f"{b['period_used']} of {b['period_budget']} {fa.unit} used this billing period "
                 f"({fa.margin:.0%} of {fa.monthly_limit} held back), today's allowance {b['daily_limit']}"
                 if b["period_budget"] is not None else f"up to {b['daily_limit']} {fa.unit} a day")
    else:
        log.info("live routes: off (free route database only)")
    log.info("radar map: %s", f"{tiles.style} (cached in {tiles.dir})" if tiles.enabled else "off")
    log.info("config: %s | logbook: %s", cfg["_path"] or "built-in defaults", db)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
