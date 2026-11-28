"""`sudo cloudwall install --role wall|panel`: one command that sets a machine up the same way
every time, and changes only what isn't so already. Run it again after an update and it puts the
new code in place and restarts; run it on a new machine and, with `cloudwall restore`, the old
one is back.

Where everything goes, on every machine:

    /opt/cloudwall/releases/<version>-<id>/   the code, one folder a release (the last three kept)
    /opt/cloudwall/current                    -> the release in use, switched in one step
    /etc/cloudwall/config.toml                the settings (the service may rewrite it: Setup)
    /var/lib/cloudwall/                       logbooks, places.json, backups
    /var/cache/cloudwall/                     downloaded map tiles and logos
    /usr/local/bin/cloudwall                  the command, for doctor, backup and the rest
    cloudwall.service                         the wall, as the system user `cloudwall`

The roles (ROLES) are what a machine does: a wall serves the screens; a panel is a screen
(a browser full-screen at a wall). The station, a receiver's own process, joins them later
(see ROADMAP.md). Each role is a list of steps on a System (system.py), so a test can run any of
them against a folder instead of a machine.
"""
import os
import sys
from pathlib import Path

from .. import __version__
from ..core import config, keys, paths
from .system import System, tree_hash

OPT = "/opt/cloudwall"
ETC = "/etc/cloudwall"
VAR = "/var/lib/cloudwall"
CACHE = "/var/cache/cloudwall"
CONFIG = f"{ETC}/config.toml"
PANEL_CONF = f"{ETC}/panel.conf"
BIN = "/usr/local/bin/cloudwall"
KIOSK_BIN = "/usr/local/bin/cloudwall-kiosk"
UNIT = "/etc/systemd/system/cloudwall.service"
CADDY_SITE = "/etc/caddy/cloudwall.caddy"
CADDYFILE = "/etc/caddy/Caddyfile"
USER = "cloudwall"
PYTHON = "/usr/bin/python3"
KEEP_RELEASES = 3

ENV = {"PYTHONPATH": f"{OPT}/current", "CLOUDWALL_CONFIG": CONFIG, "CLOUDWALL_DATA": VAR,
       "CLOUDWALL_CACHE": CACHE, "PYTHONDONTWRITEBYTECODE": "1"}

UNIT_TEXT = f"""# Written by `cloudwall install`: changes here are replaced on the next install.
[Unit]
Description=CloudWall flight board (wall)
After=network-online.target
Wants=network-online.target
# never stop trying: a wall that gave up would need someone at a keyboard
StartLimitIntervalSec=0

[Service]
# notify: CloudWall says when it is answering, its status line (`systemctl status cloudwall` shows a
# problem that stops it working) and a watchdog ping every 30 s while it works: if it hangs, systemd
# restarts it within two minutes rather than leave a frozen board
Type=notify
NotifyAccess=main
WatchdogSec=120
TimeoutStartSec=180
User={USER}
Group={USER}
{chr(10).join(f"Environment={k}={v}" for k, v in ENV.items())}
WorkingDirectory={VAR}
ExecStart={PYTHON} -m cloudwall
Restart=always
RestartSec=5
UMask=0027
# what it may touch: its own folders, and its settings (which Setup rewrites)
ProtectSystem=strict
ReadWritePaths={VAR} {CACHE} {ETC}
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
MemoryMax=1G

[Install]
WantedBy=multi-user.target
"""

COMMAND_TEXT = f"""#!/bin/sh
# Written by `cloudwall install`: the cloudwall command, run with the installed code and settings.
{chr(10).join(f"export {k}={v}" for k, v in ENV.items())}
exec {PYTHON} -m cloudwall "$@"
"""

KIOSK_TEXT = f"""#!/bin/sh
# Written by `cloudwall install --role panel`: CloudWall full-screen on this machine's display,
# started from the desktop's autostart. The address it opens is in {PANEL_CONF}.
. {PANEL_CONF}
URL=${{CLOUDWALL_URL:-http://localhost:5050}}
until curl -sf "$URL/api/state" >/dev/null; do sleep 2; done
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
  --overscroll-history-navigation=0 --disable-pinch --autoplay-policy=no-user-gesture-required "$URL/kiosk"
"""


