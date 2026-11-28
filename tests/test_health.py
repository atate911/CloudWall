"""CloudWall checking itself (core/health.py, core/troubles.py, app/watch.py): each problem found,
said once, repaired where safe; the subtle ones found from what the data should look like."""
import ast
import os
import socket
import tempfile
import time
import unittest
from pathlib import Path

from cloudwall.core import config, health, troubles
from cloudwall.core.health import OK
from cloudwall.gather import feeds
from cloudwall.memory.incidents import Incidents
from cloudwall.memory.store import Store

PACKAGE = Path(__file__).resolve().parent.parent / "cloudwall"


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


class FakeActivity:
    def idle(self):
        return False


class FakeTracker:
    def __init__(self, clock):
        self.status = {"ok": True, "updated": clock(), "error": None, "storage": None}
        self.storage_error = None
        self.vitals = {"since": clock(), "updates": 0, "aircraft": 0, "closest_nm": None}


class FakePlace:
    def __init__(self, clock, source=None, pid="home"):
        self.id, self.name = pid, "Home"
        self.cfg = config.load(None)
        self.activity = FakeActivity()
        self.when_idle = "pause"
        self.tracker = FakeTracker(clock)
        self.source = source
        self.weather = None
        self.restarts = []
        self.threads = []
        self.store = None


def watch(places, cfg=None, **kw):
    from cloudwall.app.watch import Watch
    cfg = cfg or config.load(None)
    cfg["home"] = dict(cfg["home"], lat=45.6, lon=-122.6)      # not the placeholder
    return Watch(cfg, places, **kw)


class CatalogueTest(unittest.TestCase):
    def test_every_problem_says_what_it_means_and_what_to_do(self):
        for code, t in troubles.CATALOGUE.items():
            self.assertTrue(t.title and t.means and t.steps, code)

    def test_every_code_a_check_names_is_in_the_catalogue(self):
        named = set()
        for p in PACKAGE.rglob("*.py"):
            for node in ast.walk(ast.parse(p.read_text())):
                if (isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", None)) == "trouble"
                        and node.args and isinstance(node.args[0], ast.Constant)):
                    named.add(node.args[0].value)
        self.assertTrue(named)
        self.assertEqual(sorted(named - set(troubles.CATALOGUE)), [])

    def test_every_repair_named_exists(self):
        from cloudwall.operate import repair
        for code, t in troubles.CATALOGUE.items():
            if t.repair:
                self.assertIn(t.repair, repair.REPAIRS, code)


class MonitorTest(unittest.TestCase):
    def test_a_problem_starts_goes_on_and_ends_once_each(self):
        clock = Clock()
        with tempfile.TemporaryDirectory() as d:
            log = Incidents(str(Path(d, "health.db")))
            m = health.Monitor(log, clock)
            down = health.trouble("feeds.receiver-down", "your receiver hasn't answered for 3 min")
            with self.assertLogs("cloudwall.health", "WARNING") as said:
                self.assertEqual(m.observe([down]), [("started", down)])
            self.assertEqual(len(said.output), 1)
            clock.t += 30
            self.assertEqual(m.observe([down]), [])                     # still going: not said again
            clock.t += 30
            self.assertEqual([c[0] for c in m.observe([health.ok("feeds", "answering")])], ["ended"])
            [row] = log.recent()
            self.assertEqual((row["code"], row["ended"] - row["started"]), ("feeds.receiver-down", 60))
            log.close()

    def test_a_major_problem_is_said_loudly(self):
        m = health.Monitor()
        with self.assertLogs("cloudwall.health", "ERROR") as said:
            m.observe([health.trouble("feeds.no-positions", "Home: no positions for 300 s")])
        self.assertIn("feeds.no-positions", [f.code for f in m.majors()])
        self.assertIn("no positions", said.output[0])
        self.assertEqual(m.summary()["major_title"], "no positions are arriving")

    def test_the_report_says_the_subtle_ones_look_right_but_arent(self):
        text = health.render([health.trouble("receiver.deaf", "your receiver: 0 aircraft, the public feed 23")])
        self.assertIn("looks right on the screens, but isn't", text)
        self.assertIn("1. ", text)                                      # numbered steps


class WatchTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()

    def merged_place(self):
        m = feeds.Merged(["http://rx/data/aircraft.json", "https://pub/{lat}/{lon}/{radius}"], clock=self.clock)
        self.addCleanup(m.close)
        return FakePlace(self.clock, m), m

    def answer(self, feed, n, moving=True, now=None, seen_pos=0.5, same_positions=False, stamped=True):
        data = {"now": now if now is not None else self.clock(),
                "aircraft": [{"hex": f"a{i:05x}", "lat": 45.6 + (0 if same_positions else i * 0.01 + (self.clock() % 1000) * 1e-4),
                              "lon": -122.6, "gs": 300 if moving else 0, "alt_baro": 10000, "seen_pos": seen_pos}
                             for i in range(n)]}
        if not stamped:
            del data["now"]
        feed.vitals.answered(data, feeds.placed_with_times(data, self.clock()), self.clock(), "host")

    def codes(self, w):
        return {f.code for f in w.checks() if f.state != OK}

    def test_a_watched_board_with_no_positions_fails_loudly(self):
        place = FakePlace(self.clock)
        w = watch([place], clock=self.clock)
        w.checks()                                                      # (it looks as it starts, as Watch.start does)
        self.clock.t += 600
        self.assertIn("feeds.no-positions", self.codes(w))
        place.tracker.status["updated"] = self.clock()
        self.assertNotIn("feeds.no-positions", self.codes(w))

    def test_weather_that_stops_arriving_is_said(self):
        place = FakePlace(self.clock)
        place.weather = {"station": "KPDX", "time": self.clock()}
        w = watch([place], clock=self.clock)
        w.checks()
        self.clock.t += 3600
        place.tracker.status["updated"] = self.clock()
        self.assertNotIn("weather.old", self.codes(w))                  # an hour old is how often a station reports
        self.clock.t += 3 * 3600
        place.tracker.status["updated"] = self.clock()
        [found] = [f for f in w.checks() if f.code == "weather.old"]
        self.assertIn("KPDX is 4 h old", found.summary)
        place.weather = {"station": "KPDX", "time": self.clock()}
        self.assertNotIn("weather.old", self.codes(w))

    def test_a_screen_opening_after_an_idle_pause_is_no_alarm(self):
        """Overnight with no screen (when_idle = pause), the last positions are hours old. The first
        screen of the morning wakes the poller; until its first answer, that is no fault."""
        place = FakePlace(self.clock)
        idle = [True]
        place.activity.idle = lambda: idle[0]
        w = watch([place], clock=self.clock)
        self.clock.t += 8 * 3600                                        # the night
        self.assertNotIn("feeds.no-positions", self.codes(w))
        idle[0] = False                                                 # the wall panel wakes
        self.clock.t += 2
        self.assertNotIn("feeds.no-positions", self.codes(w))           # seconds later: not yet judged
        self.clock.t += 30
        self.assertNotIn("feeds.no-positions", self.codes(w))
        self.clock.t += 120                                             # but two minutes of nothing is
        self.assertIn("feeds.no-positions", self.codes(w))

    def test_a_frozen_feed_is_found(self):
        """The same answer again and again: its time stamp doesn't move on."""
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        made = self.clock()
        for _ in range(4):
            self.answer(m.receiver, 12, now=made)                       # the decoder hung at `made`
            self.answer(m.public, 12)
            self.clock.t += 5
        self.assertIn("feeds.frozen", self.codes(w))

    def test_one_aircraft_out_of_range_isnt_a_frozen_feed(self):
        """At night: the receiver's one aircraft has gone out of range and is listed at its last
        position while it ages, but each answer is made afresh. (Seen on the production server.)"""
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        for i in range(6):
            self.answer(m.receiver, 1, same_positions=True, seen_pos=5 * i)
            self.answer(m.public, 1)
            self.clock.t += 5
        self.assertNotIn("feeds.frozen", self.codes(w))

    def test_a_feed_with_no_time_stamp_is_judged_by_many_moving_aircraft(self):
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        for _ in range(4):
            self.answer(m.public, 12, same_positions=True, stamped=False)
            self.answer(m.receiver, 12)
            self.clock.t += 5
        self.assertIn("feeds.frozen", self.codes(w))

    def test_parked_aircraft_answering_the_same_isnt_frozen(self):
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        for _ in range(4):
            self.answer(m.public, 12, moving=False, same_positions=True)
            self.answer(m.receiver, 12)
            self.clock.t += 5
        self.assertNotIn("feeds.frozen", self.codes(w))

    def test_a_deaf_receiver_is_found_after_a_while_not_at_once(self):
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        found = []
        for i in range(12):
            self.answer(m.public, 25)
            self.answer(m.receiver, 0)
            found.append("receiver.deaf" in self.codes(w))
            self.clock.t += 30
        self.assertFalse(any(found[:5]))                                # a quiet minute isn't deafness
        self.assertTrue(found[-1])

    def test_a_receiver_down_is_said_as_such_after_a_blip(self):
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        self.answer(m.public, 10)
        m.receiver.vitals.failed(ConnectionRefusedError("refused"), self.clock())
        self.assertNotIn("feeds.receiver-down", self.codes(w))          # a blip
        self.clock.t += 300
        self.answer(m.public, 10)
        self.assertIn("feeds.receiver-down", self.codes(w))

    def test_clocks_that_disagree_and_lagging_positions(self):
        place, m = self.merged_place()
        w = watch([place], clock=self.clock)
        self.answer(m.public, 10, now=self.clock() + 40)                # its clock 40 s ahead of ours
        self.answer(m.receiver, 10, seen_pos=12)                        # positions 12 s old on arrival
        codes = self.codes(w)
        self.assertIn("clock.skew", codes)
        self.assertIn("receiver.lagging", codes)

    def test_a_house_no_aircraft_comes_near(self):
        place = FakePlace(self.clock)
        place.tracker.vitals.update(aircraft=5000, closest_nm=22.0)
        w = watch([place], clock=self.clock)
        self.clock.t += 4 * 3600
        place.tracker.status["updated"] = self.clock()
        self.assertIn("home.suspect", self.codes(w))

    def test_sample_routes_a_demo_and_a_placeholder_house(self):
        class Provider:
            enabled, sandbox, label, unit = True, True, "Flightradar24", "credits"

            def status(self):
                return {"problem": None, "period_budget": None}
        w = watch([], provider=Provider(), demo=True, clock=self.clock)
        codes = self.codes(w)
        self.assertIn("routes.sandbox", codes)
        self.assertIn("display.demo", codes)
        w.cfg["home"] = dict(config.DEFAULTS["home"])
        w.demo = False
        self.assertIn("settings.placeholder", self.codes(w))

    def test_a_settings_file_changed_under_it(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            p.write_text("[tracking]\nradius_nm = 15\n")
            cfg = config.load(p)
            w = watch([], cfg=cfg, clock=self.clock)
            self.assertNotIn("settings.changed", self.codes(w))
            p.write_text("[tracking]\nradius_nm = 20\n")
            os.utime(p, (time.time() + 5, time.time() + 5))
            self.assertIn("settings.changed", self.codes(w))
            p.write_text("[tracking]\nradius_nm = \"far\"\n")
            os.utime(p, (time.time() + 10, time.time() + 10))
            found = [f for f in w.checks() if f.code == "settings.changed-broken"]
            self.assertTrue(found and found[0].major)                    # it wouldn't start again: said loudly

    def test_a_logbook_that_keeps_failing_is_reopened(self):
        with tempfile.TemporaryDirectory() as d:
            place = FakePlace(self.clock)
            place.store = Store(str(Path(d, "cloudwall.db")))
            self.addCleanup(place.store.close)
            reopened = []
            real = place.store.reopen
            place.store.reopen = lambda: (reopened.append(1), real())
            place.tracker.storage_error = "the logbook couldn't be saved (OperationalError: disk I/O error)"
            w = watch([place], clock=self.clock)
            with self.assertLogs("cloudwall.health", "WARNING"):
                for _ in range(4):
                    w.check_once()
            self.assertEqual(reopened, [1])

    def test_a_check_that_trips_doesnt_stop_the_watcher(self):
        place = FakePlace(self.clock)
        place.tracker = None                                            # every feed check will trip on this
        w = watch([place], clock=self.clock)
        found = w.checks()
        self.assertTrue(any("check itself failed" in f.summary for f in found))


class SystemdTest(unittest.TestCase):
    def test_systemd_is_told(self):
        from cloudwall.app import watch as W
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "notify")
            s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            s.bind(path)
            self.addCleanup(s.close)
            os.environ["NOTIFY_SOCKET"] = path
            try:
                self.assertTrue(W.sd_notify("READY=1"))
                self.assertEqual(s.recv(100), b"READY=1")
            finally:
                del os.environ["NOTIFY_SOCKET"]
        self.assertFalse(W.sd_notify("READY=1"))                        # not under systemd: nothing to tell


if __name__ == "__main__":
    unittest.main()


class SchemaTest(unittest.TestCase):
    def test_every_setting_is_explained(self):
        from cloudwall.core import schema
        described = {(s.name, st.key) for s in schema.SECTIONS for st in s.settings}
        missing = [(sec, key) for sec, keys in config.DEFAULTS.items() for key in keys if (sec, key) not in described]
        self.assertEqual(missing, [], "add these to core/schema.py, with what they do")
        for s in schema.SECTIONS:
            self.assertIn(s.page, dict(schema.PAGES))
            for st in s.settings:
                self.assertTrue(st.label and len(st.help) > 20, (s.name, st.key))

    def test_secrets_are_never_shown_back(self):
        from cloudwall.core import schema
        cfg = config.load(None)
        cfg["flightradar24"]["api_key"] = "fr24-secret"
        text = repr(schema.describe(cfg))
        self.assertNotIn("fr24-secret", text)
        [fr] = [s for s in schema.describe(cfg) if s["name"] == "flightradar24"]
        self.assertEqual(fr["settings"][0]["value"], {"set": True})
