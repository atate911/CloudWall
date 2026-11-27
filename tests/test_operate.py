"""Setting CloudWall up and looking after it (cloudwall/operate/): each command run against a folder
standing in for a machine, so nothing here touches this one."""
import os
import shutil
import socket
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path

from cloudwall.core import config, health, paths
from cloudwall.memory.store import Store
from cloudwall.operate import backup, cli, doctor, install as inst, legacy
from cloudwall.operate.system import System


def mode(p):
    return stat.S_IMODE(os.lstat(p).st_mode)


class MachineTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.said = []

    def system(self, dry_run=False):
        return System(self.root, dry_run, say=self.said.append)

    def at(self, p):
        return self.root / p.lstrip("/")


class InstallTest(MachineTest):
    def test_a_wall_is_set_up_with_everything_in_its_place(self):
        s = inst.install(inst.Options("wall"), self.system())
        self.assertTrue(self.at("/opt/cloudwall/current/cloudwall/__init__.py").exists())
        self.assertTrue(os.readlink(self.at("/opt/cloudwall/current")).startswith("releases/"))
        self.assertEqual(self.at(inst.CONFIG).read_text(), paths.EXAMPLE.read_text())
        self.assertEqual(mode(self.at(inst.CONFIG)), 0o640)                  # it will hold keys
        self.assertEqual(mode(self.at(inst.VAR)), 0o750)
        unit = self.at(inst.UNIT).read_text()
        for line in ("User=cloudwall", "ExecStart=/usr/bin/python3 -m cloudwall", "Restart=always",
                     "ProtectSystem=strict", "Environment=CLOUDWALL_DATA=/var/lib/cloudwall"):
            self.assertIn(line, unit)
        self.assertIn("cloudwall:", self.at("/etc/passwd").read_text())
        self.assertIn("exec /usr/bin/python3 -m cloudwall", self.at(inst.BIN).read_text())
        self.assertIn("run systemctl restart cloudwall", s.done)

    def test_installing_again_changes_nothing(self):
        inst.install(inst.Options("wall"), self.system())
        again = inst.install(inst.Options("wall"), self.system())
        self.assertEqual(again.done, [])

    def test_settings_already_there_are_never_overwritten(self):
        inst.install(inst.Options("wall"), self.system())
        self.at(inst.CONFIG).write_text('[home]\nlat = 44.0\nlon = -121.3\n')
        inst.install(inst.Options("wall"), self.system())
        self.assertIn("44.0", self.at(inst.CONFIG).read_text())

    def test_new_code_is_a_new_release_and_old_ones_are_cleared(self):
        src = self.root / "src" / "cloudwall"
        shutil.copytree(paths.PACKAGE, src, ignore=shutil.ignore_patterns("__pycache__"))
        for n in range(5):
            (src / "edition.py").write_text(f"N = {n}\n")
            s = inst.install(inst.Options("wall", source=src), self.system())
            self.assertIn("run systemctl restart cloudwall", s.done)
            os.utime(self.at("/opt/cloudwall/current").resolve(), (1e9 + n, 1e9 + n))      # each newer than the last
        releases = list(self.at("/opt/cloudwall/releases").iterdir())
        self.assertEqual(len(releases), inst.KEEP_RELEASES)
        current = Path(os.readlink(self.at("/opt/cloudwall/current"))).name
        self.assertIn(current, [r.name for r in releases])
        self.assertIn("N = 4", (self.at("/opt/cloudwall/current") / "cloudwall/edition.py").read_text())

    def test_an_update_doesnt_restart_into_settings_that_wont_start(self):
        src = self.root / "src" / "cloudwall"
        shutil.copytree(paths.PACKAGE, src, ignore=shutil.ignore_patterns("__pycache__"))
        inst.install(inst.Options("wall", source=src), self.system())
        self.at(inst.CONFIG).write_text('[tracking]\nradius_nm = "far"\n')     # broken since it last started
        (src / "edition.py").write_text("N = 2\n")
        system = self.system()
        with self.assertRaises(SystemExit) as e:
            inst.install(inst.Options("wall", source=src), system)
        self.assertIn("radius_nm", str(e.exception))
        self.assertIn("carries on", str(e.exception))
        self.assertNotIn("run systemctl restart cloudwall", system.done)

    def test_a_dry_run_changes_nothing(self):
        s = inst.install(inst.Options("wall"), self.system(dry_run=True))
        self.assertTrue(s.done)
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertTrue(all(line.startswith("would ") for line in self.said))

    def test_on_the_internet_through_caddy(self):
        self.at(inst.CADDYFILE).parent.mkdir(parents=True)
        self.at(inst.CADDYFILE).write_text("other.example.com {\n\trespond hello\n}\n")
        inst.install(inst.Options("wall", public="sky.example.com"), self.system())
        caddyfile = self.at(inst.CADDYFILE).read_text()
        self.assertIn("other.example.com", caddyfile)                       # the owner's own sites are kept
        self.assertEqual(caddyfile.count(f"import {inst.CADDY_SITE}"), 1)
        self.assertIn("reverse_proxy 127.0.0.1:5050", self.at(inst.CADDY_SITE).read_text())
        self.assertTrue(self.at(inst.CADDYFILE + ".before-cloudwall").exists())
        cfg = config.load(self.at(inst.CONFIG))
        self.assertEqual((cfg["server"]["host"], cfg["server"]["address"]), ("127.0.0.1", "sky.example.com"))
        self.assertTrue(cfg["server"]["key"])                               # private, until there is a sign-in
        inst.install(inst.Options("wall", public="sky.example.com"), self.system())
        self.assertEqual(self.at(inst.CADDYFILE).read_text().count("import"), 1)     # not imported twice
        inst.uninstall("wall", system=self.system())
        self.assertNotIn("import", self.at(inst.CADDYFILE).read_text())
        self.assertFalse(self.at(inst.CADDY_SITE).exists())

    def test_uninstall_keeps_settings_and_logbooks_unless_purged(self):
        inst.install(inst.Options("wall"), self.system())
        inst.uninstall("wall", system=self.system())
        self.assertFalse(self.at(inst.UNIT).exists() or self.at(inst.OPT).exists() or self.at(inst.BIN).exists())
        self.assertTrue(self.at(inst.CONFIG).exists() and self.at(inst.VAR).exists())
        inst.uninstall("wall", purge=True, system=self.system())
        self.assertFalse(self.at(inst.ETC).exists() or self.at(inst.VAR).exists())

    def test_a_panel_opens_the_wall_at_login(self):
        inst.install(inst.Options("panel", wall_url="http://wall.local:5050/k/tafo-kemi-luza-nobe/",
                                  desktop_user="pi"), self.system())
        self.assertIn("CLOUDWALL_URL='http://wall.local:5050/k/tafo-kemi-luza-nobe'", self.at(inst.PANEL_CONF).read_text())
        self.assertEqual(mode(self.at(inst.PANEL_CONF)), 0o640)              # the key isn't everyone's
        autostart = self.at("/home/pi/.config/labwc/autostart")
        self.assertIn(inst.KIOSK_BIN, autostart.read_text())
        inst.install(inst.Options("panel", wall_url="http://wall.local:5050/k/tafo-kemi-luza-nobe/",
                                  desktop_user="pi"), self.system())
        self.assertEqual(autostart.read_text().count(inst.KIOSK_BIN), 1)
        inst.uninstall("panel", desktop_user="pi", system=self.system())
        self.assertNotIn(inst.KIOSK_BIN, autostart.read_text())

    def test_a_panel_on_the_walls_own_machine_finds_its_key(self):
        inst.install(inst.Options("wall"), self.system())
        config.write_setting(self.at(inst.CONFIG), "server", "key", "tafo-kemi-luza-nobe")
        inst.install(inst.Options("panel", desktop_user="pi"), self.system())
        self.assertIn("localhost:5050/k/tafo-kemi-luza-nobe", self.at(inst.PANEL_CONF).read_text())


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg = self.dir / "config.toml"
        self.db = self.dir / "data" / "cloudwall.db"
        self.cfg.write_text(f'[home]\nlat = 45.6\nlon = -122.5\n[storage]\ndb_path = "{self.db}"\n')
        self.db.parent.mkdir()
        s = Store(str(self.db))
        s.add_sighting(ts=1.0, day="2026-11-27", hex="a1", callsign="ASA1")
        s.close()
        (self.db.parent / "places.json").write_text("[]")

    def test_a_backup_comes_back_whole(self):
        out = backup.backup(self.cfg, self.dir / "b.tar.gz", say=lambda *a: None)
        self.assertEqual(mode(out), 0o600)
        names = {f["name"] for f in backup.read_manifest(out)["files"]}
        self.assertEqual(names, {"config/config.toml", "data/cloudwall.db", "data/places.json"})
        self.db.unlink()
        self.cfg.write_text(self.cfg.read_text() + "# changed\n")
        self.assertEqual(backup.restore(out, self.cfg, yes=False, say=lambda *a: None), [])    # only says, without --yes
        self.assertFalse(self.db.exists())
        backup.restore(out, self.cfg, yes=True, say=lambda *a: None)
        self.assertNotIn("# changed", self.cfg.read_text())
        self.assertEqual(Store(str(self.db)).count("1"), 1)

    def test_backups_in_the_default_folder_are_kept_to_a_few(self):
        folder = backup.default_folder(config.load(self.cfg))
        folder.mkdir()
        for i in range(backup.KEEP + 3):
            (folder / f"cloudwall-old-2026010{i:02d}.tar.gz").write_bytes(b"")
        backup.backup(self.cfg, say=lambda *a: None)
        self.assertEqual(len(list(folder.glob("cloudwall-*.tar.gz"))), backup.KEEP)


