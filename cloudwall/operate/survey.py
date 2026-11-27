"""What is set up on this machine, however it got there: the checks `cloudwall doctor` runs on the
machine itself, not on CloudWall's own settings.

CloudWall has been set up in more than one way over time (a per-user service from a git checkout,
the system install, the reverse tunnel's two ends, Caddy in front, Coverage3D and the sharing page
on the receiver), and a machine may have any mix of them, working, half-working or left over. Each
check below looks for one of them where it would be, says what it found, and names the problem
(troubles.CATALOGUE) when what it found is wrong: two CloudWalls fighting over a port, a per-user
service that won't come back after a reboot, keys readable by everyone, the tunnel's key without
its restrictions, the private link's key in an old log.

Everything goes through a Machine (a root folder and a way to run read-only commands), so the
tests build a pretend machine in a folder.
"""
import os
import re
import subprocess
import time
from pathlib import Path

from ..core import health


class Machine:
    def __init__(self, root="/", ask=None):
        self.root = Path(root)
        self.real = self.root == Path("/")
        self._ask = ask

    def path(self, p):
        return self.root / str(p).lstrip("/")

    def read(self, p):
        try:
            return self.path(p).read_text(errors="replace")
        except OSError:
            return None

    def ask(self, cmd):
        """A read-only command's result, or None (not the real machine, or no such command)."""
        if self._ask is not None:
            return self._ask(cmd)
        if not self.real:
            return None
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return None

    def homes(self):
        """(user, home) for each account with a home folder here."""
        out = []
        passwd = self.read("/etc/passwd") or ""
        for line in passwd.splitlines():
            parts = line.split(":")
            if len(parts) >= 7 and (parts[5].startswith("/home/") or parts[0] == "root"):
                out.append((parts[0], parts[5]))
        if not out:                         # no passwd to go by: every folder under /home
            home = self.path("/home")
            out = [(p.name, f"/home/{p.name}") for p in home.iterdir() if p.is_dir()] if home.is_dir() else []
        return out


def _unit_value(text, key):
    m = re.search(rf"^\s*{key}\s*=\s*(.+)$", text or "", re.M)
    return m.group(1).strip() if m else None


def installs(m):
    """Every CloudWall set up to run here: [{"kind", "user", "unit", "config", "data", "active", "enabled"}]."""
    out = []
    unit = m.read("/etc/systemd/system/cloudwall.service")
    if unit is not None:
        active = m.ask(["systemctl", "is-active", "cloudwall"])
        enabled = m.ask(["systemctl", "is-enabled", "cloudwall"])
        out.append({"kind": "system", "user": _unit_value(unit, "User") or "root", "unit": "/etc/systemd/system/cloudwall.service",
                    "config": "/etc/cloudwall/config.toml", "data": "/var/lib/cloudwall",
                    "active": active.stdout.strip() == "active" if active else None,
                    "enabled": enabled.stdout.strip() == "enabled" if enabled else None})
    for user, home in m.homes():
        path = f"{home}/.config/systemd/user/cloudwall.service"
        unit = m.read(path)
        if unit is None:
            continue
        workdir = _unit_value(unit, "WorkingDirectory") or ""
        configs = [f"{workdir}/config.toml", f"{home}/.config/cloudwall/config.toml"]
        wants = m.path(f"{home}/.config/systemd/user/default.target.wants/cloudwall.service")
        active = m.ask(["runuser", "-u", user, "--", "systemctl", "--user", "is-active", "cloudwall"]) if m.real and os.geteuid() == 0 else None
        out.append({"kind": "user", "user": user, "unit": path, "checkout": workdir,
                    "config": next((c for c in configs if m.path(c).exists()), None),
                    "data": f"{home}/.local/share/cloudwall",
                    "active": active.stdout.strip() == "active" if active else None,
                    "enabled": wants.exists() or wants.is_symlink(),
                    "linger": m.path(f"/var/lib/systemd/linger/{user}").exists()})
    return out


