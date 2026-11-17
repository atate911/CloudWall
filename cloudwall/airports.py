"""Airport names, cities and positions from a bundled table (airportsdata, MIT licence),
so CloudWall never has to pay a flight-data service for them."""
import csv
import threading
from pathlib import Path

_TABLE = Path(__file__).resolve().parent / "data" / "airports.csv"
_by_code = None
_lock = threading.Lock()


def _load():
    global _by_code
    with _lock:
        if _by_code is None:
            table = {}
            with open(_TABLE, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    rec = {"iata": r["iata"], "icao": r["icao"], "name": r["name"], "city": r["city"],
                           "country": r["country"], "lat": float(r["lat"]), "lon": float(r["lon"]), "tz": r["tz"]}
                    table.setdefault(r["icao"], rec)
                    table.setdefault(r["iata"], rec)
            _by_code = table
    return _by_code


def lookup(code):
    """Airport record for an ICAO or IATA code, or None."""
    if not code:
        return None
    return _load().get(str(code).strip().upper())


def describe(icao=None, iata=None):
    """The route-end shape CloudWall uses, filled from the table where possible."""
    rec = lookup(icao) or lookup(iata)
    if rec:
        return {"iata": rec["iata"], "icao": rec["icao"], "city": rec["city"], "name": rec["name"],
                "lat": rec["lat"], "lon": rec["lon"], "tz": rec["tz"]}
    return {"iata": iata or icao, "icao": icao, "city": None, "name": None, "lat": None, "lon": None, "tz": None}
