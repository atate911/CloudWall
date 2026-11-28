import random
import unittest

from coverage3d import binning
from coverage3d.filters import Point
from coverage3d.store import Store, DAY


class IndexTests(unittest.TestCase):
    def test_sector_index(self):
        self.assertEqual(binning.sector_index(0, 5), 0)
        self.assertEqual(binning.sector_index(4.99, 5), 0)
        self.assertEqual(binning.sector_index(5.0, 5), 1)
        self.assertEqual(binning.sector_index(359.9, 5), 71)
        self.assertEqual(binning.sector_index(360.0, 5), 0)
        self.assertEqual(binning.n_sectors(5), 72)
        self.assertEqual(binning.n_sectors(10), 36)

    def test_band_index(self):
        self.assertEqual(binning.band_index(0, 2500, 45000), 0)
        self.assertEqual(binning.band_index(2499, 2500, 45000), 0)
        self.assertEqual(binning.band_index(2500, 2500, 45000), 1)
        self.assertEqual(binning.band_index(-500, 2500, 45000), 0)
        self.assertEqual(binning.band_index(44999, 2500, 45000), 17)
        self.assertEqual(binning.band_index(52000, 2500, 45000), 17)     # above the top: top band
        self.assertEqual(binning.band_index(1200, 2500, 45000, ground=True), binning.GROUND)
        self.assertEqual(binning.n_bands(2500, 45000), 18)
        self.assertEqual(binning.n_bands(1000, 45000), 45)

    def test_percentile(self):
        v = list(range(1, 101))
        self.assertAlmostEqual(binning.percentile(v, 50), 50.5)
        self.assertAlmostEqual(binning.percentile(v, 95), 95.05)
        self.assertEqual(binning.percentile([7], 95), 7)


class BinTests(unittest.TestCase):
    def test_bin_stats(self):
        pts = [(10.0, 3000, False, d, -20.0, 100 + i) for i, d in enumerate(range(1, 101))]  # 1..100 nm
        d, r = binning.hist_rows(pts, 5, 2500, 45000)
        bins = binning.build_bins(d, r)
        b = bins[(2, 1)]
        self.assertEqual(b["count"], 100)
        self.assertAlmostEqual(b["max_nm"], 100.0)
        self.assertAlmostEqual(b["p95_nm"], 95.0, delta=1.5)       # 1 nm histogram resolution
        self.assertEqual(b["rssi_min"], -20.0)
        self.assertAlmostEqual(b["rssi_med"], -20.0, delta=1.0)
        self.assertEqual((b["first"], b["last"]), (100, 199))

    def test_p95_resists_a_bad_position(self):
        pts = [(10.0, 3000, False, 50.0 + (i % 10), -20.0, i) for i in range(200)]
        pts.append((10.0, 3000, False, 380.0, -20.0, 999))         # one wild point
        bins = binning.build_bins(*binning.hist_rows(pts, 5, 2500, 45000))
        b = bins[(2, 1)]
        self.assertEqual(b["max_nm"], 380.0)
        self.assertLess(b["p95_nm"], 62)

    def test_min_points_and_ground(self):
        pts = [(10.0, 100, True, 2.0, -5.0, 1), (10.0, 100, True, 3.0, -5.0, 2), (200.0, 5000, False, 40.0, -25.0, 3)]
        bins = binning.build_bins(*binning.hist_rows(pts, 5, 2500, 45000), min_points=2)
        self.assertIn((2, binning.GROUND), bins)
        self.assertNotIn((40, 2), bins)

    def test_histograms_add_up(self):
        """Rows from two days merged == rows from all points at once (what makes aggregates valid)."""
        rng = random.Random(1)
        pts = [(rng.uniform(0, 360), rng.uniform(0, 44000), False, rng.uniform(1, 200), rng.uniform(-30, -5), i)
               for i in range(3000)]
        whole = binning.build_bins(*binning.hist_rows(pts, 5, 2500, 45000))
        a = binning.hist_rows(pts[:1500], 5, 2500, 45000)
        b = binning.hist_rows(pts[1500:], 5, 2500, 45000)
        merged = binning.build_bins(a[0] + b[0], a[1] + b[1])
        self.assertEqual(whole, merged)


