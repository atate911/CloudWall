import time
import unittest
from pathlib import Path

from cloudwall.core import config, geo
from cloudwall.gather import demo, feeds
from cloudwall.gather.enrich import Enricher
from cloudwall.memory.store import Store
from cloudwall.picture.tracker import Tracker
from cloudwall.reference import placing

import support
import test_weather
from support import PUB, RX, StubEnricher, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class PlacesTest(unittest.TestCase):
    def load(self, toml):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as f:
            f.write(toml)
        self.addCleanup(Path(f.name).unlink)
        return config.load(f.name)

    def test_the_defaults_are_one_place_at_pdx(self):
        [p] = placing.places(config.load())
        self.assertEqual((p["place"], p["airport"]["icao"]), ({"id": "home", "name": "Home"}, "KPDX"))
        self.assertEqual([w["name"] for w in p["airport"]["runways"]], ["10R/28L", "10L/28R", "03/21"])
        # the fields around east Vancouver, nearest first, found in the bundled tables with their runways
        self.assertEqual([f["code"] for f in p["airport"]["others"]], ["1W1", "TTD", "VUO"])
        self.assertEqual({f["code"]: [w["name"] for w in f["runways"]] for f in p["airport"]["others"]},
                         {"1W1": ["07/25"], "TTD": ["07/25"], "VUO": ["08/26"]})

    def test_an_icao_code_is_enough(self):
        cfg = self.load('[home]\nlat = 37.66\nlon = -122.40\n[airport]\nicao = "ksfo"\n')
        ap = placing.places(cfg)[0]["airport"]
        self.assertEqual((ap["icao"], ap["iata"], ap["city"]), ("KSFO", "SFO", "San Francisco"))
        self.assertAlmostEqual(ap["lat"], 37.619, places=2)              # not PDX's position
        self.assertIn("OAK", [f["code"] for f in ap["others"]])
        self.assertNotIn("VUO", [f["code"] for f in ap["others"]])
        self.assertEqual(len(ap["runways"]), 4)

    def test_more_places(self):
        cfg = self.load('[[places]]\nname = "Cabin"\nlat = 44.06\nlon = -121.31\nairport = "KRDM"\n'
                        '[[places]]\nname = "cabin"\nlat = 37.66\nlon = -122.40\nairport = "KSFO"\nelevation_ft = 20\n'
                        '[kiosk]\nplace = "Cabin"\n')
        ps = placing.places(cfg)
        self.assertEqual([p["place"]["id"] for p in ps], ["home", "cabin", "cabin-2"])
        self.assertEqual(ps[1]["home"]["elevation_ft"], 3070)           # the airport's, when not given
        self.assertEqual(ps[2]["home"]["elevation_ft"], 20)
        self.assertEqual(ps[1]["airport"]["iata"], "RDM")
        self.assertEqual(placing.kiosk_place(cfg, ps), "cabin")
        self.assertEqual(ps[1]["kiosk"]["place"], "Cabin")              # shared settings carry over
        with self.assertRaisesRegex(ValueError, "needs lat and lon, or zip"):
            placing.places(dict(cfg, places=[{"name": "Boat", "lat": 1.0}]))
        with self.assertRaisesRegex(ValueError, "isn't in CloudWall's table"):
            placing.places(dict(cfg, places=[{"name": "Strip", "lat": 1.0, "lon": 2.0, "airport": "ZZZZ"}]))

    def test_a_field_with_no_iata_code_goes_by_its_local_one(self):
        cfg = self.load('[home]\nlat = 45.62\nlon = -122.65\n[airport]\nicao = "KVUO"\n')
        ap = placing.places(cfg)[0]["airport"]
        self.assertEqual((ap["icao"], ap["iata"], ap["name"]), ("KVUO", "VUO", "Pearson Field"))   # not a blank code
        self.assertNotIn("VUO", [f["code"] for f in ap["others"]])       # and it isn't one of its own neighbours

    def test_settings_are_checked_when_the_file_is_read(self):
        for toml, said in (('[tracking]\npoll_seconds = "5"\n', "poll_seconds must be a number"),
                           ('[kiosk]\ntracks = "off"\n', "tracks must be true or false"),
                           ('[extras]\nmilitary = 1\n', "military must be true or false"),
                           ('[tracking]\nradius_nm = 0\n', "more than 0"),
                           ('[server]\nport = 70000\n', "1 to 65535"),
                           ('[source]\nurls = "https://feed.example/{lat}"\n', "urls must be a list"),
                           ('places = "cabin"\n', r"\[\[places\]\] sections")):
            with self.assertRaisesRegex(ValueError, said):
                self.load(toml)
        # a word it can't use is left out, said, and the default used: a CloudWall that ran goes on running
        with self.assertLogs("cloudwall", "WARNING") as logs:
            cfg = self.load('[tracking]\nwhen_idle = "puase"\n')
        self.assertEqual(cfg["tracking"]["when_idle"], "pause")
        self.assertIn('must be "pause" or "log"', cfg["_problems"][0])
        self.assertIn("default", logs.output[0])
        self.assertEqual(self.load('[tracking]\nwhen_idle = "Log"\n')["tracking"]["when_idle"], "log")   # case doesn't matter
        # a name CloudWall doesn't know is said, not refused: the rest of the file still counts
        with self.assertLogs("cloudwall", "WARNING") as logs:
            cfg = self.load('port = 5050\n[tracking]\nradious_nm = 20\npoll_seconds = 2.5\n[sound]\non = true\n')
        self.assertEqual((cfg["tracking"]["radius_nm"], cfg["tracking"]["poll_seconds"]), (15, 2.5))
        self.assertNotIn("sound", cfg)
        self.assertEqual(len(logs.output), 3)
        import tempfile
        import tomllib
        from cloudwall.core import schema
        with tempfile.TemporaryDirectory() as d:                         # the starter file passes its own check,
            path, made = config.init(Path(d) / "config.toml")
            self.assertTrue(made)
            started = config.load(str(path))
            written = tomllib.loads(path.read_text())
        for section, values in written.items():                         # says only the defaults,
            for key, value in values.items():
                self.assertEqual(value, config.DEFAULTS[section][key], (section, key))
        for sec in schema.SECTIONS:                                      # and names every setting there is
            for st in sec.settings:
                self.assertRegex(schema.starter(), rf"(?m)^(# )?{st.key} = ", (sec.name, st.key))
        self.assertEqual(started["tracking"]["radius_nm"], 15)

    def test_zip_codes_and_the_closest_major_airport(self):
        from cloudwall.reference import airports
        cfg = self.load('[home]\nzip = "98660"\n[[places]]\nname = "Cabin"\nzip = "97702"\n'
                        '[[places]]\nname = "Allston"\nzip = 2134\n')       # a number: TOML drops the leading 0
        home, cabin, allston = placing.places(cfg)
        self.assertEqual((home["home"]["lat"], home["home"]["zip"], home["airport"]["icao"]), (45.6612, "98660", "KPDX"))
        self.assertEqual((cabin["airport"]["icao"], cabin["home"]["elevation_ft"]), ("KRDM", 3070))
        self.assertEqual((allston["home"]["zip"], allston["airport"]["icao"]), ("02134", "KBOS"))
        with self.assertRaisesRegex(ValueError, "isn't a US ZIP code CloudWall knows"):
            placing.places(dict(cfg, places=[{"zip": "00501"}]))
        # the closest major airport: a large one within 30 nm wins over a nearer smaller one
        self.assertEqual(airports.pick_airport(61.22, -149.86), "PANC")    # not Merrill Field, 1 nm away
        self.assertEqual(airports.pick_airport(47.98, -122.20), "KPAE")    # Everett: Paine Field, SEA is 32 nm
        self.assertEqual(airports.locate("98683-1234")["zip"], "98683")
        self.assertEqual(airports.locate("45.6387 -122.6615")["lon"], -122.6615)
        for junk in ("hello", "2024-01-15", "91, 10", "123.45"):
            self.assertIsNone(airports.locate(junk), junk)

    def test_runway_flow_at_any_airport(self):
        cfg = self.load('[home]\nlat = 37.66\nlon = -122.40\n[airport]\nicao = "KSFO"\n')
        t = Tracker(placing.places(cfg)[0], Store(":memory:"), StubEnricher())
        sfo = {"lat": 37.62, "lon": -122.37}
        t.update([plane("w1", "UAL1", -3.0, alt=2500, gs=150, track=298, home=sfo)], "test")
        self.assertEqual(t.flow, {"dir": "west", "label": "West flow", "runways": "28L / 28R"})
        t.update([plane("e1", "UAL2", 3.0, alt=2500, gs=150, track=118, home=sfo)], "test")
        self.assertEqual(t.flow["runways"], "10L / 10R")

    def test_runway_flow_at_a_high_airport(self):
        # Denver's runways are a mile up: 1,000 ft above them is 6,400 ft above the sea
        cfg = self.load('[home]\nlat = 39.80\nlon = -104.70\n[airport]\nicao = "KDEN"\n')
        t = Tracker(placing.places(cfg)[0], Store(":memory:"), StubEnricher())
        ap = t.cfg["airport"]
        self.assertGreater(ap["elevation_ft"], 5000)
        w = ap["runways"][0]
        (lat1, lon1), (lat2, lon2) = w["ends"]
        hdg = geo.bearing_deg(lat1, lon1, lat2, lon2)
        back = geo.destination(lat1, lon1, (hdg + 180) % 360, 3) if hasattr(geo, "destination") else None
        a = plane("d1", "UAL3", 0, alt=ap["elevation_ft"] + 1000, gs=150, track=hdg, home={"lat": ap["lat"], "lon": ap["lon"]})
        if back:
            a["lat"], a["lon"] = back
        t.update([a], "test")
        self.assertIsNotNone(t.flow)

    def test_the_map_is_served_around_every_place(self):
        from cloudwall.gather import tiles as T
        t = T.Tiles(config.load(), "/tmp/x")
        sfo = (12, 655, 1583)                                            # a zoom-12 tile over SFO
        self.assertFalse(t.allowed(*sfo))
        t.homes.append({"lat": 37.66, "lon": -122.40})
        self.assertTrue(t.allowed(*sfo))


