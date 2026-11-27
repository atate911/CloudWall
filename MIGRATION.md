# Moving to the new CloudWall

CloudWall used to be set up by hand: a per-user service (`make service`) running from a git
checkout, its settings and logbooks in a home folder, the receiver's tunnel and Caddy set up by
scripts, and nothing to say whether it all still worked. Now one command sets a machine up, updates
it in place and checks it. This guide moves an existing setup over. Nothing is deleted, every step
can be undone, and it takes about ten minutes.

## What changes

| | Before | After |
|---|---|---|
| How it runs | `make service`: your user's service, from the checkout | `cloudwall.service`, as its own user `cloudwall`, restarted by systemd if it ever hangs |
| Settings | `~/CloudWall/config.toml` or `~/.config/cloudwall/config.toml` | `/etc/cloudwall/config.toml`, plus `config.toml.good`, the last copy that started |
| Logbooks | `~/.local/share/cloudwall/` | `/var/lib/cloudwall/`, with `backups/` beside them |
| Map tiles, logos | beside the logbooks | `/var/cache/cloudwall/`, trimmed to `[map] cache_mb` |
| The code | the checkout itself | `/opt/cloudwall/releases/`, the last three kept; the checkout is only where updates come from |
| Updating | `git pull`, `make restart` | `git pull`, `sudo python3 -m cloudwall upgrade` (backs up first; `sudo cloudwall rollback` goes back) |
| Changing it | edit the file, restart | the control board at `/admin`, or the file |
| Knowing it works | look at the screen | it checks itself every 30 s and says what is wrong, on every screen if it matters |

The screens, their bookmarks and the private link stay as they are.

## Before you start

- A shell on the server, with sudo.
- The new code in your checkout: `cd ~/CloudWall && git pull` (once this is merged to `main`).
- Python 3.11 or later at `/usr/bin/python3` (`python3 --version`). Raspberry Pi OS Bookworm,
  Debian 12 and Ubuntu 22.04 and later have it.

Nothing below deletes anything. The old files stay where they are until you remove them yourself.

## The server (the VPS, or whichever machine runs CloudWall)

**1. Look first.** This changes nothing; it says what it finds and what it would do:

```bash
cd ~/CloudWall
python3 -m cloudwall doctor --offline
```

```bash
sudo python3 -m cloudwall upgrade --dry-run
```

`doctor` should name your setup ("CloudWall runs as the old per-user service") and anything else
worth knowing: a settings file readable by every account, the tunnel without a keepalive, the
private link's key in an old log. They are dealt with below.

**2. Upgrade.**

```bash
sudo python3 -m cloudwall upgrade
```

It backs up your settings and logbooks (to `~/.local/share/cloudwall/backups/`), installs the system
service, checks your settings start with the new code, moves the settings and logbooks over, turns
the old per-user service off and starts the new one. It ends by saying how things stand.

If your settings wouldn't start with the new code, it says which setting and leaves your old
CloudWall running: change that line and run it again.

**3. Set the owner's password**, for the control board:

```bash
sudo cloudwall owner
```

Then open `http://<the server>:5050/admin` (with your private link: `.../k/<key>/admin`) and sign in.
Its Overview shows a lamp for each part of CloudWall; anything lit has its steps under it.

**4. Let it put right what it found:**

```bash
sudo cloudwall doctor --fix
```

It goes through each problem with you: what it means, a repair where it can make one (the
tunnel's keepalive, the settings' permissions), a question where it needs your answer, and the steps
where only you can act, checking again after each.

Two things only you can decide, which it will ask about:

- **The private link's key was written in the old log.** Older CloudWall wrote it at every start.
  Making a new one (`sudo cloudwall --private-link new`) means opening the new link once on each
  screen, the wall panel too.
- **Caddy's password for CloudWall was commented out** (if the early `--public` set-up was used).
  The private link keeps it private; nothing needs doing unless you want the password back.

**5. The receiver's tunnel** keeps working as it was: CloudWall reads it at the same address.
`vps-tunnel.sh` knows the new layout (run it with sudo now). `cloudwall doctor` checks the tunnel
answers, and CloudWall watches your receiver while it runs: down, frozen, deaf or lagging, it says so.

## The receiver (the Pi)

Nothing on the receiver has to change: adsb.im, the tunnel (`adsb-tunnel.service`) and Coverage3D,
if it is installed, keep running as they are.

To see how it stands, from a checkout on the Pi:

```bash
python3 -m cloudwall doctor --offline
```

It recognises the tunnel's receiver end, Coverage3D installed on its own, and the sharing page if it
was left running as root (stop it with Ctrl-C where it was started). The receiver gets its own part of
CloudWall in a later stage (ROADMAP.md, "station"); until then it stays as it is.

## A wall panel

A panel started by `deploy/kiosk.sh` from the desktop's autostart keeps working. To set it up the new
way (its own command, the wall's address and key in one file):

```bash
sudo python3 -m cloudwall install --role panel --wall http://<the server>:5050/k/<key>
```

## From now on

```bash
cd ~/CloudWall && git pull
```

```bash
sudo python3 -m cloudwall upgrade
```

Every time: a backup first, the new code beside the old, your settings checked before the restart,
a check after. The control board shows a lamp lit if anything is wrong, and with `[health] notify_url`
set (an [ntfy.sh](https://ntfy.sh) topic, say) a problem that stops CloudWall reaches your phone.

## If something goes wrong

| What | Do |
|---|---|
| The new version misbehaves | `sudo cloudwall rollback`: back to the release before, at once |
| A setting you changed broke it | It starts on `config.toml.good`, the last settings that started, and says so; fix the file, or copy `.good` back |
| You want the logbooks as they were | `sudo cloudwall restore <backup> --yes` (the upgrade's backup is in `~/.local/share/cloudwall/backups/`) |
| You want the old setup back entirely | `sudo systemctl disable --now cloudwall`, then, as your user, `systemctl --user enable --now cloudwall`. The old settings and logbooks were never touched |

## When you're happy

The old files can go, whenever you like (`cloudwall doctor` stops mentioning them once the old
service's file is gone):

```bash
rm -r ~/.local/share/cloudwall ~/.config/cloudwall ~/.config/systemd/user/cloudwall.service
```

```bash
rm ~/CloudWall/config.toml
```
