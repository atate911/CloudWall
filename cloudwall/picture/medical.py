"""Medical flights. An aircraft is medical by its transponder ("lifeguard"), its operator or
callsign, or (a helicopter) by landing at or leaving a hospital helipad: many air ambulances
are registered to a bank or trust. One with nothing medical in its name must be right at the
helipad (UNNAMED_NM, UNNAMED_FT) on CONFIRM updates running, so a news or police helicopter
passing a hospital isn't one. A hospital claim is kept while the helicopter stays on course.
"""
import logging
import math
import re
import time

from ..core import geo

log = logging.getLogger("cloudwall.medical")

NAMES = re.compile(r"life ?flight|life ?net\b|life ?line|life ?star|life ?team|life ?guard|mercy ?flight|med ?i?evac|"
                   r"med ?flight|med[- ]?trans\b|air ?methods|air ?medic|air ?ambulance|ambulance|air ?evac|"
                   r"care ?fli(ght|te)|air ?care\b|airlift northwest|calstar|guardian flight|helimed|"
                   r"hospital|medical cent|health ?system|\bhems\b|\bems\b", re.I)
# not REACH: the US Air Force's airlifters
CALLSIGNS = re.compile(r"^(LIFE|LIFEGD|MERCY|MEDEVAC|MEDIVAC|MEDVAC|AIREVAC)\d", re.I)
HELICOPTERS = {"heli", "tandem"}
LANDING_NM, LEFT_NM, LOW_FT = 2.5, 1.5, 1500       # near and low enough over a helipad to be landing or leaving
HEADING_NM = 25                                     # how far ahead a helipad can be to say it's heading for it
UNNAMED_NM, UNNAMED_FT = 1.0, 800                   # for one with nothing medical in its name
CONFIRM = 2                                         # updates running such a helicopter must be seen there
KEEP_S = 120                                        # how long a claim is remembered without being seen

# hex -> (helipad code, state, when, updates running). Each Tracker keeps its own (places run on
# their own threads); this one is for callers without a tracker.
_said = {}


def by_name(a):
    """Is this an air ambulance by its transponder, operator or callsign?"""
    if a.get("military"):
        return False
    if a.get("emergency_status") == "lifeguard":
        return True
    text = " ".join(str(a.get(k) or "") for k in ("owner", "owner_op", "operated_by", "airline"))
    return bool(NAMES.search(text) or CALLSIGNS.match(a.get("callsign") or ""))


def _where(a, p):
    """(distance to a helipad in nm, degrees it lies off the track, nm the line of flight misses it by)."""
    d = geo.haversine_nm(a["lat"], a["lon"], p["lat"], p["lon"])
    off = abs((geo.bearing_deg(a["lat"], a["lon"], p["lat"], p["lon"]) - a["track"] + 180) % 360 - 180)
    return d, off, d * math.sin(math.radians(min(off, 90)))


def hospital(a, pads, medical, said=None):
    """The helipad a helicopter is landing at, has just left or (if medical) is heading for, or
    None: {code, name, short, city, lat, lon, state: "landing" | "left" | "heading", dist_nm,
    eta_s, seen}. medical: an air ambulance by name. seen: updates running the same was said.
    said: the claims so far, kept between updates."""
    said = _said if said is None else said
    if a.get("icon") not in HELICOPTERS or a.get("on_ground") or a.get("lat") is None or a.get("track") is None:
        return None
    gs, v, alt = a.get("gs") or 0, a.get("vrate") or 0, a.get("alt")
    landing, left, ahead = [], [], []
    for p in pads:
        d, off, cross = _where(a, p)
        agl = None if alt is None else alt - (p.get("elevation_ft") or 0)
        low = agl is not None and -300 < agl < (LOW_FT if medical else UNNAMED_FT)   # not well below it (a helipad on a hill)
        if (d <= (LANDING_NM if medical else UNNAMED_NM) and low and agl < (500 if medical else 300) + 400 * d
                and v < -150 and (off < (40 if medical else 25) or d < 0.3)):
            landing.append((d, p))
        elif d <= (LEFT_NM if medical else UNNAMED_NM) and low and v > 150 and off > 100:
            left.append((d, p))
        elif medical and gs > 40 and d <= HEADING_NM and off < 90 and d > 0.5:
            ahead.append((cross / (0.3 + 0.04 * d), d, p))       # its line's miss, over what's allowed at that range
    pick = None
    if landing:
        d, p = min(landing, key=lambda x: x[0])
        pick = (p, "landing", d)
    elif left:
        d, p = min(left, key=lambda x: x[0])
        pick = (p, "left", d)
    elif ahead:
        ahead.sort(key=lambda x: x[0])
        was = said.get(a["hex"])
        kept = [x for x in ahead if was and x[2]["code"] == was[0] and was[1] == "heading" and x[0] <= 2]
        if kept:                                      # still roughly on course for the same one
            pick = (kept[0][2], "heading", kept[0][1])
        elif ahead[0][0] <= 1 and not (len(ahead) > 1 and ahead[1][0] <= 1):
            pick = (ahead[0][2], "heading", ahead[0][1])  # one helipad on its line, and only one
    if not pick:
        said.pop(a["hex"], None)
        return None
    p, state, d = pick
    was = said.get(a["hex"])
    seen = was[3] + 1 if was and was[:2] == (p["code"], state) else 1
    said[a["hex"]] = (p["code"], state, time.time(), seen)
    out = {k: p.get(k) for k in ("code", "name", "short", "city", "lat", "lon")}
    out.update(state=state, dist_nm=round(d, 1), seen=seen)
    if state != "left" and gs > 20:
        out["eta_s"] = round(d / gs * 3600)
    return out


def mark(aircraft, pads, said=None):
    """Set `medical` and a helicopter's `hospital` on the airborne aircraft, clearing what an
    earlier update said. A `coasting` aircraft stays medical if it was, but gets no hospital."""
    said = _said if said is None else said
    now = time.time()
    for hexid in [h for h, s in said.items() if now - s[2] > KEEP_S]:
        del said[hexid]
    for a in aircraft:
        was = a.pop("medical", None)
        a.pop("hospital", None)
        if a.get("on_ground"):
            continue
        try:
            named = by_name(a)
            if a.get("coasting"):
                if named or was:
                    a["medical"] = True
                continue
            h = hospital(a, pads, named, said) if pads else None
            if h and not named and h.pop("seen") < CONFIRM:
                h = None                # once could be chance
            if h:                       # said for a military helicopter too, though it isn't marked medical
                h.pop("seen", None)
                a["hospital"] = h
            if named or (h and h["state"] in ("landing", "left") and not a.get("military")):
                a["medical"] = True
        except Exception as e:          # one odd record mustn't cost the rest
            log.warning("whether %s is a medical flight couldn't be worked out (%s: %s)", a.get("hex"), type(e).__name__, e)
