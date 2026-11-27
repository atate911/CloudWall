"""`cloudwall station`: a machine with antennas (a Raspberry Pi with an ADS-B stick, VHF sticks, or
both), part of CloudWall. It says how the machine is (sense/station.py: power, temperature, clock,
SD card, the sticks, the decoder, the feeders, the tunnel, the radio's programs), and takes its
settings from the wall, so every receiver is managed from the one control board.

Joining: the board's Stations page makes a code; on the station,
`sudo cloudwall station join https://<the wall> <code>` signs it up and keeps its key in
/etc/cloudwall/station.toml. From then on the service reports to the wall every REPORT_S over
HTTPS (it asks; nothing on the wall reaches in, so it works from behind a home router), and each
answer brings the settings held there for it: its name, what each stick is for (ADS-B, the VHF
radio, or spare), the radio's channels and how to listen. What it can do with them, it does, and
says so in its next report: for the radio (not active yet), it writes RTLSDR-Airband's config for
the sticks given to it (radio/airband.py), ready for when it is.

It also answers GET /station.json on 127.0.0.1:8095, for `--check` and for a wall that reaches it
through the feed tunnel instead (pi-tunnel.sh --station). It never changes the system; it says
nothing secret. Installed by `sudo cloudwall install --role station` as cloudwall-station.service.

  cloudwall station --check                    how this receiver is, at a terminal (exit 2: failed)
  cloudwall station --json                     what it reports
  sudo cloudwall station join <wall> <code>    join a wall (--name to name it)
  sudo cloudwall station leave                 stop reporting to it
"""
import argparse
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .. import __version__
from ..core import health
from ..core.http import post_json
from ..sense import station as sensed
from .watch import sd_notify

log = logging.getLogger("cloudwall.station")
CACHE_S = 15            # the facts are gathered at most this often, however often they're asked for
REPORT_S = 60           # a joined station reports this often
CONF = Path(os.environ.get("CLOUDWALL_STATION", "/etc/cloudwall/station.toml"))
STATE = Path(os.environ.get("CLOUDWALL_DATA", "/var/lib/cloudwall")) / "station"


# -- joining a wall -----------------------------------------------------------------------------------

def read_conf(path=None):
    """{"wall", "id", "key", "name"} from station.toml, or None when this station hasn't joined."""
    import tomllib
    path = Path(path or CONF)
    try:
        got = tomllib.loads(path.read_text()).get("station") or {}
    except (OSError, ValueError):
        return None
    return got if got.get("wall") and got.get("id") and got.get("key") else None


def write_conf(conf, path=None):
    path = Path(path or CONF)
    text = ("# Written by `cloudwall station join`: this station's place on its wall. The key is its\n"
            "# password there: keep this file private (`sudo cloudwall station leave` takes it away).\n[station]\n"
            + "".join(f'{k} = "{str(conf[k]).replace(chr(34), "")}"\n' for k in ("wall", "id", "key", "name") if conf.get(k)))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    if os.geteuid() == 0:                   # the service reads it as the cloudwall group
        try:
            import grp
            os.chown(tmp, 0, grp.getgrnam("cloudwall").gr_gid)
        except KeyError:
            pass
    os.replace(tmp, path)


def join(wall, code, name=None, post=post_json, conf_path=None):
    """Join `wall` (its address, with its private link's /k/<key> if it has one) with a code from its
    control board. Returns the station's name there."""
    wall = wall.rstrip("/")
    if not wall.startswith(("http://", "https://")):
        raise SystemExit("cloudwall station join: give the wall's address as the control board shows it (https://…)")
    try:
        got = json.loads(post(f"{wall}/api/stations/join", {"code": code.strip(), "name": name or socket.gethostname(),
                                                             "host": socket.gethostname()}, timeout=20))
    except Exception as e:
        msg = getattr(e, "read", lambda: b"")()
        try:
            msg = json.loads(msg).get("error") or e
        except ValueError:
            msg = e
        raise SystemExit(f"cloudwall station join: the wall didn't take it: {msg}") from None
    write_conf({"wall": wall, "id": got["id"], "key": got["key"], "name": got.get("name")}, conf_path)
    return got.get("name")


