import unittest
from pathlib import Path

from cloudwall.core import config
from cloudwall.memory.store import Store
from cloudwall.reference import placing

import support

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class ConfigMistakesTest(unittest.TestCase):
    def load(self, text):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as f:
            f.write(text)
        self.addCleanup(Path(f.name).unlink)
        return config.load(f.name)

    def test_a_word_cloudwall_doesnt_know_is_left_out_by_name(self):
        for section, key, bad, toml, words in (
                ("flightradar24", "mode", "alwyas", '"alwyas"', "[flightradar24] mode must be"),
                ("kiosk", "view", "radr", '"radr"', "[kiosk] view must be"),
                ("map", "style", "sattelite", '"sattelite"', "[map] style must be"),
                ("map", "opacity", 4, "4", "[map] opacity must be from 0 to 1")):
            with self.assertLogs("cloudwall", "WARNING"):
                cfg = self.load(f"[{section}]\n{key} = {toml}")       # it still starts
            self.assertIn(words, cfg["_problems"][0])
            self.assertEqual(cfg[section][key], config.DEFAULTS[section][key])
            with self.assertRaises(ValueError):                         # but isn't written that way (Setup)
                config.check(section, {key: bad})
        self.assertEqual(self.load('[flightradar24]\nmode = "Always"')["flightradar24"]["mode"], "always")   # case doesn't matter

    def test_a_config_file_that_isnt_there_is_said_plainly(self):
        with self.assertRaises(ValueError) as e:
            config.load("/nonexistent/cloudwall.toml")
        self.assertIn("no such file", str(e.exception))

    def test_zip_beside_lat_and_lon_is_warned_about(self):
        with self.assertLogs("cloudwall", "WARNING") as logs:
            cfg = self.load('[home]\nzip = "97702"\nlat = 45.59\nlon = -122.47')
        self.assertEqual(cfg["home"]["lat"], 45.59)
        self.assertIn("ZIP code ignored", logs.output[0])

    def test_both_names_for_a_monthly_allowance_are_taken(self):
        from cloudwall.gather.flightradar24 import Flightradar24
        for name in ("monthly_credits", "monthly_limit"):
            cfg = self.load(f'[flightradar24]\n{name} = 30000')
            self.assertEqual(Flightradar24(cfg, Store(":memory:")).monthly_limit, 30000)

    def test_a_written_config_is_readable_by_its_owner_only(self):
        import os
        import stat
        import tempfile
        from cloudwall.operate import privatelink
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            privatelink.write_key(p, "tafo-kemi-luza-nobe")
            self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)
            os.chmod(p, 0o644)
            privatelink.write_key(p, "")
            self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o640)   # world-readable no longer (the group keeps its read)
            path, _ = config.init(Path(d, "new.toml"))
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)


class DatabaseTest(unittest.TestCase):
    def test_a_file_is_migrated_once_and_says_so(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d, "logbook.db"))
            s = Store(path)
            self.assertEqual(s.version, 2)
            s.close()
            s = Store(path)                                             # opened again: nothing re-run
            self.assertEqual(s.version, 2)
            s.close()

    def test_a_damaged_file_is_set_aside_not_fatal(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, "logbook.db")
            path.write_bytes(b"this is not a database at all" * 100)
            with self.assertLogs("cloudwall.db", "ERROR") as logs:
                s = Store(str(path))
            self.addCleanup(s.close)
            self.assertEqual(s.count("1"), 0)                           # a fresh logbook, working
            self.assertEqual(len(list(Path(d).glob("logbook.db.damaged-*"))), 1)
            self.assertIn("moved aside", logs.output[0])

    def test_a_logbook_that_is_only_busy_is_left_alone(self):
        import sqlite3
        import tempfile
        from cloudwall.core import db
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "logbook.db")
            other = sqlite3.connect(path)
            self.addCleanup(other.close)
            other.execute("CREATE TABLE t (x)")
            other.execute("BEGIN EXCLUSIVE")
            real = db._connect

            def impatient(p):                  # (as _connect, without the five seconds' wait)
                c = sqlite3.connect(p, check_same_thread=False, timeout=0)
                try:
                    c.execute("PRAGMA journal_mode=WAL")
                except sqlite3.Error:
                    c.close()
                    raise
                return c
            db._connect = impatient
            try:
                self.assertRaises(sqlite3.OperationalError, db.open_or_set_aside, path)
            finally:
                db._connect = real
            self.assertEqual(list(Path(d).glob("logbook.db.damaged-*")), [])


