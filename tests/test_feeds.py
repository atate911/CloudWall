import json
import math
import time
import unittest
from pathlib import Path

from cloudwall.core import config, geo
from cloudwall.gather import demo, feeds
from cloudwall.gather.enrich import Enricher
from cloudwall.memory.store import Store
from cloudwall.picture.tracker import Tracker

import support
from support import AUS, PDX, PUB, RX, SFO, StubEnricher, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class GeoTest(unittest.TestCase):
    def test_distance_and_bearing(self):
        self.assertAlmostEqual(geo.haversine_nm(*PDX, *SFO), 478, delta=3)
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 46, -122), 0, delta=0.1)
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 45, -121), 90, delta=1)
        self.assertEqual(geo.compass(281), "W")
        self.assertEqual(geo.compass(350), "N")

    def test_elevation(self):
        self.assertAlmostEqual(geo.elevation_deg(1, geo.FT_PER_NM), 45, delta=0.01)

    def test_cpa(self):
        # 10 nm due east of home, flying west at 120 kt: overhead in 5 minutes
        lon = -122 + 10 / (60 * 0.7071)
        secs, dist = geo.cpa(45, -122, 45, lon, 270, 120)
        self.assertAlmostEqual(secs, 300, delta=3)
        self.assertLess(dist, 0.05)
        self.assertEqual(geo.cpa(45, -122, 45, lon, 90, 120)[0], 0)   # flying away

    def test_route_plausibility(self):
        self.assertTrue(geo.route_plausible(*SFO, *PDX, 44.0, -122.8))
        self.assertFalse(geo.route_plausible(*SFO, *AUS, *PDX))


class SourceTest(unittest.TestCase):
    def test_normalise_real_feed(self):
        data = json.loads((Path(__file__).parent / "fixtures/adsblol_point.json").read_text())
        ac = [feeds.normalise(a) for a in data["ac"]]
        by = {a["callsign"]: a for a in ac}
        self.assertEqual(by["UAL1953"]["type"], "B738")
        self.assertEqual(by["UAL1953"]["alt"], 3625)
        self.assertTrue(by["ASA714"]["on_ground"])
        self.assertEqual(by["ASA714"]["alt"], 0)


