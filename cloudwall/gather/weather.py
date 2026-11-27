"""Aviation weather for the airport: the latest METAR, the last 24 hours of them, and the TAF.

Everything is decoded here into plain values (and plain words) so the display only draws."""
import math
import re
import time

from ..core.http import get_json

BASE = "https://aviationweather.gov/api/data"
CEILING_COVERS = ("BKN", "OVC", "OVX", "VV")
CATEGORIES = ("VFR", "MVFR", "IFR", "LIFR")
COVER_WORDS = {"SKC": "Clear", "CLR": "Clear", "CAVOK": "Clear", "NCD": "Clear", "NSC": "No significant cloud",
               "FEW": "Few clouds", "SCT": "Scattered clouds", "BKN": "Broken clouds", "OVC": "Overcast",
               "OVX": "Sky obscured", "VV": "Sky obscured"}
OKTAS = {"FEW": 2, "SCT": 4, "BKN": 6, "OVC": 8, "OVX": 8, "VV": 8}

WX_WORDS = {"RA": "rain", "DZ": "drizzle", "SN": "snow", "SG": "snow grains", "PL": "ice pellets", "GR": "hail",
            "GS": "small hail", "UP": "precipitation", "BR": "mist", "FG": "fog", "HZ": "haze", "FU": "smoke",
            "DU": "dust", "SA": "sand", "VA": "volcanic ash", "SQ": "squalls", "FC": "funnel cloud",
            "TS": "thunderstorm", "SH": "showers", "FZ": "freezing", "BL": "blowing", "DR": "drifting",
            "MI": "shallow", "BC": "patches of", "PR": "partial", "VC": "nearby"}


def parse_vis(v):
    """'10+' -> 10, '1 1/2' -> 1.5, '1/4' -> 0.25, 'M1/4' (less than) -> 0.25; statute miles.
    None for anything that isn't a visibility: one odd report mustn't cost the whole day's."""
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
    """FAA flight category from ceiling (ft) and visibility (mi)."""
    if (ceil is not None and ceil < 500) or (vis is not None and vis < 1):
        return "LIFR"
    if (ceil is not None and ceil < 1000) or (vis is not None and vis < 3):
        return "IFR"
    if (ceil is not None and ceil <= 3000) or (vis is not None and vis <= 5):
        return "MVFR"
    return "VFR"


def wx_words(wx):
    """'-RA BR' -> 'light rain, mist'."""
    out = []
    for tok in (wx or "").split():
        inten = "light " if tok.startswith("-") else "heavy " if tok.startswith("+") else ""
        codes = re.findall(r"[A-Z]{2}", tok.lstrip("+-"))
        words = [WX_WORDS.get(c, c) for c in codes]
        if "showers" in words and len(words) > 1:          # 'SHRA' reads better as 'rain showers'
            words.remove("showers"); words.append("showers")
        if "thunderstorm" in words and len(words) > 1:
            words.remove("thunderstorm"); words.insert(0, "thunderstorm with")
        out.append((inten + " ".join(words)).strip())
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
    return {"dir": None if d in (None, "VRB") else d, "variable": d == "VRB", "speed": m.get("wspd") or 0,
            "gust": m.get("wgst")}


def decode_metar(m, elev_ft):
    clouds = [{"cover": c.get("cover"), "base": c.get("base"), "oktas": OKTAS.get(c.get("cover"), 0)}
              for c in m.get("clouds") or []]
    vis = parse_vis(m.get("visib"))
    ceil = ceiling(clouds)
    cat = m.get("fltCat") if m.get("fltCat") in CATEGORIES else category(ceil, vis)     # the service's, if it is one
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
    periods = []
    for f in t.get("fcsts") or []:
        clouds = [{"cover": c.get("cover"), "base": c.get("base")} for c in f.get("clouds") or []]
        vis = parse_vis(f.get("visib"))
        ceil = ceiling(clouds)
        if f.get("vertVis"):
            ceil = min(ceil, f["vertVis"]) if ceil is not None else f["vertVis"]
        periods.append({
            "from": f.get("timeFrom"), "to": f.get("timeTo"), "change": f.get("fcstChange"),
            "probability": f.get("probability"), "wind": _wind(f), "visibility": vis,
            "clouds": clouds, "ceiling": ceil, "category": category(ceil, vis),
            "weather": wx_words(f.get("wxString")), "wind_shear": bool(f.get("wshearHgt")),
        })
    return {"raw": t.get("rawTAF"), "issued": t.get("issueTime"), "from": t.get("validTimeFrom"),
            "to": t.get("validTimeTo"), "periods": periods}


def fetch_all(icao):
    """Latest METAR (short form for the header), 24 h of decoded history, and the TAF."""
    metars = get_json(f"{BASE}/metar?ids={icao}&format=json&hours=24") or []
    metars = sorted(metars, key=lambda m: m.get("obsTime") or 0)
    if not metars:
        return None, None
    latest = metars[-1]
    elev_ft = round((latest.get("elev") or 0) * 3.281)
    short = {"station": latest.get("icaoId"), "raw": latest.get("rawOb"),
             "category": decode_metar(latest, elev_ft)["category"],
             "temp_c": latest.get("temp"), "wind_dir": latest.get("wdir"), "wind_kt": latest.get("wspd"),
             "gust_kt": latest.get("wgst"), "visibility": latest.get("visib"), "cover": latest.get("cover"),
             "clouds": latest.get("clouds")}
    taf = None
    try:
        tafs = get_json(f"{BASE}/taf?ids={icao}&format=json") or []
        if tafs:
            taf = decode_taf(tafs[0])
    except Exception:
        pass                          # the forecast is a bonus; observations still show
    full = {"station": latest.get("icaoId"), "name": latest.get("name"), "elevation_ft": elev_ft,
            "fetched": time.time(), "now": decode_metar(latest, elev_ft),
            "history": [decode_metar(m, elev_ft) for m in metars], "taf": taf}
    return short, full


def demo(icao="KPDX", name="Portland Intl, OR, US"):
    """Plausible Portland weather for demo mode: a day of showers clearing, with a TAF. Another
    place's demo gets the same weather under its own airport's code and name."""
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
    short = {"station": icao, "raw": latest["rawOb"], "category": latest["fltCat"], "temp_c": latest["temp"],
             "wind_dir": latest["wdir"], "wind_kt": latest["wspd"], "gust_kt": latest["wgst"],
             "visibility": latest["visib"], "cover": "BKN", "clouds": latest["clouds"]}
    full = {"station": icao, "name": name, "elevation_ft": elev_ft, "fetched": time.time(),
            "now": decode_metar(latest, elev_ft), "history": [decode_metar(m, elev_ft) for m in metars],
            "taf": decode_taf(taf)}
    return short, full
