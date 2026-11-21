"""Build CloudWall's bundled tables from their public sources.

    python3 tools/build_data.py runways [runways.csv]      # OurAirports runways (public domain)
    python3 tools/build_data.py airline [airports.csv]     # OurAirports airports with airline service
    python3 tools/build_data.py zips [Gaz_zcta_national]   # Census ZIP code areas (public domain)
    python3 tools/build_data.py cwt aircraft.json          # wake categories, from openScope's aircraft data
    python3 tools/build_data.py airspace [package.tgz]     # Class B, C and D airspace (FAA NASR, public domain)
    python3 tools/build_data.py navaids [package.tgz]      # VOR and TACAN stations (FAA NASR, public domain)
    python3 tools/build_data.py borders [folder]           # borders and cities (Natural Earth, public domain)
    python3 tools/build_data.py helipads [package.tgz]     # US hospital helipads (FAA NASR, public domain)

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
- airspace: every Class B and C area, and the Class D areas of the airports in
  airline_airports.csv, from the FAA's NASR airspace data as packaged (GeoJSON) by the
  @squawk/airspace-data npm package (MIT). Outlines simplified to about 100 m, with the floor and
  ceiling of each area and a point inside it for its label. Drawn on the ATC-style radar.
- navaids: the VOR, VOR/DME, VORTAC and TACAN stations in the FAA's NASR data, from the
  @squawk/navaid-data npm package (MIT); not NDBs, DMEs or VOR test facilities.
- helipads: the open heliports in the FAA's NASR data whose names say they serve a hospital (a
  hospital, medical centre, health system, clinic or ER), from the @squawk/airport-data npm
  package (MIT). Names are tidied from the FAA's capitals and abbreviations ("ST VINCENT MED CTR"
  -> "St. Vincent Medical Center"), with a short form for the radar ("OHSU"). The US only.
- borders: for the flight card's route map (cloudwall/web/maps/world.json), Natural Earth's 1:50m
  country borders on land and state and province lines (the US, Canada, Australia, Brazil and a
  few more), simplified to about 2 km, and its populated places (the larger cities and the
  national, state and provincial capitals). Takes a folder holding the three GeoJSON files, else
  downloads them from Natural Earth's repository.
"""
import csv
import gzip
import io
import json
import math
import re
import sys
import tarfile
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


