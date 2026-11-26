import math
import unittest

from coverage3d import geo


class GeoTests(unittest.TestCase):
    def test_distance_one_degree_latitude(self):
        # 1 degree of latitude is about 60 nm
        self.assertAlmostEqual(geo.haversine_nm(45, -122, 46, -122), 60.04, delta=0.1)

    def test_distance_zero_and_symmetry(self):
        self.assertEqual(geo.haversine_nm(45.6, -122.6, 45.6, -122.6), 0.0)
        a = geo.haversine_nm(45.6, -122.6, 47.4, -122.3)
        b = geo.haversine_nm(47.4, -122.3, 45.6, -122.6)
        self.assertAlmostEqual(a, b, places=9)

    def test_known_pair_station_to_sea(self):
        # station -> SEA is roughly 109 nm to the north (bearing about 8 deg)
        d = geo.haversine_nm(45.636284, -122.677496, 47.4502, -122.3088)
        self.assertAlmostEqual(d, 109.3, delta=1.5)
        b = geo.bearing_deg(45.636284, -122.677496, 47.4502, -122.3088)
        self.assertAlmostEqual(b, 7.8, delta=0.3)

    def test_bearing_cardinals(self):
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 46, -122), 0.0, places=6)
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 45, -121), 90.0, delta=0.5)
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 44, -122), 180.0, places=6)
        self.assertAlmostEqual(geo.bearing_deg(45, -122, 45, -123), 270.0, delta=0.5)

    def test_destination_roundtrip(self):
        for brg in (0, 33, 90, 177, 250, 359):
            la, lo = geo.destination(45.636284, -122.677496, brg, 123.0)
            self.assertAlmostEqual(geo.haversine_nm(45.636284, -122.677496, la, lo), 123.0, places=4)
            diff = (geo.bearing_deg(45.636284, -122.677496, la, lo) - brg + 180) % 360 - 180
            self.assertAlmostEqual(diff, 0.0, delta=0.01)

    def test_elevation_angle_overhead_and_horizon(self):
        self.assertEqual(geo.elevation_angle_deg(10000, 27, 0.0), 90.0)
        # 10 km up at 10 km range: roughly 45 degrees (curvature term is tiny)
        e = geo.elevation_angle_deg(10027, 27, 10000 / 1852.0)
        self.assertAlmostEqual(e, 45.0, delta=0.2)

    def test_elevation_angle_curvature(self):
        # Same height as the antenna, 50 nm away: below the horizontal plane by d/(2 Reff)
        d = 50 * 1852.0
        expect = math.degrees(math.atan(-d / (2 * 4 / 3 * 6371000.0)))
        self.assertAlmostEqual(geo.elevation_angle_deg(27, 27, 50), expect, places=6)
        self.assertLess(expect, 0)

    def test_radio_horizon(self):
        # 1.23 * (sqrt(88) + sqrt(35000))  ~ 241.7 nm
        self.assertAlmostEqual(geo.radio_horizon_nm(88, 35000), 1.23 * (88 ** 0.5 + 35000 ** 0.5), places=9)
        self.assertAlmostEqual(geo.radio_horizon_nm(88, 35000), 241.65, delta=0.1)
        self.assertAlmostEqual(geo.radio_horizon_nm(0, 0), 0.0)


if __name__ == "__main__":
    unittest.main()
