import json
import math
import time
import unittest
from pathlib import Path

from cloudwall import config, geo, sources
from cloudwall.enrich import Enricher
from cloudwall.store import Store
from cloudwall.logbook import ordinal
from cloudwall.tracker import Tracker

PDX = (45.5887, -122.5975)
SFO = (37.619, -122.375)
AUS = (30.1975, -97.662)

# The tests stay on this machine. A lookup no test stubbed finds nothing, as a 404 would, and any
# other attempt to reach a service is stopped and fails the run: nothing here should depend on the
# network being up, or send a public service (or a paid one) a request each time the tests run.
_net = {}


def setUpModule():
    import urllib.request
    from cloudwall import enrich
    _net.update(urlopen=urllib.request.urlopen, get_json=enrich.get_json, reached=[])

    def local_only(req, *a, **kw):
        url = getattr(req, "full_url", req)
        if urllib.request.urlparse(url).hostname not in ("127.0.0.1", "localhost", "::1"):
            _net["reached"].append(url)
            raise OSError("the tests don't use the network")
        return _net["urlopen"](req, *a, **kw)
    urllib.request.urlopen = local_only
    enrich.get_json = lambda url, timeout=12, headers=None: None


def tearDownModule():
    import urllib.request
    from cloudwall import enrich
    urllib.request.urlopen, enrich.get_json = _net["urlopen"], _net["get_json"]
    if _net["reached"]:
        raise AssertionError(f"tests reached for the network: {sorted(set(_net['reached']))[:5]}")


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
        ac = [sources.normalise(a) for a in data["ac"]]
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

        real, sources.get_json = sources.get_json, fake
        try:
            f = sources.Feeds(["https://bad.example/{lat}/{lon}/{radius}", "https://good.example/{lat}/{lon}/{radius}"])
            self.assertEqual(f.fetch(45, -122, 15)[0]["callsign"], "ASA1")
            self.assertEqual(f.name, "good.example")
            f.fetch(45, -122, 15)                       # stays on the working feed
            self.assertEqual([("bad" in c) for c in calls], [True, False, False])
            f2 = sources.Feeds(["https://bad.example/{lat}", "https://bad.example/b/{lat}"])
            self.assertRaises(OSError, f2.fetch, 45, -122, 15)
        finally:
            sources.get_json = real

    def test_legacy_single_url_config(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml") as t:
            t.write('[source]\nurl = "http://localhost:8080/data/aircraft.json"\n')
            t.flush()
            urls = config.load(t.name)["source"]["urls"]
        self.assertEqual(urls[0], "http://localhost:8080/data/aircraft.json")
        self.assertEqual(len(urls), 3)


class StubEnricher:
    live = None

    def __init__(self):
        self.routes = {}

    def aircraft(self, hexid):
        return None

    def photo(self, hexid, reg=None, icao_type=None):
        return None

    def route(self, callsign):
        return self.routes.get(callsign)


def plane(hexid, callsign, north_nm, alt=3000, typ="B738", home=None, **kw):
    home = home or config.DEFAULTS["home"]
    return dict({"hex": hexid, "callsign": callsign, "reg": None, "type": typ, "alt": alt,
                 "on_ground": False, "gs": 180, "track": 280, "vrate": -700,
                 "lat": home["lat"] + north_nm / 60, "lon": home["lon"], "squawk": "1234",
                 "category": "A3", "military": False}, **kw)


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
        """Every aircraft is marked arriving, departing, flying locally or passing over, and the
        arrivals are put in landing order on the runways in use, with the gap to the one ahead."""
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


def iso(offset_s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_s))


def fa_flight(origin, dest, off=None, on=None, sched_off=0, **kw):
    apt = lambda c: {"code": "K" + c, "code_icao": "K" + c, "code_iata": c, "name": c + " Intl", "city": c}
    return dict({"ident": "SWA2327", "ident_iata": "WN2327", "origin": apt(origin), "destination": apt(dest),
                 "scheduled_off": iso(sched_off), "actual_off": off, "actual_on": on,
                 "estimated_in": iso(1200), "arrival_delay": 720, "status": "En Route / Delayed",
                 "progress_percent": 95, "route_distance": 540, "cancelled": False}, **kw)


class FlightAwareTest(unittest.TestCase):
    COORDS = {"KSMF": (38.6954, -121.5908), "KPDX": PDX, "KLAS": (36.08, -115.152), "KOAK": (37.721, -122.221)}

    def setUp(self):
        self.calls = []
        self.flights = [
            fa_flight("LAS", "OAK", off=iso(-30000), on=iso(-25000), sched_off=-30000),   # earlier leg, landed
            fa_flight("SMF", "PDX", off=iso(-4200), sched_off=-4800),                     # in the air now
            fa_flight("PDX", "LAS", sched_off=9000),                                      # next leg
        ]

        def fake(url, timeout=0, headers=None):
            self.calls.append(url)
            self.assertEqual(headers, {"x-apikey": "k"})
            if "/airports/" in url:
                lat, lon = self.COORDS[url.rsplit("/", 1)[1]]
                return {"latitude": lat, "longitude": lon}
            return {"flights": self.flights}

        from cloudwall import flightaware, live
        self.mod, self.live, self.real = flightaware, live, live.get_json
        live.get_json = fake
        self.store = Store(":memory:")
        cfg = config.load()
        cfg["flightaware"] = dict(cfg["flightaware"], api_key="k", daily_limit=5)
        self.cfg = cfg
        self.fa = flightaware.FlightAware(cfg, self.store)

    def tearDown(self):
        self.live.get_json = self.real

    def test_picks_the_airborne_leg_and_caches_airports(self):
        r = self.fa.route("SWA2327")
        self.assertEqual((r["origin"]["iata"], r["dest"]["iata"], r["flight"]), ("SMF", "PDX", "WN2327"))
        self.assertAlmostEqual(r["dest"]["lat"], PDX[0], 3)
        self.assertEqual(self.fa.used_today(), 1)            # airports came from the bundled table
        self.fa.route("SWA2327")
        self.assertEqual(self.fa.used_today(), 2)

    def test_just_departed_and_nothing_current(self):
        pick = self.mod.pick_flight
        self.assertEqual(pick([fa_flight("PDX", "LAS", sched_off=-120)], time.time())["destination"]["code_iata"], "LAS")
        self.assertIsNone(pick([fa_flight("PDX", "LAS", sched_off=20000)], time.time()))
        self.assertIsNone(pick([fa_flight("PDX", "LAS", sched_off=0, cancelled=True)], time.time()))

    def test_daily_limit_stops_billing(self):
        for _ in range(5):
            self.fa.route("SWA2327")
        self.assertEqual(self.fa.used_today(), 5)
        self.assertFalse(self.fa.available())
        n = len(self.calls)
        self.assertIsNone(self.fa.route("SWA2327"))
        self.assertEqual(len(self.calls), n)                  # no request was sent

    def test_tracker_uses_flightaware_only_when_needed(self):
        enricher = Enricher(self.store, live=self.fa)
        wrong = {"flight": "WN2327", "airline": "Southwest Airlines",
                 "origin": {"iata": "LAS", "city": "Las Vegas", "lat": 36.08, "lon": -115.152},
                 "dest": {"iata": "OAK", "city": "Oakland", "lat": 37.721, "lon": -122.221}}
        self.store.cache_put("route", "SWA2327", wrong)       # what the free database says
        self.store.cache_put("aircraft", "a1", None)
        self.store.cache_put("aircraft", "a2", None)
        t = Tracker(self.cfg, self.store, enricher)
        far = plane("a2", "SWA2327", 12.0, track=90)          # same callsign, far away, not inbound
        t.update([far], "test")
        time.sleep(0.2)
        self.assertEqual(self.calls, [])                      # nothing overhead: no billed lookup
        for _ in range(20):
            t.update([plane("a1", "SWA2327", 1.0)], "test")
            hero = t.snapshot()["hero"]
            if hero["route"]["source"] if hero.get("route") and "source" in hero["route"] else None:
                break
            time.sleep(0.05)
        r = hero["route"]
        self.assertEqual((r["origin"]["iata"], r["dest"]["iata"], r["source"]), ("SMF", "PDX", "flightaware"))
        self.assertTrue(r["plausible"])
        self.assertEqual(r["airline"], "Southwest Airlines")  # name kept from the free lookup
        self.assertEqual(hero["local"], "arriving")
        row = self.store.query("SELECT origin, dest FROM sightings")[0]
        self.assertEqual((row["origin"], row["dest"]), ("SMF", "PDX"))
        self.assertEqual(self.fa.status()["used_today"], 1)
        json.dumps(t.snapshot())


class Flightradar24Test(unittest.TestCase):
    def setUp(self):
        from cloudwall import flightradar24, live
        self.calls, self.fail = [], None
        # a flight-summary/light row for a flight in the air (field names from the API spec)
        self.row = {"fr24_id": "3a01b036", "flight": "WN2327", "callsign": "SWA2327", "operating_as": "SWA",
                    "painted_as": "SWA", "type": "B737", "reg": "N7715E", "orig_icao": "KSMF",
                    "datetime_takeoff": "2026-11-17T02:41:09", "dest_icao": "KPDX", "datetime_landed": None,
                    "hex": "a9c4b1", "flight_ended": False}
        self.rows = [self.row]

        def fake(url, timeout=0, headers=None):
            self.calls.append(url)
            self.assertEqual(headers, {"Authorization": "Bearer tok", "Accept-Version": "v1"})
            if self.fail:
                import urllib.error
                raise urllib.error.HTTPError(url, self.fail, "nope", None, None)
            return {"data": self.rows}

        self.live, self.real = live, live.get_json
        live.get_json = fake
        self.store = Store(":memory:")
        cfg = config.load()
        cfg["flightradar24"] = dict(cfg["flightradar24"], api_key="tok", sandbox=True)   # sandbox: no usage thread
        self.fr = flightradar24.Flightradar24(cfg, self.store)
        self.fr.sandbox = False                                                           # but parse like production

    def tearDown(self):
        self.live.get_json = self.real

    def test_route_from_flight_summary(self):
        r = self.fr.route("SWA2327")
        self.assertEqual((r["origin"]["iata"], r["dest"]["iata"], r["flight"]), ("SMF", "PDX", "WN2327"))
        self.assertEqual((r["origin"]["city"], r["dest"]["city"]), ("Sacramento", "Portland"))
        self.assertAlmostEqual(r["dest"]["lon"], PDX[1], 1)                  # from the bundled airport table
        self.assertEqual(r["departed"], 1794883269.0)                        # 02:41:09 UTC
        self.assertIn("/flight-summary/light?", self.calls[0])
        self.assertIn("callsigns=SWA2327", self.calls[0])
        self.assertIn("limit=1", self.calls[0])
        self.assertEqual(len(self.calls), 1)                                 # no paid airport lookups
        self.assertEqual(self.fr.used_today(), 1)                            # a live flight costs 1 credit

    def test_costs_follow_the_price_list(self):
        self.rows = []
        self.assertIsNone(self.fr.route("ASA1"))                             # empty result: 1 credit
        self.assertEqual(self.fr.used_today(), 1)
        self.rows = [dict(self.row, flight_ended=True)]
        from cloudwall.live import NotYet
        with self.assertRaises(NotYet):                                      # the leg before, already landed: 2 credits,
            self.fr.route("SWA2327")                                         # and worth asking again in a while
        self.assertEqual(self.fr.used_today(), 3)

    def test_diversion_and_unknown_airport(self):
        self.rows = [dict(self.row, dest_icao_actual="KSEA", orig_icao="ZZZZ")]
        r = self.fr.route("SWA2327")
        self.assertEqual(r["dest"]["iata"], "SEA")                           # diverted: show where it's really going
        self.assertEqual((r["origin"]["iata"], r["origin"]["lat"]), ("ZZZZ", None))

    def test_rejected_key_pauses_without_spending(self):
        self.fail = 401
        self.assertIsNone(self.fr.route("SWA2327"))
        self.assertEqual(self.fr.used_today(), 0)
        self.assertFalse(self.fr.available())
        self.assertEqual(self.fr.status()["problem"], "API key rejected")
        n = len(self.calls)
        self.fr.route("SWA2327")
        self.assertEqual(len(self.calls), n)                                 # backing off: nothing sent

    def test_never_starts_a_request_it_cannot_afford(self):
        import datetime as dt
        self.fr.monthly_limit, self.fr.margin = 1000, 0.15                   # budget 850
        self.fr._today = lambda: dt.date(2026, 11, 30)                       # last day of the period
        self.store.cache_put("flightradar24_usage", "2026-11-05", 849)
        self.assertFalse(self.fr.available())                                # 849 + up to 2 would pass 850
        self.assertIsNone(self.fr.route("SWA2327"))
        self.assertEqual(self.calls, [])


