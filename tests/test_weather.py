import json
import time
import unittest

import support

setUpModule, tearDownModule = support.setUpModule, support.tearDownModule       # the guard that keeps tests off the network


class WeatherTest(unittest.TestCase):
    def test_decoding(self):
        from cloudwall.gather import weather as W
        self.assertEqual([W.parse_vis(v) for v in ("10+", "1 1/2", "1/4", 6, None)], [10, 1.5, 0.25, 6, None])
        self.assertEqual(W.ceiling([{"cover": "FEW", "base": 900}, {"cover": "BKN", "base": 2100}, {"cover": "OVC", "base": 6000}]), 2100)
        self.assertEqual([W.category(400, 10), W.category(900, 10), W.category(3000, 10), W.category(None, 4), W.category(None, 10)],
                         ["LIFR", "IFR", "MVFR", "MVFR", "VFR"])
        self.assertEqual(W.wx_words("-RA BR"), "light rain, mist")
        self.assertEqual(W.wx_words("+TSRA"), "heavy thunderstorm with rain")
        self.assertEqual(W.wx_words("SHRA"), "rain showers")
        self.assertEqual(W.humidity(9.0, 7.0), 87)
        self.assertAlmostEqual(W.density_altitude(23, 9.0, 1018.7), -836, delta=20)   # cool, high pressure: well below field

    def test_real_shapes(self):
        from cloudwall.gather import weather as W
        m = {"icaoId": "KPDX", "obsTime": 1794890160, "temp": 8.9, "dewp": 6.7, "wdir": 0, "wspd": 0, "visib": "10+",
             "altim": 1018.7, "metarType": "SPECI", "rawOb": "SPECI KPDX ...", "elev": 7, "cover": "BKN", "fltCat": "VFR",
             "clouds": [{"cover": "FEW", "base": 2000}, {"cover": "SCT", "base": 2500}, {"cover": "BKN", "base": 6000}]}
        d = W.decode_metar(m, 23)
        self.assertEqual((d["ceiling"], d["category"], d["altimeter_inhg"], d["visibility"], d["special"]), (6000, "VFR", 30.08, 10, True))
        self.assertEqual([c["oktas"] for c in d["clouds"]], [2, 4, 6])
        t = W.decode_taf({"rawTAF": "TAF", "fcsts": [{"timeFrom": 1, "timeTo": 2, "wdir": "VRB", "wspd": 4, "visib": "6+",
                                                      "clouds": [{"cover": "OVC", "base": 4000}]}]})
        p = t["periods"][0]
        self.assertEqual((p["category"], p["wind"]["variable"], p["visibility"]), ("VFR", True, 6))

    def test_a_passing_group_is_judged_with_what_it_leaves_unsaid(self):
        from cloudwall.gather import weather as W
        # EGLL's, as the service gives it: the TEMPOs name only what differs
        t = W.decode_taf({"fcsts": [
            {"timeFrom": 0, "timeTo": 100, "wdir": 130, "wspd": 10, "visib": "6+", "clouds": [{"cover": "BKN", "base": 800}]},
            {"timeFrom": 10, "timeTo": 50, "fcstChange": "TEMPO", "wdir": 170, "wspd": 16},                # only the wind
            {"timeFrom": 10, "timeTo": 50, "fcstChange": "TEMPO", "probability": 30, "visib": 2.8, "wxString": "DZ"},
            {"timeFrom": 100, "timeTo": 200, "timeBec": 120, "fcstChange": "BECMG", "wdir": 280, "wspd": 5, "visib": "6+",
             "wxString": "NSW", "clouds": [{"cover": "NSC", "base": None}]},
            {"timeFrom": 150, "timeTo": 200, "fcstChange": "PROB", "probability": 30, "visib": 4.35}]})
        self.assertEqual([p["category"] for p in t["periods"]], ["IFR", "IFR", "IFR", "VFR", "MVFR"])
        self.assertEqual((t["periods"][1]["ceiling"], t["periods"][1]["visibility"]), (None, None))     # its own stays its own
        self.assertEqual((t["periods"][3]["becoming_by"], t["periods"][3]["weather"]), (120, ""))

    def test_what_cannot_be_said_is_not_said(self):
        from cloudwall.gather import weather as W
        self.assertIsNone(W.category(None, None))                # no visibility: clear skies alone aren't VFR
        self.assertIsNone(W.category(5000, None))
        self.assertEqual(W.category(400, None), "LIFR")          # but a low ceiling decides by itself
        d = W.decode_metar({"visib": 0.06, "vertVis": 100, "clouds": [{"cover": "OVX", "base": None}]}, 0)
        self.assertEqual((d["ceiling"], d["category"]), (100, "LIFR"))
        self.assertEqual([W.wx_words(w) for w in ("-RADZ", "VCSH", "NSW", "BCFG", "-TSRAGR", "+FC")],
                         ["light rain and drizzle", "nearby showers", "", "patches of fog", "light thunderstorm with rain and hail", "tornado"])
        now = time.time()
        self.assertEqual([W.is_stale(now - 3600, now), W.is_stale(now - 4 * 3600, now), W.is_stale(None, now)], [False, True, True])

    def test_demo(self):
        from cloudwall.gather import weather as W
        short, full = W.demo()
        self.assertEqual(len(full["history"]), 25)
        self.assertTrue(full["taf"]["periods"])
        json.dumps(full)


