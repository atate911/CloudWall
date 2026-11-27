# Feeding CloudWall from your own ADS-B receiver

This folder connects a home ADS-B receiver (a Raspberry Pi running adsb.im / readsb) to a
CloudWall server running on a VPS, **without opening any ports on your home network**.
Keep this document: it explains what was set up, where every piece lives, and how to check,
change, rebuild or remove it.

---

## 1. The idea in one paragraph

The receiver Pi sits behind your home router's NAT, so the VPS can't reach it, and we don't want
to open a port to let it. Instead, the **Pi dials out** to the VPS over SSH (outgoing connections
already work from home) and keeps that connection open. Over it, SSH carries a **reverse port
forward**: on the VPS, the address `127.0.0.1:18080` leads back down the connection to the Pi's
own `127.0.0.1:8080`, where tar1090 serves the live aircraft data. CloudWall on the VPS then reads
`http://127.0.0.1:18080/data/aircraft.json` as if the receiver were on the same machine.

```
 HOME (behind NAT, nothing opened)                       VPS (internet)
┌──────────────────────────────────┐                 ┌───────────────────────────────────┐
│ Receiver Pi                      │                 │                                   │
│                                  │   outgoing SSH  │  sshd (port 22, already open)     │
│  adsb-tunnel.service ────────────┼────────────────▶│   └ account "adsbtunnel"          │
│  (ssh as local user adsbtunnel)  │  (Pi connects)  │       key may ONLY open:          │
│                                  │                 │       127.0.0.1:18080             │
│  ultrafeeder container           │                 │             │                     │
│   tar1090 on 127.0.0.1:8080 ◀────┼── forwarded ────┼─────────────┘                     │
│   /data/aircraft.json            │   back through  │  CloudWall reads                  │
│                                  │   the tunnel    │  http://127.0.0.1:18080/data/...  │
└──────────────────────────────────┘                 └───────────────────────────────────┘
```

## 2. Why this way (and what it protects)

