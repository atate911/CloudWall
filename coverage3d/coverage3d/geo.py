"""Geometry: distance, bearing, elevation angle and radio horizon.

Units: distances in nautical miles (nm) unless a name says otherwise,
bearings in degrees true (0 = north, clockwise), altitudes in feet (ft) or metres (m).
"""
from __future__ import annotations

import math

EARTH_R_M = 6371008.8            # mean earth radius (sphere)
NM_M = 1852.0
FT_PER_M = 3.280839895
K_REFRACTION = 4.0 / 3.0         # standard radio refraction: effective earth = 4/3 R
R_EFF_M = K_REFRACTION * 6371000.0


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nm."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_R_M * math.asin(min(1.0, math.sqrt(a))) / NM_M


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, 0..360 true."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination(lat: float, lon: float, brg: float, dist_nm: float) -> tuple[float, float]:
    """Point reached from (lat, lon) travelling dist_nm along the initial bearing brg."""
    d = dist_nm * NM_M / EARTH_R_M
    b = math.radians(brg)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1),
                         math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), ((math.degrees(l2) + 540.0) % 360.0) - 180.0


def elevation_angle_deg(h_aircraft_m: float, h_antenna_m: float, dist_nm: float) -> float:
    """Angle above the antenna's horizontal plane at which the aircraft appears.

    angle = atan((h_ac - h_ant) / d - d / (2 * R_eff)), with R_eff = 4/3 earth radius.
    The second term is earth curvature (reduced by radio refraction): far-away targets
    at the same height as the antenna sit *below* the horizontal plane.
    """
    d = dist_nm * NM_M
    dh = h_aircraft_m - h_antenna_m
    if d < 1.0:                                   # directly overhead / underfoot
        return 90.0 if dh > 0 else (-90.0 if dh < 0 else 0.0)
    return math.degrees(math.atan(dh / d - d / (2.0 * R_EFF_M)))


def radio_horizon_nm(antenna_ft: float, alt_ft: float) -> float:
    """Theoretical line-of-sight range: 1.23 * (sqrt(h_antenna_ft) + sqrt(h_ft)) nm."""
    return 1.23 * (math.sqrt(max(antenna_ft, 0.0)) + math.sqrt(max(alt_ft, 0.0)))


def position_error_m(lat1, lon1, lat2, lon2) -> float:
    return haversine_nm(lat1, lon1, lat2, lon2) * NM_M
