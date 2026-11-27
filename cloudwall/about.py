"""What's worth knowing about an aircraft type: a short write-up, a few facts chosen for that type,
and the years it was delivered, for the panel a tap on a type opens.

Written by hand, one TOML file per family in data/types/ (a 737 MAX file covers the -7, -8, -9
and -10), with a variant's own name, lines and facts where they differ, or a whole write-up of its
own where each model is seen often enough to be told apart. data/types/README.md
sets out the format and how the entries are written; tests/test_cloudwall.py holds every file to
it. A file that can't be read is left out with a warning, rather than stopping CloudWall.
"""
import logging
import re
import threading
import tomllib

from . import paths

FOLDER = paths.DATA / "types"
CODE = re.compile(r"^[A-Z][A-Z0-9]{1,3}$")          # an ICAO type designator: B39M, C172, F15
MONTH = re.compile(r"^\d{4}-\d{2}$")
KEYS = {"name", "types", "text", "facts", "production", "variants", "sources", "checked"}
VARIANT_KEYS = {"name", "text", "more", "facts", "production"}
MAX_PARAGRAPHS = 3          # a write-up is a couple of paragraphs; more, and it wants editing
MAX_PARAGRAPH = 900         # characters
log = logging.getLogger("cloudwall")

_entries = None
_lock = threading.Lock()


def paragraphs(text):
    """A write-up as its paragraphs: split at blank lines, each paragraph's wrapped lines joined."""
    return [" ".join(p.split()) for p in re.split(r"\n\s*\n", text or "") if p.strip()]


def _file_problems(name, d):
    """What is wrong with one family's file, as lines naming the file."""
    out = []
    say = lambda msg: out.append(f"{name}: {msg}")
    for k in sorted(set(d) - KEYS):
        say(f"unknown key {k!r}")
    if not isinstance(d.get("name"), str) or not d.get("name"):
        say("needs a name")
    types = d.get("types")
    if not isinstance(types, list) or not types or not all(isinstance(t, str) and CODE.match(t) for t in types):
        say("types must be a list of ICAO type designators (B39M)")
        types = []
    if "text" in d and (not isinstance(d["text"], str) or not paragraphs(d["text"])):
        say("text must be text")
    elif "text" not in d and not (types and all(_own_text(d, code) for code in types)):
        say("needs a text, or a text of its own for every one of its types")
    if not isinstance(d.get("sources"), list) or not d["sources"] or \
            not all(isinstance(s, str) and s.startswith(("https://", "http://")) for s in d["sources"]):
        say("needs sources: the pages its facts were checked against")
    if not isinstance(d.get("checked"), str) or not MONTH.match(d["checked"]):
        say('needs checked = "YYYY-MM", when its facts were last checked')
    out += [f"{name}: {m}" for m in _part_problems(d)]
    variants = d.get("variants", {})
    if not isinstance(variants, dict):
        say("variants must be a table of tables")
        variants = {}
    for code, v in variants.items():
        if code not in types:
            say(f"variant {code} isn't in its types")
        if not isinstance(v, dict):
            say(f"variant {code} must be a table")
            continue
        for k in sorted(set(v) - VARIANT_KEYS):
            say(f"variant {code}: unknown key {k!r}")
        if "text" in v and "more" in v:
            say(f"variant {code}: text replaces the family's, more adds to it: not both")
        for k in ("name", "text", "more"):
            if k in v and (not isinstance(v[k], str) or not v[k].strip()):
                say(f"variant {code}: {k} must be text")
        out += [f"{name}: variant {code}: {m}" for m in _part_problems(v)]
    for code in types:
        e = _merge(d, code)
        if len(e["text"]) > MAX_PARAGRAPHS:
            say(f"{code}'s write-up has {len(e['text'])} paragraphs; keep it to {MAX_PARAGRAPHS}")
        for p in e["text"]:
            if len(p) > MAX_PARAGRAPH:
                say(f"{code}: a paragraph of {len(p)} characters; keep each under {MAX_PARAGRAPH}")
    return out


def _own_text(d, code):
    """Whether a type has a whole write-up of its own, so that its family need not have one."""
    variants = d.get("variants")
    v = variants.get(code) if isinstance(variants, dict) else None
    return isinstance(v, dict) and isinstance(v.get("text"), str) and bool(paragraphs(v["text"]))


def _part_problems(d):
    """The facts and production years, of a family or of a variant."""
    out = []
    facts = d.get("facts", {})
    if not isinstance(facts, dict) or not all(isinstance(k, str) and isinstance(v, str) and k and v for k, v in facts.items()):
        out.append('facts must be a table of text: "Range" = "6,570 km"')
    elif any(k.lower() == "seats" for k in facts):
        out.append("seats come from data/seats.csv, by airline: leave them out of facts")
    p = d.get("production")
    if p is not None:
        if not isinstance(p, list) or len(p) not in (1, 2) or not all(isinstance(y, int) and 1900 <= y <= 2100 for y in p) \
                or (len(p) == 2 and p[1] < p[0]):
            out.append("production must be [first year delivered] while it's still built, or [first, last]")
    return out


def _merge(d, code):
    """One type's entry from its family's file: the variant's name, text and production where it
    has its own, its facts over the family's, and its `more` after the family's text (a family
    whose types all have their own text may have none)."""
    v = (d.get("variants") or {}).get(code) or {}
    text = paragraphs(v["text"]) if "text" in v else paragraphs(d.get("text")) + paragraphs(v.get("more"))
    facts = dict(d.get("facts") or {})
    facts.update(v.get("facts") or {})
    prod = v.get("production", d.get("production"))
    return {"name": v.get("name") or d["name"], "family": d["name"], "text": text,
            "facts": [[k, val] for k, val in facts.items()],
            "production": [prod[0], prod[1] if len(prod) > 1 else None] if prod else None}


def _load():
    """{type code: entry} from every readable, sound file; and the problems found, by file."""
    entries, problems = {}, []
    for f in sorted(FOLDER.glob("*.toml")):
        try:
            d = tomllib.loads(f.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as e:
            problems.append(f"{f.name}: can't be read: {e}")
            continue
        found = _file_problems(f.name, d)
        if found:
            problems += found
            continue
        for code in d["types"]:
            if code in entries:
                problems.append(f"{f.name}: {code} is already in {entries[code]['file']}")
                continue
            entries[code] = dict(_merge(d, code), file=f.name)
    return entries, problems


def _table():
    global _entries
    with _lock:
        if _entries is None:
            _entries, problems = _load()
            for p in problems:
                log.warning("type write-ups: %s (left out)", p)
    return _entries


def entry(type_code):
    """{"name", "family", "text" (paragraphs), "facts" ([label, value] in order), "production"
    ([first, last], last None while still built; or None)} for a type, or None for a type with
    no write-up yet."""
    e = _table().get(str(type_code or "").upper())
    return {k: v for k, v in e.items() if k != "file"} if e else None


def covered():
    """{type code: file} for every type with a write-up."""
    return {code: e["file"] for code, e in _table().items()}


def problems():
    """Everything wrong with the files, as lines naming each file: empty when all is well."""
    return _load()[1]
