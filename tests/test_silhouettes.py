"""The flight card's side-view drawings: every aircraft type CloudWall knows draws as its own
profile. Runs the browser modules under Node, so it is skipped where Node isn't installed."""
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
    """ICAO type -> [shape, length] from the table in data.js."""
    src = (WEB / "data.js").read_text()
    block = src[src.index("const T = {"):src.index("};", src.index("const T = {"))]
    return {t: [shape, float(length)] for t, shape, length in re.findall(r'(\w+): \["(\w+)", ([\d.]+)\]', block)}


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

    def test_every_type_has_its_own_profile(self):
        missing = sorted(t for t in self.types if not self.drawn[t]["mapped"])
        self.assertEqual(missing, [], "types drawn with a generic fallback")

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


if __name__ == "__main__":
    unittest.main()
