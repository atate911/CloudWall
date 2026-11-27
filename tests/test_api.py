"""What the server answers, held to what API.md says it answers.

API.md lists every key of every answer in tables. These tests read those tables and compare them
with what the code really sends, both ways: a key the code sends that the tables don't have fails,
and so does a key in the tables that nothing here could make the code send. So a key can't be
added, dropped or renamed without the reference being changed with it, and the reference can't
describe something that is no longer so.

The answers are made as a screen would get them: aircraft through a Tracker whose lookups all
have something to say, routes through both paid providers' own parsing of a canned answer, and
the state, weather and logbook over HTTP from a server.
"""
import json
import re
import threading
import time
import unittest
import urllib.request
from pathlib import Path

from cloudwall import config, contrails, demo, feeds, placing, weather
from cloudwall.place import Place, Places
from cloudwall.server import API, make_server
from cloudwall.store import Store
from cloudwall.tfr import TFRs
from cloudwall.tracker import Tracker

DOC = Path(__file__).resolve().parent.parent / "API.md"


def shape(name):
    """{key: is it always there?} from the table under "<!-- shape: name -->" in API.md."""
    text = DOC.read_text(encoding="utf-8")
    rows, started = {}, False
    for line in text[text.index(f"<!-- shape: {name} -->"):].splitlines()[1:]:
        if line.startswith("|"):
            started = True
            m = re.match(r"\| `(\w+)` \| ([^|]+) \|", line)
            if m:
                rows[m.group(1)] = m.group(2).strip() == "always"
        elif started:
            break
    return rows


def plane(hexid, callsign, north_nm, east_nm=0.0, **more):
    home = config.DEFAULTS["home"]
    return dict(feeds.normalise({"hex": hexid, "flight": callsign, "t": "B739", "alt_baro": 3000, "gs": 180, "track": 280,
                                   "baro_rate": -700, "lat": home["lat"] + north_nm / 60, "lon": home["lon"] + east_nm / 42,
                                   "squawk": "1234", "category": "A3"}), **more)


def fr24_route():
    """A route as flightradar24.py makes it from Flightradar24's answer."""
    from cloudwall import flightradar24, live
    row = {"flight": "AS3400", "callsign": "SKW3400", "operating_as": "SKW", "painted_as": "ASA", "orig_icao": "KSFO",
           "dest_icao": "KPDX", "datetime_takeoff": "2026-11-17T02:41:09", "datetime_landed": None, "flight_ended": False}
    return _provider_route(flightradar24.Flightradar24, "flightradar24", {"data": [row]}, "SKW3400", live)


def flightaware_route():
    """And as flightaware.py makes it from FlightAware's."""
    from cloudwall import flightaware, live
    end = lambda c: {"code": "K" + c, "code_icao": "K" + c, "code_iata": c, "name": c, "city": c}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    flight = {"ident": "DAL178", "ident_iata": "DL178", "origin": end("SEA"), "destination": end("PDX"), "scheduled_off": now,
              "actual_off": now, "actual_on": None, "estimated_in": now, "arrival_delay": 60, "status": "En Route",
              "progress_percent": 80, "route_distance": 130, "cancelled": False}
    return _provider_route(flightaware.FlightAware, "flightaware", {"flights": [flight]}, "DAL178", live)


def _provider_route(cls, section, answer, callsign, live):
    cfg = config.load()
    cfg[section] = dict(cfg[section], api_key="key", sandbox=True)
    real, live.get_json = live.get_json, lambda url, timeout=0, headers=None: answer
    try:
        return cls(cfg, Store(":memory:")).route(callsign)
    finally:
        live.get_json = real


