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


class Served(unittest.TestCase):
    """A CloudWall serving the board, with a settings file of its own, and a way to call it."""

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
        self.addCleanup(srv.server_close)
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



class AdminTest(Served):
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

    def test_a_session_ends_with_the_password_it_was_made_under(self):
        self.serve(owner="correct horse battery")
        self.call("/api/admin/signin", {"password": "correct horse battery"})
        mine = self.cookie
        # changed on the board: the one who changed it stays in
        self.assertEqual(self.call("/api/admin/password", {"password": "another horse battery"})[0], 200)
        self.assertEqual(self.call("/api/admin/overview")[0], 200)
        # changed at the machine (`cloudwall owner`): every session is over
        keys.set_password("a third horse battery", self.cfg_path)
        self.cookie = mine
        self.assertEqual(self.call("/api/admin/overview")[0], 401)

    def test_wrong_passwords_through_a_proxy_are_the_visitors_own(self):
        self.serve(owner="correct horse battery")
        for _ in range(5):
            self.call("/api/admin/signin", {"password": "nope nope nope"}, headers={"X-Forwarded-For": "203.0.113.9"})
        self.assertEqual(self.call("/api/admin/signin", {"password": "correct horse battery"}, headers={"X-Forwarded-For": "203.0.113.9"})[0], 403)
        self.assertEqual(self.call("/api/admin/signin", {"password": "correct horse battery"}, headers={"X-Forwarded-For": "198.51.100.7"})[0], 200)

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
        """[server] address unset, as when Caddy was set up by hand: a request through it is never the machine's own."""
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
        """With the slash the page's relative addresses would point into a missing folder: it would load unstyled."""
        with open(self.cfg_path, "a") as f:
            f.write('[server]\nkey = "tafo-kemi-luza-nobe"\n')
        self.serve()
        for page in ("admin", "kiosk"):
            with urllib.request.urlopen(f"{self.base}/k/tafo-kemi-luza-nobe/{page}/", timeout=5) as r:
                self.assertEqual(r.url, f"{self.base}/k/tafo-kemi-luza-nobe/{page}")
                self.assertIn(b"CloudWall", r.read())


class SavingTest(Served):
    def test_a_setting_with_no_default_can_be_taken_back_out(self):
        self.serve()
        self.assertEqual(self.call("/api/admin/settings", {"section": "home", "key": "elevation_ft", "value": 120})[0], 200)
        self.assertIn("elevation_ft", self.cfg_path.read_text())
        code, got = self.call("/api/admin/settings", {"section": "home", "key": "elevation_ft", "value": None})
        self.assertEqual((code, got.get("restart")), (200, True))
        self.assertNotIn("elevation_ft", self.cfg_path.read_text())

    def test_a_request_that_goes_wrong_is_still_answered(self):
        self.serve()
        code, got = self.call("/api/admin/fix", {"code": "clock.timezone", "value": "Mars/Phobos"})
        self.assertEqual(code, 400)
        self.assertIn("time zone", got["error"])
        self.assertEqual(self.call("/" + "x" * 5000)[0], 404)             # a name too long to be a file

    def test_the_pages_files_are_sent_small_and_not_sent_twice(self):
        import gzip
        import http.client
        self.serve()

        def get(headers):
            c = http.client.HTTPConnection("127.0.0.1", int(self.base.rsplit(":", 1)[1]), timeout=10)
            self.addCleanup(c.close)
            c.request("GET", "/js/app.js", headers=headers)
            r = c.getresponse()
            return r, r.read()
        plain, body = get({})
        zipped, small = get({"Accept-Encoding": "gzip, br"})
        self.assertEqual((zipped.headers["Content-Encoding"], gzip.decompress(small)), ("gzip", body))
        self.assertLess(len(small), len(body) / 2)
        again, nothing = get({"If-None-Match": plain.headers["ETag"]})
        self.assertEqual((again.status, nothing), (304, b""))

    def test_head_gets_the_headers_alone_and_the_connection_goes_on(self):
        import http.client
        self.serve()
        c = http.client.HTTPConnection("127.0.0.1", int(self.base.rsplit(":", 1)[1]), timeout=10)
        self.addCleanup(c.close)
        c.request("HEAD", "/")
        r = c.getresponse()
        self.assertEqual((r.status, r.read()), (200, b""))
        self.assertGreater(int(r.headers["Content-Length"]), 1000)
        c.request("GET", "/api/admin/whoami")                             # the same connection, answered in full
        self.assertIn(b"role", c.getresponse().read())


