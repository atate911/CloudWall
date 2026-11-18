"""Configuration: defaults overlaid with an optional TOML file."""
import copy
import logging
import os
import re
import shutil
import tomllib
from pathlib import Path

from . import airports, geo

log = logging.getLogger("cloudwall")

EXAMPLE = Path(__file__).resolve().parent / "config.example.toml"

DEFAULTS = {
    "home": {
        # Placeholder: ~6 miles east of PDX under the 28L/28R final. Set your own.
        "name": "Home",
        "lat": 45.5900,
        "lon": -122.4740,
        "elevation_ft": 100,
    },
    "airport": {"icao": "KPDX", "iata": "PDX", "city": "Portland", "lat": 45.5887, "lon": -122.5975,
                # smaller fields nearby: their traffic is labelled as theirs, not PDX's
                "others": [{"code": "VUO", "name": "Pearson Field", "city": "Vancouver",
                            "lat": 45.6205, "lon": -122.6564, "elevation_ft": 25},
                           {"code": "TTD", "name": "Troutdale", "city": "Troutdale",
                            "lat": 45.5494, "lon": -122.4013, "elevation_ft": 39}]},
    "tracking": {
        "radius_nm": 15,        # how far out the board, flight card and logbook look (the radar can look further)
        "overhead_nm": 3.5,     # inside this, an aircraft counts as "overhead" and is logged
        "max_overhead_alt_ft": 45000,
        "poll_seconds": 5,
        "when_idle": "pause",          # no screen open: "pause" all requests, or "log" slowly
        "idle_after_seconds": 90,
    },
    # Position feeds, tried in order; CloudWall fails over to the next when one stops answering.
    "source": {"urls": ["https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}",
                        "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"]},
    "flightradar24": {"api_key": "", "monthly_limit": 0, "safety_margin": 0.15, "billing_day": 1,
                      "daily_limit": 0, "mode": "always",
                      "general_aviation": False, "sandbox": False},
    "flightaware": {"api_key": "", "monthly_limit": 0, "safety_margin": 0.15, "billing_day": 1,
                    "daily_limit": 0, "mode": "always",
                    "general_aviation": False},
    # Map behind the radar: "dark", "light", "satellite", "osm" or "off" (or set url = a tile URL template)
    "map": {"style": "dark", "opacity": 0.32, "url": "", "attribution": ""},
    # Airline logos on the flight card, fetched by airline code and cached on disk
    "logos": {"enabled": True, "url": ""},
    # Extra free data: military jets heard without a position, temporary flight
    # restrictions (FAA), and the contrail forecast (Open-Meteo upper-air data).
    "extras": {"military": True, "military_radius_nm": 40, "military_url": "https://opendata.adsb.fi/api/v2/mil",
               "tfr": True, "tfr_radius_nm": 30, "contrails": True},
    # The kiosk has no buttons: its place and radar are set here. place: a place's name (empty for
    # the first); radar: "chart" or "atc" (drawn like an air traffic control screen); tracks: trails
    # and one-minute lines; range_nm: 0 for the tracking radius, or 20 or 30 to see further.
    "kiosk": {"place": "", "radar": "chart", "tracks": True, "range_nm": 0},
    "server": {"host": "0.0.0.0", "port": 5050},
    "storage": {"db_path": ""},   # empty: <user data dir>/cloudwall/cloudwall.db
}


def _xdg(var, fallback):
    return Path(os.environ.get(var) or Path.home() / fallback) / "cloudwall"


def user_config_path():
    return _xdg("XDG_CONFIG_HOME", ".config") / "config.toml"


def default_db_path():
    return _xdg("XDG_DATA_HOME", ".local/share") / "cloudwall.db"


def find(path=None):
    """Which config file applies: --config, $CLOUDWALL_CONFIG, ./config.toml, then the user one."""
    if path:
        return Path(path)
    if os.environ.get("CLOUDWALL_CONFIG"):
        return Path(os.environ["CLOUDWALL_CONFIG"])
    for p in (Path("config.toml"), user_config_path()):
        if p.exists():
            return p
    return None


def load(path=None):
    cfg = copy.deepcopy(DEFAULTS)
    path = find(path)
    if path:
        with open(path, "rb") as f:
            for section, values in tomllib.load(f).items():
                if section == "places":
                    cfg["places"] = [dict(v) for v in values] if isinstance(values, list) else []
                elif section == "airport" and str(values.get("icao", DEFAULTS["airport"]["icao"])).upper() != DEFAULTS["airport"]["icao"]:
                    cfg["airport"] = dict(values)    # another airport: none of PDX's details carry over
                else:
                    cfg.setdefault(section, {}).update(values)
    src = cfg["source"]
    if src.get("url"):                      # older single-feed setting: try it first
        src["urls"] = [src["url"]] + [u for u in src["urls"] if u != src["url"]]
    cfg["_path"] = str(path) if path else None
    return cfg


