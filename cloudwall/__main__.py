import argparse
import logging
from pathlib import Path

from . import config, demo, feeds, keys, placing, privatelink, __version__
from .flightaware import FlightAware
from .flightradar24 import Flightradar24
from .server import make_server
from .logos import Logos
from .place import AnyActivity, Place, Places
from .charts import Charts
from .tiles import keep_tidy
from .enrich import KINDS, Enricher
from .shared import Shared
from .db import another_places
from .store import Store

log = logging.getLogger("cloudwall")


def main():
    ap = argparse.ArgumentParser(prog="cloudwall", description="Flight board for the sky over your house")
    ap.add_argument("--config", help="path to config.toml (default: ./config.toml if present)")
    ap.add_argument("--demo", action="store_true", help="simulated traffic, no network needed")
    ap.add_argument("--host", help="address to listen on (default 0.0.0.0)")
    ap.add_argument("--port", type=int, help="port to listen on (default 5050)")
    ap.add_argument("--db", help="override the logbook database path")
    ap.add_argument("--new-key", action="store_true",
                    help="print a fresh key for a private link and exit (--private-link sets one up for you)")
    ap.add_argument("--private-link", nargs="?", const="", choices=["", "new", "show", "off", "url"], metavar="new|show|off",
                    help="set up a private link, to reach CloudWall from outside the house: makes a key and writes it "
                         "into the config file, restarts the service if it runs as one, and prints the links to open "
                         "(with no word: shows the link if there is one, makes one if not). new: a fresh key, ending "
                         "the old link; off: open again, as on a home network")
    ap.add_argument("--init-config", action="store_true",
                    help="write a starter config file (to --config, or the user config dir) and exit")
    ap.add_argument("--version", action="version", version=f"cloudwall {__version__}")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    if args.new_key:
        key = keys.new_key()
        print(f'{key}\n\nPut it in the config file, under [server]:\n\n    key = "{key}"\n\n'
              f"and restart CloudWall. It then answers only at  <its address>/k/{key}/  (the wall panel at\n"
              f".../k/{key}/kiosk): open that once on each screen and keep it as a bookmark or favourite.\n"
              f"(`cloudwall --private-link` does all of that for you.)")
        return
    if args.private_link is not None:
        privatelink.private_link(args.config, args.private_link)
        return
    if args.init_config:
        path, created = config.init(args.config)
        print(f"{'Wrote' if created else 'Already exists, left unchanged:'} {path}")
        return

    try:
        cfg = config.load(args.config)
    except ValueError as e:                # a mistake in the file (TOML's own errors are ValueErrors too)
        raise SystemExit(f"cloudwall: {config.find(args.config)}: {e}")
    if args.host:
        cfg["server"]["host"] = args.host
    if args.port:
        cfg["server"]["port"] = args.port
    try:
        place_cfgs = placing.places(cfg)
    except ValueError as e:
        raise SystemExit(f"cloudwall: {e}")
    db = args.db or (":memory:" if args.demo else cfg["storage"]["db_path"] or config.default_db_path())
    if db != ":memory:":
        Path(db).expanduser().parent.mkdir(parents=True, exist_ok=True)
        db = str(Path(db).expanduser())

    first_id = place_cfgs[0]["place"]["id"]

    def db_for(pid):
        """The first place keeps the logbook it always had; each other place gets its own beside it."""
        if db == ":memory:" or pid == first_id:
            return db
        p = Path(db)
        return str(p.with_name(f"{p.stem}-{pid}{p.suffix or '.db'}"))

    store0 = Store(db_for(first_id))
    tiles_dir = (Path(db).parent if db != ":memory:" else config.default_db_path().parent) / "tiles"
    charts = Charts(cfg, tiles_dir)   # the radar's map and the FAA charts
    keep_tidy(tiles_dir, cfg["map"]["cache_mb"])
    logos = Logos(cfg, tiles_dir.parent / "logos")
    # What every place shares, kept in the first place's file: one paid provider with one budget,
    # and one lookup of each route, airframe and photo, whichever places see the flight.
    providers = [Flightradar24(cfg, store0), FlightAware(cfg, store0)]
    fa = next((p for p in providers if p.enabled), None)    # first one with a key wins
    shared = Shared(Enricher(store0, demo=demo.Demo() if args.demo else None, live=fa))
    named = len(place_cfgs) > 1 or not args.demo   # place names in the log, once there may be several

    def make_place(pc):
        pid = pc["place"]["id"]
        store = store0 if pid == first_id else Store(db_for(pid))
        store.claim(pc["home"])            # this logbook is this place's
        if store is not store0:
            store.forget(KINDS)            # lookups from when each place kept its own
        src = cfg["source"]
        if args.demo:
            source = demo.Demo()
        elif src.get("merge") and len(src["urls"]) > 1:     # your receiver and the public feeds together
            source = feeds.Merged(src["urls"])
        else:
            source = feeds.Feeds(src["urls"])
        return Place(pc, store, source, shared, demo=args.demo, named=named)

    # places set up from a screen are kept beside the logbook (not in demo mode); a new one never
    # gets an id whose logbook file, left by a removed place, is somewhere else's
    places = Places(cfg, make_place, None if db == ":memory:" else Path(db).with_name("places.json"),
                    elsewhere=lambda pid, home: db != ":memory:" and another_places(db_for(pid), home))
    for pc in place_cfgs:
        places.add_config(pc)
    places.load_saved()

    def map_around_every_place():
        charts.homes = [p.cfg["home"] for p in places]
    map_around_every_place()
    places.on_change = map_around_every_place
    for place in places:
        if not place.added:            # (saved ones started as they were added)
            place.start()
    if fa:
        fa.start(AnyActivity(places))      # e.g. Flightradar24's hourly usage check, which waits for a screen
    server = make_server(cfg, places, charts, logos)
    log.info("CloudWall %s on http://%s:%s (source: %s)", __version__, cfg["server"]["host"], cfg["server"]["port"],
             places.first.source.name)
    for place in places:
        log.info("place %s: %s, airport %s | logbook: %s", place.id, place.name, place.cfg["airport"]["icao"],
                 db_for(place.id))
    if fa and not args.demo:
        b = fa.budget()
        log.info("live routes: %s (%s mode) - %s", fa.label, fa.mode,
                 f"{b['period_used']} of {b['period_budget']} {fa.unit} used this billing period "
                 f"({fa.margin:.0%} of {fa.monthly_limit} held back), today's allowance {b['daily_limit']}"
                 if b["period_budget"] is not None else f"up to {b['daily_limit']} {fa.unit} a day")
    else:
        log.info("live routes: off (free route database only)")
    log.info("radar map: %s; ATC radar chart: %s (cached in %s)", charts.map.style if charts.map.enabled else "off",
             charts.atc.style if charts.atc else "off", tiles_dir)
    log.info("config: %s", cfg["_path"] or "built-in defaults")
    if cfg["server"]["key"]:
        # the key itself is not logged: logs are read by more people and kept longer than the config
        log.info("private link: answering only under /k/<key>/ (cloudwall --private-link show prints the links)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
