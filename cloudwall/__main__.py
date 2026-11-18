import argparse
import logging
from pathlib import Path

from . import __version__, config, sources
from .flightaware import FlightAware
from .flightradar24 import Flightradar24
from .server import make_server
from .logos import Logos
from .place import AnyActivity, Place
from .tiles import Tiles
from .store import Store

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
    try:
        place_cfgs = config.places(cfg)
    except ValueError as e:
        raise SystemExit(f"cloudwall: {e}")
    db = args.db or (":memory:" if args.demo else cfg["storage"]["db_path"] or config.default_db_path())
    if db != ":memory:":
        Path(db).expanduser().parent.mkdir(parents=True, exist_ok=True)
        db = str(Path(db).expanduser())

    def db_for(i, pid):
        """The first place keeps the logbook it always had; each other place gets its own beside it."""
        if db == ":memory:" or i == 0:
            return db
        p = Path(db)
        return str(p.with_name(f"{p.stem}-{pid}{p.suffix or '.db'}"))

    stores = [Store(db_for(i, pc["place"]["id"])) for i, pc in enumerate(place_cfgs)]
    tiles_dir = (Path(db).parent if db != ":memory:" else config.default_db_path().parent) / "tiles"
    tiles = Tiles(cfg, tiles_dir)
    logos = Logos(cfg, tiles_dir.parent / "logos")
    # one paid provider and one budget for every place, counted in the first place's store
    providers = [Flightradar24(cfg, stores[0]), FlightAware(cfg, stores[0])]
    fa = next((p for p in providers if p.enabled), None)    # first one with a key wins
    places = {}
    for pc, store in zip(place_cfgs, stores):
        source = sources.Demo() if args.demo else sources.Feeds(cfg["source"]["urls"])
        place = Place(pc, store, source, live=fa, demo=args.demo, named=len(place_cfgs) > 1)
        place.tracker.basemap = tiles.info()
        place.tracker.logos = logos.enabled
        places[place.id] = place
    tiles.homes = [p.cfg["home"] for p in places.values()]     # the map is served around every place
    for place in places.values():
        place.start()
    for p in providers:
        p.activity = AnyActivity(places.values())   # e.g. Flightradar24's hourly usage check waits for a screen
    server = make_server(cfg, places, tiles, logos)
    first = next(iter(places.values()))
    log.info("CloudWall %s on http://%s:%s (source: %s)", __version__, cfg["server"]["host"], cfg["server"]["port"], first.source.name)
    for i, place in enumerate(places.values()):
        log.info("place %s: %s, airport %s | logbook: %s", place.id, place.name, place.cfg["airport"]["icao"],
                 db_for(i, place.id))
    if fa and not args.demo:
        b = fa.budget()
        log.info("live routes: %s (%s mode) - %s", fa.label, fa.mode,
                 f"{b['period_used']} of {b['period_budget']} {fa.unit} used this billing period "
                 f"({fa.margin:.0%} of {fa.monthly_limit} held back), today's allowance {b['daily_limit']}"
                 if b["period_budget"] is not None else f"up to {b['daily_limit']} {fa.unit} a day")
    else:
        log.info("live routes: off (free route database only)")
    log.info("radar map: %s", f"{tiles.style} (cached in {tiles.dir})" if tiles.enabled else "off")
    log.info("config: %s", cfg["_path"] or "built-in defaults")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
