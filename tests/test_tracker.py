import json
import math
import time
import unittest
from pathlib import Path

from cloudwall.core import config, geo
from cloudwall.gather import demo, feeds
from cloudwall.gather.enrich import Enricher
from cloudwall.memory.logbook import ordinal
from cloudwall.memory.store import Store
from cloudwall.memory.tracks import Tracks
from cloudwall.picture.tracker import Tracker

import support
from support import AUS, PDX, SFO, StubEnricher, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.enricher = StubEnricher()
        self.t = Tracker(config.load(), self.store, self.enricher)

    def test_hero_logging_and_badges(self):
        self.t.update([plane("a1", "ASA512", 1.0), plane("a2", "UAL99", 9.0)], "test")
        s = self.t.snapshot()
        self.assertEqual(s["hero"]["hex"], "a1")
        self.assertEqual(s["hero"]["badges"], ["NEW TYPE", "NEW AIRLINE"])
        self.assertEqual(s["today"], 1)
        # same pass polled again: not logged twice, closest distance tracked
        self.t.update([plane("a1", "ASA512", 0.4)], "test")
        self.assertEqual(self.store.count("1"), 1)
        self.assertAlmostEqual(self.store.query("SELECT min_dist_nm FROM sightings")[0]["min_dist_nm"], 0.4, 1)
        # the same airframe returning an hour later is a repeat visitor, not a new type
        self.t.logbook.active.clear()
        with self.store.db:
            self.store.db.execute("UPDATE sightings SET ts = ts - 3600")
        self.t.update([plane("a1", "ASA777", 1.0)], "test")
        self.assertEqual(self.t.snapshot()["hero"]["badges"], ["2nd VISIT"])

    def test_a_flyover_is_logged_where_it_was_closest(self):
        home = config.DEFAULTS["home"]
        self.t.update([plane("a1", "ASA512", 1.0)], "test")            # a mile north, heading 280 and descending
        self.t.update([plane("a1", "ASA512", 0.4, track=275, vrate=-900, gs=165)], "test")      # its closest
        self.t.update([plane("a1", "ASA512", 0.9, track=260, vrate=-600)], "test")              # and going away
        [row] = self.store.query("SELECT min_dist_nm, lat, lon, track, vrate, gs FROM sightings")
        self.assertEqual((row["min_dist_nm"], row["track"], row["vrate"], row["gs"]), (0.4, 275, -900, 165))
        self.assertAlmostEqual(row["lat"], home["lat"] + 0.4 / 60, places=4)
        self.assertAlmostEqual(row["lon"], home["lon"], places=4)
        # and the Logbook tab's rows carry it, for whatever is drawn from it one day
        self.assertEqual(self.store.logbook(time.strftime("%Y-%m-%d"))["recent"][0]["track"], 275)

    def test_an_older_logbook_gains_the_new_columns(self):
        import sqlite3
        import tempfile
        path = str(Path(tempfile.mkdtemp()) / "old.db")
        db = sqlite3.connect(path)                                      # as the first release made it
        db.executescript("""CREATE TABLE sightings(id INTEGER PRIMARY KEY, ts REAL, day TEXT, hex TEXT, callsign TEXT,
            flight TEXT, reg TEXT, type TEXT, type_name TEXT, airline_icao TEXT, airline TEXT, origin TEXT, dest TEXT,
            origin_nm REAL, min_dist_nm REAL, alt_ft INTEGER, gs REAL, badges TEXT);
            INSERT INTO sightings(ts, day, hex, min_dist_nm, alt_ft, badges) VALUES(1, '2026-01-01', 'a1', 0.5, 3000, '[]');""")
        db.commit()
        db.close()
        store = Store(path)
        self.addCleanup(store.close)
        [old] = store.query("SELECT * FROM sightings")
        self.assertEqual((old["min_dist_nm"], old["lat"], old["track"], old["photo_by"]), (0.5, None, None, None))
        Tracker(config.load(), store, StubEnricher()).update([plane("a2", "ASA512", 1.0)], "test")
        self.assertEqual(store.query("SELECT track FROM sightings WHERE hex='a2'")[0]["track"], 280)

    def test_restart_does_not_double_count(self):
        self.t.update([plane("a1", "ASA512", 1.0)], "test")
        restarted = Tracker(config.load(), self.store, self.enricher)     # same logbook, fresh memory
        restarted.update([plane("a1", "ASA512", 0.6)], "test")
        self.assertEqual(self.store.count("1"), 1)
        self.assertEqual(restarted.snapshot()["hero"]["badges"], ["NEW TYPE", "NEW AIRLINE"])
        self.assertAlmostEqual(self.store.query("SELECT min_dist_nm FROM sightings")[0]["min_dist_nm"], 0.6, 1)

    def test_no_hero_when_nothing_overhead(self):
        self.t.update([plane("a2", "UAL99", 9.0, track=180)], "test")   # inbound from the north
        s = self.t.snapshot()
        self.assertIsNone(s["hero"])
        self.assertEqual(s["next"]["hex"], "a2")
        self.t.update([plane("g1", "ASA1", 0.1, alt=0, on_ground=True)], "test")
        self.assertIsNone(self.t.snapshot()["hero"])

    def test_taxiing_aircraft_is_not_overhead(self):
        # what the feed reported for a Cessna taxiing near the house: -100 ft at 13 kt
        taxi = plane("t1", "N733NV", 1.2, alt=-100, typ="C172", gs=13, category="A1")
        heli = plane("h1", "LIFE3", 1.0, alt=400, typ="EC35", gs=25, category="A7")
        self.t.update([taxi, heli], "test")
        s = self.t.snapshot()
        ac = {a["hex"]: a for a in s["aircraft"]}
        self.assertTrue(ac["t1"]["on_ground"])
        self.assertFalse(ac["h1"]["on_ground"])                 # slow, low helicopters still fly
        self.assertEqual(s["hero"]["hex"], "h1")
        self.assertEqual(self.store.count("hex='t1'"), 0)       # and the taxiing plane isn't logged

    def test_low_on_the_horizon_is_not_overhead(self):
        self.t.update([plane("a1", "ASA1", 3.4, alt=300)], "test")   # within range but ~1 degree up
        self.assertIsNone(self.t.snapshot()["hero"])

    def test_hysteresis_and_pin(self):
        self.t.update([plane("a1", "ASA1", 1.0), plane("a2", "ASA2", -1.2)], "test")
        self.assertEqual(self.t.snapshot()["hero"]["hex"], "a1")
        self.t.update([plane("a1", "ASA1", 1.0), plane("a2", "ASA2", -0.9)], "test")
        self.assertEqual(self.t.snapshot()["hero"]["hex"], "a1")     # slightly better: no flip
        self.t.want_pin("a2")                                         # one screen taps a2
        self.t.update([plane("a1", "ASA1", 1.0), plane("a2", "ASA2", -3.0)], "test")
        s = self.t.snapshot("a2")
        self.assertEqual((s["hero"]["hex"], s["pinned"], s["overhead"]), ("a2", "a2", "a1"))
        s = self.t.snapshot()                                         # every other screen: what's overhead
        self.assertEqual((s["hero"]["hex"], s["pinned"], s["overhead"]), ("a1", None, "a1"))

    def test_screens_follow_flights_of_their_own(self):
        # twelve aircraft in range; a screen follows the farthest, past the ten that are looked up anyway
        planes = lambda: [plane(f"b{i}", f"ASA{i}", 2.0 + i) for i in range(12)]
        self.t.update(planes(), "test")
        self.assertNotIn("seats", self.t.snapshot()["aircraft"][-1])  # not looked up
        self.t.want_pin("b11")
        self.t.update(planes(), "test")
        s = self.t.snapshot("b11")
        self.assertEqual(s["hero"]["hex"], "b11")
        self.assertIn("seats", s["hero"])                             # now it is: its card is complete
        self.t.pins["b11"] -= 60                                      # the screen stopped asking
        self.t.update(planes(), "test")
        self.assertEqual(self.t.pins, {})
        self.assertIsNone(self.t.snapshot("gone")["pinned"])          # a flight that left: no card
        self.t.want_pin("<script>")                                   # not an aircraft address: ignored
        self.assertEqual(self.t.pins, {})

    def test_route_backfill_and_implausible_route(self):
        apt = lambda code, ll: {"iata": code, "city": code, "name": code, "lat": ll[0], "lon": ll[1]}
        self.t.update([plane("a1", "ASA512", 1.0), plane("a3", "ASA9", 2.0)], "test")
        self.enricher.routes["ASA512"] = {"flight": "AS512", "airline": "Alaska Airlines",
                                          "origin": apt("SFO", SFO), "dest": apt("PDX", PDX)}
        self.enricher.routes["ASA9"] = {"flight": "AS9", "airline": "Alaska Airlines",
                                        "origin": apt("SFO", SFO), "dest": apt("AUS", AUS)}
        self.t.update([plane("a1", "ASA512", 0.9), plane("a3", "ASA9", 2.0)], "test")
        # low over the local airport on a route that merely passes nearby: not believable
        self.enricher.routes["ASA637"] = {"flight": "AS637", "airline": "Alaska Airlines",
                                          "origin": apt("SFO", SFO), "dest": apt("SEA", (47.449, -122.309))}
        self.t.update([plane("a1", "ASA512", 0.9), plane("a3", "ASA9", 2.0),
                       plane("a4", "ASA637", 6.0, alt=1050)], "test")
        ac = {a["hex"]: a for a in self.t.snapshot()["aircraft"]}
        self.assertFalse(ac["a4"]["route"]["plausible"])
        self.assertEqual(ac["a1"]["local"], "arriving")
        self.assertFalse(ac["a3"]["route"]["plausible"])
        rows = {r["hex"]: r for r in self.store.query("SELECT * FROM sightings")}
        self.assertEqual((rows["a1"]["origin"], rows["a1"]["dest"]), ("SFO", "PDX"))
        self.assertIsNone(rows["a3"]["origin"])
        self.assertEqual(self.store.logbook(time.strftime("%Y-%m-%d"))["records_today"]["furthest_origin"]["origin"], "SFO")

    def test_infers_arrival_when_route_is_wrong(self):
        ap = self.t.cfg["airport"]                                       # PDX, as resolved for the default home
        wrong = {"flight": "AS1363", "airline": "Alaska Airlines",
                 "origin": {"iata": "LAX", "city": "Los Angeles", "lat": 33.94, "lon": -118.41},
                 "dest": {"iata": "PVR", "city": "Puerto Vallarta", "lat": 20.68, "lon": -105.25}}
        self.enricher.routes["ASA1363"] = wrong
        # 5 nm west of PDX, 1,550 ft, descending, flying east toward the runways
        arr = plane("a1", "ASA1363", 0, alt=1550, track=110, vrate=-896)
        arr["lat"], arr["lon"] = ap["lat"] + 0.01, ap["lon"] - 0.12
        dep = plane("a2", "ASA2", 0, alt=2500, track=110, vrate=2000)
        dep["lat"], dep["lon"] = ap["lat"] - 0.02, ap["lon"] + 0.12          # east of PDX, climbing away
        over = plane("a3", "UAL9", 0, alt=3000, track=90, vrate=-800)
        over["lat"], over["lon"] = ap["lat"] - 0.15, ap["lon"] + 0.05         # descending, not toward PDX
        self.t.update([arr, dep, over], "test")
        ac = {a["hex"]: a for a in self.t.snapshot()["aircraft"]}
        self.assertFalse(ac["a1"]["route"]["plausible"])
        self.assertEqual((ac["a1"]["local"], ac["a1"]["local_inferred"]), ("arriving", True))
        self.assertEqual(ac["a2"]["local"], "departing")
        self.assertIsNone(ac["a3"]["local"])

    def test_flow_and_emergency(self):
        ap = self.t.cfg["airport"]                                       # PDX, as resolved for the default home
        a = plane("a1", "ASA1", 0, alt=1500, squawk="7700")
        a["lat"], a["lon"] = ap["lat"], ap["lon"] + 0.1
        self.t.update([a], "test")
        s = self.t.snapshot()
        self.assertEqual(s["flow"]["dir"], "west")
        self.assertEqual(s["aircraft"][0]["emergency"], "EMERGENCY 7700")

    def test_traffic_picture(self):
        """Each aircraft marked arriving, departing, local or passing over; arrivals in landing order, with the gap ahead."""
        ap = self.t.cfg["airport"]                                       # PDX, landing west on 28L / 28R
        def east_of_pdx(p, nm, north=0.0):
            p["lat"], p["lon"] = ap["lat"] + north / 60, ap["lon"] + nm / (60 * math.cos(math.radians(ap["lat"])))
            return p
        near = east_of_pdx(plane("a1", "ASA1", 0, alt=1500, track=280, vrate=-700, gs=150), 4)
        far = east_of_pdx(plane("a2", "ASA2", 0, alt=3500, track=280, vrate=-700, gs=170), 10)
        dep = east_of_pdx(plane("a3", "ASA3", 0, alt=2500, track=280, vrate=2000), -4)
        high = east_of_pdx(plane("a4", "ASA4", 0, alt=36000, track=165, vrate=0, gs=450), 3, north=6)
        cub = east_of_pdx(plane("a5", "N123", 0, alt=1800, typ="C172", category="A1", squawk="1200",
                                track=40, vrate=0, gs=90), 2, north=8)
        balloon = east_of_pdx(plane("a6", "N9B", 0, alt=1200, typ="BALL", category="B2", squawk="1200",
                                    track=60, vrate=0, gs=6), 12, north=1)
        self.t.update([far, near, dep, high, cub, balloon], "test")
        self.assertEqual(self.t.flow["runways"], "28L / 28R")
        ac = {a["hex"]: a for a in self.t.snapshot()["aircraft"]}
        self.assertEqual({h: a["activity"] for h, a in ac.items()},
                         {"a1": "arr", "a2": "arr", "a3": "dep", "a4": "pass", "a5": "loc", "a6": "loc"})
        self.assertEqual((ac["a1"]["seq"], ac["a2"]["seq"]), (1, 2))
        self.assertIn(ac["a1"]["rwy"], ("28L", "28R"))
        self.assertIsNone(ac["a1"]["gap_s"])
        self.assertEqual(ac["a2"]["gap_s"], ac["a2"]["lands_s"] - ac["a1"]["lands_s"])
        self.assertTrue(60 < ac["a1"]["lands_s"] < 150, ac["a1"]["lands_s"])      # 4 nm at about 130 kt
        self.assertEqual(ac["a6"].get("notable"), "unusual")
        self.assertNotIn("notable", ac["a1"])
        # every aircraft carries a short track, the newest point where it is now
        self.t.update([dict(far, lat=far["lat"] + 0.001), dict(near), dep, high, cub, balloon], "test")
        tail = {a["hex"]: a for a in self.t.snapshot()["aircraft"]}["a2"]["tail"]
        self.assertEqual(len(tail), 2)
        self.assertAlmostEqual(tail[-1][0], round(far["lat"] + 0.001, 4))

    def test_ordinal(self):
        self.assertEqual([ordinal(n) for n in (1, 2, 3, 4, 11, 12, 21)],
                         ["1st", "2nd", "3rd", "4th", "11th", "12th", "21st"])


