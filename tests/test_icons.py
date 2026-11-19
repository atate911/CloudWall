"""The chart-style radar's aircraft icons: which kind each aircraft gets, and that the icons are
sound drawings. Runs the browser modules under Node, so it is skipped where Node isn't installed."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "cloudwall" / "web" / "js"

SCRIPT = r"""
const dir = process.argv[1], cases = JSON.parse(process.argv[2]);
const { iconKind, typeInfo } = await import(dir + "/data.js");
const { ICONS } = await import(dir + "/icons.js");
const src = (await import("node:fs")).readFileSync(dir + "/data.js", "utf8");
const block = src.slice(src.indexOf("const T = {"), src.indexOf("};", src.indexOf("const T = {")));
const types = [...block.matchAll(/(\w+): \["(\w+)"/g)].map((m) => m[1]);
// each part of an icon: its signed area (positive: clockwise on screen, y running down)
const areas = (d) => d.split("Z").filter((s) => s.trim()).map((s) => {
  const p = s.replace(/^M/, "").split("L").map((q) => q.split(",").map(Number));
  return p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x * y2 - x2 * y); }, 0) / 2;
});
console.log(JSON.stringify({
  kinds: Object.keys(ICONS),
  table: Object.fromEntries(types.map((t) => [t, iconKind({ type: t })])),
  cases: cases.map((c) => iconKind(c)),
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
    ({"type": "ZZZZ", "category": "A6"}, "fighter"), ({"type": "ZZZZ", "cwt": "B"}, "heavy"),
    ({"type": "ZZZZ", "cwt": "I"}, "light"), ({"type": "B738", "category": "A7"}, "airliner"),   # the type wins
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
        out = subprocess.run(["node", "--input-type=module", "-e", SCRIPT, str(WEB), json.dumps([c for c, _ in CASES])],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_every_type_in_the_table_has_an_icon(self):
        missing = [t for t, k in self.r["table"].items() if k not in self.r["kinds"]]
        self.assertEqual(missing, [])

    def test_kinds_from_type_description_category_and_wake(self):
        for (aircraft, want), got in zip(CASES, self.r["cases"]):
            self.assertEqual(got, want, aircraft)

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


if __name__ == "__main__":
    unittest.main()
