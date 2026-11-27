"""SQLite files: opened so they survive what a machine running for months goes through, and
changed only by numbered migrations.

A Database is one file: a `cache` table of JSON values by kind and key, kept for as long as
anyone asks for them, and whatever tables its subclass adds through MIGRATIONS (the logbook's
are store.py's). The file's own `user_version` says which migrations it has had, so a file
written by any earlier CloudWall is brought up to date as it is opened, and one from a later
CloudWall is left alone.

A file SQLite can't read (cut off by a full disk or a power cut) is moved aside, said so in the
log, and a new one started: losing a logbook is bad, but a board that never starts again is
worse, and the damaged file is still there to be recovered by hand.
"""
import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

from .geo import haversine_nm

log = logging.getLogger("cloudwall.db")
SAME_PLACE_NM = 2      # a place set up again this close to where a logbook was kept is the same place


def logbook_home(path):
    """Where the logbook in a database file was kept: {"lat", "lon"}, or None for a file that
    doesn't say (one from before this was recorded, or not a logbook at all)."""
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = db.execute("SELECT json FROM cache WHERE kind='place' AND key='home'").fetchone()
        finally:
            db.close()
        home = json.loads(row[0]) if row else None
        return home if isinstance(home, dict) and "lat" in home and "lon" in home else None
    except (sqlite3.Error, ValueError, OSError):
        return None


def another_places(path, home):
    """Is the logbook in this file, if there is one, another place's? A place removed from a
    screen leaves its logbook on disk, under a name made from its id. A new place that would get
    the same id (another cabin, somewhere else) mustn't carry on in it; the same place set up
    again does. A logbook from before its place was noted could be anyone's, and isn't refused."""
    if not Path(path).exists():
        return False
    was = logbook_home(path)
    return bool(was) and haversine_nm(was["lat"], was["lon"], home["lat"], home["lon"]) > SAME_PLACE_NM


def _connect(path):
    db = sqlite3.connect(path, check_same_thread=False, timeout=5)
    db.row_factory = sqlite3.Row
    if path != ":memory:":
        # WAL: a reader (a backup, `cloudwall doctor`) never blocks the writer, and a crash
        # mid-write can't damage what was already written
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
    return db


def open_or_set_aside(path):
    """A connection to the file at path; a file SQLite can't read is renamed (with its -wal and
    -shm) to <name>.damaged-<time> and a fresh one started in its place."""
    try:
        db = _connect(path)
        if path != ":memory:":
            ok = db.execute("PRAGMA quick_check").fetchone()[0]
            if ok != "ok":
                raise sqlite3.DatabaseError(ok)
        return db
    except sqlite3.DatabaseError as e:
        try:
            db.close()
        except Exception:
            pass
        stamp = time.strftime("%Y%m%d-%H%M%S")
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(path + suffix):
                os.replace(path + suffix, f"{path}.damaged-{stamp}{suffix}")
        log.error("%s couldn't be read (%s): moved aside as %s.damaged-%s and a new one started",
                  path, e, path, stamp)
        return _connect(path)


class Database:
    MIGRATIONS = []         # [(version, function(db))], each run once, in order, in one transaction

    def __init__(self, path):
        self.path = str(path)
        self.db = open_or_set_aside(self.path)
        self.lock = threading.Lock()
        self.ages = {}      # kind -> the longest a cached value of that kind has been asked for (prune)
        with self.lock, self.db:
            self.db.execute("CREATE TABLE IF NOT EXISTS cache(kind TEXT, key TEXT, json TEXT, ts REAL, PRIMARY KEY(kind, key))")
        self._migrate()

    def _migrate(self):
        have = self.db.execute("PRAGMA user_version").fetchone()[0]
        for version, step in self.MIGRATIONS:
            if version > have:
                with self.lock, self.db:
                    step(self.db)
                    self.db.execute(f"PRAGMA user_version={int(version)}")
                have = version

    @property
    def version(self):
        with self.lock:
            return self.db.execute("PRAGMA user_version").fetchone()[0]

    # -- cache ---------------------------------------------------------------
    def cache_get(self, kind, key, max_age):
        if max_age > self.ages.get(kind, 0):
            self.ages[kind] = max_age
        with self.lock:
            row = self.db.execute(
                "SELECT json, ts FROM cache WHERE kind=? AND key=?", (kind, key)).fetchone()
        if row and time.time() - row["ts"] < max_age:
            return True, json.loads(row["json"])
        return False, None

    def cache_put(self, kind, key, value):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO cache VALUES(?,?,?,?)",
                            (kind, key, json.dumps(value), time.time()))

    def prune(self):
        """Clear cached values nobody will read again: those older than the longest anyone has
        asked for of their kind (a route after a week, a day's heatmap after two days). Kinds not
        read since the start are left alone. Without this the cache only grows: a heatmap a day,
        a row for every aircraft and callsign ever seen. Returns how many rows went."""
        now, gone = time.time(), 0
        with self.lock, self.db:
            for kind, age in list(self.ages.items()):
                if age != float("inf"):
                    gone += self.db.execute("DELETE FROM cache WHERE kind=? AND ts<?", (kind, now - age)).rowcount
        return gone

    def forget(self, kinds):
        """Clear every cached value of these kinds (e.g. the lookups each place's file held
        before they were kept in one place for all)."""
        with self.lock, self.db:
            self.db.execute(f"DELETE FROM cache WHERE kind IN ({','.join('?' * len(kinds))})", tuple(kinds))

    def claim(self, home):
        """Note the place this logbook is kept at, so its file isn't later taken for another's."""
        self.cache_put("place", "home", {"lat": home["lat"], "lon": home["lon"]})

    def close(self):
        with self.lock:
            self.db.close()
