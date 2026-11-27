"""Which aircraft types have a write-up (cloudwall/data/types/), and which still want one.

    python3 tools/type_notes.py               # every type, the ones seen most over the house first
    python3 tools/type_notes.py --todo 20     # just the next 20 to write
    python3 tools/type_notes.py --db PATH     # a logbook other than the usual one

Types come from the logbook (counted by flyovers) and from cloudwall/data/types.csv (the types
CloudWall draws, and the rare ones). Also says what is wrong with any file, as the tests would.
"""
import argparse
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from cloudwall.core import config  # noqa: E402
from cloudwall.reference import about  # noqa: E402


def logbook_counts(path):
    """{type: (flyovers, the name it was last logged under)} from a logbook, or {} without one."""
    if not Path(path).exists():
        return {}
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return {t: (n, name) for t, n, name in db.execute(
            "SELECT type, COUNT(*), MAX(type_name) FROM sightings WHERE type IS NOT NULL GROUP BY type")}
    except sqlite3.Error:
        return {}
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=str(config.default_db_path()), help="the logbook to count flyovers from")
    ap.add_argument("--todo", type=int, metavar="N", help="list only the next N types without a write-up")
    args = ap.parse_args()

    seen = logbook_counts(args.db)
    with open(ROOT / "cloudwall" / "data" / "types.csv", encoding="utf-8") as f:
        table = {r["type"]: r for r in csv.DictReader(line for line in f if not line.startswith("#"))}
    done = about.covered()
    codes = sorted(set(seen) | set(table) | set(done), key=lambda t: (-seen.get(t, (0,))[0], t))
    todo = [t for t in codes if t not in done]

    if args.todo is not None:
        rows = todo[:args.todo]
    else:
        rows = codes
        print(f"{len(done)} types written, {len(todo)} to go"
              + (f"; logbook: {args.db} ({len(seen)} types)" if seen else "; no logbook found, so not ordered by flyovers"))
    for t in rows:
        n, name = seen.get(t, (0, None))
        mark = f"written   {done[t]}" if t in done else "rare" if (table.get(t) or {}).get("rare") else ""
        print(f"{t:5} {n:6} {(name or '')[:34]:34} {mark}")
    problems = about.problems()
    for p in problems:
        print("problem:", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
