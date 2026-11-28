"""Contrail forecast from upper-air GFS data (Open-Meteo): forms by the Schmidt-Appleman
criterion, persists only when the air is saturated with respect to ice.
"""
import calendar
import math
import time

from ..core.http import get_json

LEVELS = (450, 400, 350, 300, 250, 200, 150)      # hPa, roughly 20,000 to 45,000 ft
URL = ("https://api.open-meteo.com/v1/gfs?latitude={lat:.3f}&longitude={lon:.3f}&forecast_days=2&timezone=UTC"
       "&hourly=" + ",".join(f"{v}_{p}hPa" for p in LEVELS
                             for v in ("temperature", "relative_humidity", "geopotential_height")))

# Schmidt-Appleman inputs for a modern turbofan
EI_H2O, CP, EPS, Q, ETA = 1.25, 1004.0, 0.622, 43.2e6, 0.35
PERSIST_RHI = 95       # % over ice; models run a little dry at these heights


def e_water(t):        # saturation vapour pressure over water, hPa (Magnus, WMO)
    return 6.112 * math.exp(17.62 * t / (243.12 + t))


def e_ice(t):
    return 6.112 * math.exp(22.46 * t / (272.62 + t))


def level(p_hpa, temp_c, rh, height_m):
    """Contrail outlook at one pressure level. GFS reports humidity over ice below -20°C (NCEP's convention)."""
    g = EI_H2O * CP * p_hpa * 100 / (EPS * Q * (1 - ETA)) / 100          # mixing-line slope, hPa/K
    x = math.log(g * 100 - 0.053)
    t_max = -46.46 + 9.43 * x + 0.72 * x * x                               # coldest-needed, bone-dry air
    rhi = rh if temp_c <= -20 else rh * e_water(temp_c) / e_ice(temp_c)
    e_amb = rhi / 100 * e_ice(temp_c)
    forms = temp_c < t_max and e_amb >= e_water(t_max) - g * (t_max - temp_c)
    state = "none" if not forms else "persistent" if rhi >= PERSIST_RHI else "short"
    return {"hpa": p_hpa, "ft": round(height_m * 3.28084 / 100) * 100, "temp_c": round(temp_c, 1),
            "rhi": round(rhi), "threshold_c": round(t_max, 1), "state": state}


def outlook(levels):
    """One sentence and the bands of altitude for each kind of contrail."""
    def band(kind):
        hs = [l["ft"] for l in levels if l["state"] == kind]
        return [min(hs), max(hs)] if hs else None
    lasting, short = band("persistent"), band("short")
    fl = lambda ft: f"{round(ft / 1000)},000 ft"
    if lasting:
        words = f"Long-lasting contrails likely from {fl(lasting[0])} to {fl(lasting[1])}" if lasting[0] != lasting[1] else f"Long-lasting contrails likely near {fl(lasting[0])}"
    elif short:
        words = f"Short-lived contrails above {fl(short[0])}; the air is too dry for them to linger"
    elif levels and all(l["temp_c"] > l["threshold_c"] for l in levels):
        words = "No contrails: the air aloft is too warm"
    else:
        words = "No contrails expected"
    return {"summary": words, "persistent": lasting, "short": short}


def fetch(lat, lon, now=None):
    data = get_json(URL.format(lat=lat, lon=lon), timeout=20)
    h = data["hourly"]
    now = now or time.time()
    # the hours are UTC (timezone=UTC in the request)
    stamps = [calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M")) for t in h["time"]]
    i = min(range(len(stamps)), key=lambda k: abs(stamps[k] - now))
    levels = []
    for p in LEVELS:
        t, rh, z = (h[f"{v}_{p}hPa"][i] for v in ("temperature", "relative_humidity", "geopotential_height"))
        if None not in (t, rh, z):
            levels.append(level(p, t, rh, z))
    return dict(outlook(levels), levels=levels, at=stamps[i], source="GFS via Open-Meteo")


def for_altitude(c, alt_ft):
    """'persistent', 'short' or None for an aircraft at this altitude."""
    if not c or alt_ft is None or alt_ft < 20000:
        return None
    lv = min(c["levels"], key=lambda l: abs(l["ft"] - alt_ft), default=None)
    if not lv or abs(lv["ft"] - alt_ft) > 3500:
        return None
    return lv["state"] if lv["state"] != "none" else None


def demo():
    levels = [level(p, t, rh, z) for p, t, rh, z in
              ((450, -24, 60, 6500), (400, -30, 70, 7200), (350, -37, 80, 8100), (300, -50, 104, 9200),
               (250, -53, 110, 10400), (200, -57, 70, 11800), (150, -58, 20, 13600))]
    return dict(outlook(levels), levels=levels, at=time.time(), source="demo")