class Lookups:
    """Stands in for the Enricher, with something to say about every aircraft below."""
    FREE = {"flight": "DL178", "airline": "Delta Air Lines", "airline_iata": "DL",
            "origin": {"iata": "SEA", "city": "Seattle", "name": "Seattle-Tacoma", "country": "United States", "lat": 47.449, "lon": -122.309},
            "dest": {"iata": "PDX", "city": "Portland", "name": "Portland Intl", "country": "United States", "lat": 45.5887, "lon": -122.5975}}

    class live:
        enabled, mode = True, "always"

    def __init__(self):
        self.paid = {"SKW3400": fr24_route(), "DAL178": flightaware_route()}

    def aircraft(self, hexid):
        return {"type_name": "Boeing 737-990ER", "reg": "N461AS", "owner": "Alaska Airlines"} if hexid == "a1" else None

    def photo(self, hexid, reg=None, icao_type=None):
        return {"src": "https://t.plnspttrs.net/1.jpg", "link": "https://www.planespotters.net/photo/1", "by": "A. Spotter"} \
            if hexid == "a1" else None

    def route(self, callsign):
        return self.FREE if callsign in ("DAL178", "DAL99") else None

    def live_route(self, callsign, fetch):
        if callsign in self.paid:
            return "done", self.paid[callsign]
        return ("pending", None) if callsign == "UAL99" else ("skipped", None)


TFR_XML = """<XNOTAM-Update><Group><Add><Not><NotUid><txtLocalName>Parade Portland, OR</txtLocalName></NotUid>
  <dateEffective>2026-11-21T21:00:00</dateEffective><dateExpire>2026-11-22T04:59:00</dateExpire>
  <TfrNot><codeType>99.7</codeType><TFRAreaGroup><aseTFRArea><codeDistVerUpper>HEI</codeDistVerUpper><valDistVerUpper>400</valDistVerUpper>
  <uomDistVerUpper>FT</uomDistVerUpper><codeDistVerLower>HEI</codeDistVerLower><valDistVerLower>0</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>
  </aseTFRArea></TFRAreaGroup></TfrNot><txtDescrUSNS>FULL TEXT</txtDescrUSNS></Not></Add></Group></XNOTAM-Update>"""


def restrictions(home):
    ring = [[home["lon"] - 0.05, home["lat"] - 0.05], [home["lon"] + 0.05, home["lat"] - 0.05],
            [home["lon"] + 0.05, home["lat"] + 0.05], [home["lon"] - 0.05, home["lat"] + 0.05]]
    feed = TFRs(fetch_json=lambda url, timeout: {"features": [
        {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "TITLE": "Portland, OR", "LAST_MODIFICATION_DATETIME": "1"},
         "geometry": {"type": "Polygon", "coordinates": [ring]}}]}, fetch_text=lambda url, timeout: TFR_XML)
    return feed.near(feed.fetch(), home, 30, now=1e9)


