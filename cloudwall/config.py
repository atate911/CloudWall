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
        # Placeholder: east Vancouver, WA, under PDX's 28L/28R final. Set your own, by lat and lon
        # or by zip (a US ZIP code). elevation_ft: the airport's when not given.
        "name": "Home",
        "lat": 45.5900,
        "lon": -122.4740,
        "elevation_ft": None,
    },
    # The smaller fields nearby (Pearson Field, Grove Field, Troutdale and so on around Vancouver)
    # come from the bundled tables; their traffic is labelled as theirs, not PDX's.
    # "auto": the nearest large airport within 30 nm, else the nearest with airline service (PDX for
    # Vancouver, WA). Or give its ICAO code.
    "airport": {"icao": "auto"},
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
    # route: the map behind the flight's route on its card, one of the same styles (not a url), or "off"
    "map": {"style": "dark", "opacity": 0.45, "url": "", "attribution": "", "route": "satellite"},
    # Airline logos on the flight card, fetched by airline code and cached on disk
    "logos": {"enabled": True, "url": ""},
    # Extra free data: military jets heard without a position, temporary flight
    # restrictions (FAA), and the contrail forecast (Open-Meteo upper-air data).
    "extras": {"military": True, "military_radius_nm": 40, "military_url": "https://opendata.adsb.fi/api/v2/mil",
               "tfr": True, "tfr_radius_nm": 30, "contrails": True},
    # The kiosk has no buttons: its place and radar are set here. place: a place's name (empty for
    # the first); view: "radar", or "map" for the flights on an everyday map; radar: "chart" or
    # "atc" (drawn like an air traffic control screen); tracks: the
    # selected aircraft's track and one-minute lines; range_nm: 0 for the tracking radius, or 20 or 30 to see further;
    # density: "simple" (the landing queue and the next aircraft over the house, read across the room)
    # or "detailed" (the flight card with the landing queue under it, and every aircraft labelled).
    "kiosk": {"place": "", "view": "radar", "radar": "chart", "tracks": True, "range_nm": 0, "density": "simple"},
    "server": {"host": "0.0.0.0", "port": 5050},
    "storage": {"db_path": ""},   # empty: <user data dir>/cloudwall/cloudwall.db
}


# Settings that have no default, and what each may be. ([airport] takes an airport's own details,
# as many as are needed, so it isn't checked name by name.)
NUMBER = (int, float)
OPTIONAL = {
    "home": {"zip": (str, int), "elevation_ft": NUMBER},
    "source": {"url": str},
    "flightradar24": {"monthly_credits": NUMBER},
    "flightaware": {"monthly_credits": NUMBER},
    "map": {"atc": str},
}
MORE_THAN_ZERO = {"tracking": ("radius_nm", "overhead_nm", "max_overhead_alt_ft", "poll_seconds", "idle_after_seconds")}


def _fits(v, want):
    """Is v the kind of value wanted? (true and false aren't numbers, though Python counts them so.)"""
    kinds = want if isinstance(want, tuple) else (want,)
    return isinstance(v, kinds) and (bool in kinds or not isinstance(v, bool))


def check(section, values):
    """Refuse a setting CloudWall can't use, in words that name it: text where a number is wanted
    would otherwise surface later as a thread that stops, with nothing on screen to say why. A
    name CloudWall doesn't know (most often a typo) is only warned about. True if the section is
    one to take in."""
    if section == "places":
        if not isinstance(values, list) or not all(isinstance(v, dict) for v in values):
            raise ValueError("places must be [[places]] sections, one for each place")
        return True
    if section not in DEFAULTS:
        if isinstance(values, dict):
            log.warning("config: [%s] isn't a section CloudWall knows: left out", section)
        else:
            log.warning("config: %s is set outside any section (settings go under a [section] heading): left out", section)
        return False
    if not isinstance(values, dict):
        raise ValueError(f"{section} must be a section: write [{section}] and its settings on the lines under it")
    if section == "airport":
        return True
    for key, v in values.items():
        default = DEFAULTS[section].get(key)
        want = OPTIONAL.get(section, {}).get(key)
        if want is None and default is not None:      # the kind of value its default is
            want = type(default) if isinstance(default, bool) or not isinstance(default, NUMBER) else NUMBER
        if want is None:
            log.warning("config: [%s] %s isn't a setting CloudWall knows (a typo?): it has no effect", section, key)
            continue
        if not _fits(v, want):
            words = {bool: "true or false", str: "text in quotes", list: "a list", NUMBER: "a number"}.get(want, "text or a number")
            raise ValueError(f"[{section}] {key} must be {words}, not {v!r}")
        if key in MORE_THAN_ZERO.get(section, ()) and v <= 0:
            raise ValueError(f"[{section}] {key} must be more than 0, not {v!r}")
    if section == "tracking" and str(values.get("when_idle", "pause")).lower() not in ("pause", "log"):
        raise ValueError(f'[tracking] when_idle must be "pause" or "log", not {values["when_idle"]!r}')
    if section == "server" and "port" in values and not (isinstance(values["port"], int) and 0 < values["port"] < 65536):
        raise ValueError(f"[server] port must be a whole number from 1 to 65535, not {values['port']!r}")
    if section == "source" and "urls" in values and not (values["urls"] and all(isinstance(u, str) for u in values["urls"])):
        raise ValueError("[source] urls must be a list of at least one address, each in quotes")
    return True


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
                if not check(section, values):
                    continue
                if section == "places":
                    cfg["places"] = [dict(v) for v in values] if isinstance(values, list) else []
                elif section == "airport" and "icao" in values:
                    cfg["airport"] = dict(values)    # this airport only: nothing carries over from the defaults
                elif section == "home" and "zip" in values and "lat" not in values and "lon" not in values:
                    cfg["home"] = dict(values, name=values.get("name", "Home"))   # placed by ZIP code, not the placeholder
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