class TFRTest(unittest.TestCase):
    XML = """<XNOTAM-Update><Group><Add><Not><NotUid><txtLocalName>261121 Parade Portland, OR DHS - UAS Only</txtLocalName></NotUid>
      <dateEffective>2026-11-21T21:00:00</dateEffective><dateExpire>2026-11-22T04:59:00</dateExpire>
      <TfrNot><codeType>99.7</codeType><TFRAreaGroup><aseTFRArea><codeDistVerUpper>HEI</codeDistVerUpper><valDistVerUpper>400</valDistVerUpper>
      <uomDistVerUpper>FT</uomDistVerUpper><codeDistVerLower>HEI</codeDistVerLower><valDistVerLower>0</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>
      </aseTFRArea></TFRAreaGroup></TfrNot><txtDescrUSNS>FULL TEXT</txtDescrUSNS></Not></Add></Group></XNOTAM-Update>"""

    def test_parse_detail(self):
        from cloudwall.gather.tfr import parse_detail
        d = parse_detail(self.XML)
        self.assertEqual(d["name"], "Parade Portland, OR DHS - UAS Only")
        self.assertTrue(d["drones_only"])
        self.assertEqual(d["kind"], "Security")
        self.assertEqual((d["floor"]["text"], d["ceiling"]["text"]), ("the surface", "400 ft above ground"))
        self.assertEqual(d["end"] - d["start"], 7 * 3600 + 59 * 60)

    def test_nearby_only_and_cached(self):
        from cloudwall.gather.tfr import TFRs
        home = {"lat": 45.59, "lon": -122.47}
        square = lambda lat, lon, r: {"type": "Polygon", "coordinates": [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]]}
        shapes = {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "LAST_MODIFICATION_DATETIME": "1"}, "geometry": square(45.59, -122.47, 0.05)},
            {"properties": {"NOTAM_KEY": "6/2222-1-FDC-F", "LAST_MODIFICATION_DATETIME": "1"}, "geometry": square(38.9, -77.0, 0.1)}]}
        texts = []
        lists = []
        t = TFRs(fetch_json=lambda url, timeout: lists.append(url) or shapes, fetch_text=lambda url, timeout: texts.append(url) or self.XML)
        out = t.near(t.fetch(), home, 30, now=1e9)
        self.assertEqual([x["id"] for x in out], ["6/1111"])
        self.assertEqual(out[0]["dist_nm"], 0.0)                     # home is inside it
        t.near(t.fetch(), home, 30, now=1e9)
        self.assertEqual(len(texts), 1)
        # the one list serves every place: another, by Washington, takes its own share of it
        self.assertEqual([x["id"] for x in t.near(shapes["features"], {"lat": 38.9, "lon": -77.0}, 30, now=1e9)], ["6/2222"])
        self.assertEqual(len(lists), 2)

    def test_the_records_the_faa_issues_now(self):
        """A paragraph after the regulation, drone restrictions under 49 U.S.C. 44812 with the
        requesting office's reference before the name, and records named only by their number."""
        from cloudwall.gather.tfr import TFRs, parse_detail
        drones = parse_detail(self.XML.replace("261121 Parade Portland, OR DHS - UAS Only", "2026-44812-CSA-0138 MDW Mag Mile Lights")
                              .replace("99.7", "44812"))
        self.assertEqual((drones["name"], drones["drones_only"]), ("MDW Mag Mile Lights", True))
        fire = self.XML.replace("261121 Parade Portland, OR DHS - UAS Only", "6/1111").replace("99.7", "91.137(a)(1)")
        self.assertEqual((parse_detail(fire)["kind"], parse_detail(fire)["drones_only"]),
                         ("Disaster or hazard area (often a wildfire)", False))
        ring = [[-122.5, 45.5], [-122.4, 45.5], [-122.4, 45.7], [-122.5, 45.7], [-122.5, 45.5]]
        shapes = {"features": [
            {"properties": {"NOTAM_KEY": "6/1111-1-FDC-F", "TITLE": "Camas, WA, Saturday, November 21, 2026 Local"},
             "geometry": {"type": "Polygon", "coordinates": [ring]}},
            {"properties": {"NOTAM_KEY": "6/3333-1-FDC-F"}, "geometry": None}]}       # no shape: left out, not an error
        t = TFRs(fetch_json=lambda url, timeout: shapes, fetch_text=lambda url, timeout: fire)
        near = t.near(t.fetch(), {"lat": 45.59, "lon": -122.47}, 30, now=1e9)
        self.assertEqual([(x["id"], x["name"]) for x in near], [("6/1111", "Camas, WA")])


