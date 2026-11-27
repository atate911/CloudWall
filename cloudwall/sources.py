"""Live position sources. Each returns a list of normalised aircraft dicts."""
import logging
import math
import random
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as WaitedTooLong
from urllib.parse import urlparse

from .geo import haversine_nm
from .http import get_json

log = logging.getLogger("cloudwall.sources")


def normalise(a):
    """Convert a readsb/adsb.lol aircraft record to CloudWall's shape."""
    alt = a.get("alt_baro", a.get("alt_geom"))
    on_ground = alt == "ground"
    if not isinstance(alt, (int, float)):
        alt = 0 if on_ground else None
    vrate = a.get("baro_rate", a.get("geom_rate"))
    flags = a.get("dbFlags") if isinstance(a.get("dbFlags"), int) else 0
    return {
        "hex": (a.get("hex") or "").lstrip("~").lower(),
        "callsign": (a.get("flight") or "").strip() or None,
        "reg": a.get("r"),
        "type": a.get("t"),
        "alt": alt,
        "on_ground": on_ground,
        "gs": _num(a.get("gs")),          # numbers or nothing: a feed's odd value mustn't reach the sums
        "vrate": _num(vrate),
        "lat": _num(a.get("lat")),
        "lon": _num(a.get("lon")),
        "squawk": a.get("squawk"),
        # the transponder's own emergency status: general, lifeguard, minfuel, nordo, unlawful, downed
        "emergency_status": a.get("emergency") if a.get("emergency") not in (None, "none") else None,
        "category": a.get("category"),
        "military": bool(flags & 1),
        # privacy programmes (LADD, PIA): the owner asked not to be identified
        "private_owner": bool(flags & 12),
        "desc": tidy_type(a.get("desc")),
        "year": _year(a.get("year")),
        "owner_op": a.get("ownOp"),
        "target_alt": _num(a.get("nav_altitude_mcp") or a.get("nav_altitude_fms")),
        "modes": [m for m in a.get("nav_modes") or [] if isinstance(m, str)],
        "alt_gps": _num(a.get("alt_geom")),
        "track": _num(a.get("track") if a.get("track") is not None else a.get("true_heading")),
    }


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _year(v):
    try:
        y = int(v)
        return y if 1900 < y <= 2100 else None
    except (TypeError, ValueError):
        return None


# Words to keep in capitals when tidying "BOEING 737 MAX 8" into "Boeing 737 MAX 8".
KEEP_UPPER = {"MAX", "NG", "ER", "LR", "SR", "XR", "ATR", "CRJ", "EMB", "ERJ", "MD", "DC", "II", "III", "IV",
              "SP", "XL", "XLS", "CJ", "CJ2", "CJ3", "CJ4", "LX", "GX", "EX", "BBJ", "TBM", "PC", "DHC", "RJ",
              "ACJ", "NEO", "CEO", "STOL", "VTOL", "AS", "EC", "SA", "AW", "UH", "CH", "KC", "C", "F", "G", "B", "A"}


def tidy_type(desc):
    """'BOEING 737 MAX 8' -> 'Boeing 737 MAX 8'; 'AIRBUS A-321neo' stays readable."""
    if not desc or not isinstance(desc, str):
        return None
    if desc != desc.upper():
        return desc
    words = []
    for w in desc.split():
        if any(ch.isdigit() for ch in w) or w in KEEP_UPPER or len(w) <= 2:
            words.append(w)
        else:
            words.append(w[0] + w[1:].lower())
    return " ".join(words)


class Feeds:
    """One or more readsb-style JSON feeds, tried in order.

    The free community APIs come and go, so when the feed in use fails we move
    to the next one and stay there for as long as it keeps answering.
    """

    def __init__(self, urls, quiet=False):
        self.urls = list(urls)
        self.current = 0
        self.name = self._host(self.urls[0])
        self.quiet = quiet          # the caller reports failures itself (Merged)

    @staticmethod
    def _host(url):
        return urlparse(url).hostname or url

    def fetch(self, lat, lon, radius_nm):
        return [n for n, _ in self.fetch_timed(lat, lon, radius_nm)]

    def fetch_timed(self, lat, lon, radius_nm, clock=time.time):
        """As fetch, with when each position was reported: [(aircraft, unix time), ...]."""
        last = None
        for step in range(len(self.urls)):
            i = (self.current + step) % len(self.urls)
            url = self.urls[i].format(lat=f"{lat:.4f}", lon=f"{lon:.4f}", radius=int(radius_nm))
            try:
                data = get_json(url, timeout=8)
            except Exception as e:
                if not self.quiet:
                    log.warning("feed %s failed: %s", self._host(url), e)
                last = e
                continue
            if i != self.current:
                log.info("switched position feed to %s", self._host(url))
            self.current, self.name = i, self._host(url)
            return placed_with_times(data, clock())
        raise last


