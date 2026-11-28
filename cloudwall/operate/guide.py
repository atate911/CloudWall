"""Fixing problems with the owner: `cloudwall doctor --fix` at a terminal (and, with the same
answer() underneath, the control board's forms).

For each problem doctor found, worst first:
  1. what it is and what it means, in plain words;
  2. a repair CloudWall can make by itself, offered (yes or no);
  3. what only the owner knows (the house's ZIP code, a new key, a free port, the time zone),
     asked for, checked, and written where it belongs (troubles.Ask);
  4. otherwise the steps, one at a time, checking again after each, until the problem is gone or
     the owner moves on.

answer(code, name, value, ...) is the one place an answer is checked and used: the terminal and
the control board both go through it, so a ZIP code is checked the same way wherever it is typed.
"""
import getpass
import os
import re
import shutil
import socket
from pathlib import Path

from ..core import config, keys, troubles
from ..core.health import FAIL, ORDER, WARN
from ..reference import airports


class Answered(Exception):
    """An answer that can't be used, in words to show the owner."""


def _config_path(ctx):
    path = ctx.config_path or config.user_config_path()
    if not Path(path).exists():
        config.init(path)
    return Path(path)


def answer(code, name, value, ctx, system=None, machine=None, finding=None):
    """Check one answer to a problem's question (troubles.Ask) and use it. Returns what was done,
    in words; raises Answered with what is wrong with it."""
    value = (value or "").strip() if isinstance(value, str) else value
    path = _config_path(ctx)
    if code == "settings.placeholder":
        loc = airports.locate(value)
        if not loc:
            raise Answered("That isn't a US ZIP code (98683) or coordinates (45.63, -122.66)")
        config.write_setting(path, "home", "lat", round(loc["lat"], 5))
        config.write_setting(path, "home", "lon", round(loc["lon"], 5))
        return f"[home] set to {loc['lat']:.4f}, {loc['lon']:.4f} in {path}; restart CloudWall to use it"
    if code == "settings.broken":
        if not _yes(value):
            return None
        good = Path(f"{path}.good")
        if not good.exists():
            raise Answered("There is no copy of settings that started to put back")
        shutil.copy2(path, Path(f"{path}.before"))
        shutil.copy2(good, path)
        return f"put back {good}; your edit is in {path}.before"
    if code == "settings.ignored":
        m = re.match(r"\[(\w+)\] (\w+)", (finding.summary if finding else "") or "")
        if not m:
            raise Answered("Which setting this is couldn't be worked out: change it in the file")
        section, key = m.groups()
        try:
            config.write_setting(path, section, key, _typed(value, config.DEFAULTS[section].get(key)))
        except ValueError as e:
            raise Answered(str(e)) from None
        return f"[{section}] {key} set to {value!r}; restart CloudWall to use it"
    if code == "routes.key-rejected":
        if not value:
            return None
        cfg = config.load(path)
        name_ = "flightradar24" if cfg["flightradar24"]["api_key"] or not cfg["flightaware"]["api_key"] else "flightaware"
        config.write_setting(path, name_, "api_key", value)
        return f"[{name_}] api_key replaced; restart CloudWall to use it"
    if code == "server.port-taken":
        try:
            port = int(value)
        except ValueError:
            raise Answered("A port is a whole number, such as 5051") from None
        if not 1024 <= port <= 65535:
            raise Answered("Choose a port from 1024 to 65535")
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                raise Answered(f"Port {port} is in use too: try another")
        config.write_setting(path, "server", "port", port)
        return f"[server] port set to {port}; restart CloudWall, and use the new port in bookmarks"
    if code == "clock.timezone":
        import zoneinfo
        try:
            zoneinfo.ZoneInfo(value)
        except Exception:
            raise Answered("That isn't a time zone name: they look like America/Los_Angeles or Europe/London") from None
        if system is None:
            raise Answered(f"Set it with: sudo timedatectl set-timezone {value}")
        system.run(["timedatectl", "set-timezone", value])
        return f"this machine's time zone is now {value}; restart CloudWall so its days follow it"
    if code == "access.key-in-log":
        if not _yes(value):
            return None
        key = keys.new_key()
        config.write_setting(path, "server", "key", key)
        return f"a new private link: .../k/{key}/  (open it on each screen; restart CloudWall to use it)"
    if code == "backup.none":
        if not _yes(value):
            return None
        from .backup import backup
        return f"backup written: {backup(path, say=lambda *a: None)}"
    raise Answered("CloudWall doesn't know how to use an answer to this one: follow the steps")


