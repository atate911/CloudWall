"""The station: position from receiver.json, elevation from config, sanity checks."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from . import geo

log = logging.getLogger("coverage3d.station")
_WANTED = ("FEEDER_LAT", "FEEDER_LONG", "FEEDER_ALT_M")


@dataclass
class Station:
    lat: float
    lon: float
    ground_elevation_m: float
    antenna_height_m: float
    source: str = "config"

    @property
    def antenna_asl_m(self) -> float:
        return self.ground_elevation_m + self.antenna_height_m

    def to_dict(self):
        return {"lat": self.lat, "lon": self.lon, "ground_elevation_m": self.ground_elevation_m,
                "antenna_height_m": self.antenna_height_m, "antenna_asl_m": self.antenna_asl_m,
                "antenna_asl_ft": self.antenna_asl_m * geo.FT_PER_M, "position_source": self.source}


def read_adsb_im_env(path: str) -> dict:
    """Read ONLY FEEDER_LAT / FEEDER_LONG / FEEDER_ALT_M from adsb.im's .env.

    That file also holds feeder keys and other secrets: nothing else is parsed, kept or logged.
    """
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                k, sep, v = line.partition("=")
                k = k.strip()
                if sep and k in _WANTED:
                    try:
                        out[k] = float(v.strip().strip("'\""))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


def build_station(cfg, receiver: dict | None) -> Station:
    """Station from config + receiver.json, logging clear warnings about disagreements."""
    sc = cfg.station
    lat, lon, src = sc["lat"], sc["lon"], "config"
    if receiver and "lat" in receiver and "lon" in receiver:
        rlat, rlon = float(receiver["lat"]), float(receiver["lon"])
        err = geo.position_error_m(sc["lat"], sc["lon"], rlat, rlon)
        if err > sc["position_warn_m"]:
            log.warning("receiver.json position (%.6f, %.6f) is %.0f m from the configured true "
                        "position (%.6f, %.6f): the decoder may have a wrong station position set. "
                        "Distances/bearings are computed from the %s position.",
                        rlat, rlon, err, sc["lat"], sc["lon"],
                        "receiver.json" if sc.get("position_source", "receiver") == "receiver" else "config")
        if sc.get("position_source", "receiver") == "receiver":
            lat, lon, src = rlat, rlon, "receiver.json"
    elif sc.get("position_source", "receiver") == "receiver":
        log.warning("receiver.json unavailable; using the configured position")
    st = Station(lat, lon, sc["ground_elevation_m"], sc["antenna_height_m"], src)

    env = read_adsb_im_env(sc["adsb_im_env"]) if sc.get("adsb_im_env") else {}
    if "FEEDER_ALT_M" in env and abs(env["FEEDER_ALT_M"] - st.antenna_asl_m) > 2.0:
        log.warning("adsb.im FEEDER_ALT_M=%.1f m differs from ground %.1f m + antenna %.1f m = %.1f m "
                    "(update antenna_height_m in the config if you moved the antenna)",
                    env["FEEDER_ALT_M"], st.ground_elevation_m, st.antenna_height_m, st.antenna_asl_m)
    if "FEEDER_LAT" in env and "FEEDER_LONG" in env:
        e = geo.position_error_m(st.lat, st.lon, env["FEEDER_LAT"], env["FEEDER_LONG"])
        if e > sc["position_warn_m"]:
            log.warning("adsb.im FEEDER_LAT/LONG is %.0f m from the position in use", e)
    return st