class BoardPagesTest(Served):
    def test_the_overview_has_what_the_pages_draw(self):
        self.serve()
        o = self.call("/api/admin/overview")[1]
        self.assertEqual((o["home"]["lat"], o["home"]["lon"]), (45.62, -122.66))
        self.assertEqual(o["tracking"]["radius_nm"], config.DEFAULTS["tracking"]["radius_nm"])
        self.assertIn("cache", o["storage"])
        self.assertIsNone(o["storage"]["last_backup"])
        self.assertFalse(o["alerts"])

    def test_the_receivers_settings_take_effect_as_saved(self):
        self.serve()
        code, got = self.call("/api/admin/settings", {"section": "receiver", "key": "home_url", "value": "http://192.0.2.7"})
        self.assertNotIn("restart", got)
        s = self.call("/api/admin/settings")[1]
        self.assertEqual(s["running"]["receiver"]["home_url"], "http://192.0.2.7")     # nothing waits for a restart
        self.assertEqual(self.call("/api/admin/receiver")[1]["home_url"], "http://192.0.2.7")
        self.call("/api/admin/settings", {"section": "tracking", "key": "radius_nm", "value": 21})
        s = self.call("/api/admin/settings")[1]
        self.assertNotEqual(s["running"]["tracking"]["radius_nm"], 21)                  # this one does

    def test_what_the_command_line_gave_isnt_a_change_waiting(self):
        srv = self.serve()
        srv.admin.cfg["_cli"] = ["server.port"]                       # as --port leaves it (app/main.py)
        s = self.call("/api/admin/settings")[1]
        saved = next(st for sec in s["sections"] if sec["name"] == "server" for st in sec["settings"] if st["key"] == "port")
        self.assertEqual(s["running"]["server"]["port"], saved["value"])

    def test_a_test_alert_goes_to_the_saved_address_before_a_restart(self):
        self.serve()
        code, got = self.call("/api/admin/alert-test", {})
        self.assertEqual(code, 400)
        self.assertIn("No alert address", got["error"])
        self.call("/api/admin/settings", {"section": "health", "key": "notify_url", "value": "https://ntfy.example/cw-test"})
        sent = []
        from unittest import mock
        with mock.patch("cloudwall.core.http.post_json", lambda url, body, timeout=10: sent.append((url, body))):
            code, got = self.call("/api/admin/alert-test", {})
        self.assertEqual(code, 200)
        self.assertEqual(sent[0][0], "https://ntfy.example/cw-test")
        self.assertEqual(sent[0][1]["event"], "test")


class StrayLinesTest(Served):
    """Settings-file lines that do nothing (wrong heading, old name), found and put right from the board."""

    def setUp(self):
        super().setUp()
        with open(self.cfg_path, "a") as f:
            f.write('[map]\nstyle = "dark"\nwhen_idle = "log"\n[source]\nname = "my receiver"\n[kiosk]\nidle_after_seconds = 120\n')

    def test_they_are_found_with_where_they_belong(self):
        found = {(x["section"], x["key"]): x["belongs"] for x in config.strays(self.cfg_path)}
        self.assertEqual(found, {("map", "when_idle"): "tracking", ("source", "name"): None,      # never moved: a feed's name
                                 ("kiosk", "idle_after_seconds"): "tracking"})

    def test_one_is_moved_where_it_belongs(self):
        self.serve()
        code, got = self.call("/api/admin/tidy", {"section": "map", "key": "when_idle", "action": "move"})
        self.assertEqual(code, 200)
        cfg = config.load(self.cfg_path)
        self.assertEqual(cfg["tracking"]["when_idle"], "log")
        self.assertEqual(cfg["map"]["style"], "dark")                                   # its neighbour stays
        self.assertNotIn(("map", "when_idle"), [(x["section"], x["key"]) for x in config.strays(self.cfg_path)])

    def test_one_already_set_where_it_belongs_is_only_taken_out(self):
        self.serve()
        config.write_setting(self.cfg_path, "tracking", "idle_after_seconds", 300)
        code, got = self.call("/api/admin/tidy", {"section": "kiosk", "key": "idle_after_seconds", "action": "move"})
        self.assertIn("already set", got["said"])
        self.assertEqual(config.load(self.cfg_path)["tracking"]["idle_after_seconds"], 300)  # what was there wins

    def test_one_with_nowhere_to_go_is_taken_out_and_its_heading_with_it(self):
        self.serve()
        self.assertEqual(self.call("/api/admin/tidy", {"section": "source", "key": "name", "action": "move"})[0], 400)
        code, got = self.call("/api/admin/tidy", {"section": "source", "key": "name", "action": "remove"})
        self.assertEqual(code, 200)
        self.assertNotIn("[source]", self.cfg_path.read_text())
        self.assertEqual(oct(self.cfg_path.stat().st_mode & 0o777), "0o640")              # still the owner's only

    def test_only_a_stray_line_can_be_taken_out(self):
        self.serve()
        code, got = self.call("/api/admin/tidy", {"section": "map", "key": "style", "action": "remove"})
        self.assertEqual(code, 400)
        self.assertEqual(config.load(self.cfg_path)["map"]["style"], "dark")

    def test_the_settings_say_what_they_found(self):
        self.serve()
        got = self.call("/api/admin/settings")[1]
        self.assertEqual(len(got["strays"]), 3)
        self.assertEqual(got["left_out"], [])


