"""A receiver's CloudWall station (sense/station.py, app/station.py): what it reads from a Pi, what
the wall makes of it, and how it is installed, updated, checked and watched. The Pi is a stand-in:
its commands, files and web pages are answered here."""
import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from collections import namedtuple
from pathlib import Path
from unittest import mock

from cloudwall.core import config, health
from cloudwall.operate import doctor, install as inst
from cloudwall.operate.survey import Machine
from cloudwall.operate.system import System
from cloudwall.sense import station

Disk = namedtuple("Disk", "total used free")
NOW = 1_800_000_000.0


class Pi:
    """A Raspberry Pi as the station sees it: a weak supply, hot, its clock adrift, its card nearly
    full, the TV driver loaded, readsb failed with its data two minutes old, FlightAware down."""

    def __init__(self, **over):
        self.cmds = {
            ("vcgencmd", "get_throttled"): "throttled=0x50005\n",
            ("vcgencmd", "measure_temp"): "temp=81.2'C\n",
            ("timedatectl", "show", "-p", "NTPSynchronized", "--value"): "no\n",
            ("lsusb",): "Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\n"
                        "Bus 001 Device 003: ID 0bda:2832 Realtek Semiconductor Corp. RTL2832U DVB-T\n",
        }
        self.units = {"readsb": "failed", "piaware": "active", "adsb-tunnel": "active"}
        self.files = {"/proc/device-tree/model": "Raspberry Pi 4 Model B Rev 1.4\0",
                      "/proc/modules": "dvb_usb_rtl28xxu 28672 0 - Live 0x0\nsnd 1 0 - Live\n",
                      "/proc/uptime": "3600.5 1000.0\n",
                      "/run/piaware/status.json": json.dumps({"adept": {"status": "red", "message": "Not connected to FlightAware"}})}
        self.pages = {"http://127.0.0.1:8080/data/aircraft.json": {"now": NOW - 120, "messages": 5, "aircraft": [{"hex": "a", "lat": 1}, {"hex": "b"}]},
                      "http://127.0.0.1:8080/data/stats.json": {"gain_db": 43.9},
                      "http://127.0.0.1:8754/monitor.json": {"feed_status": "connected", "feed_alias": "KPDX229"}}
        self.free = 5
        self.__dict__.update(over)

    def run(self, cmd):
        if cmd[:2] == ["systemctl", "show"]:
            name = cmd[-1]
            return f"LoadState=loaded\nActiveState={self.units[name]}\n" if name in self.units else "LoadState=not-found\nActiveState=inactive\n"
        return self.cmds.get(tuple(cmd))

    def read(self, path):
        return self.files.get(path)

    def get(self, url, timeout=4):
        return self.pages.get(url)

    def facts(self):
        return station.facts(run=self.run, read=self.read, get=self.get, disk=lambda p: Disk(100, 100 - self.free, self.free),
                             exists=lambda p: p == "/opt/adsb", now=lambda: NOW)


