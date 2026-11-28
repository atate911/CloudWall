"""The checks `cloudwall doctor` runs on the machine itself (service, files, tunnel, Caddy,
Coverage3D). Everything goes through a Machine, so tests build a pretend machine in a folder.
"""
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


def _unit_value(text, key):
    m = re.search(rf"^\s*{key}\s*=\s*(.+)$", text or "", re.M)
    return m.group(1).strip() if m else None


def installs(m):
    """[] or [{"kind": "system", "user", "unit", "config", "data", "active", "enabled"}] (the last two None if unknown)."""
    unit = m.read("/etc/systemd/system/cloudwall.service")
    if unit is None:
        return []
    active = m.ask(["systemctl", "is-active", "cloudwall"])
    enabled = m.ask(["systemctl", "is-enabled", "cloudwall"])
    return [{"kind": "system", "user": _unit_value(unit, "User") or "root", "unit": "/etc/systemd/system/cloudwall.service",
             "config": "/etc/cloudwall/config.toml", "data": "/var/lib/cloudwall",
             "active": active.stdout.strip() == "active" if active else None,
             "enabled": enabled.stdout.strip() == "enabled" if enabled else None}]


def check_installs(m):
    found = installs(m)
    if not found:
        yield health.off("install", "CloudWall isn't set up as a service on this machine")
    for i in found:
        yield health.ok("install", f"system service ({i['unit']}): settings {i['config']}, data {i['data']}"
                        + ("" if i["active"] is None else ", running" if i["active"] else ", not running"))
        if i["enabled"] is False:
            yield health.trouble("service.disabled")
        if i["active"] is False:
            yield health.trouble("service.down")


def check_files(m):
    for i in installs(m):
        cfg = i.get("config")
        text = m.read(cfg) if cfg else None
        if text is None:
            continue
        holds = re.search(r'^\s*(key|api_key)\s*=\s*"[^"]+"', text, re.M) or re.search(r'^\s*url\s*=\s*".*key=', text, re.M)
        mode = m.path(cfg).stat().st_mode & 0o777
        if holds and mode & 0o004:
            yield health.trouble("settings.readable", f"{cfg} holds keys and is readable by every account (mode {mode:o})")
        if m.real:
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
        got = m.ask(["journalctl", "-u", "cloudwall", "--no-pager", "-o", "cat", "-n", "20000"])
        if got is not None and re.search(r"answering only under /k/[a-z0-9-]{12,}/", got.stdout or ""):
            yield health.trouble("access.key-in-log", f"the {i['kind']} service's log has the private link's key in it")


def check_tunnel(m):
    """Either end of the reverse tunnel (deploy/feed-tunnel)."""
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
    if m.read("/etc/systemd/system/coverage3d.service") is not None:
        yield health.trouble("coverage3d.separate")
    if m.path("/opt/adsb").is_dir():
        yield health.ok("receiver", "this is an adsb.im receiver")


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

