"""Start-up: reads the settings, builds the stores, the shared services, a place for each place
watched and the HTTP server, and joins them together (`cloudwall`, `python3 -m cloudwall`)."""
import argparse
import logging
import os
import sys
import time
from pathlib import Path

from .. import __version__
from ..core import config, keys, logs
from ..gather import demo, feeds
from ..operate import cli, privatelink
from ..reference import placing
from ..gather.flightaware import FlightAware
from ..gather.flightradar24 import Flightradar24
from ..serve.server import make_server
from ..gather.logos import Logos
from .place import AnyActivity, Place, Places
from .admin import Admin
from .watch import Watch, sd_notify
from ..memory.incidents import Incidents
from ..gather.charts import Charts
from ..gather.tiles import keep_tidy
from ..gather.enrich import KINDS, Enricher
from ..gather.shared import Shared
from ..core.db import another_places
from ..memory.store import Store

log = logging.getLogger("cloudwall")


def load_settings(path):
    """The settings to run on: the file, or, when it can't be used (a mistake made while editing it,
    or a setting an update no longer takes), the last copy of it that started, said loudly in the
    log and by `cloudwall doctor`. Without a copy that worked, CloudWall stops with the mistake named.
    (cfg, True if the copy is what is used)."""
    try:
        cfg = config.load(path)
        placing.places(cfg)                    # (a place it can't work out is a mistake in the file too)
        return cfg, False
    except (ValueError, OSError) as e:         # a mistake in the file (TOML's own errors are ValueErrors too)
        file = config.find(path)
        good = Path(f"{file}.good") if file else None
        if not good or not good.exists():
            raise SystemExit(f"cloudwall: {file}: {e}")
        cfg = config.load(good)
        cfg["_path"] = str(file)               # the file to mend is the one that can't be used, not the copy
        cfg["_problems"].insert(0, f"{file} can't be used ({e}): running on the last settings that started, {good}")
        log.error("config: %s", cfg["_problems"][0])
        return cfg, True


def keep_good(path):
    """A copy of a settings file that started, beside it, as <file>.good."""
    if not path:
        return
    try:
        p, good = Path(path), Path(f"{path}.good")
        if not good.exists() or good.read_bytes() != p.read_bytes():
            tmp = good.with_name(good.name + ".tmp")
            tmp.write_bytes(p.read_bytes())
            os.chmod(tmp, p.stat().st_mode & 0o770)
            tmp.replace(good)
    except OSError as e:
        log.info("config: couldn't keep a copy of the settings that started (%s)", e)


def main():
    if cli.is_command(sys.argv[1:]):          # cloudwall install | doctor | backup | ...
        cli.main(sys.argv[1:])
        return
    ap = argparse.ArgumentParser(prog="cloudwall", description="Flight board for the sky over your house",
                                 epilog="Setting up and looking after it: cloudwall {%s} --help" % ",".join(cli.COMMANDS))
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
    logs.attach()                          # the last few hundred lines, for the control board's Log page

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

    cfg, from_good = load_settings(args.config)
    # what the command line says wins over the file; the control board is told, so it doesn't take
    # the difference for a saved setting waiting for a restart
    if args.host:
        cfg["server"]["host"] = args.host
        cfg.setdefault("_cli", []).append("server.host")
    if args.port:
        cfg["server"]["port"] = args.port
        cfg.setdefault("_cli", []).append("server.port")
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
    tiles_dir = config.cache_dir(cfg, db) / "tiles"
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
    if not from_good and not args.demo:
        keep_good(cfg["_path"])            # these settings started: the ones to fall back on next time
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
    # CloudWall checking itself while it runs (app/watch.py), its incidents kept beside the logbooks
    incidents = Incidents(":memory:" if db == ":memory:" else str(Path(db).with_name("health.db")))
    incidents.close_all(time.time())
    watch = Watch(cfg, places, fa, demo=args.demo, code_changed=server.code_changed, incidents=incidents,
                  data_dir=None if db == ":memory:" else Path(db).parent, cache_dir=tiles_dir.parent)
    server.watch = watch
    server.admin = Admin(cfg, places, watch, store0, incidents, fa, charts, demo=args.demo)
    watch.start()
    sd_notify("READY=1")                   # (systemd's Type=notify: answering now)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