class BudgetDaysTest(unittest.TestCase):
    def test_each_days_use_this_period(self):
        import datetime as dt
        from cloudwall.gather.flightradar24 import Flightradar24 as FR24
        cfg = config.load(None)
        cfg["flightradar24"].update(api_key="k", monthly_credits=30000, billing_day=1)
        p = FR24(cfg, Store(":memory:"))
        p._today = lambda: dt.date(2026, 3, 5)
        p.store.cache_put("flightradar24_usage", "2026-03-02", 40)
        p.store.cache_put("flightradar24_usage", "2026-03-05", 7)
        b = p.budget()
        self.assertEqual(b["days"], [["2026-03-01", 0], ["2026-03-02", 40], ["2026-03-03", 0], ["2026-03-04", 0], ["2026-03-05", 7]])
        self.assertEqual((b["period_used"], b["used_today"], b["starts"]), (47, 7, "2026-03-01"))


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
        self.assertIn(f"PathExistsGlob={helper.REQUESTS}/*.json", helper.PATH_UNIT)
        self.assertNotIn("DirectoryNotEmpty", helper.PATH_UNIT)

    def test_root_works_where_the_service_cannot_put_anything_of_its_own(self):
        from cloudwall.operate import install as inst
        # results beside the requests, not among them, under a folder that isn't the service's
        self.assertEqual(helper.DONE.parent, helper.REQUESTS.parent)
        self.assertFalse(str(helper.REQUESTS).startswith(inst.VAR + "/"))
        with tempfile.TemporaryDirectory() as d:
            victim = Path(d) / "victim"
            victim.write_text("root's own")
            folder = Path(d) / "requests"
            (folder / "done").mkdir(parents=True)
            rid = helper.ask("enable-service", folder=folder)
            (folder / "done" / f"{rid}.json").symlink_to(victim)          # a link planted where the result goes
            (folder / "1-00000000.json").symlink_to(victim)               # and a request that is a link
            helper.run_pending(folder, say=lambda *a: None)
            self.assertEqual(victim.read_text(), "root's own")
            self.assertEqual(list(folder.glob("*.json")), [])
        with tempfile.TemporaryDirectory() as d:
            rid = helper.ask("enable-service", folder=d)
            self.assertEqual([p.name for p in Path(d).glob("*.json")], [f"{rid}.json"])   # whole, and named so
            self.assertEqual(list(Path(d).glob(".*.tmp")), [])


