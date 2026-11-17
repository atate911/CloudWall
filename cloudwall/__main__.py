import argparse
import logging
import threading
import time

from pathlib import Path

from . import __version__, config, contrails, sources, tfr, weather
from .enrich import Enricher
from .flightaware import FlightAware
from .flightradar24 import Flightradar24
from .server import make_server
from .activity import Activity
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

    # Only use the data services while a screen is open: "pause" stops all requests when
    # nobody is looking; "log" keeps checking the free position feed slowly so the logbook
    # stays complete, but still makes no paid route lookups and fetches no weather.
    when_idle = str(trk.get("when_idle", "pause")).lower()
    activity = Activity(int(trk.get("idle_after_seconds", 90)))
    if args.demo:
        activity.idle = lambda: False      # demo traffic costs nothing

    def poll():
        paused = False
        while True:
            idle = activity.idle()
            if idle and when_idle == "pause":
                if not paused:
                    log.info("no screen open: pausing data requests until one asks again")
                    paused = True
                activity.sleep(60)
                continue
            if paused:
                log.info("screen open: resuming data requests")
                paused = False
            tracker.idle = idle
            try:
                # out to the tracking radius, or further while a screen shows the radar at a longer range
                tracker.update(source.fetch(home["lat"], home["lon"], tracker.fetch_radius()), source.name)
            except Exception as e:
                log.warning("no position feed is answering (last error: %s)", e)
                tracker.failed(source.name, e)
            activity.sleep(1 if args.demo else max(trk["poll_seconds"], 15) if idle else trk["poll_seconds"])

    def wx():
        fetched = 0.0
        while True:
            if not activity.idle() and time.time() - fetched > 300:
                try:
                    short, full = weather.fetch_all(cfg["airport"]["icao"])
                    if short:
                        tracker.weather, tracker.weather_full = short, full
                    fetched = time.time()
                except Exception as e:
                    log.warning("weather fetch failed: %s", e)
                    fetched = time.time() - 240          # try again in a minute
            time.sleep(5)

    ex = cfg["extras"]
    tfrs = tfr.TFRs(cfg["home"], ex["tfr_radius_nm"])

    def extras():
        """Military jets heard without a position (every minute), flight restrictions
        (every 15 minutes) and the contrail forecast (hourly). Paused with no screen open."""
        jobs = [  # (enabled, every seconds, name, fetch, store)
            (ex["military"], 60, "military aircraft",
             lambda: sources.military_heard(cfg["home"], ex["military_radius_nm"], ex["military_url"]),
             lambda v: setattr(tracker, "heard", v)),
            (ex["tfr"], 900, "flight restrictions", tfrs.refresh, lambda v: setattr(tracker, "tfrs", v)),
            (ex["contrails"], 3600, "contrail forecast",
             lambda: contrails.fetch(cfg["home"]["lat"], cfg["home"]["lon"]), lambda v: setattr(tracker, "contrails", v)),
        ]
        due = [0.0] * len(jobs)
        while True:
            for i, (on, every, name, fetch, keep) in enumerate(jobs):
                if on and not activity.idle() and time.time() >= due[i]:
                    try:
                        keep(fetch())
                        due[i] = time.time() + every
                    except Exception as e:
                        log.warning("%s fetch failed: %s", name, e)
                        due[i] = time.time() + min(every, 120)
            time.sleep(5)

    threading.Thread(target=poll, daemon=True).start()
    if not args.demo:
        threading.Thread(target=wx, daemon=True).start()
        threading.Thread(target=extras, daemon=True).start()
    else:
        tracker.weather, tracker.weather_full = weather.demo()
        tracker.tfrs, tracker.contrails = tfr.demo(cfg["home"]), contrails.demo()
        tracker.heard = sources.demo_heard()
    for p in providers:
        p.activity = activity                 # e.g. Flightradar24's hourly usage check waits for a screen
    server = make_server(cfg, tracker, store, tiles, logos, activity)
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
