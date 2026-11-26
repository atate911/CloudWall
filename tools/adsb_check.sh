#!/usr/bin/env bash
# adsb_check.sh: check that a Raspberry Pi ADS-B receiver is set up and hearing aircraft.
#
# Built for a PiAware-style image (dump1090-fa + piaware) with a FlightAware Pro Stick
# or Pro Stick Plus, and also understands readsb, dump1090-mutability, adsb.im
# (ultrafeeder) and fr24feed setups. Run it ON THE PI:
#
#   bash adsb_check.sh                # full check, listens for 15 seconds
#   sudo bash adsb_check.sh           # same, plus logs and kernel messages that need root
#   bash adsb_check.sh --sample 30    # listen longer for a better message rate
#   bash adsb_check.sh --url http://127.0.0.1:8080/data   # point at a decoder's JSON yourself
#
# It only reads: nothing is restarted, changed or installed. Exit status is 0 when
# everything passed, 1 with warnings only, 2 when something failed.

set -u

SAMPLE=15
URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sample) SAMPLE="${2:-15}"; shift 2 ;;
    --url)    URL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; B=$'\e[1m'; D=$'\e[2m'; N=$'\e[0m'
else
  G=""; Y=""; R=""; B=""; D=""; N=""
fi
NPASS=0; NWARN=0; NFAIL=0
pass() { echo "  ${G}[PASS]${N} $*"; NPASS=$((NPASS+1)); }
warn() { echo "  ${Y}[WARN]${N} $*"; NWARN=$((NWARN+1)); }
fail() { echo "  ${R}[FAIL]${N} $*"; NFAIL=$((NFAIL+1)); }
info() { echo "  ${D}[INFO]${N} $*"; }
hint() { echo "         ${D}-> $*${N}"; }
section() { echo; echo "${B}== $* ==${N}"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && sudo -n true 2>/dev/null && SUDO="sudo -n"

# ---------------------------------------------------------------------------------
section "System"
model=$( { tr -d '\0' </proc/device-tree/model; } 2>/dev/null || echo "unknown (not a Raspberry Pi?)")
info "Board: $model"
if [ -r /etc/os-release ]; then . /etc/os-release; info "OS: ${PRETTY_NAME:-unknown} ($(uname -m))"; fi
info "Host: $(hostname)  IP: $(hostname -I 2>/dev/null | awk '{print $1}')"
info "Up: $(uptime -p 2>/dev/null || uptime)"

image="unknown"
if [ -e /boot/piaware-config.txt ] || [ -e /boot/firmware/piaware-config.txt ]; then image="PiAware SD-card image"
elif [ -d /opt/adsb ] || [ -d /opt/adsb-feeder ]; then image="adsb.im feeder image"
elif [ -e /etc/fr24feed.ini ] && ! have piaware; then image="Flightradar24 Pi24 image"
elif have piaware; then image="Raspberry Pi OS with PiAware packages"
fi
info "Receiver image: $image"

if have vcgencmd; then
  t=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
  temp=$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)
  info "CPU temperature: ${temp:-?}"
  if [ -n "$t" ]; then
    v=$((t))
    if (( v & 0x1 )); then fail "Under-voltage RIGHT NOW (get_throttled=$t)"
      hint "The Pro Stick draws real current: use the official Pi power supply, not a phone charger"
    elif (( v & 0x10000 )); then warn "Under-voltage has happened since boot (get_throttled=$t)"
      hint "A weak supply can make the USB stick drop out; use the official Pi power supply"
    else pass "Power supply OK (no under-voltage since boot)"; fi
    (( v & 0x4 )) && warn "CPU is being throttled now (heat or power)"
  fi
fi
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  pass "Clock is synchronised (needed for MLAT)"
elif have timedatectl; then
  warn "Clock is not NTP-synchronised; MLAT positions need accurate time"
fi
use=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
[ -n "$use" ] && { [ "$use" -ge 90 ] && warn "SD card ${use}% full" || pass "SD card ${use}% used"; }

