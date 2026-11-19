"""What CloudWall knows of each airline, from one table (data/airlines.csv): the code its
flights are sold under, its name, whether it flies freight only, and its livery's colours.

Airlines are known by the three-letter ICAO code their callsigns start with (ASA512 is Alaska).
Everything that needs a fact about an airline asks here, so the table is the one place to add
one. The airline's logo is fetched by logos.py, under the code this gives it.
"""
import csv
import re
import threading
from pathlib import Path

_TABLE = Path(__file__).resolve().parent / "data" / "airlines.csv"
_airlines = None
_lock = threading.Lock()

CALLSIGN = re.compile(r"^([A-Z]{3})\d")                    # an airline's: its code, then a flight number
SCHEDULED = re.compile(r"^[A-Z]{3}\d[0-9A-Z]{0,4}$")       # and nothing but: one a route can be looked up for
NUMBER = re.compile(r"^([A-Z]{3})0*(\d{1,4}[A-Z]?)$")
IATA = re.compile(r"^[A-Z0-9]{2}$")
SAME_AS = {"QX": "AS"}      # brands that fly under another airline's name and have no logo of their own


def _table():
    global _airlines
    with _lock:
        if _airlines is None:
            with open(_TABLE, newline="", encoding="utf-8") as f:
                _airlines = {r["icao"]: r for r in csv.DictReader(line for line in f if not line.startswith("#"))}
    return _airlines


def code(callsign):
    """'ASA512' -> 'ASA': the airline's ICAO code, if the callsign is an airline's; else None
    (a tail number, a military callsign)."""
    m = CALLSIGN.match(callsign or "")
    return m.group(1) if m else None


def scheduled(callsign):
    """Is this a callsign in an airline's form, the only kind a route can be looked up for?"""
    return bool(SCHEDULED.match(callsign or ""))


def name(icao):
    """'ASA' -> 'Alaska Airlines', or None for an airline the table has no name for."""
    return (_table().get(icao) or {}).get("name") or None


def cargo(icao):
    """Does this airline fly freight only?"""
    return bool((_table().get(icao) or {}).get("cargo"))


def colors(callsign):
    """[main, accent] of the airline's livery, for a callsign of one the table has colours for; else None."""
    a = _table().get(code(callsign))
    return [a["color"], a["accent"]] if a and a["color"] else None


def _iata(icao):
    """The airline's IATA code: '' where it is known to have none, None where the table doesn't say."""
    a = _table().get(icao)
    return None if not a or not a["iata"] else "" if a["iata"] == "-" else a["iata"]


def iata_for(callsign, route_iata=None):
    """The IATA code to show a logo for, or None. route_iata: the route database's code for the
    flight, trusted only for an airline-style callsign the table doesn't know."""
    icao = code(callsign)
    found = _iata(icao) if icao else None
    if found is None:
        found = route_iata if icao else None
    found = SAME_AS.get(found or "", found)
    return found if found and IATA.match(found) else None


def flight_number(callsign):
    """'ASA508' -> 'AS508': the airline-code form shown on departure boards, or None."""
    m = NUMBER.match(callsign or "")
    found = _iata(m.group(1)) if m else None
    return f"{found}{m.group(2)}" if found else None
