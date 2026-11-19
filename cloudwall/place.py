"""One place CloudWall watches: its tracker and logbook, and the threads that keep them fed.

Several places can run at once (config.places), each fetching data only while a screen is
showing it, so a place nobody is looking at costs nothing. The paid route provider is shared,
so all places draw on one budget.
"""
import json
import logging
import re
import threading
import time
from pathlib import Path

from . import airports, config, contrails, sources, tfr, weather
from .activity import Activity
from .enrich import Enricher
from .tracker import Tracker

log = logging.getLogger("cloudwall")


class Place:
    def __init__(self, cfg, store, source, live=None, demo=False, named=False):
        self.cfg, self.store, self.source, self.demo = cfg, store, source, demo
        self.id, self.name = cfg["place"]["id"], cfg["place"]["name"]
        self.tag = f"{self.name}: " if named else ""        # log prefix, when there's more than one
        self.tracker = Tracker(cfg, store, Enricher(store, demo=source if demo else None, live=live))
        trk = cfg["tracking"]
        # Only use the data services while a screen shows this place: "pause" stops all
        # requests when nobody is looking; "log" keeps checking the free position feed slowly
        # so the logbook stays complete, but still makes no paid route lookups and fetches no weather.
        self.when_idle = str(trk.get("when_idle", "pause")).lower()
        self.activity = Activity(int(trk.get("idle_after_seconds", 90)))
        if demo:
            self.activity.idle = lambda: False      # demo traffic costs nothing
        self.tfrs = tfr.TFRs(cfg["home"], cfg["extras"]["tfr_radius_nm"])
        self.stopped = threading.Event()
        self.added = False                          # set up from a screen rather than the config file

    def summary(self):
        ap = self.cfg["airport"]
        return {"id": self.id, "name": self.name, "icao": ap["icao"], "iata": ap["iata"], "city": ap.get("city"),
                "zip": self.cfg["home"].get("zip"), "added": self.added}

    def stop(self):
        """Removed: its threads finish their current step and end."""
        self.stopped.set()
        self.activity.touch()                       # wakes the poller if it's waiting for a screen

    def start(self):
        threading.Thread(target=self._poll, daemon=True, name=f"poll-{self.id}").start()
        t, ap = self.tracker, self.cfg["airport"]
        if self.demo:
            t.weather, t.weather_full = weather.demo(ap["icao"], ap.get("name") or ap.get("city") or ap["icao"])
            t.tfrs, t.contrails = tfr.demo(self.cfg["home"]), contrails.demo()
            t.heard = sources.demo_heard()
        else:
            threading.Thread(target=self._weather, daemon=True, name=f"wx-{self.id}").start()
            threading.Thread(target=self._extras, daemon=True, name=f"extras-{self.id}").start()

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
            tracker.idle = idle
            try:
                # out to the tracking radius, or further while a screen shows the radar at a longer range
                tracker.update(self.source.fetch(home["lat"], home["lon"], tracker.fetch_radius()), self.source.name)
            except Exception as e:
                log.warning("%sno position feed is answering (last error: %s)", self.tag, e)
                tracker.failed(self.source.name, e)
            activity.sleep(1 if self.demo else max(trk["poll_seconds"], 15) if idle else trk["poll_seconds"])

    # -- weather ---------------------------------------------------------------------
    def _weather(self):
        fetched = 0.0
        while not self.stopped.is_set():
            if not self.activity.idle() and time.time() - fetched > 300:
                try:
                    short, full = weather.fetch_all(self.cfg["airport"]["icao"])
                    if short:
                        self.tracker.weather, self.tracker.weather_full = short, full
                    fetched = time.time()
                except Exception as e:
                    log.warning("%sweather fetch failed: %s", self.tag, e)
                    fetched = time.time() - 240          # try again in a minute
            time.sleep(5)

    # -- extras ----------------------------------------------------------------------
    def _extras(self):
        """Military jets heard without a position (every minute), flight restrictions
        (every 15 minutes) and the contrail forecast (hourly). Paused with no screen open."""
        cfg, ex, tracker = self.cfg, self.cfg["extras"], self.tracker
        jobs = [  # (enabled, every seconds, name, fetch, keep)
            (ex["military"], 60, "military aircraft",
             lambda: sources.military_heard(cfg["home"], ex["military_radius_nm"], ex["military_url"]),
             lambda v: setattr(tracker, "heard", v)),
            (ex["tfr"], 900, "flight restrictions", self.tfrs.refresh, lambda v: setattr(tracker, "tfrs", v)),
            (ex["contrails"], 3600, "contrail forecast",
             lambda: contrails.fetch(cfg["home"]["lat"], cfg["home"]["lon"]), lambda v: setattr(tracker, "contrails", v)),
        ]
        due = [0.0] * len(jobs)
        while not self.stopped.is_set():
            for i, (on, every, name, fetch, keep) in enumerate(jobs):
                if on and not self.activity.idle() and time.time() >= due[i]:
                    try:
                        keep(fetch())
                        due[i] = time.time() + every
                    except Exception as e:
                        log.warning("%s%s fetch failed: %s", self.tag, name, e)
                        due[i] = time.time() + min(every, 120)
            time.sleep(5)


class Places:
    """Every place being watched, first to last: the config file's, then those set up from a
    screen. Those are saved (saved_path, beside the logbook) so they come back after a restart,
    and can be removed again; the config file's can't. make(place_config) builds a Place."""
    LIMIT = 12

    def __init__(self, cfg, make, saved_path=None):
        self.cfg, self.make, self.saved_path = cfg, make, Path(saved_path) if saved_path else None
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
                pid = config.unique_id(home["name"], self.places)
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
