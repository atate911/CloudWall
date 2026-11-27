"""Which channel an aircraft is probably on.

No feed says what frequency an aircraft is tuned to, but where it is and what it is doing narrow it
down: on the ground at the airport it talks to ground; on short final or just off the runway, to
the tower; inside about 40 nm and below about 15,000 ft, to approach or departure; above or beyond
that, to the en-route centre; around a field with no tower, on its common traffic frequency.

This is the first of three ways of knowing, each better than the last, planned in README.md: these
rules; then what the transcripts teach (an aircraft's callsign heard on a channel, where it was at
the time, so each approach sector is learned by direction and height); then the handoff itself
("contact Portland Tower one one eight point seven"), which names the next channel outright.
"""
from ..core import geo

TOWER_NM = 6             # inside this and below TOWER_AGL_FT, an airborne aircraft is the tower's
TOWER_AGL_FT = 3000
TERMINAL_NM = 40         # inside this and below TERMINAL_FT, approach or departure's
TERMINAL_FT = 15000


def likely_kinds(a, airport, towered=True):
    """Channel kinds, most likely first, for the aircraft `a` (as the tracker has it: lat, lon, alt,
    on_ground, and "local" when it is known to be arriving or departing) and the airport (a dict
    with lat, lon and elevation_ft)."""
    dist = geo.haversine_nm(airport["lat"], airport["lon"], a["lat"], a["lon"])
    if not towered:
        return ["ctaf", "unicom", "approach"] if dist < TERMINAL_NM else ["center"]
    if a.get("on_ground"):
        return ["ground", "tower", "clearance"] if dist < 3 else []
    alt = a.get("alt")
    if alt is None:
        return ["approach", "center"]
    agl = alt - airport.get("elevation_ft", 0)
    going = a.get("local")
    if dist <= TOWER_NM and agl <= TOWER_AGL_FT:
        return ["tower", "departure" if going == "departing" else "approach"]
    if dist <= TERMINAL_NM and alt <= TERMINAL_FT:
        if going == "departing":
            return ["departure", "approach", "center"]
        return ["approach", "departure", "tower", "center"]
    return ["center", "approach"]


def likely_channels(a, airport, channels, towered=None):
    """The channels of `channels` the aircraft is likely on, most likely first.

    Many airports list approach and departure as one, so a kind with no channel of its own falls
    back to its partner; within a kind, the channels of the airport itself come first."""
    ident = airport.get("icao", "")
    if towered is None:
        towered = any(c.kind == "tower" and c.airport == ident for c in channels)
    out = []
    for kind in likely_kinds(a, airport, towered):
        found = [c for c in channels if c.kind == kind]
        found.sort(key=lambda c: (c.airport != ident, c.freq))
        out += [c for c in found if c not in out]
    return out
