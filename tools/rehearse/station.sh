#!/bin/bash
# Rehearse a receiver's station on real systemd, in a container:  bash tools/rehearse/station.sh
# The Pi's own parts are stood in for (vcgencmd, lsusb, a decoder answering, piaware's status, the
# tunnel's service); the station is installed, checked, updated and taken off as on a receiver.
# Needs the image run.sh builds (cloudwall-rehearse). Prints what it found.
set -eu
cd "$(dirname "$0")/../.."
docker rm -f cloudwall-station >/dev/null 2>&1 || true
docker run -d --name cloudwall-station --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --tmpfs /run --tmpfs /run/lock cloudwall-rehearse >/dev/null
trap 'docker rm -f cloudwall-station >/dev/null 2>&1' EXIT
sleep 5
git add -A && NEW=$(git stash create) && git reset -q
git archive --prefix=CloudWall/ "${NEW:-HEAD}" | docker exec -i cloudwall-station tar -x -C /home/ubuntu
docker exec -i cloudwall-station bash -s <<'INSIDE'
set -u
say() { printf '\n== %s ==\n' "$*"; }
# the Pi's parts, stood in for
cat > /usr/local/bin/vcgencmd <<'X'
#!/bin/sh
case "$1" in get_throttled) echo "throttled=0x50000";; measure_temp) echo "temp=61.3'C";; esac
X
cat > /usr/local/bin/lsusb <<'X'
#!/bin/sh
echo "Bus 001 Device 003: ID 0bda:2832 Realtek Semiconductor Corp. RTL2832U DVB-T"
X
chmod 755 /usr/local/bin/vcgencmd /usr/local/bin/lsusb
mkdir -p /opt/decoder /run/piaware
cat > /opt/decoder/serve.py <<'X'
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = {"/data/aircraft.json": {"now": time.time(), "messages": 9, "aircraft": [{"hex": "a", "lat": 45.6, "lon": -122.6}]},
                "/data/stats.json": {"gain_db": 43.9}}.get(self.path)
        self.send_response(200 if body else 404); self.end_headers(); self.wfile.write(json.dumps(body or {}).encode())
HTTPServer(("127.0.0.1", 8080), H).serve_forever()
X
printf '[Service]\nExecStart=/usr/bin/python3 /opt/decoder/serve.py\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/readsb.service
printf '[Service]\nExecStart=/bin/sleep infinity\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/adsb-tunnel.service
echo '{"adept": {"status": "green", "message": "Connected to FlightAware and logged in"}}' > /run/piaware/status.json
systemctl daemon-reload; systemctl enable --now readsb adsb-tunnel >/dev/null 2>&1

cd /home/ubuntu/CloudWall
say "install --role station"
sudo python3 -m cloudwall install --role station 2>&1 | tail -5
sleep 3
say "the service"
systemctl show cloudwall-station -p ActiveState -p SubState -p Type -p User -p NRestarts
say "station.json"
curl -s 127.0.0.1:8095/station.json | python3 -c 'import json,sys; f=json.load(sys.stdin); print({k: f[k] for k in ("throttled","temp_c","sdr","units","decoder","feeders","clock_synced")})'
say "POST refused"
curl -s -X POST 127.0.0.1:8095/station.json; echo
say "cloudwall station --check"
cloudwall station --check; echo "exit $?"
say "cloudwall doctor"
cloudwall doctor; echo "exit $?"
say "upgrade on a receiver"
sudo python3 -m cloudwall upgrade 2>&1 | tail -4
ls /etc/systemd/system/cloudwall.service /etc/cloudwall/config.toml 2>&1 | sed 's/^/  /'
systemctl is-active cloudwall-station
say "uninstall --role station"
sudo cloudwall uninstall --role station 2>&1 | tail -3
systemctl is-active cloudwall-station; ls /opt/cloudwall /usr/local/bin/cloudwall 2>&1 | sed 's/^/  /'
INSIDE
docker exec -i cloudwall-station bash -s <<'INSIDE'
set -u
say() { printf '\n== %s ==\n' "$*"; }
cd /home/ubuntu/CloudWall
say "a wall and a station on one machine; the station joins the wall"
sudo python3 -m cloudwall install --role wall >/dev/null 2>&1; sudo python3 -m cloudwall install --role station >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf 127.0.0.1:5050/api/admin/whoami >/dev/null && break; sleep 1; done
CODE=$(curl -s -X POST -H 'Content-Type: application/json' -d '{}' 127.0.0.1:5050/api/admin/stations/code | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
sudo cloudwall station join http://127.0.0.1:5050 "$CODE" --name "Rehearsal Pi"
ls -l /etc/cloudwall/station.toml | awk '{print "  " $1, $3, $4}'
sleep 8
curl -s 127.0.0.1:5050/api/admin/stations | python3 -c 'import json,sys; s=json.load(sys.stdin)["stations"][0]; print("  ", s["name"], "seen" if s["seen"] else "never", s["desired"]["jobs"])'
say "the board gives the stick to the radio, with channels"
SID=$(curl -s 127.0.0.1:5050/api/admin/stations | python3 -c 'import json,sys; print(json.load(sys.stdin)["stations"][0]["id"])')
curl -s -X POST -H 'Content-Type: application/json' -d '{"section":"radio","key":"channels","value":["118.700 PDX Tower","119.000 Approach"]}' 127.0.0.1:5050/api/admin/settings >/dev/null
curl -s -X POST -H 'Content-Type: application/json' -d '{"jobs":{"0bda:2832":"vhf"}}' 127.0.0.1:5050/api/admin/stations/$SID | python3 -c 'import json,sys; print("  ", json.load(sys.stdin)["said"])'
sudo systemctl restart cloudwall-station; sleep 8
ls -l /var/lib/cloudwall/station/ | sed 's/^/  /'
head -8 /var/lib/cloudwall/station/rtl_airband.conf | sed 's/^/  /'
systemctl show cloudwall-station -p NRestarts -p ActiveState
journalctl -u cloudwall-station -n 4 --no-pager -o cat | sed 's/^/  /'
INSIDE
