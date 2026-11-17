"""Optional live routes from the official Flightradar24 API. Needs a subscription token;
each lookup spends credits."""
import logging
from datetime import datetime
from urllib.parse import quote

from .live import YEAR, LiveProvider

log = logging.getLogger("cloudwall.flightradar24")
BASE = "https://fr24api.flightradar24.com/api"


def _ts(value):
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if value else None
    except (ValueError, AttributeError):
        return None


class Flightradar24(LiveProvider):
    name, label, env_key = "flightradar24", "Flightradar24", "CLOUDWALL_FR24_KEY"
    default_limit = 100

    def __init__(self, cfg, store):
        super().__init__(cfg, store)
        self.sandbox = bool(cfg.get(self.name, {}).get("sandbox", False))
        self.base = f"{BASE}/sandbox" if self.sandbox else BASE

    def headers(self):
        return {"Authorization": f"Bearer {self.key}", "Accept-Version": "v1"}

    def _airport(self, icao, iata):
        """Live results carry airport codes only; fetch name and coordinates once and keep them."""
        out = {"iata": iata or icao, "city": None, "name": None, "lat": None, "lon": None}
        code = icao or iata
        if not code:
            return out
        hit, info = self.store.cache_get("fr24_airport", code, YEAR)
        if not hit:
            try:
                d = self._call(f"{self.base}/static/airports/{quote(code)}/full")
            except Exception as e:
                log.warning("airport %s lookup failed: %s", code, e)
                d = None
            if d and d.get("lat") is not None:
                info = {"city": d.get("city"), "name": d.get("name"), "lat": d["lat"], "lon": d["lon"]}
                self.store.cache_put("fr24_airport", code, info)
        if info:
            out.update(info)
        return out

    def route(self, callsign):
        """Live route for a callsign, or None if Flightradar24 isn't tracking it with a route."""
        data = self._call(f"{self.base}/live/flight-positions/full?callsigns={quote(callsign)}")
        if data is None:
            return None                         # over the daily cap, paused, or nothing returned
        rows = data.get("data") or []
        f = next((r for r in rows if (r.get("callsign") or "").strip().upper() == callsign), None)
        if f is None and len(rows) == 1 and self.sandbox:
            f = rows[0]          # the sandbox returns fixed sample data whatever you ask for
        # Say what came back, so a wrong guess about the response format is easy to spot.
        if not rows:
            log.info("Flightradar24: no live flight found for %s", callsign)
            return None
        if f is None:
            log.warning("Flightradar24: %d result(s) for %s but none with that callsign; fields: %s",
                        len(rows), callsign, ", ".join(sorted(rows[0])))
            return None
        if not (f.get("orig_icao") or f.get("orig_iata")) or not (f.get("dest_icao") or f.get("dest_iata")):
            log.warning("Flightradar24: %s found but without origin/destination; fields: %s",
                        callsign, ", ".join(sorted(f)))
            return None
        log.info("Flightradar24: %s is %s -> %s", callsign, f.get("orig_iata") or f.get("orig_icao"),
                 f.get("dest_iata") or f.get("dest_icao"))
        return {
            "flight": f.get("flight") or callsign, "airline": None,
            "source": self.name, "source_label": self.label,
            "origin": self._airport(f.get("orig_icao"), f.get("orig_iata")),
            "dest": self._airport(f.get("dest_icao"), f.get("dest_iata")),
            "eta": _ts(f.get("eta")), "arrival_delay_s": None, "status": None,
            "progress_percent": None, "route_nm": None,
        }
