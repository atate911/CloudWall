"""One place CloudWall watches: its tracker and logbook, its weather and airspace, the threads
that keep them fed, and what a screen showing it is given.

Several places can run at once (config.places), each fetching data only while a screen is
showing it, so a place nobody is looking at costs nothing. What isn't particular to a place
(lookups of routes and airframes, the country's flight restrictions, an airport's weather) is
fetched once for all of them: see shared.py.
"""
import json
import logging
import re
import threading
import time
from pathlib import Path

from . import aircraft, airports, config, contrails, sources, tfr, weather
from .activity import Activity
from .enrich import Enricher
from .shared import Shared
from .tracker import Tracker

log = logging.getLogger("cloudwall")


class Place:
    def __init__(self, cfg, store, source, shared=None, demo=False, named=False):
        """store: this place's logbook. shared: what all places share (one of its own if none is
        given, as for a place on its own in a test)."""
        self.cfg, self.store, self.source, self.demo = cfg, store, source, demo
        self.id, self.name = cfg["place"]["id"], cfg["place"]["name"]
        self.tag = f"{self.name}: " if named else ""        # log prefix, when there's more than one
        self.shared = shared or Shared(Enricher(store, demo=source if demo else None))
        self.tracker = Tracker(cfg, store, self.shared.enricher)
        trk = cfg["tracking"]
        # Only use the data services while a screen shows this place: "pause" stops all
        # requests when nobody is looking; "log" keeps checking the free position feed slowly
        # so the logbook stays complete, but still makes no paid route lookups and fetches no weather.
        self.when_idle = str(trk.get("when_idle", "pause")).lower()
        self.activity = Activity(int(trk.get("idle_after_seconds", 90)))
        if demo:
            self.activity.idle = lambda: False      # demo traffic costs nothing
        self.stopped = threading.Event()
        self.added = False                          # set up from a screen rather than the config file
        # what its threads fetch, beside the tracker's positions
        self.weather = None         # the airport's latest report, in short (the header, the idle card)
        self.weather_full = None    # and in full: a day of reports and the forecast (the Weather tab)
        self.tfrs = []              # flight restrictions nearby
        self.heard = []             # military aircraft heard nearby with no position
        self.contrails = None       # the contrail forecast overhead

    def summary(self):
        ap = self.cfg["airport"]
        return {"id": self.id, "name": self.name, "icao": ap["icao"], "iata": ap["iata"], "city": ap.get("city"),
                "zip": self.cfg["home"].get("zip"), "added": self.added}

    # -- what a screen asks for (server.py) ---------------------------------------------
    def state(self, pin=None, range_nm=0, square=False):
        """Everything a screen showing this place draws, and a note that one is looking: the
        tracker's board, with this screen's own flight (pin) on the card if it follows one, and
        the place's weather in short, its airspace and what is heard nearby. range_nm and square
        say how far out this screen's radar looks, so the feed is asked that far."""
        self.activity.touch()
        self.tracker.want_range(range_nm, square)
        self.tracker.want_pin(pin)
        live = getattr(self.shared.enricher, "live", None)
        return dict(self.tracker.snapshot(pin), place=self.id, weather=self.weather, heard=self.heard, tfrs=self.tfrs,
                    contrails={k: v for k, v in self.contrails.items() if k != "levels"} if self.contrails else None,
                    live_routes=live.status() if live else None)

    def weather_report(self):
        """The Weather tab: the day's reports and the forecast, the contrail forecast level by
        level, and the restrictions with their notices. Counts as a screen looking, too."""
        self.activity.touch()
        return dict(self.weather_full or {}, contrails=self.contrails, tfrs=self.tfrs)

    def heatmap(self):
        return self.tracker.heatmap()

    def logbook(self):
        """The Logbook tab. Each type and flyover carries its type's shape and length, as the
        aircraft on the board do, for the display to draw it by."""
        book = self.store.logbook(time.strftime("%Y-%m-%d"))
        for row in book["types"] + book["types_today"] + book["recent"]:
            row.update(aircraft.shape(row.get("type")))
        return book

    # -- its threads ------------------------------------------------------------------------
    def stop(self):
        """Removed: its threads finish their current step and end."""
        self.stopped.set()
        self.activity.touch()                       # wakes the poller if it's waiting for a screen

    def _keep_going(self, loop):
        """A thread's body. An error nobody foresaw is logged with where it happened and the loop
        starts again in a few seconds: otherwise the thread would end without a word, and the
        place stand still (no positions, or no weather) until CloudWall was restarted."""
        while not self.stopped.is_set():
            try:
                return loop()
            except Exception:
                log.exception("%s%s stopped on an unexpected error: starting it again", self.tag, loop.__name__.strip("_"))
                self.stopped.wait(5)

    def _thread(self, loop, name):
        threading.Thread(target=self._keep_going, args=(loop,), daemon=True, name=f"{name}-{self.id}").start()

    def start(self):
        self._thread(self._poll, "poll")
        ap = self.cfg["airport"]
        if self.demo:
            self.weather, self.weather_full = weather.demo(ap["icao"], ap.get("name") or ap.get("city") or ap["icao"])
            self.tfrs, self.contrails = tfr.demo(self.cfg["home"]), contrails.demo()
            self.heard = sources.demo_heard()
        else:
            self._thread(self._weather, "wx")
            self._thread(self._extras, "extras")

    # -- positions -----------------------------------------------------------------
    def _poll(self):
        home, trk, activity, tracker = self.cfg["home"], self.cfg["tracking"], self.activity, self.tracker
        paused = False
        while not self.stopped.is_set():
            idle = activity.idle()
            if idle and self.when_idle == "pause":
                if not paused:
                    log.info("%sno screen open: pausing data requests until one asks again", self.tag)
                    paused = True
                activity.sleep(60)
                continue
            if paused:
                log.info("%sscreen open: resuming data requests", self.tag)
                paused = False
            try:
                # out to the tracking radius, or further while a screen shows the radar at a longer range
                raw = self.source.fetch(home["lat"], home["lon"], tracker.fetch_radius())
            except Exception as e:
                log.warning("%sno position feed is answering (last error: %s)", self.tag, e)
                tracker.failed(self.source.name, e)
            else:
                try:
                    # with no screen open nothing is paid for; the contrail forecast marks each aircraft
                    tracker.update(raw, self.source.name, idle=idle, contrails=self.contrails)
                except Exception as e:      # CloudWall's own fault, not the feed's: say so, with where
                    log.exception("%sthe feed answered, but the board couldn't be worked out from it", self.tag)
                    tracker.failed(self.source.name, e)
            activity.sleep(1 if self.demo else max(trk["poll_seconds"], 15) if idle else trk["poll_seconds"])

    # -- weather ---------------------------------------------------------------------
    def _weather(self):
        fetched = 0.0
        while not self.stopped.is_set():
            if not self.activity.idle() and time.time() - fetched > 300:
                try:
                    short, full = self.shared.weather(self.cfg["airport"]["icao"])
                    if short:
                        self.weather, self.weather_full = short, full
                    fetched = time.time()
                except Exception as e:
                    log.warning("%sweather fetch failed: %s", self.tag, e)
                    fetched = time.time() - 240          # try again in a minute
            time.sleep(5)

    # -- extras ----------------------------------------------------------------------
    def _extras(self):
        """Military jets heard without a position (every minute), flight restrictions
        (every 15 minutes) and the contrail forecast (hourly). Paused with no screen open."""
        cfg, ex, shared = self.cfg, self.cfg["extras"], self.shared
        jobs = [  # (enabled, every seconds, name, what it sets, fetch)
            (ex["military"], 60, "military aircraft", "heard",
             lambda: sources.heard_near(shared.military(ex["military_url"]), cfg["home"], ex["military_radius_nm"])),
            (ex["tfr"], 900, "flight restrictions", "tfrs", lambda: shared.restrictions(cfg["home"], ex["tfr_radius_nm"])),
            (ex["contrails"], 3600, "contrail forecast", "contrails",
             lambda: contrails.fetch(cfg["home"]["lat"], cfg["home"]["lon"])),
        ]
        due = [0.0] * len(jobs)
        while not self.stopped.is_set():
            for i, (on, every, name, field, fetch) in enumerate(jobs):
                if on and not self.activity.idle() and time.time() >= due[i]:
                    try:
                        setattr(self, field, fetch())
                        due[i] = time.time() + every
                    except Exception as e:
                        log.warning("%s%s fetch failed: %s", self.tag, name, e)
                        due[i] = time.time() + min(every, 120)
            time.sleep(5)


