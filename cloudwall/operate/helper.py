"""The root helper: how the control board gets something done that needs root, while CloudWall
itself runs unprivileged (and can't gain privileges: its unit sets NoNewPrivileges).

The board writes a request (a small JSON file) into /var/lib/cloudwall/requests/. systemd notices a
*.json there (cloudwall-helper.path) and runs `cloudwall helper` as root (cloudwall-helper.service), which takes
each request, checks it against ALLOWED (a fixed list of actions, each with its arguments
checked), does it, writes the result beside it in done/, and logs it. Anything not on the list is
refused. The board shows the result when it appears.

So the most a compromised CloudWall could ask root for is one of these: the tunnel's keepalive,
its own files given back to it, the time zone set, its own service enabled.
"""
import json
import os
import re
import secrets
import time
import zoneinfo
from pathlib import Path

from . import install as inst
from . import repair
from .survey import Machine
from .system import System

REQUESTS = Path(inst.VAR) / "requests"
DONE = REQUESTS / "done"
KEEP_DONE_S = 7 * 86400


def _zone(args):
    zone = str(args.get("zone") or "")
    if not re.fullmatch(r"[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}", zone):
        raise ValueError("not a time zone name")
    try:
        zoneinfo.ZoneInfo(zone)
    except (KeyError, OSError):            # (ZoneInfoNotFoundError is a KeyError)
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
    """Is the helper installed here (so the board can offer what needs root)?"""
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


def result(rid, folder=REQUESTS):
    """The result of a request: {"done": bool, "ok": bool, "said": str} (not done yet: done False)."""
    if not re.fullmatch(r"\d+-[0-9a-f]{8}", rid or ""):
        return {"done": True, "ok": False, "said": "no such request"}
    p = Path(folder) / "done" / f"{rid}.json"
    if not p.exists():
        return {"done": False}
    return dict(json.loads(p.read_text()), done=True)


def run_pending(folder=REQUESTS, system=None, say=print):
    """As root: do each waiting request that is on the list; refuse the rest. Returns the results."""
    folder = Path(folder)
    done_dir = folder / "done"
    done_dir.mkdir(parents=True, exist_ok=True)
    system = system or System(say=lambda *a: None)
    out = []
    for p in sorted(folder.glob("*.json")):
        try:
            req = json.loads(p.read_text())
            action = req.get("action")
            if action not in ALLOWED:
                raise PermissionError(f"refused: {action!r} isn't something the helper does")
            said = ALLOWED[action][1](system, req.get("args") or {}) or "nothing needed doing"
            res = {"id": req.get("id", p.stem), "action": action, "ok": True, "said": said}
        except Exception as e:
            res = {"id": p.stem, "action": None, "ok": False, "said": str(e)}
        res["at"] = time.time()
        (done_dir / f"{p.stem}.json").write_text(json.dumps(res))
        p.unlink()
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
# a request file waiting (not the folder merely holding something: done/ is in it, and a request
# being written is a .tmp until it is whole)
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
    system.mkdir(str(REQUESTS), 0o770, "root", inst.USER)
    system.mkdir(str(DONE), 0o750, "root", inst.USER)
    a = system.write("/etc/systemd/system/cloudwall-helper.path", PATH_UNIT)
    b = system.write("/etc/systemd/system/cloudwall-helper.service", SERVICE_UNIT)
    if a or b:
        system.run(["systemctl", "daemon-reload"])
        system.run(["systemctl", "enable", "--now", "cloudwall-helper.path"], check=False)


def remove_units(system):
    system.run(["systemctl", "disable", "--now", "cloudwall-helper.path"], check=False)
    system.remove("/etc/systemd/system/cloudwall-helper.path")
    system.remove("/etc/systemd/system/cloudwall-helper.service")