def check_installs(m):
    found = installs(m)
    if not found:
        if m.read("/etc/systemd/system/cloudwall-station.service") is None:    # a receiver's station says itself
            yield health.off("install", "CloudWall isn't set up as a service on this machine")
        return
    for i in found:
        where = f"{i['kind']} service ({i['unit']})"
        yield health.ok("install", f"{where}: settings {i['config'] or 'none'}, data {i['data']}"
                        + ("" if i["active"] is None else ", running" if i["active"] else ", not running"))
        if i["kind"] == "user" and not (i["enabled"] or i["active"]):
            yield health.off("install", f"{i['user']}'s old per-user service is turned off (its files can go: MIGRATION.md, "
                                        "'When you're happy')")
        elif i["kind"] == "user":
            yield health.trouble("service.legacy", f"CloudWall runs as {i['user']}'s per-user service from {i.get('checkout')}")
            if i["enabled"] and not i["linger"]:
                f = health.trouble("service.no-linger", f"{i['user']}'s CloudWall starts only while {i['user']} is logged in")
                f.steps = [s.replace("<user>", i["user"]) for s in f.steps]
                yield f
        if i["kind"] == "system":
            if i["enabled"] is False:
                yield health.trouble("service.disabled")
            if i["active"] is False:
                yield health.trouble("service.down")
    running = [i for i in found if i["enabled"]]
    if len(running) > 1:
        yield health.trouble("service.duplicate", "CloudWall is set up to start " + " and ".join(
            f"as {i['kind']} service ({i['user']})" for i in running))


def check_files(m):
    """Settings readable by everyone while holding keys, and files not the service's to write."""
    for i in installs(m):
        cfg = i.get("config")
        text = m.read(cfg) if cfg else None
        if text is None:
            continue
        holds = re.search(r'^\s*(key|api_key)\s*=\s*"[^"]+"', text, re.M) or re.search(r'^\s*url\s*=\s*".*key=', text, re.M)
        mode = m.path(cfg).stat().st_mode & 0o777
        if holds and mode & 0o004:
            yield health.trouble("settings.readable", f"{cfg} holds keys and is readable by every account (mode {mode:o})")
        if i["kind"] == "system" and m.real:
            import pwd
            try:
                uid = pwd.getpwnam(i["user"]).pw_uid
            except KeyError:
                continue
            wrong = [str(p) for p in [m.path(i["data"]), *m.path(i["data"]).glob("*.db"), m.path(cfg)]
                     if p.exists() and p.stat().st_uid != uid]
            if wrong:
                yield health.trouble("storage.unwritable", f"not the service's ({i['user']}): {', '.join(wrong[:3])}"
                                     + (f" and {len(wrong) - 3} more" if len(wrong) > 3 else ""))


def check_key_in_log(m):
    """Older CloudWall wrote the private link's key at every start: is it still in the journal?"""
    for i in installs(m):
        cmd = (["journalctl", "-u", "cloudwall", "--no-pager", "-o", "cat", "-n", "20000"] if i["kind"] == "system" else
               ["journalctl", f"_UID={i['user']}", "--user-unit", "cloudwall", "--no-pager", "-o", "cat", "-n", "20000"])
        got = m.ask(cmd)
        if got is not None and re.search(r"answering only under /k/[a-z0-9-]{12,}/", got.stdout or ""):
            yield health.trouble("access.key-in-log", f"the {i['kind']} service's log has the private link's key in it")


