"""Route and airframe lookups (adsbdb.com) and airframe photos (planespotters.net),
cached and fetched off the poll thread."""
import logging
import queue
import re
import threading
import time
import urllib.parse

from .http import get_json

log = logging.getLogger("cloudwall.enrich")
AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}\d[0-9A-Z]{0,4}$")
DAY = 86400
LIVE_ROUTE_TTL = 45 * 60   # a callsign flies several legs a day; don't reuse a live route for long
PHOTO_TTL = DAY            # look again daily: photos there are added and taken down


def _airport(a):
    return {"iata": a.get("iata_code") or a.get("icao_code"), "city": a.get("municipality"),
            "name": a.get("name"), "country": a.get("country_name"),
            "lat": a.get("latitude"), "lon": a.get("longitude")}


def fetch_route(callsign):
    data = get_json(f"https://api.adsbdb.com/v0/callsign/{callsign}")
    fr = (data or {}).get("response")
    fr = fr.get("flightroute") if isinstance(fr, dict) else None
    if not fr:
        return None
    airline = fr.get("airline") or {}
    return {"flight": fr.get("callsign_iata") or callsign, "airline": airline.get("name"),
            "airline_iata": airline.get("iata"),
            "origin": _airport(fr["origin"]), "dest": _airport(fr["destination"])}


def fetch_aircraft(hexid):
    data = get_json(f"https://api.adsbdb.com/v0/aircraft/{hexid}")
    ac = (data or {}).get("response")
    ac = ac.get("aircraft") if isinstance(ac, dict) else None
    if not ac:
        return None
    name, maker = ac.get("type"), ac.get("manufacturer")
    if name and maker and not name.lower().startswith(maker.lower()):
        name = f"{maker} {name}"
    # adsbdb's photo (airport-data.com) is filed by tail number, and US tail numbers are
    # reissued, so it can show an older aircraft that once wore the same one: not used
    return {"type_name": name, "manufacturer": ac.get("manufacturer"),
            "reg": ac.get("registration"), "owner": ac.get("registered_owner")}


def fetch_photo(hexid, reg=None, icao_type=None):
    """A photo of this airframe from planespotters.net, which files photos by airframe
    rather than by tail number. Shown only with its credit and a link to its page there."""
    q = urllib.parse.urlencode({k: v for k, v in (("reg", reg), ("icaoType", icao_type)) if v})
    data = get_json(f"https://api.planespotters.net/pub/photos/hex/{urllib.parse.quote(hexid.upper())}"
                    + (f"?{q}" if q else ""))
    for p in (data or {}).get("photos") or []:
        src = (p.get("thumbnail_large") or p.get("thumbnail") or {}).get("src") or ""
        link, by = p.get("link") or "", (p.get("photographer") or "").strip()
        if src.startswith("https://") and link.startswith("https://www.planespotters.net/") and by:
            return {"src": src, "link": link, "by": by}
    return None


class Enricher:
    """Non-blocking lookups: returns what is cached now, fetches the rest in the background."""

    def __init__(self, store, demo=None, live=None):
        self.store, self.demo, self.live = store, demo, live
        self.mem, self.pending = {}, set()
        # photos wait in a line of their own, so a slow photo site never holds up a route
        self.q, self.photo_q = queue.Queue(), queue.Queue()
        self.lock = threading.Lock()
        if not demo:
            threading.Thread(target=self._worker, args=(self.q,), daemon=True).start()
            threading.Thread(target=self._worker, args=(self.photo_q,), daemon=True).start()

    def route(self, callsign):
        if self.demo:
            return self.demo.routes.get(callsign)
        if not callsign or not AIRLINE_CALLSIGN.match(callsign):
            return None
        return self._get("route", callsign, 7 * DAY)

    def aircraft(self, hexid):
        if self.demo:
            return self.demo.aircraft.get(hexid)
        return self._get("aircraft", hexid, 30 * DAY)

    def photo(self, hexid, reg=None, icao_type=None):
        """The airframe's photo with its credit, as {src, link, by}, or None."""
        if self.demo or not hexid:
            return None
        # the registration and type help planespotters pick the airframe flying now
        return self._get("photo", "|".join((hexid, reg or "", icao_type or "")), PHOTO_TTL)

    def live_route(self, callsign, fetch):
        """The paid provider's route for the flight in the air now, as (state, route):
        "done" (route may be None: the provider had nothing), "pending" (being looked up),
        "skipped" (not looked up: not worth it yet, or over the daily cap) or "n/a".
        Billed, so `fetch` is the tracker saying this aircraft is worth a lookup."""
        p = self.live
        if self.demo or not p or not p.enabled or not callsign:
            return "n/a", None
        if not p.general_aviation and not AIRLINE_CALLSIGN.match(callsign):
            return "n/a", None
        k = ("live_route", f"{p.name}:{callsign}")
        with self.lock:
            if k in self.mem and time.time() - self.mem[k][1] < LIVE_ROUTE_TTL:
                return "done", self.mem[k][0]
            hit, value = self.store.cache_get(k[0], k[1], LIVE_ROUTE_TTL)
            if hit:
                self.mem[k] = (value, time.time())
                return "done", value
            if k in self.pending:
                return "pending", None
            if fetch and p.available():
                self.pending.add(k)
                self.q.put(k)
                return "pending", None
        return "skipped", None

    def _get(self, kind, key, max_age, fetch=True):
        k = (kind, key)
        with self.lock:
            if k in self.mem and time.time() - self.mem[k][1] < max_age:
                return self.mem[k][0]
            hit, value = self.store.cache_get(kind, key, max_age)
            if hit:
                self.mem[k] = (value, time.time())
                return value
            if fetch and k not in self.pending:
                self.pending.add(k)
                (self.photo_q if kind == "photo" else self.q).put(k)
        return None

    def _fetch(self, kind, key):
        if kind == "route":
            return fetch_route(key)
        if kind == "live_route":
            return self.live.route(key.split(":", 1)[1])
        if kind == "photo":
            return fetch_photo(*key.split("|"))
        return fetch_aircraft(key)

    def _worker(self, q):
        while True:
            kind, key = k = q.get()
            try:
                value = self._fetch(kind, key)
                self.store.cache_put(kind, key, value)   # None is cached too (unknown)
                with self.lock:
                    self.mem[k] = (value, time.time())
            except Exception as e:  # network trouble: retry on a later sighting
                log.warning("lookup %s %s failed: %s", kind, key, e)
                time.sleep(5)
            finally:
                with self.lock:
                    self.pending.discard(k)