class DemoTest(unittest.TestCase):
    def test_demo_runs_end_to_end(self):
        demo = sources.Demo()
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=demo))
        home = config.DEFAULTS["home"]
        t.update(demo.fetch(home["lat"], home["lon"], 15), "demo")
        s = t.snapshot()
        self.assertGreaterEqual(len(s["aircraft"]), 3)
        json.dumps(s)


if __name__ == "__main__":
    unittest.main()


class TracksTest(unittest.TestCase):
    def test_trails_heatmap_and_photo(self):
        store = Store(":memory:")
        t = Tracker(config.load(), store, StubEnricher())
        for north in (3.0, 2.0, 1.0):
            t.update([plane("a1", "ASA1", north), plane("g1", "ASA2", 0.5, alt=0, on_ground=True)], "test")
        trail = list(t.tracks.trails["a1"])
        self.assertEqual(len(trail), 3)
        self.assertGreater(trail[0][0], trail[-1][0])                 # moving south toward home
        heat = t.heatmap()
        self.assertEqual(sum(c[2] for c in heat["cells"]), 3)         # the parked aircraft isn't counted
        self.assertTrue(all(c[0] == heat["grid"] // 2 for c in heat["cells"]))   # due north: centre column
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
        self.assertEqual(sum(c[2] for c in t.heatmap()["cells"]), 2)  # but it stays off the heatmap
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
        demo = sources.Demo()
        home = config.DEFAULTS["home"]
        demo.fetch(home["lat"], home["lon"], 30)
        demo.next_spawn = 0
        demo.fetch(home["lat"], home["lon"], 30)
        self.assertLessEqual(min(a["along"] for a in demo.active), -28)   # new arrivals start near 30 nm


class PlacesTest(unittest.TestCase):
    def load(self, toml):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as f:
            f.write(toml)
        self.addCleanup(Path(f.name).unlink)
        return config.load(f.name)

    def test_the_defaults_are_one_place_at_pdx(self):
        [p] = config.places(config.load())
        self.assertEqual((p["place"], p["airport"]["icao"]), ({"id": "home", "name": "Home"}, "KPDX"))
        self.assertEqual([w["name"] for w in p["airport"]["runways"]], ["10R/28L", "10L/28R", "03/21"])
        # the fields around east Vancouver, nearest first, found in the bundled tables with their runways
        self.assertEqual([f["code"] for f in p["airport"]["others"]], ["1W1", "TTD", "VUO"])
        self.assertEqual({f["code"]: [w["name"] for w in f["runways"]] for f in p["airport"]["others"]},
                         {"1W1": ["07/25"], "TTD": ["07/25"], "VUO": ["08/26"]})

    def test_an_icao_code_is_enough(self):
        cfg = self.load('[home]\nlat = 37.66\nlon = -122.40\n[airport]\nicao = "ksfo"\n')
        ap = config.places(cfg)[0]["airport"]
        self.assertEqual((ap["icao"], ap["iata"], ap["city"]), ("KSFO", "SFO", "San Francisco"))
        self.assertAlmostEqual(ap["lat"], 37.619, places=2)              # not PDX's position
        self.assertIn("OAK", [f["code"] for f in ap["others"]])          # small fields found nearby
        self.assertNotIn("VUO", [f["code"] for f in ap["others"]])
        self.assertEqual(len(ap["runways"]), 4)

    def test_more_places(self):
        cfg = self.load('[[places]]\nname = "Cabin"\nlat = 44.06\nlon = -121.31\nairport = "KRDM"\n'
                        '[[places]]\nname = "cabin"\nlat = 37.66\nlon = -122.40\nairport = "KSFO"\nelevation_ft = 20\n'
                        '[kiosk]\nplace = "Cabin"\n')
        ps = config.places(cfg)
        self.assertEqual([p["place"]["id"] for p in ps], ["home", "cabin", "cabin-2"])
        self.assertEqual(ps[1]["home"]["elevation_ft"], 3070)           # the airport's, when not given
        self.assertEqual(ps[2]["home"]["elevation_ft"], 20)
        self.assertEqual(ps[1]["airport"]["iata"], "RDM")
        self.assertEqual(config.kiosk_place(cfg, ps), "cabin")
        self.assertEqual(ps[1]["kiosk"]["place"], "Cabin")              # shared settings carry over
        with self.assertRaisesRegex(ValueError, "needs lat and lon, or zip"):
            config.places(dict(cfg, places=[{"name": "Boat", "lat": 1.0}]))
        with self.assertRaisesRegex(ValueError, "isn't in CloudWall's table"):
            config.places(dict(cfg, places=[{"name": "Strip", "lat": 1.0, "lon": 2.0, "airport": "ZZZZ"}]))

    def test_a_field_with_no_iata_code_goes_by_its_local_one(self):
        cfg = self.load('[home]\nlat = 45.62\nlon = -122.65\n[airport]\nicao = "KVUO"\n')
        ap = config.places(cfg)[0]["airport"]
        self.assertEqual((ap["icao"], ap["iata"], ap["name"]), ("KVUO", "VUO", "Pearson Field"))   # not a blank code
        self.assertNotIn("VUO", [f["code"] for f in ap["others"]])       # and it isn't one of its own neighbours

    def test_settings_are_checked_when_the_file_is_read(self):
        for toml, said in (('[tracking]\npoll_seconds = "5"\n', "poll_seconds must be a number"),
                           ('[tracking]\nwhen_idle = "puase"\n', 'must be "pause" or "log"'),
                           ('[kiosk]\ntracks = "off"\n', "tracks must be true or false"),
                           ('[extras]\nmilitary = 1\n', "military must be true or false"),
                           ('[tracking]\nradius_nm = 0\n', "more than 0"),
                           ('[server]\nport = 70000\n', "1 to 65535"),
                           ('[source]\nurls = "https://feed.example/{lat}"\n', "urls must be a list"),
                           ('places = "cabin"\n', r"\[\[places\]\] sections")):
            with self.assertRaisesRegex(ValueError, said):
                self.load(toml)
        # a name CloudWall doesn't know is said, not refused: the rest of the file still counts
        with self.assertLogs("cloudwall", "WARNING") as logs:
            cfg = self.load('port = 5050\n[tracking]\nradious_nm = 20\npoll_seconds = 2.5\n[sound]\non = true\n')
        self.assertEqual((cfg["tracking"]["radius_nm"], cfg["tracking"]["poll_seconds"]), (15, 2.5))
        self.assertNotIn("sound", cfg)
        self.assertEqual(len(logs.output), 3)
        config.load(str(Path(config.EXAMPLE)))                           # the starter file passes its own check

    def test_zip_codes_and_the_closest_major_airport(self):
        from cloudwall import airports
        cfg = self.load('[home]\nzip = "98660"\n[[places]]\nname = "Cabin"\nzip = "97702"\n'
                        '[[places]]\nname = "Allston"\nzip = 2134\n')       # a number: TOML drops the leading 0
        home, cabin, allston = config.places(cfg)
        self.assertEqual((home["home"]["lat"], home["home"]["zip"], home["airport"]["icao"]), (45.6612, "98660", "KPDX"))
        self.assertEqual((cabin["airport"]["icao"], cabin["home"]["elevation_ft"]), ("KRDM", 3070))
        self.assertEqual((allston["home"]["zip"], allston["airport"]["icao"]), ("02134", "KBOS"))
        with self.assertRaisesRegex(ValueError, "isn't a US ZIP code CloudWall knows"):
            config.places(dict(cfg, places=[{"zip": "00501"}]))
        # the closest major airport: a large one within 30 nm wins over a nearer smaller one
        self.assertEqual(airports.pick_airport(61.22, -149.86), "PANC")    # not Merrill Field, 1 nm away
        self.assertEqual(airports.pick_airport(47.98, -122.20), "KPAE")    # Everett: Paine Field, SEA is 32 nm
        self.assertEqual(airports.locate("98683-1234")["zip"], "98683")
        self.assertEqual(airports.locate("45.6387 -122.6615")["lon"], -122.6615)
        for junk in ("hello", "2024-01-15", "91, 10", "123.45"):
            self.assertIsNone(airports.locate(junk), junk)

    def test_runway_flow_at_any_airport(self):
        cfg = self.load('[home]\nlat = 37.66\nlon = -122.40\n[airport]\nicao = "KSFO"\n')
        t = Tracker(config.places(cfg)[0], Store(":memory:"), StubEnricher())
        sfo = {"lat": 37.62, "lon": -122.37}
        t.update([plane("w1", "UAL1", -3.0, alt=2500, gs=150, track=298, home=sfo)], "test")
        self.assertEqual(t.flow, {"dir": "west", "label": "West flow", "runways": "28L / 28R"})
        t.update([plane("e1", "UAL2", 3.0, alt=2500, gs=150, track=118, home=sfo)], "test")
        self.assertEqual(t.flow["runways"], "10L / 10R")

    def test_the_map_is_served_around_every_place(self):
        from cloudwall import tiles as T
        t = T.Tiles(config.load(), "/tmp/x")
        sfo = (12, 655, 1583)                                            # a zoom-12 tile over SFO
        self.assertFalse(t.allowed(*sfo))
        t.homes.append({"lat": 37.66, "lon": -122.40})
        self.assertTrue(t.allowed(*sfo))


class TilesTest(unittest.TestCase):
    def test_cache_area_limit_and_stale_fallback(self):
        import tempfile
        from cloudwall import tiles as T
        with tempfile.TemporaryDirectory() as d:
            t = T.Tiles(config.load(), d)
            calls = []

            def fake(z, x, y):
                calls.append((z, x, y))
                if t.fail:
                    raise OSError("offline")
                return b"PNGDATA", "image/png"

            t._download, t.fail = fake, False
            home = (11, 326, 731)                                     # the tile over Portland
            self.assertEqual(t.get(*home), (b"PNGDATA", "image/png"))
            self.assertEqual(t.get(*home)[0], b"PNGDATA")
            self.assertEqual(len(calls), 1)                           # second request came from disk
            self.assertIsNone(t.get(11, 100, 100))                    # far away: refused, not fetched
            self.assertIsNone(t.get(3, 1, 2))                         # too zoomed out
            self.assertEqual(len(calls), 1)
            # a month-old tile with the provider down: serve the old copy
            p = next(Path(d).rglob("*.tile"))
            old = time.time() - 40 * 86400
            import os
            os.utime(p, (old, old))
            t.fail = True
            self.assertEqual(t.get(*home)[0], b"PNGDATA")
            self.assertIsNone(t.get(11, 327, 731))                    # never fetched and offline

    def test_template_placeholders(self):
        from cloudwall import tiles as T
        cfg = config.load()
        cfg["map"] = dict(cfg["map"], url="https://{s}.example.com/dark/{z}/{x}/{y}{r}.png?api_key=k")
        t = T.Tiles(cfg, "/tmp/x")
        seen = []

        class Resp:
            headers = {"Content-Type": "image/png"}
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self): return b"x"

        real = T.urllib.request.urlopen
        T.urllib.request.urlopen = lambda req, timeout=0: seen.append(req.full_url) or Resp()
        try:
            t._download(11, 326, 731)
        finally:
            T.urllib.request.urlopen = real
        self.assertEqual(seen, ["https://a.example.com/dark/11/326/731.png?api_key=k"])
        cfg["map"]["url"] = "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=k"
        self.assertEqual(T.Tiles(cfg, "/tmp/x").info()["style"], "carto-dark")

    def test_styles_and_off(self):
        from cloudwall import tiles as T
        cfg = config.load()
        self.assertIn("Esri", T.Tiles(cfg, "/tmp/x").attribution)
        self.assertIn("World_Dark_Gray_Base", T.Tiles(cfg, "/tmp/x").url)
        cfg["map"] = dict(cfg["map"], style="satellite")
        self.assertIn("Esri", T.Tiles(cfg, "/tmp/x").attribution)
        cfg["map"] = dict(cfg["map"], style="off")
        t = T.Tiles(cfg, "/tmp/x")
        self.assertFalse(t.enabled)
        self.assertIsNone(t.get(11, 326, 731))


    def test_tiles_reach_the_corners_of_the_longest_range(self):
        from cloudwall import tiles as T
        t = T.Tiles(config.load(), "/tmp/x")
        h = config.load()["home"]
        # the zoom-9 tile under the ATC square's north-east corner at 30 nm, 42 nm out
        z, n = 9, 2 ** 9
        lat, lon = h["lat"] + 30 / 60, h["lon"] + 30 / (60 * math.cos(math.radians(h["lat"])))
        x = int((lon + 180) / 360 * n)
        y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
        self.assertTrue(t.allowed(z, x, y))
        self.assertFalse(t.allowed(z, x + 3, y - 3))                  # well beyond: refused


class ChartsTest(unittest.TestCase):
    def charts(self, d, **m):
        from cloudwall.charts import Charts
        cfg = config.load()
        cfg["map"] = dict(cfg["map"], **m)
        return Charts(cfg, d)

    def test_the_layers_and_which_display_gets_which(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            info = self.charts(d).info()
            self.assertEqual(info["map"]["style"], "dark")              # a street map under the chart radar
            self.assertIsNone(info["atc"])                              # and nothing under the ATC radar
            info = self.charts(d, atc="ifr-low").info()
            self.assertEqual((info["atc"]["layer"], info["atc"]["name"]), ("ifr-low", "IFR Enroute Low"))
            self.assertIn("FAA", info["atc"]["attribution"])
            self.assertEqual(set(info["layers"]), {"ifr-low", "ifr-high", "sectional", "terminal", "world",
                                                   "sat", "streets", "places", "roads"})
            self.assertEqual(list(info["layers"]["ifr-low"]["zooms"]), [7, 11])
            self.assertIn("IFR_AreaLow/MapServer/tile/{z}/{y}/{x}", self.charts(d).layers["ifr-low"].url)
            c = self.charts(d, style="Sectional", atc="off")            # any case
            self.assertIs(c.map, c.layers["sectional"])
            self.assertEqual(c.info()["map"]["style"], "sectional")
            self.assertIsNone(c.info()["atc"])
            c = self.charts(d, atc="ifr-high")
            self.assertEqual(c.info()["atc"]["layer"], "ifr-high")
            c = self.charts(d, style="sectional", url="https://example.com/{z}/{x}/{y}.png")   # a url wins
            self.assertEqual(c.map.url, "https://example.com/{z}/{x}/{y}.png")

    def test_terminal_falls_back_to_the_sectional_and_remembers_gaps(self):
        import tempfile
        import urllib.error
        with tempfile.TemporaryDirectory() as d:
            c = self.charts(d)
            calls = []

            def none_here(z, x, y):
                calls.append(("terminal", z, x, y))
                raise urllib.error.HTTPError("u", 404, "Not Found", {}, None)
            c.layers["terminal"]._download = none_here
            c.layers["sectional"]._download = lambda z, x, y: (calls.append(("sectional", z, x, y)), (b"SEC", "image/png"))[1]
            tile = (11, 326, 731)
            self.assertEqual(c.get("terminal", *tile), (b"SEC", "image/png"))
            self.assertEqual(c.get("terminal", *tile), (b"SEC", "image/png"))
            self.assertEqual([k for k, *_ in calls], ["terminal", "sectional"])   # neither asked twice
            self.assertEqual(c.get("terminal", 9, 81, 182)[0], b"SEC")  # below the terminal's zooms: the sectional's
            self.assertIsNone(c.get("terminal", 7, 20, 45))             # below both
            self.assertIsNone(c.get("nonsense", *tile))                 # no such layer

    def test_every_layer_is_served_around_every_place(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            c = self.charts(d)
            sfo = (11, 327, 791)
            self.assertFalse(c.layers["ifr-low"].allowed(*sfo))
            c.homes = [config.load()["home"], {"lat": 37.62, "lon": -122.38}]
            self.assertTrue(all(t.allowed(*sfo) for lid, t in c.layers.items() if lid not in ("map", "ifr-high", "world")))
            self.assertFalse(c.layers["streets"].allowed(*[11, 327 + 40, 791]))   # the Map view's layers stay near home too

    def test_the_route_maps_borders_and_cities(self):
        import json
        w = json.loads((Path(__file__).resolve().parent.parent / "cloudwall/web/maps/world.json").read_text())
        self.assertGreater(len(w["country"]), 300)
        self.assertGreater(len(w["state"]), 300)
        self.assertTrue(all(len(line) >= 4 and len(line) % 2 == 0 for line in w["country"] + w["state"]))
        names = {c[0]: c for c in w["cities"]}
        self.assertTrue({"Seattle", "Denver", "Chicago", "Tokyo", "London"} <= set(names))
        self.assertEqual(names["Washington, D.C."][5], 1)                   # a capital
        self.assertAlmostEqual(names["Denver"][2], 39.74, delta=0.1)
        self.assertTrue({"Eugene", "Medford", "Redding"} <= set(names))       # the towns between, for a route along the coast
        self.assertLess(names["Denver"][6], names["Medford"][6])             # ranked: a city is named on a map a town isn't
        self.assertTrue(all(c[6] <= 67 for c in w["cities"]))

    def test_the_route_map_covers_the_whole_world_at_low_zooms_only(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            c = self.charts(d)
            w = c.layers["world"]
            self.assertIn("World_Imagery", w.url)                      # satellite unless set
            self.assertEqual(c.info()["layers"]["world"]["style"], "satellite")
            self.assertTrue(w.allowed(0, 0, 0))
            self.assertTrue(w.allowed(6, 56, 25))                       # Tokyo, half a world from home
            self.assertFalse(w.allowed(7, 112, 50))                     # but no closer than zoom 6
            self.assertFalse(w.allowed(6, 64, 0))                       # and only real tiles
            self.assertIn("Light_Gray", self.charts(d, route="light").layers["world"].url)
            self.assertNotIn("world", self.charts(d, route="off").layers)
            self.assertNotIn("world", self.charts(d, route="nonsense").layers)


class WakeTest(unittest.TestCase):
    def test_categories(self):
        from cloudwall import aircraft
        self.assertEqual([aircraft.wake(t) for t in ("A388", "B77W", "B738", "e75l", "C172")], ["A", "B", "F", "G", "I"])
        self.assertIsNone(aircraft.wake(None))
        self.assertIsNone(aircraft.wake("NOPE"))


class AboutTest(unittest.TestCase):
    """The write-ups a tap on a type opens (cloudwall/data/types/), held to their format."""

    def test_every_file_is_sound(self):
        from cloudwall import about
        self.assertEqual(about.problems(), [])
        self.assertGreater(len(about.covered()), 0)

    def test_every_type_cloudwall_knows_is_written_up(self):
        """Every type CloudWall draws or counts the seats of (data/types.csv, data/seats.csv) opens a
        written page, not just its drawing: a type added to either needs its write-up too."""
        import csv
        from cloudwall import about

        def codes(name):
            with open(Path(about.__file__).parent / "data" / name, encoding="utf-8") as f:
                return {r["type"] for r in csv.DictReader(line for line in f if not line.startswith("#"))}
        missing = (codes("types.csv") | codes("seats.csv")) - set(about.covered())
        self.assertEqual(sorted(missing - self.UNWRITTEN), [], "types with no write-up in cloudwall/data/types/")
        self.assertEqual(sorted(self.UNWRITTEN - missing), [], "these have a write-up now: take them off UNWRITTEN")

    # types in the table for their icon and size, still waiting for a write-up (and a drawing: test_silhouettes)
    UNWRITTEN = {
        "AC6L", "AC90", "AC95", "BE99", "C212", "C425", "C441", "CN35", "D228",
        "DHC3", "DHC6", "E110", "E120", "EPIC", "F27", "F50", "G159", "JS31", "JS32", "JS41", "KODI",
        "MU2", "P180", "PA31T", "PA42", "PAY1", "PAY2", "PAY3", "PAY4", "PC21", "PC6", "PC7", "PC9",
        "SH33", "SH36"}

    def test_a_variant_adds_to_its_family(self):
        from cloudwall import about
        long, short = about.entry("b753"), about.entry("B752")
        self.assertEqual((long["name"], long["family"], short["family"]), ("Boeing 757-300", "Boeing 757", "Boeing 757"))
        self.assertEqual(long["text"][:len(short["text"])], short["text"])          # the family's text, then its own
        self.assertGreater(len(long["text"]), len(short["text"]))
        self.assertEqual(long["production"], [1982, 2005])                            # its family's years
        self.assertTrue(all(isinstance(k, str) and isinstance(v, str) for k, v in long["facts"]))
        self.assertIsNone(about.entry("NOPE"))
        self.assertIsNone(about.entry(None))

    def test_the_737s_and_a320s_each_have_their_own_write_up(self):
        """The models over the house every day don't share their family's page: each has a write-up
        of its own, no paragraph of it its sister's, with its own first flight and delivery years."""
        from cloudwall import about
        families = {"Boeing 737 Next Generation": ("B736", "B737", "B738", "B739"), "Boeing 737 MAX": ("B37M", "B38M", "B39M", "B3XM"),
                    "Airbus A320 family": ("A318", "A319", "A320", "A321"), "Airbus A320neo family": ("A19N", "A20N", "A21N")}
        for family, codes in families.items():
            entries = [about.entry(code) for code in codes]
            self.assertEqual({e["family"] for e in entries}, {family})
            written = [p for e in entries for p in e["text"]]
            self.assertEqual(len(set(written)), len(written), family)
            self.assertTrue(all(2 <= len(e["text"]) <= about.MAX_PARAGRAPHS for e in entries), family)
            self.assertEqual(len({dict(e["facts"])["First flight"] for e in entries}), len(codes), family)
        nine, eight = about.entry("b39m"), about.entry("B38M")
        self.assertEqual((nine["name"], nine["production"], eight["production"]), ("Boeing 737 MAX 9", [2018, None], [2017, None]))
        self.assertEqual(dict(nine["facts"])["Engines"], dict(eight["facts"])["Engines"])      # the family's facts, under its own
        self.assertEqual(about.entry("A318")["production"], [2003, 2015])

    def test_what_is_wrong_is_said(self):
        import tempfile
        from cloudwall import about
        good = 'name = "X"\ntypes = ["XA1", "XB2"]\nchecked = "2026-11"\nsources = ["https://example.com"]\ntext = "One.\\n\\nTwo."\n'
        files = {
            "good.toml": good,
            "broken.toml": "name = ",
            "typo.toml": good.replace('name = "X"', 'name = "Y"\nprodution = [1990]').replace("XA1", "YA1").replace("XB2", "YB2"),
            "twice.toml": good.replace("XB2", "ZZ9"),                        # XA1 is good.toml's
            "bare.toml": 'name = "Z"\ntypes = ["Z1"]\ntext = "Z."\n[facts]\nSeats = "180"\n[variants.Q9]\nname = "Q"\n',
            # a family whose types each have a text of their own needs none; with one that hasn't, it does
            "own.toml": good.replace('text = "One.\\n\\nTwo."\n', "").replace("XA1", "WA1").replace("XB2", "WB2")
                        + '[variants.WA1]\ntext = "A."\n[variants.WB2]\ntext = "B."\n',
            "half.toml": good.replace('text = "One.\\n\\nTwo."\n', "").replace("XA1", "VA1").replace("XB2", "VB2") + '[variants.VA1]\ntext = "A."\n',
        }
        with tempfile.TemporaryDirectory() as d:
            for name, text in files.items():
                Path(d, name).write_text(text)
            real, about.FOLDER = about.FOLDER, Path(d)
            try:
                found = "\n".join(about.problems())
                entries, _ = about._load()
            finally:
                about.FOLDER = real
        for words in ("broken.toml: can't be read", "typo.toml: unknown key 'prodution'", "twice.toml: XA1 is already in good.toml",
                      "bare.toml: needs sources", "bare.toml: needs checked", "bare.toml: seats come from", "bare.toml: variant Q9 isn't in its types",
                      "half.toml: needs a text, or a text of its own for every one of its types"):
            self.assertIn(words, found)
        self.assertNotIn("own.toml", found)
        self.assertEqual(sorted(entries), ["WA1", "WB2", "XA1", "XB2", "ZZ9"])     # sound files count; one with a problem is left out
        self.assertEqual(entries["XA1"]["text"], ["One.", "Two."])
        self.assertEqual((entries["WA1"]["text"], entries["WB2"]["text"]), (["A."], ["B."]))

    def test_paragraphs(self):
        from cloudwall.about import paragraphs
        self.assertEqual(paragraphs("  First line\n wrapped here.\n\n\nSecond.\n"), ["First line wrapped here.", "Second."])
        self.assertEqual(paragraphs(None), [])

    def test_a_type_in_the_logbook(self):
        st = Store(":memory:")
        for i, (t, hexid, airline) in enumerate([("B39M", "a1", "ASA"), ("B39M", "a1", "ASA"), ("B39M", "a2", "UAL"),
                                                 ("E75L", "a3", "QXE"), ("E75L", "a4", "QXE"), ("C172", "a5", None)]):
            st.add_sighting(ts=1000 + i, day="2026-11-21", hex=hexid, type=t, airline_icao=airline, airline=airline and airline.title(),
                            type_name={"C172": "Cessna 172S Skyhawk"}.get(t))
        seen = st.type_seen("B39M")
        self.assertEqual({k: seen[k] for k in ("n", "of", "first", "last", "airframes", "rank", "types")},
                         {"n": 3, "of": 6, "first": 1000, "last": 1002, "airframes": 2, "rank": 1, "types": 3})
        self.assertEqual([(a["icao"], a["n"]) for a in seen["airlines"]], [("ASA", 2), ("UAL", 1)])
        self.assertEqual((st.type_seen("E75L")["rank"], st.type_seen("C172")["rank"]), (2, 3))
        self.assertEqual((st.type_seen("A388")["n"], st.type_seen("A388")["rank"]), (0, None))
        self.assertEqual(st.airframe_seen("a1"), {"n": 2, "first": 1000})
        self.assertEqual(st.airframe_seen("ffffff"), {"n": 0, "first": None})
        # the name a type without a write-up is shown by: the one it was last logged under
        self.assertEqual((st.type_name("C172"), st.type_name("B39M"), st.type_name("A388")), ("Cessna 172S Skyhawk", None, None))


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


class LogosTest(unittest.TestCase):
    def test_airline_codes(self):
        from cloudwall.airlines import iata_for
        self.assertEqual(iata_for("DAL2008"), "DL")
        self.assertEqual(iata_for("QXE2162"), "AS")            # Horizon flies as Alaska
        self.assertEqual(iata_for("XYZ123", "XY"), "XY")       # unknown airline: trust the database code
        self.assertIsNone(iata_for("N733NV", "ZZ"))            # private aircraft: no logo
        self.assertIsNone(iata_for("AMF1977"))                 # known airline with no logo code

    def test_cache_and_missing(self):
        import tempfile, urllib.error
        from cloudwall import logos as L
        with tempfile.TemporaryDirectory() as d:
            lg = L.Logos(config.load(), d)
            calls = []

            class Resp:
                def __init__(self, data): self.data = data
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def read(self): return self.data

            def fake(req, timeout=0):
                calls.append(req.full_url)
                if "/QX" in req.full_url:
                    raise urllib.error.HTTPError(req.full_url, 404, "nope", None, None)
                return Resp(b"\x89PNG fake")

            real, L.urllib.request.urlopen = L.urllib.request.urlopen, fake
            try:
                self.assertTrue(lg.get("DL").startswith(b"\x89PNG"))
                lg.get("DL")
                self.assertIsNone(lg.get("QX"))
                self.assertIsNone(lg.get("QX"))
                self.assertIsNone(lg.get("../etc"))
            finally:
                L.urllib.request.urlopen = real
            self.assertEqual(len(calls), 2)                     # one download each, misses remembered


class BudgetTest(unittest.TestCase):
    def provider(self, today, **settings):
        import datetime as dt
        from cloudwall import flightradar24
        cfg = config.load()
        cfg["flightradar24"] = dict(cfg["flightradar24"], api_key="tok", **settings)
        p = flightradar24.Flightradar24(cfg, Store(":memory:"))
        p._today = lambda: today
        return p, dt

    def test_building_a_provider_starts_nothing(self):
        import datetime as dt
        import threading
        p, _ = self.provider(dt.date(2026, 11, 1), monthly_limit=15000)
        self.assertTrue(p.enabled)
        self.assertNotIn("fr24-usage", [t.name for t in threading.enumerate()])     # its usage check waits for start()

    def test_billing_period(self):
        import datetime as dt
        from cloudwall.live import billing_period
        d = dt.date
        self.assertEqual(billing_period(d(2026, 11, 17), 1), (d(2026, 11, 1), d(2026, 12, 1)))
        self.assertEqual(billing_period(d(2026, 11, 17), 20), (d(2026, 10, 20), d(2026, 11, 20)))
        self.assertEqual(billing_period(d(2026, 12, 25), 20), (d(2026, 12, 20), d(2027, 1, 20)))
        self.assertEqual(billing_period(d(2027, 1, 5), 20), (d(2026, 12, 20), d(2027, 1, 20)))
        self.assertEqual(billing_period(d(2027, 2, 28), 28), (d(2027, 2, 28), d(2027, 3, 28)))

    def test_monthly_budget_with_margin(self):
        import datetime as dt
        p, _ = self.provider(dt.date(2026, 11, 1), monthly_limit=15000)      # first day of a 30-day period
        b = p.budget()
        self.assertEqual(b["period_budget"], 12750)                          # 15% held back
        self.assertEqual(b["daily_limit"], 425)                              # 12,750 / 30 days
        # a busy first fortnight: 500 a day for 14 days
        for i in range(14):
            p.store.cache_put("flightradar24_usage", (dt.date(2026, 11, 1) + dt.timedelta(days=i)).isoformat(), 500)
        p._today = lambda: dt.date(2026, 11, 15)
        b = p.budget()
        self.assertEqual(b["period_used"], 7000)
        self.assertEqual(b["daily_limit"], (12750 - 7000) // 16)             # what's left, spread over 16 days
        self.assertTrue(p.available())

    def test_never_exceeds_budget(self):
        import datetime as dt
        p, _ = self.provider(dt.date(2026, 11, 30), monthly_limit=15000, billing_day=1)
        p.store.cache_put("flightradar24_usage", "2026-11-10", 12700)
        p.store.cache_put("flightradar24_usage", "2026-11-30", 50)           # last day, budget reached
        self.assertEqual(p.budget()["period_used"], 12750)
        self.assertFalse(p.available())
        p._today = lambda: dt.date(2026, 12, 1)                              # new period
        self.assertTrue(p.available())
        self.assertEqual(p.budget()["period_used"], 0)

    def test_daily_cap_still_applies(self):
        import datetime as dt
        p, _ = self.provider(dt.date(2026, 11, 1), monthly_limit=15000, daily_limit=200)
        self.assertEqual(p.budget()["daily_limit"], 200)
        p2, _ = self.provider(dt.date(2026, 11, 1))                           # no monthly limit set
        self.assertEqual(p2.budget()["daily_limit"], 300)


class PresentationDataTest(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.enricher = StubEnricher()
        self.t = Tracker(config.load(), self.store, self.enricher)

    def test_flight_number_and_partner_airline(self):
        from cloudwall.airlines import flight_number
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


class WeatherTest(unittest.TestCase):
    def test_decoding(self):
        from cloudwall import weather as W
        self.assertEqual([W.parse_vis(v) for v in ("10+", "1 1/2", "1/4", 6, None)], [10, 1.5, 0.25, 6, None])
        self.assertEqual(W.ceiling([{"cover": "FEW", "base": 900}, {"cover": "BKN", "base": 2100}, {"cover": "OVC", "base": 6000}]), 2100)
        self.assertEqual([W.category(400, 10), W.category(900, 10), W.category(3000, 10), W.category(None, 4), W.category(None, 10)],
                         ["LIFR", "IFR", "MVFR", "MVFR", "VFR"])
        self.assertEqual(W.wx_words("-RA BR"), "light rain, mist")
        self.assertEqual(W.wx_words("+TSRA"), "heavy thunderstorm with rain")
        self.assertEqual(W.wx_words("SHRA"), "rain showers")
        self.assertEqual(W.humidity(9.0, 7.0), 87)
        self.assertAlmostEqual(W.density_altitude(23, 9.0, 1018.7), -836, delta=20)   # cool, high pressure: well below field

    def test_real_shapes(self):
        from cloudwall import weather as W
        m = {"icaoId": "KPDX", "obsTime": 1794890160, "temp": 8.9, "dewp": 6.7, "wdir": 0, "wspd": 0, "visib": "10+",
             "altim": 1018.7, "metarType": "SPECI", "rawOb": "SPECI KPDX ...", "elev": 7, "cover": "BKN", "fltCat": "VFR",
             "clouds": [{"cover": "FEW", "base": 2000}, {"cover": "SCT", "base": 2500}, {"cover": "BKN", "base": 6000}]}
        d = W.decode_metar(m, 23)
        self.assertEqual((d["ceiling"], d["category"], d["altimeter_inhg"], d["visibility"], d["special"]), (6000, "VFR", 30.08, 10, True))
        self.assertEqual([c["oktas"] for c in d["clouds"]], [2, 4, 6])
        t = W.decode_taf({"rawTAF": "TAF", "fcsts": [{"timeFrom": 1, "timeTo": 2, "wdir": "VRB", "wspd": 4, "visib": "6+",
                                                      "clouds": [{"cover": "OVC", "base": 4000}]}]})
        p = t["periods"][0]
        self.assertEqual((p["category"], p["wind"]["variable"], p["visibility"]), ("VFR", True, 6))

    def test_demo(self):
        from cloudwall import weather as W
        short, full = W.demo()
        self.assertEqual(len(full["history"]), 25)
        self.assertTrue(full["taf"]["periods"])
        json.dumps(full)


class FeedExtrasTest(unittest.TestCase):
    def test_extra_fields(self):
        raw = {"hex": "ac32f2", "flight": "SWA4083 ", "r": "N8851Q", "t": "B38M", "desc": "BOEING 737 MAX 8", "year": "2023",
               "ownOp": "SOUTHWEST AIRLINES CO", "alt_baro": 9000, "gs": 300, "lat": 45.6, "lon": -122.5, "baro_rate": -1200,
               "nav_altitude_mcp": 6016, "nav_modes": ["autopilot", "althold", "lnav"], "dbFlags": 8}
        a = sources.normalise(raw)
        self.assertEqual((a["desc"], a["year"], a["target_alt"], a["modes"]), ("Boeing 737 MAX 8", 2023, 6016, ["autopilot", "althold", "lnav"]))
        self.assertTrue(a["private_owner"])                       # LADD flag
        self.assertEqual(sources.tidy_type("CESSNA 172S SKYHAWK SP"), "Cessna 172S Skyhawk SP")
        self.assertEqual(sources.tidy_type("Airbus A321neo"), "Airbus A321neo")

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


class PhotoTest(unittest.TestCase):
    def test_photo_comes_from_planespotters_with_its_credit(self):
        from unittest import mock
        from cloudwall import enrich
        answer = {"photos": [
            {"id": "1", "thumbnail_large": {"src": "javascript:alert(1)"},       # not an image link
             "link": "https://www.planespotters.net/photo/1/n24706", "photographer": "A. Spotter"},
            {"id": "2", "thumbnail": {"src": "https://t.plnspttrs.net/2_280.jpg"},
             "thumbnail_large": {"src": "https://t.plnspttrs.net/2_t.jpg"},
             "link": "https://www.planespotters.net/photo/2/n24706", "photographer": " B. Spotter "}]}
        with mock.patch.object(enrich, "get_json", return_value=answer) as get:
            pic = enrich.fetch_photo("a24c77", "N24706", "B737")
        url = get.call_args[0][0]
        self.assertTrue(url.startswith("https://api.planespotters.net/pub/photos/hex/A24C77?"))
        self.assertIn("reg=N24706", url)
        self.assertIn("icaoType=B737", url)
        self.assertEqual(pic, {"src": "https://t.plnspttrs.net/2_t.jpg",
                               "link": "https://www.planespotters.net/photo/2/n24706", "by": "B. Spotter"})
        # nothing to credit, or no photos at all: no photo
        with mock.patch.object(enrich, "get_json", return_value={"photos": [
                {"thumbnail_large": {"src": "https://t.plnspttrs.net/3.jpg"}, "link": "https://www.planespotters.net/photo/3"}]}):
            self.assertIsNone(enrich.fetch_photo("a24c77"))
        with mock.patch.object(enrich, "get_json", return_value=None):
            self.assertIsNone(enrich.fetch_photo("a24c77"))

    def test_registry_photo_is_not_used(self):
        # adsbdb's photo is filed by tail number and can show an older aircraft that wore it
        from unittest import mock
        from cloudwall import enrich
        answer = {"response": {"aircraft": {"type": "737NG 724/W", "manufacturer": "Boeing", "registration": "N24706",
                                            "registered_owner": "United Airlines",
                                            "url_photo": "https://image.airport-data.com/aircraft/826984.jpg"}}}
        with mock.patch.object(enrich, "get_json", return_value=answer):
            self.assertNotIn("photo", enrich.fetch_aircraft("A24C77"))

    def test_credit_follows_the_photo_into_the_logbook(self):
        class Photos(StubEnricher):
            def photo(self, hexid, reg=None, icao_type=None):
                self.asked = (hexid, reg, icao_type)
                return {"src": "https://t.plnspttrs.net/2_t.jpg", "link": "https://www.planespotters.net/photo/2/n24706",
                        "by": "B. Spotter"}
        e = Photos()
        t = Tracker(config.load(), Store(":memory:"), e)
        t.update([plane("a24c77", "UAL1420", 0.5, typ="B737", reg="N24706")], "test")
        h = t.snapshot()["hero"]
        self.assertEqual(e.asked, ("a24c77", "N24706", "B737"))
        self.assertEqual((h["photo"], h["photo_by"]), ("https://t.plnspttrs.net/2_t.jpg", "B. Spotter"))
        s = t.store.logbook(time.strftime("%Y-%m-%d"))["recent"][0]
        self.assertEqual((s["photo"], s["photo_by"], s["photo_link"]),
                         ("https://t.plnspttrs.net/2_t.jpg", "B. Spotter", "https://www.planespotters.net/photo/2/n24706"))


class ActivityTest(unittest.TestCase):
    def test_idle_and_wake(self):
        import threading
        from cloudwall.activity import Activity
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


class ServerTest(unittest.TestCase):
    def serve(self, cfg, saved=None, charts=None):
        """A server over every place in cfg, with no threads started and no network lookups."""
        import threading
        from cloudwall.place import Place, Places
        from cloudwall.server import make_server
        cfg["server"]["host"], cfg["server"]["port"] = "127.0.0.1", 0

        def make(pc):
            place = Place(pc, Store(":memory:"), sources.Demo())
            place.tracker.enricher = StubEnricher()
            place.start = lambda: None
            return place
        places = Places(cfg, make, saved)
        for pc in config.places(cfg):
            places.add_config(pc)
        places.load_saved()
        srv = make_server(cfg, places, charts)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{srv.server_address[1]}", places

    def get(self, url):
        import urllib.request
        return urllib.request.urlopen(url, timeout=5).read()

    def test_a_type_must_be_a_type(self):
        import urllib.error
        base, _ = self.serve(config.load())
        self.assertEqual(json.loads(self.get(base + "/api/type?type=e75l&hex=NOT-HEX"))["airframe"], None)
        for bad in ("", "?type=", "?type=B7%27;--", "?type=TOOLONG"):
            with self.assertRaises(urllib.error.HTTPError) as e:
                self.get(base + "/api/type" + bad)
            self.assertEqual(e.exception.code, 400)

    def test_kiosk_and_desktop_serve_the_same_page(self):
        base, _ = self.serve(config.load())
        home = self.get(base + "/")
        for path in ("/kiosk", "/kiosk/"):
            self.assertEqual(self.get(base + path), home)

    def test_a_private_link(self):
        """With [server] key set, CloudWall answers only under /k/<key>/, and there as it always
        does: the page, the wall panel, the API. A request without the key is told nothing, whatever
        it asks for or tries to change. The key is the same typed without its hyphens or in capitals."""
        import urllib.error
        import urllib.request
        cfg = config.load()
        cfg["server"]["key"] = "tafo-kemi-luza-nobe"
        base, places = self.serve(cfg)
        opened, _ = self.serve(config.load())
        home = self.get(opened + "/")
        for key in ("tafo-kemi-luza-nobe", "tafokemiluzanobe", "TAFO-KEMI-LUZA-NOBE"):
            self.assertEqual(self.get(f"{base}/k/{key}/"), home)
            self.assertEqual(self.get(f"{base}/k/{key}/kiosk"), home)
            self.assertIn("aircraft", json.loads(self.get(f"{base}/k/{key}/api/state?range=15")))
        self.assertEqual(self.get(f"{base}/k/tafo-kemi-luza-nobe"), home)             # the closing slash is added for it
        for path in ("/", "/kiosk", "/api/state", "/api/logbook", "/js/app.js", "/k/", "/k//", "/k/tafo-kemi-luza-nobx/",
                     "/k/tafo-kemi/", "/k/wrong/api/state", "/x/k/tafo-kemi-luza-nobe/"):
            with self.assertRaises(urllib.error.HTTPError, msg=path) as e:
                self.get(base + path)
            self.assertEqual(e.exception.code, 401, path)
            self.assertNotIn(b"aircraft", e.exception.read())
        for method, path in (("POST", "/api/places"), ("DELETE", "/api/places?id=home")):
            req = urllib.request.Request(base + path, data=b'{"q": "97201"}', method=method, headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(req, timeout=5)
            self.assertEqual(e.exception.code, 401, method)
        self.assertEqual(len(places.summaries()), 1)                                    # nothing was added or removed

    def test_a_key_worth_having(self):
        from cloudwall import access
        keys = {access.new_key() for _ in range(50)}
        self.assertEqual(len(keys), 50)
        for key in keys:
            self.assertRegex(key, r"^([bdfghjkmnprstvz][aeiou]){2}(-([bdfghjkmnprstvz][aeiou]){2}){3}$")      # typed once, said aloud
            self.assertIsNone(access.problem(key))
        self.assertIsNone(access.problem(""))                                           # none set: open, as on a home network
        for bad in ("short-key", "has spaces in the key", "slash/in/the/key/x", 12345678901234):
            self.assertTrue(access.problem(bad), bad)
        for bad in ("letmein", "a key with spaces"):
            with self.assertRaises(ValueError):
                config.check("server", {"key": bad})
        self.assertEqual(access.admit("/k/Tafo-Kemi-Luza-Nobe/api/state?range=15", access.tidy("tafo-kemi-luza-nobe")), ("in", "/api/state?range=15"))

    def test_the_private_link_is_written_into_the_config(self):
        import tempfile
        from pathlib import Path
        from cloudwall import access
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.toml"
            # a [server] section with no key: added after its settings, ahead of the comment below them
            p.write_text('[home]\nlat = 45.6\n\n[server]\nport = 5051\n# a note\n\n[storage]\ndb_path = ""\n')
            access.write_key(p, "tafo-kemi-luza-nobe")
            text = p.read_text()
            self.assertIn('port = 5051\nkey = "tafo-kemi-luza-nobe"\n# a note', text)
            self.assertEqual(config.load(str(p))["server"]["key"], "tafo-kemi-luza-nobe")
            access.write_key(p, "bado-fegi-huja-kalo")                   # a new one replaces it, in place
            self.assertEqual(p.read_text(), text.replace("tafo-kemi-luza-nobe", "bado-fegi-huja-kalo"))
            access.write_key(p, "")                                      # off: open again
            self.assertEqual(config.load(str(p))["server"]["key"], "")
            q = Path(d) / "other.toml"                                   # no [server] at all: one is added
            q.write_text('[home]\nlat = 45.6\n')
            access.write_key(q, "tafo-kemi-luza-nobe")
            self.assertEqual(q.read_text(), '[home]\nlat = 45.6\n\n[server]\nkey = "tafo-kemi-luza-nobe"\n')
            # the example config, with its commented-out key, takes one too
            e = Path(d) / "example.toml"
            e.write_text(config.EXAMPLE.read_text())
            access.write_key(e, "tafo-kemi-luza-nobe")
            self.assertEqual(config.load(str(e))["server"]["key"], "tafo-kemi-luza-nobe")
        links = dict(access.links("tafo-kemi-luza-nobe", "192.168.1.20", 5050))
        self.assertEqual(links["The wall panel"], "http://192.168.1.20:5050/k/tafo-kemi-luza-nobe/kiosk")

    def test_a_screen_asks_for_its_radar_range(self):
        base, places = self.serve(config.load())
        t = places["home"].tracker
        for q in ("?range=99", "?range=x", ""):                     # not offered, not a number, none
            s = json.loads(self.get(base + "/api/state" + q))
            self.assertEqual(t.fetch_radius(), 15)
        self.assertEqual(s["ranges"], [15, 20, 30])
        self.assertEqual(s["kiosk"], {"place": "", "view": "card", "radar": "chart", "tracks": True, "range_nm": 0,
                                      "density": "simple", "quiet": ""})
        self.get(base + "/api/state?range=30")
        self.assertEqual(t.fetch_radius(), 30)
        self.get(base + "/api/state?range=30&square=1")             # the ATC style's square screen
        self.assertEqual(t.fetch_radius(), 42.4)
        self.get(base + "/api/state?range=30&reach=1.8")            # the Map view on a tall panel
        self.assertEqual(t.fetch_radius(), 54)
        for bad in ("x", "nan", "inf"):                              # not a number, or not one to take
            self.get(base + f"/api/state?range=15&reach={bad}")

    def test_chart_layers_are_served_by_name(self):
        import tempfile
        import urllib.error
        from cloudwall.charts import Charts
        with tempfile.TemporaryDirectory() as d:
            cfg = config.load()
            charts = Charts(cfg, d)
            for lid, t in charts.layers.items():
                t._download = (lambda lid: lambda z, x, y: (lid.encode(), "image/png"))(lid)
            base, _ = self.serve(cfg, charts=charts)
            self.assertEqual(self.get(base + "/tiles/ifr-low/11/326/731"), b"ifr-low")
            self.assertEqual(self.get(base + "/tiles/sectional/11/326/731"), b"sectional")
            self.assertEqual(self.get(base + "/tiles/11/326/731"), b"map")     # the radar's map, as before
            for bad in ("/tiles/ifr-low/12/652/1462", "/tiles/nope/11/326/731", "/tiles/ifr-low/11/326/x",
                        "/tiles/ifr-low/11/100/100"):            # past its zooms, no layer, not a tile, far away
                with self.assertRaises(urllib.error.HTTPError) as e:
                    self.get(base + bad)
                self.assertEqual(e.exception.code, 404)
            s = json.loads(self.get(base + "/api/state"))
            self.assertIn("charts", s)

    def test_screens_are_told_when_the_code_has_changed_since_it_started(self):
        from cloudwall import server as S
        base, _ = self.serve(config.load())
        self.assertFalse(json.loads(self.get(base + "/api/state"))["restart"])
        watch = S.CodeWatch()
        self.assertFalse(watch())                                   # just started
        real = S.code_stamp
        S.code_stamp = lambda: "pulled"                              # an update lands on disk
        try:
            self.assertFalse(watch())                               # not looked at again within the minute
            watch.checked -= S.CODE_CHECK_S
            self.assertTrue(watch())
            S.code_stamp = real                                     # it stays said until a restart
            watch.checked -= S.CODE_CHECK_S
            self.assertTrue(watch())
        finally:
            S.code_stamp = real
        self.assertEqual(S.code_stamp(), S.code_stamp())            # the same code, the same stamp

    def test_each_screen_shows_its_own_place(self):
        cfg = config.load()
        cfg["places"] = [{"name": "Cabin", "lat": 44.06, "lon": -121.31, "airport": "KRDM"}]
        cfg["kiosk"]["place"] = "Cabin"
        base, places = self.serve(cfg)
        home, cabin = places["home"], places["cabin"]
        s = json.loads(self.get(base + "/api/state"))               # no place: the first
        self.assertEqual((s["place"], s["airport"]["icao"]), ("home", "KPDX"))
        self.assertEqual([p["id"] for p in s["places"]], ["home", "cabin"])
        self.assertTrue(home.activity.idle() is False and cabin.activity.idle())   # only the one asked for wakes
        s = json.loads(self.get(base + "/api/state?kiosk=1"))       # the kiosk's configured place
        self.assertEqual((s["place"], s["airport"]["icao"], s["home"]["lat"]), ("cabin", "KRDM", 44.06))
        self.assertFalse(cabin.activity.idle())
        s = json.loads(self.get(base + "/api/state?place=nowhere"))  # not a place: the first
        self.assertEqual(s["place"], "home")
        # the cabin sits at Redmond's elevation (3,070 ft) unless told otherwise: fly well above it
        self.assertEqual(cabin.cfg["home"]["elevation_ft"], 3070)
        cabin.tracker.update([plane("c1", "ASA9", 0.5, alt=8000, home=cabin.cfg["home"])], "test")
        s = json.loads(self.get(base + "/api/state?place=cabin&pin=c1"))   # a screen at the cabin taps c1
        self.assertEqual((s["pinned"], s["hero"]["hex"]), ("c1", "c1"))
        self.assertEqual(set(cabin.tracker.pins), {"c1"})
        self.assertEqual(home.tracker.pins, {})                      # wanted at the cabin only
        self.assertEqual(json.loads(self.get(base + "/api/logbook?place=cabin"))["today"], 1)   # logged there
        self.assertEqual(json.loads(self.get(base + "/api/logbook"))["today"], 0)


    def send(self, url, method, body=None):
        import urllib.error, urllib.request
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method)
        try:
            return 200, json.loads(urllib.request.urlopen(req, timeout=5).read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_a_screen_sets_up_places_by_zip_code(self):
        import tempfile
        saved = Path(tempfile.mkdtemp()) / "places.json"
        base, places = self.serve(config.load(), saved)
        loc = json.loads(self.get(base + "/api/locate?q=98660"))        # west Vancouver
        self.assertEqual((loc["zip"], loc["auto"], loc["airports"][0]["icao"]), ("98660", "KPDX", "KPDX"))
        self.assertAlmostEqual(loc["lat"], 45.6612, places=3)
        code, r = self.send(base + "/api/places", "POST", {"q": "97702", "name": "Cabin"})      # Bend: Redmond's airport
        self.assertEqual((code, r["place"]["id"], r["place"]["icao"], r["place"]["added"]), (200, "cabin", "KRDM", True))
        code, r = self.send(base + "/api/places", "POST", {"q": "45.64, -122.66", "airport": "khio"})
        self.assertEqual((r["place"]["name"], r["place"]["icao"]), ("45.640, -122.660", "KHIO"))
        s = json.loads(self.get(base + "/api/state?place=cabin"))
        self.assertEqual((s["place"], s["airport"]["icao"], s["home"]["zip"]), ("cabin", "KRDM", "97702"))
        for bad in ({"q": "hello"}, {"q": "00501"}, {"q": "98660", "airport": "ZZZZ"}):
            self.assertEqual(self.send(base + "/api/places", "POST", bad)[0], 400)
        self.assertEqual(self.send(base + "/api/places?id=home", "DELETE")[0], 400)    # the config's stays
        self.assertEqual(json.loads(saved.read_text())[0]["zip"], "97702")
        _, places2 = self.serve(config.load(), saved)                   # after a restart: back again
        self.assertEqual([p.id for p in places2], ["home", "cabin", "45-640-122-660"])
        cabin = places["cabin"]
        code, r = self.send(base + "/api/places?id=cabin", "DELETE")
        self.assertEqual((code, [p["id"] for p in r["places"]]), (200, ["home", "45-640-122-660"]))
        self.assertTrue(cabin.stopped.is_set())                         # its threads wind down
        self.assertEqual([e["name"] for e in json.loads(saved.read_text())], ["45.640, -122.660"])

    def test_a_saved_place_keeps_its_id_and_so_its_logbook(self):
        import tempfile
        saved = Path(tempfile.mkdtemp()) / "places.json"
        base, places = self.serve(config.load(), saved)
        for q in ("97702", "47.60, -122.30"):                           # two cabins: near Bend, then near Seattle
            self.assertEqual(self.send(base + "/api/places", "POST", {"q": q, "name": "Cabin"})[0], 200)
        self.assertEqual([(p.id, p.cfg["airport"]["icao"]) for p in places][1:], [("cabin", "KRDM"), ("cabin-2", "KSEA")])
        self.send(base + "/api/places?id=cabin", "DELETE")
        _, again = self.serve(config.load(), saved)                     # after a restart
        # Seattle's is still cabin-2: as "cabin" it would carry on in Bend's logbook (cloudwall-cabin.db)
        self.assertEqual([(p.id, p.cfg["airport"]["icao"]) for p in again][1:], [("cabin-2", "KSEA")])
        # a file from before ids were kept: numbered as it always was, and the ids written down
        saved.write_text(json.dumps([{"name": "Cabin", "lat": 47.6, "lon": -122.3, "zip": None, "airport": "auto"}, "junk"]))
        _, old = self.serve(config.load(), saved)
        self.assertEqual([p.id for p in old], ["home", "cabin"])
        self.assertEqual([e["id"] for e in json.loads(saved.read_text())], ["cabin"])

    def test_only_cloudwalls_own_page_changes_places(self):
        import urllib.error
        import urllib.request
        base, places = self.serve(config.load())

        def ask(method, url, headers, body=b'{"q": "97702", "name": "Cabin"}'):
            req = urllib.request.Request(base + url, data=body if method == "POST" else None, method=method, headers=headers)
            try:
                return urllib.request.urlopen(req, timeout=5).status
            except urllib.error.HTTPError as e:
                return e.code
        # another site's page, open in a browser on the home network, can't set places up
        self.assertEqual(ask("POST", "/api/places", {"Origin": "http://elsewhere.example"}), 403)
        self.assertEqual(ask("POST", "/api/places", {"Sec-Fetch-Site": "cross-site"}), 403)
        self.assertEqual(len(places), 1)
        self.assertEqual(ask("POST", "/api/places", {"Origin": base}), 200)              # CloudWall's own page can
        self.assertEqual(ask("POST", "/api/places", {}, b'{"q": "' + b"9" * 20000 + b'"}'), 400)   # nor is a huge body read
        self.assertEqual(ask("DELETE", "/api/places?id=cabin", {"Origin": "http://elsewhere.example"}), 403)
        self.assertEqual([p.id for p in places], ["home", "cabin"])
        self.assertEqual(ask("DELETE", "/api/places?id=cabin", {"Origin": base}), 200)

    def test_a_new_place_doesnt_carry_on_in_a_removed_places_logbook(self):
        import tempfile
        from cloudwall.place import Place, Places
        from cloudwall.store import another_places
        folder = Path(tempfile.mkdtemp())
        db_for = lambda pid: folder / f"cloudwall-{pid}.db"

        def make(pc):                                                   # as cloudwall.__main__ makes them
            store = Store(str(db_for(pc["place"]["id"])))
            self.addCleanup(store.close)
            store.claim(pc["home"])
            place = Place(pc, store, sources.Demo(), demo=True)
            place.start = lambda: None
            return place
        places = Places(config.load(), make, None, elsewhere=lambda pid, home: another_places(db_for(pid), home))
        for pc in config.places(config.load()):
            places.add_config(pc)
        self.assertEqual(places.add({"name": "Cabin", "zip": "97702"}).id, "cabin")              # near Bend
        places.remove("cabin")                                          # its logbook stays: cloudwall-cabin.db
        self.assertEqual(places.add({"name": "Cabin", "lat": 47.6, "lon": -122.3}).id, "cabin-2")   # another cabin: its own
        places.remove("cabin-2")
        self.assertEqual(places.add({"name": "Cabin", "zip": "97702"}).id, "cabin")              # Bend's again: carries on


class SeatsTest(unittest.TestCase):
    def test_airline_layout_then_type_then_cargo(self):
        from cloudwall.seats import seats
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


class VideoMapTest(unittest.TestCase):
    def test_portlands_class_c_and_the_vors_around_it(self):
        from cloudwall import airports
        home = config.DEFAULTS["home"]
        areas = airports.airspace_near(home["lat"], home["lon"], own="PDX")
        self.assertEqual(sorted((a["id"], a["class"], a["floor"], a["ceiling"]) for a in areas),
                         [("PDX", "C", f, 4000) for f in (0, 1100, 1700, 1800, 2000, 2300)])
        self.assertTrue(all(len(r) >= 3 and len(r[0]) == 2 for a in areas for r in a["rings"]))
        self.assertEqual([n["ident"] for n in airports.navaids_near(home["lat"], home["lon"])], ["CBU", "BTG", "UBG"])
        cfg = config.complete_place(config.load())
        self.assertEqual(len(cfg["airport"]["airspace"]), 6)
        self.assertEqual(cfg["airport"]["navaids"][1]["type"], "VORTAC")

    def test_class_d_only_for_the_places_own_airport(self):
        from cloudwall import airports
        rdm = airports.lookup("KRDM")
        self.assertEqual({a["class"] for a in airports.airspace_near(rdm["lat"], rdm["lon"], own="RDM")}, {"D"})
        self.assertEqual(airports.airspace_near(rdm["lat"], rdm["lon"], own="XXX"), [])

    def test_label_points_fall_inside_a_wrapped_shelf(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build_data", Path(__file__).resolve().parent.parent / "tools" / "build_data.py")
        bd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bd)
        # a C-shaped shelf around a gap where its centre of mass falls
        shelf = [[0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 3], [3, 3], [3, 0]]
        self.assertFalse(bd.inside(1.5, 2, shelf))
        self.assertTrue(bd.inside(*bd.label_point(shelf), shelf))
        line = [[0, 0], [0.5, 0.0001], [1, 0], [1, 1]]
        self.assertEqual(bd.simplify(line, 0.001), [[0, 0], [1, 0], [1, 1]])


class SmallFieldTest(unittest.TestCase):
    def test_light_aircraft_at_pearson(self):
        from cloudwall import airports
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
        from cloudwall import airports
        t = Tracker(config.load(), Store(":memory:"), StubEnricher())
        grove = airports.lookup("1W1")                                   # Camas, 429 ft
        a = plane("g2", "N12345", 0, alt=1300, typ="C172", category="A1", vrate=-400, track=250)
        a.update(lat=grove["lat"], lon=grove["lon"] + 0.015)
        self.assertEqual(t.details.infer_local(a), "arriving")
        self.assertEqual(a["local_field"], {"code": "1W1", "name": "Grove Field", "city": "Camas"})


class TFRTest(unittest.TestCase):
    XML = """<XNOTAM-Update><Group><Add><Not><NotUid><txtLocalName>261121 Parade Portland, OR DHS - UAS Only</txtLocalName></NotUid>
      <dateEffective>2026-11-21T21:00:00</dateEffective><dateExpire>2026-11-22T04:59:00</dateExpire>
      <TfrNot><codeType>99.7</codeType><TFRAreaGroup><aseTFRArea><codeDistVerUpper>HEI</codeDistVerUpper><valDistVerUpper>400</valDistVerUpper>
      <uomDistVerUpper>FT</uomDistVerUpper><codeDistVerLower>HEI</codeDistVerLower><valDistVerLower>0</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>
      </aseTFRArea></TFRAreaGroup></TfrNot><txtDescrUSNS>FULL TEXT</txtDescrUSNS></Not></Add></Group></XNOTAM-Update>"""

    def test_parse_detail(self):
        from cloudwall.tfr import parse_detail
        d = parse_detail(self.XML)
        self.assertEqual(d["name"], "Parade Portland, OR DHS - UAS Only")
        self.assertTrue(d["drones_only"])
        self.assertEqual(d["kind"], "Security")
        self.assertEqual((d["floor"]["text"], d["ceiling"]["text"]), ("the surface", "400 ft above ground"))
        self.assertEqual(d["end"] - d["start"], 7 * 3600 + 59 * 60)

    def test_nearby_only_and_cached(self):
        from cloudwall.tfr import TFRs
        home = {"lat": 45.59, "lon": -122.47}
        square = lambda lat, lon, r: {"type": "Polygon", "coordinates": [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]]}
        shapes = {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "LAST_MODIFICATION_DATETIME": "1"}, "geometry": square(45.59, -122.47, 0.05)},
            {"properties": {"NOTAM_KEY": "6/2222-1-FDC-F", "LAST_MODIFICATION_DATETIME": "1"}, "geometry": square(38.9, -77.0, 0.1)}]}
        texts = []
        lists = []
        t = TFRs(fetch_json=lambda url, timeout: lists.append(url) or shapes, fetch_text=lambda url, timeout: texts.append(url) or self.XML)
        out = t.near(t.fetch(), home, 30, now=1e9)
        self.assertEqual([x["id"] for x in out], ["6/1111"])
        self.assertEqual(out[0]["dist_nm"], 0.0)                     # home is inside it
        t.near(t.fetch(), home, 30, now=1e9)
        self.assertEqual(len(texts), 1)                                # details fetched once
        # the one list serves every place: another, by Washington, takes its own share of it
        self.assertEqual([x["id"] for x in t.near(shapes["features"], {"lat": 38.9, "lon": -77.0}, 30, now=1e9)], ["6/2222"])
        self.assertEqual(len(lists), 2)

    def test_the_records_the_faa_issues_now(self):
        """A paragraph after the regulation, drone restrictions under 49 U.S.C. 44812 with the
        requesting office's reference before the name, and records named only by their number."""
        from cloudwall.tfr import TFRs, parse_detail
        drones = parse_detail(self.XML.replace("261121 Parade Portland, OR DHS - UAS Only", "2026-44812-CSA-0138 MDW Mag Mile Lights")
                              .replace("99.7", "44812"))
        self.assertEqual((drones["name"], drones["drones_only"]), ("MDW Mag Mile Lights", True))
        fire = self.XML.replace("261121 Parade Portland, OR DHS - UAS Only", "6/1111").replace("99.7", "91.137(a)(1)")
        self.assertEqual((parse_detail(fire)["kind"], parse_detail(fire)["drones_only"]),
                         ("Disaster or hazard area (often a wildfire)", False))
        ring = [[-122.5, 45.5], [-122.4, 45.5], [-122.4, 45.7], [-122.5, 45.7], [-122.5, 45.5]]
        shapes = {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "TITLE": "Camas, WA, Saturday, November 21, 2026 Local"},
             "geometry": {"type": "Polygon", "coordinates": [ring]}},
            {"properties": {"NOTAM_KEY": "6/3333-1-FDC-F"}, "geometry": None}]}       # no shape: left out, not an error
        t = TFRs(fetch_json=lambda url, timeout: shapes, fetch_text=lambda url, timeout: fire)
        near = t.near(t.fetch(), {"lat": 45.59, "lon": -122.47}, 30, now=1e9)
        self.assertEqual([(x["id"], x["name"]) for x in near], [("6/1111", "Camas, WA")])