# ---------------------------------------------------------------------------------
section "USB receiver (FlightAware Pro Stick)"
if have lsusb; then
  sdr=$(lsusb | grep -Ei '0bda:28(32|38)|RTL28|RTL2838|FlightAware' || true)
  if [ -n "$sdr" ]; then
    while IFS= read -r l; do pass "Found: $l"; done <<<"$sdr"
    [ "$(wc -l <<<"$sdr")" -gt 1 ] && warn "More than one RTL-SDR stick: make sure the decoder uses the right one (set serials with rtl_eeprom)"
    for d in /sys/bus/usb/devices/*; do
      if [ "$(cat "$d/idVendor" 2>/dev/null)" = "0bda" ] && grep -qE '^28(32|38)$' "$d/idProduct" 2>/dev/null; then
        info "Stick: $(cat "$d/manufacturer" 2>/dev/null) $(cat "$d/product" 2>/dev/null), serial $(cat "$d/serial" 2>/dev/null), USB $(cat "$d/speed" 2>/dev/null) Mb/s"
      fi
    done
  else
    fail "No RTL-SDR / FlightAware Pro Stick on USB"
    hint "Reseat the stick (try another port, avoid unpowered hubs), then run: lsusb"
  fi
else
  warn "lsusb not installed (sudo apt install usbutils); can't list USB devices"
fi
if lsmod 2>/dev/null | grep -q '^dvb_usb_rtl28xxu'; then
  warn "The kernel TV-tuner driver (dvb_usb_rtl28xxu) is loaded; it can grab the stick before the decoder"
  hint "Blacklist it: echo 'blacklist dvb_usb_rtl28xxu' | sudo tee /etc/modprobe.d/rtlsdr-blacklist.conf && sudo reboot"
else
  pass "Kernel TV-tuner driver is not holding the stick"
fi
k=$($SUDO dmesg 2>/dev/null | grep -iE 'usb.*(disconnect|over-current|error -71)' | tail -3 || true)
[ -n "$k" ] && { warn "Recent USB trouble in kernel log:"; sed 's/^/           /' <<<"$k"; }

# ---------------------------------------------------------------------------------
section "Software"
decoder=""
svc_state() { systemctl is-active "$1" 2>/dev/null; }
for s in dump1090-fa readsb dump1090-mutability dump1090 piaware fr24feed adsbexchange-feed adsbexchange-mlat lighttpd tar1090; do
  st=$(svc_state "$s")
  if systemctl list-unit-files "$s.service" 2>/dev/null | grep -q "^$s.service"; then
    case "$s" in dump1090*|readsb) role="decoder";; lighttpd|tar1090) role="web map";; *) role="feeder";; esac
    if [ "$st" = active ]; then
      pass "$s ($role) is running"
      [ "$role" = decoder ] && [ -z "$decoder" ] && decoder="$s"
    else
      if [ "$role" = decoder ] || [ "$s" = piaware ]; then fail "$s ($role) is installed but $st"
        hint "sudo systemctl restart $s; then: journalctl -u $s -n 50"
      else warn "$s ($role) is installed but $st"; fi
    fi
  fi
done
if have docker; then
  c=$($SUDO docker ps -a --format '{{.Names}} ({{.Status}})' 2>/dev/null || true)
  if [ -n "$c" ]; then
    info "Docker containers:"; sed 's/^/           /' <<<"$c"
    if grep -iE 'ultrafeeder|readsb' <<<"$c" | grep -q '(Up'; then
      [ -z "$decoder" ] && decoder="docker"
    elif grep -qiE 'ultrafeeder|readsb' <<<"$c"; then
      fail "The decoder container exists but isn't running"
      hint "Look at its log in the adsb.im web page (System > Logs, or Dozzle on port 9999)"
      decoder="stopped"
    fi
  fi
fi
if [ "$image" = "adsb.im feeder image" ] && [ -z "$decoder" ]; then
  fail "adsb.im is installed but its decoder (ultrafeeder) was never started: setup isn't finished"
  hint "Open http://$(hostname -I 2>/dev/null | awk '{print $1}')/ in a browser and complete the setup:"
  hint "location + altitude, then on the SDR page assign the stick (serial 00001000 etc.) to 1090 MHz"
  decoder="stopped"
elif [ "$decoder" = stopped ]; then
  :
elif [ -z "$decoder" ]; then
  fail "No ADS-B decoder (dump1090-fa / readsb) is running"
else
  info "Decoder in use: $decoder"
fi

if [ -n "$decoder" ] && [ "$decoder" != docker ] && [ "$decoder" != stopped ]; then
  errs=$($SUDO journalctl -u "$decoder" --since "-30 min" --no-pager 2>/dev/null \
        | grep -iE 'no supported devices|usb_claim_interface|failed to open|lost|cannot|error' | tail -4 || true)
  if [ -n "$errs" ]; then warn "Recent errors from $decoder:"; sed 's/^/           /' <<<"$errs"
    grep -qi 'no supported devices\|failed to open' <<<"$errs" && hint "The decoder can't open the stick: check USB, the DVB driver above, and that only one program uses it"
  elif [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; then pass "No errors from $decoder in the last 30 minutes"; fi
fi

# gain settings
gain=""
have piaware-config && gain=$(piaware-config -show rtlsdr-gain 2>/dev/null)
[ -z "$gain" ] && gain=$(grep -hoE '^(RECEIVER_GAIN|GAIN)=.*' /etc/default/dump1090-fa 2>/dev/null | head -1)
[ -z "$gain" ] && gain=$(grep -hoE -- '--gain[ =][^ "]+' /etc/default/readsb /etc/default/dump1090-fa 2>/dev/null | head -1)
[ -n "$gain" ] && info "Gain setting: $gain"

# ports
if have ss; then
  ports=$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\n' ' ')
  if grep -qw 30005 <<<" $ports "; then pass "Beast output on port 30005 is listening (feeders read from here)"
  elif [ -n "$decoder" ] && [ "$decoder" != stopped ]; then warn "Nothing listening on port 30005 (Beast output); feeders may get no data"; fi
  grep -qw 30003 <<<" $ports " && info "SBS/BaseStation output on port 30003"
  for p in 80 8080 8504; do grep -qw "$p" <<<" $ports " && info "Web server on port $p"; done
fi

# ---------------------------------------------------------------------------------
if have piaware-status || have piaware-config; then
  section "FlightAware feed (piaware)"
  if have piaware-status; then
    ps_out=$(piaware-status 2>&1 || true)
    sed 's/^/           /' <<<"$ps_out" | head -15
    grep -qi 'connected to FlightAware' <<<"$ps_out" && ! grep -qi 'not connected to FlightAware' <<<"$ps_out" \
      && pass "piaware is connected to FlightAware" || warn "piaware does not report a FlightAware connection"
  fi
  fid=$(piaware-config -show feeder-id 2>/dev/null || true)
  if [ -n "$fid" ]; then info "Feeder ID: $fid"
  else hint "Claim this receiver at https://flightaware.com/adsb/piaware/claim (from a browser on the same network)"; fi
fi

# ---------------------------------------------------------------------------------
section "Live reception (listening for ${SAMPLE}s)"
have python3 || { fail "python3 is needed to read the decoder's data"; SAMPLE=0; }

cands=()
[ -n "$URL" ] && cands+=("$URL")
cands+=(/run/dump1090-fa /run/readsb /run/dump1090-mutability /run/dump1090 /run/adsb-feeder-ultrafeeder/readsb
        http://127.0.0.1/skyaware/data http://127.0.0.1/tar1090/data http://127.0.0.1:8080/data
        http://127.0.0.1/dump1090-fa/data http://127.0.0.1/dump1090/data http://127.0.0.1:8504/data)
src=""
for c in "${cands[@]}"; do
  case "$c" in
    http*) curl -fsm 3 "$c/aircraft.json" -o /dev/null 2>/dev/null && { src="$c"; break; } ;;
    *)     [ -r "$c/aircraft.json" ] && { src="$c"; break; } ;;
  esac
done

if [ -z "$src" ]; then
  fail "Couldn't find the decoder's aircraft.json (looked in /run/* and on the local web server)"
  hint "If you know where it is: bash $0 --url http://127.0.0.1:PORT/path/to/data"
elif have python3; then
  info "Reading $src"
  while IFS='|' read -r kind msg; do
    case "$kind" in
      PASS) pass "$msg";; WARN) warn "$msg";; FAIL) fail "$msg";; INFO) info "$msg";; HINT) hint "$msg";;
      *) [ -n "$kind" ] && echo "         $kind";;
    esac
  done < <(python3 - "$src" "$SAMPLE" <<'PY'
import json, math, sys, time, urllib.request

src, sample = sys.argv[1].rstrip("/"), float(sys.argv[2])

def load(name):
    try:
        if src.startswith("http"):
            with urllib.request.urlopen(f"{src}/{name}", timeout=5) as r:
                return json.load(r)
        with open(f"{src}/{name}") as f:
            return json.load(f)
    except Exception:
        return None

def out(kind, msg): print(f"{kind}|{msg}", flush=True)

def nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 3440.065 * 2 * math.asin(math.sqrt(a))

rx = load("receiver.json") or {}
if rx.get("version"): out("INFO", f"Decoder version: {rx['version']}")
lat, lon = rx.get("lat"), rx.get("lon")
if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and (lat or lon):
    out("PASS", f"Receiver location is set ({lat:.3f}, {lon:.3f})")
else:
    lat = lon = None
    out("WARN", "Receiver location is not set: ranges can't be worked out and MLAT won't work")
    out("HINT", "Set it on your FlightAware stats page (PiAware) or in the decoder's --lat/--lon options")

a1 = load("aircraft.json")
if a1 is None:
    out("FAIL", "aircraft.json could not be read or parsed"); sys.exit()
age = time.time() - a1.get("now", 0)
if age > 60:
    out("FAIL", f"aircraft.json is {age:.0f}s old: the decoder has stopped updating it")
    sys.exit()
time.sleep(max(sample, 1))
a2 = load("aircraft.json") or a1

dt = (a2.get("now", 0) - a1.get("now", 0)) or 0
dm = (a2.get("messages", 0) - a1.get("messages", 0))
rate = dm / dt if dt > 0 else None
planes = [a for a in a2.get("aircraft", []) if a.get("seen", 999) < 60]
pos = [a for a in planes if "lat" in a and "lon" in a and a.get("seen_pos", 999) < 60]
mlat = [a for a in pos if "lat" in (a.get("mlat") or [])]

if rate is None:
    out("WARN", "Couldn't measure a message rate (the file didn't change while listening)")
elif rate == 0:
    out("FAIL", f"No messages decoded in {dt:.0f}s")
    out("HINT", "Check the antenna cable is screwed onto the stick, the antenna is outdoors/high, and the gain isn't set very low")
elif rate < 5:
    out("WARN", f"Only {rate:.1f} messages/second: it's working, but reception is weak")
    out("HINT", "Usual causes: antenna indoors or low, long thin coax, or no aircraft nearby right now (night)")
else:
    out("PASS", f"Decoding {rate:.0f} messages/second")

if planes:
    out("PASS" if pos else "WARN",
        f"{len(planes)} aircraft heard in the last minute, {len(pos)} with positions" + (f" ({len(mlat)} by MLAT)" if mlat else ""))
else:
    out("WARN" if rate else "FAIL", "No aircraft heard in the last minute")

if pos and lat is not None:
    dists = sorted(((nm(lat, lon, a["lat"], a["lon"]), a) for a in pos), key=lambda x: x[0])
    far = dists[-1][0]
    verdict = "" if len(pos) < 5 else ("  (excellent)" if far > 150 else "  (good)" if far > 80 else "  (fair; a higher antenna helps)" if far > 30 else "  (short; check the antenna)")
    out("INFO", f"Farthest position: {far:.0f} nm{verdict}")
    out("INFO", "Closest aircraft:")
    for d, a in dists[:6]:
        alt = a.get("alt_baro", a.get("altitude", "?"))
        cs = (a.get("flight") or "").strip() or a.get("hex", "?")
        rssi = a.get("rssi")
        print(f"           {cs:<9} {d:5.1f} nm  {str(alt):>6} ft" + (f"  {rssi:.1f} dBFS" if isinstance(rssi, (int, float)) else ""))
elif planes:
    out("INFO", "Aircraft heard:")
    for a in planes[:6]:
        cs = (a.get("flight") or "").strip() or a.get("hex", "?")
        print(f"           {cs:<9} {str(a.get('alt_baro', a.get('altitude', '?'))):>6} ft  messages {a.get('messages', '?')}")

st = load("stats.json") or {}
m = st.get("last1min") or st.get("last5min") or {}
loc = m.get("local") or {}
msgs = m.get("messages") or 0
sig, noise, peak, strong = loc.get("signal"), loc.get("noise"), loc.get("peak_signal"), loc.get("strong_signals")
if sig is not None or noise is not None:
    parts = [f"{k} {v:.1f} dBFS" for k, v in (("signal", sig), ("noise", noise), ("peak", peak)) if isinstance(v, (int, float))]
    out("INFO", "Last minute: " + ", ".join(parts))
if isinstance(strong, (int, float)) and msgs:
    pct = 100 * strong / msgs
    if pct > 5:
        out("WARN", f"{pct:.1f}% of messages are very strong (> -3 dBFS): the gain is probably too high")
        out("HINT", "Lower it a step, e.g. sudo piaware-config rtlsdr-gain 42 && sudo systemctl restart dump1090-fa")
    else:
        out("PASS", f"Gain looks sensible ({pct:.1f}% strong signals, under 5%)")
if isinstance(noise, (int, float)) and noise > -20:
    out("WARN", f"Noise floor is high ({noise:.1f} dBFS): nearby interference or gain too high")
PY
)
fi

# ---------------------------------------------------------------------------------
section "Summary"
echo "  ${G}${NPASS} passed${N}, ${Y}${NWARN} warnings${N}, ${R}${NFAIL} failed${N}"
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$ip" ]; then
  echo "  Live map: http://$ip/skyaware/  (PiAware)  or  http://$ip:8080/  /  http://$ip/tar1090/"
  if [ -n "$src" ] && [ "${src#http}" != "$src" ]; then
    echo "  For CloudWall, add this to [source] urls in config.toml: \"${src/127.0.0.1/$ip}/aircraft.json\""
  elif [ -n "$src" ]; then
    echo "  For CloudWall, add the decoder's aircraft.json URL (e.g. \"http://$ip/skyaware/data/aircraft.json\") to [source] urls"
  fi
fi
[ "$NFAIL" -gt 0 ] && exit 2
[ "$NWARN" -gt 0 ] && exit 1
exit 0