def make_point(t, brg, alt, dist, rssi=-20.0, hex_=1, src=0, ground=False):
    return Point(t=t, hex=hex_, callsign="TEST1", src=src, lat=45.0, lon=-122.0, alt_baro=alt, alt_geom=alt,
                 alt=alt, ground=ground, rssi=rssi, dist_nm=dist, brg=brg, elev=1.0)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.s = Store(":memory:")
        rng = random.Random(5)
        self.base = (1_700_000_000 // DAY) * DAY
        self.pts = [make_point(self.base + rng.randrange(0, 4 * DAY), rng.uniform(1, 359), rng.randrange(500, 44000),
                               rng.uniform(1.0, 190.0), rng.uniform(-30, -5), hex_=i % 40 + 1,
                               src=0 if i % 10 else 1) for i in range(4000)]
        self.s.insert_points(self.pts)

    def python_bins(self, pts, srcs=(0,)):
        rows = [(p.brg, p.alt, p.ground, int(p.dist_nm * 100) / 100.0, p.rssi, p.t) for p in pts if p.src in srcs]
        return binning.build_bins(*binning.hist_rows(rows, 5, 2500, 45000))

    def test_sql_histogram_matches_python(self):
        d, r = self.s.coverage_hist(self.base, self.base + 5 * DAY, [0], 5, 2500, 45000)
        got = binning.build_bins(d, r)
        want = self.python_bins(self.pts)
        self.assertEqual(set(got), set(want))
        self.assertEqual(sum(v["count"] for v in got.values()), sum(v["count"] for v in want.values()))
        for k in want:
            self.assertEqual(got[k]["count"], want[k]["count"])
            self.assertAlmostEqual(got[k]["max_nm"], want[k]["max_nm"], delta=0.02)

    def test_source_filter(self):
        d0, _ = self.s.coverage_hist(self.base, self.base + 5 * DAY, [0], 5, 2500, 45000)
        d1, _ = self.s.coverage_hist(self.base, self.base + 5 * DAY, [1], 5, 2500, 45000)
        d01, _ = self.s.coverage_hist(self.base, self.base + 5 * DAY, [0, 1], 5, 2500, 45000)
        self.assertEqual(sum(x[3] for x in d0) + sum(x[3] for x in d1), sum(x[3] for x in d01))
        self.assertEqual(sum(x[3] for x in d1), sum(1 for p in self.pts if p.src == 1))

    def test_daily_aggregates_equal_raw_and_survive_pruning(self):
        now = self.base + 6 * DAY
        before = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 5, 2500, 45000))
        coarse = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 10, 5000, 45000))
        self.assertEqual(self.s.aggregate_days(5, 2500, 45000, now=now), 4)
        self.assertEqual(self.s.aggregate_days(5, 2500, 45000, now=now), 0)      # idempotent
        # wider sectors and taller tiers are put together from the aggregates kept
        folded = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 10, 5000, 45000))
        self.assertEqual(set(coarse), set(folded))
        for k in coarse:
            self.assertEqual(coarse[k]["count"], folded[k]["count"])
            self.assertAlmostEqual(coarse[k]["max_nm"], folded[k]["max_nm"], places=6)
        after = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 5, 2500, 45000))
        for k in before:
            self.assertEqual(before[k]["count"], after[k]["count"])
            self.assertAlmostEqual(before[k]["p95_nm"], after[k]["p95_nm"], places=6)
        # raw points older than the retention window are deleted; the aggregates answer the query
        deleted = self.s.prune(1, now=now)
        self.assertGreater(deleted, 0)
        self.assertEqual(self.s.total_points(), 0)
        still = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 10, 5000, 45000))
        self.assertEqual({k: v["count"] for k, v in still.items()}, {k: v["count"] for k, v in coarse.items()})
        kept = binning.build_bins(*self.s.coverage_hist(self.base, self.base + 4 * DAY, [0], 5, 2500, 45000))
        self.assertEqual({k: v["count"] for k, v in kept.items()}, {k: v["count"] for k, v in before.items()})

    def test_partial_day_mixes_aggregate_and_raw(self):
        self.s.aggregate_days(5, 2500, 45000, now=self.base + 6 * DAY)
        t0, t1 = self.base + DAY // 2, self.base + 3 * DAY + DAY // 3
        d, r = self.s.coverage_hist(t0, t1, [0], 5, 2500, 45000)
        got = sum(x[3] for x in d)
        want = sum(1 for p in self.pts if p.src == 0 and t0 <= p.t < t1)
        self.assertEqual(got, want)

    def test_insert_and_callsign(self):
        self.assertEqual(self.s.aircraft_name(1), "TEST1")
        self.assertEqual(self.s.total_points(), 4000)

    def test_points_downsample(self):
        total, k, rows = self.s.points(self.base, self.base + 5 * DAY, [0, 1], 500)
        self.assertEqual(total, 4000)
        self.assertLessEqual(len(rows), 500)


if __name__ == "__main__":
    unittest.main()