class ContrailTest(unittest.TestCase):
    def test_schmidt_appleman(self):
        from cloudwall.contrails import level, for_altitude
        self.assertEqual(level(250, -30, 100, 10400)["state"], "none")          # too warm at any humidity
        self.assertEqual(level(250, -55, 20, 10400)["state"], "short")          # cold but dry: forms, fades
        self.assertEqual(level(250, -55, 110, 10400)["state"], "persistent")    # ice-saturated: lingers
        c = {"levels": [level(250, -55, 110, 10400)]}
        self.assertEqual(for_altitude(c, 34000), "persistent")
        self.assertIsNone(for_altitude(c, 12000))

    @unittest.skipUnless(hasattr(time, "tzset"), "needs tzset")
    def test_the_forecast_hours_are_utc(self):
        import os
        from cloudwall import contrails
        hours = {"time": [f"2026-07-15T{h:02d}:00" for h in range(24)]}
        for p in contrails.LEVELS:                                      # each hour a degree colder, to tell them apart
            hours.update({f"temperature_{p}hPa": [-30.0 - h for h in range(24)], f"relative_humidity_{p}hPa": [50] * 24,
                          f"geopotential_height_{p}hPa": [10000] * 24})
        real, tz = contrails.get_json, os.environ.get("TZ")
        contrails.get_json = lambda url, timeout=0: {"hourly": hours}
        os.environ["TZ"] = "America/Los_Angeles"                        # in July its clock is on daylight time
        time.tzset()
        try:
            noon = 1784116800                                           # 2026-07-15 12:00 UTC
            c = contrails.fetch(45.6, -122.5, now=noon + 600)
            self.assertEqual((c["at"], c["levels"][0]["temp_c"]), (noon, -42.0))     # the 12:00 hour, not 13:00's
        finally:
            contrails.get_json = real
            os.environ.pop("TZ", None) if tz is None else os.environ.update(TZ=tz)
            time.tzset()


