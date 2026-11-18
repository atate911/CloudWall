"""Build CloudWall's bundled tables from their public sources.

    python3 tools/build_data.py runways [runways.csv]      # OurAirports runways (public domain)
    python3 tools/build_data.py airline [airports.csv]     # OurAirports airports with airline service
    python3 tools/build_data.py zips [Gaz_zcta_national]   # Census ZIP code areas (public domain)
    python3 tools/build_data.py cwt aircraft.json          # wake categories, from openScope's aircraft data
    python3 tools/build_data.py airspace [package.tgz]     # Class B, C and D airspace (FAA NASR, public domain)
    python3 tools/build_data.py navaids [package.tgz]      # VOR and TACAN stations (FAA NASR, public domain)

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
"""
import csv
import gzip
import io
import json
import math
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
    jobs = {"runways": runways, "airline": airline, "zips": zips, "cwt": cwt, "airspace": airspace, "navaids": navaids}
    if len(sys.argv) < 2 or sys.argv[1] not in jobs:
        raise SystemExit(__doc__)
    jobs[sys.argv[1]](sys.argv[2] if len(sys.argv) > 2 else None)
