from .http import get_json


def fetch_metar(icao):
    data = get_json(f"https://aviationweather.gov/api/data/metar?ids={icao}&format=json")
    if not data:
        return None
    m = data[0]
    return {"station": m.get("icaoId"), "raw": m.get("rawOb"), "category": m.get("fltCat"),
            "temp_c": m.get("temp"), "wind_dir": m.get("wdir"), "wind_kt": m.get("wspd"),
            "gust_kt": m.get("wgst"), "visibility": m.get("visib"), "cover": m.get("cover"),
            "clouds": m.get("clouds")}