| Concern | How it's handled |
|---|---|
| Opening home ports | None. The Pi only makes an outgoing connection, like a browser does. |
| Opening VPS ports | None new. It uses the VPS's existing SSH. Port 18080 listens on `127.0.0.1` only, so the internet can't reach it. |
| If the Pi's key is stolen | It can't open a shell or run commands on the VPS, can't connect to anything on the VPS, and can open only the one local port `127.0.0.1:18080`. Enforced by the options on its line in `authorized_keys` (section 5). |
| If the VPS is compromised | An attacker could read your aircraft map (tar1090 on the Pi's port 8080). Nothing else on the Pi or your home network is reachable through the tunnel: not adsb.im's setup page (port 80), not SSH, not other devices. |
| A fake VPS (someone intercepting) | The Pi checks the VPS's SSH host key against a fingerprint you confirmed once. If it ever changes, the Pi refuses to connect. |
| The Pi runs as root? | No. The tunnel runs as an unprivileged system user `adsbtunnel` on the Pi, with no login shell. |
| Outages | The service reconnects by itself every 15 s after internet drops, Pi reboots or VPS reboots. If the tunnel is down, CloudWall carries on with the public feed alone (adsb.fi, then adsb.lol) and picks your receiver up again when it's back. |

## 3. What runs where

### On the receiver Pi

| Thing | Location | Purpose |
|---|---|---|
| Local user `adsbtunnel` | system account, home `/var/lib/adsbtunnel`, no login shell | Runs the tunnel so it isn't root |
| SSH key pair | `/etc/adsb-tunnel/id_ed25519` (private, mode 600) and `.pub` | The Pi's identity on the VPS. **Never copy the private key anywhere.** |
| VPS host keys | `/etc/adsb-tunnel/known_hosts` | What the real VPS looks like; the Pi refuses any other |
| Settings note | `/etc/adsb-tunnel/tunnel.conf` | Human-readable record of host, ports and user (the unit holds the live values) |
| Service | `/etc/systemd/system/adsb-tunnel.service` | Starts the tunnel at boot and restarts it if it drops |
| Script | `pi-tunnel.sh` | Creates all of the above |

The service runs this command (the values are filled in by the script):
```
/usr/bin/ssh -F /dev/null -N -i /etc/adsb-tunnel/id_ed25519 -p 22 \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=/etc/adsb-tunnel/known_hosts -o StrictHostKeyChecking=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
  -R 127.0.0.1:18080:127.0.0.1:8080 adsbtunnel@VPS_HOST
```
- `-F /dev/null`: ignore the Pi's system-wide `/etc/ssh/ssh_config`; every option needed is on
  this line. (Some adsb.im images ship `IPQoS 0x00` there, which newer OpenSSH rejects, stopping
  every ssh command with "Bad IPQoS value".)
- `-N`: no remote command; just the connection.
- `-R 127.0.0.1:18080:127.0.0.1:8080`: on the VPS, listen on 127.0.0.1:18080 and send those
  connections back to this Pi's 127.0.0.1:8080.
- `BatchMode`, `StrictHostKeyChecking`: never prompt; refuse an unknown or changed VPS.
- `ServerAlive…`: notice a dead connection within about 90 s, so systemd reconnects.
- `ExitOnForwardFailure`: if the VPS refuses the forward, exit (and retry) instead of sitting idle.

Nothing in adsb.im or its containers is changed.

### On the VPS

| Thing | Location | Purpose |
|---|---|---|
| Account `adsbtunnel` | system account, home `/var/lib/adsbtunnel`, no login shell, no password | The only account the Pi can log in to |
| Authorised key | `/var/lib/adsbtunnel/.ssh/authorized_keys` | The Pi's public key, with restrictions (section 5) |
| CloudWall config | your `config.toml`, `[source] urls` | The tunnel's address is put first; the public feeds stay as backups. A dated backup is made on every change. |
| Script | `vps-tunnel.sh` | Creates the account and key entry, tests, and edits CloudWall's config |

Nothing else changes on the VPS: no new open ports, and no changes to `sshd_config`.

## 4. Setting it up with the scripts

Copy `pi-tunnel.sh` to the Pi and `vps-tunnel.sh` to the VPS (or download them from this
repository). The steps go back and forth once, because each side needs something from the other.

**Step 1, on the Pi: create the key**
```bash
sudo bash pi-tunnel.sh keygen
```
It creates the `adsbtunnel` user and the key, then prints a ready-made command for step 2,
containing the Pi's **public** key (safe to copy).

**Step 2, on the VPS: authorise the key**
```bash
sudo bash vps-tunnel.sh setup "ssh-ed25519 AAAA…  adsb-tunnel@yourpi"
```
It creates the `adsbtunnel` account, installs the key with its restrictions, checks the SSH
server's settings for anything that would block forwarding, and prints the VPS's **host key
fingerprints** plus a ready-made command for step 3.

**Step 3, on the Pi: verify, test and start**
```bash
sudo bash pi-tunnel.sh install VPS_HOST --fingerprint SHA256:…
```
Use the VPS's public hostname or IP. Add `--port N` if its SSH isn't on port 22. It checks the
local feed, compares the VPS's host key with the fingerprint, makes an 8-second test
connection, then installs and starts the service. (Without `--fingerprint` it shows the keys and
asks you to compare them by eye.)

**Step 4, on the VPS: check the data arrives**
```bash
bash vps-tunnel.sh test
```
Expect something like `[OK] 27 aircraft, 26 with positions, data 0s old`.

**Step 5, on the VPS: point CloudWall at it**

Run this as the user that runs CloudWall (not with sudo):
```bash
bash vps-tunnel.sh cloudwall
```
It finds CloudWall's `config.toml` (same order as CloudWall: `$CLOUDWALL_CONFIG`, the service's
working directory, then `~/.config/cloudwall/config.toml`; or pass `--config PATH`), backs it up,
puts the tunnel first in `[source] urls` keeping the existing feeds after it, turns on
`merge = true`, checks the result parses, and restarts CloudWall (`systemctl --user restart cloudwall`).

The result looks like:
```toml
[source]
urls = [
  "http://127.0.0.1:18080/data/aircraft.json",
  "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}",
  "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}",
]
merge = true
```
CloudWall works out each aircraft's distance itself and keeps only those within `radius_nm`, so
it doesn't matter that the receiver reports everything it hears out to 100+ nm.

### What `merge = true` does

Without it, the list is only a backup order: CloudWall would show just what the first feed that
answers has, so with your receiver first you'd lose every aircraft your antenna can't hear (low
small planes, 978 traffic, anything behind terrain). With it:

- **Every update asks your receiver and the public feed at the same time** (the public feeds after
  the first still fail over in order: adsb.fi, then adsb.lol). The public feed is asked exactly as
  often as before; only your receiver is added.
- **Every aircraft either one sees is shown.** For an aircraft both see, the more recent position
  wins, which is normally your receiver's, since it hears the aircraft directly while the public
  feed is a few seconds behind. Details the chosen record lacks (type, registration, operator) are
  filled in from the other, and the military flag counts if either has it.