class MilitaryTest(unittest.TestCase):
    def test_positionless_nearby_only(self):
        feed = {"ac": [
            {"hex": "ae0001", "t": "F15", "alt_baro": 15000, "rr_lat": 45.6, "rr_lon": -122.6, "seen": 2, "dbFlags": 1},
            {"hex": "ae0002", "t": "F15", "alt_baro": 15000, "rr_lat": 47.6, "rr_lon": -122.3, "seen": 2, "dbFlags": 1},   # Seattle
            {"hex": "ae0003", "t": "C17", "alt_baro": 30000, "lat": 45.6, "lon": -122.6, "seen": 1, "dbFlags": 1}]}      # has a position
        real = sources.get_json
        sources.get_json = lambda url, timeout: feed
        try:
            heard = sources.military_unplaced()                          # one request, whatever the places
            out = sources.heard_near(heard, {"lat": 45.59, "lon": -122.47}, 40)
            self.assertEqual([a["hex"] for a in sources.heard_near(heard, {"lat": 47.6, "lon": -122.3}, 40)], ["ae0002"])
        finally:
            sources.get_json = real
        self.assertEqual([(a["hex"], a["alt"], a["military"]) for a in out], [("ae0001", 15000, True)])



class PaidLookupTroubleTest(unittest.TestCase):
    """A paid provider that is down or turns a request away isn't asked again with every update."""

    def provider(self, route):
        class Provider:
            name, label, mode, general_aviation, enabled, ok = "fake", "Fake24", "always", False, True, True
            def available(self): return self.ok
        p = Provider()
        p.route = lambda callsign: route(p, callsign)
        return p

    def settle(self, e):
        for _ in range(300):
            if e.live_route("ASA512", fetch=False)[0] == "done":
                return
            time.sleep(0.01)
        self.fail("the lookup never finished")

    def test_a_failed_lookup_waits_before_it_is_tried_again(self):
        from cloudwall import enrich
        calls = []

        def route(p, callsign):
            calls.append(callsign)
            raise OSError("timed out")
        e = Enricher(Store(":memory:"), live=self.provider(route))
        self.assertEqual(e.live_route("ASA512", fetch=True), ("pending", None))
        self.settle(e)
        # the next updates get "nothing yet" (so the free route shows) without another billed request
        self.assertEqual([e.live_route("ASA512", fetch=True) for _ in range(5)], [("done", None)] * 5)
        self.assertEqual(calls, ["ASA512"])
        self.assertFalse(e.store.cache_get("live_route", "fake:ASA512", 3600)[0])     # and it isn't kept as "no route"
        k = ("live_route", "fake:ASA512")
        e.mem[k] = (None, e.mem[k][1] - enrich.LIVE_RETRY)                              # five minutes on
        self.assertNotEqual(e.live_route("ASA512", fetch=False)[0], "done")           # it may be asked again

    def test_a_refused_lookup_is_not_kept_as_no_route(self):
        def route(p, callsign):
            p.ok = False                                                # HTTP 429: paused for a minute, nothing learned
            return None
        e = Enricher(Store(":memory:"), live=self.provider(route))
        e.live_route("ASA512", fetch=True)
        self.settle(e)
        self.assertFalse(e.store.cache_get("live_route", "fake:ASA512", 3600)[0])

    def test_a_flight_the_provider_hasnt_caught_up_with_is_asked_about_again(self):
        from cloudwall.live import NotYet

        def route(p, callsign):                                         # just after takeoff: it only knows the leg before
            raise NotYet(callsign)
        e = Enricher(Store(":memory:"), live=self.provider(route))
        e.live_route("ASA512", fetch=True)
        self.settle(e)
        self.assertEqual(e.live_route("ASA512", fetch=True), ("done", None))          # the free route shows for now
        self.assertFalse(e.store.cache_get("live_route", "fake:ASA512", 3600)[0])     # not "no route" for 45 minutes

    def test_no_route_found_is_kept(self):
        e = Enricher(Store(":memory:"), live=self.provider(lambda p, callsign: None))
        e.live_route("ASA512", fetch=True)
        self.settle(e)
        self.assertEqual(e.store.cache_get("live_route", "fake:ASA512", 3600), (True, None))