class LegacyTest(MachineTest):
    def test_an_old_make_service_setup_moves_in(self):
        home = self.root / "home" / "pi"
        old = home / ".local/share/cloudwall"
        old.mkdir(parents=True)
        (home / ".config/cloudwall").mkdir(parents=True)
        (home / ".config/cloudwall/config.toml").write_text('[home]\nlat = 44.06\nlon = -121.31\n')
        s = Store(str(old / "cloudwall.db"))
        s.add_sighting(ts=1.0, day="2026-11-27", hex="a1", callsign="ASA1")
        s.close()
        (old / "tiles" / "x").mkdir(parents=True)
        (home / ".config/systemd/user").mkdir(parents=True)
        (home / ".config/systemd/user/cloudwall.service").write_text("[Service]\n")
        inst.install(inst.Options("wall"), self.system())
        system = self.system()
        legacy.migrate(system, home, "pi", self.root / "checkout", say=self.said.append)
        self.assertIn("44.06", self.at(inst.CONFIG).read_text())
        con = sqlite3.connect(self.at(f"{inst.VAR}/cloudwall.db"))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sightings").fetchone()[0], 1)
        con.close()
        self.assertTrue(self.at(f"{inst.CACHE}/tiles/x").is_dir())
        self.assertTrue(any("systemctl --user disable --now cloudwall" in d for d in system.done))
        self.assertTrue((home / ".config/cloudwall/config.toml").exists())    # the old files are left


