"""Configuration: defaults overlaid with an optional TOML file."""
import copy
import tomllib
from pathlib import Path

DEFAULTS = {
    "home": {
        # Placeholder: ~6 miles east of PDX under the 28L/28R final. Set your own.
        "name": "Home",
        "lat": 45.5900,
        "lon": -122.4740,
        "elevation_ft": 100,
    },
    "airport": {"icao": "KPDX", "iata": "PDX", "lat": 45.5887, "lon": -122.5975},
    "tracking": {
        "radius_nm": 15,        # how far out to fetch and show on the board/radar
        "overhead_nm": 3.5,     # inside this, an aircraft counts as "overhead" and is logged
        "max_overhead_alt_ft": 45000,
        "poll_seconds": 5,
    },
    "source": {"name": "adsb.lol",
               "url": "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"},
    "server": {"host": "0.0.0.0", "port": 8080},
    "storage": {"db_path": "cloudwall.db"},
}


def load(path=None):
    cfg = copy.deepcopy(DEFAULTS)
    if path is None and Path("config.toml").exists():
        path = "config.toml"
    if path:
        with open(path, "rb") as f:
            for section, values in tomllib.load(f).items():
                cfg.setdefault(section, {}).update(values)
    return cfg
