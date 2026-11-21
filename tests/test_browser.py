"""The page, in a real browser: every layout and tab draws, the controls work, and nothing goes
to the console or leaves the machine.

The displays (the flight card, the radar, the board, the Weather and Logbook tabs, the wall panel,
the phone layout) have no tests of their own: they are drawing code, and what matters is that a
browser can run all of it. So this starts CloudWall on its simulated traffic, with the map and the
logos off so that nothing is fetched from anywhere, and has tests/browser_smoke.js walk the page
in headless Chromium.

It needs Node and Playwright, which CloudWall itself does not:

    npm install --no-save playwright && npx playwright install chromium

Without them the tests are skipped, except where CLOUDWALL_BROWSER_TESTS=1 says they must run
(the workflow that runs the tests on every pull request sets it).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMOKE = Path(__file__).with_name("browser_smoke.js")
REQUIRED = os.environ.get("CLOUDWALL_BROWSER_TESTS") == "1"


def missing():
    """Why the browser can't be driven here, or None if it can."""
    if not shutil.which("node"):
        return "needs Node"
    found = subprocess.run(["node", "-e", "require.resolve('playwright')"], capture_output=True, cwd=ROOT)
    return None if found.returncode == 0 else "needs Playwright: npm install --no-save playwright && npx playwright install chromium"


class BrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        why = missing()
        if why and not REQUIRED:
            raise unittest.SkipTest(why)
        if why:
            raise AssertionError(f"CLOUDWALL_BROWSER_TESTS=1, but this {why}")
        cls.folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.folder.cleanup)
        folder = Path(cls.folder.name)
        (folder / "config.toml").write_text('[map]\nstyle = "off"\nroute = "off"\n[logos]\nenabled = false\n')     # nothing to fetch
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        cls.log = open(folder / "server.log", "w+")
        cls.addClassCleanup(cls.log.close)
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "cloudwall", "--demo", "--config", str(folder / "config.toml"), "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT, stdout=cls.log, stderr=subprocess.STDOUT, env=dict(os.environ, XDG_DATA_HOME=str(folder)))
        cls.addClassCleanup(cls.stop)
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):                                   # until it has traffic to show
            try:
                with urllib.request.urlopen(base + "/api/state", timeout=2) as answer:
                    if json.loads(answer.read())["aircraft"]:
                        break
            except OSError:
                pass
            time.sleep(0.2)
        else:
            raise AssertionError("the demo server didn't start:\n" + cls.server_log())
        run = subprocess.run(["node", str(SMOKE), base], capture_output=True, text=True, timeout=240, cwd=ROOT)
        if run.returncode:
            raise AssertionError(f"the browser couldn't be driven:\n{run.stderr[-3000:]}")
        cls.report = json.loads(run.stdout)

    @classmethod
    def stop(cls):
        cls.server.terminate()
        try:
            cls.server.wait(5)
        except subprocess.TimeoutExpired:
            cls.server.kill()

    @classmethod
    def server_log(cls):
        cls.log.flush()
        cls.log.seek(0)
        return cls.log.read()

    def scenario(self, name):
        """What the browser found in one scenario, once it is known to have gone through cleanly."""
        found = self.report[name]
        self.assertEqual(found["errors"], [], f"{name}: errors in the browser")
        return found

    def test_the_desktop_and_each_of_its_tabs(self):
        d = self.scenario("desktop")
        self.assertIn("desk", d["layout"])
        self.assertTrue(d["place"] and d["clock"])
        self.assertRegex(d["card"], "hero-card|idle-card")                  # a flight overhead, or the quiet-sky slides
        self.assertGreaterEqual(d["onScope"], 1)
        self.assertGreaterEqual(d["nearby"], 1)                              # the list beside the radar, on a wide screen
        self.assertRegex(d["strip"], r"aircraft within|Nothing in the air")  # the situation, across the top
        self.assertGreaterEqual(d["groups"], 1)                              # the list, grouped by what each is doing
        self.assertEqual(d["profile"], 1)                                    # and the side view under it
        self.assertGreaterEqual(d["phrases"], 1)                             # each group in a phrase that is the key too
        med = d["medical"]                                                   # the demo's air ambulance, on its way to a hospital
        self.assertEqual((med["badges"], len(med["named"]), med["listed"]), (1, 1, 1))
        self.assertGreaterEqual(med["helipads"], 3)                          # the hospital helipads around home
        self.assertTrue(d["medicalNote"] and d["medicalNote"][0].startswith("A medical helicopter heading for"))
        self.assertEqual(d["focus"], {"same": True, "redrawn": True})        # the keyboard keeps its place in the list
        self.assertTrue(d["simple"]["side"] and d["simple"]["radar"])        # Simple: the side panel, the simpler radar
        self.assertGreaterEqual(d["boardRows"], 1)
        self.assertGreaterEqual(d["heardRows"], 2)                           # the heading and the demo's fighters
        wx = d["weather"]
        self.assertTrue(wx["headline"])
        self.assertEqual((wx["rose"], wx["clouds"], wx["panels"]), (1, 1, 3))
        self.assertGreaterEqual(wx["charts"], 4)                             # category, temperature, wind, ceiling, visibility
        self.assertGreaterEqual(wx["forecast"], 1)
        self.assertGreaterEqual(wx["restrictions"], 1)
        self.assertEqual((d["logbook"]["stats"], d["logbook"]["hours"]), (6, 24))

    def test_following_a_flight_and_letting_it_go(self):
        f = self.scenario("follow")
        self.assertEqual((f["view"], f["followed"], f["released"]), ("now", f["picked"], True))
        self.assertGreaterEqual(f["track"], 1)                               # the selected aircraft's track is drawn

    def test_the_radars_switches_the_night_chart_and_the_place_menu(self):
        c = self.scenario("controls")
        self.assertTrue(c["icons"])                                          # every aircraft has an outline to draw
        self.assertGreaterEqual(c["ranges"], 2)
        self.assertIn("atc", c["atc"]["scope"])
        self.assertGreaterEqual(c["atc"]["status"], 3)                       # the status area's lines
        self.assertGreaterEqual(c["atc"]["blocks"], 1)
        self.assertEqual(c["buttons"], ["radar", "map"])                    # no sky view
        m = c["map"]
        self.assertEqual(m["layers"], ["places", "roads", "sat"])            # satellite, with roads and names over it
        self.assertEqual(c["streets"], ["streets"])
        self.assertTrue(m["names"] and all(" " in n or n.isalpha() for n in m["names"]))   # "Delta 178", "Glider": words
        self.assertTrue(any(line.endswith(" ft") for line in m["lines"]))
        self.assertNotEqual(m["box"], "-112 -112 224 224")                   # the shape of its panel, not the radar's square
        self.assertEqual(m["home"], 1)
        self.assertRegex(m["note"], r"within \d+ miles of home")
        self.assertTrue(c["backToRadar"])
        self.assertTrue(c["nightChanges"])
        self.assertGreaterEqual(c["places"], 1)
        self.assertIn("98683", c["located"]["where"])
        self.assertGreaterEqual(c["located"]["airports"], 2)                 # the closest major airport, and others

    def test_the_route_on_a_map(self):
        m = self.scenario("routeMap")
        self.assertGreaterEqual(m["tiles"], 2)
        self.assertTrue(all(0 <= z <= 6 for z in m["zooms"]))                # the world layer's zooms only
        d = m["drawn"]
        self.assertGreaterEqual(d["height"], 100)
        self.assertGreater(d["done"], 10)                                    # most of the way flown
        self.assertGreater(d["todo"], d["done"])
        self.assertTrue(d["craftInside"])                                    # the aircraft is on the map
        self.assertEqual((d["codes"], d["credit"]), (["HND", "PDX"], "Test imagery"))
        self.assertGreater(d["borders"], 5)                                  # country lines in view
        self.assertGreaterEqual(len(d["cities"]), 2)                         # a few places to find your way by
        self.assertNotIn("Tokyo", d["cities"])                               # not one the airport code already names

    def test_the_wall_panel(self):
        k = self.scenario("kiosk")
        self.assertIn("kiosk", k["layout"])
        self.assertEqual((k["simple"], k["side"], k["card"], k["tabsShown"]), (True, 1, 1, False))
        self.assertTrue(k["heardSaid"] and k["sideFits"])                     # heard aircraft said, however the side is trimmed
        self.assertTrue(k["strip"])                                          # Detailed: the situation over the radar
        self.assertEqual(k["labelsInside"], [])                              # every radar label placed, and inside the radar
        self.assertGreaterEqual(k["queue"], 1)                               # and the demo's arrivals under the card
        self.assertNotIn("map", k["scope"])                                  # the radar unless [kiosk] view says map
        self.assertGreaterEqual(k["onScope"], 1)

    def test_the_next_minutes_old_data_and_quiet_hours(self):
        g = self.scenario("glance")
        self.assertGreaterEqual(g["axis"]["marks"], 1)                       # the demo's arrivals, along the ten-minute axis
        self.assertTrue(g["axis"]["inside"])
        self.assertTrue(1 <= len(g["line"]) <= 3 and all(any(w in e for w in ("lands", "over the house", " at ")) for e in g["line"]))
        self.assertGreaterEqual(g["kioskLine"], 1)                           # across the wall panel's header
        self.assertEqual((g["old"]["stale"], g["old"]["stopped"]), (True, True))
        self.assertRegex(g["old"]["note"], r"Not updating: positions \d+ s old")
        self.assertRegex(g["estimated"]["chip"], r"Position estimated: last report \d+ s ago")
        self.assertTrue(g["estimated"]["faded"])
        self.assertEqual((g["hushed"], g["woken"]), (True, True))

    def test_a_wide_short_window(self):
        w = self.scenario("wide")
        self.assertEqual(w["card"], {"overlaps": [], "inside": True})        # the card's parts give way rather than collide
        self.assertLess(w["radar"], 80)                                       # the radar's column hugs its disc
        self.assertTrue(w["simple"]["notes"] and w["simple"]["rows"] >= 1)  # Simple: worth a look past the radar

    def test_the_wall_panel_on_the_map(self):
        self.assertGreaterEqual(self.scenario("kioskMap")["onMap"], 1)

    def test_a_phone(self):
        p = self.scenario("phone")
        self.assertIn("phone", p["layout"])
        self.assertGreaterEqual(p["boardRows"], 1)
        self.assertEqual(p["view"], "now")                                   # a tapped flight brings its card up
        self.assertGreaterEqual(p["queue"], 1)

    def test_the_quiet_sky_slides(self):
        q = self.scenario("quiet")
        # the next flight or a quiet sky, the fighters heard, the restriction and the weather, at least
        self.assertGreaterEqual(len(q["desktop"]), 4, q["desktop"])
        self.assertGreaterEqual(len(q["kiosk"]), 4, q["kiosk"])

    def test_an_emergency_takes_the_screen(self):
        e = self.scenario("emergency")
        self.assertEqual((e["red"], e["title"], e["hidden"]), (True, "Emergency", True))
        self.assertIn("7700", e["chip"])
        self.assertIn("EM", e["onRadar"])                                    # and its data block says so on the ATC radar

    def test_the_page_says_when_the_server_is_gone(self):
        o = self.scenario("offline")
        self.assertFalse(o["chipBefore"])
        self.assertIn("offline", o["chipAfter"])

    def test_the_server_had_nothing_to_complain_of(self):
        log = self.server_log()
        self.assertNotIn("Traceback", log)
        self.assertNotRegex(log, r"(?m)^\S+ \S+ \S+ .*(failed|couldn't)")


if __name__ == "__main__":
    unittest.main()