def _yes(value):
    return str(value).strip().lower() in ("y", "yes", "true", "1", "on")


def _typed(value, like):
    if isinstance(like, bool):
        return _yes(value)
    if isinstance(like, int) and not isinstance(like, bool):
        try:
            return int(value)
        except ValueError:
            return value
    if isinstance(like, float):
        try:
            return float(value)
        except ValueError:
            return value
    return value


class Terminal:
    """Asking at a terminal. (Tests use a scripted one with the same two methods.)"""

    def say(self, text=""):
        print(text)

    def ask(self, question, secret=False):
        try:
            return getpass.getpass(question + " ") if secret else input(question + " ")
        except EOFError:
            return "q"


def walk(findings, io, ctx, system, machine, recheck):
    """Go through the problems with the owner. recheck(): the findings now (doctor again).
    Returns [(code or summary, what happened)]."""
    from .repair import REPAIRS
    todo = sorted([f for f in findings if f.state in (WARN, FAIL)], key=lambda f: (not f.major, ORDER[f.state]))
    if not todo:
        io.say("Nothing to fix: all is well.")
        return []
    io.say(f"{len(todo)} problem(s) to go through, the worst first. Answer q at any question to stop.\n")
    out = []
    for n, f in enumerate(todo, 1):
        io.say(f"── {n} of {len(todo)}: {f.summary}" + ("  (MAJOR)" if f.major else ""))
        if f.subtle:
            io.say("   This looks right on the screens, but isn't.")
        if f.detail:
            io.say(f"   {f.detail}")
        if f.causes:
            io.say("   Usually because " + "; or ".join(f.causes) + ".")
        result = None
        t = troubles.CATALOGUE.get(f.code)
        if f.repair and f.repair in REPAIRS:
            words, root, fn = REPAIRS[f.repair]
            if root and system.real and os.geteuid() != 0:
                io.say(f"   CloudWall can {words}, but that needs sudo: run `sudo cloudwall doctor --fix`.")
            else:
                reply = io.ask(f"   CloudWall can {words}. Do it now? [Y/n/q]").strip().lower()
                if reply == "q":
                    break
                if reply in ("", "y", "yes"):
                    try:
                        result = fn(system, machine) or "nothing needed doing"
                    except Exception as e:
                        result = f"the repair failed: {e}"
                    io.say(f"   {result}")
        if result is None and t and t.asks:
            for a in t.asks:
                while True:
                    hint = f" (e.g. {a.example})" if a.example else (" [y/N]" if a.kind == "yes" else "")
                    reply = io.ask(f"   {a.question}{hint}:", secret=a.kind == "secret")
                    if reply.strip().lower() == "q":
                        io.say("Stopped.")
                        return out
                    try:
                        result = answer(f.code, a.name, reply, ctx, system, machine, f) or "left as it was"
                        io.say(f"   {result}")
                        break
                    except Answered as e:
                        io.say(f"   {e}. Try again, or q to stop.")
                    except Exception as e:
                        result = f"couldn't be done: {e}"
                        io.say(f"   {result}")
                        break
        if result is None and f.steps:
            io.say("   CloudWall can't fix this by itself. The steps, one at a time:")
            for i, step in enumerate(f.steps, 1):
                io.say(f"   {i}. {step}")
                reply = io.ask("      Done? [Enter: next step, c: check again now, s: skip this problem, q: stop]").strip().lower()
                if reply == "q":
                    io.say("Stopped.")
                    return out
                if reply == "s":
                    result = "skipped"
                    break
                if reply == "c" or i == len(f.steps):
                    still = any(g.key == f.key and g.state in (WARN, FAIL) for g in recheck())
                    result = "still there" if still else "fixed"
                    io.say("   Checked again: " + ("it's still there." if still else "it's gone. Fixed."))
                    if not still:
                        break
        out.append((f.code or f.summary, result or "left"))
        io.say("")
    unsettled = ("skipped", "left", "still there")
    fixed = sum(1 for _, r in out if r not in unsettled and not r.startswith(("couldn't", "the repair failed")))
    io.say(f"Done: {fixed} of {len(out)} dealt with. `cloudwall doctor` shows how things stand now.")
    return out
