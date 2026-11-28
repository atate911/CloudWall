import json
import math
import time
import unittest
from pathlib import Path

from cloudwall.core import config
from cloudwall.gather import demo
from cloudwall.memory.store import Store
from cloudwall.reference import placing

import support
from support import StubEnricher, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class TilesTest(unittest.TestCase):
    def test_cache_area_limit_and_stale_fallback(self):
        import tempfile
        from cloudwall.gather import tiles as T
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
        from cloudwall.gather import tiles as T
        cfg = config.load()
        cfg["map"] = dict(cfg["map"], url="https://{s}.example.com/dark/{z}/{x}/{y}{r}.png?api_key=k")
        t = T.Tiles(cfg, "/tmp/x")
        seen = []

        class Resp:
            headers = {"Content-Type": "image/png"}
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self, n=-1): return b"x"

        import urllib.request
        real = urllib.request.urlopen
        urllib.request.urlopen = lambda req, timeout=0: seen.append(req.full_url) or Resp()
        try:
            t._download(11, 326, 731)
        finally:
            urllib.request.urlopen = real
        self.assertEqual(seen, ["https://a.example.com/dark/11/326/731.png?api_key=k"])
        cfg["map"]["url"] = "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=k"
        self.assertEqual(T.Tiles(cfg, "/tmp/x").info()["style"], "carto-dark")

    def test_styles_and_off(self):
        from cloudwall.gather import tiles as T
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
        from cloudwall.gather import tiles as T
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
        from cloudwall.gather.charts import Charts
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
                                                   "sat", "streets", "places", "roads", "dark", "light", "osm"})
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
            self.assertIsNone(c.get("nonsense", *tile))

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


class LogosTest(unittest.TestCase):
    def test_airline_codes(self):
        from cloudwall.reference.airlines import iata_for
        self.assertEqual(iata_for("DAL2008"), "DL")
        self.assertEqual(iata_for("QXE2162"), "AS")            # Horizon flies as Alaska
        self.assertEqual(iata_for("XYZ123", "XY"), "XY")       # unknown airline: trust the database code
        self.assertIsNone(iata_for("N733NV", "ZZ"))            # private aircraft: no logo
        self.assertIsNone(iata_for("AMF1977"))                 # known airline with no logo code

    def test_cache_and_missing(self):
        import tempfile, urllib.error
        from cloudwall.gather import logos as L
        with tempfile.TemporaryDirectory() as d:
            lg = L.Logos(config.load(), d)
            calls = []

            class Resp:
                headers = {}
                def __init__(self, data): self.data = data
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def read(self, n=-1): return self.data

            def fake(req, timeout=0):
                calls.append(req.full_url)
                if "/QX" in req.full_url:
                    raise urllib.error.HTTPError(req.full_url, 404, "nope", None, None)
                return Resp(b"\x89PNG fake")

            real, urllib.request.urlopen = urllib.request.urlopen, fake
            try:
                self.assertTrue(lg.get("DL").startswith(b"\x89PNG"))
                lg.get("DL")
                self.assertIsNone(lg.get("QX"))
                self.assertIsNone(lg.get("QX"))
                self.assertIsNone(lg.get("../etc"))
            finally:
                urllib.request.urlopen = real
            self.assertEqual(len(calls), 2)                     # one download each, misses remembered


class VideoMapTest(unittest.TestCase):
    def test_portlands_class_c_and_the_vors_around_it(self):
        from cloudwall.reference import airports
        home = config.DEFAULTS["home"]
        areas = airports.airspace_near(home["lat"], home["lon"], own="PDX")
        self.assertEqual(sorted((a["id"], a["class"], a["floor"], a["ceiling"]) for a in areas),
                         [("PDX", "C", f, 4000) for f in (0, 1100, 1700, 1800, 2000, 2300)])
        self.assertTrue(all(len(r) >= 3 and len(r[0]) == 2 for a in areas for r in a["rings"]))
        self.assertEqual([n["ident"] for n in airports.navaids_near(home["lat"], home["lon"])], ["CBU", "BTG", "UBG"])
        cfg = placing.complete_place(config.load())
        self.assertEqual(len(cfg["airport"]["airspace"]), 6)
        self.assertEqual(cfg["airport"]["navaids"][1]["type"], "VORTAC")

    def test_class_d_only_for_the_places_own_airport(self):
        from cloudwall.reference import airports
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


