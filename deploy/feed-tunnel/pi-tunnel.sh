#!/usr/bin/env bash
# pi-tunnel.sh: the receiver-Pi half of the CloudWall feed tunnel.
#
# The Pi keeps an outgoing SSH connection open to the CloudWall VPS. On the VPS, the port
# 127.0.0.1:18080 (reachable only from the VPS itself) leads back through it to this Pi's
# readsb/tar1090 data on 127.0.0.1:8080. Nothing is opened on the home network.
# Read README.md in this folder for the full explanation.
#
#   sudo bash pi-tunnel.sh keygen                 # 1. make the key; prints the line to give the VPS
#   sudo bash pi-tunnel.sh install VPS_HOST       # 3. after vps-tunnel.sh setup: verify, test, start
#        [--port 22] [--remote-user adsbtunnel] [--remote-port 18080] [--local-port 8080]
#        [--fingerprint SHA256:...]               #    (fingerprint printed by vps-tunnel.sh setup)
#   sudo bash pi-tunnel.sh status                 # is it up? recent log lines
#   sudo bash pi-tunnel.sh restart
#   sudo bash pi-tunnel.sh uninstall [--purge]    # stop and remove (--purge also deletes key and user)

set -euo pipefail

CONF_DIR="${CONF_DIR:-/etc/adsb-tunnel}"
KEY="$CONF_DIR/id_ed25519"
KNOWN="$CONF_DIR/known_hosts"
CONF="$CONF_DIR/tunnel.conf"
UNIT="${UNIT:-/etc/systemd/system/adsb-tunnel.service}"
SVC="adsb-tunnel"
LUSER="${LUSER:-adsbtunnel}"          # local system user on the Pi that runs ssh

say()  { printf '%s\n' "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
die()  { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run with sudo"; }
nologin() { for n in /usr/sbin/nologin /sbin/nologin /bin/false; do [ -x "$n" ] && { echo "$n"; return; }; done; }

ensure_user() {
  if ! id "$LUSER" >/dev/null 2>&1; then
    useradd --system --home-dir "/var/lib/$LUSER" --create-home --shell "$(nologin)" "$LUSER"
    ok "created local system user '$LUSER' (no login shell) to run the tunnel"
  fi
}

cmd_keygen() {
  need_root; ensure_user
  install -d -m 750 -o root -g "$LUSER" "$CONF_DIR"
  if [ -e "$KEY" ]; then
    ok "key already exists at $KEY (keeping it)"
  else
    ssh-keygen -q -t ed25519 -N "" -C "adsb-tunnel@$(hostname)" -f "$KEY"
    ok "created key $KEY"
  fi
  chown "$LUSER":"$LUSER" "$KEY" "$KEY.pub"; chmod 600 "$KEY"; chmod 644 "$KEY.pub"
  say ""
  say "Next, on the VPS, run (copy the whole quoted line):"
  say ""
  say "  sudo bash vps-tunnel.sh setup \"$(cat "$KEY.pub")\""
  say ""
}

ssh_args() {   # host port ruser rport lport
  printf '%s\n' -N -i "$KEY" -p "$2" \
    -o BatchMode=yes -o IdentitiesOnly=yes \
    -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
    -R "127.0.0.1:$4:127.0.0.1:$5" "$3@$1"
}

cmd_install() {
  need_root
  local host="" port=22 ruser=adsbtunnel rport=18080 lport=8080 fp=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="$2"; shift 2;;
      --remote-user) ruser="$2"; shift 2;;
      --remote-port) rport="$2"; shift 2;;
      --local-port) lport="$2"; shift 2;;
      --fingerprint) fp="$2"; shift 2;;
      -*) die "unknown option $1";;
      *) host="$1"; shift;;
    esac
  done
  [ -n "$host" ] || die "usage: pi-tunnel.sh install VPS_HOST [--port 22] [--fingerprint SHA256:...]"
  [ -e "$KEY" ] || die "no key yet: run 'sudo bash pi-tunnel.sh keygen' first"
  ensure_user

  say "1. Local data"
  if curl -fsm 5 "http://127.0.0.1:$lport/data/aircraft.json" -o /dev/null; then
    ok "this Pi serves aircraft.json on port $lport"
  else
    warn "nothing answers at http://127.0.0.1:$lport/data/aircraft.json (is ultrafeeder running?); continuing"
  fi

  say "2. The VPS's identity"
  local scan; scan=$(mktemp)
  ssh-keyscan -T 10 -p "$port" "$host" 2>/dev/null | grep -v '^#' > "$scan" || true
  [ -s "$scan" ] || { rm -f "$scan"; die "can't reach SSH on $host port $port from this Pi"; }
  say "  The VPS presents these host keys:"
  ssh-keygen -lf "$scan" | sed 's/^/    /'
  if [ -n "$fp" ]; then
    ssh-keygen -lf "$scan" | grep -qF "$fp" || { rm -f "$scan"; die "none of them matches $fp: don't continue (wrong host, or something in the way)"; }
    ok "matches the fingerprint you gave"
  else
    say "  Compare with the fingerprints 'vps-tunnel.sh setup' printed on the VPS."
    read -r -p "  Do they match? [y/N] " a </dev/tty
    [[ "$a" =~ ^[Yy] ]] || { rm -f "$scan"; die "stopped: fingerprints not confirmed"; }
  fi
  install -m 644 -o root -g "$LUSER" "$scan" "$KNOWN"; rm -f "$scan"
  ok "saved the VPS's host keys to $KNOWN"

  say "3. Test connection (8 seconds)"
  mapfile -t args < <(ssh_args "$host" "$port" "$ruser" "$rport" "$lport")
  local err; err=$(mktemp); local rc=0
  timeout 8 runuser -u "$LUSER" -- ssh "${args[@]}" 2>"$err" || rc=$?
  if [ "$rc" -eq 124 ]; then
    ok "connected, and the VPS accepted the port forward"
  else
    sed 's/^/    /' "$err"; rm -f "$err"
    die "the test connection failed (see above; README.md has a troubleshooting table)"
  fi
  rm -f "$err"

  say "4. Service"
  cat > "$CONF" <<EOF
