"""`sudo python3 -m cloudwall upgrade`: from whatever this machine runs now to this code, in place,
in one command, as often as wanted.

  1. Look at what is set up here (survey.installs): nothing yet, the old per-user service
     (`make service`), or the system install.
  2. Back up first, whichever it is: settings and every logbook, into one file, kept.
  3. Install or update (install.py): the new code beside the old, the settings checked against it
     before anything restarts (the running CloudWall is left alone if they wouldn't start).
  4. An old per-user setup found: move its settings and logbooks over and turn it off (legacy.py).
  5. Check the result (doctor) and say how it stands, and how to go back (`cloudwall rollback`).

MIGRATION.md walks through it for a server and a receiver as they were set up before.
"""
import os
from pathlib import Path

from ..core import health
from . import backup as backups, doctor as doc, install as inst, legacy
from .survey import Machine, installs


def upgrade(system, source=None, say=print):
    if system.real and os.geteuid() != 0 and not system.dry_run:
        raise SystemExit("cloudwall upgrade changes the system: run it with sudo")
    found = installs(Machine(system.root))
    # an old per-user setup still in use (one already moved over is left disabled, its files kept)
    old = next((i for i in found if i["kind"] == "user" and (i["enabled"] or i["active"])), None)
    sysinst = next((i for i in found if i["kind"] == "system"), None)
    say("Found: " + ("; ".join(f"the {i['kind']} service ({i['user']})" for i in found) or "nothing set up yet"))

    # 1b. the settings that will run, checked against this code before anything changes
    if old and old.get("config"):
        inst.preflight(system, system.path(old["config"]), "the old setup's settings wouldn't start with this "
                       "code, so nothing was changed")
    elif sysinst:
        inst.preflight(system, None, "the settings wouldn't start with this code, so nothing was changed")

    # 2. a backup first, of whichever setup holds the settings and logbooks now
    src = sysinst or old
    if src and src.get("config") and not system.dry_run:
        saved = os.environ.get("CLOUDWALL_DATA")
        os.environ["CLOUDWALL_DATA"] = str(system.path(src["data"]))
        try:
            out = backups.backup(system.path(src["config"]), Path(system.path(inst.VAR)) / "backups"
                                 if sysinst else system.path(src["data"]) / "backups", say=lambda *a: None)
            owner = inst.USER if sysinst else old["user"]       # the folder stays its owner's to write in
            for p in (out.parent, out):
                system.chown("/" + str(p.relative_to(system.root)), owner, owner)
            say(f"Backed up first: {out}")
        except Exception as e:
            raise SystemExit(f"cloudwall upgrade: the backup failed, so nothing was changed: {e}")
        finally:
            if saved is None:
                os.environ.pop("CLOUDWALL_DATA", None)
            else:
                os.environ["CLOUDWALL_DATA"] = saved

    # 3. install or update in place. With an old per-user service still running, nothing is started
    #    yet: it holds the port, and the new service would make an empty logbook of its own first.
    inst.install(inst.Options("wall", source=source, start=not old), system)

    # 4. the old per-user setup moved over
    if old:
        say("Moving the old per-user setup onto the system install…")
        home = Path(old["data"]).parents[2]
        legacy.migrate(system, system.path(str(home)) if not system.real else home, old["user"],
                       old.get("checkout") or home, say=say)

    # 5. how it stands
    if system.real and not system.dry_run:
        found, worst = doc.doctor(str(system.path(inst.CONFIG)), offline=True, ask=system.ask)
        bad = [f for f in found if f.state in (health.WARN, health.FAIL)]
        say("")
        say(health.render(bad) if bad else "Checked: all well.")
    say("\nUpdated. To go back to the release before: sudo cloudwall rollback")
