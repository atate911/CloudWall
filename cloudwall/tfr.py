"""Temporary flight restrictions near home, from the FAA's public TFR service.

Shapes come from the FAA's map service (one request for the whole country); each nearby
restriction's details (name, times, altitudes, full notice) from its XML record, fetched
once and kept until the FAA changes it.
"""
import logging
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .http import get_json, get_text

log = logging.getLogger(__name__)

SHAPES = ("https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature"
          "&typeName=TFR:V_TFR_LOC&maxFeatures=500&outputFormat=application/json&srsname=EPSG:4326")
DETAIL = "https://tfr.faa.gov/download/detail_{id}.xml"

# The regulation a restriction is issued under says what kind it is.
KINDS = {
    "91.137": "Disaster or hazard area (often a wildfire)",
    "91.138": "Disaster area",
    "91.139": "Emergency air traffic rules",
    "91.141": "VIP movement (usually the President or Vice President)",
    "91.143": "Space launch or recovery",
    "91.144": "Abnormally high air pressure",
    "91.145": "Air show or major sporting event",
    "99.7": "Security",
    # 49 U.S.C. 44812 (2024): drones kept away from a large public gathering; other aircraft are not affected
    "44812": "Drones kept clear of a public event",
}
DRONES_ONLY = {"44812"}
REFS = {"HEI": "above ground", "ALT": "", "STD": ""}


def _xy(home, lat, lon):
    """nm east and north of home (flat-earth, fine within a few dozen miles)."""
    return ((lon - home["lon"]) * 60 * math.cos(math.radians(home["lat"])), (lat - home["lat"]) * 60)


def _dist_to_ring(home, ring):
    """Distance in nm from home to a polygon ring; 0 if home is inside it."""
    pts = [_xy(home, lat, lon) for lon, lat in ring]
    inside, best = False, float("inf")
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > 0) != (y2 > 0) and 0 < (x2 - x1) * (0 - y1) / (y2 - y1) + x1:
            inside = not inside
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
        best = min(best, math.hypot(x1 + t * dx, y1 + t * dy))
    return 0.0 if inside else best


def _rings(geom):
    kind = (geom or {}).get("type")
    if kind == "Polygon":
        return [geom["coordinates"][0]]
    if kind == "MultiPolygon":
        return [p[0] for p in geom["coordinates"]]
    return []


def _rule(code):
    """'91.137(a)(1)' -> '91.137': the regulation without its paragraph, which is what says the kind."""
    m = re.match(r"\d+(\.\d+)?", code or "")
    return m.group(0) if m else code


# What the FAA puts before a restriction's name: its date ("261121 "), or a reference of the
# office that asked for it ("2026-44812-CSA-0138 ", "26-#127-ESA-").
NAME_PREFIX = re.compile(r"^(\d{6}(-\d{6})?\s+|\d{4}-\d{5}-[A-Z]{2,4}-\d{2,5}\s+|\d{2}-#\d+-[A-Z]{2,4}-)")


def title_place(title):
    """'Key West, FL, Tuesday, May 6, 2025 Local' -> 'Key West, FL': where a restriction is, from
    its title in the FAA's list, for the many whose record gives no name."""
    return re.split(r",\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b", title or "")[0].strip()


