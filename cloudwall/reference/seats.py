"""Estimated seats on board from the operator and aircraft type (bundled table, no lookups)."""
import csv
import importlib.resources

from . import airlines

_TABLE = None


def _table():
    global _TABLE
    if _TABLE is None:
        rows = {}
        text = importlib.resources.files("cloudwall").joinpath("data/seats.csv").read_text()
        lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
        for r in csv.DictReader(lines):
            rows[(r["airline"], r["type"])] = (int(r["typical"]), int(r["lo"]), int(r["hi"]))
        _TABLE = rows
    return _TABLE


def seats(operator, type_code):
    """{'n', 'lo', 'hi', 'basis'} or None. basis is 'airline' (this airline's layout),
    'type' (typical for the type), or 'cargo' (n is 0)."""
    if airlines.cargo(operator):      # freight only: no passenger seats to count
        return {"n": 0, "lo": 0, "hi": 0, "basis": "cargo"}
    if not type_code:
        return None
    t = _table()
    for key, basis in (((operator, type_code), "airline"), (("*", type_code), "type")):
        if operator is None and basis == "airline":
            continue
        if key in t:
            n, lo, hi = t[key]
            return {"n": n, "lo": lo, "hi": hi, "basis": basis}
    return None
