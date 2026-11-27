#!/usr/bin/env bash
# pi-tunnel.sh: the receiver-Pi half of the CloudWall feed tunnel. RUN IT ON THE RECEIVER PI ONLY
# (the machine running adsb.im / readsb); its partner vps-tunnel.sh runs on the VPS.
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
#
# keygen and install check that this machine is a receiver; --force skips that check.

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

# Is this the receiver? Its aircraft data, adsb.im, a decoder service or container. The partner
# script runs on the VPS, and running this one there by mistake is easy (both are in the repo).
is_receiver() {
  curl -fsm 3 "http://127.0.0.1:${1:-8080}/data/aircraft.json" -o /dev/null 2>/dev/null && return 0
  [ -d /opt/adsb ] && return 0
  systemctl list-unit-files dump1090-fa.service readsb.service 2>/dev/null | grep -qE '^(dump1090-fa|readsb)\.service' && return 0
  command -v docker >/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -qiE 'ultrafeeder|readsb' && return 0
  return 1
}

check_receiver() {   # lport force
  is_receiver "$1" && return 0
  [ "$2" = 1 ] && { warn "this machine doesn't look like an ADS-B receiver; carrying on (--force)"; return 0; }
  warn "This machine ($(hostname)) doesn't look like the ADS-B receiver: no aircraft data on"
  warn "port $1, no adsb.im, no readsb or dump1090 service or container."
  warn "pi-tunnel.sh belongs on the RECEIVER PI. On the VPS, use vps-tunnel.sh instead."
  if [ -t 0 ]; then
    read -r -p "  Carry on here anyway? [y/N] " a
    [[ "$a" =~ ^[Yy] ]] && return 0
  fi
  die "stopped. (If this really is the receiver, rerun with --force.)"
}

ensure_user() {
  if ! id "$LUSER" >/dev/null 2>&1; then
    useradd --system --home-dir "/var/lib/$LUSER" --create-home --shell "$(nologin)" "$LUSER"
    ok "created local system user '$LUSER' (no login shell) to run the tunnel"
  fi
}

cmd_keygen() {
  need_root
  local force=0; [ "${1:-}" = "--force" ] && force=1
  check_receiver 8080 "$force"
  ensure_user
  install -d -m 750 -o root -g "$LUSER" "$CONF_DIR"
  if [ -e "$KEY" ]; then
    ok "key already exists at $KEY (keeping it)"
  else
    ssh-keygen -q -t ed25519 -N "" -C "adsb-tunnel@$(hostname)" -f "$KEY"
    ok "created key $KEY"
  fi
  chown "$LUSER":"$LUSER" "$KEY" "$KEY.pub"; chmod 600 "$KEY"; chmod 644 "$KEY.pub"
  say ""
  say "NEXT: on the VPS (not this machine, '$(hostname)'), from your CloudWall folder, run this"
  say "whole line, exactly as printed (the key is public, so it's safe to copy):"
  say ""
  say "  sudo bash deploy/feed-tunnel/vps-tunnel.sh setup \"$(cat "$KEY.pub")\""
  say ""
}

ssh_args() {   # host port ruser rport lport
  # -F /dev/null: ignore the system's ssh_config. Every option the tunnel needs is set here, and a
  # bad line there (adsb.im images have shipped "IPQoS 0x00", which newer OpenSSH refuses) would
  # otherwise stop ssh from starting at all.
  printf '%s\n' -F /dev/null -N -i "$KEY" -p "$2" \
    -o BatchMode=yes -o IdentitiesOnly=yes \
    -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
    -R "127.0.0.1:$4:127.0.0.1:$5" "$3@$1"
}

