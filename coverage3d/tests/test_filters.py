import unittest

from coverage3d import config, filters, geo

CFG = config.DEFAULTS["sampler"]
ST = (45.590000, -122.474000, 27.0, 23.0)
NOW = 1_764_101_933.6


def ac(**kw):
    d = {"hex": "a3539d", "type": "adsb_icao", "flight": "SKW3997 ", "alt_baro": 2550, "alt_geom": 2525,
         "lat": 45.620815, "lon": -122.563161, "seen_pos": 0.27, "nac_p": 10, "rssi": -6.5}
    d.update(kw)
    return d


def flt():
    return filters.PointFilter(*ST, CFG)


class SourceTypeTests(unittest.TestCase):
    def test_direct_types_accepted(self):
        for t in ("adsb_icao", "adsb_icao_nt", "adsb_other"):
            self.assertEqual(filters.classify_source(t), filters.SRC_ADSB)

    def test_mlat_and_uat(self):
        self.assertEqual(filters.classify_source("mlat"), filters.SRC_MLAT)
        self.assertEqual(filters.classify_source("uat"), filters.SRC_UAT)
        self.assertEqual(filters.classify_source("adsb_icao", "978"), filters.SRC_UAT)

    def test_rebroadcast_and_unusable_rejected(self):
        for t in ("adsr_icao", "adsr_other", "tisb_icao", "tisb_trackfile", "tisb_other", "mode_s",
                  "unknown", "adsc", None):
            self.assertIsNone(filters.classify_source(t), t)

    def test_filter_rejects_tisb_even_with_position(self):
        f = flt()
        self.assertIsNone(f.process(ac(type="tisb_icao"), NOW))
        self.assertEqual(f.stats["reject_type:tisb_icao"], 1)

    def test_mlat_can_be_disabled(self):
        f = filters.PointFilter(*ST, {**CFG, "record_mlat": False})
        self.assertIsNone(f.process(ac(type="mlat"), NOW))


class PointFilterTests(unittest.TestCase):
    def test_good_point(self):
        p = flt().process(ac(), NOW)
        self.assertIsNotNone(p)
        self.assertEqual(p.callsign, "SKW3997")
        self.assertEqual(p.alt, 2525)                   # alt_geom preferred
        self.assertAlmostEqual(p.dist_nm, 4.17, delta=0.1)     # r_dst 4.168 in the real record this is moved from
        self.assertAlmostEqual(p.brg, 296.3, delta=0.5)        # r_dir 296.3 likewise
        self.assertEqual(p.t, round(NOW - 0.27))

    def test_alt_falls_back_to_baro(self):
        p = flt().process(ac(alt_geom=None), NOW)
        self.assertEqual(p.alt, 2550)
        self.assertEqual(flt().process(ac(alt_geom=None, alt_baro=3000), NOW).alt_baro, 3000)

    def test_ground(self):
        p = flt().process(ac(alt_baro="ground", alt_geom=None), NOW)
        self.assertTrue(p.ground)
        self.assertIsNone(p.alt_baro)
        self.assertEqual(p.alt, round(23 * geo.FT_PER_M))      # ground elevation

    def test_missing_position_or_stale(self):
        f = flt()
        self.assertIsNone(f.process(ac(lat=None), NOW))
        self.assertIsNone(f.process(ac(seen_pos=2.0), NOW))
        self.assertIsNone(f.process(ac(seen_pos=None), NOW))

    def test_nac_p_threshold(self):
        f = flt()
        self.assertIsNone(f.process(ac(nac_p=4), NOW))
        self.assertIsNotNone(f.process(ac(hex="b00001", nac_p=5), NOW))
        self.assertIsNotNone(f.process(ac(hex="b00002", nac_p=None), NOW))    # absent -> allowed
        f2 = filters.PointFilter(*ST, {**CFG, "min_nac_p": 8})
        self.assertIsNone(f2.process(ac(nac_p=7), NOW))

    def test_implausible(self):
        f = flt()
        self.assertIsNone(f.process(ac(alt_geom=70000), NOW))
        self.assertIsNone(f.process(ac(hex="b00001", alt_geom=-2000, alt_baro=-2000), NOW))
        la, lo = geo.destination(45.590000, -122.474000, 10, 450)
        self.assertIsNone(f.process(ac(hex="b00002", lat=la, lon=lo), NOW))

    def test_duplicate_update_skipped(self):
        f = flt()
        self.assertIsNotNone(f.process(ac(), NOW))
        # next poll 2 s later, same position message: seen_pos grew by 2 -> same position time
        self.assertIsNone(f.process(ac(seen_pos=1.27), NOW + 1.0))
        self.assertEqual(f.stats["reject_duplicate"], 1)
        # a genuinely new position is accepted
        self.assertIsNotNone(f.process(ac(lat=45.6217, seen_pos=0.2), NOW + 2.0))

    def test_speed_jump_rejected_then_recovers(self):
        f = flt()
        self.assertIsNotNone(f.process(ac(), NOW))
        far = dict(lat=46.5, lon=-122.7)                       # ~52 nm away within 2 s: impossible
        self.assertIsNone(f.process(ac(seen_pos=0.1, **far), NOW + 2))
        self.assertIsNone(f.process(ac(seen_pos=0.1, lat=46.5005, lon=-122.7), NOW + 4))
        # third consecutive rejection: the old point was the bad one, so we re-anchor
        self.assertIsNotNone(f.process(ac(seen_pos=0.1, lat=46.501, lon=-122.7), NOW + 6))

    def test_non_icao_hex(self):
        p = flt().process(ac(hex="~abc123", type="adsb_other"), NOW)
        self.assertEqual(filters.format_hex(p.hex), "~abc123")
        self.assertEqual(filters.format_hex(filters.parse_hex("a3539d")), "a3539d")


if __name__ == "__main__":
    unittest.main()
