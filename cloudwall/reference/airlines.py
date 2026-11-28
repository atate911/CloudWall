"""Airlines by the three-letter ICAO code their callsigns start with, from data/airlines.csv
(IATA code, name, cargo-only, livery colours): the one place to add a fact about an airline.
"""
import csv
import re
import threading

from ..core import paths

_TABLE = paths.DATA / "airlines.csv"
_airlines = None
_lock = threading.Lock()

CALLSIGN = re.compile(r"^([A-Z]{3})\d")                    # an airline's: its code, then a flight number
SCHEDULED = re.compile(r"^[A-Z]{3}\d[0-9A-Z]{0,4}$")       # and nothing but: one a route can be looked up for
NUMBER = re.compile(r"^([A-Z]{3})0*(\d{1,4}[A-Z]?)$")
IATA = re.compile(r"^[A-Z0-9]{2}$")
SAME_AS = {"QX": "AS"}      # IATA: brands with no logo of their own
# ICAO: airlines that only ever fly as another (not a partner flying for several, like SkyWest)
FLIES_AS = {"QXE": "ASA"}


def _table():
    global _airlines
    with _lock:
        if _airlines is None:
            with open(_TABLE, newline="", encoding="utf-8") as f:
                _airlines = {r["icao"]: r for r in csv.DictReader(line for line in f if not line.startswith("#"))}
    return _airlines


def code(callsign):
    """'ASA512' -> 'ASA'; None if the callsign isn't an airline's."""
    m = CALLSIGN.match(callsign or "")
    return m.group(1) if m else None


def scheduled(callsign):
    """Is this a callsign in an airline's form, the only kind a route can be looked up for?"""
    return bool(SCHEDULED.match(callsign or ""))


def name(icao):
    """'ASA' -> 'Alaska Airlines', or None."""
    return (_table().get(icao) or {}).get("name") or None


def flies_as(icao):
    """'QXE' -> 'ASA': the airline this one's flights are sold and painted as, or None."""
    return FLIES_AS.get(icao or "")


def cargo(icao):
    """Freight only?"""
    return bool((_table().get(icao) or {}).get("cargo"))


def colors(callsign):
    """[main, accent] of the airline's livery, or None."""
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
