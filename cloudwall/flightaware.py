"""Optional live routes from FlightAware AeroAPI (v4). Needs an API key; each lookup is billed."""
import logging
import time
from datetime import datetime
from urllib.parse import quote

from .live import YEAR, LiveProvider

log = logging.getLogger("cloudwall.flightaware")
BASE = "https://aeroapi.flightaware.com/aeroapi"


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


class FlightAware(LiveProvider):
    name, label, env_key = "flightaware", "FlightAware", "CLOUDWALL_FLIGHTAWARE_KEY"

    def headers(self):
        return {"x-apikey": self.key}

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
                info = self._call(f"{BASE}/airports/{quote(code)}")
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
        data = self._call(f"{BASE}/flights/{quote(callsign)}?max_pages=1")
        if data is None:
            return None
        f = pick_flight(data.get("flights") or [], time.time())
        if not f or not f.get("origin") or not f.get("destination"):
            log.info("FlightAware: no current flight with a route for %s (%d legs returned)",
                     callsign, len(data.get("flights") or []))
            return None
        log.info("FlightAware: %s is %s -> %s", callsign, f["origin"].get("code_iata") or f["origin"].get("code"),
                 f["destination"].get("code_iata") or f["destination"].get("code"))
        return {
            "flight": f.get("ident_iata") or f.get("ident") or callsign,
            "airline": None, "source": self.name, "source_label": self.label,
            "origin": self._airport(f["origin"]), "dest": self._airport(f["destination"]),
            "eta": _ts(f.get("estimated_in") or f.get("estimated_on") or f.get("scheduled_in")),
            "arrival_delay_s": f.get("arrival_delay"), "status": f.get("status"),
            "progress_percent": f.get("progress_percent"), "route_nm": f.get("route_distance"),
        }
