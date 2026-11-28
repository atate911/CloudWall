import json
import time
import unittest

from cloudwall.core import config
from cloudwall.gather.enrich import Enricher
from cloudwall.memory.store import Store
from cloudwall.picture.tracker import Tracker

import support
from support import PDX, StubEnricher, fa_flight, iso, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


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

        from cloudwall.gather import flightaware, live
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
        from cloudwall.gather import flightradar24, live
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
        from cloudwall.gather.live import NotYet
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


class BudgetTest(unittest.TestCase):
    def provider(self, today, **settings):
        import datetime as dt
        from cloudwall.gather import flightradar24
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
        from cloudwall.gather.live import billing_period
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
        from cloudwall.gather import enrich
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
        from cloudwall.gather.live import NotYet

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


class PhotoTest(unittest.TestCase):
    def test_photo_comes_from_planespotters_with_its_credit(self):
        from unittest import mock
        from cloudwall.gather import enrich
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
        from cloudwall.gather import enrich
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


if __name__ == "__main__":
    unittest.main()