class ContrailTest(unittest.TestCase):
    def test_schmidt_appleman(self):
        from cloudwall.gather.contrails import level, for_altitude
        self.assertEqual(level(250, -30, 100, 10400)["state"], "none")          # too warm at any humidity
        self.assertEqual(level(250, -55, 20, 10400)["state"], "short")          # cold but dry: forms, fades
        self.assertEqual(level(250, -55, 110, 10400)["state"], "persistent")    # ice-saturated: lingers
        c = {"levels": [level(250, -55, 110, 10400)]}
        self.assertEqual(for_altitude(c, 34000), "persistent")
        self.assertIsNone(for_altitude(c, 12000))

    @unittest.skipUnless(hasattr(time, "tzset"), "needs tzset")
    def test_the_forecast_hours_are_utc(self):
        import os
        from cloudwall.gather import contrails
        hours = {"time": [f"2026-07-15T{h:02d}:00" for h in range(24)]}
        for p in contrails.LEVELS:                                      # each hour a degree colder, to tell them apart
            hours.update({f"temperature_{p}hPa": [-30.0 - h for h in range(24)], f"relative_humidity_{p}hPa": [50] * 24,
                          f"geopotential_height_{p}hPa": [10000] * 24})
        real, tz = contrails.get_json, os.environ.get("TZ")
        contrails.get_json = lambda url, timeout=0: {"hourly": hours}
        os.environ["TZ"] = "America/Los_Angeles"                        # in July its clock is on daylight time
        time.tzset()
        try:
            noon = 1784116800                                           # 2026-07-15 12:00 UTC
            c = contrails.fetch(45.6, -122.5, now=noon + 600)
            self.assertEqual((c["at"], c["levels"][0]["temp_c"]), (noon, -42.0))     # the 12:00 hour, not 13:00's
        finally:
            contrails.get_json = real
            os.environ.pop("TZ", None) if tz is None else os.environ.update(TZ=tz)
            time.tzset()


if __name__ == "__main__":
    unittest.main()
