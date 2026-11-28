#!/usr/bin/env bash
# coverage3d_facts.sh: gather the facts the Coverage3D build prompt marks as unverified
# (section 8), from an adsb.im / ultrafeeder receiver, into one text file to paste into the prompt.
#
#   sudo bash coverage3d_facts.sh            # writes ~/coverage3d_facts.txt and prints it
#
# It only reads. It deliberately does NOT print secrets: from adsb.im's settings it shows only
# the station lat/lon/altitude keys, and from Docker only the container's mounts, not its
# environment (which holds feeder keys).

set -u
OUT="${SUDO_USER:+$(getent passwd "$SUDO_USER" | cut -d: -f6)}"
OUT="${OUT:-$HOME}/coverage3d_facts.txt"
BASE="http://127.0.0.1:8080/data"
RUNDIR="/run/adsb-feeder-ultrafeeder/readsb"
CT="ultrafeeder"
have() { command -v "$1" >/dev/null 2>&1; }
D=""; if have docker; then D="docker"; [ "$(id -u)" -ne 0 ] && D="sudo docker"; fi

section() { printf '\n===== %s =====\n' "$*"; }
run() { printf '$ %s\n' "$*"; bash -c "$*" 2>&1; }

{
echo "Coverage3D facts, collected $(date -Is) on $(hostname)"

section "1. receiver.json"
curl -s --max-time 5 "$BASE/receiver.json" || echo "(not reachable at $BASE)"; echo

section "2. aircraft.json: header, one full record, and a summary"
python3 - "$BASE/aircraft.json" <<'PY'
import json, sys, urllib.request, collections
try:
    d = json.load(urllib.request.urlopen(sys.argv[1], timeout=5))
except Exception as e:
    print("could not read:", e); sys.exit()
ac = d.get("aircraft", [])
print("top-level keys:", sorted(k for k in d if k != "aircraft"))
print("now:", d.get("now"), " messages:", d.get("messages"), " aircraft:", len(ac))
withpos = [a for a in ac if "lat" in a]
if withpos:
    print("example record (closest to complete):")
    print(json.dumps(max(withpos, key=len), indent=1))
print("count by type:", dict(collections.Counter(a.get("type", "?") for a in ac)))
keys = collections.Counter(k for a in ac for k in a)
print("fields present (field: how many aircraft have it):")
print("  " + ", ".join(f"{k}:{n}" for k, n in sorted(keys.items())))
ag = [a for a in withpos if "alt_geom" in a and isinstance(a.get("alt_baro"), (int, float))]
if ag:
    diffs = sorted(a["alt_geom"] - a["alt_baro"] for a in ag)
    print(f"alt_geom - alt_baro (ft): min {diffs[0]}, median {diffs[len(diffs)//2]}, max {diffs[-1]} over {len(ag)} aircraft")
print("aircraft with alt_baro == 'ground':", sum(a.get("alt_baro") == "ground" for a in ac))
PY

section "3. outline.json: structure and a sample"
python3 - "$BASE/outline.json" <<'PY'
import json, sys, urllib.request
try:
    raw = urllib.request.urlopen(sys.argv[1], timeout=5).read()
except Exception as e:
    print("could not read:", e); sys.exit()
print("size:", len(raw), "bytes")
print("first 400 bytes:", raw[:400].decode("utf-8", "replace"))
try:
    d = json.loads(raw)
except Exception as e:
    print("not JSON:", e); sys.exit()
def walk(o, path="", depth=0):
    if depth > 5: return
    if isinstance(o, dict):
        for k, v in o.items():
            t = type(v).__name__
            n = f" (len {len(v)})" if isinstance(v, (list, dict)) else f" = {v!r}"[:80]
            print("  " * depth + f"{path}{k}: {t}{n}")
            walk(v, f"{path}{k}.", depth + 1)
    elif isinstance(o, list) and o:
        print("  " * depth + f"{path}[0..{len(o)-1}] e.g. {json.dumps(o[0])[:120]}")
        if isinstance(o[0], (dict, list)): walk(o[0], path + "[0].", depth + 1)
walk(d)
PY

section "4. stats.json: keys and the last-minute block"
python3 - "$BASE/stats.json" <<'PY'
import json, sys, urllib.request
try:
    d = json.load(urllib.request.urlopen(sys.argv[1], timeout=5))
except Exception as e:
    print("could not read:", e); sys.exit()
print("top-level keys:", sorted(d))
print("last1min:", json.dumps(d.get("last1min"), indent=1)[:2500])
PY

section "5. Files readsb writes on the host, and who can read them"
run "ls -la $RUNDIR/"
run "stat -c '%A %U:%G %n' $RUNDIR/aircraft.json"
run "sudo -u nobody test -r $RUNDIR/aircraft.json && echo 'readable by a normal user' || echo 'NOT readable by a normal user (use the HTTP URL)'"

section "6. adsb.im station settings (lat/lon/altitude keys only)"
for f in /opt/adsb/config/.env /opt/adsb/config/config.json; do
  [ -e "$f" ] && { echo "$f:"; grep -hoE '"?FEEDER_(LAT|LONG|ALT_M|ALT_FT)"?[=:] *"?[-0-9.]+"?' "$f" || echo "  (no FEEDER_LAT/LONG/ALT keys found)"; }
done
[ -e /opt/adsb/config/.env ] || [ -e /opt/adsb/config/config.json ] || run "ls -la /opt/adsb/config/ 2>&1 | head"

section "7. Inside the ultrafeeder container: history locations"
if [ -n "$D" ]; then
  run "$D exec $CT sh -c 'ls -la /run/tar1090 2>&1 | head -25'"
  run "$D exec $CT sh -c 'ls -la /var/globe_history 2>&1 | head -25; du -sh /var/globe_history 2>/dev/null'"
  run "$D exec $CT sh -c 'find /var/globe_history -maxdepth 4 2>/dev/null | head -30'"
  run "$D exec $CT sh -c 'ls -la /usr/local/share/tar1090/html/data 2>&1 | head -20'"
  echo; echo "Container mounts (host path -> container path):"
  $D inspect "$CT" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Type}}){{"\n"}}{{end}}' 2>&1
else
  echo "docker not found"
fi

section "8. Ports and resources"
run "ss -ltn | grep -E ':8090\\b' || echo '8090 free'"
run "free -h"
run "nproc"
run "python3 --version"
run "df -h / | tail -1"
run "cat /proc/device-tree/model | tr -d '\\0'; echo"
run ". /etc/os-release; echo \$PRETTY_NAME"
} 2>&1 | tee "$OUT"

[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER": "$OUT" 2>/dev/null
echo
echo "Saved to $OUT. Paste it at the end of the Coverage3D prompt."
echo "It contains your station's coordinates, so don't post it publicly."
