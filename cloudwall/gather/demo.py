"""Demo mode: simulated traffic around Portland, no network. Demo stands in for a position feed
and the lookups; demo_heard for the military feed."""
import math
import random
import time

from .feeds import normalise
from ..core.geo import haversine_nm


def demo_heard():
    """A pair of fighters heard but not placed, as heard_near gives them."""
    heard = [{"hex": hexid, "t": "F15", "desc": "Boeing F-15EX Eagle II", "alt_baro": alt, "dbFlags": 1,
              "ownOp": "United States Air Force"} for hexid, alt in (("ae0412", 14000), ("ae0413", 14200))]
    return [dict(normalise(a), rough_nm=3) for a in heard]


AIRPORTS = {
    "PDX": ("Portland", "Portland International Airport", 45.5887, -122.5975),
    "SEA": ("Seattle", "Seattle-Tacoma International Airport", 47.449, -122.309),
    "SFO": ("San Francisco", "San Francisco International Airport", 37.619, -122.375),
    "LAX": ("Los Angeles", "Los Angeles International Airport", 33.9425, -118.408),
    "DEN": ("Denver", "Denver International Airport", 39.8617, -104.6731),
    "ORD": ("Chicago", "O'Hare International Airport", 41.9786, -87.9048),
    "HNL": ("Honolulu", "Daniel K. Inouye International Airport", 21.3187, -157.9225),
    "AMS": ("Amsterdam", "Amsterdam Airport Schiphol", 52.3086, 4.7639),
    "LHR": ("London", "London Heathrow Airport", 51.4706, -0.4619),
    "ANC": ("Anchorage", "Ted Stevens Anchorage International Airport", 61.1744, -149.9964),
    "NRT": ("Tokyo", "Narita International Airport", 35.7647, 140.3864),
    "BOI": ("Boise", "Boise Air Terminal", 43.5644, -116.2228),
}

# callsign, flight no, airline, icao type, type name, reg, origin, dest, kind
DEMO_FLIGHTS = [
    ("ASA512", "AS512", "Alaska Airlines", "B739", "Boeing 737-990ER", "N461AS", "SFO", "PDX", "arr"),
    ("DAL178", "DL178", "Delta Air Lines", "A339", "Airbus A330-941", "N407DX", "AMS", "PDX", "arr"),
    ("QXE2162", "QX2162", "Horizon Air", "E75L", "Embraer E175LR", "N631QX", "BOI", "PDX", "arr"),
    ("UAL1953", "UA1953", "United Airlines", "B738", "Boeing 737-824", "N76529", "DEN", "PDX", "arr"),
    ("HAL25", "HA25", "Hawaiian Airlines", "A332", "Airbus A330-243", "N388HA", "PDX", "HNL", "dep"),
    ("BAW266", "BA266", "British Airways", "B788", "Boeing 787-8 Dreamliner", "G-ZBJG", "PDX", "LHR", "dep"),
    ("SWA1420", "WN1420", "Southwest Airlines", "B38M", "Boeing 737 MAX 8", "N8741L", "PDX", "DEN", "dep"),
    ("FDX1409", "FX1409", "FedEx", "MD11", "McDonnell Douglas MD-11F", "N585FE", "ANC", "PDX", "arr"),
    ("ANA178", "NH178", "All Nippon Airways", "B77W", "Boeing 777-381ER", "JA792A", "NRT", "ORD", "over"),
    ("ASA67", "AS67", "Alaska Airlines", "B38M", "Boeing 737 MAX 8", "N802AK", "SEA", "LAX", "over"),
    (None, None, None, "C172", "Cessna 172S Skyhawk", "N751SP", None, None, "ga"),
    # an air ambulance, flying in to a hospital's helipad near home, and out again after a while
    ("LIFE3", None, "Life Flight Network", "EC35", "Eurocopter EC135", "N135LF", None, None, "medevac"),
    # one of each of the radar's other kinds: a regional jet, a four-engined heavy, a business jet and a turboprop
    ("SKW3486", "OO3486", "SkyWest Airlines", "CRJ9", "Bombardier CRJ900LR", "N914SK", "SEA", "PDX", "arr"),
    ("GTI8315", "5Y8315", "Atlas Air", "B744", "Boeing 747-400F", "N415MC", "PDX", "ANC", "dep"),
    ("EJA524", "EJA524", "NetJets", "C56X", "Cessna Citation Excel", "N524QS", "PDX", "LAX", "dep"),
    (None, None, None, "B350", "Beechcraft King Air 350", "N350TW", None, None, "ga"),
    # and a few that aren't aeroplanes at all: a balloon drifting, a glider, a twin-rotor helicopter
    (None, None, None, "BALL", "Cameron Balloons Z-105", "N105CB", None, None, "balloon"),
    (None, None, None, "AS21", "Schleicher ASK 21", "N921SG", None, None, "glider"),
    (None, None, None, "H47", "Boeing 234 Chinook", "N245CH", None, None, "heli"),
]


