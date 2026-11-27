#!/usr/bin/env bash
# feeder_report.sh: a report on an adsb.im receiver's data sharing and reception, to paste into
# a conversation about setting it up: which aggregators it feeds and whether each one's MLAT is
# synchronised, the location and antenna height MLAT depends on, the clock, and what the receiver
# hears (which fields its aircraft carry, how each is tracked, signal levels, its statistics).
#
# Run it ON THE PI, as root so it can read adsb.im's settings and the feeders' logs:
#
#   sudo bash feeder_report.sh          # prints the report and saves it to ./feeder-report.txt
#   sudo bash feeder_report.sh --short  # the essentials, short enough to paste into a message
#                                       # (saved to ./feeder-report-short.txt)
#
# It only reads: nothing is restarted, changed or installed.
#
# Safe to share: keys, sharing keys, feeder IDs, UUIDs, passwords, tokens, email addresses and
# public IP addresses are masked, and coordinates are cut to two decimal places (about 1 km),
# with how many decimals were entered reported separately. Read it before you paste it anyway.

set -u
if [ "$(id -u)" -ne 0 ]; then
  echo "Run it as root, so it can read adsb.im's settings and the feeders' logs: sudo bash $0" >&2
  exit 2
fi
command -v python3 >/dev/null 2>&1 || { echo "python3 is needed" >&2; exit 2; }

MODE=full
[ "${1:-}" = "--short" ] && MODE=short
OUT="${PWD}/feeder-report$([ "$MODE" = short ] && echo -short).txt"
python3 - "$OUT" "$MODE" <<'PY' 2>&1 | tee "$OUT"
import glob, json, math, os, re, shutil, statistics, subprocess, sys, time, urllib.request
from collections import Counter

# ---------------------------------------------------------------- masking what shouldn't be shared
SECRET_NAME = re.compile(r"(key|token|secret|pass|uuid|sharing|feeder_?id|feederid|api|email|user|login|serial|code|auth|cred)", re.I)
PRIVATE_IP = re.compile(r"^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)")

