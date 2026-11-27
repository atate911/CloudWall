"""Back-fill the database from history files that already exist on the Pi.

Only formats that are known for certain are supported:

* ``history_<ms>.json`` (tar1090/readsb snapshots, same layout as aircraft.json), plain or gzipped;
* any ``.json`` / ``.gz`` file whose top level is an aircraft.json-style object
  (``{"now": ..., "aircraft": [ {...}, ... ]}``), e.g. ``current_large.gz`` when it has that layout.

tar1090's compact ``chunk_*.gz`` files store aircraft as positional arrays. Their column order has
not been verified on this receiver, so they are skipped with a message rather than guessed at.
Inspect one with  ``zcat chunk_*.gz | head -c 2000``  and extend `_snapshots_from` if you want them.
globe_history/ (readsb traces/heatmaps) has not been inspected either, so no importer exists for it.
"""
from __future__ import annotations

import glob
import gzip
import json
import logging
import os

from .filters import PointFilter

log = logging.getLogger("coverage3d.importer")


def _load(path: str):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as f:
        return json.loads(f.read())


def _snapshots_from(doc, path):
    """Yield aircraft.json-style snapshots found in a loaded document."""
    if isinstance(doc, dict) and isinstance(doc.get("aircraft"), list):
        if all(isinstance(a, dict) for a in doc["aircraft"][:20]) and "now" in doc:
            yield doc
        elif doc["aircraft"]:
            log.warning("%s: aircraft are positional arrays (unverified layout); skipped", path)
        return
    if isinstance(doc, dict) and isinstance(doc.get("files"), list):      # tar1090 chunk
        files = doc["files"]
        if files and isinstance(files[0], dict) and isinstance(files[0].get("aircraft"), list) \
                and files[0]["aircraft"] and isinstance(files[0]["aircraft"][0], dict):
            for s in files:
                yield s
        else:
            log.warning("%s: tar1090 chunk with positional-array layout; skipped "
                        "(inspect with zcat and add support before importing)", path)
        return
    log.warning("%s: unrecognised layout; skipped", path)


def expand_paths(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            out += sorted(glob.glob(os.path.join(p, "history_*.json")))
            out += [x for x in (os.path.join(p, n) for n in ("current_large.gz", "current_small.gz"))
                    if os.path.exists(x)]
        else:
            out.append(p)
    return out


def import_files(cfg, store, station, paths, band="1090") -> dict:
    """Import snapshots from `paths` (files or directories). Returns a summary dict."""
    files = expand_paths(paths)
    flt = PointFilter(station.lat, station.lon, station.antenna_asl_m, station.ground_elevation_m,
                      cfg.sampler, band)
    snaps = []
    for p in files:
        try:
            snaps += list(_snapshots_from(_load(p), p))
        except Exception as e:
            log.warning("%s: cannot read (%s)", p, e)
    snaps.sort(key=lambda s: s["now"])
    points = []
    last = None
    for s in snaps:
        if s["now"] == last:
            continue
        last = s["now"]
        for ac in s.get("aircraft", ()):
            p = flt.process(ac, s["now"])
            if p:
                points.append(p)
    if not points:
        return {"files": len(files), "snapshots": len(snaps), "imported": 0, "duplicates": 0}
    t0, t1 = min(p.t for p in points), max(p.t for p in points)
    have = store.existing_times(t0 - 2, t1 + 2)
    fresh = [p for p in points if (p.t, p.hex) not in have]
    store.insert_points(fresh)
    store.invalidate_days(t0, t1)          # whole-day aggregates for touched days must be rebuilt
    res = {"files": len(files), "snapshots": len(snaps), "imported": len(fresh),
           "duplicates": len(points) - len(fresh)}
    log.info("import: %s", res)
    return res


def backfill_on_first_start(cfg, store, station) -> dict | None:
    """If the database is empty, import tar1090's in-memory history so the map isn't empty."""
    if not cfg.sampler["backfill_on_start"] or store.total_points() or store.get_meta("backfilled"):
        return None
    d = cfg.sampler["backfill_dir"]
    if not d or not os.path.isdir(d):
        return None
    res = import_files(cfg, store, station, [d])
    store.set_meta("backfilled", "1")
    return res
