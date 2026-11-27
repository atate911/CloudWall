"""Each place to watch, worked out from the settings and CloudWall's tables.

CloudWall can watch several places: [home] with [airport] is the first, and each [[places]]
entry adds one. A place needs only a name, a position and its airport's ICAO code; the rest
of the airport (name, city, position, elevation, runways, the small fields nearby) comes from
the bundled tables unless the config gives it. (Reading and checking the settings themselves is
config.py's.)
"""
import copy
import logging
import re

from . import airports, geo

log = logging.getLogger("cloudwall")
# CloudWall can watch several places: [home] with [airport] is the first, and each [[places]]
# entry adds one. A place needs only a name, a position and its airport's ICAO code; the rest
# of the airport (name, city, position, elevation, runways, the small fields nearby) comes from
# the bundled tables unless the config gives it.

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-") or "place"


def _zip(z):
    """A ZIP code as a string, whether the config wrote it as text or as a number (02134 -> 2134)."""
    return str(z).strip().zfill(5) if isinstance(z, int) else str(z).strip()


def locate_home(h, what="[home]"):
    """A home with lat and lon, from the ones given or from its ZIP code."""
    h = dict(h)
    if h.get("lat") is not None and h.get("lon") is not None:
        h["lat"], h["lon"] = float(h["lat"]), float(h["lon"])
    elif h.get("zip"):
        h["zip"] = _zip(h["zip"])
        p = airports.zip_point(h["zip"])
        if not p:
            raise ValueError(f"{what}: {h['zip']} isn't a US ZIP code CloudWall knows: give lat and lon instead")
        h["lat"], h["lon"] = p
    else:
        raise ValueError(f"{what} needs lat and lon, or zip")
    return h


def complete_airport(ap, home, radius_nm):
    """An airport filled in from its ICAO (or IATA) code, keeping whatever the config gives. With no
    code, or "auto", it's the one airports.pick_airport chooses for home."""
    ap = dict(ap)
    if str(ap.get("icao") or "auto").lower() == "auto" and not ap.get("iata"):
        ap["icao"] = airports.pick_airport(home["lat"], home["lon"])
        if not ap["icao"]:
            raise ValueError(f"no airport with airline service near {home['lat']:.3f}, {home['lon']:.3f}: give its ICAO code")
    rec = airports.lookup(ap.get("icao")) or airports.lookup(ap.get("iata"))
    if rec and ap.get("lat") is not None and ap.get("lon") is not None:
        off = geo.haversine_nm(float(ap["lat"]), float(ap["lon"]), rec["lat"], rec["lon"])
        if off > 10:      # e.g. a new icao left with another airport's position
            log.warning("[airport] %s: the config's lat/lon are %.0f nm from %s; the position from the config is used",
                        rec["icao"], off, rec["name"])
    if rec:
        for k in ("icao", "iata", "city", "name", "lat", "lon"):
            if ap.get(k) in (None, ""):
                ap[k] = rec[k]
    if ap.get("lat") is None or ap.get("lon") is None:
        raise ValueError(f"airport {ap.get('icao') or '(no code)'} isn't in CloudWall's table: "
                         "give its lat and lon (and iata and city) in the config")
    ap["icao"] = str(ap.get("icao") or "").upper()
    if not ap.get("iata"):      # no IATA code (Pearson Field): its local code (VUO), else its ICAO code
        ap["iata"] = (rec or {}).get("code") or ap["icao"]
    ap.setdefault("city", ap.get("name") or ap["iata"])
    if ap.get("elevation_ft") is None:
        ap["elevation_ft"] = airports.elevation_ft(ap["icao"]) or 0
    if "others" not in ap:      # small fields nearby, whose light aircraft are theirs, not this airport's
        ap["others"] = airports.nearby(home["lat"], home["lon"], radius_nm, exclude=[ap["icao"], ap["iata"]])[:6]
    for f in ap["others"]:
        if f.get("elevation_ft") is None:
            f["elevation_ft"] = airports.elevation_ft(f.get("icao") or f.get("code")) or home.get("elevation_ft") or 0
        if "runways" not in f:      # drawn inside the field's symbol on the radar
            f["runways"] = airports.runways((airports.lookup(f.get("icao") or f.get("code")) or {}).get("icao"))
    if "runways" not in ap:
        ap["runways"] = airports.runways(ap["icao"])
    # the ATC radar's video map: Class B and C airspace (and the airport's own Class D) and VORs
    if "airspace" not in ap:
        ap["airspace"] = airports.airspace_near(home["lat"], home["lon"], own=ap["iata"])
    if "navaids" not in ap:
        ap["navaids"] = airports.navaids_near(home["lat"], home["lon"])
    # hospital helipads: where medical helicopters are going, out past the radar's longest range
    if "helipads" not in ap:
        ap["helipads"] = airports.helipads_near(home["lat"], home["lon"], max(30, radius_nm + 15))
    return ap


