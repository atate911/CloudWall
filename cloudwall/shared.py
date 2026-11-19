"""What every place shares: the answers that are the same wherever they are asked from.

A place watches one spot, but much of what it shows isn't about that spot. A flight's route is
the same seen from home or from the cabin; the FAA publishes one list of flight restrictions for
the whole country; an airport has one weather report, however many places take it as theirs.
Each of those is fetched once here and handed to every place that wants it, so a second place
costs a second position feed and nothing else: no second paid lookup for a flight both can see,
no second download of the same list.

What belongs to one place stays with it: its positions, its logbook, its contrail forecast.
"""
import threading
import time

from . import sources, tfr, weather

# How old an answer may be before the next place to ask fetches it again: a little under how
# often a place asks (place.py), so a place by itself gets a fresh one every time.
WEATHER_S = 270
MILITARY_S = 50
RESTRICTIONS_S = 870


class Shared:
    def __init__(self, enricher):
        self.enricher = enricher        # routes, airframes and photos: one cache, one pair of workers
        self.tfrs = tfr.TFRs()          # the FAA's list, and each restriction's details once read
        self.lock = threading.Lock()
        self.kept = {}                  # what was asked -> {"lock", "at", "value"}

    def once(self, key, max_age, fetch):
        """fetch()'s answer, no more than max_age seconds old: fetched by whichever place asks
        first and kept for the rest. Places asking at the same moment wait for the one fetch. An
        error is the asker's to deal with, and nothing is kept of it."""
        with self.lock:
            item = self.kept.setdefault(key, {"lock": threading.Lock(), "at": 0.0, "value": None})
        with item["lock"]:
            if time.time() - item["at"] >= max_age:
                item["value"] = fetch()
                item["at"] = time.time()
            return item["value"]

    def weather(self, icao):
        """An airport's weather, as weather.fetch_all gives it: (short, full)."""
        return self.once(("weather", icao), WEATHER_S, lambda: weather.fetch_all(icao))

    def military(self, url):
        """Military aircraft heard anywhere with no position (sources.heard_near picks a place's)."""
        return self.once(("military", url), MILITARY_S, lambda: sources.military_unplaced(url))

    def restrictions(self, home, radius_nm):
        """The flight restrictions near a place, from the country's one list."""
        return self.tfrs.near(self.once("restrictions", RESTRICTIONS_S, self.tfrs.fetch), home, radius_nm)