def _airport(code):
    city, name, lat, lon = AIRPORTS[code]
    return {"iata": code, "city": city, "name": name, "lat": lat, "lon": lon}


# PDX's runways 28L and 28R as the demo flies them, from the default home along its 299° corridor
# (nm past the point abeam home; nm to the right of the track, so negative is left): the line of
# each runway's extended centreline, and the along-track distance of its threshold and far end.
DEMO_RUNWAYS = ((-2.23, 3.2, 4.81), (-2.74, 3.76, 5.56))
GLIDE_FT_PER_NM = 318


class Demo:
    """Simulated traffic along the PDX east/west corridor, passing near home. The airport lands
    west: arrivals come down the 3° approach to 28L or 28R from the east, departures climb out west
    from their far ends; overflights, light aircraft and the odd balloon go anywhere."""
    name = "demo"

    def __init__(self, seed=7):
        self.rng = random.Random(seed)
        self.active = []
        self.liftoff = None       # (when, helipad, hex): the air ambulance on a hospital's helipad, to leave again
        self.last = None
        self.next_spawn = 0
        self.routes = {}
        self.aircraft = {}
        for i, f in enumerate(DEMO_FLIGHTS):
            hexid = f"a{i:05x}"
            self.aircraft[hexid] = {"type_name": f[4], "reg": f[5], "owner": f[2], "photo": None}
            if f[0] and f[6]:
                self.routes[f[0]] = {"flight": f[1], "airline": f[2],
                                     "origin": _airport(f[6]), "dest": _airport(f[7])}

    def _spawn(self, lat, lon, along=None, radius_nm=15, idx=None):
        flying = {a["hex"] for a in self.active} | ({self.liftoff[2]} if self.liftoff else set())     # or on a helipad
        free = [i for i in range(len(DEMO_FLIGHTS)) if f"a{i:05x}" not in flying]   # one not already in the air
        if not free:
            return
        idx = self.rng.choice(free) if idx is None or idx not in free else idx
        hexid = f"a{idx:05x}"
        cs, _, _, typ, _, reg, _, _, kind = DEMO_FLIGHTS[idx]
        profile = {
            "arr": (299, 150, 2600, -800, "A3"), "dep": (299, 200, 5200, 2200, "A3"),
            "over": (self.rng.choice([165, 345]), 455, 36000, 0, "A5"),
            "ga": (self.rng.uniform(0, 360), 105, 2800, 0, "A1"),
            "heli": (self.rng.uniform(0, 360), 120, 1400, 0, "A7"),
            "medevac": (0, 120, 1400, 0, "A7"),
            "balloon": (self.rng.uniform(0, 360), 9, 1800, 0, "B2"),
            "glider": (self.rng.uniform(0, 360), 52, 4200, 0, "B1"),
        }[kind]
        track, gs, alt, vrate, cat = profile
        if typ in ("A339", "A332", "B788", "MD11", "B77W", "B744"):
            cat = "A5"
        elif typ in ("C56X", "B350"):
            cat = "A2"
        offset = self.rng.uniform(-2.5, 2.5)          # lateral miss distance, nm
        along = -max(14.0, radius_nm - 1) if along is None else along   # start near the edge of the range
        rwy = self.rng.choice(DEMO_RUNWAYS)
        if kind in ("arr", "dep"):
            # on a runway's extended centreline: arrivals from the edge of the range, departures from the runway's end
            offset = rwy[0] + self.rng.uniform(-0.04, 0.04)
            if kind == "arr":
                along = min(along, rwy[1] - 1.5)      # short of the threshold: the demo starts with one placed past it
            if kind == "dep":
                along = rwy[2] + max(0.0, along + 11) * 0.6
        pad = None
        if kind == "medevac":
            pad = self._helipad(lat, lon)
            if pad:                 # in from 9 nm out, on a line that passes near home, straight to the helipad
                pe, pn = self._xy(lat, lon, pad)
                b = self._approach(lat, lon, pad)
                se, sn = pe + 9 * math.sin(b), pn + 9 * math.cos(b)
                track = math.degrees(math.atan2(pe - se, pn - sn)) % 360
                along, offset = self._frame(se, sn, track)
                pad = dict(pad, along=self._frame(pe, pn, track)[0])
            else:                   # no helipads known here: an ordinary helicopter
                kind, track = "heli", self.rng.uniform(0, 360)
        self.active.append({
            "hex": hexid, "callsign": cs or reg, "reg": reg, "type": typ, "category": cat,
            "track": track, "gs": gs, "alt0": alt, "vrate": vrate, "squawk": "1200" if kind == "ga" else "".join(self.rng.choice("01234567") for _ in range(4)),
            "along": along, "offset": offset, "kind": kind, "rwy": rwy, "pad": pad,
        })

    @staticmethod
    def _xy(lat, lon, p):
        """Where a point is from home, in nm east and north."""
        return (p["lon"] - lon) * 60 * math.cos(math.radians(lat)), (p["lat"] - lat) * 60

    @staticmethod
    def _frame(e, n, track):
        """A point east and north of home as (along, offset) for a line flown on this track."""
        t = math.radians(track)
        return e * math.sin(t) + n * math.cos(t), e * math.cos(t) - n * math.sin(t)

    def _helipad(self, lat, lon):
        """The hospital helipad nearest 6 nm from home, for the air ambulance to fly to."""
        from ..reference.airports import helipads_near
        pads = [p for p in helipads_near(lat, lon, 12) if haversine_nm(lat, lon, p["lat"], p["lon"]) > 2]
        return min(pads, key=lambda p: abs(haversine_nm(lat, lon, p["lat"], p["lon"]) - 6)) if pads else None

    def _approach(self, lat, lon, pad):
        """The direction the air ambulance comes in from (radians, from the helipad): from near home's
        side, on a line that passes no other hospital's helipad, so where it's going is clear."""
        from ..reference.airports import helipads_near
        pe, pn = self._xy(lat, lon, pad)
        others = [self._xy(lat, lon, p) for p in helipads_near(lat, lon, 25) if p["code"] != pad["code"]]
        home_side = math.atan2(-pe, -pn)
        for off in (40, -40, 70, -70, 100, -100, 140, -140, 180):
            b = home_side + math.radians(off)
            se, sn = pe + 9 * math.sin(b), pn + 9 * math.cos(b)
            dx, dy = pe - se, pn - sn
            def miss(q):           # how near a helipad comes to the line flown in, or its extension past the helipad, nm
                t = max(0.0, min(3.5, ((q[0] - se) * dx + (q[1] - sn) * dy) / (dx * dx + dy * dy)))
                return math.hypot(se + t * dx - q[0], sn + t * dy - q[1])
            if all(miss(q) > 1.2 for q in others):
                return b
        return home_side + math.radians(40)

    def _lift_off(self, lat, lon):
        """The air ambulance leaves the helipad it landed on, climbing away to the north-west or south-east."""
        _, pad, hexid = self.liftoff
        self.liftoff = None
        cs, _, _, typ, _, reg, _, _, _ = DEMO_FLIGHTS[int(hexid[1:], 16)]
        track = self.rng.choice([315, 135]) + self.rng.uniform(-20, 20)
        pe, pn = self._xy(lat, lon, pad)
        along, offset = self._frame(pe, pn, track)
        self.active.append({
            "hex": hexid, "callsign": cs or reg, "reg": reg, "type": typ, "category": "A7", "track": track, "gs": 110,
            "alt0": 1400, "vrate": 900, "squawk": "4721", "along": along, "offset": offset, "kind": "medevac_out",
            "rwy": DEMO_RUNWAYS[0], "pad": dict(pad, along=along)})

    def fetch(self, lat, lon, radius_nm):
        now = time.time()
        if self.last is None:
            for along in (-11, -5, -1.5, 6):
                self._spawn(lat, lon, along)
            # and the air ambulance, on its way to a hospital
            self._spawn(lat, lon, idx=next(i for i, f in enumerate(DEMO_FLIGHTS) if f[8] == "medevac"))
            self.last = now
        dt = now - self.last
        self.last = now
        if now >= self.next_spawn:
            self._spawn(lat, lon, radius_nm=radius_nm)
            self.next_spawn = now + self.rng.uniform(25, 60)
        if self.liftoff and now >= self.liftoff[0]:
            self._lift_off(lat, lon)
        out = []
        for a in self.active:
            a["along"] += a["gs"] * dt / 3600
            if a["kind"] == "medevac":           # down on the helipad, not past it
                a["along"] = min(a["along"], a["pad"]["along"])
            t = math.radians(a["track"])
            # along-track unit vector (east, north) and its right-hand normal
            e = a["along"] * math.sin(t) + a["offset"] * math.cos(t)
            n = a["along"] * math.cos(t) - a["offset"] * math.sin(t)
            # altitude profile is pinned to the abeam point so passes look realistic; arrivals come
            # down the 3° approach to their runway's threshold, departures climb from its far end
            vrate = a["vrate"]
            if a["kind"] == "arr":
                alt = 30 + GLIDE_FT_PER_NM * (a["rwy"][1] - a["along"])
                vrate = -round(a["gs"] * GLIDE_FT_PER_NM / 60)
            elif a["kind"] == "dep":
                alt = 400 + a["vrate"] * ((a["along"] - a["rwy"][2]) / a["gs"] * 60)
            elif a["kind"] == "medevac":    # level, then down over the last 2 nm to the helipad
                to_go = a["pad"]["along"] - a["along"]
                alt = a["pad"]["elevation_ft"] + 100 + 1300 * min(1.0, max(0.0, to_go / 2))
                vrate = -round(a["gs"] * 650 / 60) if to_go < 2 else 0
            elif a["kind"] == "medevac_out":   # climbing from the helipad to 1,400 ft
                climbed = a["vrate"] * ((a["along"] - a["pad"]["along"]) / a["gs"] * 60)
                alt = min(1400.0, a["pad"]["elevation_ft"] + 100 + climbed)
                vrate = a["vrate"] if alt < 1400 else 0
            else:
                alt = a["alt0"] + a["vrate"] * (a["along"] / a["gs"] * 60)
            alt = max(300 if a["kind"] not in ("medevac", "medevac_out") else 0, min(41000, alt))
            info = DEMO_FLIGHTS[int(a["hex"][1:], 16)]
            alt_target = (3000 if a["kind"] == "arr" else 15000 if a["kind"] == "dep" else None)
            out.append({
                "desc": info[4], "year": 2008 + int(a["hex"][1:], 16) % 15, "owner_op": None, "private_owner": False,
                "target_alt": alt_target, "modes": ["autopilot", "approach"] if a["kind"] == "arr" else ["autopilot", "lnav", "vnav"] if a["kind"] in ("dep", "over") else [],
                "alt_gps": None, "emergency_status": None,
                "hex": a["hex"], "callsign": a["callsign"], "reg": a["reg"], "type": a["type"],
                "alt": int(alt / 25) * 25, "on_ground": False,
                "gs": a["gs"] + self.rng.uniform(-2, 2), "track": a["track"],
                "vrate": vrate, "lat": lat + n / 60,
                "lon": lon + e / (60 * math.cos(math.radians(lat))),
                "squawk": a["squawk"], "category": a["category"], "military": False,
            })
        # gone past the range, or landed (the air ambulance to leave its helipad again after a while)
        for a in self.active:
            if a["kind"] == "medevac" and a["along"] >= a["pad"]["along"] and not self.liftoff:
                self.liftoff = (now + 40, a["pad"], a["hex"])
        self.active = [a for a in self.active if abs(a["along"]) <= radius_nm and not (a["kind"] == "arr" and a["along"] > a["rwy"][1])
                       and not (a["kind"] == "medevac" and a["along"] >= a["pad"]["along"])
                       and not (a["kind"] == "medevac_out" and a["along"] - a["pad"]["along"] > 12)]
        return out
