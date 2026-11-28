"""Health checks: registered functions returning Findings (a known problem's words come from
troubles.CATALOGUE via trouble()), shared by `cloudwall doctor`, the server's watcher and the
screens. Monitor turns repeated findings into incidents, each start and end logged once.
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
    part: str           # "settings", "storage", "feeds", "receiver", ...
    state: str          # OK, WARN, FAIL or OFF (not set up: nothing wrong)
    summary: str
    detail: str = ""
    fix: str = ""
    code: str = None    # key in troubles.CATALOGUE
    major: bool = False
    steps: list = field(default_factory=list)
    causes: list = field(default_factory=list)
    repair: str = None  # a repair's name (operate/repair.py)
    auto: bool = False  # the repair is made without asking
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
    """Every check's findings, in registration order; a check that raises becomes a finding, not a crash."""
    out = []
    for part, check in checks if checks is not None else CHECKS:
        try:
            out += list(check(context))
        except PermissionError as e:
            out.append(Finding(part, OFF, f"not checked: {e.filename or 'a file'} isn't yours to read (run it with sudo)"))
        except Exception as e:
            out.append(Finding(part, FAIL, f"the check itself failed: {type(e).__name__}: {e}",
                               "This is a fault in CloudWall's own check, not necessarily in what it checks.",
                               "Run it again; if it repeats, report it with `cloudwall report`."))
    return out


def worst(findings):
    return min((f.state for f in findings), key=ORDER.get, default=OK)


def render(findings, width=100, steps=True):
    """Findings as text for a terminal."""
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
    """observe() returns what changed: [("started" | "ended", finding)]. `store`
    (memory/incidents.py), when given, keeps incidents across restarts."""

    def __init__(self, store=None, clock=time.time):
        self.store = store
        self.clock = clock
        self.open = {}              # key -> (finding, since, times seen)
        self.last = []
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
        # list(self.open...) throughout: the health thread changes it while screens ask
        return [f for f, _, _ in list(self.open.values()) if f.major and f.state == FAIL]

    def summary(self):
        majors = self.majors()
        # display.demo left out: simulated traffic is the demo's whole point
        subtle = [f for f, _, _ in list(self.open.values()) if f.subtle and f.code != "display.demo"]
        return {"worst": worst(self.last), "problems": len(self.open), "checked": self.checked,
                "major": majors[0].summary if majors else None,
                "major_title": CATALOGUE[majors[0].code].title if majors and majors[0].code in CATALOGUE else None,
                "subtle": CATALOGUE[subtle[0].code].title if subtle else None}

    def report(self):
        return {**self.summary(),
                "open": [dict(f.to_dict(), since=since, seen=n) for f, since, n in list(self.open.values())],
                "findings": [f.to_dict() for f in self.last]}


def _lasted(s):
    return f"{s:.0f} s" if s < 120 else f"{s / 60:.0f} min" if s < 7200 else f"{s / 3600:.1f} h"
