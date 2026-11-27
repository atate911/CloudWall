"""The radio package (incubating, not yet part of the app): frequencies, plans, config, calls, guesses."""
import array
import io
import math
import socket
import threading
import time
import unittest
import wave

from cloudwall.radio import airband, channels, plan, predict
from cloudwall.radio.channels import Channel, parse_mhz
from cloudwall.radio.listen import listen
from cloudwall.radio.segment import Segmenter, decode

# Made-up frequencies in OurAirports' layout: not any real airport's.
TABLE = """\
"id","airport_ref","airport_ident","type","description","frequency_mhz"
1,1,"KAAA","TWR","TWR",118.7
2,1,"KAAA","GND","GND",121.9
3,1,"KAAA","ATIS","ATIS",128.35
4,1,"KAAA","APP","AAA APP",124.35
5,1,"KAAA","DEP","AAA DEP",118.1
6,1,"KAAA","CLD","CLNC DEL",118.55
7,1,"KAAA","TWR","TWR",118.7
8,2,"KBBB","CTAF","CTAF",122.8
12,2,"KBBB","A/D","AAA APP/DEP",133.0
13,2,"KBBB","APP","AAA APP",124.35
9,2,"KBBB","AWOS","AWOS",135.875
10,3,"KZZZ","TWR","TWR",119.9
11,1,"KAAA","MISC","VOR",113.0
"""


class Frequencies(unittest.TestCase):
    def test_25_khz_and_833_names(self):
        self.assertEqual(parse_mhz("118.7"), 118_700_000)
        self.assertEqual(parse_mhz("123.775"), 123_775_000)
        self.assertEqual(parse_mhz("118.010"), 118_008_333)
        self.assertEqual(parse_mhz("118.015"), 118_016_667)
        self.assertEqual(channels.format_mhz(118_008_333), "118.010")
        self.assertEqual(channels.format_mhz(123_775_000), "123.775")

    def test_off_raster_and_out_of_band(self):
        for bad in ("118.702", "113.0", "137.0"):
            with self.assertRaises(ValueError):
                parse_mhz(bad)

    def test_ourairports(self):
        chans = channels.from_ourairports(TABLE, ["KAAA", "kbbb"])
        self.assertEqual(len(chans), 9)                     # duplicates and the VOR left out
        self.assertEqual(next(c for c in chans if c.mhz == "124.350").airport, "KAAA")   # the first named
        kinds = {c.mhz: c.kind for c in chans}
        self.assertEqual(kinds["118.700"], "tower")
        self.assertEqual(kinds["118.550"], "clearance")
        self.assertEqual(kinds["135.875"], "weather")
        self.assertEqual(kinds["133.000"], "approach")      # OurAirports' A/D is approach/departure
        self.assertNotIn("119.900", kinds)
        self.assertEqual([c.freq for c in chans], sorted(c.freq for c in chans))
        self.assertIn(channels.GUARD, [c.freq for c in channels.with_guard(chans)])


class Plans(unittest.TestCase):
    chans = channels.with_guard(channels.from_ourairports(TABLE, ["KAAA", "KBBB"]))

    def test_one_dongle_takes_the_richest_slice(self):
        p = plan.make_plan(self.chans, [plan.Receiver()])
        s, = p.slices
        self.assertLessEqual(s.hi - s.lo, 2_400_000)
        heard = {c.mhz for c in s.channels}
        self.assertTrue({"118.100", "118.550", "118.700"} <= heard)   # tower, departure, clearance
        self.assertEqual(len(p.heard) + len(p.scan) + len(p.unscanned), len(self.chans))
        self.assertEqual(p.scan[0].kind, "approach")                  # the most worth left, first
        self.assertFalse([c for c in p.scan if c.kind in plan.CONTINUOUS])   # ATIS would hold a scanner
        self.assertTrue(all(c.kind in plan.CONTINUOUS for c in p.unscanned))

    def test_centre_stays_off_every_channel(self):
        for r in (plan.Receiver(), plan.Receiver("airspy-mini"), plan.Receiver("airspy-r2")):
            s = plan.best_slice(self.chans, r)
            self.assertEqual((s.center - 12_500) % 25_000, 0)
            self.assertTrue(all(abs(c.freq - s.center) >= plan.DC_CLEAR for c in self.chans))

    def test_more_receivers_hear_more(self):
        one = plan.make_plan(self.chans, [plan.Receiver()])
        two = plan.make_plan(self.chans, [plan.Receiver(), plan.Receiver(index=1)])
        r2 = plan.make_plan(self.chans, [plan.Receiver("airspy-r2")])
        self.assertGreater(len(two.heard), len(one.heard))
        self.assertGreater(len(r2.heard), len(one.heard))
        self.assertFalse({c.freq for c in two.slices[0].channels} & {c.freq for c in two.slices[1].channels})

    def test_config(self):
        p = plan.make_plan(self.chans, [plan.Receiver()], scanner=plan.Receiver(index=1))
        text = airband.config(p, gain=28.0)
        self.assertIn('mode = "multichannel";', text)
        self.assertIn(f"centerfreq = {p.slices[0].center};", text)
        self.assertIn("dest_port = 6001;", text)
        self.assertIn('mode = "scan";', text)
        self.assertIn("split_on_transmission = true;", text)
        self.assertEqual(text.count("{"), text.count("}"))
        self.assertEqual(text.count("("), text.count(")"))
        self.assertEqual(list(airband.ports(p)), list(range(6001, 6001 + len(p.heard))))
        soapy = airband.config(plan.make_plan(self.chans, [plan.Receiver("airspy-r2")]))
        self.assertIn('device_string = "driver=airspy";', soapy)
        two = airband.config(plan.make_plan(self.chans, [plan.Receiver(serial="00000101"),
                                                         plan.Receiver(index=1, serial="00000102")]))
        self.assertIn('serial = "00000102";', two)
        self.assertNotIn("index =", two)