class ReceiverTest(AdminTest):
    """The receiver's health read from its own files; its map and Coverage3D passed through, as via the tunnel."""

    def fake_receiver(self):
        import gzip
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        seen = self.seen = []
        files = {
            "/": (b"<!doctype html><title>tar1090</title><script src=script.js></script>", "text/html", None),
            "/script.js": (gzip.compress(b"console.log('map')"), "application/javascript", "gzip"),
            "/data/receiver.json": (json.dumps({"lat": 45.6, "lon": -122.6, "version": "readsb 3.16"}).encode(), "application/json", None),
            "/data/stats.json": (json.dumps({"now": 1e9, "gain_db": 49.6, "estimated_ppm": 0.8, "aircraft_with_pos": 12,
                                             "aircraft_without_pos": 3, "aircraft_count_by_type": {"adsb_icao": 11, "mlat": 1, "tisb_icao": 0},
                                             "last1min": {"messages": 1200, "max_distance": 185200,
                                                          "local": {"accepted": [900, 100], "signal": -12.0, "noise": -32.0,
                                                                    "peak_signal": -2.0, "strong_signals": 30}},
                                             "last15min": {"messages": 9000, "max_distance": 370400, "local": {}}}).encode(), "application/json", None),
            "/data/outline.json": (json.dumps({"actualRange": {"last24h": {"points": [[46.5, -122.6, 30000], [45.6, -121.0, 25000]]}}}).encode(), "application/json", None),
            "/healthz": (b'{"ok": true}', "application/json", None),
        }

        class Receiver(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                seen.append((self.path, self.headers.get("Cookie"), self.headers.get("Accept-Encoding")))
                body, ctype, enc = files.get(self.path.split("?")[0], (b"not here", "text/plain", None))
                self.send_response(200 if self.path.split("?")[0] in files else 404)
                self.send_header("Content-Type", ctype)
                if enc:
                    self.send_header("Content-Encoding", enc)
                self.end_headers()
                self.wfile.write(body)
        rx = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
        threading.Thread(target=rx.serve_forever, daemon=True).start()
        self.addCleanup(rx.shutdown)
        self.addCleanup(rx.server_close)
        port = rx.server_address[1]
        with open(self.cfg_path, "a") as f:
            f.write(f'[receiver]\nurl = "http://127.0.0.1:{port}"\ncoverage_url = "http://127.0.0.1:{port}"\nhome_url = "http://192.168.3.3"\n')
        return port

    def test_the_receivers_health_as_the_board_reads_it(self):
        self.fake_receiver()
        self.serve()
        code, r = self.call("/api/admin/receiver")
        self.assertEqual(code, 200)
        self.assertTrue(r["reachable"] and r["coverage"])
        self.assertEqual((r["gain_db"], r["with_pos"], r["by_type"]), (49.6, 12, {"adsb_icao": 11, "mlat": 1}))
        m = r["last1min"]
        self.assertEqual((m["messages_s"], m["max_nm"], m["strong_pct"]), (20.0, 100.0, 3.0))
        self.assertEqual(r["last15min"]["max_nm"], 200.0)
        self.assertEqual(len(r["outline"]), 2)
        self.assertEqual(r["home_url"], "http://192.168.3.3")

    def test_the_map_is_passed_through_for_the_owner_only_without_the_cookie(self):
        self.fake_receiver()
        self.serve(owner="correct horse battery")
        with self.assertRaises(urllib.error.HTTPError) as e:                     # a viewer
            urllib.request.urlopen(self.base + "/receiver/", timeout=5)
        self.assertEqual(e.exception.code, 401)
        self.call("/api/admin/signin", {"password": "correct horse battery"})
        req = urllib.request.Request(self.base + "/receiver/script.js",
                                     headers={"Cookie": self.cookie, "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(r.headers.get("Content-Encoding"), "gzip")         # passed back as it came
            import gzip
            self.assertEqual(gzip.decompress(r.read()), b"console.log('map')")
        path, cookie, enc = self.seen[-1]
        self.assertEqual((path, cookie, enc), ("/script.js", None, "gzip"))     # the board's cookie never goes on
        req = urllib.request.Request(self.base + "/receiver", headers={"Cookie": self.cookie})
        with urllib.request.urlopen(req, timeout=5) as r:                        # followed to /receiver/
            self.assertIn(b"tar1090", r.read())
        for bad in ("/receiver/../etc/passwd", "/receiver/http://evil.example/x", "/receiver//etc/passwd"):
            req = urllib.request.Request(self.base + bad, headers={"Cookie": self.cookie})
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(req, timeout=5)
            self.assertIn(e.exception.code, (400, 404))

    def test_without_a_receiver_the_page_says_so(self):
        self.serve()
        code, r = self.call("/api/admin/receiver")
        self.assertEqual((code, r["url"], r["reachable"]), (200, None, False))
        self.assertEqual(self.call("/receiver/")[0], 404)

    def test_the_tunnels_receiver_and_coverage3d_are_found_from_the_feeds(self):
        from cloudwall.app.admin import Admin
        cfg = config.load(None)
        cfg["source"].update(urls=["http://127.0.0.1:18080/data/aircraft.json", "https://opendata.adsb.fi/{lat}"], merge=True)
        self.assertEqual(Admin(cfg, []).receiver_urls(), ("http://127.0.0.1:18080", "http://127.0.0.1:18090"))
        cfg["source"].update(urls=["http://192.168.3.3:8080/data/aircraft.json", "https://x/{lat}"])
        self.assertEqual(Admin(cfg, []).receiver_urls(), ("http://192.168.3.3:8080", "http://192.168.3.3:8090"))
