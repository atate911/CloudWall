"""One place CloudWall watches: its tracker, logbook, weather and airspace, and the threads feeding them.

Each place fetches only while a screen is showing it. What isn't particular to a place is fetched
once for all of them (gather/shared.py).
"""
import json
import logging
import re
import threading
import time
from pathlib import Path

from ..gather import contrails, demo, feeds, tfr, weather
from ..reference import about, aircraft, airports, placing, seats
from ..core.activity import Activity
from ..gather.enrich import Enricher
from ..gather.shared import Shared
from ..picture.tracker import Tracker

log = logging.getLogger("cloudwall")


class Place:
    def __init__(self, cfg, store, source, shared=None, demo=False, named=False):
        """store: this place's logbook. shared: what all places share (its own if none is given)."""
        self.cfg, self.store, self.source, self.demo = cfg, store, source, demo
        self.id, self.name = cfg["place"]["id"], cfg["place"]["name"]
        self.tag = f"{self.name}: " if named else ""        # log prefix
        self.shared = shared or Shared(Enricher(store, demo=source if demo else None))
        self.tracker = Tracker(cfg, store, self.shared.enricher)
        trk = cfg["tracking"]
        # with no screen: "pause" stops all requests; "log" keeps polling the free position feed slowly
        # for the logbook, but makes no paid lookups and fetches no weather
        self.when_idle = str(trk.get("when_idle", "pause")).lower()
        self.activity = Activity(int(trk.get("idle_after_seconds", 90)))
        if demo:
            self.activity.idle = lambda: False      # demo traffic costs nothing
        self.stopped = threading.Event()
        self.threads = []
        self.restarts = []                          # times a thread tripped and was started again
        self.added = False                          # set up from a screen rather than the config file
        self.weather = None         # the airport's latest report, in short
        self.weather_full = None    # a day of reports and the forecast (the Weather tab)
        self.tfrs = []
        self.heard = []             # military aircraft heard nearby with no position
        self.contrails = None

    def summary(self):
        ap = self.cfg["airport"]
        return {"id": self.id, "name": self.name, "icao": ap["icao"], "iata": ap["iata"], "city": ap.get("city"),
                "zip": self.cfg["home"].get("zip"), "added": self.added,
                # to a few hundred feet: enough for a screen's own location to match a place
                "lat": round(self.cfg["home"]["lat"], 3), "lon": round(self.cfg["home"]["lon"], 3)}

    # -- what a screen asks for (server.py) --
    def state(self, pin=None, range_nm=0, square=False, reach=1.0):
        """Everything a screen draws; counts as a screen looking. pin: the flight this screen
        follows. range_nm, square, reach: how far its radar or map looks, so the feed is asked that far."""
        self.activity.touch()
        self.tracker.want_range(range_nm, square, reach)
        self.tracker.want_pin(pin)
        live = getattr(self.shared.enricher, "live", None)
        w = self.weather and dict(self.weather, stale=weather.is_stale(self.weather.get("time")))
        return dict(self.tracker.snapshot(pin), place=self.id, weather=w, heard=self.heard, tfrs=self.tfrs,
                    contrails={k: v for k, v in self.contrails.items() if k != "levels"} if self.contrails else None,
                    live_routes=live.status() if live else None)

    def weather_report(self):
        """The Weather tab. Counts as a screen looking, too."""
        self.activity.touch()
        full = self.weather_full or {}
        stale = weather.is_stale((full.get("now") or {}).get("time")) if full else None
        return dict(full, stale=stale, contrails=self.contrails, tfrs=self.tfrs)

    def heatmap(self):
        return self.tracker.heatmap()

    def logbook(self):
        """The Logbook tab; each row carries its type's shape and length, to draw it by."""
        book = self.store.logbook(time.strftime("%Y-%m-%d"))
        for row in book["types"] + book["types_today"] + book["recent"]:
            row.update(aircraft.shape(row.get("type")))
        return book

    def about_type(self, type_code, hexid=None):
        """The panel a tap on a type opens; with hexid, what the logbook knows of that airframe too."""
        e = about.entry(type_code) or {}
        return dict(aircraft.shape(type_code), type=type_code,
                    name=e.get("name") or self.store.type_name(type_code), family=e.get("family"),
                    text=e.get("text", []), facts=e.get("facts", []), production=e.get("production"),
                    icon=aircraft.icon(type_code), cwt=aircraft.wake(type_code), seats=seats.seats(None, type_code),
                    seen=self.store.type_seen(type_code), airframe=self.store.airframe_seen(hexid) if hexid else None)

    # -- its threads --
    def stop(self):
        self.stopped.set()
        self.activity.touch()                       # wakes the poller if it's waiting for a screen

    def retire(self):
        """Stop for good: once its threads have ended, close its logbook and its feed's workers."""
        self.stop()

        def let_go():
            for t in self.threads:
                t.join(timeout=60)
            for close in (getattr(self.source, "close", None), self.store.close):
                if close:
                    try:
                        close()
                    except Exception as e:
                        log.warning("%sclosing up after removal: %s", self.tag, e)
        threading.Thread(target=let_go, daemon=True, name=f"retire-{self.id}").start()

    def _keep_going(self, loop):
        """A thread's body: an unexpected error is logged and the loop restarted, not left dead."""
        while not self.stopped.is_set():
            try:
                return loop()
            except Exception:
                log.exception("%s%s stopped on an unexpected error: starting it again", self.tag, loop.__name__.strip("_"))
                self.restarts.append(time.time())               # the health watcher counts these
                self.restarts[:] = self.restarts[-20:]
                self.stopped.wait(5)

    def _thread(self, loop, name):
        t = threading.Thread(target=self._keep_going, args=(loop,), daemon=True, name=f"{name}-{self.id}")
        self.threads.append(t)
        t.start()

    def start(self):
        self._thread(self._poll, "poll")
        ap = self.cfg["airport"]
        if self.demo:
            self.weather, self.weather_full = weather.demo(ap["icao"], ap.get("name") or ap.get("city") or ap["icao"])
            self.tfrs, self.contrails = tfr.demo(self.cfg["home"]), contrails.demo()
            self.heard = demo.demo_heard()
        else:
            self._thread(self._weather, "wx")
            self._thread(self._extras, "extras")

    def _poll(self):
        home, trk, activity, tracker = self.cfg["home"], self.cfg["tracking"], self.activity, self.tracker
        paused = False
        while not self.stopped.is_set():
            self.beat = time.monotonic()        # the watcher's sign that this loop still turns
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
                raw = self.source.fetch(home["lat"], home["lon"], tracker.fetch_radius())
            except Exception as e:
                log.warning("%sno position feed is answering (last error: %s)", self.tag, e)
                tracker.failed(self.source.name, e)
            else:
                try:
                    # idle: with no screen open nothing is paid for
                    tracker.update(raw, self.source.name, idle=idle, contrails=self.contrails)
                except Exception as e:      # CloudWall's own fault, not the feed's
                    log.exception("%sthe feed answered, but the board couldn't be worked out from it", self.tag)
                    tracker.failed(self.source.name, e)
            activity.sleep(1 if self.demo else max(trk["poll_seconds"], 15) if idle else trk["poll_seconds"])

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

    def _extras(self):
        """Military jets heard, flight restrictions, the contrail forecast. Paused with no screen open."""
        cfg, ex, shared = self.cfg, self.cfg["extras"], self.shared
        jobs = [  # (enabled, every seconds, name, what it sets, fetch)
            (ex["military"], 60, "military aircraft", "heard",
             lambda: feeds.heard_near(shared.military(ex["military_url"]), cfg["home"], ex["military_radius_nm"])),
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
    """Every place watched: the config file's, then those set up from a screen (saved to saved_path,
    removable; the config file's aren't). make(place_config) builds a Place. elsewhere(id, home):
    is the logbook on disk under that id another place's? A new place is never given such an id."""
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
        return self.places[placing.kiosk_place(self.cfg, [p.cfg for p in self])]

    def summaries(self):
        return [p.summary() for p in self]

    def add_config(self, pc):
        place = self.make(pc)
        self.places[place.id] = place
        return place

    def load_saved(self):
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
        if renumbered:      # a file from before ids were kept, or an id the config file took
            with self.lock:
                self._save()

    def add(self, e, save=True, pid=None):
        """A place from a screen: {name, lat and lon, zip, airport ("auto" or an ICAO code)}.
        Raises ValueError with a message for the screen. pid: the id a saved place had; kept, since
        its logbook file and each screen's choice are named by it. None or taken: the next free one."""
        with self.lock:
            if len(self.places) >= self.LIMIT:
                raise ValueError(f"CloudWall watches up to {self.LIMIT} places: remove one first")
            home, ap = placing.entry(e, "That place")
            if str(ap.get("icao", "auto")).lower() != "auto" and not airports.lookup(ap["icao"]):
                raise ValueError(f"{ap['icao'].upper()} isn't an airport CloudWall knows")
            if not (isinstance(pid, str) and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", pid) and pid not in self.places):
                # skip ids whose leftover logbook is another place's (this place coming back reuses its own)
                pid = placing.unique_id(home["name"], self.places, lambda i: self.elsewhere(i, home))
            place = self.make(placing.place_config(self.cfg, pid, home, ap))
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
        place.retire()          # safe: the first place, whose store others share, can't be removed
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
    """Is a screen showing any place? For shared services that should wait while nobody looks."""

    def __init__(self, places):
        self.places = places

    def idle(self):
        return all(p.activity.idle() for p in self.places)