class Places:
    """Every place being watched, first to last: the config file's, then those set up from a
    screen. Those are saved (saved_path, beside the logbook) so they come back after a restart,
    and can be removed again; the config file's can't. make(place_config) builds a Place.
    elsewhere(id, home) says whether the logbook already on disk under an id is another place's
    (a removed place leaves its logbook behind): a new place is never given such an id."""
    LIMIT = 12

    def __init__(self, cfg, make, saved_path=None, elsewhere=None):
        self.cfg, self.make, self.saved_path = cfg, make, Path(saved_path) if saved_path else None
        self.elsewhere = elsewhere or (lambda pid, home: False)
        self.lock = threading.Lock()
        self.places = {}            # id -> Place, in order
        self.added = {}             # id -> the entry it was set up from, as saved
        self.on_change = None       # called after a place is added or removed

    def __iter__(self):
        return iter(list(self.places.values()))

    def __len__(self):
        return len(self.places)

    def __getitem__(self, pid):
        return self.places[pid]

    @property
    def first(self):
        return next(iter(self.places.values()))

    def get(self, pid):
        return self.places.get(pid)

    def kiosk(self):
        return self.places[config.kiosk_place(self.cfg, [p.cfg for p in self])]

    def summaries(self):
        return [p.summary() for p in self]

    def add_config(self, pc):
        place = self.make(pc)
        self.places[place.id] = place
        return place

    def load_saved(self):
        """The places set up from a screen before the last restart."""
        if not self.saved_path or not self.saved_path.exists():
            return
        try:
            saved = json.loads(self.saved_path.read_text())
        except (OSError, ValueError) as e:
            log.warning("couldn't read %s: %s", self.saved_path, e)
            return
        if not isinstance(saved, list):
            log.warning("%s isn't a list of places: left alone", self.saved_path)
            return
        renumbered = False
        for e in saved:
            if not isinstance(e, dict):
                continue
            try:
                place = self.add(e, save=False, pid=e.get("id"))
                renumbered = renumbered or place.id != e.get("id")
            except ValueError as err:
                log.warning("saved place %s left out: %s", e.get("name"), err)
        if renumbered:      # a file from before ids were kept, or an id the config file has since taken
            with self.lock:
                self._save()

    def add(self, e, save=True, pid=None):
        """A place from a screen: {name, lat and lon, zip, airport ("auto" or an ICAO code)}.
        Raises ValueError with a message for the screen when it can't be set up. pid: the id a
        saved place had before the restart. Its logbook's file is named after its id, as is each
        screen's choice of place, so it keeps that id whatever has been removed or renamed around
        it; without one (a new place), or if the id has been taken, it gets the next free one."""
        with self.lock:
            if len(self.places) >= self.LIMIT:
                raise ValueError(f"CloudWall watches up to {self.LIMIT} places: remove one first")
            home, ap = config.entry(e, "That place")
            if str(ap.get("icao", "auto")).lower() != "auto" and not airports.lookup(ap["icao"]):
                raise ValueError(f"{ap['icao'].upper()} isn't an airport CloudWall knows")
            if not (isinstance(pid, str) and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", pid) and pid not in self.places):
                # the next free id that doesn't lead to the logbook a removed place left behind,
                # unless it is this very place coming back: then it carries on in its own logbook
                pid = config.unique_id(home["name"], self.places, lambda i: self.elsewhere(i, home))
            place = self.make(config.place_config(self.cfg, pid, home, ap))
            place.added = True
            self.places[pid] = place
            self.added[pid] = {"id": pid, "name": home["name"], "lat": home["lat"], "lon": home["lon"], "zip": home.get("zip"),
                               "airport": "auto" if str(ap.get("icao", "auto")).lower() == "auto" else ap["icao"].upper()}
            if save:
                self._save()
        place.start()
        log.info("place %s added: %s, airport %s", pid, place.name, place.cfg["airport"]["icao"])
        if self.on_change:
            self.on_change()
        return place

    def remove(self, pid):
        """Remove a place set up from a screen. Its logbook stays on disk."""
        with self.lock:
            if pid not in self.added:
                raise ValueError("Only places set up from a screen can be removed here; the config file's stay")
            place = self.places.pop(pid)
            del self.added[pid]
            self._save()
        place.stop()
        log.info("place %s removed", pid)
        if self.on_change:
            self.on_change()

    def _save(self):
        if not self.saved_path:
            return
        tmp = self.saved_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(self.added.values()), indent=1))
        tmp.replace(self.saved_path)


class AnyActivity:
    """Is a screen showing any place? For shared services, such as Flightradar24's hourly
    usage check, that should wait while nobody is looking at all."""

    def __init__(self, places):
        self.places = places

    def idle(self):
        return all(p.activity.idle() for p in self.places)