# -- places -------------------------------------------------------------------
# CloudWall can watch several places: [home] with [airport] is the first, and each [[places]]
# entry adds one. A place needs only a name, a position and its airport's ICAO code; the rest
# of the airport (name, city, position, elevation, runways, the small fields nearby) comes from
# the bundled tables unless the config gives it.

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-") or "place"


def complete_airport(ap, home, radius_nm):
    """An airport filled in from its ICAO (or IATA) code, keeping whatever the config gives."""
    ap = dict(ap)
    rec = airports.lookup(ap.get("icao")) or airports.lookup(ap.get("iata"))
    if rec and ap.get("lat") is not None and ap.get("lon") is not None:
        off = geo.haversine_nm(float(ap["lat"]), float(ap["lon"]), rec["lat"], rec["lon"])
        if off > 10:      # e.g. a new icao left with another airport's position
            log.warning("[airport] %s: the config's lat/lon are %.0f nm from %s; the position from the config is used",
                        rec["icao"], off, rec["name"])
    if rec:
        for k in ("icao", "iata", "city", "name", "lat", "lon"):
            if ap.get(k) in (None, ""):
                ap[k] = rec[k]
    if ap.get("lat") is None or ap.get("lon") is None:
        raise ValueError(f"airport {ap.get('icao') or '(no code)'} isn't in CloudWall's table: "
                         "give its lat and lon (and iata and city) in the config")
    ap["icao"] = str(ap.get("icao") or "").upper()
    ap.setdefault("iata", ap["icao"])
    ap.setdefault("city", ap.get("name") or ap["iata"])
    if ap.get("elevation_ft") is None:
        ap["elevation_ft"] = airports.elevation_ft(ap["icao"]) or 0
    if "others" not in ap:      # small fields nearby, whose light aircraft are theirs, not this airport's
        ap["others"] = airports.nearby(home["lat"], home["lon"], radius_nm, exclude=[ap["icao"], ap["iata"]])[:6]
    for f in ap["others"]:
        if f.get("elevation_ft") is None:
            f["elevation_ft"] = airports.elevation_ft(f.get("icao") or f.get("code")) or home.get("elevation_ft") or 0
    if "runways" not in ap:
        ap["runways"] = airports.runways(ap["icao"])
    return ap


def places(cfg):
    """Every place to watch, first to last, each a full config of its own: the shared settings
    with this place's [home] and [airport], and place = {id, name}."""
    first = {"name": cfg["home"].get("name") or "Home", "home": cfg["home"], "airport": cfg["airport"]}
    entries = [first]
    for i, p in enumerate(cfg.get("places") or []):
        if p.get("lat") is None or p.get("lon") is None or not p.get("airport"):
            raise ValueError(f"[[places]] entry {i + 1} ({p.get('name') or 'no name'}) needs lat, lon and airport")
        ap = p["airport"] if isinstance(p["airport"], dict) else {"icao": p["airport"]}
        if "others" in p:
            ap = dict(ap, others=p["others"])
        home = {"name": p.get("name") or f"Place {i + 2}", "lat": float(p["lat"]), "lon": float(p["lon"]),
                "elevation_ft": p.get("elevation_ft")}
        entries.append({"name": home["name"], "home": home, "airport": ap})
    out, ids = [], set()
    for e in entries:
        pid = base = _slug(e["name"])
        n = 2
        while pid in ids:
            pid, n = f"{base}-{n}", n + 1
        ids.add(pid)
        c = {k: v for k, v in cfg.items() if k != "places"}
        c = copy.deepcopy(c)
        c["home"] = dict(e["home"], name=e["name"])
        c["airport"] = complete_airport(e["airport"], c["home"], c["tracking"]["radius_nm"])
        if c["home"].get("elevation_ft") is None:     # not given: near enough the airport's
            c["home"]["elevation_ft"] = c["airport"]["elevation_ft"]
        c["place"] = {"id": pid, "name": e["name"]}
        out.append(c)
    return out


def kiosk_place(cfg, places_):
    """The place the kiosk shows: [kiosk] place, by name or id, or the first."""
    want = str(cfg.get("kiosk", {}).get("place") or "").strip().lower()
    return next((p["place"]["id"] for p in places_ if want in (p["place"]["id"], p["place"]["name"].lower())),
                places_[0]["place"]["id"])


def init(path=None):
    """Write a starter config file. Returns (path, created)."""
    path = Path(path) if path else user_config_path()
    if path.exists():
        return path, False
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXAMPLE, path)
    return path, True
