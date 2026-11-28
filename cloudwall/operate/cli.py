"""The `cloudwall <command>` commands that set CloudWall up and look after it. Plain `cloudwall`
(with its flags: --demo, --private-link, ...) runs it, as it always has (app/main.py)."""
import argparse
import json
import os
import re
import sys

from ..core import config, health
from . import backup as backups, doctor as doc, install as inst
from .system import System

COMMANDS = ("upgrade", "rollback", "install", "uninstall", "doctor", "backup", "restore", "report",
            "owner", "helper")


def parser():
    ap = argparse.ArgumentParser(prog="cloudwall", description="Set up and look after CloudWall.")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("upgrade", help="from whatever runs here now to this code, in place: back up, update, move an "
                                       "old setup over, check (run with sudo, from the new code)")
    p.add_argument("--root", default="/", help=argparse.SUPPRESS)
    p.add_argument("--dry-run", action="store_true", help="say what would change, change nothing")

    p = sub.add_parser("rollback", help="back to the release before the last update")
    p.add_argument("--root", default="/", help=argparse.SUPPRESS)

    p = sub.add_parser("install", help="set this machine up (run with sudo); again after an update",
                       description="Set this machine up for CloudWall, or bring it up to date: run it again after "
                                   "an update (from the new code) and only what changed is changed.")
    p.add_argument("--role", choices=sorted(inst.ROLES), default="wall",
                   help="wall: serves the screens (the default); panel: a screen, full-screen at a wall")
    p.add_argument("--public", metavar="NAME", help="(wall) put it on the internet at this name, through Caddy")
    p.add_argument("--wall", metavar="URL", help="(panel) the wall it shows, with its key if it has one")
    p.add_argument("--desktop-user", metavar="USER", help="(panel) whose desktop shows it (default: who ran sudo)")
    p.add_argument("--no-start", action="store_true", help="set up but don't start or restart the service")
    p.add_argument("--root", default="/", help=argparse.SUPPRESS)
    p.add_argument("--dry-run", action="store_true", help="say what would change, change nothing")

    p = sub.add_parser("uninstall", help="take CloudWall off this machine (settings and logbooks kept)")
    p.add_argument("--role", choices=sorted(inst.ROLES), default="wall")
    p.add_argument("--purge", action="store_true", help="also delete the settings, logbooks and caches")
    p.add_argument("--desktop-user", metavar="USER")
    p.add_argument("--root", default="/", help=argparse.SUPPRESS)
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("doctor", help="check every part, and say what to do about anything wrong")
    p.add_argument("--offline", action="store_true", help="don't ask the feeds")
    p.add_argument("--json", action="store_true", help="the findings as JSON")
    p.add_argument("--fix", action="store_true",
                   help="fix what was found: at a terminal, go through each problem with you (repairs offered, "
                        "what's needed asked for, the steps walked through); otherwise only the repairs, each said")
    p.add_argument("--yes", action="store_true", help="with --fix: make the repairs without asking")

    p = sub.add_parser("backup", help="settings and logbooks into one file")
    p.add_argument("--to", metavar="PATH", help="a file or folder (default: backups/ beside the logbooks)")

    p = sub.add_parser("restore", help="put a backup's files back")
    p.add_argument("archive")
    p.add_argument("--yes", action="store_true", help="really replace the files (without it, only says what)")

    sub.add_parser("report", help="a report to paste when asking for help (keys and positions masked)")

    p = sub.add_parser("owner", help="set the owner's password for the control board (/admin)")
    p.add_argument("--remove", action="store_true", help="take the owner's password away")

    sub.add_parser("helper", help=argparse.SUPPRESS)        # run by cloudwall-helper.service, as root
    for p in sub.choices.values():
        p.add_argument("--config", help="the settings file (default: as CloudWall finds it)")
    return ap


SECRET = re.compile(r"(?im)^(\s*(?:\w*key|\w*url|address|zip|attribution)\s*=\s*)(\".*?\"|'.*?')")
LISTED = re.compile(r"(?ims)^(\s*\w*urls\s*=\s*)\[.*?\]")          # a list of addresses, on one line or several
NUMBER = re.compile(r"(?im)^(\s*(?:lat|lon)\s*=\s*)(-?\d+\.\d{2})\d*")


