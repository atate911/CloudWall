"""How CloudWall says whether each part of it is working, in words its owner can act on.

A check is a function returning Findings. Each Finding says what was looked at, how it is (ok,
warn, fail or off), what that means, and what to do. A Finding for a known problem names it by
its code in troubles.CATALOGUE, and takes its explanation, its likely causes, its steps, whether
it is major and how it is repaired from there: trouble("feeds.all-down", "no feed answered").

The same findings are printed by `cloudwall doctor`, watched by the running server (app/watch.py)
and shown on the screens, so the advice is written once. Checks are registered by the part they
belong to (register("feeds", check)), so a new part (a second radio, a decoder) brings its own
checks and they appear everywhere without anything else changing.

The Monitor turns findings, checked again and again, into incidents: a problem starts, goes on
(counted), and ends. Each start and end is said once in the log, not at every check; a major one
at ERROR, with what to do.
"""
import logging
import textwrap
import time
from dataclasses import asdict, dataclass, field

from .troubles import CATALOGUE

OK, WARN, FAIL, OFF = "ok", "warn", "fail", "off"
ORDER = {FAIL: 0, WARN: 1, OK: 2, OFF: 3}
MARK = {OK: "ok  ", WARN: "warn", FAIL: "FAIL", OFF: "off "}
log = logging.getLogger("cloudwall.health")


@dataclass
class Finding:
    part: str           # which part of CloudWall: "settings", "storage", "feeds", "receiver", ...
    state: str          # OK, WARN, FAIL or OFF (not set up: nothing wrong)
    summary: str        # one line: what was found, with its particulars
    detail: str = ""    # what that means, for someone who doesn't know the parts' names
    fix: str = ""       # what to do about it, when it isn't ok
    code: str = None    # the known problem it is (troubles.CATALOGUE)
    major: bool = False # stops CloudWall doing its main job: said loudly
    steps: list = field(default_factory=list)      # troubleshooting, in order
    causes: list = field(default_factory=list)     # why it usually happens
    repair: str = None  # a repair that fixes it (operate/repair.py)
    auto: bool = False  # made without asking
    subtle: bool = False    # looks right on the screens, but isn't

    @property
    def key(self):
        """What makes two findings the same problem, from one check to the next."""
        return self.code or f"{self.part}:{self.summary}"

    def to_dict(self):
        return asdict(self)


def trouble(code, summary=None, state=None, part=None):
    """A Finding for a known problem, its words from the catalogue."""
    t = CATALOGUE[code]
    return Finding(part or code.split(".")[0], state or (FAIL if t.major else WARN), summary or t.title,
                   t.means, t.steps[0] if t.steps else "", code, t.major, list(t.steps), list(t.causes),
                   t.repair, t.auto, t.subtle)


def ok(part, summary):
    return Finding(part, OK, summary)


def off(part, summary):
    return Finding(part, OFF, summary)


CHECKS = []             # [(part, function(context) -> [Finding])]


def register(part, check):
    CHECKS.append((part, check))
    return check


def run(context, checks=None):
    """Every check's findings, in the order the parts were registered. A check that fails in itself
    is a finding too, not a crash: the checks must work when things are broken."""
    out = []
    for part, check in checks if checks is not None else CHECKS:
        try:
            out += list(check(context))
        except Exception as e:
            out.append(Finding(part, FAIL, f"the check itself failed: {type(e).__name__}: {e}",
                               "This is a fault in CloudWall's own check, not necessarily in what it checks.",
                               "Run it again; if it repeats, report it with `cloudwall report`."))
    return out


def worst(findings):
    return min((f.state for f in findings), key=ORDER.get, default=OK)


def render(findings, width=100, steps=True):
    """Findings as text for a terminal: one line each, and for any not ok, what it means, its likely
    causes and what to do."""
    lines = []

    def para(text, indent="       ", first=None):
        lines.extend(textwrap.wrap(text, width, initial_indent=first or indent, subsequent_indent=indent))
    for f in sorted(findings, key=lambda f: (not f.major, ORDER[f.state])) if steps else findings:
        lines.append(f"[{MARK[f.state]}] {f.part}: {f.summary}" + ("   << MAJOR" if f.major and f.state == FAIL else ""))
        if f.state not in (WARN, FAIL):
            continue
        if f.subtle:
            para("This looks right on the screens, but isn't.")
        if f.detail:
            para(f.detail)
        if steps and f.causes:
            para("Usually because " + "; or ".join(f.causes) + ".")
        if steps and f.steps:
            for i, s in enumerate(f.steps, 1):
                para(s, "          ", f"       {i}. ")
        elif f.fix:
            para("To fix: " + f.fix)
        if f.repair:
            para(("CloudWall repairs this itself." if f.auto else
                  f"`cloudwall doctor --fix` can repair this ({f.repair})."))
    return "\n".join(lines)


class Monitor:
    """Findings checked again and again, as incidents with a start and an end. observe() returns
    what changed: [("started" | "ended", finding)]. `store` (memory/incidents.py) keeps them
    across restarts, when given."""

    def __init__(self, store=None, clock=time.time):
        self.store = store
        self.clock = clock
        self.open = {}              # key -> (finding, since, times seen)
        self.last = []              # the latest findings, all of them
        self.checked = None

    def observe(self, findings):
        now = self.clock()
        self.last, self.checked = list(findings), now
        bad = {f.key: f for f in findings if f.state in (WARN, FAIL)}
        changes = []
        for key, f in bad.items():
            if key not in self.open:
                self.open[key] = (f, now, 1)
                changes.append(("started", f))
                (log.error if f.major else log.warning)("problem: %s%s%s", f.summary,
                                                         f" - {f.detail}" if f.detail else "",
                                                         f" To fix: {f.steps[0] if f.steps else f.fix}" if (f.steps or f.fix) else "")
            else:
                _, since, n = self.open[key]
                self.open[key] = (f, since, n + 1)
        for key in [k for k in self.open if k not in bad]:
            f, since, _ = self.open.pop(key)
            changes.append(("ended", f))
            log.info("problem over: %s (it lasted %s)", f.summary, _lasted(now - since))
        if self.store is not None:
            try:
                self.store.record(changes, now)
            except Exception as e:      # the incident log is no reason to stop watching
                log.warning("the incident log couldn't be written: %s", e)
        return changes

    def majors(self):
        return [f for f, _, _ in self.open.values() if f.major and f.state == FAIL]

    def summary(self):
        """For every screen: how things stand, in a few words."""
        majors = self.majors()
        # (simulated traffic is the demo's whole point: it isn't what this warning is for)
        subtle = [f for f, _, _ in self.open.values() if f.subtle and f.code != "display.demo"]
        return {"worst": worst(self.last), "problems": len(self.open), "checked": self.checked,
                "major": majors[0].summary if majors else None,
                "major_title": CATALOGUE[majors[0].code].title if majors and majors[0].code in CATALOGUE else None,
                "subtle": CATALOGUE[subtle[0].code].title if subtle else None}

    def report(self):
        """In full, for /api/health and the Overview page."""
        return {**self.summary(),
                "open": [dict(f.to_dict(), since=since, seen=n) for f, since, n in self.open.values()],
                "findings": [f.to_dict() for f in self.last]}


def _lasted(s):
    return f"{s:.0f} s" if s < 120 else f"{s / 60:.0f} min" if s < 7200 else f"{s / 3600:.1f} h"