class PackagingTest(unittest.TestCase):
    def test_every_bundled_file_is_packaged(self):
        """An installed copy (pip install ., not the editable one) carries every file the display and
        the tables need: a new folder under web/ or data/ has to be listed in pyproject.toml."""
        import glob
        import tomllib
        root = Path(__file__).resolve().parent.parent
        pkg = root / "cloudwall"
        patterns = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["setuptools"]["package-data"]["cloudwall"]
        packaged = {Path(f) for pattern in patterns for f in glob.glob(pattern, root_dir=pkg)}
        bundled = {f.relative_to(pkg) for f in pkg.rglob("*") if f.is_file() and f.suffix not in (".py", ".pyc")}
        self.assertEqual(bundled - packaged, set())


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
        n = sources.normalise({"hex": "A1", "gs": "fast", "lat": "45.6", "lon": -122.5, "track": True, "dbFlags": None})
        self.assertEqual((n["gs"], n["lat"], n["track"], n["military"]), (None, None, None, False))

    def test_finished_flyovers_and_stale_runways_are_forgotten(self):
        t = self.t
        t.update([plane("a1", "ASA1", 1.0)], "test")                    # overhead, low and descending toward PDX
        self.assertEqual((list(t.logbook.active), t.flow["dir"]), (["a1"], "west"))
        t.logbook.active["a1"]["ts"] -= 3600                                    # an hour on, with nothing landing
        t.logbook.tidied, t.flow_at = 0, t.flow_at - 3601
        t.update([], "test")
        self.assertEqual((t.logbook.active, t.flow), ({}, None))


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
        from cloudwall import enrich
        e = Enricher(Store(":memory:"), demo=object())                  # (demo: no worker threads)
        with e.lock:
            for i in range(enrich.MEM_MAX + 10):
                e._keep(("aircraft", str(i)), None, at=i)
        self.assertLessEqual(len(e.mem), enrich.MEM_MAX)
        self.assertIn(("aircraft", str(enrich.MEM_MAX + 9)), e.mem)     # the newest stay
        self.assertNotIn(("aircraft", "0"), e.mem)