# -- reporting, and taking the settings -----------------------------------------------------------------

def apply(desired, facts, state=None):
    """What this station does with its settings from the wall, said back in its next report. Only
    what's safe and in its own folder: the radio's config, written for the sticks given to it."""
    state = Path(state or STATE)
    jobs = desired.get("jobs") or {}
    # each stick as the wall names it: by its serial number, or by its USB id when it has none
    sticks = [s.get("serial") or s.get("id") for s in (facts or {}).get("sdr") or []]
    applied = {"name": desired.get("name"), "jobs": {k: v for k, v in jobs.items() if k in sticks}}
    radio = desired.get("radio") or {}
    vhf = [(i, key) for i, key in enumerate(sticks) if key and jobs.get(key) == "vhf"]
    if not vhf:
        applied["radio"] = {"state": "none of this station's sticks is given to the radio"}
    elif not radio.get("channels"):
        applied["radio"] = {"state": "the radio has no channels set"}
    else:
        from ..radio import airband, channels as ch, plan as rp
        chans = [ch.Channel(int(hz), str(name), str(kind)) for hz, name, kind in radio["channels"]]
        # a stick with a serial number is named by it; one without, by where USB finds it
        serials = {s.get("serial") for s in facts.get("sdr") or [] if s.get("serial")}
        receivers = [rp.Receiver("rtlsdr", i, serial=key if key in serials else "") for i, key in vhf]
        scanner = None
        if radio.get("mode") == "scan":
            scanner, receivers = receivers[-1], receivers[:-1]
        p = rp.make_plan(chans, receivers, scanner)
        text = airband.config(p, spool=str(state / "radio"))
        path = state / "rtl_airband.conf"
        try:
            state.mkdir(parents=True, exist_ok=True)
            if not path.exists() or path.read_text() != text:
                path.write_text(text)
            applied["radio"] = {"state": "ready; the radio isn't run by this version yet" if radio.get("enabled") else "ready, and off",
                                "config": str(path), "heard": len(p.heard), "scanned": len(p.scan)}
        except OSError as e:
            applied["radio"] = {"state": f"couldn't write its config: {e}"}
    return applied


class Reporter:
    """Reports to the wall every REPORT_S, and takes the settings each answer brings."""

    def __init__(self, conf, station, post=post_json, state=None):
        self.conf, self.station, self.post, self.state = conf, station, post, Path(state or STATE)
        self.applied, self.last_error = None, None
        self.stopped = threading.Event()

    def report_once(self):
        facts = self.station.facts()
        got = json.loads(self.post(f"{self.conf['wall']}/api/stations/{self.conf['id']}/report",
                                   {"facts": facts, "applied": self.applied}, timeout=20,
                                   headers={"Authorization": f"Bearer {self.conf['key']}"}, limit=1 << 20))
        desired = got.get("desired") or {}
        try:
            self.state.mkdir(parents=True, exist_ok=True)
            (self.state / "desired.json").write_text(json.dumps(desired, indent=1))
        except OSError:
            pass
        self.applied = apply(desired, facts, self.state)
        if self.last_error:
            log.info("reporting to %s again", self.conf["wall"])
        self.last_error = None
        return desired

    def run(self):
        while True:
            try:
                self.report_once()
            except Exception as e:              # the wall away, or this station taken off it: said once, tried again
                said = str(getattr(e, "code", "") or e)
                if said != self.last_error:
                    log.warning("couldn't report to %s: %s", self.conf["wall"], e)
                self.last_error = said
            if self.stopped.wait(REPORT_S):
                return

    def start(self):
        threading.Thread(target=self.run, daemon=True, name="report").start()


class Station:
    def __init__(self, gather=sensed.facts):
        self.gather = gather
        self.lock = threading.Lock()
        self.cached = (0, None)

    def facts(self):
        with self.lock:
            at, f = self.cached
            if f is None or time.time() - at > CACHE_S:
                f = self.gather()
                self.cached = (time.time(), f)
            return f


