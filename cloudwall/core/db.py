"""SQLite files: a `cache` table of JSON by kind and key, plus a subclass's tables, changed only
through numbered MIGRATIONS tracked in `user_version`. A file SQLite can't read is moved aside
and a new one started, so the board always starts.
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
    """Where the logbook in a database file was kept: {"lat", "lon"}, or None if it doesn't say."""
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
    """Is the logbook in this file another place's? (A removed place leaves its file, and a new
    place can get the same id.) A file that doesn't say where it was kept isn't refused."""
    if not Path(path).exists():
        return False
    was = logbook_home(path)
    return bool(was) and haversine_nm(was["lat"], was["lon"], home["lat"], home["lon"]) > SAME_PLACE_NM


def _connect(path):
    db = sqlite3.connect(path, check_same_thread=False, timeout=5)
    db.row_factory = sqlite3.Row
    if path != ":memory:":
        # WAL: readers never block the writer, and a crash mid-write can't damage what was written
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.Error:
            db.close()
            raise
    return db


def open_or_set_aside(path):
    """Connect; a file SQLite can't read is renamed <name>.damaged-<time> and a fresh one started.
    A file only busy or out of reach is left alone and the error raised."""
    db = None
    try:
        db = _connect(path)
        if path != ":memory:":
            ok = db.execute("PRAGMA quick_check").fetchone()[0]
            if ok != "ok":
                raise sqlite3.DatabaseError(ok)
        return db
    except sqlite3.DatabaseError as e:
        if db is not None:
            db.close()
        if isinstance(e, sqlite3.OperationalError):    # locked, no room, no such folder: the file itself may be sound
            raise
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

    def reopen(self):
        """Close and open again: the health watcher's repair when writes keep failing."""
        with self.lock:
            try:
                self.db.close()
            except Exception:
                pass
            self.db = open_or_set_aside(self.path)
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
        """Delete cached values older than the longest max_age asked for of their kind; kinds not
        read since the start are left alone. Returns the row count."""
        now, gone = time.time(), 0
        with self.lock, self.db:
            for kind, age in list(self.ages.items()):
                if age != float("inf"):
                    gone += self.db.execute("DELETE FROM cache WHERE kind=? AND ts<?", (kind, now - age)).rowcount
        return gone

    def forget(self, kinds):
        """Clear every cached value of these kinds."""
        with self.lock, self.db:
            self.db.execute(f"DELETE FROM cache WHERE kind IN ({','.join('?' * len(kinds))})", tuple(kinds))

    def claim(self, home):
        """Note the place this logbook is kept at, so its file isn't later taken for another's."""
        self.cache_put("place", "home", {"lat": home["lat"], "lon": home["lon"]})

    def close(self):
        with self.lock:
            self.db.close()

    def __del__(self):
        try:
            self.db.close()
        except Exception:
            pass
