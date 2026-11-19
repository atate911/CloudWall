"""What CloudWall knows of each aircraft type, by its ICAO type designator (B738, C172).

From two tables: data/types.csv, with each type's broad shape and overall length (which the
display's drawings are scaled and, where a type has none of its own, chosen by) and whether it is
a rare sight; and data/cwt.csv, the FAA's Consolidated Wake Turbulence categories, A (super, the
A380) to I (small, a Cessna 172), as a STARS data block shows them beside the ground speed (see
tools/build_data.py). The display keeps no table of its own: each record it draws carries these.
"""
import csv
import threading
from pathlib import Path

_DATA = Path(__file__).resolve().parent / "data"
_types = None
_cwt = None
_lock = threading.Lock()

# The transponder's own emitter category, for a type the table doesn't have: light, small, large,
# high-vortex large, heavy, high-performance, rotorcraft.
BY_CATEGORY = {"A1": ("piston", 8), "A2": ("bizjet", 16), "A3": ("narrow", 38), "A4": ("narrow", 47),
               "A5": ("wide", 62), "A6": ("fighter", 19), "A7": ("heli", 12)}
ANY = ("narrow", 36)        # and with nothing to go on at all, a single-aisle airliner


def _rows(name):
    with open(_DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def _table():
    global _types
    with _lock:
        if _types is None:
            _types = {r["type"]: r for r in _rows("types.csv")}
    return _types


def shape(type_code, category=None):
    """{"shape", "length" (m), "known"} for a type: from the table, else (known False) from the
    transponder's category, else a single-aisle airliner's."""
    t = _table().get(str(type_code or "").upper())
    if t and t["shape"]:
        return {"shape": t["shape"], "length": float(t["length_m"]), "known": True}
    kind, length = BY_CATEGORY.get(category, ANY)
    return {"shape": kind, "length": length, "known": False}


def rare(type_code):
    """Is this a type worth remarking on when it comes overhead?"""
    return bool((_table().get(str(type_code or "").upper()) or {}).get("rare"))


def wake(type_code):
    """The type's wake category, A to I. A type not in the table has none: STARS leaves the
    place blank then too."""
    global _cwt
    with _lock:
        if _cwt is None:
            _cwt = {r["type"]: r["cwt"] for r in _rows("cwt.csv")}
    return _cwt.get(str(type_code or "").upper())