def feed_time(data, received):
    """When a feed's answer was made, in unix seconds. readsb's aircraft.json gives seconds and the
    community APIs milliseconds; an answer with no time, or one far from our own clock, counts as
    made when it arrived."""
    now = (data or {}).get("now")
    if isinstance(now, (int, float)) and not isinstance(now, bool):
        now = now / 1000 if now > 1e11 else now
        if abs(now - received) < 300:
            return now
    return received


def placed_with_times(data, received):
    """The aircraft with a position in a feed's answer, each with the time its position was
    reported: the answer's time less the record's seen_pos (how old the position was then)."""
    made, out = feed_time(data, received), []
    for a in (data or {}).get("ac") or (data or {}).get("aircraft") or []:
        n = normalise(a)
        if n["hex"] and n["lat"] is not None and n["lon"] is not None:
            age = _num(a.get("seen_pos"))
            out.append((n, made - max(0.0, age) if age is not None else made))
    return out


MERGE_MAX_AGE_S = 60        # a position older than this is left out, as readsb itself drops it
MERGE_WAIT_S = 25           # the longest an update waits for either side: one that hangs is skipped
MERGE_PROJECT_MAX_S = 15    # carry a position along its track for at most this long


def project(a, seconds):
    """The aircraft moved on along its track at its ground speed for the given seconds (capped).
    Distances here are a few miles at most, so the flat-earth step is exact enough."""
    seconds = min(seconds, MERGE_PROJECT_MAX_S)
    if seconds <= 0.05 or a["on_ground"] or not a.get("gs") or a.get("track") is None:
        return a
    nm, track = a["gs"] * seconds / 3600, math.radians(a["track"])
    return dict(a, lat=a["lat"] + nm * math.cos(track) / 60,
                lon=a["lon"] + nm * math.sin(track) / (60 * math.cos(math.radians(a["lat"]))))