- **The lag is reconciled.** Each feed says how old each position is (`seen_pos`, measured from the
  answer's own clock), so CloudWall knows when every position was true. It moves each one on along
  the aircraft's track at its ground speed to the moment of the update (at most 15 s; aircraft on
  the ground aren't moved), so a 6-second-old public position and a half-second-old receiver position
  agree on where the aircraft is now.
- **Aircraft never jump backwards.** If the newest report this time is older than the one used
  last time (say your receiver lost the aircraft and the public feed is behind), CloudWall keeps
  carrying the last position forward instead of stepping back to the older one.
- Positions more than a minute old are left out, as readsb itself does.
- **If either source is down, the other carries on**; CloudWall logs once when your receiver stops
  answering and once when it's back. The feed name on screen shows which answered, e.g.
  `127.0.0.1 + opendata.adsb.fi`.
- A receiver that answers but hears nothing (say, a loose antenna cable) no longer empties the
  screen: the public feed's aircraft still show.

## 5. The key's restrictions, explained

The Pi's line in the VPS's `/var/lib/adsbtunnel/.ssh/authorized_keys`:
```
restrict,port-forwarding,permitlisten="127.0.0.1:18080",permitopen="127.0.0.1:9" ssh-ed25519 AAAA… adsb-tunnel@yourpi
```
| Option | Effect |
|---|---|
| `restrict` | Turns off everything: shell sessions, terminals, agent and X11 forwarding, port forwarding. |
| `port-forwarding` | Turns port forwarding back on, so the options below can limit it. |
| `permitlisten="127.0.0.1:18080"` | The only port the Pi may ask the VPS to listen on, and only on the loopback address. Requests for any other port, or for a public address, are refused. Needs OpenSSH 7.8+. |
| `permitopen="127.0.0.1:9"` | Limits connections *from* the Pi *to* the VPS (`ssh -L`) to port 9, which nothing uses. Without this, the key could reach services listening on the VPS's own localhost. |

On top of that the account has no login shell (`nologin`), so even a command request just
prints "This account is currently not available". These restrictions were tested: a shell
command, a different listen port, a public bind and a `-L` connection to a VPS service were all refused.

## 6. Checking it

| Where | Command | What you should see |
|---|---|---|
| Pi | `sudo bash pi-tunnel.sh status` | "service is running" and recent log lines without errors |
| Pi | `journalctl -u adsb-tunnel -f` | Live log; quiet when healthy |
| VPS | `bash vps-tunnel.sh status` | The account exists, port 18080 listening, aircraft count |
| VPS | `curl -s http://127.0.0.1:18080/data/receiver.json` | The receiver's details (`lat`, `lon`, `version`) |
| VPS | `journalctl --user -u cloudwall -n 30` | CloudWall's feed messages; on screen the feed name shows `127.0.0.1` |

## 7. Changing things

| Change | What to do |
|---|---|
| **VPS hostname, IP or SSH port changed** | On the Pi: `sudo bash pi-tunnel.sh install NEW_HOST [--port N] --fingerprint …` (the fingerprint from `sudo bash vps-tunnel.sh setup "<same key>"`, or `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS). The key stays the same. |
| **VPS reinstalled / moved to a new VPS** | Its host key changes, so the Pi will refuse it (correctly). Repeat steps 2–5 on the new VPS, then step 3 on the Pi. |
| **Pi re-flashed or replaced** | The key is gone. Repeat steps 1–3; the new `setup` replaces the old key on the VPS (the old `authorized_keys` is backed up). |
| **Use a different port than 18080** | Use the same `--remote-port N` on all three: `vps-tunnel.sh setup … --remote-port N`, `pi-tunnel.sh install … --remote-port N`, `vps-tunnel.sh cloudwall --remote-port N`. Then remove the old URL with `vps-tunnel.sh cloudwall-remove --remote-port 18080`. |
| **Rotate the key** (e.g. once a year, or if the Pi was lost) | On the Pi: `sudo rm /etc/adsb-tunnel/id_ed25519*`, then `sudo bash pi-tunnel.sh keygen`, then step 2 on the VPS with the new key (it replaces the old one), then `sudo bash pi-tunnel.sh restart`. |
| **Stop combining; receiver only, public feeds as backup** | Set `merge = false` in `[source]`; restart CloudWall. |
| **Public feeds only, receiver as backup** | Set `merge = false` and move the tunnel URL below the public feeds; restart CloudWall. (With `merge = true`, the receiver must be first.) |
| **Forward a second Pi service** (e.g. a future app on port 8090) | Add another `-R 127.0.0.1:18090:127.0.0.1:8090` to the unit's `ExecStart`, and add `permitlisten="127.0.0.1:18090"` (comma-separated, alongside the first) to the key's options on the VPS. Then `sudo systemctl daemon-reload && sudo systemctl restart adsb-tunnel`. |

## 8. Removing it

1. VPS, as the CloudWall user: `bash vps-tunnel.sh cloudwall-remove` (takes the URL out of CloudWall's feeds, with a backup).
2. VPS: `sudo bash vps-tunnel.sh remove` (deletes the `adsbtunnel` account and its key).
3. Pi: `sudo bash pi-tunnel.sh uninstall --purge` (stops and removes the service, key, settings and local user).

To pause instead: on the Pi, `sudo systemctl disable --now adsb-tunnel`; CloudWall falls back
to the public feeds on its own. Resume with `sudo systemctl enable --now adsb-tunnel`.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Bad IPQoS value` / `terminating, 1 bad configuration options` | An older copy of `pi-tunnel.sh` reading a bad line in the Pi's `/etc/ssh/ssh_config` | Download `pi-tunnel.sh` again (it now ignores that file) and rerun `install` |
| `Host key verification failed` (Pi log) | The VPS's host key changed (reinstall, new VPS), or the wrong host | Confirm the new fingerprint on the VPS, then rerun `pi-tunnel.sh install … --fingerprint …` |
| `Permission denied (publickey)` | Key not authorised, wrong account, or an `AllowUsers`/`AllowGroups` rule | Rerun `vps-tunnel.sh setup "<key>"` and read its warnings; check `sudo tail /var/log/auth.log` on the VPS |
| `remote port forwarding failed for listen port 18080` | Port mismatch with `permitlisten`, forwarding disabled in sshd, or an old tunnel still holding the port | Use the same `--remote-port` everywhere; read `setup`'s sshd warnings; wait 1–2 minutes for a dead session to time out |
| `Connection timed out` / `No route to host` | VPS down, wrong host or port, or a VPS firewall blocking SSH from your home IP | `ssh -p PORT you@VPS_HOST` from home to check SSH works at all |
| `test` on the VPS says nothing listens on 18080 | The tunnel isn't connected | `sudo bash pi-tunnel.sh status` on the Pi |
| `test` works, but data is stale | The decoder on the Pi stopped | `sudo docker ps` on the Pi, check the adsb.im page |
| CloudWall still shows adsb.fi | Config not updated, CloudWall not restarted, or the tunnel was down at that moment | `bash vps-tunnel.sh cloudwall`; check `journalctl --user -u cloudwall` |
| Feed name on screen shows only `opendata.adsb.fi` | Your receiver isn't answering through the tunnel | `bash vps-tunnel.sh test`; `pi-tunnel.sh status` on the Pi |
| Fewer aircraft than expected, feed name shows only `127.0.0.1` | `merge = true` is missing, or the public feed isn't answering | Check `[source]` in `config.toml`; `journalctl --user -u cloudwall` |

## 10. Doing it by hand (what the scripts automate)

**Pi:**
```bash
sudo useradd --system --create-home --home-dir /var/lib/adsbtunnel --shell /usr/sbin/nologin adsbtunnel
sudo install -d -m 750 -o root -g adsbtunnel /etc/adsb-tunnel
sudo ssh-keygen -t ed25519 -N "" -C "adsb-tunnel@$(hostname)" -f /etc/adsb-tunnel/id_ed25519
sudo chown adsbtunnel: /etc/adsb-tunnel/id_ed25519*
ssh-keyscan -p 22 VPS_HOST | sudo tee /etc/adsb-tunnel/known_hosts     # then compare: ssh-keygen -lf /etc/adsb-tunnel/known_hosts
```
then write `/etc/systemd/system/adsb-tunnel.service` with `User=adsbtunnel`, the `ExecStart`
from section 3, `Restart=always`, `RestartSec=15`, and `sudo systemctl enable --now adsb-tunnel`.

**VPS:**
```bash
sudo useradd --system --create-home --home-dir /var/lib/adsbtunnel --shell /usr/sbin/nologin adsbtunnel
sudo usermod -p '*' adsbtunnel
sudo install -d -m 700 -o adsbtunnel -g adsbtunnel /var/lib/adsbtunnel/.ssh
# put the line from section 5 in /var/lib/adsbtunnel/.ssh/authorized_keys, owned by adsbtunnel, mode 600
```
then put the URL first in CloudWall's `[source] urls`, add `merge = true` under it, and `systemctl --user restart cloudwall`.