def mask(text):
    """A settings file fit to share: keys and URLs (which may carry keys) hidden, positions to ~1 km."""
    text = LISTED.sub(lambda m: m.group(1) + '["…"]', text)
    text = SECRET.sub(lambda m: m.group(1) + ('"…"' if len(m.group(2)) > 2 else m.group(2)), text)
    return NUMBER.sub(lambda m: m.group(1) + m.group(2), text)


def main(argv=None):
    args = parser().parse_args(argv)
    cmd = args.command
    if cmd == "upgrade":
        from .upgrade import upgrade
        upgrade(System(args.root, args.dry_run))
        return
    if cmd == "rollback":
        if args.root == "/" and os.geteuid() != 0:
            raise SystemExit("cloudwall rollback changes the system: run it with sudo")
        print(f"Back on {inst.rollback(System(args.root))}. `cloudwall doctor` says how it stands.")
        return
    if cmd == "install":
        system = System(args.root, args.dry_run)
        inst.install(inst.Options(args.role, args.public, args.wall, args.desktop_user, start=not args.no_start), system)
        if not system.done:
            print("Nothing to change: this machine is set up already.")
        elif args.role == "wall" and not args.dry_run:
            print(f"\nCloudWall is installed. Settings: {inst.CONFIG} (set [home] there, then "
                  "`sudo systemctl restart cloudwall`). Check it with `cloudwall doctor`.")
    elif cmd == "uninstall":
        inst.uninstall(args.role, args.purge, args.desktop_user, System(args.root, args.dry_run))
    elif cmd == "doctor":
        found, worst = doc.doctor(args.config, args.offline, ask=System().ask)
        if args.fix:
            from . import guide, repair
            from .survey import Machine
            system, machine = System(), Machine()
            ctx = doc.Context(args.config, args.offline, System().ask)
            if sys.stdin.isatty() and not args.yes:          # with the owner: explain, ask, walk through
                guide.walk(found, guide.Terminal(), ctx, system, machine,
                           recheck=lambda: doc.doctor(args.config, args.offline, ask=System().ask)[0])
                return
            done = repair.fix(found, system, machine)        # unattended: only the repairs, each said
            if done:
                print()
                found, worst = doc.doctor(args.config, args.offline, ask=System().ask)
            else:
                print("Nothing found that `--fix` can repair unattended.\n")
        if args.json:
            print(json.dumps([f.to_dict() for f in found], indent=1))
        else:
            print(health.render(found))
            print({"ok": "\nAll is well.", "warn": "\nWorking, with something worth a look above.",
                   "fail": "\nSomething above needs fixing."}.get(worst, ""))
            if not args.fix and any(f.repair and not f.auto and f.state in ("warn", "fail") for f in found):
                print("`cloudwall doctor --fix` (with sudo where it says) can repair what is marked so.")
        sys.exit(2 if worst == health.FAIL else 0)
    elif cmd == "backup":
        backups.backup(args.config, args.to)
    elif cmd == "restore":
        backups.restore(args.archive, args.config, args.yes, System())
    elif cmd == "owner":
        import getpass
        from ..core import keys as auth
        path = auth.owner_file(args.config)
        if args.remove:
            path.unlink(missing_ok=True)
            print(f"The owner's password is taken away ({path}). Until one is set again, the control board "
                  "changes things only from this machine.")
            return
        first = getpass.getpass("The owner's password (at least %d characters): " % auth.MIN_PASSWORD)
        if getpass.getpass("Again: ") != first:
            raise SystemExit("cloudwall owner: the two didn't match; nothing changed")
        try:
            where = auth.set_password(first, args.config)
        except (ValueError, OSError) as e:
            raise SystemExit(f"cloudwall owner: {e}")
        try:
            port = config.load(args.config)["server"]["port"]
        except Exception:
            port = 5050
        print(f"Set ({where}). Sign in on the control board: http://<this machine>:{port}/admin")
    elif cmd == "helper":
        from . import helper
        if os.geteuid() != 0:
            raise SystemExit("cloudwall helper is run by systemd, as root")
        helper.run_pending()
    elif cmd == "report":
        found, _ = doc.doctor(args.config, offline=False, ask=System().ask)
        path = config.find(args.config)
        print("CloudWall report (keys, URLs and positions masked: read it before you share it)\n")
        print(health.render(found))
        if path and path.exists():
            print(f"\n--- {path} ---\n" + mask(path.read_text()))


def is_command(argv):
    return bool(argv) and argv[0] in COMMANDS
