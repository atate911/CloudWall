"""What every aircraft is doing (arriving, departing, local, passing), the arrivals' landing
order with runway and time, and what is notable (military, rare, medical: medical.py).
"""
import math

from ..core import geo
from . import medical
from ..reference import aircraft

# kinds that, with no route, are flying locally (a turboprop with no route is more likely passing through)
LOCAL_KINDS = {"heli", "tandem", "glider", "balloon", "light", "gyro", "ultralight", "twin",
               "seaplane", "airship", "drone"}
UNUSUAL_KINDS = {"balloon", "airship", "glider", "tandem", "tiltrotor", "gyro"}
TAIL_S = 120                # seconds of every aircraft's recent track a screen gets
TAIL_POINTS = 16            # at most this many points of it
FINAL_LATERAL_NM = 2.5      # this close to the extended centreline, and pointing down it, is on final
FINAL_JOIN_NM = 6           # an arrival not yet on final is reckoned to join it this far out


def activity(a, iata, field_ft=0):
    """"arr", "dep", "loc" or "pass": from a believable route, else how it flies near the airport
    (details.infer_local), else its kind. Traffic of the small fields nearby is "loc"."""
    r = a.get("route") if (a.get("route") or {}).get("plausible") else None
    v, alt = a.get("vrate") or 0, (a.get("alt") or 0) - field_ft        # height above the airport
    if a.get("local_field"):
        return "loc"
    if a.get("local") == "arriving" or (r and r["dest"].get("iata") == iata and v <= 300 and alt < 14000):
        return "arr"
    if a.get("local") == "departing" or (r and r["origin"].get("iata") == iata and v >= -300 and alt < 20000):
        return "dep"
    if not r and (a.get("squawk") == "1200" or a.get("icon") in LOCAL_KINDS or a.get("local") == "local"):
        return "loc"
    return "pass"


def notable(a):
    """Why this aircraft is worth a look, or None."""
    if a.get("emergency"):
        return "emergency"
    if a.get("medical"):
        return "medical"
    if a.get("military"):
        return "military"
    if aircraft.rare(a.get("type")):
        return "rare"
    if a.get("icon") in UNUSUAL_KINDS:
        return "unusual"
    return None


def landing_ways(airport, flow):
    """[(name, threshold lat, lon, landing direction in degrees)]: the runways in use when the
    flow is known, else every runway end."""
    ways = []
    for w in airport.get("runways") or []:
        (lat1, lon1), (lat2, lon2) = w["ends"]
        first, second = w["name"].split("/")
        h = geo.bearing_deg(lat1, lon1, lat2, lon2)          # landing on the first-named end
        ways += [(first, lat1, lon1, h), (second, lat2, lon2, (h + 180) % 360)]
    if flow and flow.get("runways"):
        used = {n.strip() for n in flow["runways"].split("/")}
        ways = [w for w in ways if w[0] in used] or ways
    return ways


def _xy(lat0, lon0, lat, lon):
    """A point from another, as (nm east, nm north)."""
    return (lon - lon0) * 60 * math.cos(math.radians(lat0)), (lat - lat0) * 60


def _to_runway(a, ways):
    """(runway an arrival is lining up for, nm to fly to touchdown): on final, the distance along
    it; otherwise via a point FINAL_JOIN_NM out on the best-suited runway's final."""
    off = lambda x, y: abs((x - y + 180) % 360 - 180)
    best = None
    for name, lat, lon, hdg in ways:
        ux, uy = math.sin(math.radians(hdg)), math.cos(math.radians(hdg))
        px, py = _xy(lat, lon, a["lat"], a["lon"])
        along = -(px * ux + py * uy)                                          # nm out from the threshold
        lateral = abs(px * uy - py * ux)
        track = a.get("track")
        aligned = track is not None and off(track, hdg) < 40
        if along > 0 and lateral < FINAL_LATERAL_NM and aligned:
            cost, togo = lateral, along
        else:
            jx, jy = -ux * FINAL_JOIN_NM, -uy * FINAL_JOIN_NM
            to_join = math.hypot(px - jx, py - jy)
            cost, togo = 10 + to_join, to_join + FINAL_JOIN_NM
        if not best or cost < best[0]:
            best = (cost, name, togo)
    return best[1], best[2]


def sequence(arrivals, airport, flow):
    """Sort the arrivals into landing order, setting "rwy", "lands_s" (seconds to touchdown),
    "seq" (from 1) and "gap_s" (seconds behind the one ahead; None for the first)."""
    ways = landing_ways(airport, flow)
    if not ways:
        return
    for a in arrivals:
        a["rwy"], togo = _to_runway(a, ways)
        a["lands_s"] = round(togo / max((a.get("gs") or 140) * 0.85, 60) * 3600)
    arrivals.sort(key=lambda a: a["lands_s"])
    for i, a in enumerate(arrivals):
        a["seq"] = i + 1
        a["gap_s"] = a["lands_s"] - arrivals[i - 1]["lands_s"] if i else None


def tail(points, trail_s):
    """The last TAIL_S seconds of positions as [lat, lon] pairs, oldest first, thinned to TAIL_POINTS."""
    n = max(2, math.ceil(TAIL_S / max(trail_s or 5, 1)))
    pts = list(points)[-n:]
    step = max(1, math.ceil(len(pts) / TAIL_POINTS))
    out = pts[::-1][::step][::-1]                  # keep the newest point, thin the older ones
    return [list(p) for p in out]


def describe(aircraft_list, airport, flow, said=None):
    """Set every airborne aircraft's activity and notable, and the arrivals' landing order,
    clearing what an earlier update said. said: the tracker's hospital claims (medical.mark)."""
    iata = airport.get("iata")
    arrivals = []
    for a in aircraft_list:
        for k in ("notable", "rwy", "lands_s", "seq", "gap_s"):
            a.pop(k, None)
    medical.mark(aircraft_list, airport.get("helipads") or [], said)
    for a in aircraft_list:
        if a.get("on_ground"):
            continue
        a["activity"] = activity(a, iata, airport.get("elevation_ft") or 0)
        why = notable(a)
        if why:
            a["notable"] = why
        if a["activity"] == "arr":
            arrivals.append(a)
    sequence(arrivals, airport, flow)
