"""The repairs CloudWall knows, by name (troubles.CATALOGUE names them). `cloudwall doctor --fix`
makes those its checks call for, saying each before it is made; the running server makes the
`auto` ones itself (app/watch.py), so here they are for when CloudWall isn't running.

A repair only puts things back as CloudWall would have set them up: permissions, ownership,
a service enabled or started, a keepalive for the tunnel's account, the cache trimmed. Nothing is
deleted that can't be downloaded again, and anything that would change what someone else relies on
(a new private link breaks every bookmark; turning one of two CloudWalls off) is left to the owner,
with the steps to do it.
"""
import os
from pathlib import Path

from ..core import config
from . import install as inst
from .survey import installs

TUNNEL_KEEPALIVE = "/etc/ssh/sshd_config.d/cloudwall-tunnel.conf"
TUNNEL_KEEPALIVE_TEXT = """# Written by `cloudwall doctor --fix`: check the receiver's tunnel is alive every 30 s, so a dropped
# one lets go of its port within 90 s and the receiver can connect again.
Match User adsbtunnel
    ClientAliveInterval 30
    ClientAliveCountMax 3
"""


def chmod_config(system, machine):
    done = []
    for i in installs(machine):
        cfg = i.get("config")
        if not cfg:
            continue
        for p in (cfg, f"{cfg}.good", f"{cfg}.before"):
            path = system.path(p)
            if path.exists() and path.stat().st_mode & 0o004:
                system._mode(p, path.stat().st_mode & 0o770)
                done.append(p)
    return f"made {', '.join(done)} unreadable by other accounts" if done else None


def fix_ownership(system, machine):
    if not system.real:
        return None
    system.run(["chown", "-R", f"{inst.USER}:{inst.USER}", inst.VAR, inst.CACHE])
    if system.exists(inst.CONFIG):
        system.chown(inst.CONFIG, inst.USER, inst.USER)
    return f"gave {inst.VAR}, {inst.CACHE} and the settings back to {inst.USER}"


def trim_cache(system, machine):
    from ..gather import tiles
    try:
        cfg = config.load(None)
    except Exception:                  # a broken settings file is no reason not to trim the cache
        import copy
        cfg = copy.deepcopy(config.DEFAULTS)
    done = []
    for folder in {Path(inst.CACHE) / "tiles", config.cache_dir(cfg, str(config.default_db_path())) / "tiles"}:
        path = system.path(str(folder))
        if path.is_dir():
            removed, kept = tiles.sweep(path, cfg["map"]["cache_mb"] * 1e6 * 0.5 or 500e6)
            done.append(f"{folder}: {removed} files removed, {kept / 1e6:.0f} MB kept")
    return "; ".join(done) or None


def restart_service(system, machine):
    system.run(["systemctl", "restart", "cloudwall"])
    return "restarted cloudwall.service"


def enable_service(system, machine):
    system.run(["systemctl", "enable", "cloudwall"])
    return "cloudwall.service now starts at boot"


def tunnel_keepalive(system, machine):
    if system.write(TUNNEL_KEEPALIVE, TUNNEL_KEEPALIVE_TEXT, mode=0o644):
        got = system.ask(["sshd", "-t"])
        if got is not None and got.returncode != 0:          # never leave SSH unable to restart
            system.remove(TUNNEL_KEEPALIVE)
            raise RuntimeError("sshd refused the keepalive, so it was taken out again: " + (got.stderr or "").strip())
        system.run(["systemctl", "reload", "ssh"], check=False)
        return f"added a keepalive for the tunnel's account ({TUNNEL_KEEPALIVE})"
    return None


def reopen_store(system, machine):
    return None                     # a running CloudWall's own repair (app/watch.py); a restart does it otherwise


# name -> (what it does, in words, needs root, function(system, machine) -> what was done or None)
REPAIRS = {
    "chmod-config": ("make the settings unreadable by other accounts", False, chmod_config),
    "fix-ownership": ("give CloudWall's files back to its service's user", True, fix_ownership),
    "trim-cache": ("trim the map tile cache", False, trim_cache),
    "restart-service": ("restart the CloudWall service", True, restart_service),
    "enable-service": ("start the CloudWall service at boot", True, enable_service),
    "tunnel-keepalive": ("add a keepalive for the receiver's tunnel to this server's SSH", True, tunnel_keepalive),
    "reopen-store": ("reopen a logbook file that can't be written", False, reopen_store),
}


def fix(findings, system, machine, say=print):
    """Make the repairs the findings call for, once each. Returns [(name, what was done or why not)]."""
    out, seen = [], set()
    for f in findings:
        name = f.repair
        if not name or name in seen or f.state not in ("warn", "fail"):
            continue
        seen.add(name)
        words, root, fn = REPAIRS[name]
        if root and system.real and os.geteuid() != 0 and not system.dry_run:
            out.append((name, f"not made: it needs sudo ({words})"))
            continue
        say(f"Repairing: {words} ...")
        try:
            out.append((name, fn(system, machine) or "nothing needed doing"))
        except Exception as e:
            out.append((name, f"failed: {e}"))
        say(f"  {out[-1][1]}")
    return out
