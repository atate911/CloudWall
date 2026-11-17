"""Live position sources. Each returns a list of normalised aircraft dicts."""
import logging
import math
import random
import time
from urllib.parse import urlparse

from .http import get_json

log = logging.getLogger("cloudwall.sources")


def normalise(a):
    """Convert a readsb/adsb.lol aircraft record to CloudWall's shape."""
    alt = a.get("alt_baro", a.get("alt_geom"))
    on_ground = alt == "ground"
    if not isinstance(alt, (int, float)):
        alt = 0 if on_ground else None
    vrate = a.get("baro_rate", a.get("geom_rate"))
    return {
        "hex": (a.get("hex") or "").lstrip("~").lower(),
        "callsign": (a.get("flight") or "").strip() or None,
        "reg": a.get("r"),
        "type": a.get("t"),
        "alt": alt,
        "on_ground": on_ground,
        "gs": a.get("gs"),
        "track": a.get("track"),
        "vrate": vrate,
        "lat": a.get("lat"),
        "lon": a.get("lon"),
        "squawk": a.get("squawk"),
        "category": a.get("category"),
        "military": bool(a.get("dbFlags", 0) & 1),
    }


class Feeds:
    """One or more readsb-style JSON feeds, tried in order.

    The free community APIs come and go, so when the feed in use fails we move
    to the next one and stay there for as long as it keeps answering.
    """

    def __init__(self, urls):
        self.urls = list(urls)
        self.current = 0
        self.name = self._host(self.urls[0])

    @staticmethod
    def _host(url):
        return urlparse(url).hostname or url

    def fetch(self, lat, lon, radius_nm):
        last = None
        for step in range(len(self.urls)):
            i = (self.current + step) % len(self.urls)
            url = self.urls[i].format(lat=f"{lat:.4f}", lon=f"{lon:.4f}", radius=int(radius_nm))
            try:
                data = get_json(url, timeout=8)
            except Exception as e:
                log.warning("feed %s failed: %s", self._host(url), e)
                last = e
                continue
            if i != self.current:
                log.info("switched position feed to %s", self._host(url))
            self.current, self.name = i, self._host(url)
            out = []
            for a in (data or {}).get("ac") or (data or {}).get("aircraft") or []:
                n = normalise(a)
                if n["hex"] and n["lat"] is not None and n["lon"] is not None:
                    out.append(n)
            return out
        raise last


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
    ("LIFE3", None, "Life Flight Network", "EC35", "Eurocopter EC135", "N135LF", None, None, "heli"),
]


def _airport(code):
    city, name, lat, lon = AIRPORTS[code]
    return {"iata": code, "city": city, "name": name, "lat": lat, "lon": lon}


class Demo:
    """Simulated traffic along the PDX east/west corridor, passing near home."""
    name = "demo"

    def __init__(self, seed=7):
        self.rng = random.Random(seed)
        self.active = []
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

    def _spawn(self, lat, lon, along=None):
        idx = self.rng.randrange(len(DEMO_FLIGHTS))
        hexid = f"a{idx:05x}"
        if any(a["hex"] == hexid for a in self.active):
            return
        cs, _, _, typ, _, reg, _, _, kind = DEMO_FLIGHTS[idx]
        profile = {
            "arr": (299, 165, 2600, -700, "A3"), "dep": (119, 230, 5200, 2200, "A3"),
            "over": (self.rng.choice([165, 345]), 455, 36000, 0, "A5"),
            "ga": (self.rng.uniform(0, 360), 105, 2800, 0, "A1"),
            "heli": (self.rng.uniform(0, 360), 120, 1400, 0, "A7"),
        }[kind]
        track, gs, alt, vrate, cat = profile
        if typ in ("A339", "A332", "B788", "MD11", "B77W"):
            cat = "A5"
        offset = self.rng.uniform(-2.5, 2.5)          # lateral miss distance, nm
        along = -14.0 if along is None else along      # start this far before abeam
        self.active.append({
            "hex": hexid, "callsign": cs or reg, "reg": reg, "type": typ, "category": cat,
            "track": track, "gs": gs, "alt0": alt, "vrate": vrate, "squawk": "1200" if kind == "ga" else "".join(self.rng.choice("01234567") for _ in range(4)),
            "along": along, "offset": offset, "kind": kind,
        })

    def fetch(self, lat, lon, radius_nm):
        now = time.time()
        if self.last is None:
            for along in (-11, -5, -1.5, 6):
                self._spawn(lat, lon, along)
            self.last = now
        dt = now - self.last
        self.last = now
        if now >= self.next_spawn:
            self._spawn(lat, lon)
            self.next_spawn = now + self.rng.uniform(25, 60)
        out = []
        for a in self.active:
            a["along"] += a["gs"] * dt / 3600
            t = math.radians(a["track"])
            # along-track unit vector (east, north) and its right-hand normal
            e = a["along"] * math.sin(t) + a["offset"] * math.cos(t)
            n = a["along"] * math.cos(t) - a["offset"] * math.sin(t)
            # altitude profile is pinned to the abeam point so passes look realistic
            alt = a["alt0"] + a["vrate"] * (a["along"] / a["gs"] * 60)
            alt = max(300, min(41000, alt))
            out.append({
                "hex": a["hex"], "callsign": a["callsign"], "reg": a["reg"], "type": a["type"],
                "alt": int(alt / 25) * 25, "on_ground": False,
                "gs": a["gs"] + self.rng.uniform(-2, 2), "track": a["track"],
                "vrate": a["vrate"], "lat": lat + n / 60,
                "lon": lon + e / (60 * math.cos(math.radians(lat))),
                "squawk": a["squawk"], "category": a["category"], "military": False,
            })
        self.active = [a for a in self.active if abs(a["along"]) <= radius_nm]
        return out
