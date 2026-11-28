"""Aircraft types by ICAO designator, from data/types.csv (shape, length, rare, radar icon) and
data/cwt.csv (the FAA's wake categories, A super to I small; see tools/build_data.py). The
display keeps no table of its own: each record carries these.
"""
import csv
import re
import threading

from ..core import paths

_DATA = paths.DATA
_types = None
_cwt = None
_lock = threading.Lock()

# (shape, length in m) fallbacks for a type not in the table: by ADS-B emitter category,
BY_CATEGORY = {"A1": ("piston", 8), "A2": ("bizjet", 16), "A3": ("narrow", 38), "A4": ("narrow", 47),
               "A5": ("wide", 62), "A6": ("fighter", 19), "A7": ("heli", 12)}
# then by wake category,
BY_WAKE = {"A": ("wide", 70), "B": ("wide", 64), "C": ("wide", 55), "D": ("wide", 50), "E": ("narrow", 47),
           "F": ("narrow", 38), "G": ("regional", 28), "H": ("bizjet", 16), "I": ("piston", 9)}
ANY = ("narrow", 36)        # then a single-aisle airliner


def _rows(name):
    with open(_DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def _table():
    global _types
    with _lock:
        if _types is None:
            _types = {r["type"]: r for r in _rows("types.csv")}
    return _types


def _category(type_code, category):
    """The emitter category, as far as it is believable: A6 ("high performance") is set by mistake
    in some small aircraft's transponders, so it counts only for a type the wake table lacks."""
    if category == "A6" and type_code and wake(type_code):
        return None
    return category


def shape(type_code, category=None):
    """{"shape", "length" (m), "known"} for a type: from the table, else (known False) from the
    transponder's category, else its wake category, else a single-aisle airliner's."""
    category = _category(type_code, category)
    t = _table().get(str(type_code or "").upper())
    if t and t["shape"] and t["length_m"]:
        return {"shape": t["shape"], "length": float(t["length_m"]), "known": True}
    kind, length = BY_CATEGORY.get(category) or BY_WAKE.get(wake(type_code)) or ANY
    return {"shape": kind, "length": length, "known": False}


def rare(type_code):
    return bool((_table().get(str(type_code or "").upper()) or {}).get("rare"))


def wake(type_code):
    """The type's wake category, A to I, or None."""
    global _cwt
    with _lock:
        if _cwt is None:
            _cwt = {r["type"]: r["cwt"] for r in _rows("cwt.csv")}
    return _cwt.get(str(type_code or "").upper())


# the radar's icon (drawn by icons.js). Order matters: a hang glider is an ultralight, not a glider
ICON_WORDS = [(kind, re.compile(words, re.I)) for kind, words in (
    ("balloon", r"balloon|\bcameron\b|lindstrand|ultramagic|kubicek|thunder (and|&) colt"),
    ("airship", r"airship|blimp|zeppelin"),
    ("ultralight", r"ultra-?light|microlight|\btrike\b|paramotor|powered parachute|paraglider|hang ?glider|weight.shift"),
    ("glider", r"glider|sailplane|schleicher|schempp|\bstemme\b|jonker"),
    ("gyro", r"gyro(plane|copter)?\b|autogiro|autogyro|\bcalidus\b|\bcavalon\b|\bmagni\b"),
    ("tiltrotor", r"osprey|tilt.?rotor|\baw ?609\b|bell 609"),
    ("tandem", r"chinook|sea knight|\bch-4[67]|vertol|tandem"),
    ("drone", r"unmanned|\bua[sv]\b|drone|reaper|predator|global hawk|triton|scaneagle"),
    ("seaplane", r"seaplane|float ?plane|\bfloats\b|amphib|flying boat|catalina|canadair cl-?[24]15|\bicon a5\b|water ?bomber"),
)]
HELI_WORDS = re.compile(r"helicopter|copter|robinson|sikorsky|agusta|enstrom|schweizer|guimbal|kaman|\bbell [245]\d\d"
                        r"|\baw ?1\d\d\b|\b[acmhu]h-\d", re.I)
ICON_OF_SHAPE = {"piston": "light", "turboprop": "turboprop", "bizjet": "bizjet", "regional": "regional",
                 "narrow": "airliner", "wide": "heavy", "quad": "quad", "heli": "heli", "fighter": "fighter"}
# B3 (parachutists) and B7 (space vehicles) are left plain
ICON_OF_CATEGORY = {"A1": "light", "A2": "bizjet", "A3": "airliner", "A4": "airliner", "A5": "heavy", "A6": "fighter",
                    "A7": "heli", "B1": "glider", "B2": "balloon", "B4": "ultralight", "B6": "drone"}
ICON_OF_WAKE = {"A": "heavy", "B": "heavy", "C": "heavy", "D": "heavy", "E": "airliner", "F": "airliner",
                "G": "airliner", "H": "bizjet", "I": "light"}


def icon(type_code, desc=None, category=None):
    """The radar's icon, or None. In turn: the table's icon for the type; its description's words
    (a floatplane shares its type with one on wheels, so only the description says seaplane);
    its type's shape; a helicopter by description; its emitter category; its wake category."""
    code, desc = str(type_code or "").upper(), desc or ""
    t = _table().get(code) or {}
    if t.get("icon"):
        return t["icon"]
    for kind, words in ICON_WORDS:
        if desc and words.search(desc):
            return kind
    if t.get("shape"):
        return ICON_OF_SHAPE.get(t["shape"])
    if HELI_WORDS.search(desc):
        return "heli"
    return ICON_OF_CATEGORY.get(_category(code, category)) or ICON_OF_WAKE.get(wake(code))
