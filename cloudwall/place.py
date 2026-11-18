"""One place CloudWall watches: its tracker and logbook, and the threads that keep them fed.

Several places can run at once (config.places), each fetching data only while a screen is
showing it, so a place nobody is looking at costs nothing. The paid route provider is shared,
so all places draw on one budget.
"""
import logging
import threading
import time

from . import contrails, sources, tfr, weather
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

    def summary(self):
        ap = self.cfg["airport"]
        return {"id": self.id, "name": self.name, "icao": ap["icao"], "iata": ap["iata"], "city": ap.get("city")}

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
        while True:
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
        while True:
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
        while True:
            for i, (on, every, name, fetch, keep) in enumerate(jobs):
                if on and not self.activity.idle() and time.time() >= due[i]:
                    try:
                        keep(fetch())
                        due[i] = time.time() + every
                    except Exception as e:
                        log.warning("%s%s fetch failed: %s", self.tag, name, e)
                        due[i] = time.time() + min(every, 120)
            time.sleep(5)


class AnyActivity:
    """Is a screen showing any place? For shared services, such as Flightradar24's hourly
    usage check, that should wait while nobody is looking at all."""

    def __init__(self, places):
        self.places = list(places)

    def idle(self):
        return all(p.activity.idle() for p in self.places)