class FactsTest(unittest.TestCase):
    def test_what_a_pi_says_about_itself(self):
        f = Pi().facts()
        self.assertEqual(f["board"], "Raspberry Pi 4 Model B Rev 1.4")
        self.assertEqual((f["image"], f["throttled"], f["temp_c"], f["clock_synced"]), ("adsb.im", 0x50005, 81.2, False))
        self.assertEqual([s["id"] for s in f["sdr"]], ["0bda:2832"])                   # the stick, not the hub
        self.assertTrue(f["dvb_driver"])
        self.assertEqual(f["units"], {"readsb": "failed", "piaware": "active", "adsb-tunnel": "active"})  # only those there
        self.assertEqual((f["decoder"]["aircraft"], f["decoder"]["with_pos"], f["decoder"]["gain_db"]), (2, 1, 43.9))
        self.assertEqual(f["feeders"], {"flightaware": {"connected": False, "detail": "Not connected to FlightAware"},
                                        "flightradar24": {"connected": True, "detail": "connected KPDX229"}})
        self.assertIsNone(f["containers"])                                              # docker not to be asked
        json.dumps(f)                                                                    # it goes over the wire as it is

    def test_what_it_means(self):
        found = {x.code: x for x in station.findings(Pi().facts(), now=NOW)}
        self.assertEqual(found["receiver.undervoltage"].state, health.FAIL)             # under-voltage now
        for code in ("receiver.throttled", "receiver.hot", "receiver.clock", "receiver.disk", "receiver.dvb-driver",
                     "receiver.service-failed", "receiver.decoder-stuck", "receiver.feeder-down"):
            self.assertIn(code, found)
        self.assertTrue(found["receiver.clock"].subtle)                                 # MLAT looks right, isn't
        self.assertIn("FlightAware", found["receiver.feeder-down"].summary)
        oks = [x.summary for x in station.findings(Pi().facts(), now=NOW) if x.state == health.OK]
        self.assertIn("Flightradar24: connected", oks)
        for f in station.findings(Pi().facts(), now=NOW):
            self.assertEqual(f.part, "receiver")

    def test_a_well_receiver_has_nothing_to_say_against_it(self):
        pi = Pi(units={"readsb": "active", "dump1090-fa": "inactive", "adsb-tunnel": "active"}, free=60)
        pi.cmds.update({("vcgencmd", "get_throttled"): "throttled=0x0\n", ("vcgencmd", "measure_temp"): "temp=52.0'C\n",
                        ("timedatectl", "show", "-p", "NTPSynchronized", "--value"): "yes\n"})
        pi.files["/proc/modules"] = "snd 1 0 - Live\n"
        pi.files["/run/piaware/status.json"] = json.dumps({"adept": {"status": "green", "message": "Connected"}})
        pi.pages["http://127.0.0.1:8080/data/aircraft.json"]["now"] = NOW - 1
        bad = [x for x in station.findings(pi.facts(), now=NOW) if x.state != health.OK]
        self.assertEqual(bad, [])                       # dump1090-fa left installed but stopped: no problem

    def test_under_voltage_since_it_started_is_worth_a_look_not_a_failure(self):
        pi = Pi()
        pi.cmds[("vcgencmd", "get_throttled")] = None
        pi.files["/sys/devices/platform/soc/soc:firmware/get_throttled"] = "50000\n"      # the firmware's file, no 0x
        f = pi.facts()
        self.assertEqual(f["throttled"], 0x50000)
        u = next(x for x in station.findings(f, now=NOW) if x.code == "receiver.undervoltage")
        self.assertEqual(u.state, health.WARN)

    def test_a_machine_that_isnt_a_receiver_says_nothing_of_what_it_hasnt(self):
        f = station.facts(run=lambda c: None, read=lambda p: None, get=lambda u: None, disk=lambda p: Disk(100, 50, 50),
                          exists=lambda p: False, now=lambda: NOW)
        self.assertFalse(station.is_receiver(f))
        self.assertEqual([x.summary for x in station.findings(f)], ["SD card 50% used"])

    def test_where_the_wall_finds_the_station(self):
        cfg = config.load(None)
        cfg["source"].update(urls=["http://127.0.0.1:18080/data/aircraft.json"], merge=True)
        self.assertEqual(station.urls(cfg), ("http://127.0.0.1:18080", "http://127.0.0.1:18090", "http://127.0.0.1:18095"))
        cfg["receiver"]["url"] = "http://192.168.3.3:8080"                               # at home: its own ports
        self.assertEqual(station.urls(cfg)[2], "http://192.168.3.3:8095")
        cfg["receiver"]["station_url"] = "http://10.0.0.9:9000/"
        self.assertEqual(station.urls(cfg)[2], "http://10.0.0.9:9000")


class ServerTest(unittest.TestCase):
    def test_it_answers_what_it_knows_and_only_reads(self):
        from cloudwall.app.station import Station, make_server
        asked = []
        srv = make_server("127.0.0.1", 0, Station(gather=lambda: asked.append(1) or {"format": 1, "host": "pi"}))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        for _ in range(2):
            with urllib.request.urlopen(f"{base}/station.json") as r:
                self.assertEqual(json.loads(r.read()), {"format": 1, "host": "pi"})
        self.assertEqual(len(asked), 1)                                                  # gathered once, then kept a while
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(f"{base}/station.json", data=b"{}", method="POST"))
        self.assertEqual(e.exception.code, 405)


class MachineTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.said = []

    def system(self):
        return System(self.root, say=self.said.append)

    def at(self, p):
        return self.root / p.lstrip("/")


