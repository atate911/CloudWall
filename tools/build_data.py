"""Build CloudWall's bundled tables from their public sources.

    python3 tools/build_data.py runways [runways.csv]      # OurAirports runways (public domain)
    python3 tools/build_data.py airline [airports.csv]     # OurAirports airports with airline service
    python3 tools/build_data.py zips [Gaz_zcta_national]   # Census ZIP code areas (public domain)
    python3 tools/build_data.py cwt aircraft.json          # wake categories, from openScope's aircraft data

Without a file each downloads its source. Every output is limited to what CloudWall uses:

- runways: the open runways of the airports in cloudwall/data/airports.csv and fields.csv with
  both ends surveyed, leaving out helipads and water lanes, positions to about a metre, and the
  elevation of the first end (CloudWall takes it as the field's).
- airline: the airports in airports.csv with scheduled airline service, and whether each is a
  large one; CloudWall picks a place's airport from these when it isn't given.
- cwt: each aircraft type's FAA Consolidated Wake Turbulence category (A-I, JO 7110.126), as
  STARS data blocks show it, from openScope's aircraft file (MIT licence; it has no download URL,
  so give the file: resources/openscope-aircraft.json in openScope or the vice simulator).
- zips: each ZIP code area's internal point (its centre, or the nearest point inside it), to
  four decimal places. Takes the Gazetteer file (tab-separated: GEOID ... INTPTLAT INTPTLONG,
  plain or zipped) or a zip,lat,lng CSV of it.
"""
import csv
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data/"
GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip"
DATA = Path(__file__).resolve().parent.parent / "cloudwall" / "data"


def source(arg, url):
    """The source file's text: the file given, else downloaded. A .zip yields its first file."""
    raw = Path(arg).read_bytes() if arg else urllib.request.urlopen(url, timeout=120).read()
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            raw = z.read(z.namelist()[0])
    return raw.decode("utf-8-sig")


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def write(name, header, comment, data):
    out = DATA / name
    with open(out, "w", newline="", encoding="utf-8") as f:
        f.write("".join(f"# {line}\n" for line in comment))
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(data)
    print(f"{len(data)} rows -> {out}")


def runways(arg):
    wanted = {r["icao"] for r in rows(DATA / "airports.csv")} | {r["icao"] for r in rows(DATA / "fields.csv")}
    out = []
    for r in csv.DictReader(io.StringIO(source(arg, OURAIRPORTS + "runways.csv"))):
        if r["airport_ident"] not in wanted or r["closed"] == "1":
            continue
        if r["le_ident"].upper().startswith("H") or "WATER" in r["surface"].upper():
            continue
        try:
            ends = [round(float(r[k]), 5) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
        except ValueError:
            continue                               # an end without a surveyed position
        length = int(float(r["length_ft"] or 0))
        if length < 1000:
            continue
        elev = r["le_elevation_ft"] or r["he_elevation_ft"]
        out.append([r["airport_ident"], r["le_ident"], r["he_ident"], length, *ends, int(float(elev)) if elev else ""])
    out.sort()
    write("runways.csv", ["icao", "le", "he", "length_ft", "le_lat", "le_lon", "he_lat", "he_lon", "elev_ft"],
          ["Runways of the airports in airports.csv and fields.csv, from OurAirports (ourairports.com, public domain).",
           "Open runways with both ends surveyed; helipads and water lanes left out.",
           "Rebuild with: python3 tools/build_data.py runways"], out)


def airline(arg):
    ours = {r["icao"] for r in rows(DATA / "airports.csv")}
    out = sorted([a["ident"], "large" if a["type"] == "large_airport" else "medium"]
                 for a in csv.DictReader(io.StringIO(source(arg, OURAIRPORTS + "airports.csv")))
                 if a["scheduled_service"] == "yes" and a["type"] in ("large_airport", "medium_airport") and a["ident"] in ours)
    write("airline_airports.csv", ["icao", "size"],
          ["The airports in airports.csv with scheduled airline service, from OurAirports (ourairports.com, public domain).",
           "size: large or medium, as OurAirports classes them. A place's airport, when not given, is the nearest",
           "large one within 30 nm, else the nearest of any size.",
           "Rebuild with: python3 tools/build_data.py airline"], out)


def zips(arg):
    text = source(arg, GAZETTEER)
    if "\t" in text.split("\n", 1)[0]:          # the Gazetteer itself
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")
        get = lambda r: (r["GEOID"], r["INTPTLAT"], r[next(k for k in r if k.strip() == "INTPTLONG")])
    else:                                         # zip,lat,lng
        reader = csv.DictReader(io.StringIO(text))
        get = lambda r: (r["zip"], r["lat"], r.get("lng") or r.get("lon"))
    out = sorted([z.strip(), f"{float(lat):.4f}", f"{float(lon):.4f}"] for z, lat, lon in map(get, reader))
    write("zips.csv", ["zip", "lat", "lon"],
          ["US ZIP code areas (Census ZCTAs) and their internal points, from the 2025 Census Gazetteer",
           "(public domain). A ZIP's point marks its area, not any one address.",
           "Rebuild with: python3 tools/build_data.py zips"], out)


def cwt(arg):
    import json
    if not arg:
        raise SystemExit("cwt needs the aircraft file: python3 tools/build_data.py cwt openscope-aircraft.json")
    data = json.loads(Path(arg).read_text(encoding="utf-8"))
    out = sorted([a["icao"], a["category"]["cwt"]] for a in data["aircraft"]
                 if (a.get("category") or {}).get("cwt") and a.get("icao"))
    write("cwt.csv", ["type", "cwt"],
          ["Aircraft types' FAA Consolidated Wake Turbulence categories (A super ... I small; JO 7110.126),",
           "as STARS data blocks show them. Compiled from openScope's aircraft data (MIT licence).",
           "Rebuild with: python3 tools/build_data.py cwt openscope-aircraft.json"], out)


if __name__ == "__main__":
    jobs = {"runways": runways, "airline": airline, "zips": zips, "cwt": cwt}
    if len(sys.argv) < 2 or sys.argv[1] not in jobs:
        raise SystemExit(__doc__)
    jobs[sys.argv[1]](sys.argv[2] if len(sys.argv) > 2 else None)
