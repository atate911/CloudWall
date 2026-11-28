"""Aviation weather for the airport (latest METAR, 24 h of them, the TAF), decoded here into
plain values and words so the display only draws."""
import math
import re
import time

from ..core.http import get_json

BASE = "https://aviationweather.gov/api/data"
CEILING_COVERS = ("BKN", "OVC", "OVX", "VV")
CATEGORIES = ("VFR", "MVFR", "IFR", "LIFR")
OKTAS = {"FEW": 2, "SCT": 4, "BKN": 6, "OVC": 8, "OVX": 8, "VV": 8}

STALE_S = 2.5 * 3600      # a station reports at least hourly
# qualifier codes, worded before the phenomenon
WX_BEFORE = {"VC": "nearby", "MI": "shallow", "BC": "patches of", "PR": "partial", "DR": "drifting", "BL": "blowing",
             "FZ": "freezing"}
WX_WORDS = {"RA": "rain", "DZ": "drizzle", "SN": "snow", "SG": "snow grains", "PL": "ice pellets", "GR": "hail",
            "GS": "small hail", "UP": "precipitation", "BR": "mist", "FG": "fog", "HZ": "haze", "FU": "smoke",
            "DU": "dust", "SA": "sand", "VA": "volcanic ash", "SQ": "squalls", "FC": "funnel cloud",
            "PO": "dust whirls", "SS": "sandstorm", "DS": "dust storm", "IC": "ice crystals", "PY": "spray"}


