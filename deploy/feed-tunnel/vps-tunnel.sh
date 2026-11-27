#!/usr/bin/env bash
# vps-tunnel.sh: the VPS half of the CloudWall feed tunnel.
#
# Creates a locked-down SSH account that the receiver Pi logs in to. Its key can do exactly one
# thing: open 127.0.0.1:18080 on this VPS, leading back to the Pi's aircraft data. No shell,
# no other forwarding, nothing new open to the internet. Read README.md in this folder first.
#
#   sudo bash vps-tunnel.sh setup "ssh-ed25519 AAAA... adsb-tunnel@pi"   # 2. authorise the Pi's key
#        [--remote-port 18080]
#   bash vps-tunnel.sh test        [--remote-port 18080]   # 4. is the Pi's data arriving?
#   bash vps-tunnel.sh cloudwall   [--remote-port 18080] [--config PATH]
#                                                         # 5. put the Pi first in CloudWall's feeds
#                                                         #    (run as the user that runs CloudWall)
#   bash vps-tunnel.sh cloudwall-remove [--remote-port 18080] [--config PATH]
#   bash vps-tunnel.sh status      [--remote-port 18080]
#   sudo bash vps-tunnel.sh remove                         # delete the account and its key

set -euo pipefail

TUSER="${TUSER:-adsbtunnel}"
THOME="${THOME:-/var/lib/$TUSER}"
RPORT=18080
CONFIG=""

say()  { printf '%s\n' "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
die()  { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run with sudo"; }
nologin() { for n in /usr/sbin/nologin /sbin/nologin /bin/false; do [ -x "$n" ] && { echo "$n"; return; }; done; }
feed_url() { echo "http://127.0.0.1:$RPORT/data/aircraft.json"; }

parse_opts() {
  ARGS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --remote-port) RPORT="$2"; shift 2;;
      --config) CONFIG="$2"; shift 2;;
      *) ARGS+=("$1"); shift;;
    esac
  done
}

