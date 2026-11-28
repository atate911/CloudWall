"""What every place shares, fetched once for all: routes and airframes, the FAA's restrictions,
an airport's weather, the military feed. A place's positions, logbook and contrail forecast stay
its own.
"""
import threading
import time

from . import feeds, tfr, weather

# max ages: a little under how often a place asks (place.py), so a lone place always gets a fresh one
WEATHER_S = 270
MILITARY_S = 50
RESTRICTIONS_S = 870


class Shared:
    def __init__(self, enricher):
        self.enricher = enricher
        self.tfrs = tfr.TFRs()
        self.lock = threading.Lock()
        self.kept = {}                  # key -> {"lock", "at", "value"}

    def once(self, key, max_age, fetch):
        """fetch()'s answer, at most max_age seconds old; concurrent askers wait for the one
        fetch. An error propagates to the asker and nothing is kept of it."""
        with self.lock:
            item = self.kept.setdefault(key, {"lock": threading.Lock(), "at": 0.0, "value": None})
        with item["lock"]:
            if time.time() - item["at"] >= max_age:
                item["value"] = fetch()
                item["at"] = time.time()
            return item["value"]

    def weather(self, icao):
        """(short, full), as weather.fetch_all gives it."""
        return self.once(("weather", icao), WEATHER_S, lambda: weather.fetch_all(icao))

    def military(self, url):
        return self.once(("military", url), MILITARY_S, lambda: feeds.military_unplaced(url))

    def restrictions(self, home, radius_nm):
        return self.tfrs.near(self.once("restrictions", RESTRICTIONS_S, self.tfrs.fetch), home, radius_nm)
