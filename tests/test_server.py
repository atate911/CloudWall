import json
import unittest
from pathlib import Path

from cloudwall.core import config
from cloudwall.gather import demo
from cloudwall.memory.store import Store
from cloudwall.reference import placing

import support
from support import StubEnricher, plane

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class ServerTest(unittest.TestCase):
    def serve(self, cfg, saved=None, charts=None):
        """A server over every place in cfg, with no threads started and no network lookups."""
        import threading
        from cloudwall.app.place import Place, Places
        from cloudwall.serve.server import make_server
        cfg["server"]["host"], cfg["server"]["port"] = "127.0.0.1", 0

        def make(pc):
            place = Place(pc, Store(":memory:"), demo.Demo())
            place.tracker.enricher = StubEnricher()
            place.start = lambda: None
            return place
        places = Places(cfg, make, saved)
        for pc in placing.places(cfg):
            places.add_config(pc)
        places.load_saved()
        srv = make_server(cfg, places, charts)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        self.addCleanup(srv.server_close)
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
        """With [server] key set, only /k/<key>/ answers; without the key a request is told nothing.
        The key is the same typed without its hyphens or in capitals."""
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
        from cloudwall.core import keys
        from cloudwall.serve import access
        made = {keys.new_key() for _ in range(50)}
        self.assertEqual(len(made), 50)
        for key in made:
            self.assertRegex(key, r"^([bdfghjkmnprstvz][aeiou]){2}(-([bdfghjkmnprstvz][aeiou]){2}){3}$")      # typed once, said aloud
            self.assertIsNone(keys.problem(key))
        self.assertIsNone(keys.problem(""))                                           # none set: open, as on a home network
        for bad in ("short-key", "has spaces in the key", "slash/in/the/key/x", 12345678901234):
            self.assertTrue(keys.problem(bad), bad)
        for bad in ("letmein", "a key with spaces"):
            with self.assertRaises(ValueError):
                config.check("server", {"key": bad})
        self.assertEqual(access.admit("/k/Tafo-Kemi-Luza-Nobe/api/state?range=15", keys.tidy("tafo-kemi-luza-nobe")), ("in", "/api/state?range=15"))

    def test_it_names_itself_with_a_way_to_reach_it(self):
        # planespotters.net refuses a User-Agent with no contact URL or email: no photos at all
        from cloudwall.core.http import UA
        self.assertRegex(UA, r"^CloudWall/[\d.]+ \(\+https://\S+\)$")

    def test_the_private_link_is_written_into_the_config(self):
        import tempfile
        from pathlib import Path
        from cloudwall.operate import privatelink
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.toml"
            # a [server] section with no key: added after its settings, ahead of the comment below them
            p.write_text('[home]\nlat = 45.6\n\n[server]\nport = 5051\n# a note\n\n[storage]\ndb_path = ""\n')
            privatelink.write_key(p, "tafo-kemi-luza-nobe")
            text = p.read_text()
            self.assertIn('port = 5051\nkey = "tafo-kemi-luza-nobe"\n# a note', text)
            self.assertEqual(config.load(str(p))["server"]["key"], "tafo-kemi-luza-nobe")
            privatelink.write_key(p, "bado-fegi-huja-kalo")                   # a new one replaces it, in place
            self.assertEqual(p.read_text(), text.replace("tafo-kemi-luza-nobe", "bado-fegi-huja-kalo"))
            privatelink.write_key(p, "")                                      # off: open again
            self.assertEqual(config.load(str(p))["server"]["key"], "")
            q = Path(d) / "other.toml"                                   # no [server] at all: one is added
            q.write_text('[home]\nlat = 45.6\n')
            privatelink.write_key(q, "tafo-kemi-luza-nobe")
            self.assertEqual(q.read_text(), '[home]\nlat = 45.6\n\n[server]\nkey = "tafo-kemi-luza-nobe"\n')
            # the example config, with its commented-out key, takes one too
            e = Path(d) / "example.toml"
            e.write_text(config.EXAMPLE.read_text())
            privatelink.write_key(e, "tafo-kemi-luza-nobe")
            self.assertEqual(config.load(str(e))["server"]["key"], "tafo-kemi-luza-nobe")
        links = dict(privatelink.links("tafo-kemi-luza-nobe", "192.168.1.20", 5050))
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
        from cloudwall.gather.charts import Charts
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
        from cloudwall.serve import server as S
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
        self.assertEqual(S.code_stamp(), S.code_stamp())

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
        from cloudwall.app.place import Place, Places
        from cloudwall.core.db import another_places
        folder = Path(tempfile.mkdtemp())
        db_for = lambda pid: folder / f"cloudwall-{pid}.db"

        def make(pc):                                                   # as cloudwall.app.main makes them
            store = Store(str(db_for(pc["place"]["id"])))
            self.addCleanup(store.close)
            store.claim(pc["home"])
            place = Place(pc, store, demo.Demo(), demo=True)
            place.start = lambda: None
            return place
        places = Places(config.load(), make, None, elsewhere=lambda pid, home: another_places(db_for(pid), home))
        for pc in placing.places(config.load()):
            places.add_config(pc)
        self.assertEqual(places.add({"name": "Cabin", "zip": "97702"}).id, "cabin")              # near Bend
        places.remove("cabin")                                          # its logbook stays: cloudwall-cabin.db
        self.assertEqual(places.add({"name": "Cabin", "lat": 47.6, "lon": -122.3}).id, "cabin-2")   # another cabin: its own
        places.remove("cabin-2")
        self.assertEqual(places.add({"name": "Cabin", "zip": "97702"}).id, "cabin")              # Bend's again: carries on


class PackagingTest(unittest.TestCase):
    def test_every_bundled_file_is_packaged(self):
        """For `pip install .` (not editable): a new folder under web/ or data/ has to be listed in pyproject.toml."""
        import glob
        import tomllib
        root = Path(__file__).resolve().parent.parent
        pkg = root / "cloudwall"
        patterns = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["setuptools"]["package-data"]["cloudwall"]
        packaged = {Path(f) for pattern in patterns for f in glob.glob(pattern, root_dir=pkg)}
        bundled = {f.relative_to(pkg) for f in pkg.rglob("*") if f.is_file() and f.suffix not in (".py", ".pyc")}
        self.assertEqual(bundled - packaged, set())


if __name__ == "__main__":
    unittest.main()
