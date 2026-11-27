"""A receiver's own state, as the machine it runs on knows it: the Raspberry Pi's power supply and
temperature, its clock, its SD card, the USB stick, the decoder and the feeders, the tunnel. The
checks tools/adsb_check.sh makes at a terminal, made here so a CloudWall station on the receiver
can report them (app/station.py serves them on 127.0.0.1:8095, through the tunnel to the wall at
127.0.0.1:18095), and the wall can show and judge them (the control board's Receiver page, its
health watcher, alerts), and `cloudwall station --check` and `cloudwall doctor` say them on the
receiver itself.

Two halves, so the wall judges with its own rules whatever version the receiver runs:
  facts(...)     what the machine says, plainly (a dict, the same on any version: FORMAT);
  findings(f)    what those facts mean, as health findings named from core/troubles.py.

Everything is read; nothing is changed. Each source may be missing (not a Pi, no vcgencmd, no
docker access): its fact is None and nothing is said about it.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path

from .. import __version__
from ..core import health

FORMAT = 1
PORT = 8095                 # the station's port on the receiver
TUNNEL_OFFSET = 15          # through the tunnel: the receiver's port (18080) + 15 = 18095

# the RTL2832U sticks (the FlightAware Pro Stick and most others), by their USB ids
SDR_IDS = {"0bda:2832", "0bda:2838"}
# services a receiver may run, and what each is
UNITS = {"readsb": "decoder", "dump1090-fa": "decoder", "dump1090-mutability": "decoder", "dump1090": "decoder",
         "piaware": "FlightAware feeder", "fr24feed": "Flightradar24 feeder", "adsbexchange-feed": "ADSBexchange feeder",
         "tar1090": "map", "lighttpd": "web server", "docker": "containers (adsb.im)", "adsb-tunnel": "CloudWall tunnel",
         "coverage3d": "Coverage3D", "cloudwall-station": "CloudWall station"}
DECODER_URLS = ("http://127.0.0.1:8080/data", "http://127.0.0.1/tar1090/data", "http://127.0.0.1/skyaware/data",
                "http://127.0.0.1/dump1090-fa/data")
DECODER_FILES = ("/run/readsb", "/run/dump1090-fa", "/run/dump1090-mutability", "/run/adsb-feeder-ultrafeeder/readsb")


def _run(cmd):
    try:
        got = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        return got.stdout if got.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _read(path):
    try:
        return Path(path).read_text(errors="replace")
    except OSError:
        return None


def _get(url, timeout=4):
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read(4 << 20))
    except Exception:
        return None


def urls(cfg):
    """(the receiver's web server, Coverage3D's, the station's), as reached from this machine, or
    None each: from [receiver] where set, else worked out from the first feed when combining is on
    (through the tunnel the receiver is 127.0.0.1:18080, Coverage3D 18090 and the station 18095; at
    home, the receiver's address on their own ports, 8090 and 8095)."""
    r = cfg.get("receiver") or {}
    url = (r.get("url") or "").rstrip("/")
    src = cfg.get("source") or {}
    if not url and src.get("merge") and src.get("urls"):
        first = src["urls"][0]
        url = first.split("/data/")[0] if "/data/" in first else ""

    def beside(offset, home_port):
        m = re.match(r"^(https?://[^/:]+):(\d+)$", url or "")
        if not m:
            return ""
        return f"{m.group(1)}:{int(m.group(2)) + offset}" if m.group(2) == "18080" else f"{m.group(1)}:{home_port}"
    cov = (r.get("coverage_url") or "").rstrip("/") or beside(10, 8090)
    station = (r.get("station_url") or "").rstrip("/") or beside(TUNNEL_OFFSET, PORT)
    return url or None, cov or None, station or None


# -- what the machine says ---------------------------------------------------------------------------

def facts(run=_run, read=_read, get=_get, disk=shutil.disk_usage, exists=os.path.exists, now=time.time):
    """Everything the receiver's machine says about itself, read-only, in plain values."""
    f = {"format": FORMAT, "cloudwall": __version__, "host": socket.gethostname(), "checked": now()}
    model = (read("/proc/device-tree/model") or "").replace("\0", "").strip()
    f["board"] = model or None
    osr = read("/etc/os-release") or ""
    m = re.search(r'^PRETTY_NAME="?([^"\n]+)', osr, re.M)
    f["os"] = m.group(1) if m else None
    f["image"] = ("adsb.im" if exists("/opt/adsb") or exists("/opt/adsb-feeder")
                  else "PiAware" if exists("/boot/piaware-config.txt") or exists("/boot/firmware/piaware-config.txt")
                  else "Pi24" if exists("/etc/fr24feed.ini") else None)
    up = (read("/proc/uptime") or "").split()
    f["uptime_s"] = float(up[0]) if up else None
    la = (read("/proc/loadavg") or "").split()
    f["load"] = [float(x) for x in la[:3]] if len(la) >= 3 else None
    f["cpus"] = os.cpu_count()
    mem = read("/proc/meminfo") or ""
    kb = {k: int(v) * 1024 for k, v in re.findall(r"^(MemTotal|MemAvailable):\s+(\d+)", mem, re.M)}
    f["memory"] = {"total": kb.get("MemTotal"), "available": kb.get("MemAvailable")} if kb else None
    try:
        u = disk("/")
        f["disk"] = {"total": u.total, "free": u.free}
    except OSError:
        f["disk"] = None

    # power and heat: vcgencmd where it answers, else the firmware's and the kernel's own files
    thr = run(["vcgencmd", "get_throttled"]) or read("/sys/devices/platform/soc/soc:firmware/get_throttled")
    m = re.search(r"(?:throttled=)?((?:0x)?[0-9a-fA-F]+)\s*$", (thr or "").strip())
    f["throttled"] = int(m.group(1), 16) if m else None          # always hexadecimal, with 0x or without
    temp = run(["vcgencmd", "measure_temp"])
    m = re.search(r"([\d.]+)", temp or "")
    if m:
        f["temp_c"] = float(m.group(1))
    else:
        t = (read("/sys/class/thermal/thermal_zone0/temp") or "").strip()
        f["temp_c"] = round(int(t) / 1000, 1) if t.isdigit() else None

    sync = run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"])
    f["clock_synced"] = None if sync is None else sync.strip() == "yes"

    usb = run(["lsusb"])
    f["sdr"] = None if usb is None else [
        {"id": m.group(1).lower(), "name": m.group(2).strip()}
        for m in re.finditer(r"ID ([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\s*(.*)", usb) if m.group(1).lower() in SDR_IDS]
    mods = read("/proc/modules")
    f["dvb_driver"] = None if mods is None else bool(re.search(r"^dvb_usb_rtl28xxu\b", mods, re.M))

    units = {}
    for name in UNITS:
        got = run(["systemctl", "show", "-p", "LoadState", "-p", "ActiveState", name])
        if not got:
            continue
        kv = dict(line.split("=", 1) for line in got.splitlines() if "=" in line)
        if kv.get("LoadState") == "loaded":
            units[name] = kv.get("ActiveState", "unknown")
    f["units"] = units
    ps = run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}"])
    f["containers"] = None if ps is None else dict(l.split("\t", 1) for l in ps.splitlines() if "\t" in l)

    # the decoder's own data: is it there, and is it moving on?
    f["decoder"] = None
    for base in DECODER_URLS:
        ac = get(f"{base}/aircraft.json")
        if isinstance(ac, dict) and "now" in ac:
            st = get(f"{base}/stats.json") or {}
            f["decoder"] = _decoder(base, ac, st)
            break
    if f["decoder"] is None:
        for folder in DECODER_FILES:
            text = read(f"{folder}/aircraft.json")
            if text:
                try:
                    ac = json.loads(text)
                    st = json.loads(read(f"{folder}/stats.json") or "{}")
                    f["decoder"] = _decoder(folder, ac, st)
                    break
                except ValueError:
                    continue

    # the feeders: FlightAware's piaware, and Flightradar24's fr24feed (a package or adsb.im's container)
    feeders = {}
    pa = read("/run/piaware/status.json")
    if pa:
        try:
            pj = json.loads(pa)
            adept = pj.get("adept") or {}
            feeders["flightaware"] = {"connected": adept.get("status") == "green", "detail": adept.get("message") or ""}
        except ValueError:
            pass
    fr = get("http://127.0.0.1:8754/monitor.json")
    if isinstance(fr, dict) and fr:
        feeders["flightradar24"] = {"connected": str(fr.get("feed_status", "")).lower() == "connected",
                                    "detail": " ".join(str(x) for x in (fr.get("feed_status"), fr.get("feed_alias")) if x)}
    f["feeders"] = feeders
    return f


def _decoder(where, ac, st):
    last = st.get("last1min") or {}
    return {"where": where, "now": ac.get("now"), "aircraft": len(ac.get("aircraft") or []),
            "with_pos": sum(1 for a in ac.get("aircraft") or [] if "lat" in a),
            "messages": ac.get("messages"), "messages_min": last.get("messages"),
            "gain_db": st.get("gain_db")}


# -- what it means ---------------------------------------------------------------------------------------

def is_receiver(f):
    """Does this machine look like a receiver: a stick, a decoder, a feeder, or a receiver's image?"""
    return bool(f and (f.get("sdr") or f.get("decoder") or f.get("feeders") or f.get("image")
                       or any(UNITS.get(n) in ("decoder", "FlightAware feeder", "Flightradar24 feeder") for n in f.get("units") or {})))


def findings(f, now=None):
    """Health findings from a receiver's facts (part "receiver"): a problem for each thing wrong,
    named from the catalogue, and a line for each thing checked and found well."""
    if not f:
        return []
    now = now or f.get("checked") or time.time()
    out = []
    host = f.get("host") or "the receiver"
    thr = f.get("throttled")
    if thr is not None:
        if thr & 0x1:
            out.append(health.trouble("receiver.undervoltage", f"{host}: under-voltage now (get_throttled={thr:#x})", state=health.FAIL))
        elif thr & 0x10000:
            out.append(health.trouble("receiver.undervoltage", f"{host}: under-voltage has happened since it started (get_throttled={thr:#x})"))
        else:
            out.append(health.ok("receiver", "power supply: no under-voltage since it started"))
        if thr & 0x4:
            out.append(health.trouble("receiver.throttled", f"{host} is slowing itself down now (heat or power)"))
    t = f.get("temp_c")
    if t is not None:
        out.append(health.trouble("receiver.hot", f"{host} is at {t:.0f} °C") if t >= 80 else health.ok("receiver", f"temperature {t:.0f} °C"))
    if f.get("clock_synced") is False:
        out.append(health.trouble("receiver.clock", f"{host}'s clock isn't synchronised"))
    elif f.get("clock_synced"):
        out.append(health.ok("receiver", "clock synchronised"))
    d = f.get("disk")
    if d and d.get("total"):
        used = 100 * (1 - d["free"] / d["total"])
        if used >= 90:
            out.append(health.trouble("receiver.disk", f"{host}'s SD card is {used:.0f}% full",
                                      state=health.FAIL if used >= 97 else health.WARN))
        else:
            out.append(health.ok("receiver", f"SD card {used:.0f}% used"))
    sdr = f.get("sdr")
    if sdr is not None:
        if not sdr:
            out.append(health.trouble("receiver.no-sdr", f"no USB receiver stick on {host}"))
        else:
            out.append(health.ok("receiver", f"USB stick: {', '.join(s['name'] or s['id'] for s in sdr)}"))
    if f.get("dvb_driver"):
        out.append(health.trouble("receiver.dvb-driver"))
    units = f.get("units") or {}
    dec = f.get("decoder")
    # a unit that failed; or, with no decoder answering, a decoder's unit that isn't running (one left
    # installed but stopped, when another answers, is no problem)
    failed = [n for n, s in units.items() if s == "failed" or (dec is None and s != "active" and UNITS.get(n) == "decoder")]
    if failed:
        out.append(health.trouble("receiver.service-failed", f"{host}: " + ", ".join(f"{n} ({UNITS.get(n, '')}) is {units[n]}" for n in failed)))
    if dec is None and (sdr or units):
        out.append(health.trouble("receiver.no-decoder", f"{host}: no decoder's data found"))
    elif dec:
        age = now - dec["now"] if dec.get("now") else None
        if age is not None and age > 60:
            out.append(health.trouble("receiver.decoder-stuck", f"{host}: the decoder's data is {age / 60:.0f} min old"))
        else:
            out.append(health.ok("receiver", f"decoder answering: {dec['aircraft']} aircraft, {dec['with_pos']} with a position"))
    for name, fd in (f.get("feeders") or {}).items():
        label = {"flightaware": "FlightAware", "flightradar24": "Flightradar24"}.get(name, name)
        out.append(health.ok("receiver", f"{label}: connected") if fd.get("connected")
                   else health.trouble("receiver.feeder-down", f"{label} isn't connected: {fd.get('detail') or 'no connection'}"))
    tun = units.get("adsb-tunnel")
    if tun and tun != "active":
        out.append(health.trouble("tunnel.down", f"adsb-tunnel.service on {host} is {tun}"))
    return out
