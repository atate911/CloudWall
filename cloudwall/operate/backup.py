"""`cloudwall backup` and `cloudwall restore`: everything that can't be downloaded again, in one
file, and back.

A backup holds the settings, every logbook (taken with SQLite's own backup, so it is whole even
while CloudWall is writing), places.json, and a manifest saying what CloudWall, which machine and
when. Not the map tiles or logos: they are downloaded again as they are needed.

Restoring a backup replaces those files. It says what it will replace and does nothing without
--yes. On a system install it stops the service first, gives the files back to the service's
user and starts it again.

What a backup can't hold is listed by `cloudwall help rebuild`: adsb.im's own settings, the
receiver's SDR serials, DNS and the firewall.
"""
import copy
import io
import json
import os
import socket
import sqlite3
import tarfile
import tempfile
import time
from pathlib import Path

from .. import __version__
from ..core import config

KEEP = 7                       # backups kept in the default folder; older ones are removed


def _files(cfg, config_path):
    """(what, path on this machine, name in the backup) for each thing a backup holds."""
    db = Path(cfg["storage"]["db_path"] or config.default_db_path()).expanduser()
    out = []
    if config_path and Path(config_path).exists():
        out.append(("settings", Path(config_path), "config/config.toml"))
        good = Path(str(config_path) + ".good")
        if good.exists():
            out.append(("settings (last good)", good, "config/config.toml.good"))
    panel = Path(config_path).with_name("panel.conf") if config_path else None
    if panel and panel.exists():
        out.append(("the panel's address", panel, "config/panel.conf"))
    if db.parent.exists():
        for f in sorted(db.parent.glob("*.db")):
            out.append((f"logbook {f.name}", f, f"data/{f.name}"))
        places = db.parent / "places.json"
        if places.exists():
            out.append(("places set up from a screen", places, "data/places.json"))
    return db.parent, out


def default_folder(cfg):
    db = Path(cfg["storage"]["db_path"] or config.default_db_path()).expanduser()
    return db.parent / "backups"


def backup(config_path=None, to=None, say=print):
    """Write a backup; returns its path."""
    path = config.find(config_path)
    cfg = config.load(config_path)
    data, files = _files(cfg, path)
    folder = Path(to).parent if to and not Path(to).is_dir() else Path(to or default_folder(cfg))
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = Path(to) if to and not Path(to).is_dir() else folder / f"cloudwall-{socket.gethostname()}-{stamp}.tar.gz"
    manifest = {"cloudwall": __version__, "made": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "host": socket.gethostname(),
                "files": [{"what": what, "name": name, "from": str(p)} for what, p, name in files]}
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)      # it holds keys: the owner's alone
    with os.fdopen(fd, "wb") as raw, tarfile.open(fileobj=raw, mode="w:gz") as tar:
        body = json.dumps(manifest, indent=1).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size, info.mtime = len(body), time.time()
        tar.addfile(info, io.BytesIO(body))
        for what, p, name in files:
            if p.suffix == ".db":
                with tempfile.TemporaryDirectory() as tmp:
                    copy = Path(tmp) / p.name
                    src = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=10)
                    dst = sqlite3.connect(copy)
                    try:
                        src.backup(dst)
                    finally:
                        dst.close()
                        src.close()
                    tar.add(copy, name)
            else:
                tar.add(p, name)
            say(f"  {what}: {p}")
    if not to:                         # the default folder keeps the last few
        for old in sorted(folder.glob("cloudwall-*.tar.gz"))[:-KEEP]:
            old.unlink()
    say(f"Backup written: {out}")
    return out


def read_manifest(archive):
    with tarfile.open(archive, "r:gz") as tar:
        return json.loads(tar.extractfile("manifest.json").read())


def restore(archive, config_path=None, yes=False, system=None, say=print):
    """Put a backup's files back where this machine keeps them. Returns the files written."""
    manifest = read_manifest(archive)
    path = config.find(config_path) or config.user_config_path()
    try:
        cfg = config.load(config_path)
    except Exception:                  # the file being replaced may be the broken one
        cfg = copy.deepcopy(config.DEFAULTS)
    db = Path(cfg["storage"]["db_path"] or config.default_db_path()).expanduser()
    where = {"config/config.toml": Path(path), "config/config.toml.good": Path(str(path) + ".good"),
             "config/panel.conf": Path(path).with_name("panel.conf")}
    plan = []
    for f in manifest["files"]:
        name = f["name"]
        target = where.get(name) or (db.parent / Path(name).name if name.startswith("data/") else None)
        if target is None or Path(name).name in ("..", "") or "/" in Path(name).name:
            continue
        plan.append((f["what"], name, target))
    say(f"Backup of {manifest['host']}, made {manifest['made']} by CloudWall {manifest['cloudwall']}:")
    for what, name, target in plan:
        say(f"  {what} -> {target}" + ("  (replaces the file there)" if target.exists() else ""))
    if not yes:
        say("Nothing changed. Run again with --yes to restore these.")
        return []
    installed = system is not None and system.real and Path("/etc/systemd/system/cloudwall.service").exists()
    if installed:
        system.run(["systemctl", "stop", "cloudwall"], check=False)
    written = []
    with tarfile.open(archive, "r:gz") as tar:
        for what, name, target in plan:
            data = tar.extractfile(name).read()
            target.parent.mkdir(parents=True, exist_ok=True)
            for suffix in ("-wal", "-shm"):                 # a logbook's journal belongs to the file replaced
                Path(str(target) + suffix).unlink(missing_ok=True)
            tmp = target.with_name(target.name + ".restoring")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, target)
            if installed:
                system.chown(str(target), "cloudwall", "cloudwall")
            written.append(target)
    if installed:
        system.run(["systemctl", "start", "cloudwall"], check=False)
    say(f"Restored {len(written)} files." + ("" if installed else " Restart CloudWall to use them."))
    return written
