"""Configuration: defaults overlaid with an optional TOML file."""
import copy
import os
import shutil
import tomllib
from pathlib import Path

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
        "radius_nm": 15,        # how far out to fetch and show on the board/radar
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
    # The kiosk has no buttons: its radar is set here. radar: "chart" or "atc" (drawn like an air
    # traffic control screen); tracks: trails and one-minute lines; range_nm: 0 for the tracking
    # radius, or 20 or 30 to see further.
    "kiosk": {"radar": "chart", "tracks": True, "range_nm": 0},
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
                cfg.setdefault(section, {}).update(values)
    src = cfg["source"]
    if src.get("url"):                      # older single-feed setting: try it first
        src["urls"] = [src["url"]] + [u for u in src["urls"] if u != src["url"]]
    cfg["_path"] = str(path) if path else None
    return cfg


def init(path=None):
    """Write a starter config file. Returns (path, created)."""
    path = Path(path) if path else user_config_path()
    if path.exists():
        return path, False
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXAMPLE, path)
    return path, True
