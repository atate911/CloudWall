"""Optional live routes from FlightAware AeroAPI (v4). Needs an API key; each lookup is billed."""
import logging
import os
import threading
import time
from datetime import datetime
from urllib.parse import quote

from .http import get_json

log = logging.getLogger("cloudwall.flightaware")
BASE = "https://aeroapi.flightaware.com/aeroapi"
YEAR = 365 * 86400


def _ts(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if value else None
    except (ValueError, AttributeError):
        return None


def pick_flight(flights, now):
    """AeroAPI returns several days of legs for one flight number: choose the one in the air.

    Airborne means actual_off is set and actual_on is not. A flight that left the
    runway a minute ago may not be marked yet, so otherwise take the leg whose
    departure is closest to now (within three hours) and has not landed.
    """
    live = [f for f in flights if not f.get("cancelled") and not f.get("actual_on")]
    airborne = [f for f in live if f.get("actual_off")]
    if airborne:
        return max(airborne, key=lambda f: _ts(f["actual_off"]) or 0)

    def gap(f):
        t = _ts(f.get("estimated_off") or f.get("scheduled_off") or f.get("scheduled_out"))
        return abs(t - now) if t else float("inf")

    best = min(live, key=gap, default=None)
    return best if best and gap(best) <= 3 * 3600 else None


class FlightAware:
    def __init__(self, cfg, store):
        fa = cfg.get("flightaware", {})
        self.key = os.environ.get("CLOUDWALL_FLIGHTAWARE_KEY") or fa.get("api_key") or ""
        self.daily_limit = int(fa.get("daily_limit", 30))
        self.mode = fa.get("mode", "fallback")
        self.general_aviation = bool(fa.get("general_aviation", False))
        self.store = store
        self.lock = threading.Lock()
        self.enabled = bool(self.key)

    # -- budget ---------------------------------------------------------------
    def _day(self):
        return time.strftime("%Y-%m-%d")

    def used_today(self):
        return self.store.cache_get("fa_usage", self._day(), 2 * 86400)[1] or 0

    def available(self):
        return self.enabled and self.used_today() < self.daily_limit

    def status(self):
        return {"enabled": self.enabled, "used_today": self.used_today() if self.enabled else 0,
                "daily_limit": self.daily_limit, "mode": self.mode}

    def _call(self, path):
        with self.lock:
            if not self.available():
                return None
            # count before the call: a request that reaches FlightAware is billed even if we then fail
            self.store.cache_put("fa_usage", self._day(), self.used_today() + 1)
        return get_json(f"{BASE}{path}", headers={"x-apikey": self.key})

    # -- lookups --------------------------------------------------------------
    def _airport(self, a):
        """Flight results carry airport codes but no coordinates; fetch those once and keep them."""
        code = a.get("code_icao") or a.get("code")
        out = {"iata": a.get("code_iata") or a.get("code_lid") or a.get("code"),
               "city": a.get("city"), "name": a.get("name"), "lat": None, "lon": None}
        if not code:
            return out
        hit, pos = self.store.cache_get("fa_airport", code, YEAR)
        if not hit:
            try:
                info = self._call(f"/airports/{quote(code)}")
            except Exception as e:
                log.warning("airport %s lookup failed: %s", code, e)
                info = None
            if info and info.get("latitude") is not None:
                pos = {"lat": info["latitude"], "lon": info["longitude"]}
                self.store.cache_put("fa_airport", code, pos)
        if pos:
            out.update(pos)
        return out

    def route(self, callsign):
        """Live route for a callsign, or None if FlightAware has no current flight for it."""
        data = self._call(f"/flights/{quote(callsign)}?max_pages=1")
        f = pick_flight((data or {}).get("flights") or [], time.time())
        if not f or not f.get("origin") or not f.get("destination"):
            return None
        return {
            "flight": f.get("ident_iata") or f.get("ident") or callsign,
            "airline": None, "source": "flightaware",
            "origin": self._airport(f["origin"]), "dest": self._airport(f["destination"]),
            "eta": _ts(f.get("estimated_in") or f.get("estimated_on") or f.get("scheduled_in")),
            "arrival_delay_s": f.get("arrival_delay"), "status": f.get("status"),
            "progress_percent": f.get("progress_percent"), "route_nm": f.get("route_distance"),
        }
