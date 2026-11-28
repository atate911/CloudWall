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
        for suffix, what in ((".good", "settings (the last that started)"), (".before", "settings (before the last change)")):
            extra = Path(str(config_path) + suffix)
            if extra.exists():
                out.append((what, extra, f"config/config.toml{suffix}"))
        owner = Path(config_path).with_name("owner")
        if owner.exists():
            out.append(("the owner's password (hashed)", owner, "config/owner"))
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


def _write(out, manifest, files, say):
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


def backup(config_path=None, to=None, say=print, cfg=None):
    """Write a backup; returns its path. cfg: the settings in use, where they are more than the
    file's (a running CloudWall started with --db keeps its logbooks somewhere the file doesn't say)."""
    path = config.find(config_path)
    cfg = cfg or config.load(config_path)
    data, files = _files(cfg, path)
    to_file = bool(to) and str(to).endswith(".tar.gz")          # a file named, or else a folder to put it in
    folder = Path(to).parent if to_file else Path(to or default_folder(cfg))
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = Path(to) if to_file else folder / f"cloudwall-{socket.gethostname()}-{stamp}.tar.gz"
    manifest = {"cloudwall": __version__, "made": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "host": socket.gethostname(),
                "files": [{"what": what, "name": name, "from": str(p)} for what, p, name in files]}
    part = out.with_name(out.name + ".part")       # under its own name only once it is whole
    try:
        _write(part, manifest, files, say)
        os.replace(part, out)
    finally:
        part.unlink(missing_ok=True)
    if not to_file:                    # a folder of them keeps the last few
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
             "config/config.toml.before": Path(str(path) + ".before"), "config/owner": Path(path).with_name("owner"),
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
            # a file replaced stays whose it was, and as readable (the panel's address is its
            # desktop user's to read, not the service's); a new one is the service's
            was = target.stat() if target.exists() else None
            tmp = target.with_name(target.name + ".restoring")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            if was:
                os.chmod(tmp, was.st_mode & 0o777)
                if os.geteuid() == 0:
                    os.chown(tmp, was.st_uid, was.st_gid)
            os.replace(tmp, target)
            if installed and not was:
                system.chown(str(target), "cloudwall", "cloudwall")
            written.append(target)
    if installed:
        system.run(["systemctl", "start", "cloudwall"], check=False)
    say(f"Restored {len(written)} files." + ("" if installed else " Restart CloudWall to use them."))
    return written