class DoctorTest(unittest.TestCase):
    def test_a_broken_settings_file_is_named_and_the_rest_still_checked(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            p.write_text('[tracking]\nradius_nm = "far"\n')
            found, worst = doctor.doctor(p, offline=True)
        self.assertEqual(worst, health.FAIL)
        [bad] = [f for f in found if f.part == "settings"]
        self.assertIn("radius_nm", bad.summary)
        self.assertTrue(bad.detail and bad.fix)                             # says what it means and what to do
        self.assertTrue(any(f.part == "storage" for f in found))

    def test_a_check_that_breaks_is_a_finding_not_a_crash(self):
        def broken(ctx):
            raise RuntimeError("oops")
        found = health.run(None, [("radio", broken)])
        self.assertEqual((found[0].part, found[0].state), ("radio", health.FAIL))

    def test_every_warning_says_what_to_do(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            p.write_text("")
            found, _ = doctor.doctor(p, offline=True)
        for f in found:
            if f.state in (health.WARN, health.FAIL):
                self.assertTrue(f.detail and f.fix, f)


class ReportTest(unittest.TestCase):
    def test_keys_and_positions_are_masked(self):
        text = cli.mask('[home]\nlat = 45.636284\nlon = -122.677496\n[server]\nkey = "tafo-kemi-luza-nobe"\n'
                        '[flightradar24]\napi_key = "abc123"\n[map]\nurl = "https://x/?key=K"\n')
        for secret in ("tafo", "abc123", "key=K", "636284", "677496"):
            self.assertNotIn(secret, text)
        self.assertIn("lat = 45.63", text)


if __name__ == "__main__":
    unittest.main()


class SurveyTest(MachineTest):
    """Machines as they might really be: set up one way or another, or several, half-working."""

    def write(self, p, text, mode=0o644):
        path = self.at(p)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        os.chmod(path, mode)

    def todays_vps(self, linger=False):
        """As the VPS was set up before `cloudwall install`: `make service` from a checkout in the
        user's home, its settings in the checkout (readable by all, holding the key), and the
        tunnel's server end with no keepalive."""
        self.write("/etc/passwd", "root:x:0:0::/root:/bin/bash\nubuntu:x:1000:1000::/home/ubuntu:/bin/bash\n"
                                  "adsbtunnel:x:998:998::/var/lib/adsbtunnel:/usr/sbin/nologin\n")
        self.write("/home/ubuntu/.config/systemd/user/cloudwall.service",
                   "[Service]\nWorkingDirectory=/home/ubuntu/CloudWall\nExecStart=/home/ubuntu/CloudWall/.venv/bin/cloudwall\n")
        self.write("/home/ubuntu/.config/systemd/user/default.target.wants/cloudwall.service", "")
        self.write("/home/ubuntu/CloudWall/config.toml", '[server]\nkey = "tafo-kemi-luza-nobe"\n')
        self.write("/var/lib/adsbtunnel/.ssh/authorized_keys",
                   'restrict,port-forwarding,permitlisten="127.0.0.1:18080",permitopen="127.0.0.1:9" ssh-ed25519 AAAA pi\n')
        self.write("/etc/ssh/sshd_config", "PasswordAuthentication no\n")
        if linger:
            self.write("/var/lib/systemd/linger/ubuntu", "")

    def journal(self, cmd):
        import subprocess
        if cmd[0] == "journalctl":
            return subprocess.CompletedProcess(cmd, 0, "CloudWall 0.1.0 on http://0.0.0.0:5050\n"
                                               "private: answering only under /k/tafo-kemi-luza-nobe/ (the wall panel at ...)\n", "")
        return None

    def survey(self, ask=None):
        from cloudwall.operate.survey import Machine, survey
        found = survey(Machine(self.root, ask=ask or (lambda cmd: None)))
        return found, {f.code for f in found if f.code}

    def test_todays_vps_is_seen_for_what_it_is(self):
        self.todays_vps()
        found, codes = self.survey(self.journal)
        for code in ("service.legacy", "service.no-linger", "settings.readable", "tunnel.no-keepalive", "access.key-in-log"):
            self.assertIn(code, codes)
        self.assertNotIn("tunnel.unrestricted", codes)                   # its key kept its restrictions
        [linger] = [f for f in found if f.code == "service.no-linger"]
        self.assertIn("sudo loginctl enable-linger ubuntu", linger.steps[0])   # the steps name the user

    def test_doctor_fix_repairs_what_is_safe_and_leaves_the_rest(self):
        from cloudwall.operate import repair
        from cloudwall.operate.survey import Machine
        self.todays_vps()
        found, _ = self.survey()
        done = dict(repair.fix(found, self.system(), Machine(self.root, ask=lambda cmd: None), say=lambda *a: None))
        self.assertEqual(mode(self.at("/home/ubuntu/CloudWall/config.toml")), 0o640)
        self.assertIn("Match User adsbtunnel", self.at(repair.TUNNEL_KEEPALIVE).read_text())
        self.assertIn("ubuntu", done["enable-linger"])
        _, codes = self.survey()
        self.assertFalse({"settings.readable", "tunnel.no-keepalive"} & codes)
        self.assertIn("service.legacy", codes)                          # moving it is the owner's call

    def test_two_cloudwalls_set_up_to_start(self):
        self.todays_vps(linger=True)
        inst.install(inst.Options("wall"), self.system())
        _, codes = self.survey(lambda cmd: __import__("subprocess").CompletedProcess(cmd, 0, "enabled\n", "")
                               if cmd[:2] == ["systemctl", "is-enabled"] else None)
        self.assertIn("service.duplicate", codes)
        self.assertNotIn("service.no-linger", codes)

    def test_a_tunnel_key_that_lost_its_restrictions(self):
        self.todays_vps()
        self.write("/var/lib/adsbtunnel/.ssh/authorized_keys", "ssh-ed25519 AAAA pi\n")
        _, codes = self.survey()
        self.assertIn("tunnel.unrestricted", codes)

    def test_caddy_with_its_password_commented_out(self):
        self.write("/etc/caddy/Caddyfile", "sky.example.com {\n\t# basic_auth {\n\t#   me hash\n\t# }\n\treverse_proxy localhost:5050\n}\n")
        _, codes = self.survey()
        self.assertIn("caddy.auth-removed", codes)

    def test_the_receivers_extras(self):
        self.write("/etc/systemd/system/coverage3d.service", "[Service]\n")
        _, codes = self.survey(lambda cmd: __import__("subprocess").CompletedProcess(cmd, 0, "1234 python3 sharing_guide.py\n", "")
                               if cmd[0] == "pgrep" else None)
        self.assertTrue({"coverage3d.separate", "sharing.root-page"} <= codes)

    def test_a_machine_with_nothing_set_up(self):
        found, codes = self.survey()
        self.assertEqual(codes, set())
        self.assertTrue(any(f.part == "install" and f.state == "off" for f in found))


class UpgradeTest(unittest.TestCase):
    """A CloudWall that ran must go on running after an update, whatever its settings say."""

    def test_settings_the_old_version_took_still_start(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            p.write_text('[flightradar24]\nmode = "Always"\n[map]\nstyle = "Dark"\n[kiosk]\nview = "radr"\n')
            with self.assertLogs("cloudwall", "WARNING"):
                cfg = config.load(p)
        self.assertEqual((cfg["flightradar24"]["mode"], cfg["map"]["style"], cfg["kiosk"]["view"]), ("always", "dark", "card"))
        self.assertEqual(len(cfg["_problems"]), 1)                       # the one it couldn't use is said

    def test_a_broken_file_falls_back_to_the_last_that_started(self):
        from cloudwall.app import main as M
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "config.toml")
            p.write_text("[tracking]\nradius_nm = 20\n")
            M.keep_good(str(p))
            p.write_text('[tracking]\nradius_nm = "far"\n')                 # an edit gone wrong
            with self.assertLogs("cloudwall", "ERROR"):
                cfg, fallback = M.load_settings(str(p))
            self.assertTrue(fallback)
            self.assertEqual(cfg["tracking"]["radius_nm"], 20)
            self.assertIn("can't be used", cfg["_problems"][0])
            Path(f"{p}.good").unlink()
            with self.assertRaises(SystemExit):                          # nothing to fall back on: stops, naming it
                M.load_settings(str(p))


class GuideTest(unittest.TestCase):
    """`cloudwall doctor --fix` with the owner: explain, offer, ask, walk through, check again."""

    class Script:
        def __init__(self, *replies):
            self.replies, self.said = list(replies), []

        def say(self, text=""):
            self.said.append(text)

        def ask(self, question, secret=False):
            self.said.append(question)
            return self.replies.pop(0)

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg = self.dir / "config.toml"
        self.cfg.write_text("[home]\nlat = 45.59\nlon = -122.474\n")      # the placeholder
        os.chmod(self.cfg, 0o600)
        self.ctx = doctor.Context(self.cfg, offline=True)

    def walk(self, findings, io, recheck=lambda: []):
        from cloudwall.operate import guide
        from cloudwall.operate.survey import Machine
        return guide.walk(findings, io, self.ctx, System(self.dir / "root", say=lambda *a: None),
                          Machine(self.dir / "root", ask=lambda c: None), recheck)

    def test_the_house_is_asked_for_checked_and_written(self):
        io = self.Script("somewhere", "97702")
        out = self.walk([health.trouble("settings.placeholder")], io)
        self.assertTrue(any("isn't a US ZIP code" in s for s in io.said))   # a wrong answer is said, and asked again
        cfg = config.load(self.cfg)
        self.assertAlmostEqual(cfg["home"]["lat"], 44.0, delta=0.3)          # Bend, Oregon
        self.assertIn("[home] set to", out[0][1])

    def test_a_problem_only_the_owner_can_fix_is_walked_through_and_checked(self):
        io = self.Script("", "c")
        down = health.trouble("feeds.receiver-down", "your receiver didn't answer")
        out = self.walk([down], io, recheck=lambda: [])
        self.assertEqual(out, [("feeds.receiver-down", "fixed")])
        self.assertTrue(any(s.startswith("   1. ") for s in io.said) and any("it's gone" in s for s in io.said))

    def test_a_repair_is_offered_and_made(self):
        f = health.trouble("storage.low", "0.8 GB free")
        io = self.Script("y")
        out = self.walk([f], io)
        self.assertIn("CloudWall can trim the map tile cache", " ".join(io.said))
        self.assertTrue(out[0][1])

    def test_q_stops(self):
        io = self.Script("q")
        out = self.walk([health.trouble("settings.placeholder"), health.trouble("backup.none")], io)
        self.assertEqual(out, [])

    def test_a_new_port_must_be_free(self):
        from cloudwall.operate import guide
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            taken = s.getsockname()[1]
            with self.assertRaises(guide.Answered):
                guide.answer("server.port-taken", "port", str(taken), self.ctx)
        with self.assertRaises(guide.Answered):
            guide.answer("server.port-taken", "port", "80", self.ctx)


class UpgradeInPlaceTest(MachineTest):
    """`cloudwall upgrade` from each starting point, and `cloudwall rollback`."""

    def test_from_the_old_per_user_setup(self):
        home = self.root / "home" / "pi"
        (home / ".config/systemd/user/default.target.wants").mkdir(parents=True)
        (home / ".config/systemd/user/cloudwall.service").write_text("[Service]\nWorkingDirectory=/home/pi/CloudWall\n")
        (home / ".config/systemd/user/default.target.wants/cloudwall.service").write_text("")
        (home / "CloudWall").mkdir()
        (home / "CloudWall/config.toml").write_text('[home]\nlat = 44.06\nlon = -121.31\n')
        old = home / ".local/share/cloudwall"
        old.mkdir(parents=True)
        s = Store(str(old / "cloudwall.db"))
        s.add_sighting(ts=1.0, day="2026-11-27", hex="a1", callsign="ASA1")
        s.close()
        self.at("/etc/passwd").parent.mkdir(parents=True, exist_ok=True)
        self.at("/etc/passwd").write_text("pi:x:1000:1000::/home/pi:/bin/bash\n")
        from cloudwall.operate.upgrade import upgrade
        upgrade(self.system(), say=self.said.append)
        self.assertTrue(any("Backed up first" in s for s in self.said))
        self.assertTrue(list((old / "backups").glob("cloudwall-*.tar.gz")))      # the old setup's, before anything changed
        self.assertIn("44.06", self.at(inst.CONFIG).read_text())                    # its settings moved over
        con = sqlite3.connect(self.at(f"{inst.VAR}/cloudwall.db"))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sightings").fetchone()[0], 1)
        con.close()

    def test_again_and_back(self):
        src = self.root / "src" / "cloudwall"
        shutil.copytree(paths.PACKAGE, src, ignore=shutil.ignore_patterns("__pycache__"))
        inst.install(inst.Options("wall", source=src), self.system())
        first = os.readlink(self.at("/opt/cloudwall/current"))
        (src / "edition.py").write_text("N = 2\n")
        inst.install(inst.Options("wall", source=src), self.system())
        second = os.readlink(self.at("/opt/cloudwall/current"))
        self.assertNotEqual(first, second)
        self.assertEqual(inst.rollback(self.system()), first)
        self.assertEqual(os.readlink(self.at("/opt/cloudwall/current")), first)
        self.assertEqual(inst.rollback(self.system()), second)                      # and forward again