class TracksTest(unittest.TestCase):
    def test_heat_lines_are_simplified_and_split_at_gaps(self):
        from cloudwall.memory.tracks import _simplified
        bent = [(0, 0), (1, 0.001), (2, 0), (2, 1), (2, 2)]
        self.assertEqual(_simplified(bent), [(0, 0), (2, 0), (2, 2)])   # the corner kept, the wobble and the straights dropped
        t = Tracks(15, Store(":memory:"))
        pos = lambda north: [{"hex": "a1", "lat": 45, "lon": -122, "dist": north, "brg": 0}]
        t.remember(pos(5.0), 1000); t.remember(pos(4.0), 1005)
        t.remember(pos(3.0), 1200)                                      # the feed lost it for over a minute
        t.remember(pos(2.0), 1205)
        self.assertEqual(t.heatmap()["paths"], [[0, 500, 0, 400], [0, 300, 0, 200]])   # two lines, not one across the gap
        t.remember([], 1210)                                            # gone: its line is finished, and kept
        self.assertEqual(len(t.heatmap()["paths"]), 2)
        self.assertEqual(t.heatmap()["aircraft"], 1)

    def test_trails_heatmap_and_photo(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())
        for north in (3.0, 2.0, 1.0):
            t.update([plane("a1", "ASA1", north), plane("g1", "ASA2", 0.5, alt=0, on_ground=True)], "test")
        trail = list(t.tracks.trails["a1"])
        self.assertEqual(len(trail), 3)
        self.assertGreater(trail[0][0], trail[-1][0])                 # moving south toward home
        heat = t.heatmap()
        self.assertEqual(heat["aircraft"], 1)                         # the parked aircraft isn't counted
        self.assertEqual(heat["paths"], [[0, 300, 0, 100]])           # one line, due north, 3 nm to 1 nm out: straight, so two points
        for _ in range(3):
            t.update([plane("a1", "ASA1", 1.0)], "test")              # hovering where it is: nothing more to draw
        self.assertEqual(t.heatmap()["paths"], [[0, 300, 0, 100]])
        t.update([], "test")
        self.assertEqual(t.tracks.trails, {})                                # gone from range: trail dropped
        self.assertIn("photo", {r["name"] for r in store.db.execute("PRAGMA table_info(sightings)")})