def parse_vis(v):
    """'10+' -> 10, '1 1/2' -> 1.5, 'M1/4' (less than) -> 0.25; statute miles. None if unparseable."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    parts = str(v).upper().replace("+", "").replace("SM", "").strip().lstrip("MP").split()
    try:
        total = 0.0
        for part in parts:
            if "/" in part:
                a, b = part.split("/", 1)
                total += float(a) / float(b)
            else:
                total += float(part)
        return total if parts else None
    except (ValueError, ZeroDivisionError):
        return None


def ceiling(clouds):
    bases = [c.get("base") for c in clouds or [] if c.get("cover") in CEILING_COVERS and c.get("base") is not None]
    return min(bases) if bases else None


def category(ceil, vis):
    """FAA flight category from ceiling (ft) and visibility (mi), the worse deciding; with no
    visibility, None where it would be VFR."""
    if (ceil is not None and ceil < 500) or (vis is not None and vis < 1):
        return "LIFR"
    if (ceil is not None and ceil < 1000) or (vis is not None and vis < 3):
        return "IFR"
    if (ceil is not None and ceil <= 3000) or (vis is not None and vis <= 5):
        return "MVFR"
    return "VFR" if vis is not None else None


def wx_words(wx):
    """'-RA BR' -> 'light rain, mist'; '-RADZ' -> 'light rain and drizzle'; 'VCSH' -> 'nearby showers'."""
    out = []
    for tok in (wx or "").split():
        if tok.strip("+-") == "NSW":                       # "no significant weather"
            continue
        if tok == "+FC":
            out.append("tornado")
            continue
        inten = "light " if tok.startswith("-") else "heavy " if tok.startswith("+") else ""
        codes = re.findall(r"[A-Z]{2}", tok.lstrip("+-"))
        before = [WX_BEFORE[c] for c in codes if c in WX_BEFORE]
        what = " and ".join(WX_WORDS.get(c, c) for c in codes if c not in WX_BEFORE and c not in ("SH", "TS"))
        if "SH" in codes:                                  # 'SHRA' reads better as 'rain showers'
            what = f"{what} showers".strip()
        if "TS" in codes:
            what = f"thunderstorm with {what}" if what else "thunderstorm"
        out.append((inten + " ".join(before + [what])).strip())
    return ", ".join(w for w in out if w)


def humidity(t, td):
    if t is None or td is None:
        return None
    a, b = 17.625, 243.04
    return round(100 * math.exp(a * td / (b + td)) / math.exp(a * t / (b + t)))


def density_altitude(elev_ft, temp_c, altim_hpa):
    if temp_c is None or altim_hpa is None:
        return None
    pressure_alt = elev_ft + (29.92 - altim_hpa * 0.02953) * 1000
    isa = 15 - 2 * elev_ft / 1000
    return round(pressure_alt + 120 * (temp_c - isa))


def _wind(m):
    d = m.get("wdir")
    # no wind given at all (a forecast change only about cloud): speed None, not calm
    return {"dir": None if d in (None, "VRB") else d, "variable": d == "VRB",
            "speed": None if d is None and m.get("wspd") is None else m.get("wspd") or 0,
            "gust": m.get("wgst")}


def decode_metar(m, elev_ft):
    clouds = [{"cover": c.get("cover"), "base": c.get("base"), "oktas": OKTAS.get(c.get("cover"), 0)}
              for c in m.get("clouds") or []]
    vis = parse_vis(m.get("visib"))
    ceil = ceiling(clouds)
    if m.get("vertVis") is not None:                     # sky obscured: vertical visibility is the ceiling
        ceil = min(ceil, m["vertVis"]) if ceil is not None else m["vertVis"]
    cat = m.get("fltCat") if m.get("fltCat") in CATEGORIES else category(ceil, vis)
    t, td = m.get("temp"), m.get("dewp")
    altim = m.get("altim")
    return {
        "time": m.get("obsTime"), "raw": m.get("rawOb"), "special": m.get("metarType") == "SPECI",
        "category": cat, "wind": _wind(m), "visibility": vis, "visibility_plus": "+" in str(m.get("visib") or ""),
        "clouds": clouds, "ceiling": ceil, "cover": m.get("cover"),
        "temp_c": t, "dew_c": td, "humidity": humidity(t, td),
        "altimeter_inhg": round(altim * 0.02953, 2) if altim else None, "altimeter_hpa": altim,
        "density_alt": density_altitude(elev_ft, t, altim), "weather": wx_words(m.get("wxString")),
        "weather_raw": m.get("wxString"),
    }


def decode_taf(t):
    """The forecast's periods. A TEMPO or PROB gives only what differs, so its category takes the
    missing visibility or cloud from the period it interrupts; its own fields stay as written."""
    periods, prevailing = [], []
    for f in t.get("fcsts") or []:
        change = f.get("fcstChange")
        passing = change in ("TEMPO", "PROB") or bool(f.get("probability"))
        clouds = [{"cover": c.get("cover"), "base": c.get("base")} for c in f.get("clouds") or []]
        vis = parse_vis(f.get("visib"))
        ceil = ceiling(clouds)
        if f.get("vertVis") is not None:
            ceil = min(ceil, f["vertVis"]) if ceil is not None else f["vertVis"]
        cat_ceil, cat_vis = ceil, vis
        if passing:
            start = f.get("timeFrom") or 0
            under = next((p for p in reversed(prevailing) if (p["from"] or 0) <= start), prevailing[-1] if prevailing else None)
            if under:
                cat_vis = vis if vis is not None else under["visibility"]
                cat_ceil = ceil if clouds or f.get("vertVis") is not None else under["ceiling"]
        period = {
            "from": f.get("timeFrom"), "to": f.get("timeTo"), "change": change, "becoming_by": f.get("timeBec"),
            "probability": f.get("probability"), "wind": _wind(f), "visibility": vis,
            "clouds": clouds, "ceiling": ceil, "category": category(cat_ceil, cat_vis),
            "weather": wx_words(f.get("wxString")), "wind_shear": bool(f.get("wshearHgt")),
        }
        periods.append(period)
        if not passing:
            prevailing.append(period)
    return {"raw": t.get("rawTAF"), "issued": t.get("issueTime"), "from": t.get("validTimeFrom"),
            "to": t.get("validTimeTo"), "periods": periods}


def is_stale(obs_time, now=None):
    return obs_time is None or (now or time.time()) - obs_time > STALE_S


def fetch_all(icao):
    """(short, full): the latest METAR for the header; 24 h of decoded history and the TAF.
    (None, None) with no reports."""
    metars = get_json(f"{BASE}/metar?ids={icao}&format=json&hours=24") or []
    metars = sorted(metars, key=lambda m: m.get("obsTime") or 0)
    if not metars:
        return None, None
    latest = metars[-1]
    elev_ft = round((latest.get("elev") or 0) * 3.281)
    short = {"station": latest.get("icaoId"), "raw": latest.get("rawOb"), "time": latest.get("obsTime"),
             "category": decode_metar(latest, elev_ft)["category"],
             "temp_c": latest.get("temp"), "wind_dir": latest.get("wdir"), "wind_kt": latest.get("wspd"),
             "gust_kt": latest.get("wgst"), "visibility": latest.get("visib"), "cover": latest.get("cover"),
             "clouds": latest.get("clouds")}
    taf = None
    try:
        tafs = get_json(f"{BASE}/taf?ids={icao}&format=json") or []
        if tafs:
            taf = decode_taf(max(tafs, key=lambda x: str(x.get("issueTime") or "")))
    except Exception:
        pass                          # the forecast is a bonus; observations still show
    full = {"station": latest.get("icaoId"), "name": latest.get("name"), "elevation_ft": elev_ft,
            "fetched": time.time(), "now": decode_metar(latest, elev_ft),
            "history": [decode_metar(m, elev_ft) for m in metars], "taf": taf}
    return short, full


def demo(icao="KPDX", name="Portland Intl, OR, US"):
    """Demo weather (showers clearing, with a TAF) under the given airport's code and name."""
    now = int(time.time()) // 3600 * 3600
    metars = []
    for h in range(24, -1, -1):
        t = now - h * 3600
        rainy = 6 <= h <= 14
        clouds = ([{"cover": "FEW", "base": 1200}, {"cover": "BKN", "base": 2200 + 150 * (h % 4)}, {"cover": "OVC", "base": 4500}]
                  if rainy else [{"cover": "SCT", "base": 3500}, {"cover": "BKN", "base": 6000}])
        temp = 9.0 + 3 * math.sin((24 - h - 8) / 24 * 2 * math.pi)
        metars.append({"icaoId": icao, "name": name, "elev": 7, "obsTime": t,
                       "temp": round(temp, 1), "dewp": round(temp - (1.0 if rainy else 3.5), 1),
                       "wdir": 150 if rainy else 300, "wspd": 12 if rainy else 6, "wgst": 21 if 8 <= h <= 11 else None,
                       "visib": 4 if 9 <= h <= 11 else "10+", "altim": 1012.0 + 0.4 * (24 - h) / 2,
                       "clouds": clouds, "wxString": "-SHRA" if 8 <= h <= 12 else None, "metarType": "METAR",
                       "rawOb": f"METAR {icao} {time.strftime('%d%H%M', time.gmtime(t))}Z 30006KT 10SM SCT035 BKN060 11/07 A3002"})
    for m in metars:
        m["fltCat"] = category(ceiling(m["clouds"]), parse_vis(m["visib"]))
    taf = {"rawTAF": f"TAF {icao} 170305Z 1703/1724 30006KT P6SM SCT035 BKN060 FM171200 15010G18KT 5SM -RA BKN025 OVC045 TEMPO 1714/1718 3SM -RA BKN012 FM171900 18008KT P6SM BKN040",
           "issueTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "validTimeFrom": now, "validTimeTo": now + 24 * 3600,
           "fcsts": [
               {"timeFrom": now, "timeTo": now + 8 * 3600, "fcstChange": None, "wdir": 300, "wspd": 6, "visib": "6+",
                "clouds": [{"cover": "SCT", "base": 3500}, {"cover": "BKN", "base": 6000}]},
               {"timeFrom": now + 8 * 3600, "timeTo": now + 16 * 3600, "fcstChange": "FM", "wdir": 150, "wspd": 10, "wgst": 18,
                "visib": 5, "wxString": "-RA", "clouds": [{"cover": "BKN", "base": 2500}, {"cover": "OVC", "base": 4500}]},
               {"timeFrom": now + 10 * 3600, "timeTo": now + 14 * 3600, "fcstChange": "TEMPO", "wdir": 150, "wspd": 10,
                "visib": 3, "wxString": "-RA", "clouds": [{"cover": "BKN", "base": 1200}]},
               {"timeFrom": now + 16 * 3600, "timeTo": now + 24 * 3600, "fcstChange": "FM", "wdir": 180, "wspd": 8, "visib": "6+",
                "clouds": [{"cover": "BKN", "base": 4000}]}]}
    latest = metars[-1]
    elev_ft = 23
    short = {"station": icao, "raw": latest["rawOb"], "time": latest["obsTime"], "category": latest["fltCat"], "temp_c": latest["temp"],
             "wind_dir": latest["wdir"], "wind_kt": latest["wspd"], "gust_kt": latest["wgst"],
             "visibility": latest["visib"], "cover": "BKN", "clouds": latest["clouds"]}
    full = {"station": icao, "name": name, "elevation_ft": elev_ft, "fetched": time.time(),
            "now": decode_metar(latest, elev_ft), "history": [decode_metar(m, elev_ft) for m in metars],
            "taf": decode_taf(taf)}
    return short, full
