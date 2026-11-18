"""Aircraft types' wake categories: the FAA's Consolidated Wake Turbulence categories, A (super,
the A380) to I (small, a Cessna 172), as a STARS data block shows them beside the ground speed.
From data/cwt.csv (see tools/build_data.py). A type not in the table has none: STARS leaves the
place blank then too."""
import csv
import threading
from pathlib import Path

_TABLE = Path(__file__).resolve().parent / "data" / "cwt.csv"
_cwt = None
_lock = threading.Lock()


def category(icao_type):
    global _cwt
    with _lock:
        if _cwt is None:
            with open(_TABLE, newline="", encoding="utf-8") as f:
                _cwt = {r["type"]: r["cwt"] for r in csv.DictReader(line for line in f if not line.startswith("#"))}
    return _cwt.get(str(icao_type or "").upper())