class PlaceThreadsTest(unittest.TestCase):
    def place(self, source):
        from cloudwall.place import Place
        [pc] = config.places(config.load())
        place = Place(pc, Store(":memory:"), source, demo=True)         # demo: no lookups, no weather
        place.tracker.enricher = StubEnricher()
        place.activity.sleep = place.stopped.wait = lambda seconds: None
        return place

    def test_a_loop_that_trips_is_started_again(self):
        place, runs = self.place(sources.Demo()), []

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


class SharedTest(unittest.TestCase):
    """What isn't about one place is fetched once for all of them."""

    def test_one_fetch_serves_every_asker(self):
        from cloudwall.shared import Shared
        shared, fetched = Shared(StubEnricher()), []
        fetch = lambda: fetched.append(1) or len(fetched)
        self.assertEqual([shared.once("list", 60, fetch) for _ in range(3)], [1, 1, 1])
        shared.kept["list"]["at"] -= 61                                 # a minute on: fetched afresh
        self.assertEqual(shared.once("list", 60, fetch), 2)
        with self.assertRaises(ZeroDivisionError):                      # a failure is the asker's, and isn't kept
            shared.once("other", 60, lambda: 1 / 0)
        self.assertEqual(shared.once("other", 60, lambda: "ok"), "ok")

    def test_two_places_one_list_and_one_weather_report(self):
        from cloudwall import weather
        from cloudwall.shared import Shared
        shared, asked = Shared(StubEnricher()), []
        ring = [[-122.5, 45.5], [-122.4, 45.5], [-122.4, 45.7], [-122.5, 45.7], [-122.5, 45.5]]
        shared.tfrs.fetch_json = lambda url, timeout: asked.append("list") or {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "TITLE": "Camas, WA"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
        shared.tfrs.fetch_text = lambda url, timeout: TFRTest.XML
        home, cabin = {"lat": 45.59, "lon": -122.47}, {"lat": 44.06, "lon": -121.31}
        from unittest import mock
        with mock.patch("cloudwall.tfr.time.time", return_value=1e9):  # as the other restriction tests: before TFRTest.XML's dates, not after them
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
        from cloudwall.place import Place
        from cloudwall.shared import Shared
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
        home, neighbour = [Place(pc, Store(":memory:"), sources.Demo(), shared) for pc in config.places(cfg)]
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
        from cloudwall.place import Place
        [pc] = config.places(config.load())
        place = Place(pc, Store(":memory:"), sources.Demo(), demo=True)
        self.assertEqual(place.state()["weather"], None)                 # nothing fetched yet: still a full answer
        place.start = lambda: None
        place.weather, place.weather_full = {"station": "KPDX"}, {"now": {"category": "VFR"}}
        place.tfrs, place.heard = [{"id": "6/1"}], [{"hex": "ae01"}]
        place.contrails = {"summary": "None today", "levels": [{"ft": 34000, "state": "persistent"}]}
        place.tracker.update([plane("a1", "ASA512", 1.0, alt=34000)], "test", contrails=place.contrails)
        s = place.state(pin="a1", range_nm=30)
        self.assertEqual((s["place"], s["hero"]["hex"], s["pinned"], s["weather"], s["tfrs"], s["heard"]),
                         ("home", "a1", "a1", {"station": "KPDX"}, [{"id": "6/1"}], [{"hex": "ae01"}]))
        self.assertEqual(s["contrails"], {"summary": "None today"})      # the levels are the Weather tab's
        self.assertEqual(s["hero"]["contrail"], "persistent")            # each aircraft is marked from the forecast
        self.assertEqual(place.tracker.fetch_radius(), 30)               # the screen's radar range was noted
        self.assertIsNone(s["live_routes"])
        w = place.weather_report()
        self.assertEqual((w["now"], len(w["contrails"]["levels"]), w["tfrs"]), ({"category": "VFR"}, 1, [{"id": "6/1"}]))
        self.assertEqual(place.heatmap()["grid"], 96)
        self.assertEqual(place.logbook()["total"], 1)                    # and its flyover is in the place's logbook
        # the tracker knows none of it
        self.assertFalse({"weather", "tfrs", "heard", "contrails", "basemap", "charts", "logos"} & set(place.tracker.snapshot()))


class ReferenceTablesTest(unittest.TestCase):
    """One table of airlines and one of aircraft types, on the server; the display keeps none."""

    def test_airlines(self):
        from cloudwall import airlines
        self.assertEqual((airlines.code("ASA512"), airlines.code("N733NV"), airlines.code(None)), ("ASA", None, None))
        self.assertEqual((airlines.name("QXE"), airlines.name("ZZZ")), ("Horizon Air", None))
        self.assertEqual((airlines.cargo("FDX"), airlines.cargo("ASA"), airlines.cargo(None)), (True, False, False))
        self.assertEqual(airlines.colors("SWA1420"), ["#304cb2", "#ffbf27"])
        self.assertIsNone(airlines.colors("N733NV"))
        self.assertEqual((airlines.scheduled("ASA512"), airlines.scheduled("LIFE3"), airlines.scheduled(None)), (True, False, False))
        # an airline the table has, but with no code of its own to sell flights under: no logo, no flight number
        self.assertEqual((airlines.iata_for("AMF1977", "ZZ"), airlines.flight_number("AMF1977")), (None, None))
        # one it knows only by its colours or as a freight carrier: the route database's code is used
        self.assertEqual((airlines.iata_for("EJA512", "1I"), airlines.iata_for("CLX4", "CV")), ("1I", "CV"))

    def test_aircraft_types(self):
        from cloudwall import aircraft
        self.assertEqual(aircraft.shape("B738"), {"shape": "narrow", "length": 39.5, "known": True})
        self.assertEqual(aircraft.shape("zzzz", "A7"), {"shape": "heli", "length": 12, "known": False})   # by its category
        self.assertEqual(aircraft.shape(None), {"shape": "narrow", "length": 36, "known": False})
        self.assertEqual(aircraft.shape("BE99", "A6"), {"shape": "turboprop", "length": 13.58, "known": True})   # the table wins
        # a type the table hasn't, whose transponder calls it high performance (A6) by mistake: its wake category
        self.assertEqual(aircraft.shape("SW3", "A6"), {"shape": "bizjet", "length": 16, "known": False})
        self.assertEqual(aircraft.shape("CONC")["known"], False)       # known only as rare: no shape of its own
        self.assertEqual([aircraft.rare(t) for t in ("A388", "CONC", "B738", None)], [True, True, False, False])

    def test_each_record_the_display_draws_carries_them(self):
        from cloudwall.place import Place
        [pc] = config.places(config.load())
        place = Place(pc, Store(":memory:"), sources.Demo(), demo=True)
        place.tracker.enricher = place.tracker.details.enricher = StubEnricher()
        place.tracker.update([plane("a1", "SWA1420", 1.0, typ="B37M"), plane("a2", "N733NV", 9.0, typ="C172", category="A1")], "test")
        hero = place.state()["hero"]
        self.assertEqual((hero["shape"], hero["length"], hero["known"], hero["colors"]), ("narrow", 35.6, True, ["#304cb2", "#ffbf27"]))
        self.assertNotIn("colors", next(a for a in place.state()["aircraft"] if a["hex"] == "a2"))
        book = place.logbook()
        self.assertEqual([(t["type"], t["shape"], t["length"]) for t in book["types"]], [("B37M", "narrow", 35.6)])
        self.assertEqual((book["recent"][0]["shape"], book["types_today"][0]["known"]), ("narrow", True))
        self.assertIn("RARE TYPE", book["recent"][0]["badges"])        # the 737 MAX 7's flag, from the same table


class MedicalTest(unittest.TestCase):
    """Medical flights (medical.py): by transponder, operator or callsign, or a hospital's helipad;
    and the helipad a helicopter is heading for, landing at or has just left."""
    EMANUEL = {"code": "7OR5", "name": "Emanuel Hospital", "short": "Emanuel", "city": "Portland",
               "lat": 45.54348, "lon": -122.67087, "elevation_ft": 163}
    OHSU = {"code": "9OR6", "name": "Oregon Health Sciences University", "short": "OHSU", "city": "Portland",
            "lat": 45.49916, "lon": -122.68517, "elevation_ft": 621}

    def setUp(self):
        from cloudwall import medical
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
        from cloudwall import situation
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
        from cloudwall import situation
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
        """An air ambulance overhead is logged MEDICAL, and one known to be medical only after its
        entry was started has the badge added."""
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=sources.Demo()))
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
        from cloudwall import airports
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
        """The demo's air ambulance flies to a hospital's helipad, and the tracker says so."""
        demo = sources.Demo()
        store = Store(":memory:")
        t = Tracker(config.load(), store, Enricher(store, demo=demo))
        home = config.DEFAULTS["home"]
        t.update(demo.fetch(home["lat"], home["lon"], 15), "demo")
        life = next(a for a in t.snapshot()["aircraft"] if a.get("callsign") == "LIFE3")
        self.assertEqual((life["medical"], life["notable"], life["hospital"]["state"]), (True, "medical", "heading"))
        self.assertGreater(life["hospital"]["eta_s"], 60)


class KioskQuietTest(unittest.TestCase):
    def test_density_is_checked(self):
        self.assertTrue(config.check("kiosk", {"density": "detailed"}))
        for bad in ("Detailed", "detail"):
            with self.assertRaises(ValueError):
                config.check("kiosk", {"density": bad})

    def test_quiet_hours_are_checked(self):
        for ok in ("", "23:00-06:30", "0:00 - 7:15", "22:30-23:45"):
            self.assertTrue(config.check("kiosk", {"quiet": ok}), ok)
        for bad in ("11pm-6am", "23:00", "25:00-06:00", "23:00-6:60"):
            with self.assertRaises(ValueError, msg=bad):
                config.check("kiosk", {"quiet": bad})
        self.assertEqual(config.DEFAULTS["kiosk"]["quiet"], "")
