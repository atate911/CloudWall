"""End-to-end: demo data -> API JSON, sampler loop against a fake feed, import."""
import gzip
import json
import tempfile
import time
import unittest
from pathlib import Path

from coverage3d import config, demo, importer
from coverage3d.sampler import Sampler
from coverage3d.server import App
from coverage3d.station import Station, build_station, read_adsb_im_env
from coverage3d.store import Store


class FakeFeed:
    name, band = "fake", "1090"

    def __init__(self):
        self.n = 0
        self.fail = self.hold = False

    def aircraft(self):
        if self.fail:
            raise OSError("down")
        self.n += 0 if self.hold else 1
        return {"now": 1000.0 + self.n * 2, "aircraft": [
            {"hex": "a00001", "type": "adsb_icao", "flight": "AAL1 ", "alt_baro": 30000, "lat": 45.9 + self.n * 0.001,
             "lon": -122.6, "seen_pos": 0.3, "nac_p": 9, "rssi": -15.0},
            {"hex": "a00002", "type": "tisb_icao", "alt_baro": 3000, "lat": 45.7, "lon": -122.7, "seen_pos": 0.3},
            {"hex": "a00003", "type": "mode_s", "alt_baro": 3000}]}

    def receiver(self):
        return {"lat": 45.59000, "lon": -122.47400}

    def stats(self):
        return {"last1min": {"messages": 600, "local": {"signal": -12.0, "noise": -36.0, "strong_signals": 6}}}

    def outline(self):
        return {}


class AppTests(unittest.TestCase):
    def test_sampler_poll_and_flush(self):
        cfg = config.load(None)
        store = Store(":memory:")
        feed = FakeFeed()
        s = Sampler(cfg, store, [feed])
        s.poll_once(); s.poll_once()
        self.assertEqual(len(s.buffer), 2)                 # only the direct ADS-B aircraft, twice
        self.assertEqual(s.counters["mode_s_seen"], 2)
        seen, at = len(s.live), s.live_time
        self.assertGreater(seen, 0)
        feed.hold = True
        s.poll_once()                                      # the same snapshot again: the live list stays
        self.assertEqual((len(s.live), s.live_time), (seen, at))
        feed.hold = False
        feed.fail = True
        s.poll_once()                                      # feed down: no exception, state recorded
        self.assertFalse(s.up[0])
        s.flush()
        self.assertEqual(store.total_points(), 2)

    def test_nothing_is_sampled_until_the_receiver_says_where_it_is(self):
        cfg = config.load(None)
        feed = FakeFeed()
        there = feed.receiver
        feed.receiver = lambda: (_ for _ in ()).throw(OSError("not up yet"))
        s = Sampler(cfg, Store(":memory:"), [feed])
        s.poll_once()
        self.assertEqual((len(s.buffer), s.live), (0, []))
        feed.receiver = there
        s.poll_once()
        self.assertEqual(len(s.buffer), 1)
        self.assertAlmostEqual(s.station.lat, 45.59)
        feed.receiver = lambda: None                       # and one that stops answering moves nothing
        s.refresh_station()
        self.assertAlmostEqual(s.station.lat, 45.59)

    def test_demo_api(self):
        cfg = config.load(None)
        store = Store(":memory:")
        st = Station(45.590000, -122.474000, 23.0, 4.0)
        n = demo.fill_database(cfg, store, st, days=2)
        self.assertGreater(n, 1000)
        s = Sampler(cfg, store, [demo.DemoFeed(st)])
        app = App(cfg, store, s, s.feeds, demo=True)
        cov = app.api_coverage({"last": ["86400000"]})
        self.assertGreater(len(cov["bands"]), 3)
        self.assertEqual(cov["sector_deg"], 5)
        self.assertGreater(cov["summary"]["max_nm"], 50)
        for b in cov["bands"]:
            for sec in b["sectors"]:
                self.assertLessEqual(sec["p95_nm"], sec["max_nm"] + 1e-9)
        pts = app.api_points({"limit": ["500"]})
        self.assertLessEqual(pts["n"], 500)
        self.assertEqual(len(pts["lon"]), pts["n"])
        self.assertTrue(app.api_vertical({})["cells"])
        self.assertIn("recorder", app.api_stats({}))
        mid = int(time.time()) - 86400
        cmp = app.api_compare({"a_from": [str(mid - 86400)], "a_to": [str(mid)], "b_from": [str(mid)], "b_to": [str(mid + 86400)]})
        self.assertEqual(set(cmp), {"a", "b"})
        with self.assertRaises(ValueError):
            app.api_coverage({"sector": ["7"]})

    def test_station_position_warning_and_env(self):
        cfg = config.load(None)
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            env.write_text("SECRET_TOKEN=hunter2\nFEEDER_LAT=45.59000\nFEEDER_LONG=-122.47400\nFEEDER_ALT_M=27\n")
            self.assertEqual(read_adsb_im_env(str(env)), {"FEEDER_LAT": 45.59000, "FEEDER_LONG": -122.47400, "FEEDER_ALT_M": 27.0})
            cfg.station["adsb_im_env"] = str(env)
            with self.assertLogs("coverage3d.station", "WARNING") as cm:
                build_station(cfg, {"lat": 45.70, "lon": -122.47400})
            self.assertTrue(any("wrong station position" in m for m in cm.output))
            self.assertNotIn("hunter2", "".join(cm.output))
            st = build_station(cfg, {"lat": 45.59000, "lon": -122.47400})
            self.assertAlmostEqual(st.antenna_asl_m, 27.0)

    def test_import_history(self):
        cfg = config.load(None)
        store = Store(":memory:")
        st = Station(45.590000, -122.474000, 23.0, 4.0)
        with tempfile.TemporaryDirectory() as d:
            snap = lambda now: {"now": now, "messages": 1, "aircraft": [
                {"hex": "a1b2c3", "type": "adsb_icao", "alt_baro": 8000, "lat": 45.9 + (now - 5000) * 1e-5, "lon": -122.6, "seen_pos": 0.5, "nac_p": 9, "rssi": -20}]}
            (Path(d) / "history_1.json").write_text(json.dumps(snap(5000.0)))
            with gzip.open(Path(d) / "current_small.gz", "wt") as f:
                json.dump(snap(5100.0), f)
            (Path(d) / "chunk_1.gz").write_bytes(gzip.compress(json.dumps({"files": [{"now": 1, "aircraft": [["a", 1, 2]]}]}).encode()))
            with self.assertLogs("coverage3d.importer", "WARNING"):
                r = importer.import_files(cfg, store, st, [d, str(Path(d) / 'chunk_1.gz')])
            self.assertEqual(r["imported"], 2)
            self.assertEqual(importer.import_files(cfg, store, st, [d])["imported"], 0)   # de-duplicated


if __name__ == "__main__":
    unittest.main()