def tone(n, amp=0.5):
    return array.array("f", (amp * math.sin(i / 3) for i in range(n)))


class Calls(unittest.TestCase):
    def test_gaps_split_calls(self):
        seg = Segmenter(gap_s=1.0, min_s=0.3)
        done = []
        for i in range(10):                                  # one second of audio on "a"
            done += seg.feed("a", 100 + i * 0.1, tone(800))
        done += seg.feed("b", 100.5, tone(80))               # a blip on "b"
        self.assertEqual(done, [])
        done += seg.flush(102)
        self.assertEqual([t.channel for t in done], ["a"])   # the blip was too short to be a call
        self.assertAlmostEqual(done[0].duration, 1.0)
        self.assertAlmostEqual(done[0].level_db, 20 * math.log10(0.5 / math.sqrt(2)), delta=0.5)

    def test_wav(self):
        seg = Segmenter()
        seg.feed("a", 0, tone(4000))
        tx, = seg.flush(10)
        with wave.open(io.BytesIO(tx.wav())) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()),
                             (1, 2, 8000, 4000))

    def test_udp(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        calls, stop = [], threading.Event()
        t = threading.Thread(target=listen, args=({port: "tower"}, calls.append, stop),
                             kwargs={"segmenter": Segmenter(gap_s=0.3)})
        t.start()
        time.sleep(0.2)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as out:
            for _ in range(10):
                out.sendto(tone(400).tobytes(), ("127.0.0.1", port))
        deadline = time.time() + 3
        while not calls and time.time() < deadline:
            time.sleep(0.05)
        stop.set()
        t.join()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].channel, "tower")
        self.assertEqual(len(calls[0].samples), 4000)
        self.assertEqual(list(decode(tone(3).tobytes())), list(tone(3)))


class Guesses(unittest.TestCase):
    airport = {"icao": "KAAA", "lat": 45.0, "lon": -122.0, "elevation_ft": 30}
    chans = channels.from_ourairports(TABLE, ["KAAA", "KBBB"])

    def at(self, nm_north, alt, **kw):
        return {"lat": 45.0 + nm_north / 60, "lon": -122.0, "alt": alt, "on_ground": alt == 0, **kw}

    def test_by_phase(self):
        k = predict.likely_kinds
        self.assertEqual(k(self.at(0.5, 0), self.airport)[0], "ground")
        self.assertEqual(k(self.at(4, 1500, local="arriving"), self.airport)[0], "tower")
        self.assertEqual(k(self.at(20, 8000, local="arriving"), self.airport)[0], "approach")
        self.assertEqual(k(self.at(20, 8000, local="departing"), self.airport)[0], "departure")
        self.assertEqual(k(self.at(20, 35000), self.airport)[0], "center")
        self.assertEqual(k(self.at(5, 2000), self.airport, towered=False)[0], "ctaf")

    def test_channels(self):
        got = predict.likely_channels(self.at(4, 1500, local="arriving"), self.airport, self.chans)
        self.assertEqual([c.mhz for c in got[:2]], ["118.700", "124.350"])


if __name__ == "__main__":
    unittest.main()