class InstallTest(MachineTest):
    def test_a_station_is_set_up_and_needs_no_settings(self):
        s = inst.install(inst.Options("station"), self.system())
        unit = self.at(inst.STATION_UNIT).read_text()
        for line in ("ExecStart=/usr/local/bin/cloudwall station", "User=cloudwall", "SupplementaryGroups=video",
                     "ProtectSystem=strict", "Type=notify", "Restart=always"):
            self.assertIn(line, unit)
        self.assertTrue(self.at("/opt/cloudwall/current/cloudwall/sense/station.py").exists())
        self.assertFalse(self.at(inst.CONFIG).exists())                                  # no wall's settings
        self.assertFalse(self.at(inst.UNIT).exists())
        self.assertIn("run systemctl restart cloudwall-station", s.done)
        self.assertEqual(inst.install(inst.Options("station"), self.system()).done, [])  # again: nothing to change

    def test_taking_it_off_leaves_a_wall_on_the_same_machine(self):
        inst.install(inst.Options("wall"), self.system())
        inst.install(inst.Options("station"), self.system())
        inst.uninstall("station", system=self.system())
        self.assertFalse(self.at(inst.STATION_UNIT).exists())
        self.assertTrue(self.at(inst.BIN).exists() and self.at(inst.UNIT).exists())
        inst.uninstall("wall", system=self.system())
        inst.install(inst.Options("station"), self.system())
        inst.uninstall("station", system=self.system())
        self.assertFalse(self.at(inst.BIN).exists() or self.at("/opt/cloudwall").exists())   # alone: all of it goes

    def test_upgrade_on_a_receiver_updates_its_station_and_sets_up_no_wall(self):
        from cloudwall.operate.upgrade import upgrade
        inst.install(inst.Options("station"), self.system())
        upgrade(self.system(), say=self.said.append)
        self.assertIn("Found: this receiver's CloudWall station", self.said)
        self.assertFalse(self.at(inst.UNIT).exists() or self.at(inst.CONFIG).exists())

    def test_doctor_on_a_receiver_checks_the_receiver_not_a_walls_settings(self):
        inst.install(inst.Options("station"), self.system())
        found, _ = doctor.doctor(machine=Machine(self.root))
        self.assertIn("the CloudWall station is running (it reports this receiver to the wall)", [f.summary for f in found])
        self.assertFalse([f for f in found if f.part in ("settings", "feeds")])


class WallTest(unittest.TestCase):
    """The wall's side: the board's Receiver page, and the health watcher."""

    def cfg(self):
        cfg = config.load(None)
        cfg["receiver"]["station_url"] = "http://127.0.0.1:18095"
        return cfg

    def test_the_board_shows_what_the_station_says_and_what_it_means(self):
        from cloudwall.app.admin import Admin
        admin = Admin(self.cfg(), [])
        with mock.patch("cloudwall.core.http.get_json", lambda url, timeout=8: Pi().facts()):
            got = admin.station()
        self.assertEqual(got["station"]["host"], Pi().facts()["host"])
        self.assertIn("receiver.feeder-down", [f["code"] for f in got["station_findings"]])

    def test_the_watcher_raises_its_problems_and_a_station_that_stops(self):
        from cloudwall.app.watch import STATION_S, Watch
        clock = [NOW]
        w = Watch(self.cfg(), [], clock=lambda: clock[0])
        with mock.patch("cloudwall.core.http.get_json", lambda url, timeout=8: {"format": 1, "host": "pi", "throttled": 0x10000, "checked": NOW}):
            codes = [f.code for f in w.station()]
        self.assertEqual(codes, ["receiver.undervoltage"])                               # only what's wrong
        clock[0] += STATION_S

        def down(url, timeout=8):
            raise OSError("connection refused")
        with mock.patch("cloudwall.core.http.get_json", down):
            self.assertEqual([f.code for f in w.station()], ["receiver.station-down"])
        fresh = Watch(self.cfg(), [], clock=lambda: clock[0])
        with mock.patch("cloudwall.core.http.get_json", down):
            self.assertEqual(fresh.station(), [])                                       # never set up: nothing to say


if __name__ == "__main__":
    unittest.main()