class FeedsTest(unittest.TestCase):
    def test_failover_is_sticky(self):
        calls = []

        def fake(url, timeout=0):
            calls.append(url)
            if "bad" in url:
                raise OSError("handshake timed out")
            return {"ac": [{"hex": "abc123", "lat": 45.0, "lon": -122.0, "flight": "ASA1 "}]}

        real, feeds.get_json = feeds.get_json, fake
        try:
            f = feeds.Feeds(["https://bad.example/{lat}/{lon}/{radius}", "https://good.example/{lat}/{lon}/{radius}"])
            self.assertEqual(f.fetch(45, -122, 15)[0]["callsign"], "ASA1")
            self.assertEqual(f.name, "good.example")
            f.fetch(45, -122, 15)                       # stays on the working feed
            self.assertEqual([("bad" in c) for c in calls], [True, False, False])
            f2 = feeds.Feeds(["https://bad.example/{lat}", "https://bad.example/b/{lat}"])
            self.assertRaises(OSError, f2.fetch, 45, -122, 15)
        finally:
            feeds.get_json = real

    def test_an_answer_that_is_no_feed_fails_over(self):
        # a 404 (get_json gives None) or JSON of some other shape is no answer: the next feed is asked
        for junk in (None, ["maintenance"]):
            def fake(url, timeout=0, junk=junk):
                return junk if "bad" in url else {"ac": [{"hex": "abc123", "lat": 45.0, "lon": -122.0, "flight": "ASA1 "}]}
            real, feeds.get_json = feeds.get_json, fake
            try:
                f = feeds.Feeds(["https://bad.example/{lat}", "https://good.example/{lat}"], quiet=True)
                self.assertEqual(f.fetch(45, -122, 15)[0]["callsign"], "ASA1")
                self.assertEqual(f.name, "good.example")
                self.assertRaises(ValueError, feeds.Feeds(["https://bad.example/{lat}"], quiet=True).fetch, 45, -122, 15)
            finally:
                feeds.get_json = real

    def test_legacy_single_url_config(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml") as t:
            t.write('[source]\nurl = "http://localhost:8080/data/aircraft.json"\n')
            t.flush()
            urls = config.load(t.name)["source"]["urls"]
        self.assertEqual(urls[0], "http://localhost:8080/data/aircraft.json")
        self.assertEqual(len(urls), 3)


class MergedTest(unittest.TestCase):
    """Your own receiver and a public feed together (feeds.Merged). The receiver answers like
    readsb's aircraft.json (now in seconds); the public feed like the community APIs (now in ms)."""

    def setUp(self):
        self.t = 1_000_000.0
        self.answers = {}          # "rx" / "pub" -> list of records, or an exception
        self.now = {"rx": None, "pub": None}

        def fake(url, timeout=0):
            key = "rx" if url == RX else "pub"
            got = self.answers.get(key, [])
            if isinstance(got, Exception):
                raise got
            made = self.t if self.now[key] is None else self.now[key]
            return {"now": made, "aircraft": got} if key == "rx" else {"now": made * 1000, "ac": got}

        self.real, feeds.get_json = feeds.get_json, fake
        self.m = feeds.Merged([RX, PUB], clock=lambda: self.t)

    def tearDown(self):
        feeds.get_json = self.real
        self.m.pool.shutdown()

    @staticmethod
    def rec(hexid, lat, lon, seen_pos=0.0, **kw):
        return dict({"hex": hexid, "lat": lat, "lon": lon, "seen_pos": seen_pos, "alt_baro": 10000,
                     "gs": 360.0, "track": 90.0}, **kw)

    def fetch(self):
        return {a["hex"]: a for a in self.m.fetch(45.6, -122.7, 15)}

    def test_union_of_both_feeds(self):
        self.answers = {"rx": [self.rec("aaa111", 45.6, -122.7)],
                        "pub": [self.rec("aaa111", 45.6, -122.71, seen_pos=4), self.rec("bbb222", 46.0, -122.0)]}
        got = self.fetch()
        self.assertEqual(set(got), {"aaa111", "bbb222"})          # one only the public feed sees, too
        self.assertAlmostEqual(got["aaa111"]["lon"], -122.7, places=6)    # the receiver's fresh position
        self.assertEqual(self.m.name, "receiver.local + public.example")

    def test_lagging_report_is_moved_on_to_now(self):
        # 360 kt due east, reported 5 s ago: 0.5 nm further east now
        self.answers = {"rx": [], "pub": [self.rec("ccc333", 45.0, -122.0, seen_pos=5)]}
        a = self.fetch()["ccc333"]
        moved = geo.haversine_nm(45.0, -122.0, a["lat"], a["lon"])
        self.assertAlmostEqual(moved, 0.5, delta=0.01)
        self.assertGreater(a["lon"], -122.0)

    def test_newer_public_position_beats_a_stale_receiver_one(self):
        # the receiver last heard it 20 s ago; the public feed has it from 2 s ago
        self.answers = {"rx": [self.rec("ddd444", 45.0, -122.0, seen_pos=20)],
                        "pub": [self.rec("ddd444", 45.0, -121.97, seen_pos=2)]}
        a = self.fetch()["ddd444"]
        expected = feeds.project(feeds.normalise(self.rec("ddd444", 45.0, -121.97)), 2)
        self.assertAlmostEqual(a["lon"], expected["lon"], places=6)

    def test_never_goes_backwards(self):
        # update 1: the receiver hears it now
        self.answers = {"rx": [self.rec("eee555", 45.0, -122.0)], "pub": []}
        first = self.fetch()["eee555"]
        # update 2, 5 s later: the receiver has lost it; the public feed is 8 s behind (3 s before update 1)
        self.t += 5
        self.answers = {"rx": [], "pub": [self.rec("eee555", 45.0, -122.0 - 3 * 0.1 / 60 / math.cos(math.radians(45)), seen_pos=8)]}
        second = self.fetch()["eee555"]
        self.assertGreater(second["lon"], first["lon"])           # carried on east, not pulled back west
        self.assertAlmostEqual(geo.haversine_nm(45.0, first["lon"], 45.0, second["lon"]), 0.5, delta=0.01)

    def test_details_filled_from_the_other_feed(self):
        self.answers = {"rx": [self.rec("fff666", 45.0, -122.0)],
                        "pub": [self.rec("fff666", 45.0, -122.0, seen_pos=3, t="B39M", r="N123AS", dbFlags=1)]}
        a = self.fetch()["fff666"]
        self.assertEqual((a["type"], a["reg"]), ("B39M", "N123AS"))
        self.assertTrue(a["military"])
        self.assertEqual(set(a), set(feeds.normalise({"hex": "x"})))   # the same shape as any feed's record

    def test_one_feed_down_the_other_carries_on(self):
        self.answers = {"rx": OSError("tunnel down"), "pub": [self.rec("abc123", 45.0, -122.0)]}
        self.assertEqual(set(self.fetch()), {"abc123"})
        self.assertEqual(self.m.name, "public.example")
        self.answers = {"rx": [self.rec("abc123", 45.0, -122.0)], "pub": OSError("rate limited")}
        self.assertEqual(set(self.fetch()), {"abc123"})
        self.answers = {"rx": OSError("down"), "pub": OSError("down")}
        self.assertRaises(OSError, self.m.fetch, 45.6, -122.7, 15)

    def test_old_positions_and_ground_traffic(self):
        self.answers = {"rx": [self.rec("old111", 45.0, -122.0, seen_pos=75),
                               self.rec("gnd222", 45.0, -122.0, seen_pos=5, alt_baro="ground", gs=15.0)],
                        "pub": []}
        got = self.fetch()
        self.assertNotIn("old111", got)                          # older than a minute: left out
        self.assertEqual(got["gnd222"]["lon"], -122.0)            # taxiing: not moved on

    def test_clocks_and_times(self):
        self.assertEqual(feeds.feed_time({"now": 1_000_000_000_000}, 1_000_000_000.5), 1_000_000_000)   # ms
        self.assertEqual(feeds.feed_time({"now": 999_000_000}, 1_000_000_000), 1_000_000_000)  # far off: arrival
        self.assertEqual(feeds.feed_time({}, 5.0), 5.0)
        # a receiver clock a little ahead doesn't make its report count as newer than now
        self.now["rx"] = self.t + 2
        self.answers = {"rx": [self.rec("ahd333", 45.0, -122.0)], "pub": []}
        self.assertAlmostEqual(self.fetch()["ahd333"]["lon"], -122.0, places=6)

    def test_merge_setting(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml") as t:
            t.write(f'[source]\nurls = ["{RX}", "{PUB}"]\nmerge = true\n')
            t.flush()
            self.assertTrue(config.load(t.name)["source"]["merge"])
        self.assertFalse(config.DEFAULTS["source"]["merge"])
        self.assertRaises(ValueError, config.check, "source", {"merge": "yes"})


class FeedExtrasTest(unittest.TestCase):
    def test_extra_fields(self):
        raw = {"hex": "ac32f2", "flight": "SWA4083 ", "r": "N8851Q", "t": "B38M", "desc": "BOEING 737 MAX 8", "year": "2023",
               "ownOp": "SOUTHWEST AIRLINES CO", "alt_baro": 9000, "gs": 300, "lat": 45.6, "lon": -122.5, "baro_rate": -1200,
               "nav_altitude_mcp": 6016, "nav_modes": ["autopilot", "althold", "lnav"], "dbFlags": 8}
        a = feeds.normalise(raw)
        self.assertEqual((a["desc"], a["year"], a["target_alt"], a["modes"]), ("Boeing 737 MAX 8", 2023, 6016, ["autopilot", "althold", "lnav"]))
        self.assertTrue(a["private_owner"])                       # LADD flag
        self.assertEqual(feeds.tidy_type("CESSNA 172S SKYHAWK SP"), "Cessna 172S Skyhawk SP")
        self.assertEqual(feeds.tidy_type("Airbus A321neo"), "Airbus A321neo")

    def test_owner_hidden_for_privacy_aircraft(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        a = plane("a1", "N123AB", 1.0, typ="C172", desc="Cessna 172", owner_op="JOHN SMITH", private_owner=True, year=1978)
        t.update([a], "test")
        h = t.snapshot()["hero"]
        self.assertIsNone(h.get("owner"))
        self.assertEqual(h["type_name"], "Cessna 172")
        self.assertGreater(h["age"], 40)

    def test_registry_model_kept_beside_feed_description(self):
        # the feed names the type code; the registry's model tells an RV-7A from an RV-7
        class Registry(StubEnricher):
            def aircraft(self, hexid):
                return {"type_name": "Vans RV-7A", "owner": None, "photo": None, "reg": "N7RV"}
        t = Tracker(config.load(), Store(":memory:"), Registry())
        t.update([plane("a2", "N7RV", 1.0, typ="RV7", desc="Van's RV-7", category="A1")], "test")
        h = t.snapshot()["hero"]
        self.assertEqual((h["type_name"], h["model"]), ("Van's RV-7", "Vans RV-7A"))
        # the logbook keeps it, and lists today's types for the fleet lineup
        L = t.store.logbook(time.strftime("%Y-%m-%d"))
        self.assertEqual([(x["type"], x["model"], x["n"]) for x in L["types_today"]], [("RV7", "Vans RV-7A", 1)])
        self.assertEqual(L["types"][0]["model"], "Vans RV-7A")


class MilitaryTest(unittest.TestCase):
    def test_positionless_nearby_only(self):
        feed = {"ac": [
            {"hex": "ae0001", "t": "F15", "alt_baro": 15000, "rr_lat": 45.6, "rr_lon": -122.6, "seen": 2, "dbFlags": 1},
            {"hex": "ae0002", "t": "F15", "alt_baro": 15000, "rr_lat": 47.6, "rr_lon": -122.3, "seen": 2, "dbFlags": 1},   # Seattle
            {"hex": "ae0003", "t": "C17", "alt_baro": 30000, "lat": 45.6, "lon": -122.6, "seen": 1, "dbFlags": 1}]}      # has a position
        real = feeds.get_json
        feeds.get_json = lambda url, timeout: feed
        try:
            heard = feeds.military_unplaced()                          # one request, whatever the places
            out = feeds.heard_near(heard, {"lat": 45.59, "lon": -122.47}, 40)
            self.assertEqual([a["hex"] for a in feeds.heard_near(heard, {"lat": 47.6, "lon": -122.3}, 40)], ["ae0002"])
        finally:
            feeds.get_json = real
        self.assertEqual([(a["hex"], a["alt"], a["military"]) for a in out], [("ae0001", 15000, True)])


class DemoTest(unittest.TestCase):
    def test_demo_runs_end_to_end(self):
        sim = demo.Demo()
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=sim))
        home = config.DEFAULTS["home"]
        t.update(sim.fetch(home["lat"], home["lon"], 15), "demo")
        s = t.snapshot()
        self.assertGreaterEqual(len(s["aircraft"]), 3)
        json.dumps(s)


if __name__ == "__main__":
    unittest.main()