def check_tunnel(m):
    """Either end of the reverse tunnel (deploy/feed-tunnel): the server's restricted account, or
    the receiver's service."""
    keys = m.read("/var/lib/adsbtunnel/.ssh/authorized_keys")
    if keys is not None:
        lines = [l for l in keys.splitlines() if l.strip() and not l.startswith("#")]
        loose = [l for l in lines if not (l.startswith("restrict") and "permitlisten=" in l)]
        yield health.ok("tunnel", f"this is the tunnel's server end: {len(lines)} key(s) for the receiver")
        if loose:
            yield health.trouble("tunnel.unrestricted", f"{len(loose)} of the tunnel account's keys lack their restrictions")
        sshd = m.read("/etc/ssh/sshd_config") or ""
        drop_ins = m.path("/etc/ssh/sshd_config.d")
        if drop_ins.is_dir():
            sshd += "".join(p.read_text(errors="replace") for p in sorted(drop_ins.glob("*.conf")))
        if not re.search(r"^\s*ClientAliveInterval\s+[1-9]", sshd, re.M | re.I):
            yield health.trouble("tunnel.no-keepalive")
        listening = m.ask(["ss", "-ltnH", "sport = :18080"])
        if listening is not None and not listening.stdout.strip():
            yield health.trouble("tunnel.down", "nothing is listening on the tunnel's port (18080): the receiver isn't connected")
    unit = m.read("/etc/systemd/system/adsb-tunnel.service")
    if unit is not None:
        active = m.ask(["systemctl", "is-active", "adsb-tunnel"])
        state = active.stdout.strip() if active else None
        yield (health.ok("tunnel", "this is the tunnel's receiver end: adsb-tunnel.service is running") if state in (None, "active")
               else health.trouble("tunnel.down", f"adsb-tunnel.service is {state}"))


def check_caddy(m):
    caddyfile = m.read("/etc/caddy/Caddyfile")
    if caddyfile is None:
        return
    site = m.read("/etc/caddy/cloudwall.caddy")
    proxies = re.search(r"reverse_proxy\s+\S*:5050", caddyfile + (site or ""))
    if not proxies:
        return
    yield health.ok("caddy", "Caddy puts CloudWall on the internet")
    if re.search(r"^\s*#\s*basic_?auth", caddyfile, re.M | re.I):
        yield health.trouble("caddy.auth-removed")
    active = m.ask(["systemctl", "is-active", "caddy"])
    if active is not None and active.stdout.strip() != "active":
        yield health.trouble("caddy.down", f"caddy.service is {active.stdout.strip()}")


def check_receiver_side(m):
    """What was set up around a receiver: Coverage3D on its own, the sharing page left running, the
    CloudWall station; and on a receiver itself, its own state (sense/station.py)."""
    if m.read("/etc/systemd/system/cloudwall-station.service") is not None:
        active = m.ask(["systemctl", "is-active", "cloudwall-station"])
        state = active.stdout.strip() if active else None
        yield (health.ok("receiver", "the CloudWall station is running (it reports this receiver to the wall)") if state in (None, "active")
               else health.trouble("receiver.station-down", f"cloudwall-station.service is {state}"))
    if m.real:
        from ..sense import station
        f = station.facts()
        if station.is_receiver(f):
            yield from station.findings(f)
    if m.read("/etc/systemd/system/coverage3d.service") is not None:
        yield health.trouble("coverage3d.separate")
    procs = m.ask(["pgrep", "-af", "sharing_guide.py"])
    if procs is not None and procs.stdout.strip():
        yield health.trouble("sharing.root-page", f"running: {procs.stdout.strip().splitlines()[0][:80]}")
    if m.path("/opt/adsb").is_dir():
        yield health.ok("receiver", "this is an adsb.im receiver (tools/adsb_check.sh checks its reception)")


def check_backups(m):
    for i in installs(m):
        folder = m.path(i["data"]) / "backups"
        newest = max((p.stat().st_mtime for p in folder.glob("cloudwall-*.tar.gz")), default=None) if folder.is_dir() else None
        if newest is None or time.time() - newest > 30 * 86400:
            yield health.trouble("backup.none", f"the {i['kind']} install's newest backup is "
                                 + ("missing" if newest is None else f"{(time.time() - newest) / 86400:.0f} days old"))


CHECKS = [("install", check_installs), ("files", check_files), ("access", check_key_in_log), ("tunnel", check_tunnel),
          ("caddy", check_caddy), ("receiver", check_receiver_side), ("backup", check_backups)]


def survey(machine=None):
    m = machine or Machine()
    return health.run(m, [(part, fn) for part, fn in CHECKS])