def caddy_site(name, port):
    return (f"# Written by `cloudwall install --public {name}`: CloudWall on the internet, over HTTPS.\n"
            f"{name} {{\n\tencode gzip\n\treverse_proxy 127.0.0.1:{port}\n}}\n")


class Options:
    def __init__(self, role="wall", public=None, wall_url=None, desktop_user=None, source=None, start=True):
        self.role = role
        self.public = public                # a name on the internet: Caddy in front (wall)
        self.wall_url = wall_url            # the wall a panel shows
        self.desktop_user = desktop_user    # the panel's desktop session's user
        self.source = Path(source or paths.PACKAGE)
        self.start = start                  # start (or restart) the service when done


# -- the wall -------------------------------------------------------------------------------

def check_python(system):
    """The service runs PYTHON: it must be 3.11 or later (tomllib)."""
    got = system.ask([PYTHON, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"])
    if got is None:                          # not the real machine: the running Python stands in
        version = sys.version_info[:2]
    elif got.returncode != 0:
        raise SystemExit(f"cloudwall install: {PYTHON} isn't there: install Python 3.11 or later (apt install python3)")
    else:
        version = tuple(int(x) for x in got.stdout.strip().split("."))
    if version < (3, 11):
        raise SystemExit(f"cloudwall install: {PYTHON} is Python {version[0]}.{version[1]}; CloudWall needs 3.11 or later")


def put_release(system, source):
    """The code in a release folder of its own, `current` switched to it; older ones beyond the
    last KEEP_RELEASES removed. True if the code in use changed."""
    rid = f"{__version__}-{tree_hash(source)[:10]}"
    folder = f"{OPT}/releases/{rid}"
    if not system.exists(f"{folder}/cloudwall/__init__.py"):
        system.copy_tree(source, f"{folder}/cloudwall")
        system.run([PYTHON, "-m", "compileall", "-q", system.path(folder).as_posix()], check=False, quiet=True)
    link = system.path(f"{OPT}/current")
    before = os.readlink(link) if link.is_symlink() else None
    changed = system.symlink(f"releases/{rid}", f"{OPT}/current")     # relative: right under any root
    if changed and before:                     # what `cloudwall rollback` goes back to
        system.write(f"{OPT}/previous", before + "\n")
    releases = sorted(system.path(f"{OPT}/releases").iterdir(), key=lambda p: p.stat().st_mtime) \
        if system.path(f"{OPT}/releases").is_dir() else []
    kept = system.path(f"{OPT}/previous")          # (kept whichever run named it: rollback's way back)
    keep = {rid, Path(before).name if before else None,
            Path(kept.read_text().strip()).name if kept.is_file() else None}
    for old in [r for r in releases if r.name not in keep][:-(KEEP_RELEASES - 2) or None]:
        system.remove(f"{OPT}/releases/{old.name}")
    return changed


def rollback(system):
    """Back to the release in use before the last update (its settings fall back on .good if they
    no longer suit it). Returns the release now in use."""
    previous = (system.read(f"{OPT}/previous") or "").strip()
    if not previous or not system.exists(f"{OPT}/{previous}/cloudwall/__init__.py"):
        raise SystemExit("cloudwall rollback: there is no earlier release kept to go back to")
    link = system.path(f"{OPT}/current")
    now = os.readlink(link) if link.is_symlink() else None
    system.symlink(previous, f"{OPT}/current")
    if now:
        system.write(f"{OPT}/previous", now + "\n")
    system.run(["systemctl", "restart", "cloudwall"])
    return previous


def put_config(system):
    """The settings file: started from the example when there is none; never overwritten."""
    if not system.exists(CONFIG):
        system.write(CONFIG, paths.EXAMPLE.read_text(), mode=0o640, owner=USER, group=USER)
    else:
        system.chown(CONFIG, USER, USER)
        system._mode(CONFIG, 0o640)


def make_public(system, name, port):
    """CloudWall on the internet at `name`, through Caddy: a site file of its own imported by the
    Caddyfile (which is otherwise left as it is), CloudWall listening only for Caddy, and a
    private link, since until the owner's sign-in exists the key is all that keeps it private."""
    cfg_path = system.path(CONFIG)
    cfg = config.load(cfg_path) if cfg_path.exists() else config.load(None)
    if not cfg["server"]["key"]:
        key = keys.new_key()
        system._did("make a private link (CloudWall on the internet needs one)")
        if not system.dry_run:
            config.write_setting(cfg_path, "server", "key", key)
    if cfg["server"]["host"] != "127.0.0.1":
        system._did("have CloudWall listen only for Caddy ([server] host = \"127.0.0.1\")")
        if not system.dry_run:
            config.write_setting(cfg_path, "server", "host", "127.0.0.1")
    if not system.dry_run:
        config.write_setting(cfg_path, "server", "address", name)
    system.write(CADDY_SITE, caddy_site(name, port))
    line = f"import {CADDY_SITE}"
    current = system.read(CADDYFILE)
    if current is None:
        system.write(CADDYFILE, line + "\n")
    elif line not in current.splitlines():
        if not system.exists(CADDYFILE + ".before-cloudwall"):
            system.write(CADDYFILE + ".before-cloudwall", current)
        system.write(CADDYFILE, current.rstrip("\n") + f"\n\n{line}\n")
    got = system.ask(["caddy", "validate", "--config", CADDYFILE, "--adapter", "caddyfile"])
    if got is not None and got.returncode != 0:
        if current is not None and not system.dry_run:
            system.write(CADDYFILE, current)
        system.remove(CADDY_SITE)
        raise SystemExit("cloudwall install: Caddy refused the new site, so the Caddyfile was put back as it was:\n"
                         + (got.stderr or got.stdout).strip()
                         + f"\n(If the Caddyfile already has a site for {name}, take that out first.)")
    system.run(["systemctl", "reload-or-restart", "caddy"], check=False)


def preflight(system, path=None, what=None):
    """Before restarting into new code: would the settings start with it? If not, the running
    CloudWall is left running (its new code waits in place) and what to change is said. Settings
    it can start with, but with something left out, are said and the restart goes ahead.
    path: a settings file other than the installed one (an old setup's, before it is moved in)."""
    from ..reference import placing
    path = Path(path) if path else system.path(CONFIG)
    if not path.exists():
        return
    try:
        cfg = config.load(path)
        placing.places(cfg)
    except Exception as e:
        what = what or "the new code is in place, but CloudWall wasn't restarted into it"
        raise SystemExit(f"cloudwall: {what}:\n"
                         f"  {path}: {e}\n"
                         f"Correct that (sudoedit {path}), then run the command again. The CloudWall running now "
                         f"carries on until then.")
    for p in cfg.get("_problems", []):
        system.say(f"note: {p}")


def start_service(system, restart=True):
    """Start (or restart) the service and say plainly if it didn't come up: the reason from its log,
    and the way back. True if it is running."""
    got = system.run(["systemctl", "restart" if restart else "start", "cloudwall"], check=False)
    if got.returncode == 0:
        return True
    log = system.ask(["journalctl", "-u", "cloudwall", "-n", "15", "--no-pager", "-o", "cat"])
    raise SystemExit("cloudwall: CloudWall's service didn't start. The end of its log:\n"
                     + "\n".join("  " + l for l in ((log.stdout if log else "") or "(no log)").strip().splitlines()[-15:])
                     + "\nFix what it says and run `sudo systemctl restart cloudwall`, or go back to the release "
                       "before: `sudo cloudwall rollback`. `cloudwall doctor` says more.")


def wall(system, opts):
    check_python(system)
    system.add_system_user(USER, VAR)
    system.mkdir(OPT, 0o755)
    system.mkdir(f"{OPT}/releases", 0o755)
    # the service rewrites its settings (Setup), so the group may write here; others may pass through
    # to a panel's own file but list nothing, and config.toml itself is the owner's and group's only
    system.mkdir(ETC, 0o771, "root", USER)
    system.mkdir(VAR, 0o750, USER, USER)
    system.mkdir(f"{VAR}/backups", 0o750, USER, USER)      # the board's "Back up now" writes here
    system.mkdir(CACHE, 0o750, USER, USER)
    code = put_release(system, opts.source)
    put_config(system)
    system.write(BIN, COMMAND_TEXT, mode=0o755)
    unit = system.write(UNIT, UNIT_TEXT)
    from . import helper
    helper.install_units(system)              # what the control board may ask root for
    if opts.public:
        port = config.load(system.path(CONFIG))["server"]["port"] if system.exists(CONFIG) else 5050
        make_public(system, opts.public, port)
    if unit:
        system.run(["systemctl", "daemon-reload"])
    enabled = system.ask(["systemctl", "is-enabled", "cloudwall"])
    if unit or (enabled is not None and enabled.stdout.strip() != "enabled"):
        system.run(["systemctl", "enable", "cloudwall"], check=False)
    if opts.start and (code or unit or opts.public):
        preflight(system)
    if opts.start:
        if code or unit or opts.public:
            start_service(system)
        else:
            active = system.ask(["systemctl", "is-active", "cloudwall"])
            if active is not None and active.stdout.strip() != "active":
                start_service(system, restart=False)


def unwall(system, purge=False):
    from . import helper
    helper.remove_units(system)
    system.run(["systemctl", "disable", "--now", "cloudwall"], check=False)
    system.remove(UNIT)
    system.run(["systemctl", "daemon-reload"], check=False)
    system.remove(BIN)
    system.remove(OPT)
    if system.exists(CADDY_SITE):
        system.remove(CADDY_SITE)
        current = system.read(CADDYFILE) or ""
        kept = "\n".join(l for l in current.splitlines() if l.strip() != f"import {CADDY_SITE}")
        system.write(CADDYFILE, kept.rstrip("\n") + "\n")
        system.run(["systemctl", "reload-or-restart", "caddy"], check=False)
    if purge:
        for p in (ETC, VAR, CACHE):
            system.remove(p)
        if system.user_exists(USER):
            system.run(["userdel", USER], check=False)


# -- a panel ----------------------------------------------------------------------------------

def panel(system, opts):
    user = opts.desktop_user or os.environ.get("SUDO_USER")
    if not user or user == "root":
        raise SystemExit("cloudwall install --role panel: say whose desktop shows it: --desktop-user <name>")
    url = (opts.wall_url or "").rstrip("/")
    if not url:                                   # a wall on this machine: its own address, with its key
        cfg = config.load(system.path(CONFIG)) if system.exists(CONFIG) else config.load(None)
        url = f"http://localhost:{cfg['server']['port']}" + (f"/k/{cfg['server']['key']}" if cfg["server"]["key"] else "")
    system.mkdir(ETC, None if system.exists(ETC) else 0o771)
    # the address may carry the private link's key: readable by the desktop's user, not everyone
    system.write(PANEL_CONF, f"CLOUDWALL_URL='{url}'\n", mode=0o640, owner="root", group=user)
    system.write(KIOSK_BIN, KIOSK_TEXT, mode=0o755)
    home = Path(system.ask(["getent", "passwd", user]).stdout.split(":")[5]) if system.real else Path(f"/home/{user}")
    autostart = f"{home}/.config/labwc/autostart"
    current = system.read(autostart) or ""
    if KIOSK_BIN not in current:
        system.write(autostart, current + ("" if current.endswith("\n") or not current else "\n") + f"{KIOSK_BIN} &\n",
                     mode=0o644, owner=user, group=user)
    system.say(f"The panel opens {url}/kiosk when {user} next logs in to the desktop.")


def unpanel(system, desktop_user=None):
    system.remove(KIOSK_BIN)
    system.remove(PANEL_CONF)
    user = desktop_user or os.environ.get("SUDO_USER")
    if user:
        home = Path(system.ask(["getent", "passwd", user]).stdout.split(":")[5]) if system.real else Path(f"/home/{user}")
        autostart = f"{home}/.config/labwc/autostart"
        current = system.read(autostart)
        if current and KIOSK_BIN in current:
            system.write(autostart, "".join(l for l in current.splitlines(True) if KIOSK_BIN not in l))


ROLES = {"wall": (wall, unwall), "panel": (panel, unpanel)}


def install(opts, system=None):
    system = system or System()
    if system.real and os.geteuid() != 0 and not system.dry_run:
        raise SystemExit("cloudwall install changes the system: run it with sudo")
    ROLES[opts.role][0](system, opts)
    return system


def uninstall(role, purge=False, desktop_user=None, system=None):
    system = system or System()
    if system.real and os.geteuid() != 0 and not system.dry_run:
        raise SystemExit("cloudwall uninstall changes the system: run it with sudo")
    if role == "panel":
        unpanel(system, desktop_user)
    else:
        unwall(system, purge)
    return system