def _zip(z):
    """A ZIP code as a string, whether the config wrote it as text or as a number (02134 -> 2134)."""
    return str(z).strip().zfill(5) if isinstance(z, int) else str(z).strip()


def locate_home(h, what="[home]"):
    """A home with lat and lon, from the ones given or from its ZIP code."""
    h = dict(h)
    if h.get("lat") is not None and h.get("lon") is not None:
        h["lat"], h["lon"] = float(h["lat"]), float(h["lon"])
    elif h.get("zip"):
        h["zip"] = _zip(h["zip"])
        p = airports.zip_point(h["zip"])
        if not p:
            raise ValueError(f"{what}: {h['zip']} isn't a US ZIP code CloudWall knows: give lat and lon instead")
        h["lat"], h["lon"] = p
    else:
        raise ValueError(f"{what} needs lat and lon, or zip")
    return h


def complete_airport(ap, home, radius_nm):
    """An airport filled in from its ICAO (or IATA) code, keeping whatever the config gives. With no
    code, or "auto", it's the one airports.pick_airport chooses for home."""
    ap = dict(ap)
    if str(ap.get("icao") or "auto").lower() == "auto" and not ap.get("iata"):
        ap["icao"] = airports.pick_airport(home["lat"], home["lon"])
        if not ap["icao"]:
            raise ValueError(f"no airport with airline service near {home['lat']:.3f}, {home['lon']:.3f}: give its ICAO code")
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
    if not ap.get("iata"):      # no IATA code (Pearson Field): its local code (VUO), else its ICAO code
        ap["iata"] = (rec or {}).get("code") or ap["icao"]
    ap.setdefault("city", ap.get("name") or ap["iata"])
    if ap.get("elevation_ft") is None:
        ap["elevation_ft"] = airports.elevation_ft(ap["icao"]) or 0
    if "others" not in ap:      # small fields nearby, whose light aircraft are theirs, not this airport's
        ap["others"] = airports.nearby(home["lat"], home["lon"], radius_nm, exclude=[ap["icao"], ap["iata"]])[:6]
    for f in ap["others"]:
        if f.get("elevation_ft") is None:
            f["elevation_ft"] = airports.elevation_ft(f.get("icao") or f.get("code")) or home.get("elevation_ft") or 0
        if "runways" not in f:      # drawn inside the field's symbol on the radar
            f["runways"] = airports.runways((airports.lookup(f.get("icao") or f.get("code")) or {}).get("icao"))
    if "runways" not in ap:
        ap["runways"] = airports.runways(ap["icao"])
    # the ATC radar's video map: Class B and C airspace (and the airport's own Class D) and VORs
    if "airspace" not in ap:
        ap["airspace"] = airports.airspace_near(home["lat"], home["lon"], own=ap["iata"])
    if "navaids" not in ap:
        ap["navaids"] = airports.navaids_near(home["lat"], home["lon"])
    # hospital helipads: where medical helicopters are going, out past the radar's longest range
    if "helipads" not in ap:
        ap["helipads"] = airports.helipads_near(home["lat"], home["lon"], max(30, radius_nm + 15))
    return ap


def complete_place(cfg):
    """A config with its home located and its airport filled in, ready for a tracker."""
    c = dict(cfg)
    c["home"] = locate_home(cfg["home"])
    c["airport"] = complete_airport(cfg["airport"], c["home"], cfg["tracking"]["radius_nm"])
    if c["home"].get("elevation_ft") is None:         # not given: near enough the airport's
        c["home"]["elevation_ft"] = c["airport"]["elevation_ft"]
    return c


def entry(p, what):
    """A place as [[places]] (or the desktop's location setting) gives it: name, lat and lon or
    zip, and optionally airport (an ICAO code, "auto" or a table), elevation_ft and others.
    Returns its home and airport."""
    home = locate_home({"name": p.get("name"), "lat": p.get("lat"), "lon": p.get("lon"), "zip": p.get("zip"),
                        "elevation_ft": p.get("elevation_ft")}, what)
    if not home["name"]:
        home["name"] = f"ZIP {home['zip']}" if home.get("zip") else f"{home['lat']:.3f}, {home['lon']:.3f}"
    a = p.get("airport") or "auto"
    ap = dict(a) if isinstance(a, dict) else {"icao": str(a)}
    if "others" in p:
        ap["others"] = p["others"]
    return home, ap


def place_config(cfg, pid, home, airport):
    """One place's full config: the shared settings with its own home and airport."""
    c = copy.deepcopy({k: v for k, v in cfg.items() if k != "places"})
    c["home"], c["airport"] = dict(home), dict(airport)
    c = complete_place(c)
    c["place"] = {"id": pid, "name": home["name"]}
    return c


def unique_id(name, taken, unusable=None):
    """An id for a place from its name ("Cabin" -> "cabin"), numbered on ("cabin-2") past those
    taken and any that unusable(id) rules out."""
    pid = base = _slug(name)
    n = 2
    while pid in taken or (unusable and unusable(pid)):
        pid, n = f"{base}-{n}", n + 1
    return pid


def places(cfg):
    """Every place to watch, first to last, each a full config of its own: the shared settings
    with this place's [home] and [airport], and place = {id, name}."""
    entries = [(dict(cfg["home"], name=cfg["home"].get("name") or "Home"), cfg["airport"])]
    for i, p in enumerate(cfg.get("places") or []):
        entries.append(entry(p, f"[[places]] entry {i + 1} ({p.get('name') or 'no name'})"))
    out, ids = [], set()
    for home, airport in entries:
        pid = unique_id(home["name"], ids)
        ids.add(pid)
        out.append(place_config(cfg, pid, home, airport))
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