class ShapeTest(unittest.TestCase):
    maxDiff = None

    def held(self, name, records, always=None):
        """Every record's keys are in API.md's table, each key there marked "always" is in every
        record (those of `always`, if given), and every key in the table turned up somewhere."""
        doc, seen = shape(name), set()
        self.assertTrue(doc, f"no table for {name} in API.md")
        for r in records:
            seen |= set(r)
            self.assertEqual(set(r) - set(doc), set(), f"{name}: sent, but not in API.md")
        for r in records if always is None else always:
            self.assertEqual({k for k, must in doc.items() if must} - set(r), set(), f"{name}: API.md says always, but missing")
        self.assertEqual(set(doc) - seen, set(), f"{name}: in API.md, but nothing sent it")

    # -- an aircraft, and its route ------------------------------------------------------------
    @classmethod
    def setUpClass(cls):
        cfg = placing.places(config.load())[0]
        field = cfg["airport"]["others"][0]                     # a small field nearby
        home = cfg["home"]
        t = cls.tracker = Tracker(cfg, Store(":memory:"), Lookups())
        forecast = contrails.demo()
        at_field = dict(plane("a3", "N733NV", 0, gs=90, vrate=-500, category="A1", alt=field["elevation_ft"] + 800),
                        lat=field["lat"] + 0.005, lon=field["lon"], type="C172")
        pad = cfg["airport"]["helipads"][0]                     # a hospital's helipad near home
        to_hospital = dict(plane("a8", "LIFE7", 0, gs=80, vrate=-600, track=180, category="A7", type="EC35",
                                 alt=pad["elevation_ft"] + 600), lat=pad["lat"] + 0.012, lon=pad["lon"])
        traffic = [
            plane("a1", "SKW3400", 1.0, year=2015),             # overhead: a regional partner on a paid route, with a photo
            plane("a2", "UAL99", 6.0),                          # its paid route is still being looked up
            at_field,                                           # a light aircraft landing at the small field
            plane("a4", "N999EM", 5.0, squawk="7700"),          # squawking an emergency
            plane("a5", "DAL178", 7.0),                         # a paid route from the other provider; followed, then lost
            plane("a6", "DAL99", 8.0),                          # the free database's route only
            plane("a7", "FDX12", 28.0),                         # past the tracking radius
            to_hospital,                                        # an air ambulance landing at the hospital
        ]
        t.want_range(30)
        t.want_pin("a5")
        for _ in range(2):                                      # twice: an emergency takes two updates to count
            t.update([dict(a) for a in traffic], "test", contrails=forecast)
        t.status["updated"] -= 5                                # five seconds on, the feed leaves the followed one out
        t.want_pin("a5")
        t.update([dict(a) for a in traffic if a["hex"] != "a5"], "test", contrails=forecast)
        cls.snapshot = t.snapshot("a5")
        cls.home = home

    def test_an_aircraft(self):
        s = self.snapshot
        near, far, hero = s["aircraft"], s["beyond"], s["hero"]
        self.assertEqual(([a["hex"] for a in far], hero["hex"], len(near)), (["a7"], "a5", 7))
        life = next(a for a in near if a["hex"] == "a8")
        self.assertEqual((life["medical"], life["hospital"]["state"]), (True, "landing"))
        feed, derived, details, other = (shape("aircraft." + part) for part in ("feed", "derived", "details", "other"))
        documented = set(feed) | set(derived) | set(details) | set(other)
        seen = set()
        for a in near + far + [hero] + s["emergency"]:
            seen |= set(a)
            self.assertEqual(set(a) - documented, set(), "an aircraft's key that API.md doesn't have")
            for part in (feed, derived):                        # every aircraft, looked up or not
                self.assertEqual({k for k, must in part.items() if must} - set(a), set())
        for a in near:                                          # those that matter are looked up
            self.assertEqual({k for k, must in details.items() if must} - set(a), set())
        self.assertEqual(set(far[0]) & set(details), set())     # and one past the radius never is
        self.assertEqual(documented - seen, set(), "in API.md, but no aircraft here had it")
        # the groups don't overlap, so each key is described once
        self.assertEqual(sum(map(len, (feed, derived, details, other))), len(documented))

    def test_a_route(self):
        routes = [a["route"] for a in self.snapshot["aircraft"] if a.get("route")]
        self.assertEqual(sorted(r.get("source") or "free" for r in routes), ["flightaware", "flightradar24", "free"])
        self.held("route", routes)

    def test_military_heard(self):
        heard = feeds.heard_near([{"hex": "ae0001", "t": "F15", "alt_baro": 15000, "rr_lat": self.home["lat"],
                                     "rr_lon": self.home["lon"], "dbFlags": 1}], self.home, 40)
        self.assertEqual(set(heard[0]), set(shape("aircraft.feed")) | {"rough_nm"})
        self.assertEqual(set(demo.demo_heard()[0]), set(heard[0]))       # the demo's are the same shape

    def test_every_source_gives_the_same_record(self):
        simulated = demo.Demo().fetch(self.home["lat"], self.home["lon"], 15)[0]
        self.assertEqual(set(simulated), set(shape("aircraft.feed")))
        self.assertEqual(set(feeds.normalise({"hex": "a1"})), set(shape("aircraft.feed")))

    def test_a_flight_restriction(self):
        found = restrictions(self.home)
        self.held("tfr", found)

    def test_a_weather_report(self):
        short, full = weather.demo("KPDX", "Portland")
        self.held("metar", [full["now"]] + full["history"])
        self.assertEqual(set(short), set(re.findall(r"`(\w+)`", self._row("state", "weather"))) - {"weather"})

    def _row(self, table, key):
        text = DOC.read_text(encoding="utf-8")
        return re.search(rf"^\| `{key}` \|.*$", text[text.index(f"<!-- shape: {table} -->"):], re.M).group(0)

    # -- over HTTP, as a screen gets them ---------------------------------------------------------
    def serve(self):
        cfg = config.load()
        cfg["server"]["host"], cfg["server"]["port"] = "127.0.0.1", 0

        def make(pc):
            place = Place(pc, Store(":memory:"), demo.Demo(), demo=True)
            place.tracker = self.tracker                        # the traffic above, logbook and all
            place.store = self.tracker.store
            place.weather, place.weather_full = weather.demo("KPDX", "Portland")
            place.tfrs, place.contrails, place.heard = restrictions(pc["home"]), contrails.demo(), demo.demo_heard()
            return place
        places = Places(cfg, make, None)
        for pc in placing.places(cfg):
            places.add_config(pc)
        srv = make_server(cfg, places)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        self.addCleanup(srv.server_close)

        def get(path):
            with urllib.request.urlopen(f"http://127.0.0.1:{srv.server_address[1]}{path}", timeout=5) as answer:
                return json.loads(answer.read())
        return get

    def test_the_state(self):
        get = self.serve()
        state = get("/api/state?pin=a5&range=30")
        self.held("state", [state])
        self.assertEqual((state["api"], API), (1, 1))
        # what the reference says is inside each part is what is inside it
        for key in ("status", "home", "tracking", "kiosk", "flow", "contrails", "basemap"):
            if state[key] is not None:
                named = set(re.findall(r"`(\w+)`", self._row("state", key))) - {key, "tracking"}
                self.assertEqual(set(state[key]) - named, set(), f"{key}: a key API.md doesn't name")
        self.assertEqual(set(state["places"][0]), set(re.findall(r"`(\w+)`", self._row("state", "places"))) - {"places"})

    def test_the_weather(self):
        get = self.serve()
        self.held("weather", [get("/api/weather")])

    def test_the_logbook(self):
        get = self.serve()
        book = get("/api/logbook")
        self.held("logbook", [book])
        self.assertGreaterEqual(len(book["recent"]), 1)         # the one that came overhead above
        self.held("flyover", book["recent"])
        self.assertEqual(book["recent"][0]["track"], 280)       # logged where it was closest, and which way it flew

    def test_a_type(self):
        get = self.serve()
        logged = get("/api/type?type=b739&hex=a1")              # the one that came overhead above, with a write-up
        unwritten = get("/api/type?type=ZZZZ")                   # neither written about nor ever logged
        self.held("type", [logged, unwritten])
        self.held("type.seen", [logged["seen"], unwritten["seen"]])
        self.assertEqual((logged["type"], logged["name"], logged["family"], logged["seen"]["rank"], logged["airframe"]["n"]),
                         ("B739", "Boeing 737-900", "Boeing 737 Next Generation", 1, 1))
        self.assertTrue(logged["text"] and logged["facts"] and logged["production"])
        self.assertEqual((unwritten["name"], unwritten["family"], unwritten["text"], unwritten["facts"], unwritten["production"],
                          unwritten["airframe"], unwritten["seen"]["n"]), (None, None, [], [], None, None, 0))


if __name__ == "__main__":
    unittest.main()
