"""`sudo python3 -m cloudwall upgrade`: from whatever this machine runs now to this code, in place,
in one command, as often as wanted: the settings checked against the new code, a backup made, the
code installed beside the old and the service restarted into it (install.py), the result checked
(doctor), and how to go back said (`cloudwall rollback`).
"""
import os
from pathlib import Path

from ..core import health
from . import backup as backups, doctor as doc, install as inst
from .survey import Machine, installs


def upgrade(system, source=None, say=print):
    if system.real and os.geteuid() != 0 and not system.dry_run:
        raise SystemExit("cloudwall upgrade changes the system: run it with sudo")
    found = installs(Machine(system.root))
    say("Found: " + ("the system service" if found else "nothing set up yet"))
    if found:
        inst.preflight(system, None, "the settings wouldn't start with this code, so nothing was changed")
    if found and not system.dry_run:               # a backup first: settings and every logbook
        saved = os.environ.get("CLOUDWALL_DATA")
        os.environ["CLOUDWALL_DATA"] = str(system.path(inst.VAR))
        try:
            out = backups.backup(system.path(inst.CONFIG), Path(system.path(inst.VAR)) / "backups", say=lambda *a: None)
            for p in (out.parent, out):                # the folder stays the service's to write in
                system.chown("/" + str(p.relative_to(system.root)), inst.USER, inst.USER)
            say(f"Backed up first: {out}")
        except Exception as e:
            raise SystemExit(f"cloudwall upgrade: the backup failed, so nothing was changed: {e}")
        finally:
            if saved is None:
                os.environ.pop("CLOUDWALL_DATA", None)
            else:
                os.environ["CLOUDWALL_DATA"] = saved
    inst.install(inst.Options("wall", source=source), system)
    if system.real and not system.dry_run:
        found, worst = doc.doctor(str(system.path(inst.CONFIG)), offline=True, ask=system.ask)
        bad = [f for f in found if f.state in (health.WARN, health.FAIL)]
        say("")
        say(health.render(bad) if bad else "Checked: all well.")
    say("\nNothing was changed (--dry-run)." if system.dry_run else "\nUpdated. To go back to the release before: sudo cloudwall rollback")