def mask(text):
    """Mask anything secret or identifying in free text (logs, settings)."""
    text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[email]", text)
    text = re.sub(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "[uuid]", text)
    text = re.sub(r"(?i)\b(uuid|key|sharing[_-]?key|api[_-]?key|token|secret|password|passwd|feeder[_-]?id|user(name)?|email)(\s*[=:]\s*)(\"?)[^\s,;\"']+",
                  lambda m: f"{m.group(1)}{m.group(3)}{m.group(4)}[masked]", text)
    # a key or ID written after its name without "=" ("sharing key 1a2b3c..."), and a FlightAware site number
    text = re.sub(r"(?i)\b(key|id|uuid|token|code)(\s+)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}\b", lambda m: f"{m.group(1)}{m.group(2)}[masked]", text)
    text = re.sub(r"(?i)\bsite(\s*#?\s*)\d{3,}\b", lambda m: f"site{m.group(1)}[masked]", text)
    # hex strings of 12 characters or more (keys, IDs), and long random-looking strings: keys and IDs without a label
    text = re.sub(r"\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{12,}\b", "[masked]", text)
    text = re.sub(r"\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b", "[masked]", text)
    def ip(m):
        return m.group(0) if PRIVATE_IP.match(m.group(0)) else "[public-ip]"
    text = re.sub(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", ip, text)
    # coordinates: any number with 4+ decimals that could be a latitude or longitude
    def coord(m):
        v = float(m.group(0))
        return f"{v:.2f}~" if 1 <= abs(v) <= 180 else m.group(0)
    return re.sub(r"-?\b\d{1,3}\.\d{4,}\b", coord, text)

def setting(name, value):
    """A setting's value as it may be shown."""
    v = "" if value is None else str(value)
    if v.strip() == "":
        return "(empty)"
    low = name.lower()
    if re.search(r"(^|_)(lat|latitude|lon|lng|long|longitude)($|_)", low):
        try:
            f = float(v)
            dec = len(v.split(".")[1]) if "." in v else 0
            return f"{f:.2f}~ ({dec} decimals entered)"
        except ValueError:
            return mask(v)
    if SECRET_NAME.search(name) and v.lower() not in ("true", "false", "0", "1", "yes", "no", "on", "off"):
        return f"set ({len(v)} characters, masked)"
    v = mask(v)
    return v if len(v) <= 160 else v[:160] + " ..."

def run(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return f"({cmd[0]}: {e})"

def section(t):
    print(f"\n== {t} ==")

def get(url_or_path):
    try:
        if url_or_path.startswith("http"):
            with urllib.request.urlopen(url_or_path, timeout=4) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        with open(url_or_path) as f:
            return json.load(f)
    except Exception:
        return None

SHORT = len(sys.argv) > 2 and sys.argv[2] == "short"
# in the short report, only the settings that bear on sharing: location, height, MLAT, which feeders are on, keys
WANTED = re.compile(r"(lat|lon|long|alt|mlat|enable|_is_|fr24|piaware|flightaware|radarbox|planefinder|opensky|adsbx|exchange|"
                    r"airplanes|adsb_?fi|adsb_?lol|adsbhub|planewatch|1090uk|tat|key|feeder_?id|gain|privacy|version)", re.I)
wanted = lambda k: not SHORT or bool(WANTED.search(k))
print(f"feeder_report {time.strftime('%Y-%m-%d %H:%M:%S %Z')}{' (short)' if SHORT else ''}")

# ---------------------------------------------------------------- the Pi
section("System")
try:
    print("Board:", open("/proc/device-tree/model").read().strip("\0\n"))
except OSError:
    print("Board: unknown")
osr = {}
try:
    for line in open("/etc/os-release"):
        k, _, v = line.strip().partition("=")
        osr[k] = v.strip('"')
except OSError:
    pass
print("OS:", osr.get("PRETTY_NAME", "?"), "|", os.uname().machine, "| kernel", os.uname().release)
print("Up:", run(["uptime", "-p"]).strip(), "| load", " ".join(open("/proc/loadavg").read().split()[:3]))
try:
    print(f"CPU temperature: {int(open('/sys/class/thermal/thermal_zone0/temp').read()) / 1000:.1f} C")
except (OSError, ValueError):
    pass
du = shutil.disk_usage("/")
print(f"Disk: {du.free / 1e9:.1f} GB free of {du.total / 1e9:.1f} GB")
mem = dict(l.split(":", 1) for l in open("/proc/meminfo") if ":" in l)
print("Memory:", mem.get("MemAvailable", "?").strip(), "available of", mem.get("MemTotal", "?").strip())
throttled = run(["vcgencmd", "get_throttled"]).strip()
if throttled.startswith("throttled"):
    print("Power/throttling:", throttled, "(0x0 is clean)")

section("Clock (MLAT needs it synchronised)")
print(run(["timedatectl", "show", "-p", "NTPSynchronized", "-p", "NTP", "-p", "Timezone"]).strip())
chrony = run(["chronyc", "tracking"])
if "Reference ID" in chrony:
    for line in chrony.splitlines():
        if line.split(":")[0].strip() in ("Reference ID", "Stratum", "System time", "Last offset", "RMS offset", "Leap status"):
            print(mask(line))

# ---------------------------------------------------------------- adsb.im's settings
section("adsb.im")
for f in ("/opt/adsb/adsb.im.version", "/opt/adsb/feeder-image.name", "/opt/adsb/adsb.im.previous-version"):
    if os.path.exists(f):
        print(f"{os.path.basename(f)}: {open(f).read().strip()}")
cfgs = [f for f in ("/opt/adsb/config/config.json", "/opt/adsb/config/.env", "/opt/adsb/.env") if os.path.exists(f)]
if not cfgs:
    print("No adsb.im settings found in /opt/adsb (not an adsb.im image, or a different layout)")
    print("Contents of /opt/adsb:", os.listdir("/opt/adsb") if os.path.isdir("/opt/adsb") else "(missing)")
for f in cfgs:
    print(f"\n-- settings in {f} (secrets masked) --")
    items = []
    if f.endswith(".json"):
        try:
            data = json.load(open(f))
            def walk(prefix, v):
                if isinstance(v, dict):
                    for k, w in v.items():
                        walk(f"{prefix}.{k}" if prefix else k, w)
                elif isinstance(v, list) and v and all(not isinstance(x, (dict, list)) for x in v):
                    items.append((prefix, json.dumps(v)))
                elif isinstance(v, list):
                    for i, w in enumerate(v):
                        walk(f"{prefix}[{i}]", w)
                else:
                    items.append((prefix, v))
            walk("", data)
        except Exception as e:
            print(f"(couldn't read: {e})")
    else:
        for line in open(f, errors="replace"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                items.append((k.strip(), v.strip().strip('"').strip("'")))
    for k, v in items:
        if wanted(k):
            print(f"  {k} = {setting(k, v)}")

# ---------------------------------------------------------------- the containers and what they feed
section("Containers")
docker = shutil.which("docker")
names = []
if not docker:
    print("docker isn't installed")
else:
    ps = run([docker, "ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"])
    for line in ps.strip().splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            names.append(parts[0])
            rc = run([docker, "inspect", "-f", "{{.RestartCount}}", parts[0]]).strip()
            print(f"  {parts[0]:<22} {parts[2]:<28} restarts {rc:<4} {parts[1]}")
    if not names:
        print("No containers listed. docker said:", mask(ps.strip())[:400] or "(nothing)")

def env_of(name):
    out = run([docker, "inspect", "-f", "{{json .Config.Env}}", name])
    try:
        return dict(e.split("=", 1) for e in json.loads(out) if "=" in e)
    except Exception:
        return {}

BORING = {"PATH", "HOME", "HOSTNAME", "TERM", "LANG", "LC_ALL", "S6_BEHAVIOUR_IF_STAGE2_FAILS", "S6_CMD_WAIT_FOR_SERVICES_MAXTIME",
          "S6_KILL_GRACETIME", "S6_SERVICES_GRACETIME", "IMAGE_VERSION", "TZ", "DEBIAN_FRONTEND", "PYTHONUNBUFFERED"}
if docker:
    ultra = next((n for n in names if "ultrafeeder" in n.lower()), None)
    if ultra:
        env = env_of(ultra)
        section(f"Aggregators fed by {ultra} (ULTRAFEEDER_CONFIG)")
        conf = env.get("ULTRAFEEDER_CONFIG", "")
        if not conf.strip():
            print("ULTRAFEEDER_CONFIG is empty: no community aggregators are being fed")
        table = {}
        for entry in re.split(r"[;\n]", conf):
            f = [x.strip() for x in entry.split(",") if x.strip()]
            if len(f) < 2:
                continue
            kind, host = f[0].lower(), f[1]
            row = table.setdefault(host, {"adsb": False, "mlat": False, "mlathub": False, "other": []})
            if kind in ("adsb", "mlat", "mlathub"):
                row[kind] = True
            else:
                row["other"].append(kind)
            extras = [x.split("=")[0] for x in f[2:] if "=" in x]
            if extras:
                row["other"].append(f"{kind} options: {', '.join(sorted(set(extras)))}")
        for host, row in sorted(table.items()):
            flags = " ".join(k for k in ("adsb", "mlat", "mlathub") if row[k])
            print(f"  {mask(host):<34} {flags:<20} {'; '.join(row['other'])}")
        print(f"\n-- other settings of {ultra} (secrets masked) --")
        for k in sorted(env):
            if k not in BORING and k != "ULTRAFEEDER_CONFIG" and wanted(k):
                print(f"  {k} = {setting(k, env[k])}")
    for n in names:
        if n == ultra:
            continue
        env = env_of(n)
        shown = {k: v for k, v in env.items() if k not in BORING and wanted(k)}
        if shown:
            print(f"\n-- settings of {n} (secrets masked) --")
            for k in sorted(shown):
                print(f"  {k} = {setting(k, shown[k])}")

    section("Feeder logs: connections, MLAT and errors (last matching lines, masked)")
    keep = re.compile(r"(mlat|synchron|sync|peer|connect|disconnect|error|fail|warn|denied|invalid|refused|timeout|claim|feeder|logged|login|"
                      r"position|location|altitude|unknown|not found|key|online|offline|server status|beast|uploading|feed)", re.I)
    for n in names:
        lines = run([docker, "logs", "--tail", "600", n], timeout=30).splitlines()
        hits = [mask(l) for l in lines if keep.search(l)]
        # lines that differ only in their numbers (timestamps, counts, peers) shown once, the latest, with how many
        groups = {}
        for l in hits:
            k = re.sub(r"\d+", "#", l)
            n_, _ = groups.pop(k, (0, l))
            groups[k] = (n_ + 1, l)
        print(f"\n-- {n}: {len(lines)} recent lines, {len(hits)} of interest --")
        for count, l in list(groups.values())[-(5 if SHORT else 25):]:
            print("  " + l[:220] + (f"   (x{count})" if count > 1 else ""))

# ---------------------------------------------------------------- what the receiver hears
section("Reception")
bases = ["/run/adsb-feeder-ultrafeeder/readsb", "/run/readsb", "/run/dump1090-fa", "http://127.0.0.1:8080/data",
         "http://127.0.0.1/tar1090/data", "http://127.0.0.1/skyaware/data", "http://127.0.0.1:8504/data"]
base = next((b for b in bases if get(f"{b}/aircraft.json")), None)
if not base:
    print("Couldn't find aircraft.json; looked in:", ", ".join(bases))
else:
    print("Data from:", base)
    rec = get(f"{base}/receiver.json") or {}
    if rec:
        print("receiver.json:", {k: (setting(k, v) if k in ("lat", "lon") else v) for k, v in rec.items() if not isinstance(v, (list, dict))})
    ac = get(f"{base}/aircraft.json") or {}
    planes = ac.get("aircraft") or []
    seen = [a for a in planes if (a.get("seen") or 0) <= 60]
    pos = [a for a in seen if "lat" in a and (a.get("seen_pos") or 0) <= 60]
    print(f"Aircraft heard in the last minute: {len(seen)}, with positions: {len(pos)} (total messages so far: {ac.get('messages')})")
    print("How each is tracked:", dict(Counter(a.get("type", "?") for a in seen).most_common()))
    print("Positions by MLAT:", sum(1 for a in pos if "lat" in (a.get("mlat") or [])),
          "| by TIS-B:", sum(1 for a in pos if "lat" in (a.get("tisb") or [])))
    rssi = sorted(a["rssi"] for a in seen if isinstance(a.get("rssi"), (int, float)))
    if rssi:
        print(f"Signal (RSSI, dBFS): weakest {rssi[0]:.1f}, median {statistics.median(rssi):.1f}, strongest {rssi[-1]:.1f}; "
              f"{sum(1 for r in rssi if r > -3)} above -3 (too loud)")
    if rec.get("lat") is not None and pos:
        la0, lo0 = math.radians(rec["lat"]), math.radians(rec["lon"])
        def nm(a):
            la, lo = math.radians(a["lat"]), math.radians(a["lon"])
            return 3440.065 * 2 * math.asin(math.sqrt(math.sin((la - la0) / 2) ** 2 + math.cos(la0) * math.cos(la) * math.sin((lo - lo0) / 2) ** 2))
        d = sorted((nm(a), a) for a in pos if "lat" not in (a.get("mlat") or []) and "lat" not in (a.get("tisb") or []))
        if d:
            print(f"Farthest heard directly right now: {d[-1][0]:.0f} nm ({(d[-1][1].get('flight') or d[-1][1].get('hex', '')).strip()}, "
                  f"{d[-1][1].get('alt_baro')} ft); median {statistics.median(x for x, _ in d):.0f} nm")
    fields = Counter(k for a in seen for k in a)
    if not SHORT:
        print("\nFields present (how many of the aircraft carry each):")
        print("  " + ", ".join(f"{k} {n}" for k, n in sorted(fields.items(), key=lambda kv: (-kv[1], kv[0]))))
    watch = ["ias", "tas", "mach", "oat", "tat", "wd", "ws", "nav_qnh", "nav_heading", "nav_altitude_mcp", "nav_altitude_fms",
             "nav_modes", "roll", "track_rate", "mag_heading", "true_heading", "rssi", "messages", "category", "emergency"]
    print("Weather and flight-deck fields:", ", ".join(f"{k}: {fields.get(k, 0)}" for k in watch))
    rich = [] if SHORT else sorted(seen, key=lambda a: -len(a))[:2]
    for a in rich:
        print("\nExample record (of the two carrying the most fields):")
        print("  " + json.dumps({k: (round(v, 2) if k in ("lat", "lon") and isinstance(v, float) else v) for k, v in a.items()}, sort_keys=True))
    st = get(f"{base}/stats.json")
    if st:
        print("\nstats.json sections:", ", ".join(st.keys()))
        for part in (("last15min",) if SHORT else ("last1min", "last15min", "total")):
            if isinstance(st.get(part), dict):
                d = st[part]
                if SHORT:           # the receiver's own levels, message rate and range
                    d = {k: d[k] for k in ("local", "messages", "max_distance", "remote") if k in d}
                    if isinstance(d.get("local"), dict):
                        d["local"] = {k: v for k, v in d["local"].items() if k in ("signal", "noise", "peak_signal", "strong_signals", "accepted", "samples_dropped")}
                print(f"stats {part}: " + json.dumps(d, sort_keys=True)[:1800])
    else:
        print("\nNo stats.json at", base)
    for extra in ("outline.json", "globeMil_42777.json", "chunks/chunks.json"):
        if get(f"{base}/{extra}") is not None:
            print(f"Also served: {extra}")

print("\n(end of report)")
PY
echo
echo "Saved to $OUT ($(wc -l <"$OUT") lines). Read it over, then paste it into the conversation."
[ "$MODE" = full ] && echo "Too long to paste? sudo bash $0 --short gives the essentials only." 
