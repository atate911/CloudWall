#!/bin/bash
# runs inside the systemd container, as root
set -u
K=tafo-kemi-luza-nobe; B=http://localhost:5050/k/$K
say() { printf '\n===== %s\n' "$*"; }
say "A. the old setup: make service from main, settings in the checkout"
cd /home/ubuntu/CloudWall
mkdir -p /home/ubuntu/.config/systemd/user
sed "s|@DIR@|/home/ubuntu/CloudWall|g; s|ExecStart=.*|ExecStart=/usr/bin/python3 -m cloudwall|" deploy/cloudwall.service > /home/ubuntu/.config/systemd/user/cloudwall.service
chown -R ubuntu:ubuntu /home/ubuntu; loginctl enable-linger ubuntu; sleep 2
systemctl --user -M ubuntu@ daemon-reload; systemctl --user -M ubuntu@ enable --now cloudwall 2>/dev/null; sleep 5
echo "old service: $(systemctl --user -M ubuntu@ is-active cloudwall)"
sudo -u ubuntu sqlite3 /home/ubuntu/.local/share/cloudwall/cloudwall.db "INSERT INTO sightings(ts,day,hex,callsign,type) VALUES (1.7e9,'2026-11-20','a1b2c3','ASA512','B738')"
say "B. git pull (the new code into the checkout; the old service still running)"
find . -mindepth 1 -maxdepth 1 ! -name config.toml -exec rm -rf {} +
tar -x -C /home/ubuntu -f /tmp/new.tar; chown -R ubuntu:ubuntu /home/ubuntu/CloudWall
say "C. sudo python3 -m cloudwall upgrade"
python3 -m cloudwall upgrade 2>&1 | sed -n '1,/^$/p' | head -30
echo "system service: $(systemctl is-active cloudwall), old user service: $(systemctl --user -M ubuntu@ is-active cloudwall)/$(systemctl --user -M ubuntu@ is-enabled cloudwall)"
echo "logbook moved: $(sqlite3 /var/lib/cloudwall/cloudwall.db 'select group_concat(callsign) from sightings')"
echo "key moved: $(grep -c $K /etc/cloudwall/config.toml)"; systemctl show cloudwall -p Type -p WatchdogUSec -p StatusText | tr '\n' ' '; echo
curl -s -o /dev/null -w "board through the private link: %{http_code}\n" $B/api/state
say "D. upgrade again: nothing to move"
python3 -m cloudwall upgrade 2>&1 | grep -E "Found|Moving|copy logbook|port|Nothing|Updated" 
echo "service: $(systemctl is-active cloudwall)"
say "E. the owner, and the board from a browser's point of view"
PYTHONPATH=/opt/cloudwall/current CLOUDWALL_CONFIG=/etc/cloudwall/config.toml python3 -c "from cloudwall.core import keys; keys.set_password('correct horse battery')"
ls -l /etc/cloudwall/owner
J=/tmp/jar; rm -f $J
curl -s -c $J -H 'Content-Type: application/json' -d '{"password":"correct horse battery"}' $B/api/admin/signin; echo
curl -s -b $J -H 'Content-Type: application/json' -d '{"section":"tracking","key":"radius_nm","value":"16"}' $B/api/admin/settings; echo
grep radius_nm /etc/cloudwall/config.toml; ls -l /etc/cloudwall/config.toml
curl -s -b $J -H 'Content-Type: application/json' -d '{}' $B/api/admin/backups; echo
R=$(curl -s -b $J -H 'Content-Type: application/json' -d '{"name":"enable-service"}' $B/api/admin/repair); echo "$R"
RID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('request',''))")
for i in $(seq 1 15); do sleep 1; D=$(curl -s -b $J $B/api/admin/requests/$RID); echo "$D" | grep -q '"done": true' && break; done; echo "helper: $D"
sleep 5; echo "helper path unit: $(systemctl is-active cloudwall-helper.path); helper runs: $(journalctl -u cloudwall-helper.service --no-pager -o cat | grep -c 'helper:')"
say "F. restart from the board (systemd brings it back)"
N0=$(systemctl show cloudwall -p NRestarts --value)
curl -s -b $J -H 'Content-Type: application/json' -d '{}' $B/api/admin/restart; echo
sleep 9; echo "service: $(systemctl is-active cloudwall), restarts: $N0 -> $(systemctl show cloudwall -p NRestarts --value)"
curl -s -b $J $B/api/admin/whoami; echo "   (the session survived the restart)"
say "G. the watchdog: three minutes running"
sleep ${WAIT:-180}; echo "service: $(systemctl is-active cloudwall), restarts: $(systemctl show cloudwall -p NRestarts --value), watchdog kills: $(journalctl -u cloudwall --no-pager | grep -ci watchdog)"
journalctl -u cloudwall --no-pager -o cat | grep -E "Traceback|Error|error" | grep -v "Connection refused\|urlopen\|isn't answering\|no positions\|problem" | head -5
say "H. an update, then rollback"
echo "# a change" >> /home/ubuntu/CloudWall/cloudwall/__init__.py
python3 -m cloudwall upgrade >/dev/null 2>&1; echo "now: $(readlink /opt/cloudwall/current) ($(systemctl is-active cloudwall))"
cloudwall rollback; sleep 3; echo "after rollback: $(readlink /opt/cloudwall/current) ($(systemctl is-active cloudwall))"
say "I. doctor without and with sudo"
sudo -u ubuntu cloudwall doctor --offline 2>&1 | grep -E "^\[" | head -4
cloudwall doctor --offline 2>&1 | grep -E "^\[(warn|FAIL)"
