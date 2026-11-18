"""Airport names, cities and positions from a bundled table (airportsdata, MIT licence),
so CloudWall never has to pay a flight-data service for them, plus the small fields that table
leaves out (fields.csv) and every airport's runways (runways.csv, from OurAirports)."""
import csv
import threading
from pathlib import Path

_TABLE = Path(__file__).resolve().parent / "data" / "airports.csv"
_FIELDS = Path(__file__).resolve().parent / "data" / "fields.csv"
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
            # small fields by their own code (VUO, 1W1), which no airline airport's code displaces
            with open(_FIELDS, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(line for line in f if not line.startswith("#")):
                    rec = {"iata": "", "icao": r["icao"], "code": r["code"], "name": r["name"], "city": r["city"],
                           "country": r["country"], "lat": float(r["lat"]), "lon": float(r["lon"]), "tz": r["tz"],
                           "elevation_ft": int(r["elevation_ft"]) if r["elevation_ft"] else None}
                    table.setdefault(r["icao"], rec)
                    table.setdefault(r["code"], rec)
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


# -- runways (OurAirports, public domain; see tools/build_runways.py) ------------
_RUNWAYS = Path(__file__).resolve().parent / "data" / "runways.csv"
_runways = None


def _pad(ident):
    """"3" -> "03", "3L" -> "03L": runway numbers as charts print them."""
    return "0" + ident if ident[:1].isdigit() and not ident[1:2].isdigit() else ident


def _load_runways():
    global _runways
    with _lock:
        if _runways is None:
            table = {}
            with open(_RUNWAYS, newline="", encoding="utf-8") as f:
                rows = csv.DictReader(line for line in f if not line.startswith("#"))
                for r in rows:
                    table.setdefault(r["icao"], []).append({
                        "name": f"{_pad(r['le'])}/{_pad(r['he'])}",
                        "ends": [[float(r["le_lat"]), float(r["le_lon"])], [float(r["he_lat"]), float(r["he_lon"])]],
                        "length_ft": int(r["length_ft"]),
                        "elev_ft": int(r["elev_ft"]) if r["elev_ft"] else None})
            for rws in table.values():
                rws.sort(key=lambda w: -w["length_ft"])
            _runways = table
    return _runways


def runways(icao):
    """The airport's runways, longest first: name ("10R/28L"), ends [[lat, lon], [lat, lon]] in
    the order the name gives them, and length. Empty for an airport not in the table."""
    return [{k: w[k] for k in ("name", "ends", "length_ft")} for w in _load_runways().get(str(icao or "").upper(), [])]


def elevation_ft(icao):
    """The field's elevation, from its longest runway with one on record, else the field's own, or None."""
    code = str(icao or "").upper()
    rec = _load().get(code)
    return next((w["elev_ft"] for w in _load_runways().get(rec["icao"] if rec else code, []) if w["elev_ft"] is not None),
                rec.get("elevation_ft") if rec else None)


def nearby(lat, lon, radius_nm, exclude=()):
    """Airports in the table within radius_nm, nearest first, in the shape of [airport] others."""
    from .geo import haversine_nm
    skip = {str(c).upper() for c in exclude if c}
    out, seen = [], set()
    for rec in _load().values():
        if id(rec) in seen or rec["icao"] in skip or rec["iata"] in skip:
            continue
        seen.add(id(rec))
        d = haversine_nm(lat, lon, rec["lat"], rec["lon"])
        if d <= radius_nm:
            out.append((d, {"code": rec.get("code") or rec["iata"] or rec["icao"], "icao": rec["icao"], "name": rec["name"],
                            "city": rec["city"], "lat": rec["lat"], "lon": rec["lon"],
                            "elevation_ft": elevation_ft(rec["icao"])}))
    return [f for _, f in sorted(out, key=lambda x: x[0])]