cmd_setup() {
  need_root
  local key="${ARGS[0]:-}"
  [ -n "$key" ] || die "usage: sudo bash vps-tunnel.sh setup \"ssh-ed25519 AAAA... comment\""
  local tmp; tmp=$(mktemp); printf '%s\n' "$key" > "$tmp"
  ssh-keygen -lf "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; die "that isn't a valid public key line (copy the whole line from pi-tunnel.sh keygen)"; }
  rm -f "$tmp"

  say "1. OpenSSH"
  local v; v=$(ssh -V 2>&1 | sed -nE 's/^OpenSSH_([0-9]+)\.([0-9]+).*/\1 \2/p')
  if [ -n "$v" ] && { read -r maj min <<<"$v"; [ "$maj" -gt 7 ] || { [ "$maj" -eq 7 ] && [ "$min" -ge 8 ]; }; }; then
    ok "OpenSSH $maj.$min supports permitlisten"
  else
    warn "couldn't confirm OpenSSH >= 7.8 ('ssh -V': $(ssh -V 2>&1)); permitlisten needs it"
  fi

  say "2. Tunnel account '$TUSER'"
  if id "$TUSER" >/dev/null 2>&1; then
    ok "account exists"
  else
    useradd --system --create-home --home-dir "$THOME" --shell "$(nologin)" "$TUSER"
    ok "created system account '$TUSER' (no login shell, home $THOME)"
  fi
  usermod -p '*' "$TUSER"     # no password, but not "locked" (a locked account can be refused key logins)
  install -d -m 700 -o "$TUSER" -g "$TUSER" "$THOME/.ssh"
  local ak="$THOME/.ssh/authorized_keys"
  [ -e "$ak" ] && cp -p "$ak" "$ak.bak-$(date +%Y%m%d-%H%M%S)" && ok "backed up the previous authorized_keys"
  {
    echo "# Written by vps-tunnel.sh setup on $(date -Is). One line per key."
    echo "# restrict: no shell, pty, agent or X11.  port-forwarding: re-allow forwarding, then limit it:"
    echo "# permitlisten: the only port the Pi may open here.  permitopen 127.0.0.1:9: an unused port,"
    echo "# so the key can't make connections out to anything on this VPS (blocks ssh -L)."
    printf 'restrict,port-forwarding,permitlisten="127.0.0.1:%s",permitopen="127.0.0.1:9" %s\n' "$RPORT" "$key"
  } > "$ak"
  chown "$TUSER":"$TUSER" "$ak"; chmod 600 "$ak"
  ok "authorised the Pi's key: it may only listen on 127.0.0.1:$RPORT (no shell, no other forwarding)"

  say "3. SSH server settings that could block it"
  if command -v sshd >/dev/null; then
    local t; t=$(sshd -T -C "user=$TUSER,host=pi.invalid,addr=192.0.2.1" 2>/dev/null || true)
    if [ -z "$t" ]; then warn "couldn't read sshd's effective settings (sshd -T)"; else
      local fw; fw=$(awk '$1=="allowtcpforwarding"{print $2}' <<<"$t")
      case "$fw" in yes|all|remote) ok "AllowTcpForwarding $fw";;
        *) warn "AllowTcpForwarding is '$fw': remote forwarding is off. Add to /etc/ssh/sshd_config, then 'sudo sshd -t && sudo systemctl reload ssh':"
           say "         Match User $TUSER"; say "             AllowTcpForwarding remote";; esac
      awk '$1=="disableforwarding" && $2=="yes"{f=1} END{exit !f}' <<<"$t" && warn "DisableForwarding yes: forwarding is off for everyone; add a Match User $TUSER block with DisableForwarding no"
      local au ag; au=$(awk '$1=="allowusers"{$1="";print}' <<<"$t"); ag=$(awk '$1=="allowgroups"{$1="";print}' <<<"$t")
      [ -n "$au" ] && ! grep -qw "$TUSER" <<<"$au" && warn "AllowUsers is set ($au) and doesn't include $TUSER: add it, or the Pi will be refused"
      [ -n "$ag" ] && warn "AllowGroups is set ($ag): make sure $TUSER is in one of those groups"
      awk '$1=="pubkeyauthentication" && $2=="no"{f=1} END{exit !f}' <<<"$t" && warn "PubkeyAuthentication no: key logins are off"
      [ -z "$au$ag" ] && ok "no AllowUsers/AllowGroups restrictions in the way"
    fi
  fi

  say "4. This VPS's host key fingerprints (the Pi will ask you to compare these):"
  for f in /etc/ssh/ssh_host_*_key.pub; do [ -e "$f" ] && ssh-keygen -lf "$f" | sed 's/^/    /'; done
  local ed; ed=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')
  say ""
  say "Next, on the Pi:"
  say "  sudo bash pi-tunnel.sh install $(hostname -f 2>/dev/null || hostname)${ed:+ --fingerprint $ed}"
  say "  (use the VPS's public hostname or IP if that name isn't reachable from your home)"
}

cmd_test() {
  local url; url=$(feed_url)
  if command -v ss >/dev/null; then
    if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qx "127.0.0.1:$RPORT"; then
      ok "something is listening on 127.0.0.1:$RPORT (the tunnel is up)"
    else
      warn "nothing listens on 127.0.0.1:$RPORT: the Pi isn't connected (check 'pi-tunnel.sh status' on the Pi)"
    fi
  fi
  local body; body=$(curl -fsm 8 "$url" 2>/dev/null) || die "no answer from $url"
  python3 -c '
import json, sys, time
d = json.loads(sys.stdin.read()); ac = d.get("aircraft", [])
pos = sum("lat" in a for a in ac); age = time.time() - d.get("now", 0)
print(f"  [OK]   {len(ac)} aircraft, {pos} with positions, data {age:.0f}s old")
if age > 30: print("  [WARN] the data is stale: the decoder on the Pi may have stopped")
' <<<"$body"
}

find_config() {
  [ -n "$CONFIG" ] && { echo "$CONFIG"; return; }
  [ -n "${CLOUDWALL_CONFIG:-}" ] && { echo "$CLOUDWALL_CONFIG"; return; }
  local unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/cloudwall.service" wd
  if [ -e "$unit" ]; then
    wd=$(sed -n 's/^WorkingDirectory=//p' "$unit" | head -1)
    [ -n "$wd" ] && [ -e "$wd/config.toml" ] && { echo "$wd/config.toml"; return; }
  fi
  local u="${XDG_CONFIG_HOME:-$HOME/.config}/cloudwall/config.toml"
  [ -e "$u" ] && { echo "$u"; return; }
  return 1
}

