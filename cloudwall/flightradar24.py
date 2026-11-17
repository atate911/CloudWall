"""Live routes from the official Flightradar24 API.

Routes come from the flight-summary endpoint, which reports the flight actually in the
air (origin, destination, takeoff time, operating and marketing airline) for 1 credit,
an eighth of what the live-positions endpoint costs. Airport details come from the
bundled airport table instead of the 50-credit airport endpoint.

Published prices (credits): flight-summary/light 1 per live flight returned, 2 per
finished flight up to 30 days old, and 1 for an empty result."""
import datetime as dt
import logging
import threading
import time
from urllib.parse import quote, urlencode

from . import airports
from .http import get_json
from .live import LiveProvider

log = logging.getLogger("cloudwall.flightradar24")
BASE = "https://fr24api.flightradar24.com/api"
USAGE_EVERY = 3600


def _ts(value):
    if isinstance(value, (int, float)):
        return float(value)
    try:
        v = value.replace("Z", "+00:00") if value else None
        d = dt.datetime.fromisoformat(v) if v else None
        if d and d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)       # the API's times are UTC
        return d.timestamp() if d else None
    except (ValueError, AttributeError):
        return None


def summary_cost(data):
    """Credits a flight-summary/light response cost, per Flightradar24's price list."""
    rows = (data or {}).get("data") or []
    if not rows:
        return 1
    return sum(1 if not r.get("flight_ended") else 2 for r in rows)


class Flightradar24(LiveProvider):
    name, label, env_key = "flightradar24", "Flightradar24", "CLOUDWALL_FR24_KEY"
    unit = "credits"
    default_daily = 300
    max_cost = 2          # one row, which costs 2 if it turns out to be a finished flight

    def __init__(self, cfg, store):
        super().__init__(cfg, store)
        self.sandbox = bool(cfg.get(self.name, {}).get("sandbox", False))
        self.base = f"{BASE}/sandbox" if self.sandbox else BASE
        self._usage_at = 0
        if self.enabled and not self.sandbox:
            threading.Thread(target=self._usage_loop, daemon=True).start()

    def headers(self):
        return {"Authorization": f"Bearer {self.key}", "Accept-Version": "v1"}

    # -- what Flightradar24 says we've spent ------------------------------------
    def _usage_loop(self):
        while True:
            try:
                self.reported = self.fetch_usage()
            except Exception as e:
                log.info("Flightradar24 usage check failed: %s", e)
            time.sleep(USAGE_EVERY)

    def fetch_usage(self):
        out = {}
        for period in ("24h", "30d"):
            data = get_json(f"{self.base}/usage?period={period}", headers=self.headers()) or {}
            out[period] = sum(int(r.get("credits") or 0) for r in data.get("data") or [])
        out["checked"] = time.time()
        log.info("Flightradar24 reports %s credits used in the last 24 h, %s in 30 days", out["24h"], out["30d"])
        return out

    # -- routes -----------------------------------------------------------------
    def route(self, callsign):
        """Route of the flight in the air now with this callsign, or None."""
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        q = {"callsigns": callsign, "flight_datetime_from": (now - dt.timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%S"),
             "flight_datetime_to": now.strftime("%Y-%m-%dT%H:%M:%S"), "sort": "desc", "limit": 1}
        data = self._call(f"{self.base}/flight-summary/light?{urlencode(q)}", actual_cost=summary_cost)
        if data is None:
            return None                         # over budget, paused, or nothing returned
        rows = data.get("data") or []
        f = next((r for r in rows if (r.get("callsign") or "").strip().upper() == callsign), None)
        if f is None and rows and self.sandbox:
            f = rows[0]          # the sandbox returns fixed sample data whatever you ask for
        # Say what came back, so a surprise in the response is easy to spot.
        if not rows:
            log.info("Flightradar24: no flight found for %s", callsign)
            return None
        if f is None:
            log.warning("Flightradar24: %d result(s) for %s but none with that callsign; fields: %s",
                        len(rows), callsign, ", ".join(sorted(rows[0])))
            return None
        if f.get("flight_ended"):
            log.info("Flightradar24: latest %s flight has already landed; the current one isn't tracked yet", callsign)
            return None
        orig = f.get("orig_icao") or f.get("origin_icao") or f.get("orig_iata")
        dest = (f.get("dest_icao_actual") or f.get("destination_icao_actual") or f.get("dest_icao")
                or f.get("destination_icao") or f.get("dest_iata"))
        if not orig or not dest:
            log.warning("Flightradar24: %s found but without origin/destination; fields: %s",
                        callsign, ", ".join(sorted(f)))
            return None
        o, d = airports.describe(icao=orig), airports.describe(icao=dest)
        log.info("Flightradar24: %s is %s -> %s", callsign, o["iata"], d["iata"])
        return {
            "flight": f.get("flight") or callsign, "airline": None,
            "source": self.name, "source_label": self.label,
            "origin": o, "dest": d,
            "departed": _ts(f.get("datetime_takeoff")), "landed": _ts(f.get("datetime_landed")),
            "eta": None, "arrival_delay_s": None, "status": None, "progress_percent": None, "route_nm": None,
            "operating_as": f.get("operating_as") or f.get("operated_as"), "painted_as": f.get("painted_as"),
        }