cmd_install() {
  need_root
  local host="" port=22 ruser=adsbtunnel rport=18080 lport=8080 fp="" force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="$2"; shift 2;;
      --remote-user) ruser="$2"; shift 2;;
      --remote-port) rport="$2"; shift 2;;
      --local-port) lport="$2"; shift 2;;
      --fingerprint) fp="$2"; shift 2;;
      --force) force=1; shift;;
      -*) die "unknown option $1";;
      *) host="$1"; shift;;
    esac
  done
  [ -n "$host" ] || die "usage: pi-tunnel.sh install VPS_HOST [--port 22] [--fingerprint SHA256:...]"
  [ -e "$KEY" ] || die "no key yet: run 'sudo bash pi-tunnel.sh keygen' first"
  check_receiver "$lport" "$force"
  ensure_user
  # a short name (like a VPS's own hostname "ubuntu") usually means nothing from home
  if ! getent ahosts "$host" >/dev/null 2>&1; then
    die "this Pi can't look up '$host'. Use the VPS's public IP address or full domain name (what you type to ssh to it from home)."
  fi

  say "1. Local data"
  if curl -fsm 5 "http://127.0.0.1:$lport/data/aircraft.json" -o /dev/null; then
    ok "this Pi serves aircraft.json on port $lport"
  else
    warn "nothing answers at http://127.0.0.1:$lport/data/aircraft.json (is ultrafeeder running?); continuing"
  fi

  say "2. The VPS's identity"
  local scan; scan=$(mktemp)
  ssh-keyscan -T 10 -p "$port" "$host" 2>/dev/null | grep -v '^#' > "$scan" || true
  if [ ! -s "$scan" ]; then
    rm -f "$scan"
    warn "no SSH answer from $host port $port. Check, in order:"
    warn " - the address: the VPS's public IP or domain (try: ssh -p $port you@$host from home)"
    warn " - the port: add --port N if the VPS's SSH isn't on 22"
    warn " - the provider's firewall, set in their web panel, separate from the server (e.g. IONOS:"
    warn "   Cloud Panel > Network > Firewall Policies): it must allow TCP $port from your home"
    die "can't reach SSH on $host port $port from this Pi"
  fi
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
    sed 's/^/    /' "$err"
    explain_failure "$(cat "$err")" "$host" "$port"
    rm -f "$err"
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
    say "NEXT: on the VPS, from your CloudWall folder:"
    say "  bash deploy/feed-tunnel/vps-tunnel.sh test"
  else
    journalctl -u "$SVC" -n 15 --no-pager | sed 's/^/    /'
    die "service didn't stay up (log above)"
  fi
}

# What a failed test connection's error means, and what to do about it.
explain_failure() {   # error-text host port
  local e="$1"
  case "$e" in
    *"Permission denied"*)
      warn "The VPS refused this Pi's key. On the VPS, authorise exactly this key (from this Pi):"
      say  "         sudo bash deploy/feed-tunnel/vps-tunnel.sh setup \"$(cat "$KEY.pub")\""
      warn "and read setup's warnings (AllowUsers, AllowTcpForwarding).";;
    *"remote port forwarding failed"*)
      warn "The VPS refused the port. Either the --remote-port here differs from the one used with"
      warn "'vps-tunnel.sh setup', or an earlier tunnel still holds it: wait 2 minutes and retry.";;
    *"Host key verification failed"*|*"REMOTE HOST IDENTIFICATION HAS CHANGED"*)
      warn "The VPS's identity doesn't match what was saved. Confirm its fingerprint on the VPS"
      warn "(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) and rerun install with --fingerprint.";;
    *"Connection refused"*)
      warn "Nothing accepts SSH on $2 port $3: wrong port? (add --port N)";;
    *"timed out"*|*"No route to host"*|*"Network is unreachable"*)
      warn "No answer from $2: check the address and the provider's firewall (allow TCP $3 from home).";;
    *"Could not resolve"*)
      warn "This Pi can't look up '$2': use the VPS's public IP address.";;
    *"Bad "*"value"*|*"bad configuration option"*)
      warn "A system SSH setting on this Pi is invalid. This script ignores that file, so this"
      warn "copy of pi-tunnel.sh is old: download it again and rerun install.";;
  esac
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
    rm -rf "$CONF_DIR"
    ok "deleted $CONF_DIR (key, host keys, settings)"
    # the VPS's tunnel account has the same name: if this is the VPS (run here by mistake),
    # leave that account alone
    if [ -e "/var/lib/$LUSER/.ssh/authorized_keys" ]; then
      say "  Kept user '$LUSER': it holds the VPS side's authorized_keys (vps-tunnel.sh setup)."
    else
      userdel -r "$LUSER" 2>/dev/null || true
      ok "deleted local user '$LUSER'"
      say "  Also remove this Pi's key on the VPS: sudo bash deploy/feed-tunnel/vps-tunnel.sh remove"
    fi
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
