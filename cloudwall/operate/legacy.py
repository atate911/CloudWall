"""`sudo cloudwall migrate-legacy`: from the way CloudWall used to be set up (`make service`: a
per-user service running from a git checkout, its settings and logbooks in a home folder) to the
system install, once, without losing anything.

It finds the old settings (./config.toml in the checkout, or ~/.config/cloudwall/config.toml),
logbooks, places.json and caches of the user who ran sudo; stops and disables the old user
service, so the two don't fight over port 5050; copies the settings and logbooks into
/etc/cloudwall and /var/lib/cloudwall (taking each logbook with SQLite's backup, so it is whole);
moves the caches (they are only downloads); and gives them all to the service's user. The old
files are left where they were, to be deleted by hand once the new install is seen to work.

Run `sudo cloudwall install` first: this fills in what it set up.
"""
import os
import shutil
import sqlite3
from pathlib import Path

from . import install as inst


def legacy_user():
    user = os.environ.get("SUDO_USER")
    if not user or user == "root":
        raise SystemExit("cloudwall migrate-legacy: run it with sudo from the account that ran CloudWall before")
    return user


def find_old(home, checkout):
    """What the old setup left: {"config": path or None, "data": folder or None, "unit": path or None}."""
    configs = [Path(checkout) / "config.toml", home / ".config/cloudwall/config.toml"]
    data = home / ".local/share/cloudwall"
    unit = home / ".config/systemd/user/cloudwall.service"
    return {"config": next((c for c in configs if c.exists()), None),
            "data": data if data.exists() else None,
            "unit": unit if unit.exists() else None}


def migrate(system, home, user, checkout, force=False, say=print):
    old = find_old(home, checkout)
    if not any(old.values()):
        say("Nothing of the old setup found: nothing to do.")
        return old
    if not system.exists(inst.CONFIG) and not system.dry_run:
        raise SystemExit("cloudwall migrate-legacy: run `sudo cloudwall install` first, then this")
    if old["unit"]:
        uid = system.ask(["id", "-u", user])
        runtime = f"/run/user/{uid.stdout.strip()}" if uid is not None and uid.returncode == 0 else ""
        system.run(["runuser", "-u", user, "--", "env", f"XDG_RUNTIME_DIR={runtime}",
                    "systemctl", "--user", "disable", "--now", "cloudwall"], check=False)
    if old["config"]:
        current = system.read(inst.CONFIG) or ""
        example = inst.paths.EXAMPLE.read_text()
        if current.strip() and current != example and not force:
            say(f"{inst.CONFIG} has settings of its own already: kept (--force replaces it with {old['config']})")
        else:
            system.write(inst.CONFIG, Path(old["config"]).read_text(), mode=0o640, owner=inst.USER, group=inst.USER)
    if old["data"]:
        for db in sorted(Path(old["data"]).glob("*.db")):
            target = system.path(f"{inst.VAR}/{db.name}")
            if target.exists() and not force:
                say(f"{inst.VAR}/{db.name} is there already: kept (--force replaces it)")
                continue
            system._did(f"copy logbook {db} to {inst.VAR}/{db.name}")
            if not system.dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                src, dst = sqlite3.connect(f"file:{db}?mode=ro", uri=True), sqlite3.connect(target)
                try:
                    src.backup(dst)
                finally:
                    dst.close()
                    src.close()
                system.chown(f"{inst.VAR}/{db.name}", inst.USER, inst.USER)
        places = Path(old["data"]) / "places.json"
        if places.exists():
            system.write(f"{inst.VAR}/places.json", places.read_bytes(), mode=0o640, owner=inst.USER, group=inst.USER)
        for name in ("tiles", "logos"):
            src = Path(old["data"]) / name
            if src.is_dir() and not system.exists(f"{inst.CACHE}/{name}"):
                system._did(f"move {src} to {inst.CACHE}/{name}")
                if not system.dry_run:
                    system.path(inst.CACHE).mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), system.path(f"{inst.CACHE}/{name}"))
                    if system.real:
                        system.run(["chown", "-R", f"{inst.USER}:{inst.USER}", f"{inst.CACHE}/{name}"], quiet=True)
    system.run(["systemctl", "restart", "cloudwall"], check=False)
    say("Done. The old files are still where they were; delete them once the new install is seen to work:")
    for what in ("config", "data", "unit"):
        if old[what]:
            say(f"  {old[what]}")
    return old