class Merged:
    """Your own receiver and the public feeds together: every aircraft either can see.

    urls[0] is your receiver; the rest are the public feeds, tried in order as Feeds does. Each
    update asks both at once. An aircraft only one of them has comes from that one. One both have
    takes the more recent position, which is usually your receiver's: it hears the aircraft
    directly, while a public feed is a few seconds behind. Any detail the chosen record lacks
    (type, registration, owner) is filled in from the other.

    Because the two run at different delays, every position is moved on along the aircraft's
    track to the moment of the update, so a lagging report and a fresh one agree on where the
    aircraft is now. And an aircraft never goes back: if the newest report this time is older than
    the one used last time (the receiver lost it and the public feed is behind), the last one is
    carried on instead.
    """

    def __init__(self, urls, clock=time.time):
        self.receiver = Feeds(urls[:1], quiet=True)
        self.public = Feeds(urls[1:]) if len(urls) > 1 else None
        self.clock = clock
        self.name = " + ".join(f.name for f in (self.receiver, self.public) if f)
        self.last = {}               # hex -> (time of the position used last, that record)
        self.down = set()            # feeds known to be failing, so each is complained of once
        # four, not two: a feed that hangs past MERGE_WAIT_S still holds its worker until its own
        # timeout, and the next update mustn't queue behind it
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="feed")

    def close(self):
        """The place is gone: let the workers go."""
        self.pool.shutdown(wait=False, cancel_futures=True)

    def _answer(self, future, label):
        try:
            return future.result(timeout=MERGE_WAIT_S)
        except WaitedTooLong:
            e = TimeoutError(f"no answer in {MERGE_WAIT_S} s")
            if label not in self.down:
                self.down.add(label)
                log.warning("merged feeds: %s isn't answering (%s); carrying on with the other", label, e)
            return None, e

    def _ask(self, feed, lat, lon, radius_nm, label):
        try:
            got = feed.fetch_timed(lat, lon, radius_nm, self.clock)
        except Exception as e:
            if label not in self.down:
                self.down.add(label)
                log.warning("merged feeds: %s isn't answering (%s); carrying on with the other", label, e)
            return None, e
        if label in self.down:
            self.down.discard(label)
            log.info("merged feeds: %s is answering again", label)
        return got, None

    def fetch(self, lat, lon, radius_nm):
        jobs = [(self.receiver, "your receiver")] + ([(self.public, "the public feed")] if self.public else [])
        futures = [self.pool.submit(self._ask, f, lat, lon, radius_nm, label) for f, label in jobs]
        answers = [self._answer(fu, label) for fu, (_, label) in zip(futures, jobs)]
        now = self.clock()
        if all(got is None for got, _ in answers):
            raise answers[0][1]
        self.name = " + ".join(f.name for (f, _), (got, _) in zip(jobs, answers) if got is not None)

        offers = {}                  # hex -> [(position time, rank, record)], rank 0 = your receiver
        for rank, (got, _) in enumerate(answers):
            for a, at in got or ():
                at = min(at, now)    # a clock a little ahead mustn't make a report look newer than now
                if now - at <= MERGE_MAX_AGE_S:
                    offers.setdefault(a["hex"], []).append((at, rank, a))

        out = []
        for hexid, offered in offers.items():
            offered.sort(key=lambda o: (-o[0], o[1]))        # newest first; your receiver wins a tie
            at, _, best = offered[0]
            prev = self.last.get(hexid)
            if prev and prev[0] > at:                        # nothing newer than last time: don't go back
                at, best = prev
            filled = dict(best)
            for _, _, other in offered:
                for k, v in other.items():
                    if filled.get(k) in (None, [], "") and v not in (None, [], ""):
                        filled[k] = v
                if other.get("military"):
                    filled["military"] = True
            self.last[hexid] = (at, filled)
            out.append(project(filled, now - at))
        self.last = {h: v for h, v in self.last.items() if now - v[0] <= MERGE_MAX_AGE_S}
        return out


def military_unplaced(url="https://opendata.adsb.fi/api/v2/mil"):
    """Military aircraft that receivers can hear but nobody can place, anywhere: the feed's own
    records. One request serves every place (shared.py); heard_near picks out a place's.

    Many military jets carry a Mode S transponder that sends altitude but no position. The
    network still reports them, with the rough location of the receiver that heard them
    (rr_lat/rr_lon), so we can say "an F-16 is up nearby" even with no dot for the map.
    Aircraft with a position arrive through the normal feed instead."""
    data = get_json(url, timeout=10)
    return [a for a in (data or {}).get("ac") or []
            if a.get("lat") is None and a.get("rr_lat") is not None and a.get("rr_lon") is not None
            and (a.get("seen") or 0) <= 90]


def heard_near(unplaced, home, radius_nm):
    """Those of military_unplaced's aircraft heard by a receiver within radius_nm of home."""
    out = []
    for a in unplaced:
        d = haversine_nm(home["lat"], home["lon"], a["rr_lat"], a["rr_lon"])
        if d <= radius_nm:
            n = normalise(a)
            n.update(rough_nm=round(d), lat=None, lon=None)
            out.append(n)
    return out


def demo_heard():
    """A pair of fighters heard but not placed (demo mode), as heard_near gives them."""
    heard = [{"hex": hexid, "t": "F15", "desc": "Boeing F-15EX Eagle II", "alt_baro": alt, "dbFlags": 1,
              "ownOp": "United States Air Force"} for hexid, alt in (("ae0412", 14000), ("ae0413", 14200))]
    return [dict(normalise(a), rough_nm=3) for a in heard]


# --- Demo mode: plausible PDX traffic with no network needed -----------------

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
        from .airports import helipads_near
        pads = [p for p in helipads_near(lat, lon, 12) if haversine_nm(lat, lon, p["lat"], p["lon"]) > 2]
        return min(pads, key=lambda p: abs(haversine_nm(lat, lon, p["lat"], p["lon"]) - 6)) if pads else None

    def _approach(self, lat, lon, pad):
        """The direction the air ambulance comes in from (radians, from the helipad): from near home's
        side, on a line that passes no other hospital's helipad, so where it's going is clear."""
        from .airports import helipads_near
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
