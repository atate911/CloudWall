import json
import time
import unittest
from pathlib import Path

from cloudwall import config, geo, sources
from cloudwall.enrich import Enricher
from cloudwall.store import Store
from cloudwall.tracker import Tracker, ordinal

PDX = (45.5887, -122.5975)
SFO = (37.619, -122.375)
AUS = (30.1975, -97.662)


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

    def route(self, callsign):
        return self.routes.get(callsign)


def plane(hexid, callsign, north_nm, alt=3000, typ="B738", **kw):
    home = config.DEFAULTS["home"]
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
        # the same airframe returning later is a repeat visitor, not a new type
        self.t.active.clear()
        self.t.update([plane("a1", "ASA777", 1.0)], "test")
        self.assertEqual(self.t.snapshot()["hero"]["badges"], ["2nd VISIT"])

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
        self.t.pin("a2")
        self.t.update([plane("a1", "ASA1", 1.0), plane("a2", "ASA2", -3.0)], "test")
        self.assertEqual(self.t.snapshot()["hero"]["hex"], "a2")

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
        ap = config.DEFAULTS["airport"]
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
        ap = config.DEFAULTS["airport"]
        a = plane("a1", "ASA1", 0, alt=1500, squawk="7700")
        a["lat"], a["lon"] = ap["lat"], ap["lon"] + 0.1
        self.t.update([a], "test")
        s = self.t.snapshot()
        self.assertEqual(s["flow"]["dir"], "west")
        self.assertEqual(s["aircraft"][0]["emergency"], "EMERGENCY 7700")

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
        self.assertAlmostEqual(r["dest"]["lat"], PDX[0])
        self.assertEqual(self.fa.used_today(), 3)            # flight + two airports
        self.fa.route("SWA2327")
        self.assertEqual(self.fa.used_today(), 4)            # airports came from the cache

    def test_just_departed_and_nothing_current(self):
        pick = self.mod.pick_flight
        self.assertEqual(pick([fa_flight("PDX", "LAS", sched_off=-120)], time.time())["destination"]["code_iata"], "LAS")
        self.assertIsNone(pick([fa_flight("PDX", "LAS", sched_off=20000)], time.time()))
        self.assertIsNone(pick([fa_flight("PDX", "LAS", sched_off=0, cancelled=True)], time.time()))

    def test_daily_limit_stops_billing(self):
        for _ in range(4):
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
        self.assertEqual(t.snapshot()["live_routes"]["used_today"], 3)
        json.dumps(t.snapshot())


class Flightradar24Test(unittest.TestCase):
    def setUp(self):
        from cloudwall import flightradar24, live
        self.calls, self.fail = [], None
        self.row = {"fr24_id": "3a01b036", "flight": "WN2327", "callsign": "SWA2327", "lat": 45.6, "lon": -122.4,
                    "orig_iata": "SMF", "orig_icao": "KSMF", "dest_iata": "PDX", "dest_icao": "KPDX",
                    "eta": "2026-11-17T03:05:00Z", "type": "B737", "reg": "N7715E"}

        def fake(url, timeout=0, headers=None):
            self.calls.append(url)
            self.assertEqual(headers, {"Authorization": "Bearer tok", "Accept-Version": "v1"})
            if self.fail:
                import urllib.error
                raise urllib.error.HTTPError(url, self.fail, "nope", None, None)
            if "/static/airports/" in url:
                code = url.split("/")[-2]
                lat, lon = FlightAwareTest.COORDS[code]
                return {"name": code + " Intl", "city": code, "icao": code, "lat": lat, "lon": lon}
            return {"data": [self.row]}

        self.live, self.real = live, live.get_json
        live.get_json = fake
        self.store = Store(":memory:")
        cfg = config.load()
        cfg["flightradar24"] = dict(cfg["flightradar24"], api_key="tok")
        self.fr = flightradar24.Flightradar24(cfg, self.store)

    def tearDown(self):
        self.live.get_json = self.real

    def test_route_and_airport_cache(self):
        r = self.fr.route("SWA2327")
        self.assertEqual((r["origin"]["iata"], r["dest"]["iata"], r["flight"]), ("SMF", "PDX", "WN2327"))
        self.assertAlmostEqual(r["dest"]["lon"], PDX[1])
        self.assertEqual(r["source_label"], "Flightradar24")
        self.assertGreater(r["eta"], 1.7e9)
        self.assertIn("/live/flight-positions/full?callsigns=SWA2327", self.calls[0])
        self.fr.route("SWA2327")
        self.assertEqual(self.fr.used_today(), 4)             # flight + 2 airports, then flight only

    def test_airport_field_variants_and_missing_coordinates(self):
        from cloudwall import flightradar24 as F
        self.assertEqual(F._airport_info({"name": "Reagan", "position": {"latitude": 38.85, "longitude": -77.04,
                                                                         "region": {"city": "Washington"}}}),
                         {"city": "Washington", "name": "Reagan", "lat": 38.85, "lon": -77.04})
        self.assertEqual(F._airport_info({"data": {"name": "X", "latitude": "1.5", "longitude": "2"}})["lat"], 1.5)
        self.assertIsNone(F._airport_info({"name": "no position"}))
        # if the airport lookup gives nothing, the route still works, with PDX filled in locally
        orig = F.Flightradar24._airport
        F.Flightradar24._airport = lambda self, icao, iata: {"iata": iata, "city": None, "name": None, "lat": None, "lon": None}
        try:
            self.row.update(orig_iata="DCA", orig_icao="KDCA")
            r = self.fr.route("SWA2327")
        finally:
            F.Flightradar24._airport = orig
        t = Tracker(config.load(), self.store, StubEnricher())
        a = plane("a1", "SWA2327", 1.0)
        t._derive(a)
        g = t._with_geometry(a, r)
        self.assertEqual((g["dest"]["city"], g["progress"], g["flown_nm"]), ("Portland", None, None))
        self.assertGreater(g["left_nm"], 0)
        self.assertTrue(g["plausible"])

    def test_no_match_and_no_destination(self):
        self.assertIsNone(self.fr.route("ASA1"))               # a different flight came back
        self.row["dest_icao"] = self.row["dest_iata"] = None
        self.assertIsNone(self.fr.route("SWA2327"))

    def test_rejected_key_pauses_without_spending(self):
        self.fail = 401
        self.assertIsNone(self.fr.route("SWA2327"))
        self.assertEqual(self.fr.used_today(), 0)
        self.assertFalse(self.fr.available())
        self.assertEqual(self.fr.status()["problem"], "API key rejected")
        n = len(self.calls)
        self.fr.route("SWA2327")
        self.assertEqual(len(self.calls), n)                   # backing off: nothing sent


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
        a = next(x for x in t.snapshot()["aircraft"] if x["hex"] == "a1")
        self.assertEqual(len(a["trail"]), 3)
        self.assertGreater(a["trail"][0][0], a["trail"][-1][0])       # moving south toward home
        heat = t.heatmap()
        self.assertEqual(sum(c[2] for c in heat["cells"]), 3)         # the parked aircraft isn't counted
        self.assertTrue(all(c[0] == heat["grid"] // 2 for c in heat["cells"]))   # due north: centre column
        t.update([], "test")
        self.assertEqual(t.trails, {})                                # gone from range: trail dropped
        self.assertIn("photo", {r["name"] for r in store.db.execute("PRAGMA table_info(sightings)")})


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
        # 8 minutes out at 2 nm/min, flying straight at the house from the north
        inbound = plane("a1", "ASA1363", 16.0, track=180, gs=120)
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
