"""Small-angle and great-circle helpers. Distances are nautical miles."""
import math

R_NM = 3440.065
FT_PER_NM = 6076.12
POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
          "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def haversine_nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_NM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2, degrees true."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360


def compass(deg):
    return POINTS[int((deg % 360) / 22.5 + 0.5) % 16]


def elevation_deg(dist_nm, alt_ft, home_elev_ft=0):
    """Angle above the horizon at which to look for the aircraft."""
    return math.degrees(math.atan2(alt_ft - home_elev_ft, max(dist_nm, 0.01) * FT_PER_NM))


def cpa(home_lat, home_lon, lat, lon, track, gs):
    """Closest point of approach on the current track and speed: (seconds_until, distance_nm);
    seconds is 0 if already receding."""
    x = (lon - home_lon) * 60 * math.cos(math.radians(home_lat))
    y = (lat - home_lat) * 60
    if not gs or gs < 1 or track is None:
        return 0, math.hypot(x, y)
    vx = gs * math.sin(math.radians(track))
    vy = gs * math.cos(math.radians(track))
    t = -(x * vx + y * vy) / (vx * vx + vy * vy)  # hours
    if t <= 0:
        return 0, math.hypot(x, y)
    return int(t * 3600), math.hypot(x + vx * t, y + vy * t)


def route_plausible(o_lat, o_lon, d_lat, d_lon, lat, lon):
    """Is the aircraft roughly between origin and destination? (Callsign->route databases go stale.)"""
    direct = haversine_nm(o_lat, o_lon, d_lat, d_lon)
    via = haversine_nm(o_lat, o_lon, lat, lon) + haversine_nm(lat, lon, d_lat, d_lon)
    return via <= direct * 1.25 + 120
