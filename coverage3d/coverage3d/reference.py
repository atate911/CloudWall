"""Reference places for the map: airports, peaks and towns (bundled CSVs, optional OurAirports file)."""
from __future__ import annotations

import csv
import logging
from pathlib import Path

from . import geo

log = logging.getLogger("coverage3d.reference")
DATA = Path(__file__).parent / "data"
# always shown, whatever the airports file says
PINNED = {"PDX", "VUO", "HIO", "TTD", "SPB", "SLE", "EUG", "SEA", "BFI", "PAE", "YKM", "RDM"}


def _read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_airports(extra_csv: str = "") -> list[dict]:
    out = {}
    for r in _read(DATA / "airports.csv"):
        out[r["code"]] = {"code": r["code"], "icao": r["icao"], "name": r["name"],
                          "lat": float(r["lat"]), "lon": float(r["lon"]), "rank": int(r["rank"])}
    if extra_csv:
        try:
            for r in _read(extra_csv):
                # OurAirports airports.csv columns
                typ = r.get("type", "")
                rank = {"large_airport": 1, "medium_airport": 2}.get(typ)
                if rank is None and not (typ == "small_airport" and r.get("scheduled_service") == "yes"):
                    continue
                code = r.get("iata_code") or r.get("local_code") or r.get("ident")
                if not code or code in out:
                    continue
                out[code] = {"code": code, "icao": r.get("ident", ""), "name": r.get("name", ""),
                             "lat": float(r["latitude_deg"]), "lon": float(r["longitude_deg"]),
                             "rank": rank or 3}
        except Exception as e:
            log.warning("could not read airports_csv %s: %s", extra_csv, e)
    for a in out.values():
        if a["code"] in PINNED:
            a["rank"] = min(a["rank"], 2)
    return list(out.values())


def load_peaks():
    return [{"name": r["name"], "lat": float(r["lat"]), "lon": float(r["lon"]), "elev_ft": int(r["elev_ft"])}
            for r in _read(DATA / "peaks.csv")]


def load_places():
    return [{"name": r["name"], "lat": float(r["lat"]), "lon": float(r["lon"])} for r in _read(DATA / "places.csv")]


def nearest(places, lat, lon):
    best = min(places, key=lambda p: geo.haversine_nm(lat, lon, p["lat"], p["lon"]))
    return best, geo.haversine_nm(lat, lon, best["lat"], best["lon"])