class SharedTest(unittest.TestCase):
    """What isn't about one place is fetched once for all of them."""

    def test_one_fetch_serves_every_asker(self):
        from cloudwall.gather.shared import Shared
        shared, fetched = Shared(StubEnricher()), []
        fetch = lambda: fetched.append(1) or len(fetched)
        self.assertEqual([shared.once("list", 60, fetch) for _ in range(3)], [1, 1, 1])
        shared.kept["list"]["at"] -= 61                                 # a minute on: fetched afresh
        self.assertEqual(shared.once("list", 60, fetch), 2)
        with self.assertRaises(ZeroDivisionError):                      # a failure is the asker's, and isn't kept
            shared.once("other", 60, lambda: 1 / 0)
        self.assertEqual(shared.once("other", 60, lambda: "ok"), "ok")

    def test_two_places_one_list_and_one_weather_report(self):
        from cloudwall.gather import weather
        from cloudwall.gather.shared import Shared
        shared, asked = Shared(StubEnricher()), []
        ring = [[-122.5, 45.5], [-122.4, 45.5], [-122.4, 45.7], [-122.5, 45.7], [-122.5, 45.5]]
        shared.tfrs.fetch_json = lambda url, timeout: asked.append("list") or {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "TITLE": "Camas, WA"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
        shared.tfrs.fetch_text = lambda url, timeout: test_weather.TFRTest.XML
        home, cabin = {"lat": 45.59, "lon": -122.47}, {"lat": 44.06, "lon": -121.31}
        from unittest import mock
        with mock.patch("cloudwall.gather.tfr.time.time", return_value=1e9):  # as the other restriction tests: before test_weather.TFRTest.XML's dates, not after them
            self.assertEqual([len(shared.restrictions(p, 30)) for p in (home, cabin, home)], [1, 0, 1])
        real, weather.fetch_all = weather.fetch_all, lambda icao: asked.append(icao) or ({"station": icao}, {})
        try:
            for _ in range(2):                                          # two places with the same airport
                self.assertEqual(shared.weather("KPDX")[0], {"station": "KPDX"})
            shared.weather("KRDM")
        finally:
            weather.fetch_all = real
        self.assertEqual(asked, ["list", "KPDX", "KRDM"])

    def test_a_flight_two_places_can_see_is_looked_up_and_paid_for_once(self):
        from cloudwall.app.place import Place
        from cloudwall.gather.shared import Shared
        calls = []

        class Provider:
            name, label, mode, general_aviation, enabled = "fake", "Fake24", "always", False, True
            def available(self): return True
            def status(self): return {}
            def route(self, callsign): calls.append(callsign); return None
        cache = Store(":memory:")
        for kind, key in (("aircraft", "a1"), ("route", "ASA512"), ("photo", "a1||B738")):
            cache.cache_put(kind, key, None)                            # (no free lookups in the way)
        shared = Shared(Enricher(cache, live=Provider()))
        cfg = config.load()
        cfg["places"] = [{"name": "Next door", "lat": cfg["home"]["lat"] + 0.01, "lon": cfg["home"]["lon"]}]
        home, neighbour = [Place(pc, Store(":memory:"), demo.Demo(), shared) for pc in placing.places(cfg)]
        self.assertIs(home.tracker.enricher, neighbour.tracker.enricher)
        for place in (home, neighbour):
            place.tracker.update([plane("a1", "ASA512", 1.0)], "test")
        time.sleep(0.3)
        self.assertEqual(calls, ["ASA512"])
        self.assertTrue(cache.cache_get("live_route", "fake:ASA512", 3600)[0])          # kept in the one cache,
        self.assertFalse(home.store.cache_get("live_route", "fake:ASA512", 3600)[0])    # not with either logbook


class PlaceStateTest(unittest.TestCase):
    """A place gives a screen everything it draws; the tracker only tracks."""

    def test_a_screen_gets_the_board_with_the_places_own_weather_and_airspace(self):
        from cloudwall.app.place import Place
        [pc] = placing.places(config.load())
        place = Place(pc, Store(":memory:"), demo.Demo(), demo=True)
        self.assertEqual(place.state()["weather"], None)                 # nothing fetched yet: still a full answer
        place.start = lambda: None
        place.weather, place.weather_full = {"station": "KPDX"}, {"now": {"category": "VFR"}}
        place.tfrs, place.heard = [{"id": "6/1"}], [{"hex": "ae01"}]
        place.contrails = {"summary": "None today", "levels": [{"ft": 34000, "state": "persistent"}]}
        place.tracker.update([plane("a1", "ASA512", 1.0, alt=34000)], "test", contrails=place.contrails)
        s = place.state(pin="a1", range_nm=30)
        self.assertEqual((s["place"], s["hero"]["hex"], s["pinned"], s["weather"], s["tfrs"], s["heard"]),
                         ("home", "a1", "a1", {"station": "KPDX", "stale": True}, [{"id": "6/1"}], [{"hex": "ae01"}]))
        self.assertEqual(s["contrails"], {"summary": "None today"})      # the levels are the Weather tab's
        self.assertEqual(s["hero"]["contrail"], "persistent")            # each aircraft is marked from the forecast
        self.assertEqual(place.tracker.fetch_radius(), 30)               # the screen's radar range was noted
        self.assertIsNone(s["live_routes"])
        w = place.weather_report()
        self.assertEqual((w["now"], len(w["contrails"]["levels"]), w["tfrs"]), ({"category": "VFR"}, 1, [{"id": "6/1"}]))
        self.assertEqual(place.heatmap()["unit"], 100)
        self.assertEqual(place.logbook()["total"], 1)                    # and its flyover is in the place's logbook
        # the tracker knows none of it
        self.assertFalse({"weather", "tfrs", "heard", "contrails", "basemap", "charts", "logos"} & set(place.tracker.snapshot()))


class PlaceThreadsTest(unittest.TestCase):
    def place(self, source):
        from cloudwall.app.place import Place
        [pc] = placing.places(config.load())
        place = Place(pc, Store(":memory:"), source, demo=True)         # demo: no lookups, no weather
        place.tracker.enricher = StubEnricher()
        place.activity.sleep = place.stopped.wait = lambda seconds: None
        return place

    def test_a_loop_that_trips_is_started_again(self):
        place, runs = self.place(demo.Demo()), []

        def loop():
            runs.append(1)
            if len(runs) == 1:
                raise RuntimeError("nobody foresaw this")
            place.stopped.set()
        with self.assertLogs("cloudwall", "ERROR"):
            place._keep_going(loop)
        self.assertEqual(len(runs), 2)

    def test_a_fault_of_cloudwalls_own_isnt_blamed_on_the_feed(self):
        class Source:
            name = "test"

            def fetch(self, lat, lon, radius_nm):
                place.stopped.set()                                     # (one turn of the loop)
                return [plane("a1", "ASA1", 1.0)]
        place = self.place(Source())
        place.tracker.update = lambda raw, source, **how: 1 / 0
        with self.assertLogs("cloudwall", "ERROR") as logs:
            place._poll()
        self.assertIn("the board couldn't be worked out", logs.output[0])
        self.assertIn("ZeroDivisionError", logs.output[0])              # with where it happened
        self.assertIn("division by zero", place.tracker.status["error"])


class ActivityTest(unittest.TestCase):
    def test_idle_and_wake(self):
        import threading
        from cloudwall.core.activity import Activity
        a = Activity(idle_after=1)
        self.assertTrue(a.idle())                         # nobody has looked yet
        woke = []
        t = threading.Thread(target=lambda: (a.sleep(5), woke.append(time.time())))
        start = time.time(); t.start()
        time.sleep(0.1); a.touch(); t.join(2)
        self.assertTrue(woke and woke[0] - start < 1)     # a screen appearing wakes the poller at once
        self.assertFalse(a.idle())

    def test_no_paid_lookups_while_idle(self):
        calls = []

        class Provider:
            name, label, mode, general_aviation, enabled = "fake", "Fake", "always", False, True
            def available(self): return True
            def status(self): return {}
            def route(self, cs): calls.append(cs); return None

        store = Store(":memory:")
        store.cache_put("aircraft", "a1", None)
        store.cache_put("route", "ASA512", None)          # no free-database lookup in the way
        t = Tracker(config.load(), store, Enricher(store, live=Provider()))
        t.update([plane("a1", "ASA512", 1.0)], "test", idle=True)      # no screen open
        time.sleep(0.1)
        self.assertEqual(calls, [])
        t.update([plane("a1", "ASA512", 1.0)], "test")
        time.sleep(0.2)
        self.assertEqual(calls, ["ASA512"])


class KioskQuietTest(unittest.TestCase):
    def test_density_is_checked(self):
        self.assertTrue(config.check("kiosk", {"density": "detailed"}))
        given = {"density": "Detailed"}
        self.assertTrue(config.check("kiosk", given))
        self.assertEqual(given["density"], "detailed")                  # as the page compares it
        with self.assertRaises(ValueError):
            config.check("kiosk", {"density": "detail"})

    def test_quiet_hours_are_checked(self):
        for ok in ("", "23:00-06:30", "0:00 - 7:15", "22:30-23:45"):
            self.assertTrue(config.check("kiosk", {"quiet": ok}), ok)
        for bad in ("11pm-6am", "23:00", "25:00-06:00", "23:00-6:60"):
            with self.assertRaises(ValueError, msg=bad):
                config.check("kiosk", {"quiet": bad})
        self.assertEqual(config.DEFAULTS["kiosk"]["quiet"], "")


class HousekeepingTest(unittest.TestCase):
    def test_cached_values_past_their_use_are_cleared(self):
        s = Store(":memory:")
        s.cache_put("heat", "2026-11-01", {"1,1": 3})
        s.cache_put("route", "ASA1", {"flight": "AS1"})
        s.cache_put("other", "k", 1)
        with s.lock, s.db:
            s.db.execute("UPDATE cache SET ts = ts - 10 * 86400")       # ten days on
        s.cache_get("heat", "today", 2 * 86400)                         # what the tracker and the lookups ask for
        s.cache_get("route", "ASA1", 30 * 86400)
        self.assertEqual(s.prune(), 1)                                  # the old heatmap goes
        # the route is still wanted, and a kind nobody has read since the start is left alone
        self.assertEqual([r["kind"] for r in s.query("SELECT kind FROM cache ORDER BY kind")], ["other", "route"])
        s.claim({"lat": 45.6, "lon": -122.5})                           # whose logbook it is: never cleared
        with s.lock, s.db:
            s.db.execute("UPDATE cache SET ts = 0")
        self.assertEqual(s.cache_get("place", "home", float("inf"))[1], {"lat": 45.6, "lon": -122.5})
        s.prune()
        self.assertTrue(s.cache_get("place", "home", float("inf"))[0])

    def test_lookups_in_memory_are_bounded(self):
        from cloudwall.gather import enrich
        e = Enricher(Store(":memory:"), demo=object())                  # (demo: no worker threads)
        with e.lock:
            for i in range(enrich.MEM_MAX + 10):
                e._keep(("aircraft", str(i)), None, at=i)
        self.assertLessEqual(len(e.mem), enrich.MEM_MAX)
        self.assertIn(("aircraft", str(enrich.MEM_MAX + 9)), e.mem)     # the newest stay
        self.assertNotIn(("aircraft", "0"), e.mem)


class FaultToleranceTest(unittest.TestCase):
    """What the review of the whole system found, held to: a fault in one part is reported and
    the rest carries on, nothing grows without bound, and a mistake in the config is named."""

    def test_a_logbook_that_cant_be_written_doesnt_stop_the_board(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())

        def full(**f):
            raise OSError(28, "No space left on device")
        store.add_sighting = full
        with self.assertLogs("cloudwall", "ERROR") as logs:
            t.update([plane("a1", "ASA512", 1.0)], "test")
        s = t.snapshot()
        self.assertTrue(s["status"]["ok"])
        self.assertEqual(s["hero"]["hex"], "a1")
        self.assertIn("No space left", s["status"]["storage"])          # and says what it couldn't keep
        self.assertIn("carries on", logs.output[0])
        t.update([plane("a1", "ASA512", 0.9)], "test")                  # said once, not on every update
        del store.add_sighting
        t.update([plane("b2", "UAL1", 0.8)], "test")
        self.assertIsNone(t.snapshot()["status"]["storage"])            # and clears when it works again

    def test_todays_count_survives_a_restart(self):
        store = Store(":memory:")
        Tracker(config.load(), store, StubEnricher()).update([plane("a1", "ASA512", 1.0)], "test")
        self.assertEqual(Tracker(config.load(), store, StubEnricher()).snapshot()["today"], 1)

    def test_followed_flights_are_capped(self):
        from cloudwall.picture import tracker
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        for i in range(tracker.MAX_PINS + 20):
            t.want_pin(f"{i:06x}")
        self.assertEqual(len(t.pins), tracker.MAX_PINS)
        t.want_pin("000000")                                            # one already followed still counts
        self.assertIn("000000", t.pins)

    def test_a_hanging_feed_is_skipped(self):
        import threading
        release = threading.Event()
        real = feeds.get_json

        def fake(url, timeout=0):
            if url == RX:
                release.wait(5)                                         # the receiver hangs
                return {"now": 0, "aircraft": []}
            return {"now": time.time() * 1000, "ac": [{"hex": "abc123", "lat": 45.6, "lon": -122.6,
                                                       "alt_baro": 9000, "seen_pos": 0}]}
        feeds.get_json = fake
        m = feeds.Merged([RX, PUB])
        old, feeds.MERGE_WAIT_S = feeds.MERGE_WAIT_S, 0.2
        try:
            with self.assertLogs("cloudwall.feeds", "WARNING"):
                got = m.fetch(45.6, -122.6, 15)
            self.assertEqual([a["hex"] for a in got], ["abc123"])       # the public feed's answer, on time
        finally:
            feeds.MERGE_WAIT_S, feeds.get_json = old, real
            release.set()
            m.close()

    def test_tile_cache_is_kept_within_bounds(self):
        import os
        import tempfile
        from cloudwall.gather import tiles
        with tempfile.TemporaryDirectory() as d:
            now = time.time()
            for i in range(10):
                p = Path(d, "layer", "12", str(i), "1.tile")
                p.parent.mkdir(parents=True)
                p.write_bytes(b"x" * 1000)
                os.utime(p, (now - i * 3600, now - i * 3600))           # tile 9 is the oldest
            stale = Path(d, "layer", "12", "old.tile")
            stale.write_bytes(b"x")
            os.utime(stale, (now - 3 * tiles.MAX_AGE,) * 2)
            Path(d, "layer", "half.tmp").write_bytes(b"x")
            removed, kept = tiles.sweep(d, 5000, now)
            self.assertLessEqual(kept, 4500)
            left = sorted(int(p.parent.name) for p in Path(d).rglob("*.tile"))
            self.assertEqual(left, list(range(len(left))))              # the newest are the ones kept
            self.assertFalse(stale.exists() or Path(d, "layer", "half.tmp").exists())
            self.assertFalse(Path(d, "layer", "12", "9").exists())      # emptied folders go too

    def test_restrictions_the_faa_dropped_are_forgotten(self):
        from cloudwall.gather.tfr import TFRs
        feature = {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F"}}
        t = TFRs(fetch_json=lambda url, timeout=0: {"features": [feature]})
        t.details = {"6/1111": ("x", {}), "6/2222": ("y", {})}
        t.fetch()
        self.assertEqual(list(t.details), ["6/1111"])

    def test_a_removed_place_lets_go_of_its_file(self):
        from cloudwall.app.place import Place
        [pc] = placing.places(config.load())
        store = Store(":memory:")
        place = Place(pc, store, demo.Demo(), demo=True)
        closed = []
        store.close = lambda: closed.append(True)
        place.retire()
        for _ in range(50):
            if closed:
                break
            time.sleep(0.05)
        self.assertEqual(closed, [True])


if __name__ == "__main__":
    unittest.main()