class RadarRangeTest(unittest.TestCase):
    def test_longer_range_is_for_the_radar_alone(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())
        self.assertEqual(t.ranges(), [15, 20, 30])
        self.assertEqual(t.fetch_radius(), 15)                        # nobody asked for more
        t.want_range(45)                                              # not an offered range: ignored
        self.assertEqual(t.fetch_radius(), 15)
        t.want_range(30)
        self.assertEqual(t.fetch_radius(), 30)
        for north in (25.0, 24.0):
            t.update([plane("a1", "ASA1", 2.0), plane("f1", "FAR1", north)], "test")
        s = t.snapshot()
        self.assertEqual([a["hex"] for a in s["aircraft"]], ["a1"])  # board, card and logbook: 15 nm only
        self.assertEqual([a["hex"] for a in s["beyond"]], ["f1"])
        self.assertEqual(len(t.tracks.trails["f1"]), 2)                      # its trail is kept, should it come in range
        self.assertNotIn("trail", s["beyond"][0])                     # but only the selected aircraft's is sent
        self.assertEqual(t.heatmap()["aircraft"], 1)                  # but it stays off the heatmap
        t.range_wanted[30] -= 120                                     # the screen stopped asking
        self.assertEqual(t.fetch_radius(), 15)

    def test_a_square_display_reaches_into_its_corners(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        t.want_range(15, square=True)                                 # the ATC style at 15 nm
        self.assertEqual(t.fetch_radius(), 21.2)
        t.want_range(30)
        self.assertEqual(t.fetch_radius(), 30)
        t.want_range(30, square=True)
        self.assertEqual(t.fetch_radius(), 42.4)

    def test_the_map_view_reaches_into_its_corners(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        t.want_range(15, reach=2.02)                                  # a tall panel: corners twice as far
        self.assertEqual(t.fetch_radius(), 30.3)
        t.want_range(20, reach=9)                                     # never more than three times
        self.assertEqual(t.fetch_radius(), 60)
        t.range_wanted.clear()
        t.want_range(15, reach=0.2)                                   # nor less than the range itself
        self.assertEqual(t.fetch_radius(), 15)

    def test_data_blocks_get_wake_categories_and_history_spacing(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        t.update([dict(plane("a1", "ASA1", 2.0), type="B738"), dict(plane("c1", "N123", 3.0), type="C172"),
                  dict(plane("x1", "XXX1", 4.0), type="ZZZZ")], "test")
        cwt = {a["hex"]: a["cwt"] for a in t.snapshot()["aircraft"]}
        self.assertEqual(cwt, {"a1": "F", "c1": "I", "x1": None})       # a type it doesn't know: blank
        self.assertEqual(t.snapshot()["trail_s"], t.cfg["tracking"]["poll_seconds"])   # one update: the poll interval
        t.updated_at -= 4.0                                           # updates 4 s apart
        t.update([plane("a1", "ASA1", 1.9)], "test")
        self.assertAlmostEqual(t.snapshot()["trail_s"], 4.0, delta=0.1)

    def test_far_targets_cant_be_pinned_and_go_stale(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        t.want_range(30)
        t.update([plane("a1", "ASA1", 2.0), plane("f1", "FAR1", 25.0)], "test")
        self.assertIsNone(t.snapshot("f1")["pinned"])                 # tapped on a 30 nm radar
        self.assertEqual(t.snapshot("a1")["hero"]["hex"], "a1")
        t.update([plane("f1", "FAR1", 24.0)], "test")                 # only far traffic left
        t.status["updated"] -= 120                                    # then the feed goes quiet
        self.assertEqual(t.snapshot()["beyond"], [])

    def test_demo_fills_a_longer_range(self):
        sim = demo.Demo()
        home = config.DEFAULTS["home"]
        sim.fetch(home["lat"], home["lon"], 30)
        sim.next_spawn = 0
        sim.fetch(home["lat"], home["lon"], 30)
        self.assertLessEqual(min(a["along"] for a in sim.active), -28)   # new arrivals start near 30 nm


class EmergencyTest(unittest.TestCase):
    def test_needs_two_updates_and_clears(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())
        sq = lambda code: [plane("e1", "ASA1", 6, squawk=code), plane("e2", "ASA2", 7)]
        t.update(sq("7700"), "test")
        self.assertEqual(t.snapshot()["emergency"], [])             # one report could be a glitch
        t.update(sq("7700"), "test")
        em = t.snapshot()["emergency"]
        self.assertEqual([(a["hex"], a["emergency_code"], a["emergency_title"]) for a in em], [("e1", "7700", "Emergency")])
        t.update(sq("1234"), "test")
        self.assertEqual(t.snapshot()["emergency"], [])

    def test_transponder_status_counts(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        for _ in range(2):
            t.update([plane("e1", "N123", 6, emergency_status="nordo")], "test")
        self.assertEqual(t.snapshot()["emergency"][0]["emergency_code"], "7600")
        self.assertEqual(t.snapshot()["aircraft"][0]["spc"], "7600")    # on the record, for the radar's data block
        t.update([plane("a1", "ASA1", 6)], "test")
        self.assertNotIn("spc", t.snapshot()["aircraft"][0])


class PathTest(unittest.TestCase):
    def test_the_whole_path_is_kept_compactly_with_its_altitude(self):
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        for i in range(40):                                           # 40 updates, 0.05 nm apart
            t.update([plane("a1", "ASA1", 10 - i * 0.05, alt=8000 - i * 50)], "test")
        s = t.snapshot("a1")                                          # tapped on the radar
        a = s["aircraft"][0]
        self.assertNotIn("path", a)                                   # only the selected aircraft sends its track
        self.assertNotIn("trail", a)
        self.assertEqual(s["hero"]["hex"], "a1")
        self.assertEqual(len(s["hero"]["trail"]), 30)                 # its recent positions, for the history dots
        path = [list(q) for q in s["hero"]["path"]]
        self.assertEqual(path[0], [round(t.home["lat"] + 10 / 60, 4), round(t.home["lon"], 4), 80])
        self.assertTrue(8 <= len(path) <= 14)                         # a point every 0.15 nm or 300 ft
        self.assertIn(path[-1][2], range(60, 63))                     # it followed the descent to about 6,050 ft
        t.update([plane("a1", "ASA1", 8.0, alt=None)], "test")        # no altitude: the last one carries on
        self.assertEqual(t.snapshot("a1")["hero"]["path"][-1][2], path[-1][2])
        t.update([plane("a1", "ASA1", 7.5), plane("b1", "ASA2", 9.0)], "test")
        s = t.snapshot("b1")                                          # tapped: its whole path, from when it appeared
        self.assertEqual(len(s["hero"]["path"]), 1)
        self.assertEqual(len(s["hero"]["trail"]), 1)
        self.assertEqual([a.get("trail") for a in s["aircraft"]], [None, None])   # no aircraft but the selected one carries a trail
        self.assertGreater(len(t.tracks.paths["a1"]), len(path))             # a1's is still kept, and growing
        t.update([plane("b1", "ASA2", 5.0)], "test")                  # a1 has gone: its path with it
        self.assertNotIn("a1", t.tracks.paths)


class SmallFieldTest(unittest.TestCase):
    def test_light_aircraft_at_pearson(self):
        from cloudwall.reference import airports
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        vuo = airports.lookup("VUO")
        a = plane("g1", "N733NV", 0, alt=900, typ="C172", category="A1", vrate=-500, track=260)
        a.update(lat=vuo["lat"], lon=vuo["lon"] + 0.02)
        self.assertEqual(t.details.infer_local(a), "arriving")
        self.assertEqual(a["local_field"]["code"], "VUO")
        # an airliner low over the same spot is still PDX traffic, not Pearson's
        b = dict(a, callsign="ASA512", category="A3")
        b.pop("local_field")
        t.details.infer_local(b)
        self.assertNotIn("local_field", b)

    def test_light_aircraft_at_grove_field(self):
        from cloudwall.reference import airports
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        grove = airports.lookup("1W1")                                   # Camas, 429 ft
        a = plane("g2", "N12345", 0, alt=1300, typ="C172", category="A1", vrate=-400, track=250)
        a.update(lat=grove["lat"], lon=grove["lon"] + 0.015)
        self.assertEqual(t.details.infer_local(a), "arriving")
        self.assertEqual(a["local_field"], {"code": "1W1", "name": "Grove Field", "city": "Camas"})


class FollowedThroughGapsTest(unittest.TestCase):
    def setUp(self):
        self.t = Tracker(config.load(), Store(":memory:"), StubEnricher())

    def test_a_followed_flight_is_carried_over_a_gap_in_the_feed(self):
        t = self.t
        far = plane("a2", "UAL1", 8.0)                                  # 8 nm north, heading 280 at 180 kt
        t.want_pin("a2")
        t.update([plane("a1", "ASA1", 6.0), far], "test")
        self.assertEqual(t.snapshot("a2")["pinned"], "a2")
        t.status["updated"] -= 10                                       # ten seconds on, the feed leaves both out
        t.want_pin("a2")
        t.update([], "test")
        s = t.snapshot("a2")
        self.assertEqual((s["pinned"], s["hero"]["hex"], [a["hex"] for a in s["aircraft"]]), ("a2", "a2", ["a2"]))
        held = s["hero"]
        self.assertTrue(held["coasting"])
        self.assertLess(held["lon"], far["lon"])                        # moved on along its track: half a mile west
        self.assertAlmostEqual(geo.haversine_nm(far["lat"], far["lon"], held["lat"], held["lon"]), 0.5, places=1)
        self.assertEqual(len(s["hero"]["path"]), 1)                     # its track is kept, with no made-up points
        # the feed has it again: an ordinary report once more
        t.want_pin("a2")
        t.update([plane("a2", "UAL1", 8.0)], "test")
        self.assertNotIn("coasting", t.snapshot("a2")["hero"])
        # half a minute without a report, and it is let go
        t.status["updated"] -= 10
        t.want_pin("a2")
        t.update([], "test")
        next(a for a in t.aircraft if a["hex"] == "a2")["coasting"] -= 40
        t.want_pin("a2")
        t.update([], "test")
        self.assertIsNone(t.snapshot("a2")["pinned"])

    def test_one_odd_record_doesnt_cost_the_update(self):
        odd = plane("bad", "XXX1", 2.0, gs="fast")                      # nothing a feed should send
        with self.assertLogs("cloudwall.tracker", "WARNING"):
            self.t.update([odd, plane("a1", "ASA1", 1.0)], "test")
        self.assertEqual(([a["hex"] for a in self.t.aircraft], self.t.status["ok"]), (["a1"], True))
        n = feeds.normalise({"hex": "A1", "gs": "fast", "lat": "45.6", "lon": -122.5, "track": True, "dbFlags": None})
        self.assertEqual((n["gs"], n["lat"], n["track"], n["military"]), (None, None, None, False))

    def test_finished_flyovers_and_stale_runways_are_forgotten(self):
        t = self.t
        t.update([plane("a1", "ASA1", 1.0)], "test")                    # overhead, low and descending toward PDX
        self.assertEqual((list(t.logbook.active), t.flow["dir"]), (["a1"], "west"))
        t.logbook.active["a1"]["ts"] -= 3600                                    # an hour on, with nothing landing
        t.logbook.tidied, t.flow_at = 0, t.flow_at - 3601
        t.update([], "test")
        self.assertEqual((t.logbook.active, t.flow), ({}, None))


class MedicalTest(unittest.TestCase):
    """Medical flights (medical.py): by transponder, operator or callsign, or a hospital's helipad;
    and the helipad a helicopter is heading for, landing at or has just left."""
    EMANUEL = {"code": "7OR5", "name": "Emanuel Hospital", "short": "Emanuel", "city": "Portland",
               "lat": 45.54348, "lon": -122.67087, "elevation_ft": 163}
    OHSU = {"code": "9OR6", "name": "Oregon Health Sciences University", "short": "OHSU", "city": "Portland",
            "lat": 45.49916, "lon": -122.68517, "elevation_ft": 621}

    def setUp(self):
        from cloudwall.picture import medical
        self.m = medical
        medical._said.clear()

    def heli(self, pad, nm, from_deg, **kw):
        """A helicopter nm from a helipad, out along a bearing from it, flying straight at it."""
        lat = pad["lat"] + nm * math.cos(math.radians(from_deg)) / 60
        lon = pad["lon"] + nm * math.sin(math.radians(from_deg)) / (60 * math.cos(math.radians(pad["lat"])))
        return dict({"hex": "h1", "callsign": "N123AB", "icon": "heli", "on_ground": False, "lat": lat, "lon": lon,
                     "track": (from_deg + 180) % 360, "gs": 120, "vrate": 0, "alt": 1500, "military": False}, **kw)

    def test_by_transponder_operator_or_callsign(self):
        yes = [{"emergency_status": "lifeguard"}, {"owner": "LIFE FLIGHT NETWORK LLC"}, {"owner_op": "Air Methods Corp"},
               {"callsign": "MERCY12"}, {"owner": "Legacy Emanuel Hospital"}, {"operated_by": "PHI Air Medical"}]
        no = [{"callsign": "REACH123"}, {"owner": "KGW News"}, {"callsign": "N123AB"},
              {"emergency_status": "lifeguard", "military": True}]      # the Army's are military, said as such
        self.assertEqual([self.m.by_name(a) for a in yes], [True] * len(yes))
        self.assertEqual([self.m.by_name(a) for a in no], [False] * len(no))

    def test_heading_for_a_hospital(self):
        a = self.heli(self.EMANUEL, 6, 90)                      # from the east, nothing else on its line
        h = self.m.hospital(a, [self.EMANUEL, self.OHSU], medical=True)
        self.assertEqual((h["code"], h["state"], h["short"]), ("7OR5", "heading", "Emanuel"))
        self.assertAlmostEqual(h["eta_s"], 180, delta=5)
        self.assertIsNone(self.m.hospital(dict(a, hex="h2"), [self.EMANUEL, self.OHSU], medical=False))   # only a medical one is said to

    def test_two_helipads_on_its_line_say_nothing(self):
        # from the north-north-east, OHSU lies on the same line beyond Emanuel: it could be going to either
        a = self.heli(self.EMANUEL, 4, 13)
        self.assertIsNone(self.m.hospital(a, [self.EMANUEL, self.OHSU], medical=True))

    def test_landing_and_lifting_off_make_it_medical(self):
        landing = self.heli(self.EMANUEL, 0.8, 90, alt=600, vrate=-700)
        left = dict(self.heli(self.EMANUEL, 0.8, 270, alt=650, vrate=800), hex="h2", track=270)      # climbing away west
        plain = dict(self.heli(self.EMANUEL, 9, 0, alt=1500), hex="h3", track=90)                    # nowhere near
        said = {}
        self.m.mark([landing, left, plain], [self.EMANUEL, self.OHSU], said)
        self.assertNotIn("medical", landing)                    # nothing medical in its name: once could be chance
        self.assertNotIn("hospital", landing)
        self.m.mark([landing, left, plain], [self.EMANUEL, self.OHSU], said)
        self.assertEqual(self.m._said, {})                      # the claims are the caller's own
        self.assertEqual((landing["hospital"]["state"], landing.get("medical")), ("landing", True))
        self.assertNotIn("seen", landing["hospital"])
        self.assertEqual((left["hospital"]["state"], left.get("medical")), ("left", True))
        self.assertNotIn("hospital", plain)
        self.assertNotIn("medical", plain)
        from cloudwall.picture import situation
        self.assertEqual(situation.notable(landing), "medical")

    def test_a_helicopter_descending_past_a_hospital_is_not_medical(self):
        # a news helicopter coming down 2 nm out, roughly pointed at the hospital, on its way elsewhere
        news = self.heli(self.EMANUEL, 2.0, 90, alt=1100, vrate=-500, track=250)
        life = dict(news, hex="h2", callsign="LIFE3")           # an air ambulance doing the same is landing there
        said = {}
        for _ in range(3):
            self.m.mark([news, life], [self.EMANUEL], said)
        self.assertNotIn("medical", news)
        self.assertNotIn("hospital", news)
        self.assertEqual((life["medical"], life["hospital"]["state"]), (True, "landing"))

    def test_an_estimated_position_has_no_hospital(self):
        """A followed helicopter the feed leaves out is carried on from its last report: it stays
        medical, but the hospital and its countdown aren't repeated."""
        a = self.heli(self.EMANUEL, 0.8, 90, alt=600, vrate=-600)
        said = {}
        for _ in range(2):
            self.m.mark([a], [self.EMANUEL], said)
        self.assertEqual(a["hospital"]["state"], "landing")
        coasted = dict(a, coasting=time.time(), notable="medical", seq=2, lands_s=40)
        from cloudwall.picture import situation
        situation.describe([coasted], {"iata": "PDX", "helipads": [self.EMANUEL]}, None, said)
        self.assertNotIn("hospital", coasted)
        self.assertNotIn("seq", coasted)
        self.assertEqual((coasted["medical"], coasted["notable"]), (True, "medical"))
        gone = dict(a, medical=True, hospital=a["hospital"], vrate=0, alt=3000)     # reported again, flying on: no longer either
        self.m.mark([gone], [self.EMANUEL], said)
        self.assertNotIn("medical", gone)
        self.assertNotIn("hospital", gone)

    def test_one_odd_record_leaves_the_rest_marked(self):
        odd = dict(self.heli(self.EMANUEL, 1, 90), hex="h2", track="north")
        life = dict(self.heli(self.EMANUEL, 6, 90), callsign="LIFE3")
        with self.assertLogs("cloudwall.medical", "WARNING"):
            self.m.mark([odd, life], [self.EMANUEL], {})
        self.assertTrue(life["medical"])

    def test_the_logbook_gets_the_medical_badge(self):
        """Also when it is known to be medical only after its entry was started."""
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=demo.Demo()))
        home = config.DEFAULTS["home"]
        over = {"hex": "ab1", "callsign": "LIFE3", "lat": home["lat"] + 0.004, "lon": home["lon"], "alt": 1500, "gs": 110,
                "track": 90, "vrate": 0, "category": "A7", "type": "EC35", "on_ground": False}
        late = dict(over, hex="ab2", callsign="N123AB", lon=home["lon"] + 0.004)
        t.update([dict(over), dict(late)], "test")
        by = {a["hex"]: a for a in t.snapshot()["aircraft"]}
        self.assertIn("MEDICAL", by["ab1"]["badges"])
        self.assertNotIn("MEDICAL", by["ab2"]["badges"])
        t.update([dict(over), dict(late, emergency_status="lifeguard")], "test")
        by = {a["hex"]: a for a in t.snapshot()["aircraft"]}
        self.assertIn("MEDICAL", by["ab2"]["badges"])
        rows = {r["hex"]: json.loads(r["badges"]) for r in store.query("SELECT hex, badges FROM sightings")}
        self.assertTrue("MEDICAL" in rows["ab1"] and "MEDICAL" in rows["ab2"], rows)

    def test_not_landing_on_a_helipad_up_a_hill(self):
        # low over the river, descending, 2 nm short of OHSU on its hill (621 ft): not landing there
        a = self.heli(self.OHSU, 2.0, 60, alt=250, vrate=-400)
        h = self.m.hospital(a, [self.OHSU], medical=True)
        self.assertNotEqual((h or {}).get("state"), "landing")

    def test_helipads_near_home(self):
        from cloudwall.reference import airports
        near = {p["code"]: p for p in airports.helipads_near(45.52, -122.68, 5)}
        self.assertEqual((near["9OR6"]["short"], near["7OR5"]["name"]), ("OHSU", "Emanuel Hospital"))
        self.assertTrue(all(isinstance(p["lat"], float) and isinstance(p["elevation_ft"], int) for p in near.values()))

    def test_names_tidied_from_the_faa(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build_data", Path(__file__).resolve().parent.parent / "tools" / "build_data.py")
        bd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bd)
        self.assertEqual([bd.tidy_name(n) for n in ("ST VINCENT HOSPITAL & MEDICAL CENTER", "OREGON HEALTH SCIENCES UNIVERSITY EMERG",
                                                       "GRINNELL RGNL MEDICAL CENTER", "ST JOSEPH'S HOSPITAL", "MEML HOSPITAL-THE WOODLANDS")],
                         ["St. Vincent Hospital & Medical Center", "Oregon Health Sciences University", "Grinnell Regional Medical Center",
                          "St. Joseph's Hospital", "Memorial Hospital-The Woodlands"])
        self.assertEqual([bd.short_name(n) for n in ("Emanuel Hospital", "Oregon Health Sciences University", "Doctors Memorial Hospital",
                                                        "Providence St. Vincent Medical Center")],
                         ["Emanuel", "OHSU", "Doctors Memorial", "Providence St. Vincent"])
        self.assertIsNone(bd.HOSPITAL.search("ROSE QUARTER"))
        self.assertTrue(bd.HOSPITAL.search("BAPTIST HLTH LEXINGTON") and bd.HOSPITAL.search("UPMC EAST"))

    def test_demo_air_ambulance(self):
        sim = demo.Demo()
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=sim))
        home = config.DEFAULTS["home"]
        t.update(sim.fetch(home["lat"], home["lon"], 15), "demo")
        life = next(a for a in t.snapshot()["aircraft"] if a.get("callsign") == "LIFE3")
        self.assertEqual((life["medical"], life["notable"], life["hospital"]["state"]), (True, "medical", "heading"))
        self.assertGreater(life["hospital"]["eta_s"], 60)


class SeatsTest(unittest.TestCase):
    def test_airline_layout_then_type_then_cargo(self):
        from cloudwall.reference.seats import seats
        self.assertEqual(seats("ASA", "B39M"), {"n": 178, "lo": 178, "hi": 178, "basis": "airline"})
        self.assertEqual(seats("SKW", "E75L")["n"], 76)                     # regional partner's own layout
        self.assertEqual(seats("XYZ", "B738")["basis"], "type")            # unknown airline: typical for the type
        self.assertEqual(seats(None, "C172")["n"], 4)
        self.assertEqual(seats("FDX", "B763"), {"n": 0, "lo": 0, "hi": 0, "basis": "cargo"})
        self.assertIsNone(seats("ASA", None))
        self.assertIsNone(seats("RCH", "C17"))

    def test_logbook_totals_seats(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())
        t.update([plane("a1", "ASA512", 0.5, typ="B39M"), plane("a2", "FDX12", 0.6, typ="B763"),
                  plane("a3", "N12345", 0.7, typ="ZZZZ")], "test")
        day = time.strftime("%Y-%m-%d")
        tot = store.logbook(day)["seats_today"]
        self.assertEqual(tot, {"seats": 178, "known": 2, "flights": 3})
        self.assertEqual(t.snapshot()["seats_today"], 178)


class DisplayWordsTest(unittest.TestCase):
    def test_runways_in_words(self):
        import shutil
        import subprocess
        if not shutil.which("node"):
            self.skipTest("needs node")
        util = Path(__file__).resolve().parent.parent / "cloudwall" / "web" / "js" / "util.js"
        script = ("const { runwayList, degF } = await import(process.argv[1]);"
                  'console.log(JSON.stringify([["28L / 28R", "27C / 27L / 27R / 28C", "08", ""].map(runwayList),'
                  " [12.2, 0, null, undefined].map(degF)]));")
        run = subprocess.run(["node", "--input-type=module", "-e", script, str(util)], capture_output=True, text=True, timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr)
        runways, temperatures = json.loads(run.stdout)
        self.assertEqual(runways, ["28L and 28R", "27C, 27L, 27R and 28C", "08", ""])
        self.assertEqual(temperatures, ["54°F", "32°F", "–", "–"])       # no temperature in the report isn't freezing


class PresentationDataTest(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.enricher = StubEnricher()
        self.t = Tracker(config.load(), self.store, self.enricher)

    def test_flight_number_and_partner_airline(self):
        from cloudwall.reference.airlines import flight_number
        self.assertEqual([flight_number(c) for c in ("ASA508", "SKW3108", "DAL0012", "N733NV")], ["AS508", "OO3108", "DL12", None])
        apt = lambda code, ll: {"iata": code, "city": code, "lat": ll[0], "lon": ll[1]}
        self.enricher.routes["SKW3108"] = {"flight": "AS3108", "airline": None, "source": "fr24", "painted_as": "ASA",
                                           "operating_as": "SKW", "origin": apt("PSP", (33.83, -116.51)), "dest": apt("PDX", PDX)}
        self.t.update([plane("a1", "SKW3108", 1.0, typ="E75L")], "test")
        a = self.t.snapshot()["hero"]
        self.assertEqual((a["flight_no"], a["airline"], a["operated_by"], a["airline_iata"]),
                         ("AS3108", "Alaska Airlines", "SkyWest Airlines", "AS"))
        self.assertGreater(a["route"]["eta_est"], time.time())

    def test_airline_name_agrees_with_logo_and_flight_number(self):
        apt = lambda code, ll: {"iata": code, "city": code, "lat": ll[0], "lon": ll[1]}
        # the route database names the brand a regional flies under; the logo and number are the operator's
        self.enricher.routes["SKW3486"] = {"flight": "DL3486", "airline": "Delta Connection", "airline_iata": "DL",
                                           "origin": apt("SEA", (47.45, -122.31)), "dest": apt("PDX", PDX)}
        # Horizon only ever flies as Alaska: Alaska's flight, operated by Horizon
        self.enricher.routes["QXE2162"] = {"flight": "QX2162", "airline": "Horizon Air", "airline_iata": "QX",
                                           "origin": apt("BOI", (43.56, -116.22)), "dest": apt("PDX", PDX)}
        self.t.update([plane("a1", "SKW3486", 1.0, typ="CRJ9"), plane("a2", "QXE2162", 3.0, typ="E75L")], "test")
        got = {a["hex"]: (a["flight_no"], a["airline"], a.get("operated_by"), a["airline_iata"]) for a in self.t.snapshot()["aircraft"]}
        self.assertEqual(got["a1"], ("OO3486", "SkyWest Airlines", None, "OO"))
        self.assertEqual(got["a2"], ("AS2162", "Alaska Airlines", "Horizon Air", "AS"))

    def test_brief_feed_outage_is_not_a_warning(self):
        self.t.update([plane("a1", "ASA1", 1.0)], "test")
        self.t.failed("test", "timeout")
        self.assertTrue(self.t.snapshot()["status"]["ok"])
        self.t.status["updated"] -= 40
        self.t.failed("test", "timeout")
        self.assertFalse(self.t.snapshot()["status"]["ok"])


class LiveFirstTest(unittest.TestCase):
    """With a live provider, routes come from the flight in the air, looked up early."""

    def setUp(self):
        import threading
        self.store = Store(":memory:")
        self.calls, self.gate = [], threading.Event()
        test = self

        class Provider:
            name, label, mode, general_aviation, enabled = "fake", "Fake24", "always", False, True
            def available(self): return True
            def status(self): return {"label": self.label}
            def route(self, callsign):
                test.calls.append(callsign)
                test.gate.wait(2)
                return {"flight": "AS1363", "airline": None, "source": "fake", "source_label": "Fake24",
                        "origin": {"iata": "SEA", "city": "Seattle", "lat": 47.449, "lon": -122.309},
                        "dest": {"iata": "PDX", "city": "Portland", "lat": PDX[0], "lon": PDX[1]},
                        "eta": None, "progress_percent": None}

        self.enricher = Enricher(self.store, live=Provider())
        for hexid in ("a1", "a2"):
            self.store.cache_put("aircraft", hexid, None)
        # the database's stale guess, which happens to look geometrically fine
        self.store.cache_put("route", "ASA1363", {"flight": "AS1363", "airline": "Alaska Airlines",
            "origin": {"iata": "SFO", "city": "San Francisco", "lat": 37.62, "lon": -122.38},
            "dest": {"iata": "PDX", "city": "Portland", "lat": PDX[0], "lon": PDX[1]}})
        self.t = Tracker(config.load(), self.store, self.enricher)

    def wait_calls(self, n):
        for _ in range(100):
            if len(self.calls) >= n:
                return
            time.sleep(0.01)

    def test_looks_up_early_and_never_shows_the_stale_guess(self):
        # 7 minutes out at 2 nm/min, flying straight at the house from the north (just inside the
        # 15 nm tracking radius: past it, aircraft are only drawn on a longer-range radar)
        inbound = plane("a1", "ASA1363", 14.0, track=180, gs=120)
        self.t.update([inbound], "test")
        self.wait_calls(1)
        self.assertEqual(self.calls, ["ASA1363"])               # asked well before it's overhead
        a = self.t.snapshot()["aircraft"][0]
        self.assertTrue(a.get("route_pending"))
        self.assertNotIn("route", a)                            # the SFO guess is not shown meanwhile
        self.gate.set()
        for _ in range(100):
            self.t.update([inbound], "test")
            a = self.t.snapshot()["aircraft"][0]
            if a.get("route"):
                break
            time.sleep(0.01)
        self.assertEqual((a["route"]["origin"]["iata"], a["route"]["source"]), ("SEA", "fake"))
        self.assertEqual(a["route"]["airline"], "Alaska Airlines")
        self.t.update([inbound], "test")
        self.assertEqual(len(self.calls), 1)                    # each flight is looked up once

    def test_no_lookup_for_traffic_not_heading_this_way(self):
        self.gate.set()
        self.t.update([plane("a2", "ASA1363", 9.0, track=90)], "test")   # passing by to the north
        time.sleep(0.1)
        self.assertEqual(self.calls, [])

    def test_lookup_for_a_flight_a_screen_follows(self):
        self.gate.set()
        self.t.want_pin("a2")                                         # someone taps it on their phone
        self.t.update([plane("a2", "ASA1363", 9.0, track=90)], "test")
        self.wait_calls(1)
        self.assertEqual(self.calls, ["ASA1363"])


class WakeTest(unittest.TestCase):
    def test_categories(self):
        from cloudwall.reference import aircraft
        self.assertEqual([aircraft.wake(t) for t in ("A388", "B77W", "B738", "e75l", "C172")], ["A", "B", "F", "G", "I"])
        self.assertIsNone(aircraft.wake(None))
        self.assertIsNone(aircraft.wake("NOPE"))


if __name__ == "__main__":
    unittest.main()
