import argparse
import logging
import time
from pathlib import Path

from . import __version__, access, caddy, config, sources
from .flightaware import FlightAware
from .flightradar24 import Flightradar24
from .server import make_server
from .logos import Logos
from .place import AnyActivity, Place, Places
from .charts import Charts
from .enrich import KINDS, Enricher
from .shared import Shared
from .store import Store, another_places

log = logging.getLogger("cloudwall")


def private_link(path, what):
    """`cloudwall --private-link [new|show|off|url]`: the private link set up, shown or taken away,
    without editing the config file by hand. `url` prints only the wall panel's own address on this
    machine (deploy/kiosk.sh asks for it)."""
    try:
        cfg = config.load(path)
    except ValueError as e:
        raise SystemExit(f"cloudwall: {config.find(path)}: {e}")
    key, port, host, address = (cfg["server"][k] for k in ("key", "port", "host", "address"))
    if what == "url":
        print(f"http://localhost:{port}" + (f"/k/{key}" if key else ""))
        return
    file = config.find(path)
    if what == "off" and key and address:
        raise SystemExit(f"cloudwall: CloudWall is on the internet at https://{address}/ with its key as its only password "
                         f"(cloudwall --public), so taking the key away would open it to everyone. Put a password back on "
                         f"{address} in Caddy and take `address` out of the config's [server] first.")
    if what in ("new", "off") or (what == "" and not key):
        if file is None:                         # no config file yet: start one from the example
            file, _ = config.init(path)
        key = access.new_key() if what != "off" else ""
        try:
            access.write_key(file, key)
        except (OSError, ValueError) as e:
            raise SystemExit(f"cloudwall: {e}")
        print(f"{'Private link made' if key else 'Private link taken away'}: [server] key in {file} "
              f"{'set to ' + key if key else 'cleared'}.")
        restarted = access.restart_service()
        print("CloudWall's service restarted, so it takes effect now." if restarted
              else "Restart CloudWall (make restart, or stop and start it) for it to take effect." if restarted is False
              else "Restart CloudWall for it to take effect.")
        if key and what == "new":
            print("Any link made before stops working: open the new one on each screen.")
    if not key:
        print("\nCloudWall is open to whoever can reach it, as on a home network:")
    else:
        print(f"\nCloudWall answers only under /k/{key}/: the key is its password, carried in the address.\n"
              "Keep the whole link as a bookmark or favourite on each screen and open it from there (the key\n"
              "works typed with or without its hyphens):")
    for label, url in access.links(key, host, port, address):
        if key or not label.startswith("From outside"):
            print(f"  {label + ':':<38} {url}")
    if key and not address:
        print("\nThe wall panel started by deploy/kiosk.sh finds the key by itself.")