class AboutTest(unittest.TestCase):
    """The write-ups a tap on a type opens (cloudwall/data/types/), held to their format."""

    def test_every_file_is_sound(self):
        from cloudwall.reference import about
        self.assertEqual(about.problems(), [])
        self.assertGreater(len(about.covered()), 0)

    def test_every_type_cloudwall_knows_is_written_up(self):
        """A type added to data/types.csv or data/seats.csv needs its write-up too."""
        import csv
        from cloudwall.core import paths
        from cloudwall.reference import about

        def codes(name):
            with open(paths.DATA / name, encoding="utf-8") as f:
                return {r["type"] for r in csv.DictReader(line for line in f if not line.startswith("#"))}
        self.assertEqual(sorted((codes("types.csv") | codes("seats.csv")) - set(about.covered())), [],
                         "types with no write-up in cloudwall/data/types/")

    def test_a_variant_adds_to_its_family(self):
        from cloudwall.reference import about
        long, short = about.entry("b753"), about.entry("B752")
        self.assertEqual((long["name"], long["family"], short["family"]), ("Boeing 757-300", "Boeing 757", "Boeing 757"))
        self.assertEqual(long["text"][:len(short["text"])], short["text"])          # the family's text, then its own
        self.assertGreater(len(long["text"]), len(short["text"]))
        self.assertEqual(long["production"], [1982, 2005])                            # its family's years
        self.assertTrue(all(isinstance(k, str) and isinstance(v, str) for k, v in long["facts"]))
        self.assertIsNone(about.entry("NOPE"))
        self.assertIsNone(about.entry(None))

    def test_the_737s_and_a320s_each_have_their_own_write_up(self):
        """No paragraph of one is its sister's, and each has its own first flight and delivery years."""
        from cloudwall.reference import about
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
        from cloudwall.reference import about
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
        from cloudwall.reference.about import paragraphs
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


class ReferenceTablesTest(unittest.TestCase):
    """One table of airlines and one of aircraft types, on the server; the display keeps none."""

    def test_airlines(self):
        from cloudwall.reference import airlines
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
        from cloudwall.reference import aircraft
        self.assertEqual(aircraft.shape("B738"), {"shape": "narrow", "length": 39.5, "known": True})
        self.assertEqual(aircraft.shape("zzzz", "A7"), {"shape": "heli", "length": 12, "known": False})   # by its category
        self.assertEqual(aircraft.shape(None), {"shape": "narrow", "length": 36, "known": False})
        self.assertEqual(aircraft.shape("BE99", "A6"), {"shape": "turboprop", "length": 13.58, "known": True})   # the table wins
        # a type the table hasn't, whose transponder calls it high performance (A6) by mistake: its wake category
        self.assertEqual(aircraft.shape("SW3", "A6"), {"shape": "bizjet", "length": 16, "known": False})
        self.assertEqual(aircraft.shape("CONC")["known"], False)       # known only as rare: no shape of its own
        self.assertEqual([aircraft.rare(t) for t in ("A388", "CONC", "B738", None)], [True, True, False, False])

    def test_each_record_the_display_draws_carries_them(self):
        from cloudwall.app.place import Place
        [pc] = placing.places(config.load())
        place = Place(pc, Store(":memory:"), demo.Demo(), demo=True)
        place.tracker.enricher = place.tracker.details.enricher = StubEnricher()
        place.tracker.update([plane("a1", "SWA1420", 1.0, typ="B37M"), plane("a2", "N733NV", 9.0, typ="C172", category="A1")], "test")
        hero = place.state()["hero"]
        self.assertEqual((hero["shape"], hero["length"], hero["known"], hero["colors"]), ("narrow", 35.6, True, ["#304cb2", "#ffbf27"]))
        self.assertNotIn("colors", next(a for a in place.state()["aircraft"] if a["hex"] == "a2"))
        book = place.logbook()
        self.assertEqual([(t["type"], t["shape"], t["length"]) for t in book["types"]], [("B37M", "narrow", 35.6)])
        self.assertEqual((book["recent"][0]["shape"], book["types_today"][0]["known"]), ("narrow", True))
        self.assertIn("RARE TYPE", book["recent"][0]["badges"])        # the 737 MAX 7's flag, from the same table


if __name__ == "__main__":
    unittest.main()
