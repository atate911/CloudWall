"""Configuration: defaults, TOML loading and validation (settings documented in config.example.toml)."""
from __future__ import annotations

import copy
import logging
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("coverage3d.config")


DEFAULTS: dict = {
    "station": {
        # WGS84. The live position comes from receiver.json; these are the fallback and the
        # reference for the "wrong position" warning.
        "lat": 45.590000,
        "lon": -122.474000,
        "ground_elevation_m": 23.0,      # above mean sea level
        "antenna_height_m": 4.0,         # above ground
        "position_warn_m": 100.0,        # warn if receiver.json differs from lat/lon by more
        "adsb_im_env": "/opt/adsb/config/.env",   # read ONLY FEEDER_LAT/LONG/ALT_M from it
        "position_source": "receiver",   # "receiver" = use receiver.json (matches readsb); "config" = lat/lon above
    },
    "sampler": {
        "poll_interval_s": 2.0,
        "http_timeout_s": 4.0,
        "max_seen_pos_s": 2.0,           # ignore positions older than this
        "min_nac_p": 5,                  # skip nac_p below this (when present)
        "max_distance_nm": 400.0,
        "min_alt_ft": -1500,
        "max_alt_ft": 60000,
        "max_speed_kt": 1000.0,          # implied speed between two points of one aircraft
        "flush_interval_s": 60.0,        # batch writes to protect the SD card
        "record_mlat": True,             # store MLAT points (shown only if the page asks)
        "backfill_on_start": True,       # import tar1090 history on first start
        "backfill_dir": "/run/adsb-feeder-ultrafeeder/tar1090",
    },
    "coverage": {
        "sector_deg": 5,                 # 1..10, must divide 360 evenly
        "band_ft": 2500,                 # 1000 / 2500 / 5000 ...
        "max_alt_ft": 45000,
        "stat": "p95",                   # "p95" or "max"
        "min_points_per_bin": 3,         # bins with fewer points are not drawn
        "cache_s": 60,
    },
    "storage": {
        "db_path": "/var/lib/coverage3d/coverage.db",
        "retention_days": 30,            # raw points; daily aggregates are kept forever
    },
    "server": {
        "bind": "0.0.0.0",
        "port": 8090,
        "offline_tiles_dir": "",         # z/x/y.png tree for the offline basemap (optional)
        "airports_csv": "",              # optional OurAirports airports.csv
    },
    "web": {
        "basemap": "liberty",
        "rings_nm": 50,
        "ring_count": 6,
    },
}


@dataclass
class SourceCfg:
    name: str = "1090"
    band: str = "1090"                  # "1090" or "978"
    urls: list = field(default_factory=lambda: ["http://127.0.0.1:8080/data/aircraft.json"])
    files: list = field(default_factory=lambda: ["/run/adsb-feeder-ultrafeeder/readsb/aircraft.json"])


@dataclass
class Config:
    station: dict
    sampler: dict
    coverage: dict
    storage: dict
    server: dict
    web: dict
    sources: list

    @property
    def antenna_asl_m(self) -> float:
        return self.station["ground_elevation_m"] + self.station["antenna_height_m"]


def _merge(base: dict, over: dict, path: str = "") -> None:
    for k, v in over.items():
        if k not in base:
            log.warning("unknown config key %s%s ignored", path, k)
        elif isinstance(base[k], dict) and isinstance(v, dict):
            _merge(base[k], v, f"{path}{k}.")
        else:
            base[k] = v


def validate(c: Config) -> None:
    cv = c.coverage
    if not 1 <= int(cv["sector_deg"]) <= 10 or 360 % int(cv["sector_deg"]):
        raise ValueError("coverage.sector_deg must be 1..10 and divide 360 (e.g. 1,2,3,4,5,6,8,9,10)")
    if int(cv["band_ft"]) < 500:
        raise ValueError("coverage.band_ft must be >= 500")
    if cv["stat"] not in ("p95", "max"):
        raise ValueError('coverage.stat must be "p95" or "max"')
    if c.sampler["poll_interval_s"] < 0.5:
        raise ValueError("sampler.poll_interval_s must be >= 0.5")


def load(path: str | None = None) -> Config:
    data = copy.deepcopy(DEFAULTS)
    sources = None
    if path and Path(path).exists():
        with open(path, "rb") as f:
            raw = tomllib.load(f)
        sources = raw.pop("source", None)
        _merge(data, raw)
    elif path:
        log.warning("config file %s not found; using defaults", path)
    if sources:
        srcs = [SourceCfg(**{k: v for k, v in s.items() if k in SourceCfg.__dataclass_fields__})
                for s in sources]
        for s, given in zip(srcs, sources):        # the default fallback file is the default source's only
            if "files" not in given and ("urls" in given or s.band != "1090"):
                s.files = []
    else:
        srcs = [SourceCfg()]
    cfg = Config(sources=srcs, **data)
    validate(cfg)
    return cfg