def make_server(host, port, station):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"CloudWallStation/{__version__}"

        def log_message(self, fmt, *args):
            log.debug("%s " + fmt, self.client_address[0], *args)

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/station.json":
                try:
                    return self._send(200, station.facts())
                except Exception as e:                 # a fact that failed in itself: said, not a crash
                    log.exception("gathering the receiver's state failed")
                    return self._send(500, {"error": str(e)})
            if path == "/healthz":
                return self._send(200, {"ok": True, "cloudwall": __version__})
            return self._send(404, {"error": "not found: /station.json"})

        def do_POST(self):
            self._send(405, {"error": "the station only reads"})

        do_PUT = do_DELETE = do_POST
    return ThreadingHTTPServer((host, port), Handler)


def main(argv):
    ap = argparse.ArgumentParser(prog="cloudwall station",
                                 description="This machine with antennas: how it is (power, temperature, clock, SD card, "
                                             "sticks, decoder, feeders, tunnel), and its place on a wall's control board.")
    ap.add_argument("action", nargs="?", choices=("join", "leave"), help="join a wall, or leave the one joined")
    ap.add_argument("wall", nargs="?", help="(join) the wall's address, as the control board shows it")
    ap.add_argument("code", nargs="?", help="(join) the code the control board's Stations page made")
    ap.add_argument("--name", help="(join) what the board calls this station (default: its hostname)")
    ap.add_argument("--check", action="store_true", help="say how this receiver stands, and exit")
    ap.add_argument("--json", action="store_true", help="print what the station reports, and exit")
    ap.add_argument("--host", default="127.0.0.1", help="where to answer (default: this machine only)")
    ap.add_argument("--port", type=int, default=sensed.PORT, help=f"(default {sensed.PORT})")
    args = ap.parse_args(argv)
    if args.action in ("join", "leave") and os.geteuid() != 0:
        raise SystemExit(f"cloudwall station {args.action} changes this machine's settings: run it with sudo")
    if args.action == "join":
        if not (args.wall and args.code):
            raise SystemExit("cloudwall station join <the wall's address> <the code from its Stations page>")
        name = join(args.wall, args.code, args.name)
        print(f"Joined, as {name}. It reports to {args.wall.rstrip('/')} every minute; its settings are on the "
              "control board's Stations page.")
        subprocess.run(["systemctl", "try-restart", "cloudwall-station"], check=False, capture_output=True)
        return
    if args.action == "leave":
        conf = read_conf()
        if CONF.exists():
            CONF.unlink()
        subprocess.run(["systemctl", "try-restart", "cloudwall-station"], check=False, capture_output=True)
        print(f"Left {conf['wall']}: it no longer reports there (take it off the wall's Stations page too)." if conf
              else "This station hadn't joined a wall.")
        return
    if args.json:
        print(json.dumps(sensed.facts(), indent=1))
        return
    if args.check:
        f = sensed.facts()
        found = sensed.findings(f) if sensed.is_receiver(f) else []
        conf = read_conf()
        print(f"Joined to {conf['wall']} as {conf.get('name') or conf['id']}.\n" if conf else
              "Not joined to a wall (`sudo cloudwall station join <wall> <code>`).\n")
        if not found:
            print("Nothing to say: this doesn't look like a receiver (no stick, decoder or feeders found).")
            return
        print(health.render(found))
        worst = health.worst(found)
        print({"ok": "\nThe receiver is well.", "warn": "\nWorking, with something worth a look above.",
               "fail": "\nSomething above needs fixing."}.get(worst, ""))
        sys.exit(2 if worst == health.FAIL else 0)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    st = Station()
    srv = make_server(args.host, args.port, st)
    log.info("CloudWall station %s answering on http://%s:%d/station.json", __version__, args.host, args.port)
    conf = read_conf()
    if conf:
        log.info("reporting to %s as %s", conf["wall"], conf.get("name") or conf["id"])
        Reporter(conf, st).start()
    else:
        log.info("not joined to a wall: `sudo cloudwall station join <wall> <code>` (the wall's Stations page makes the code)")
    sd_notify("READY=1")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
