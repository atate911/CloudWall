"""The flight card's side-view drawings: every aircraft type CloudWall knows draws as its own
profile. Runs the browser modules under Node, so it is skipped where Node isn't installed."""
import csv
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "cloudwall" / "web" / "js"

SCRIPT = r"""
const dir = process.argv[1], types = JSON.parse(process.argv[2]);
const { silhouette, _profile } = await import(dir + "/silhouette.js");
const { knownTypes } = await import(dir + "/profiles.js");
const mapped = new Set(knownTypes()), out = {};
for (const [type, [shape, length]] of Object.entries(types)) {
  let svg = "", error = null;
  try { svg = silhouette(type, shape, length); } catch (e) { error = String(e && e.stack || e); }
  out[type] = { mapped: mapped.has(type), error, svg };
}
// unknown types fall back to a family for their broad shape
for (const shape of ["narrow", "wide", "quad", "regional", "bizjet", "turboprop", "piston", "heli", "fighter"]) {
  let svg = "", error = null;
  try { svg = silhouette("ZZZZ", shape, 30); } catch (e) { error = String(e); }
  out["fallback:" + shape] = { mapped: true, error, svg };
}
// variants sharing a type code are told apart by model name: tailwheel RV-7 vs nosewheel RV-7A
const fam = (t, name) => { const f = _profile(t, "piston", 6.2, name); return f && JSON.stringify(f.gear || f.parts?.gear || null); };
out["variants"] = { rv7: fam("RV7", "Vans RV-7"), rv7a: fam("RV7", "VANS AIRCRAFT RV-7A"), plain: fam("RV7", "") };
console.log(JSON.stringify(out));
"""


def data_types():
    """ICAO type -> [shape, length] from the server's table of types (those it has a shape for)."""
    table = WEB.parent.parent / "data" / "types.csv"
    with open(table, newline="", encoding="utf-8") as f:
        return {r["type"]: [r["shape"], float(r["length_m"])]
                for r in csv.DictReader(line for line in f if not line.startswith("#")) if r["shape"]}


@unittest.skipUnless(shutil.which("node"), "needs node")
class SilhouetteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.types = data_types()
        run = subprocess.run(["node", "--input-type=module", "-e", SCRIPT, str(WEB), json.dumps(cls.types)],
                             capture_output=True, text=True, timeout=120)
        if run.returncode:
            raise AssertionError(run.stderr)
        cls.drawn = json.loads(run.stdout)

    def test_table_is_read(self):
        self.assertGreater(len(self.types), 100)

    # types in the table still waiting for a drawing of their own; they get a faint stand-in
    PENDING = {"F16", "F18", "F22", "F35", "A10", "T38", "T6"}

    def test_every_type_has_its_own_profile(self):
        missing = {t for t in self.types if not self.drawn[t]["mapped"]}
        self.assertEqual(sorted(missing - self.PENDING), [], "types drawn with a generic fallback")
        self.assertEqual(sorted(self.PENDING - missing), [], "these have a drawing now: take them off PENDING")

    def test_model_name_picks_the_variant(self):
        v = self.drawn["variants"]
        self.assertNotEqual(v["rv7"], v["rv7a"], "RV-7 and RV-7A should differ (tailwheel vs nosewheel)")
        self.assertEqual(v["plain"], v["rv7"])

    def test_every_drawing_renders(self):
        for name, d in self.drawn.items():
            if name == "variants":
                continue
            with self.subTest(name):
                self.assertIsNone(d["error"])
                self.assertTrue(d["svg"].startswith('<svg class="sil" viewBox="'), d["svg"][:80])
                self.assertIn('class="hull"', d["svg"])
                self.assertNotIn("NaN", d["svg"])
                self.assertNotIn("Infinity", d["svg"])
                w, h = map(float, re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"', d["svg"]).groups())
                # a side view is longer than it is tall, and not absurdly so
                self.assertTrue(1.2 < w / h < 9, f"aspect {w / h:.2f}")


PLATE_SCRIPT = r"""
const dir = process.argv[1];
const p = await import(dir + "/plate.js");
const out = {};
// the lineup: smallest first, wrapped into rows, one scale for all
const items = [{ w: 6.4, h: 2.1 }, { w: 8.5, h: 2.9 }, { w: 31, h: 10 }, { w: 40, h: 12.6 }, { w: 64, h: 19 }, { w: 76, h: 20 }];
for (const [W, H] of [[400, 300], [780, 600], [1200, 500]]) {
  const r = p.lineup(items, W, H), slot = (i) => Math.max(items[i].w * r.k, 48);
  out[`${W}x${H}`] = { k: r.k, rows: r.rows,
    widths: r.rows.map((row) => row.reduce((s, i) => s + slot(i), 0) + 18 * (row.length - 1)),
    height: r.rows.reduce((s, row) => s + Math.max(...row.map((i) => items[i].h * r.k)) + 30, 0) + 10 * (r.rows.length - 1) };
}
out.lone = p.lineup([{ w: 8.3, h: 2.7 }], 800, 400).k;
out.bar = p.scaleBar(3.3);
out.known = p.plate({ type: "B738", shape: "narrow", length: 39.47, name: "", known: true }, { note: "New to your collection" });
out.unknown = p.plate({ type: "ZZZZ", shape: "narrow", length: 36, name: "", known: false });
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "needs node")
class PlateTest(unittest.TestCase):
    """The type plate and the fleet lineup's layout."""

    @classmethod
    def setUpClass(cls):
        run = subprocess.run(["node", "--input-type=module", "-e", PLATE_SCRIPT, str(WEB)],
                             capture_output=True, text=True, timeout=60)
        if run.returncode:
            raise AssertionError(run.stderr)
        cls.out = json.loads(run.stdout)

    def test_lineup_fits_its_box_in_order(self):
        for box in ("400x300", "780x600", "1200x500"):
            with self.subTest(box):
                W, H = map(int, box.split("x"))
                r = self.out[box]
                self.assertEqual([i for row in r["rows"] for i in row], list(range(6)))   # smallest first, none lost
                self.assertTrue(all(w <= W + 0.01 for w in r["widths"]), r["widths"])
                self.assertLessEqual(r["height"], H + 0.01)
                self.assertLessEqual(r["k"] * 76, W * 0.5 + 0.01)                        # one airliner never fills it

    def test_a_lone_light_aircraft_is_not_blown_up(self):
        self.assertAlmostEqual(self.out["lone"], 800 * 0.5 / 8.3, places=3)

    def test_scale_bar_is_a_round_length(self):
        self.assertIn(self.out["bar"]["m"], (2, 5, 10, 20, 25, 50, 100))

    def test_plate_shows_length_and_note(self):
        k = self.out["known"]
        self.assertIn('class="dimline"', k)
        self.assertIn("<b>129 ft</b> 39.5 m", k)
        self.assertIn("New to your collection", k)
        u = self.out["unknown"]
        self.assertIn("standin", u)
        self.assertNotIn("dimline", u)


if __name__ == "__main__":
    unittest.main()
