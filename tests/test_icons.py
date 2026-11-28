"""The chart-style radar's aircraft icons: which kind each aircraft gets (the server's choice, sent
on each record), and that the icons are sound drawings (checked under Node; skipped without it)."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from cloudwall.reference import aircraft

WEB = Path(__file__).resolve().parent.parent / "cloudwall" / "web" / "js"

SCRIPT = r"""
const dir = process.argv[1];
const { ICONS } = await import(dir + "/icons.js");
// each part of an icon: its signed area (positive: clockwise on screen, y running down)
const areas = (d) => d.split("Z").filter((s) => s.trim()).map((s) => {
  const p = s.replace(/^M/, "").split("L").map((q) => q.split(",").map(Number));
  return p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x * y2 - x2 * y); }, 0) / 2;
});
console.log(JSON.stringify({
  kinds: Object.keys(ICONS),
  icons: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, { d: v.d, nose: v.nose, r: v.r, upright: v.upright, areas: k === "plain" ? [] : areas(v.d) }])),
}));
"""

# (aircraft, the icon it should get)
CASES = [
    ({"type": "C172"}, "light"), ({"type": "B350"}, "turboprop"), ({"type": "DH8D"}, "turboprop"),
    ({"type": "C56X"}, "bizjet"), ({"type": "CRJ9"}, "regional"), ({"type": "B738"}, "airliner"),
    ({"type": "E75L"}, "airliner"), ({"type": "B77W"}, "heavy"), ({"type": "MD11"}, "heavy"),
    ({"type": "B744"}, "quad"), ({"type": "F15"}, "fighter"), ({"type": "EC35"}, "heli"),
    # helicopters the table doesn't have, by their type or their description
    ({"type": "A109"}, "heli"), ({"type": "B429"}, "heli"), ({"type": "ZZZZ", "desc": "Airbus Helicopters H125"}, "heli"),
    ({"type": "ZZZZ", "desc": "Bell 407GXi"}, "heli"), ({"type": "ZZZZ", "desc": "Bell UH-1Y Venom"}, "heli"),
    # descriptions that aren't helicopters
    ({"type": "ZZZZ", "desc": "Boeing MD-11"}, None), ({"type": "ZZZZ", "desc": "Lockheed C-130H Hercules"}, None),
    ({"type": "ZZZZ", "desc": "Learjet 45"}, None),
    # what the transponder says, then the wake category
    ({"type": "ZZZZ", "category": "A1"}, "light"), ({"type": "ZZZZ", "category": "A3"}, "airliner"),
    ({"type": "ZZZZ", "category": "A5"}, "heavy"), ({"type": "ZZZZ", "category": "A7"}, "heli"),
    ({"type": "ZZZZ", "category": "A6"}, "fighter"), ({"type": "C5"}, "heavy"),
    # A6, "high performance", set by mistake in a small aircraft's transponder: its type wins
    ({"type": "BE99", "category": "A6"}, "turboprop"), ({"type": "SW3", "category": "A6"}, "bizjet"),                   # (types the table of
    ({"type": "AA5"}, "light"), ({"type": "B738", "category": "A7"}, "airliner"),   # wake categories alone has); the type wins
    ({}, None),                                                                                     # nothing to go on
    # the other kinds of traffic: by ICAO's catch-all codes and other types, descriptions and categories
    ({"type": "BALL"}, "balloon"), ({"type": "ZZZZ", "category": "B2"}, "balloon"),
    ({"type": "ZZZZ", "desc": "Cameron Balloons Z-105"}, "balloon"), ({"type": "ZZZZ", "desc": "Goodyear Zeppelin NT"}, "airship"),
    ({"type": "GLID"}, "glider"), ({"type": "AS21", "category": "B1"}, "glider"),
    ({"type": "ZZZZ", "desc": "Wills Wing hang glider"}, "ultralight"), ({"type": "ZZZZ", "category": "B4"}, "ultralight"),
    ({"type": "GYRO"}, "gyro"), ({"type": "ZZZZ", "desc": "AutoGyro Calidus"}, "gyro"),
    ({"type": "H47", "category": "A7"}, "tandem"), ({"type": "H46"}, "tandem"),
    ({"type": "V22"}, "tiltrotor"), ({"type": "ZZZZ", "desc": "Leonardo AW609"}, "tiltrotor"),
    ({"type": "Q9"}, "drone"), ({"type": "ZZZZ", "category": "B6"}, "drone"),
    ({"type": "CL2T"}, "seaplane"), ({"type": "C208", "desc": "Cessna 208 Caravan Amphibian"}, "seaplane"),
    ({"type": "DHC2", "desc": "de Havilland Canada DHC-2 Beaver"}, None),          # on wheels or floats: can't tell
    ({"type": "BE58"}, "twin"), ({"type": "PA34"}, "twin"), ({"type": "ZZZZ", "category": "B3"}, None),
    ({"type": "ZZZZ", "desc": "Bombardier Global 7500"}, None), ({"type": "ZZZZ", "desc": "Piper PA-46 Malibu Mirage"}, None),
]


@unittest.skipUnless(shutil.which("node"), "needs Node to run the browser modules")
class IconTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", SCRIPT, str(WEB)],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_every_type_in_the_table_has_an_icon(self):
        # every type the server's table gives a shape or an icon of its own gets one the radar can draw
        table = aircraft._table()
        missing = [t for t, row in table.items() if (row["shape"] or row["icon"]) and aircraft.icon(t) not in self.r["kinds"]]
        self.assertEqual(missing, [])
        self.assertGreater(sum(1 for row in table.values() if row["shape"] or row["icon"]), 200)

    def test_icons_are_sized_by_kind(self):
        reach = {k: v["r"] for k, v in self.r["icons"].items()}
        self.assertLess(reach["light"], reach["airliner"])
        self.assertLess(reach["bizjet"], reach["regional"])
        self.assertLess(reach["airliner"], reach["heavy"])
        self.assertLessEqual(reach["heavy"], reach["quad"])
        self.assertLess(reach["drone"], reach["light"])
        self.assertLess(reach["twin"], reach["turboprop"])
        self.assertTrue(self.r["icons"]["balloon"]["upright"])                    # drawn from the side, always upright
        self.assertFalse(any(v["upright"] for k, v in self.r["icons"].items() if k != "balloon"))

    def test_every_part_is_wound_the_same_way(self):
        # so the parts (wings, engines, rotor blades) join into one filled shape with no holes
        for kind, icon in self.r["icons"].items():
            self.assertTrue(icon["areas"] == [] or all(a > 0 for a in icon["areas"]), (kind, icon["areas"]))
            self.assertRegex(icon["d"], r"^[MLZ0-9.,\- ]+$")
            self.assertGreater(icon["nose"], 0)


class IconKindTest(unittest.TestCase):
    def test_kinds_from_type_description_category_and_wake(self):
        for craft, want in CASES:
            self.assertEqual(aircraft.icon(craft.get("type"), craft.get("desc"), craft.get("category")), want, craft)

    def test_each_aircraft_on_the_radar_carries_its_icon(self):
        from cloudwall.core import config
        from cloudwall.memory.store import Store
        from cloudwall.picture.tracker import Tracker

        class NoLookups:
            live = None
            aircraft = photo = route = lambda self, *a, **k: None
        home = config.DEFAULTS["home"]
        craft = lambda hexid, typ, miles, **more: dict(
            {"hex": hexid, "callsign": None, "reg": None, "type": typ, "alt": 3000, "on_ground": False, "gs": 100, "track": 90,
             "vrate": 0, "lat": home["lat"] + miles / 60, "lon": home["lon"], "squawk": "1200", "category": None, "military": False}, **more)
        t = Tracker(config.load(), Store(":memory:"), NoLookups())
        # near and far alike: the radar draws aircraft past the tracking radius too, and none of them is looked up
        t.update([craft("a1", "B738", 2), craft("a2", "ZZZZ", 5, desc="Cameron Balloons Z-105"), craft("a3", "H47", 25), craft("a4", "ZZZZ", 6)], "test")
        s = t.snapshot()
        self.assertEqual({a["hex"]: a.get("icon") for a in s["aircraft"] + s["beyond"]},
                         {"a1": "airliner", "a2": "balloon", "a3": "tandem", "a4": None})


if __name__ == "__main__":
    unittest.main()