def _thin(ring, n=72):
    step = max(1, len(ring) // n)
    return [[round(lat, 5), round(lon, 5)] for lon, lat in ring[::step]]


def _when(text):
    if not text:
        return None
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def _alt(ref, val, uom):
    try:
        v = int(float(val))
    except (TypeError, ValueError):
        return None
    if ref == "STD" or uom == "FL":
        return {"ft": v * 100, "text": f"FL{v:03d}"}
    if v == 0 and ref == "HEI":
        return {"ft": 0, "text": "the surface"}
    return {"ft": v, "text": f"{v:,} ft" + (f" {REFS[ref]}" if REFS.get(ref) else "")}


def parse_detail(xml):
    """The parts of an FAA TFR XML record worth showing."""
    root = ET.fromstring(xml)
    t = lambda path: (root.findtext(path) or "").strip() or None
    lows, highs = [], []
    for area in root.iter("aseTFRArea"):
        lo = _alt(area.findtext("codeDistVerLower"), area.findtext("valDistVerLower"), area.findtext("uomDistVerLower"))
        hi = _alt(area.findtext("codeDistVerUpper"), area.findtext("valDistVerUpper"), area.findtext("uomDistVerUpper"))
        if lo: lows.append(lo)
        if hi: highs.append(hi)
    name = t(".//NotUid/txtLocalName") or ""
    # "261121 Grand Illumination Parade Norfolk, VA DHS - UAS Only" -> drop the date prefix
    name = NAME_PREFIX.sub("", name)
    code = t(".//TfrNot/codeType")
    return {
        "name": name,
        "kind": KINDS.get(_rule(code), "Flight restriction"),
        "code": code,
        "drones_only": "UAS ONLY" in name.upper() or "UAS-ONLY" in name.upper() or _rule(code) in DRONES_ONLY,
        "start": _when(t(".//dateEffective")),
        "end": _when(t(".//dateExpire")),
        "floor": min(lows, key=lambda a: a["ft"]) if lows else None,
        "ceiling": max(highs, key=lambda a: a["ft"]) if highs else None,
        "text": t(".//txtDescrUSNS"),
    }


class TFRs:
    def __init__(self, home, radius_nm=30, fetch_json=get_json, fetch_text=get_text):
        self.home, self.radius = home, radius_nm
        self.fetch_json, self.fetch_text = fetch_json, fetch_text
        self.details = {}          # NOTAM key -> (last modified, parsed detail)

    def refresh(self, now=None):
        now = now or time.time()
        data = self.fetch_json(SHAPES, timeout=30) or {}
        found = {}
        for f in data.get("features") or []:
            p = f.get("properties") or {}
            key = p.get("NOTAM_KEY") or ""
            rings = _rings(f.get("geometry") or {})
            if not key or not rings:
                continue
            d = min(_dist_to_ring(self.home, r) for r in rings)
            if d > self.radius:
                continue
            nid = key.split("-")[0]                      # "6/8034-1-FDC-F" -> "6/8034"
            t = found.setdefault(nid, {"id": nid, "dist_nm": d, "shapes": [], "title": p.get("TITLE"),
                                       "modified": p.get("LAST_MODIFICATION_DATETIME")})
            t["dist_nm"] = round(min(t["dist_nm"], d), 1)
            t["shapes"] += [_thin(r) for r in rings]
        out = []
        for nid, t in found.items():
            cached = self.details.get(nid)
            if not cached or cached[0] != t["modified"]:
                try:
                    cached = self.details[nid] = (t["modified"], parse_detail(
                        self.fetch_text(DETAIL.format(id=nid.replace("/", "_")), timeout=20)))
                except Exception as e:                       # shapes alone are still worth showing
                    log.warning("TFR %s details failed: %s", nid, e)
                    cached = (None, {"name": title_place(t["title"]) or t["title"], "kind": "Flight restriction"})
            t.update(cached[1])
            if not t.get("name") or t["name"] == nid:      # many records are named only by their number
                t["name"] = title_place(t["title"]) or t.get("name")
            if t.get("end") and t["end"] < now:
                continue
            t["active"] = not t.get("start") or t["start"] <= now
            out.append(t)
        out.sort(key=lambda t: (not t["active"], t["dist_nm"]))
        return out


def demo(home):
    """A made-up restriction a few miles from home, for demo mode."""
    lat, lon, r = home["lat"] + 0.06, home["lon"] - 0.12, 3 / 60
    ring = [[round(lat + r * math.cos(a), 5), round(lon + r * math.sin(a) / math.cos(math.radians(lat)), 5)]
            for a in (i * math.pi / 18 for i in range(36))]
    now = time.time()
    return [{"id": "6/0001", "dist_nm": 5.2, "shapes": [ring], "name": "Stadium event, Portland (demo)",
             "kind": KINDS["99.7"], "code": "99.7", "drones_only": False, "active": True,
             "start": now - 3600, "end": now + 3 * 3600,
             "floor": {"ft": 0, "text": "the surface"}, "ceiling": {"ft": 3000, "text": "3,000 ft above ground"},
             "text": "DEMO. NO AIRCRAFT OPERATIONS WITHIN 3NM UP TO AND INCLUDING 3000FT AGL."}]