# Written by pi-tunnel.sh install on $(date -Is). For reference; the service unit holds the live values.
VPS_HOST=$host
VPS_SSH_PORT=$port
VPS_USER=$ruser
VPS_LISTEN=127.0.0.1:$rport
PI_TARGET=127.0.0.1:$lport
EOF
  {
    echo "# Written by pi-tunnel.sh. CloudWall feed: VPS 127.0.0.1:$rport -> this Pi 127.0.0.1:$lport"
    echo "[Unit]"
    echo "Description=CloudWall feed tunnel (VPS 127.0.0.1:$rport -> Pi 127.0.0.1:$lport)"
    echo "After=network-online.target"
    echo "Wants=network-online.target"
    echo ""
    echo "[Service]"
    echo "User=$LUSER"
    printf 'ExecStart=/usr/bin/ssh'; printf ' %s' "${args[@]}"; echo
    echo "Restart=always"
    echo "RestartSec=15"
    echo "NoNewPrivileges=yes"
    echo "PrivateTmp=yes"
    echo "ProtectSystem=full"
    echo ""
    echo "[Install]"
    echo "WantedBy=multi-user.target"
  } > "$UNIT"
  if [ -n "${NO_SYSTEMD:-}" ]; then ok "wrote $UNIT (NO_SYSTEMD set: not starting it)"; return; fi
  systemctl daemon-reload
  systemctl enable --now "$SVC" >/dev/null 2>&1
  systemctl restart "$SVC"
  sleep 5
  if systemctl is-active --quiet "$SVC"; then
    ok "service '$SVC' is running and will start at every boot"
    say ""
    say "Next, on the VPS:  bash vps-tunnel.sh test"
  else
    journalctl -u "$SVC" -n 15 --no-pager | sed 's/^/    /'
    die "service didn't stay up (log above)"
  fi
}

cmd_status() {
  [ -e "$CONF" ] && { say "Settings ($CONF):"; grep -v '^#' "$CONF" | sed 's/^/  /'; }
  systemctl is-active --quiet "$SVC" && ok "service is running" || warn "service is NOT running"
  journalctl -u "$SVC" -n 10 --no-pager 2>/dev/null | sed 's/^/  /' || true
}

cmd_uninstall() {
  need_root
  systemctl disable --now "$SVC" 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload 2>/dev/null || true
  ok "stopped and removed the service"
  if [ "${1:-}" = "--purge" ]; then
    rm -rf "$CONF_DIR"; userdel -r "$LUSER" 2>/dev/null || true
    ok "deleted $CONF_DIR (key, host keys, settings) and user '$LUSER'"
    say "  Also remove the key on the VPS: sudo bash vps-tunnel.sh remove"
  else
    say "  Key and settings kept in $CONF_DIR (use --purge to delete them)."
  fi
}

case "${1:-}" in
  keygen) shift; cmd_keygen "$@";;
  install) shift; cmd_install "$@";;
  status) cmd_status;;
  restart) need_root; systemctl restart "$SVC"; sleep 3; cmd_status;;
  uninstall) shift; cmd_uninstall "$@";;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
