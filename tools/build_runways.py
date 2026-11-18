"""Build cloudwall/data/runways.csv from OurAirports' runway list (public domain).

    python3 tools/build_runways.py              # downloads runways.csv from OurAirports
    python3 tools/build_runways.py runways.csv  # or uses a copy you already have

Keeps the open runways of the airports in cloudwall/data/airports.csv that have both ends
surveyed, leaving out helipads and water lanes, with positions to about a metre and the
elevation of the first end (CloudWall takes it as the field's).
"""
import csv
import io
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://davidmegginson.github.io/ourairports-data/runways.csv"
DATA = Path(__file__).resolve().parent.parent / "cloudwall" / "data"


def main():
    if len(sys.argv) > 1:
        text = Path(sys.argv[1]).read_text(encoding="utf-8")
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as r:
            text = r.read().decode("utf-8")
    with open(DATA / "airports.csv", newline="", encoding="utf-8") as f:
        wanted = {row["icao"] for row in csv.DictReader(f)}
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
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
        rows.append([r["airport_ident"], r["le_ident"], r["he_ident"], length, *ends, int(float(elev)) if elev else ""])
    rows.sort()
    out = DATA / "runways.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        f.write("# Runways of the airports in airports.csv, from OurAirports (ourairports.com, public domain).\n"
                "# Open runways with both ends surveyed; helipads and water lanes left out.\n"
                "# Rebuild with: python3 tools/build_runways.py\n")
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["icao", "le", "he", "length_ft", "le_lat", "le_lon", "he_lat", "he_lon", "elev_ft"])
        w.writerows(rows)
    print(f"{len(rows)} runways at {len({r[0] for r in rows})} airports -> {out}")


if __name__ == "__main__":
    main()