edit_config() {   # add|remove
  if [ "$(id -u)" -eq 0 ] && [ -z "$CONFIG" ]; then
    die "run this as the user that runs CloudWall (not with sudo), or pass --config PATH"
  fi
  local cfg; cfg=$(find_config) || die "couldn't find CloudWall's config.toml; pass --config PATH"
  say "CloudWall config: $cfg"
  python3 - "$cfg" "$(feed_url)" "$1" <<'PY'
import re, shutil, sys, time, tomllib
path, url, mode = sys.argv[1:4]
DEFAULT = ["https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}",
           "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"]
text = open(path).read()
src = tomllib.loads(text).get("source", {})
urls = list(src.get("urls") or DEFAULT)
if src.get("url"):
    urls = [src["url"]] + [u for u in urls if u != src["url"]]
new = [url] + [u for u in urls if u != url] if mode == "add" else ([u for u in urls if u != url] or DEFAULT)
merge = mode == "add" and len(new) > 1        # your receiver alongside the public feeds, combined
if new == urls and not src.get("url") and bool(src.get("merge")) == merge:
    print("  [OK]   nothing to change:", "already first, merged" if mode == "add" else "not present"); sys.exit(0)

block = ["urls = ["] + [f'  "{u}",' for u in new] + ["]"] + (["merge = true"] if merge else [])
lines = text.splitlines()
hdr = next((i for i, l in enumerate(lines) if re.match(r"\s*\[source\]\s*(#.*)?$", l)), None)
if hdr is None:
    out = lines + ["", "[source]               # position feeds, tried in order with automatic failover"] + block
else:
    end = next((i for i in range(hdr + 1, len(lines)) if re.match(r"\s*\[", lines[i])), len(lines))
    body, i = [], hdr + 1
    while i < end:
        l = lines[i]
        if re.match(r"\s*urls\s*=", l):            # drop the old list, however many lines it spans
            depth = l.count("[") - l.count("]")
            while depth > 0 and i + 1 < end:
                i += 1; depth += lines[i].count("[") - lines[i].count("]")
        elif not re.match(r"\s*(url|merge)\s*=", l):
            body.append(l)
        i += 1
    out = lines[:hdr + 1] + block + body + lines[end:]
result = "\n".join(out) + "\n"
got = tomllib.loads(result).get("source", {})
assert got.get("urls") == new and bool(got.get("merge")) == merge, f"rewrite check failed: {got}"
bak = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
shutil.copy2(path, bak)
open(path, "w").write(result)
print(f"  [OK]   backed up to {bak}")
print("  [OK]   [source] urls is now:"); [print("           " + u) for u in new]
print(f"  [OK]   merge = {'true: your receiver and the public feeds combined' if merge else 'off: feeds tried in order'}")
PY
  if systemctl --user is-active --quiet cloudwall 2>/dev/null; then
    systemctl --user restart cloudwall && ok "restarted CloudWall (systemctl --user restart cloudwall)"
    sleep 8
    journalctl --user -u cloudwall -n 30 --no-pager 2>/dev/null | grep -iE "feed|source|127\.0\.0\.1" | tail -5 | sed 's/^/    /' || true
  else
    warn "CloudWall isn't running as a user service here; restart it yourself to pick up the change"
  fi
}

cmd_remove() {
  need_root
  id "$TUSER" >/dev/null 2>&1 || { ok "no '$TUSER' account: nothing to remove"; return; }
  read -r -p "Delete account '$TUSER' and the Pi's key (the tunnel will stop working)? [y/N] " a </dev/tty
  [[ "$a" =~ ^[Yy] ]] || die "cancelled"
  pkill -u "$TUSER" 2>/dev/null || true
  userdel -r "$TUSER" 2>/dev/null || userdel "$TUSER"
  ok "deleted '$TUSER'. Also run 'bash vps-tunnel.sh cloudwall-remove' so CloudWall stops trying the tunnel first."
}

cmd="${1:-}"; shift || true
parse_opts "$@"
case "$cmd" in
  setup) cmd_setup;;
  test) cmd_test;;
  status) id "$TUSER" >/dev/null 2>&1 && ok "account '$TUSER' exists" || warn "no '$TUSER' account (run setup)"; cmd_test;;
  cloudwall) edit_config add;;
  cloudwall-remove) edit_config remove;;
  remove) cmd_remove;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
