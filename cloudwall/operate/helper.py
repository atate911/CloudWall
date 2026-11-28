"""The root helper: how the unprivileged CloudWall (NoNewPrivileges) gets root things done.

The board writes a JSON request into requests/; cloudwall-helper.path sees it and runs
`cloudwall helper` as root, which does it only if it is in ALLOWED (arguments checked) and writes
the result in done/. Security: the parent folder is root's, CloudWall can write only in requests/
and only read done/, and root follows no link in either, so CloudWall can't redirect root's writes.
"""
import json
import os
import re
import secrets
import shutil
import time
import zoneinfo
from pathlib import Path

from . import install as inst
from . import repair
from .survey import Machine
from .system import System

REQUESTS = Path(inst.HELPER_VAR) / "requests"
DONE = Path(inst.HELPER_VAR) / "done"
OLD_REQUESTS = Path(inst.VAR) / "requests"        # the old place, inside CloudWall's own folder
KEEP_DONE_S = 7 * 86400


def _zone(args):
    zone = str(args.get("zone") or "")
    if not re.fullmatch(r"[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}", zone):
        raise ValueError("not a time zone name")
    try:
        zoneinfo.ZoneInfo(zone)
    except (KeyError, OSError):            # ZoneInfoNotFoundError is a KeyError
        raise ValueError(f"{zone} isn't a time zone this machine knows") from None
    return zone


def set_timezone(system, args):
    zone = _zone(args)
    system.run(["timedatectl", "set-timezone", zone])
    return f"this machine's time zone is now {zone}"


# action -> (what it does, function(system, args) -> what was done)
ALLOWED = {
    "tunnel-keepalive": ("add a keepalive for the receiver's tunnel to SSH", lambda s, a: repair.tunnel_keepalive(s, Machine())),
    "fix-ownership": ("give CloudWall's files back to its service", lambda s, a: repair.fix_ownership(s, Machine())),
    "enable-service": ("start CloudWall at boot", lambda s, a: repair.enable_service(s, Machine())),
    "set-timezone": ("set this machine's time zone", set_timezone),
}


def available():
    """Is the helper installed here?"""
    return Path("/etc/systemd/system/cloudwall-helper.path").exists() and REQUESTS.is_dir()


def ask(action, args=None, folder=REQUESTS):
    """File a request (from the running CloudWall). Returns its id."""
    if action not in ALLOWED:
        raise ValueError(f"the helper doesn't do {action!r}")
    rid = f"{int(time.time())}-{secrets.token_hex(4)}"
    tmp = Path(folder) / f".{rid}.tmp"
    tmp.write_text(json.dumps({"id": rid, "action": action, "args": args or {}, "asked": time.time()}))
    os.replace(tmp, Path(folder) / f"{rid}.json")
    return rid


def _done_dir(folder):
    """Where results go: DONE, or for a test's folder, its done/."""
    return DONE if Path(folder) == REQUESTS else Path(folder) / "done"


def result(rid, folder=REQUESTS):
    """{"done": bool, "ok": bool, "said": str}; not done yet: {"done": False}."""
    if not re.fullmatch(r"\d+-[0-9a-f]{8}", rid or ""):
        return {"done": True, "ok": False, "said": "no such request"}
    p = _done_dir(folder) / f"{rid}.json"
    if not p.exists():
        return {"done": False}
    return dict(json.loads(p.read_text()), done=True)


def run_pending(folder=REQUESTS, system=None, say=print):
    """As root: do each waiting request that is in ALLOWED; refuse the rest. Returns the results."""
    folder = Path(folder)
    done_dir = _done_dir(folder)
    done_dir.mkdir(parents=True, exist_ok=True)
    system = system or System(say=lambda *a: None)
    out = []
    for p in sorted(folder.glob("*.json")):
        try:
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)      # never follow a link
            with os.fdopen(fd) as f:
                req = json.loads(f.read(65536))
            if not isinstance(req, dict):
                raise ValueError("not a request")
            action = req.get("action")
            if action not in ALLOWED:
                raise PermissionError(f"refused: {action!r} isn't something the helper does")
            said = ALLOWED[action][1](system, req.get("args") or {}) or "nothing needed doing"
            res = {"id": p.stem, "action": action, "ok": True, "said": said}
        except Exception as e:
            res = {"id": p.stem, "action": None, "ok": False, "said": str(e)}
        res["at"] = time.time()
        try:                                 # O_EXCL: a new file of root's own; nothing is written over
            fd = os.open(done_dir / f"{p.stem}.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
            with os.fdopen(fd, "w") as f:
                f.write(json.dumps(res))
            if os.geteuid() == 0:            # CloudWall reads it by its group
                shutil.chown(done_dir / f"{p.stem}.json", group=done_dir.stat().st_gid)
        except OSError as e:
            say(f"helper: the result of {p.stem} couldn't be written: {e}")
        p.unlink(missing_ok=True)
        say(f"helper: {res['action']}: {'done' if res['ok'] else 'not done'}: {res['said']}")
        out.append(res)
    for old in done_dir.glob("*.json"):
        if time.time() - old.stat().st_mtime > KEEP_DONE_S:
            old.unlink()
    return out


PATH_UNIT = f"""# Written by `cloudwall install`: runs the root helper when CloudWall files a request.
[Unit]
Description=CloudWall's root helper: requests from the control board

[Path]
# a request file waiting (not the folder merely holding something: a request being written is a
# .tmp until it is whole)
PathExistsGlob={REQUESTS}/*.json
MakeDirectory=no

[Install]
WantedBy=paths.target
"""

SERVICE_UNIT = f"""# Written by `cloudwall install`: does the allow-listed requests the control board files (operate/helper.py).
[Unit]
Description=CloudWall's root helper

[Service]
Type=oneshot
{chr(10).join(f"Environment={k}={v}" for k, v in inst.ENV.items())}
ExecStart={inst.PYTHON} -m cloudwall helper
"""


def install_units(system):
    system.mkdir(inst.HELPER_VAR, 0o755, "root", "root")
    system.mkdir(str(REQUESTS), 0o770, "root", inst.USER)
    system.mkdir(str(DONE), 0o750, "root", inst.USER)
    system.remove(str(OLD_REQUESTS))
    a = system.write("/etc/systemd/system/cloudwall-helper.path", PATH_UNIT)
    b = system.write("/etc/systemd/system/cloudwall-helper.service", SERVICE_UNIT)
    if a or b:
        system.run(["systemctl", "daemon-reload"])
        system.run(["systemctl", "enable", "cloudwall-helper.path"], check=False)
        system.run(["systemctl", "restart", "cloudwall-helper.path"], check=False)     # restart: it may be watching the old folder


def remove_units(system):
    system.run(["systemctl", "disable", "--now", "cloudwall-helper.path"], check=False)
    system.remove("/etc/systemd/system/cloudwall-helper.path")
    system.remove("/etc/systemd/system/cloudwall-helper.service")
    system.remove(inst.HELPER_VAR)
    system.remove(str(OLD_REQUESTS))

