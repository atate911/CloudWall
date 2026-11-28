"""Which aircraft.json entries count as "my antenna heard this aircraft".

Only signals received directly from the aircraft belong in the coverage map, judged by readsb's
``type``: adsb_* -> ADSB, mlat -> MLAT (optional layer), uat -> UAT; adsr_*/tisb_* (rebroadcast by
a ground station) and anything else are rejected.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from . import geo

SRC_ADSB, SRC_MLAT, SRC_UAT = 0, 1, 2
SOURCE_NAMES = {SRC_ADSB: "adsb", SRC_MLAT: "mlat", SRC_UAT: "uat"}
SOURCE_IDS = {v: k for k, v in SOURCE_NAMES.items()}

DIRECT_TYPES = {"adsb_icao", "adsb_icao_nt", "adsb_other"}


def classify_source(ac_type: str | None, source_band: str = "1090") -> int | None:
    """Map readsb ``type`` to a coverage source id, or None if it must not be used."""
    if ac_type in DIRECT_TYPES:
        return SRC_UAT if source_band == "978" else SRC_ADSB
    if ac_type == "uat":
        return SRC_UAT
    if ac_type == "mlat":
        return SRC_MLAT
    return None


def parse_hex(hexstr: str) -> int:
    """ICAO hex -> int. A leading '~' (non-ICAO address) sets bit 24."""
    if hexstr.startswith("~"):
        return int(hexstr[1:], 16) | (1 << 24)
    return int(hexstr, 16)


def format_hex(v: int) -> str:
    return ("~" if v & (1 << 24) else "") + format(v & 0xFFFFFF, "06x")


@dataclass
class Point:
    t: int
    hex: int
    callsign: str
    src: int
    lat: float
    lon: float
    alt_baro: int | None
    alt_geom: int | None
    alt: int                  # altitude used for coverage (geom, else baro, ground -> ground elev)
    ground: bool
    rssi: float | None
    dist_nm: float
    brg: float
    elev: float


class PointFilter:
    """Turns aircraft.json entries into validated Points; keeps per-aircraft state for
    de-duplication and the speed-jump check. ``stats`` counts every rejection reason."""

    def __init__(self, station_lat, station_lon, antenna_asl_m, ground_elev_m, sampler_cfg,
                 source_band: str = "1090"):
        self.lat0, self.lon0 = station_lat, station_lon
        self.ant_m = antenna_asl_m
        self.ground_ft = int(round(ground_elev_m * geo.FT_PER_M))
        self.c = sampler_cfg
        self.band = source_band
        self.last: dict[str, tuple[float, float, float]] = {}   # hex -> (pos_time, lat, lon)
        self.bad_run: Counter = Counter()
        self.stats: Counter = Counter()

    def set_station(self, lat, lon, antenna_asl_m, ground_elev_m):
        self.lat0, self.lon0, self.ant_m = lat, lon, antenna_asl_m
        self.ground_ft = int(round(ground_elev_m * geo.FT_PER_M))

    def prune(self, now: float, keep_s: float = 600.0):
        for h in [h for h, v in self.last.items() if now - v[0] > keep_s]:
            del self.last[h]
            self.bad_run.pop(h, None)

    def process(self, ac: dict, now: float) -> Point | None:
        c = self.c
        st = self.stats
        src = classify_source(ac.get("type"), self.band)
        if src is None:
            st["reject_type:" + str(ac.get("type"))] += 1
            return None
        if src == SRC_MLAT and not c.get("record_mlat", True):
            st["reject_mlat_disabled"] += 1
            return None
        lat, lon = ac.get("lat"), ac.get("lon")
        if lat is None or lon is None:
            st["reject_nopos"] += 1
            return None
        seen_pos = ac.get("seen_pos")
        if seen_pos is None or seen_pos >= c["max_seen_pos_s"]:
            st["reject_stale"] += 1
            return None
        nac = ac.get("nac_p")
        if nac is not None and nac < c["min_nac_p"]:
            st["reject_nac_p"] += 1
            return None
        hexs = ac.get("hex")
        if not hexs:
            return None

        # duplicate: the same update seen again has the same position time, or identical coordinates
        pos_t = now - seen_pos
        prev = self.last.get(hexs)
        if prev and (abs(pos_t - prev[0]) < 0.25 or (prev[1] == lat and prev[2] == lon)):
            st["reject_duplicate"] += 1
            return None

        ab = ac.get("alt_baro")
        ag = ac.get("alt_geom")
        ground = ab == "ground"
        alt_baro = None if ground or not isinstance(ab, (int, float)) else int(round(ab))
        alt_geom = int(round(ag)) if isinstance(ag, (int, float)) else None
        if ground:
            alt = self.ground_ft
        elif alt_geom is not None:
            alt = alt_geom
        elif alt_baro is not None:
            alt = alt_baro
        else:
            st["reject_noalt"] += 1
            return None
        if alt < c["min_alt_ft"] or alt > c["max_alt_ft"]:
            st["reject_alt_range"] += 1
            return None

        dist = geo.haversine_nm(self.lat0, self.lon0, lat, lon)
        if dist > c["max_distance_nm"]:
            st["reject_distance"] += 1
            return None

        # jump check; rejected 3 times running, assume the previous point was the bad one and reset
        if prev and pos_t > prev[0]:
            dt = pos_t - prev[0]
            if dt < 120:
                kt = geo.haversine_nm(prev[1], prev[2], lat, lon) / (dt / 3600.0)
                if kt > c["max_speed_kt"]:
                    self.bad_run[hexs] += 1
                    st["reject_jump"] += 1
                    if self.bad_run[hexs] < 3:
                        return None
        self.bad_run.pop(hexs, None)

        self.last[hexs] = (pos_t, lat, lon)
        brg = geo.bearing_deg(self.lat0, self.lon0, lat, lon)
        elev = geo.elevation_angle_deg(alt / geo.FT_PER_M, self.ant_m, dist)
        rssi = ac.get("rssi")
        try:
            return Point(
                t=int(round(pos_t)), hex=parse_hex(hexs),
                callsign=(ac.get("flight") or "").strip(), src=src,
                lat=float(lat), lon=float(lon), alt_baro=alt_baro, alt_geom=alt_geom,
                alt=alt, ground=ground,
                rssi=float(rssi) if isinstance(rssi, (int, float)) else None,
                dist_nm=dist, brg=brg, elev=elev)
        except ValueError:
            st["reject_badhex"] += 1
            return None