class LogbookKeptTest(unittest.TestCase):
    def test_the_logbooks_answer_is_kept_until_a_flyover_changes_it(self):
        s = Store(":memory:")
        self.addCleanup(s.close)
        sid = s.add_sighting(ts=1.0, day="2026-11-27", hex="a1", callsign="ASA1", type="B738")
        first = s.logbook("2026-11-27")
        first["recent"][0]["callsign"] = "scribbled on"            # a caller's own copy
        asked = []
        real, s._logbook = s._logbook, lambda day: asked.append(day) or real(day)
        self.assertEqual(s.logbook("2026-11-27")["recent"][0]["callsign"], "ASA1")
        self.assertEqual(asked, [])                                  # not worked out again
        s.update_sighting(sid, alt_ft=3000)
        s.add_sighting(ts=2.0, day="2026-11-27", hex="b2", callsign="UAL2", type="A320")
        self.assertEqual((s.logbook("2026-11-27")["today"], s.logbook("2026-11-28")["today"]), (2, 0))
        self.assertEqual(asked, ["2026-11-27", "2026-11-28"])


class SettingsFileTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.path = Path(d.name) / "config.toml"

    def test_a_list_over_several_lines_is_replaced_whole(self):
        import tomllib
        self.path.write_text((Path(config.__file__).parent.parent / "config.example.toml").read_text())
        config.write_setting(self.path, "source", "urls", ["http://pi:8080/data/aircraft.json"])
        got = tomllib.loads(self.path.read_text())
        self.assertEqual(got["source"]["urls"], ["http://pi:8080/data/aircraft.json"])
        self.assertIs(got["source"]["merge"], False)              # the line after the list is still there
        config.remove_setting(self.path, "source", "urls")
        self.assertNotIn("urls", tomllib.loads(self.path.read_text())["source"])

    def test_a_list_over_several_lines_is_taken_out_whole(self):
        import tomllib
        self.path.write_text('[source]\nurls = [\n  "https://a.example/{lat}",\n  "https://b.example/{lat}",\n]\nmerge = true\n')
        config.remove_setting(self.path, "source", "urls")
        self.assertEqual(tomllib.loads(self.path.read_text()), {"source": {"merge": True}})

    def test_numbers_that_cannot_be_used_are_refused(self):
        self.path.write_text("[home]\nlat = 45.6\nlon = -122.6\n")
        for section, key, value in (("tracking", "poll_seconds", float("inf")), ("tracking", "radius_nm", float("nan")),
                                    ("home", "lat", 999), ("home", "lon", -181)):
            with self.assertRaises(ValueError, msg=(section, key, value)):
                config.write_setting(self.path, section, key, value)
        config.write_setting(self.path, "home", "lon", -122.474)
        self.assertEqual(config.load(self.path)["home"]["lon"], -122.474)


class SmallFixesTest(unittest.TestCase):
    def test_an_airport_named_by_its_iata_code_alone(self):
        ap = placing.complete_airport({"icao": "auto", "iata": "PDX"}, {"lat": 45.6, "lon": -122.6}, 15)
        self.assertEqual((ap["icao"], ap["iata"]), ("KPDX", "PDX"))

    def test_a_report_hides_every_address_and_key(self):
        from cloudwall.operate.cli import mask
        text = ('[home]\nzip = "98683"\nlat = 45.61234\n[source]\nurls = [\n  "http://user:pw@10.0.0.5:8080/data/aircraft.json",\n]\n'
                '[alerts]\nnotify_url = "https://ntfy.sh/my-secret-topic"\n[receiver]\nhome_url = "http://10.0.0.5"\n'
                '[server]\nkey = "abcdefghijklmnop"\naddress = "wall.example.org"\nport = 5050\n')
        out = mask(text)
        for secret in ("98683", "10.0.0.5", "user:pw", "my-secret-topic", "abcdefghijklmnop", "wall.example.org", "45.61234"):
            self.assertNotIn(secret, out)
        self.assertIn("lat = 45.61", out)
        self.assertIn("port = 5050", out)


if __name__ == "__main__":
    unittest.main()
