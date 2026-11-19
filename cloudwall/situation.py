"""What every aircraft in the area is doing, so a screen can show the whole picture at a glance:
arriving at the place's airport, departing from it, flying locally, or passing over on its way
somewhere else. Arrivals are put in landing order, each with the runway it is lining up for, about
when it lands and how far behind the one ahead it is. And anything worth a look (military, a rare
type, a balloon) is marked as such.

Every screen draws these the same way, in the same four colours: the radar, the lists, the Board,
the wall panel and the phone.
"""
import math

from . import aircraft, geo

# Kinds of aircraft that, with no flight plan to say otherwise, are flying locally: sightseeing,
# training, a medical or news helicopter, a balloon.
LOCAL_KINDS = {"heli", "tandem", "glider", "balloon", "light", "gyro", "ultralight", "twin", "turboprop",
               "seaplane", "airship", "drone"}
# Worth pointing out to the household even when nothing about the flight is unusual.
UNUSUAL_KINDS = {"balloon", "airship", "glider", "tandem", "tiltrotor", "gyro"}
TAIL_S = 120                # how much of every aircraft's recent track a screen gets, in seconds
TAIL_POINTS = 16            # at most this many points of it
FINAL_LATERAL_NM = 2.5      # this close to a runway's extended centreline, and pointing down it, is on final
FINAL_JOIN_NM = 6           # an arrival not yet on final is reckoned to join it this far out


def activity(a, iata):
    """"arr", "dep", "loc" or "pass": what this aircraft is doing, from its route when it has a
    believable one, else from how it is flying near the airport (details.infer_local), else from
    its kind. Light aircraft into and out of the small fields nearby fly locally, as far as the
    big airport is concerned."""
    r = a.get("route") if (a.get("route") or {}).get("plausible") else None
    v, alt = a.get("vrate") or 0, a.get("alt") or 0
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
    """Why this aircraft is worth a look, or None: an emergency, military, a rare type, or a kind
    seldom seen (a balloon, a glider, a twin-rotor helicopter)."""
    if a.get("emergency"):
        return "emergency"
    if a.get("military"):
        return "military"
    if aircraft.rare(a.get("type")):
        return "rare"
    if a.get("icon") in UNUSUAL_KINDS:
        return "unusual"
    return None


def landing_ways(airport, flow):
    """The runways arrivals land on, each as (name, threshold lat/lon, landing direction in degrees):
    those in use when the flow is known, else every runway end."""
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
    """Where a point is from another, in nm east and north."""
    return (lon - lon0) * 60 * math.cos(math.radians(lat0)), (lat - lat0) * 60


def _to_runway(a, ways):
    """The runway an arrival is lining up for and how far it has to fly to touch down, in nm.
    On final (close to the extended centreline, ahead of the threshold, pointing down it) that is
    the distance along it; otherwise the way to a point FINAL_JOIN_NM out on the runway's final
    whose direction suits it best, and then down it."""
    off = lambda x, y: abs((x - y + 180) % 360 - 180)
    best = None
    for name, lat, lon, hdg in ways:
        ux, uy = math.sin(math.radians(hdg)), math.cos(math.radians(hdg))      # the landing direction
        px, py = _xy(lat, lon, a["lat"], a["lon"])
        along = -(px * ux + py * uy)                                          # nm out from the threshold
        lateral = abs(px * uy - py * ux)
        track = a.get("track")
        aligned = track is not None and off(track, hdg) < 40
        if along > 0 and lateral < FINAL_LATERAL_NM and aligned:
            cost, togo = lateral, along
        else:
            jx, jy = -ux * FINAL_JOIN_NM, -uy * FINAL_JOIN_NM                # the join point
            to_join = math.hypot(px - jx, py - jy)
            cost, togo = 10 + to_join, to_join + FINAL_JOIN_NM
        if not best or cost < best[0]:
            best = (cost, name, togo)
    return best[1], best[2]


def sequence(arrivals, airport, flow):
    """Put the arrivals in landing order: each gets its runway ("rwy"), seconds to touchdown
    ("lands_s", slowing as it comes in), its place in the order ("seq", from 1) and the seconds
    since the one ahead lands ("gap_s", None for the first)."""
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
    """The last TAIL_S seconds of an aircraft's reported positions, as [lat, lon] pairs oldest
    first, thinned to TAIL_POINTS: enough for the radar to draw a short fading track behind it."""
    n = max(2, math.ceil(TAIL_S / max(trail_s or 5, 1)))
    pts = list(points)[-n:]
    step = max(1, math.ceil(len(pts) / TAIL_POINTS))
    out = pts[::-1][::step][::-1]                  # keep the newest point, thin the older ones
    return [list(p) for p in out]


def describe(aircraft_list, airport, flow):
    """Mark every airborne aircraft with what it is doing, and the arrivals with their landing order."""
    iata = airport.get("iata")
    arrivals = []
    for a in aircraft_list:
        if a.get("on_ground"):
            continue
        a["activity"] = activity(a, iata)
        why = notable(a)
        if why:
            a["notable"] = why
        if a["activity"] == "arr":
            arrivals.append(a)
    sequence(arrivals, airport, flow)