def complete_place(cfg):
    """A config with its home located and its airport filled in, ready for a tracker."""
    c = dict(cfg)
    c["home"] = locate_home(cfg["home"])
    c["airport"] = complete_airport(cfg["airport"], c["home"], cfg["tracking"]["radius_nm"])
    if c["home"].get("elevation_ft") is None:         # not given: near enough the airport's
        c["home"]["elevation_ft"] = c["airport"]["elevation_ft"]
    return c


def entry(p, what):
    """A place as [[places]] (or the desktop's location setting) gives it: name, lat and lon or
    zip, and optionally airport (an ICAO code, "auto" or a table), elevation_ft and others.
    Returns its home and airport."""
    home = locate_home({"name": p.get("name"), "lat": p.get("lat"), "lon": p.get("lon"), "zip": p.get("zip"),
                        "elevation_ft": p.get("elevation_ft")}, what)
    if not home["name"]:
        home["name"] = f"ZIP {home['zip']}" if home.get("zip") else f"{home['lat']:.3f}, {home['lon']:.3f}"
    a = p.get("airport") or "auto"
    ap = dict(a) if isinstance(a, dict) else {"icao": str(a)}
    if "others" in p:
        ap["others"] = p["others"]
    return home, ap


def place_config(cfg, pid, home, airport):
    """One place's full config: the shared settings with its own home and airport."""
    c = copy.deepcopy({k: v for k, v in cfg.items() if k != "places"})
    c["home"], c["airport"] = dict(home), dict(airport)
    c = complete_place(c)
    c["place"] = {"id": pid, "name": home["name"]}
    return c


def unique_id(name, taken, unusable=None):
    """An id for a place from its name ("Cabin" -> "cabin"), numbered on ("cabin-2") past those
    taken and any that unusable(id) rules out."""
    pid = base = _slug(name)
    n = 2
    while pid in taken or (unusable and unusable(pid)):
        pid, n = f"{base}-{n}", n + 1
    return pid


def places(cfg):
    """Every place to watch, first to last, each a full config of its own: the shared settings
    with this place's [home] and [airport], and place = {id, name}."""
    entries = [(dict(cfg["home"], name=cfg["home"].get("name") or "Home"), cfg["airport"])]
    for i, p in enumerate(cfg.get("places") or []):
        entries.append(entry(p, f"[[places]] entry {i + 1} ({p.get('name') or 'no name'})"))
    out, ids = [], set()
    for home, airport in entries:
        pid = unique_id(home["name"], ids)
        ids.add(pid)
        out.append(place_config(cfg, pid, home, airport))
    return out


def kiosk_place(cfg, places_):
    """The place the kiosk shows: [kiosk] place, by name or id, or the first."""
    want = str(cfg.get("kiosk", {}).get("place") or "").strip().lower()
    return next((p["place"]["id"] for p in places_ if want in (p["place"]["id"], p["place"]["name"].lower())),
                places_[0]["place"]["id"])
