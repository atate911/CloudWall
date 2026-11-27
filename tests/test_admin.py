"""The control board's API (app/admin.py, serve/auth.py, operate/helper.py), through a real server:
who may do what, and that what the owner does from the page is done."""
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from cloudwall.core import config, keys
from cloudwall.gather import demo
from cloudwall.memory.store import Store
from cloudwall.operate import helper
from cloudwall.reference import placing


class StubEnricher:
    live = None

    def aircraft(self, hexid):
        return None

    def photo(self, hexid, reg=None, icao_type=None):
        return None

    def route(self, callsign):
        return None


class AdminTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg_path = self.dir / "config.toml"
        self.cfg_path.write_text(f'[home]\nlat = 45.62\nlon = -122.66\n[storage]\ndb_path = "{self.dir}/cloudwall.db"\n')
        os.chmod(self.cfg_path, 0o640)

    def serve(self, owner=None):
        from cloudwall.app.admin import Admin
        from cloudwall.app.place import Place, Places
        from cloudwall.serve.server import make_server
        if owner:
            keys.set_password(owner, self.cfg_path)
        cfg = config.load(self.cfg_path)
        cfg["server"]["host"], cfg["server"]["port"] = "127.0.0.1", 0

        def make(pc):
            place = Place(pc, Store(":memory:"), demo.Demo())
            place.tracker.enricher = StubEnricher()
            place.start = lambda: None
            return place
        places = Places(cfg, make)
        for pc in placing.places(cfg):
            places.add_config(pc)
        srv = make_server(cfg, places)
        self.store = Store(":memory:")
        srv.admin = Admin(cfg, places, store=self.store)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        self.base = f"http://127.0.0.1:{srv.server_address[1]}"
        self.cookie = None
        return srv

    def call(self, path, body=None, method=None, headers=None):
        h = {"Content-Type": "application/json", **(headers or {})}
        if self.cookie:
            h["Cookie"] = self.cookie
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method or ("POST" if body is not None else "GET"), headers=h)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                got = r.read()
                cookie = r.headers.get("Set-Cookie")
                if cookie:
                    self.cookie = cookie.split(";")[0]
                return r.status, json.loads(got) if r.headers.get("Content-Type") == "application/json" else got
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_with_no_owner_this_machine_may_and_a_proxied_visitor_may_not(self):
        self.serve()
        code, who = self.call("/api/admin/whoami")
        self.assertEqual((who["role"], who["owner_set"]), ("owner", False))     # 127.0.0.1, no proxy
        code, _ = self.call("/api/admin/overview", headers={"X-Forwarded-For": "203.0.113.9"})
        self.assertEqual(code, 401)                                             # through Caddy: a visitor

    def test_signing_in_and_out(self):
        self.serve(owner="correct horse battery")
        self.assertEqual(self.call("/api/admin/overview")[0], 401)
        code, got = self.call("/api/admin/signin", {"password": "wrong password"})
        self.assertEqual(code, 403)
        code, _ = self.call("/api/admin/signin", {"password": "correct horse battery"})
        self.assertEqual(code, 200)
        self.assertTrue(self.cookie.startswith("cloudwall_owner="))
        self.assertEqual(self.call("/api/admin/whoami")[1]["role"], "owner")
        self.assertEqual(self.call("/api/admin/overview")[0], 200)
        self.call("/api/admin/signout", {})
        self.cookie = None
        self.assertEqual(self.call("/api/admin/overview")[0], 401)

    def test_too_many_wrong_passwords_wait(self):
        self.serve(owner="correct horse battery")
        for _ in range(5):
            self.call("/api/admin/signin", {"password": "nope nope nope"})
        code, got = self.call("/api/admin/signin", {"password": "correct horse battery"})
        self.assertEqual(code, 403)
        self.assertIn("Too many", got["error"])

    def test_a_session_survives_a_restart(self):
        srv = self.serve(owner="correct horse battery")
        self.call("/api/admin/signin", {"password": "correct horse battery"})
        token = self.cookie.split("=", 1)[1]
        from cloudwall.serve.auth import Owner
        fresh = Owner(srv.admin.cfg, self.store)                                # a new process, the same store
        self.assertTrue(fresh.valid(token))

    def test_places_need_the_owner_once_there_is_one(self):
        self.serve(owner="correct horse battery")
        code, got = self.call("/api/places", {"q": "97702", "name": "Cabin"})
        self.assertEqual(code, 403)
        self.assertIn("owner", got["error"])
        self.call("/api/admin/signin", {"password": "correct horse battery"})
        self.assertEqual(self.call("/api/places", {"q": "97702", "name": "Cabin"})[0], 200)

    def test_a_setting_is_saved_checked_and_secrets_never_come_back(self):
        self.serve()
        code, got = self.call("/api/admin/settings", {"section": "tracking", "key": "radius_nm", "value": "20"})
        self.assertEqual(code, 200)
        self.assertTrue(got["restart"])
        self.assertEqual(config.load(self.cfg_path)["tracking"]["radius_nm"], 20)
        code, got = self.call("/api/admin/settings", {"section": "map", "key": "opacity", "value": "7"})
        self.assertEqual(code, 400)
        self.assertIn("from 0 to 1", got["error"])
        self.call("/api/admin/settings", {"section": "flightradar24", "key": "api_key", "value": "fr24-secret"})
        code, got = self.call("/api/admin/settings")
        self.assertNotIn("fr24-secret", json.dumps(got))
        self.assertEqual(code, 200)

    def test_a_setting_with_no_default_is_saved_as_its_kind(self):
        self.serve()
        code, got = self.call("/api/admin/settings", {"section": "home", "key": "elevation_ft", "value": "100"})
        self.assertEqual(code, 200, got)
        self.assertEqual(config.load(self.cfg_path)["home"]["elevation_ft"], 100)
        [home] = [x for x in self.call("/api/admin/settings")[1]["sections"] if x["name"] == "home"]
        self.assertEqual({st["key"]: st["kind"] for st in home["settings"]}["elevation_ft"], "number")

    def test_another_settings_tolerated_word_doesnt_block_a_save(self):
        with open(self.cfg_path, "a") as f:
            f.write('[kiosk]\nview = "radr"\n')                              # read with a warning, left out
        self.serve()
        code, got = self.call("/api/admin/settings", {"section": "kiosk", "key": "quiet", "value": "23:00-06:30"})
        self.assertEqual(code, 200, got)
        code, got = self.call("/api/admin/settings", {"section": "kiosk", "key": "view", "value": "nonsense"})
        self.assertEqual(code, 400)                                         # the one written is still checked

    def test_a_guided_fix_from_the_page(self):
        self.serve()
        code, got = self.call("/api/admin/fix", {"code": "settings.placeholder", "name": "home", "value": "nowhere"})
        self.assertEqual(code, 400)
        self.assertIn("ZIP", got["error"])
        code, got = self.call("/api/admin/fix", {"code": "settings.placeholder", "name": "home", "value": "97702"})
        self.assertEqual(code, 200)
        self.assertAlmostEqual(config.load(self.cfg_path)["home"]["lat"], 44.0, delta=0.3)

    def test_the_rebinding_guard(self):
        self.serve()
        code, _ = self.call("/api/admin/whoami", headers={"Host": "evil.example.com"})
        self.assertEqual(code, 403)

    def test_through_caddy_any_name_works_but_needs_the_owner(self):
        """Caddy serves CloudWall at the name it was given ([server] address unset, as when Caddy was
        set up by hand): the board answers there, and a request through it is never the machine's own."""
        self.serve(owner="correct horse battery")
        via = {"Host": "sky.example.com", "X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https"}
        code, who = self.call("/api/admin/whoami", headers=via)
        self.assertEqual((code, who["role"]), (200, "viewer"))
        code, _ = self.call("/api/admin/signin", {"password": "correct horse battery"}, headers=via)
        self.assertEqual(code, 200)
        self.assertEqual(self.call("/api/admin/overview", headers=via)[0], 200)

    def test_another_sites_page_cant_change_anything(self):
        self.serve()
        code, _ = self.call("/api/admin/settings", {"section": "tracking", "key": "radius_nm", "value": 20},
                            headers={"Origin": "https://evil.example.com"})
        self.assertEqual(code, 403)

    def test_backups_from_the_page(self):
        self.serve()
        code, got = self.call("/api/admin/backups", {})
        self.assertEqual(code, 200)
        listed = self.call("/api/admin/backups")[1]["backups"]
        self.assertEqual(listed[0]["name"], got["name"])
        code, data = self.call(f"/api/admin/backups/{got['name']}")
        self.assertEqual((code, data[:2]), (200, b"\x1f\x8b"))                  # a gzip file
        self.assertEqual(self.call("/api/admin/backups/..%2Fconfig.toml")[0], 404)

    def test_the_board_page_is_served(self):
        self.serve()
        with urllib.request.urlopen(self.base + "/admin", timeout=5) as r:
            self.assertIn(b"CloudWall", r.read())

    def test_a_slash_after_admin_or_kiosk_is_sent_to_the_address_without_it(self):
        """With the slash the page's relative addresses would point into a folder that isn't there
        and it would load unstyled: so it is redirected, under a private link as well."""
        with open(self.cfg_path, "a") as f:
            f.write('[server]\nkey = "tafo-kemi-luza-nobe"\n')
        self.serve()
        for page in ("admin", "kiosk"):
            with urllib.request.urlopen(f"{self.base}/k/tafo-kemi-luza-nobe/{page}/", timeout=5) as r:
                self.assertEqual(r.url, f"{self.base}/k/tafo-kemi-luza-nobe/{page}")    # followed to here
                self.assertIn(b"CloudWall", r.read())