def npm_data(arg, package, version, member):
    """A data file inside an npm package: the package's tarball (given, else downloaded from the
    registry), or the data file itself, gzipped or not."""
    raw = Path(arg).read_bytes() if arg else urllib.request.urlopen(
        f"https://registry.npmjs.org/@squawk/{package}/-/{package}-{version}.tgz", timeout=120).read()
    if raw[:2] == b"\x1f\x8b":
        try:
            with tarfile.open(fileobj=io.BytesIO(raw)) as t:
                raw = t.extractfile(f"package/data/{member}").read()
        except tarfile.ReadError:
            pass                                    # a gzipped data file, not a package
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def simplify(points, tol):
    """Douglas-Peucker: the fewest points within tol (degrees) of the outline."""
    if len(points) < 3:
        return points
    (y0, x0), (y1, x1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = math.hypot(dx, dy)
    far, at = 0.0, 0
    for i in range(1, len(points) - 1):
        y, x = points[i]
        d = abs(dy * (x - x0) - dx * (y - y0)) / norm if norm else math.hypot(x - x0, y - y0)
        if d > far:
            far, at = d, i
    if far <= tol:
        return [points[0], points[-1]]
    return simplify(points[:at + 1], tol)[:-1] + simplify(points[at:], tol)


def inside(lat, lon, ring):
    hit = False
    for (ya, xa), (yb, xb) in zip(ring, ring[1:] + ring[:1]):
        if (ya > lat) != (yb > lat) and lon < xa + (lat - ya) * (xb - xa) / (yb - ya):
            hit = not hit
    return hit


def label_point(ring):
    """A point well inside an outline (a shelf of a Class C wraps around the surface area, so its
    centre of mass can lie outside it): of a grid across it, the point farthest from its edge."""
    lats, lons = [p[0] for p in ring], [p[1] for p in ring]
    best, far = (sum(lats) / len(lats), sum(lons) / len(lons)), -1.0
    k = math.cos(math.radians(best[0]))
    for i in range(1, 24):
        for j in range(1, 24):
            lat = min(lats) + (max(lats) - min(lats)) * i / 24
            lon = min(lons) + (max(lons) - min(lons)) * j / 24
            if not inside(lat, lon, ring):
                continue
            d = min(math.hypot(lat - y, (lon - x) * k) for y, x in ring)
            if d > far:
                best, far = (lat, lon), d
    return [round(best[0], 4), round(best[1], 4)]


def airspace(arg):
    data = npm_data(arg, "airspace-data", "0.9.1", "airspace.geojson.gz")
    by_icao = {r["icao"]: r for r in rows(DATA / "airports.csv")}
    airline = {by_icao[r["icao"]]["iata"] for r in rows(DATA / "airline_airports.csv") if r["icao"] in by_icao}
    areas = []
    for f in data["features"]:
        p, g = f["properties"], f["geometry"]
        cls = {"CLASS_B": "B", "CLASS_C": "C", "CLASS_D": "D"}.get(p["type"])
        if not cls or (cls == "D" and p.get("identifier") not in airline):
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            rings = [simplify([[round(lat, 5), round(lon, 5)] for lon, lat in ring[:-1]], 0.001) for ring in poly]
            rings = [[[round(lat, 4), round(lon, 4)] for lat, lon in r] for r in rings if len(r) >= 3]
            if not rings:
                continue
            floor = 0 if p["floor"]["reference"] == "SFC" else p["floor"]["valueFt"]
            areas.append({"id": p.get("identifier"), "class": cls, "floor": floor, "ceiling": p["ceiling"]["valueFt"],
                          "label": label_point(rings[0]), "rings": rings})
    areas.sort(key=lambda a: (a["id"] or "", a["class"], a["floor"]))
    out = DATA / "airspace.json"
    out.write_text(json.dumps({
        "about": ["Class B and C airspace, and Class D at airports with airline service, from the FAA's NASR "
                  f"data (cycle {data['properties']['nasrCycleDate']}, public domain) as packaged by the "
                  "@squawk/airspace-data npm package (MIT). Outlines simplified to about 100 m.",
                  "floor and ceiling in feet (floor 0: the surface); label: a point inside for the altitudes.",
                  "Rebuild with: python3 tools/build_data.py airspace"],
        "areas": areas}, separators=(",", ":")) + "\n")
    print(f"{len(areas)} areas -> {out} ({out.stat().st_size // 1024} KB)")


def navaids(arg):
    data = npm_data(arg, "navaid-data", "0.8.2", "navaids.json.gz")
    out = sorted([r["identifier"], r["name"], r["type"], f"{r['lat']:.5f}", f"{r['lon']:.5f}"]
                 for r in data["records"] if r["type"] in ("VOR", "VOR/DME", "VORTAC", "TACAN"))
    write("navaids.csv", ["ident", "name", "type", "lat", "lon"],
          [f"VOR and TACAN stations from the FAA's NASR data (cycle {data['meta']['nasrCycleDate']}, public domain),",
           "as packaged by the @squawk/navaid-data npm package (MIT). Drawn on the ATC-style radar.",
           "Rebuild with: python3 tools/build_data.py navaids"], out)


# A hospital's heliport, by its name. The FAA abbreviates freely: "MED CTR", "RGNL", "HOSP", "HLTH".
HOSPITAL = re.compile(r"\b(HOSP|HOSPITALS?|MEDICAL|MED|MEDCTR|HEALTH|HEALTHCARE|HLTH|CLINIC|TRAUMA|CHILDREN'?S|"
                      r"INFIRMARY|EMERG|EMERGENCY|ER|SANITARIUM|CANCER|REHAB|MERCY|UPMC|AVERA|KAISER|SINAI|MAYO)\b")
# the FAA's abbreviations, spelled out; and words that are the heliport's, not the hospital's name
SPELL = {"HOSP": "Hospital", "MED": "Medical", "CTR": "Center", "CNTR": "Center", "MEDCTR": "Medical Center",
         "MEML": "Memorial", "MEM": "Memorial", "RGNL": "Regional", "REGL": "Regional", "REG": "Regional",
         "HLTH": "Health", "UNIV": "University", "CNTY": "County", "CO": "County", "ST": "St.", "MT": "Mount",
         "FT": "Fort", "SCH": "School", "HTS": "Heights", "N": "North", "S": "South", "E": "East", "W": "West"}
DROP = {"HELIPORT", "HELIPAD", "HELISTOP", "HELIPORTS", "EMERG", "EMERGENCY", "ROOFTOP", "ROOF", "PAD", "HELI"}
KEEP_CAPS = {"UF", "UC", "UCLA", "UCSF", "UCSD", "UCI", "USC", "VA", "UAB", "UNC", "UVA", "OHSU", "LSU", "MUSC", "NYU",
             "SSM", "HCA", "CHI", "ER", "UPMC", "UT", "UW", "UNM", "OU", "II", "III", "IV", "US", "SW", "NW", "NE", "SE"}
SMALL = {"OF", "AND", "THE", "AT", "IN", "FOR", "ON"}
TRAILING = ("Regional Medical Center", "Medical Center", "Hospital", "Health Center", "Health System", "Healthcare")


def tidy_name(raw):
    """'ST VINCENT HOSPITAL & MEDICAL CENTER' -> 'St. Vincent Hospital & Medical Center'."""
    words = []
    for w in raw.replace(",", " ").replace("-", " - ").split():
        if w in DROP or (w.startswith("#") and w[1:].isdigit()):
            continue
        if w in SPELL and not (w in ("N", "S", "E", "W", "CO") and not words):
            words.append(SPELL[w])
        elif w in KEEP_CAPS:
            words.append(w)
        elif w in SMALL and words and words[-1] != "-":
            words.append(w.lower())
        elif w.startswith("MC") and len(w) > 3:
            words.append("Mc" + w[2:].capitalize())
        else:
            cap = lambda part: "'".join(p.capitalize() if i == 0 else p.lower() for i, p in enumerate(part.split("'")))
            words.append("/".join(cap(part) for part in w.split("/")))
    name = " ".join(words).replace(" - ", "-").strip(" -")
    return " ".join(name.split())


def short_name(name):
    """The radar's label: 'Emanuel Hospital' -> 'Emanuel', 'Oregon Health Sciences University' -> 'OHSU'."""
    s = name
    for t in TRAILING:
        if s.endswith(" " + t) and len(s) > len(t) + 3:
            s = s[: -len(t) - 1]
            break
    words = s.split()
    if len(words) >= 3 and words[-1] == "University":     # a university's hospital goes by its initials, as OHSU does
        return "".join(w[0] for w in words if w not in ("of", "and", "the", "&") and w[0].isalnum()).upper()
    return s


def helipads(arg):
    data = npm_data(arg, "airport-data", "0.9.2", "airports.json.gz")
    out = []
    for r in data["records"]:
        if r["facilityType"] != "HELIPORT" or r.get("status") != "OPEN" or not HOSPITAL.search(r["name"]):
            continue
        name = tidy_name(r["name"])
        out.append([r["faaId"], name, short_name(name), tidy_name(r.get("city") or ""), r.get("state") or "",
                    f"{r['lat']:.5f}", f"{r['lon']:.5f}", round(r["elevationFt"]) if r.get("elevationFt") is not None else ""])
    out.sort()
    write("helipads.csv", ["code", "name", "short", "city", "state", "lat", "lon", "elevation_ft"],
          [f"Hospital helipads: the open heliports in the FAA's NASR data (cycle {data['meta']['nasrCycleDate']}, public",
           "domain) whose names say they serve a hospital, as packaged by the @squawk/airport-data npm package (MIT).",
           "Names are the FAA's, tidied; short is the radar's label. CloudWall says which one a medical helicopter is",
           "heading for, landing at or has left, and draws them on the radar. Add or rename lines for your own area.",
           "Rebuild with: python3 tools/build_data.py helipads"], out)


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


NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
NE_FILES = {"country": "ne_50m_admin_0_boundary_lines_land", "state": "ne_50m_admin_1_states_provinces_lines",
            "cities": "ne_50m_populated_places_simple"}


def borders(arg):
    def load(key):
        name = NE_FILES[key]
        return json.loads(source(str(Path(arg) / f"{name}.geojson") if arg else None, NE.format(name)))

    def lines(data):
        out = []
        for f in data["features"]:
            g = f["geometry"]
            for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
                pts = simplify([[lat, lon] for lon, lat in line], 0.02)
                if len(pts) >= 2:
                    out.append([v for lat, lon in pts for v in (round(lat, 2), round(lon, 2))])
        return out

    cities = []
    for f in load("cities")["features"]:
        p = f["properties"]
        capital = p["featurecla"].startswith("Admin-0 capital")
        lon, lat = f["geometry"]["coordinates"]
        cities.append([" ".join((p["name"] or p["nameascii"]).split()), p["iso_a2"], round(lat, 3), round(lon, 3),
                       max(1, round(p["pop_max"] / 1000)), 1 if capital else 0])
    cities.sort(key=lambda c: -c[4])
    out = Path(__file__).resolve().parent.parent / "cloudwall" / "web" / "maps" / "world.json"
    data = {"about": ["Country borders on land, state and province lines and the larger cities, from Natural Earth",
                      "(naturalearthdata.com, public domain), 1:50m, lines simplified to about 2 km.",
                      "Lines: [lat, lon, lat, lon, ...]. Cities: [name, country, lat, lon, population in thousands,",
                      "national capital 1 or 0], largest first. Rebuild with: python3 tools/build_data.py borders"],
            "country": lines(load("country")), "state": lines(load("state")), "cities": cities}
    out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"{len(data['country'])} border lines, {len(data['state'])} state lines, {len(cities)} cities -> {out} "
          f"({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    jobs = {"borders": borders, "runways": runways, "airline": airline, "zips": zips, "cwt": cwt, "airspace": airspace, "navaids": navaids,
            "helipads": helipads}
    if len(sys.argv) < 2 or sys.argv[1] not in jobs:
        raise SystemExit(__doc__)
    jobs[sys.argv[1]](sys.argv[2] if len(sys.argv) > 2 else None)