def public(path, name):
    """`cloudwall --public <name>`: CloudWall at https://<name>/k/<key>/ through the Caddy on this
    machine, with nothing to type but the link. It makes the key if there isn't one, has CloudWall
    listen only on this machine when Caddy is all that reaches it, restarts it, and only once
    CloudWall is known to be keeping itself private takes Caddy's own password (basic_auth) away;
    then it checks the link from the internet and prints it."""
    try:
        cfg = config.load(path)
    except ValueError as e:
        raise SystemExit(f"cloudwall: {config.find(path)}: {e}")
    name = (name or cfg["server"]["address"]).strip().lower()
    if not name:
        raise SystemExit("cloudwall --public: say which name it's reached by: cloudwall --public cloudwall.example.com")
    try:
        config.check("server", {"address": name})
    except ValueError as e:
        raise SystemExit(f"cloudwall --public: {e}")
    port, key = cfg["server"]["port"], cfg["server"]["key"]
    try:
        text = caddy.CADDYFILE.read_text()
    except PermissionError:
        r = caddy.run(access.as_root(["cat", str(caddy.CADDYFILE)]))
        if r.returncode:
            raise SystemExit(f"cloudwall --public: couldn't read {caddy.CADDYFILE}: {r.stderr.strip()}")
        text = r.stdout
    except FileNotFoundError:
        raise SystemExit(f"cloudwall --public: there's no {caddy.CADDYFILE}: install Caddy first "
                         "(https://caddyserver.com/docs/install), then run this again.")
    try:
        plan = caddy.plan(text, name, port)
    except ValueError as e:
        raise SystemExit(f"cloudwall --public: {e}")

    # 1. CloudWall: its key, its name, and nowhere to be reached but through Caddy
    file = config.find(path) or config.init(path)[0]
    key = key or access.new_key()
    try:
        access.write_key(file, key)
        access.write_setting(file, "server", "address", name)
        if plan.local:
            access.write_setting(file, "server", "host", "127.0.0.1")
    except (OSError, ValueError) as e:
        raise SystemExit(f"cloudwall: {e}")
    print(f"CloudWall's config ({file}): its key is {key}, its address {name}"
          + (", and it listens only on this machine, for Caddy." if plan.local else "."))
    restarted = access.restart_service()
    print("CloudWall restarted." if restarted else "CloudWall isn't running as a service here, so it wasn't restarted.")

    # 2. Caddy's password comes off only once CloudWall answers nothing without the key
    status = None
    for _ in range(20):
        try:
            status = caddy.fetch(f"http://127.0.0.1:{port}/api/state", timeout=3)[0]
            if status == 401:
                break
        except OSError:
            pass
        time.sleep(1)
    if status != 401:
        why = ("still answers without the key" if status else "isn't answering")
        raise SystemExit(f"\nCloudWall on port {port} {why}, so Caddy's password stays on for now. Restart CloudWall "
                         f"(with its new config), then run this again.")
    if plan.changed:
        try:
            kept = caddy.install(caddy.CADDYFILE, plan.text)
        except RuntimeError as e:
            raise SystemExit(f"cloudwall --public: {e}")
        did = (f"took its password off {name} (commented out, with a note)" if plan.removed
               else f"now serves {name}, over HTTPS with a certificate of its own")
        print(f"Caddy {did}, and reloaded. Its Caddyfile as it was is kept at {kept}.")
    else:
        print(f"Caddy already serves {name} with nothing of its own to ask: left as it was.")

    # 3. The link, tried as the car will open it
    ok, said = caddy.check(name, key)
    print(("\n" if ok else "\nNot working yet: ") + said)
    print("\nBookmark this on each screen (on a Tesla, type it once into the browser and add it to Favourites):\n")
    for label, url in access.links(key, "", port, name):
        print(f"  {label + ':':<38} {url}")
    print("\nAnyone with the link has CloudWall. To end it and make a new one: cloudwall --private-link new")
    if not ok:
        raise SystemExit(1)


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
    ap.add_argument("--public", nargs="?", const="", metavar="NAME",
                    help="put CloudWall on the internet at https://NAME/k/<key>/ through the Caddy on this machine: "
                         "makes the key, takes Caddy's own password off NAME (CloudWall's key does its job), "
                         "checks the link and prints it. NAME's DNS must point here, with ports 80 and 443 open")
    ap.add_argument("--init-config", action="store_true",
                    help="write a starter config file (to --config, or the user config dir) and exit")
    ap.add_argument("--version", action="version", version=f"cloudwall {__version__}")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    if args.new_key:
        key = access.new_key()
        print(f'{key}\n\nPut it in the config file, under [server]:\n\n    key = "{key}"\n\n'
              f"and restart CloudWall. It then answers only at  <its address>/k/{key}/  (the wall panel at\n"
              f".../k/{key}/kiosk): open that once on each screen and keep it as a bookmark or favourite.\n"
              f"(`cloudwall --private-link` does all of that for you.)")
        return
    if args.public is not None:
        public(args.config, args.public)
        return
    if args.private_link is not None:
        private_link(args.config, args.private_link)
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
        place_cfgs = config.places(cfg)
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
    logos = Logos(cfg, tiles_dir.parent / "logos")
    # What every place shares, kept in the first place's file: one paid provider with one budget,
    # and one lookup of each route, airframe and photo, whichever places see the flight.
    providers = [Flightradar24(cfg, store0), FlightAware(cfg, store0)]
    fa = next((p for p in providers if p.enabled), None)    # first one with a key wins
    shared = Shared(Enricher(store0, demo=sources.Demo() if args.demo else None, live=fa))
    named = len(place_cfgs) > 1 or not args.demo   # place names in the log, once there may be several

    def make_place(pc):
        pid = pc["place"]["id"]
        store = store0 if pid == first_id else Store(db_for(pid))
        store.claim(pc["home"])            # this logbook is this place's
        if store is not store0:
            store.forget(KINDS)            # lookups from when each place kept its own
        source = sources.Demo() if args.demo else sources.Feeds(cfg["source"]["urls"])
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
        log.info("private: answering only under /k/%s/ (the wall panel at /k/%s/kiosk)", cfg["server"]["key"], cfg["server"]["key"])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