class HelperTest(unittest.TestCase):
    def test_only_what_is_on_the_list_is_done(self):
        with tempfile.TemporaryDirectory() as d:
            done = []
            real = dict(helper.ALLOWED)
            helper.ALLOWED["enable-service"] = ("start CloudWall at boot", lambda s, a: done.append("enabled") or "enabled")
            try:
                rid = helper.ask("enable-service", folder=d)
                Path(d, "999-deadbeef.json").write_text(json.dumps({"id": "999-deadbeef", "action": "rm -rf /"}))
                results = helper.run_pending(d, say=lambda *a: None)
            finally:
                helper.ALLOWED.clear()
                helper.ALLOWED.update(real)
            self.assertEqual(done, ["enabled"])
            self.assertTrue(helper.result(rid, d)["ok"])
            refused = helper.result("999-deadbeef", d)
            self.assertFalse(refused["ok"])
            self.assertIn("refused", refused["said"])
            self.assertEqual(len(results), 2)
            with self.assertRaises(ValueError):
                helper.ask("anything else", folder=d)

    def test_a_time_zone_must_be_one(self):
        for bad in ("../../etc/passwd", "Not/AZone", "x; rm -rf /"):
            with self.assertRaises(Exception):
                helper._zone({"zone": bad})
        self.assertEqual(helper._zone({"zone": "America/Los_Angeles"}), "America/Los_Angeles")


if __name__ == "__main__":
    unittest.main()


class HelperUnitTest(unittest.TestCase):
    def test_the_path_unit_waits_for_a_request_not_for_anything_in_the_folder(self):
        # done/ lives in the requests folder: a unit firing on "not empty" would fire for ever
        self.assertIn(f"PathExistsGlob={helper.REQUESTS}/*.json", helper.PATH_UNIT)
        self.assertNotIn("DirectoryNotEmpty", helper.PATH_UNIT)
        self.assertEqual(helper.DONE.parent, helper.REQUESTS)
        with tempfile.TemporaryDirectory() as d:
            rid = helper.ask("enable-service", folder=d)
            self.assertEqual([p.name for p in Path(d).glob("*.json")], [f"{rid}.json"])   # whole, and named so
            self.assertEqual(list(Path(d).glob(".*.tmp")), [])
