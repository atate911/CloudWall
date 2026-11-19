"""SQLite persistence: API response cache and the spotter's logbook."""
import json
import sqlite3
import threading
import time
from pathlib import Path

from .geo import haversine_nm

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


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.ages = {}      # kind -> the longest a cached value of that kind has been asked for (prune)
        with self.lock, self.db:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS cache(
                kind TEXT, key TEXT, json TEXT, ts REAL, PRIMARY KEY(kind, key));
            CREATE TABLE IF NOT EXISTS sightings(
                id INTEGER PRIMARY KEY, ts REAL, day TEXT, hex TEXT, callsign TEXT,
                flight TEXT, reg TEXT, type TEXT, type_name TEXT, airline_icao TEXT,
                airline TEXT, origin TEXT, dest TEXT, origin_nm REAL,
                min_dist_nm REAL, alt_ft INTEGER, gs REAL, badges TEXT);
            CREATE INDEX IF NOT EXISTS sightings_day ON sightings(day);
            CREATE INDEX IF NOT EXISTS sightings_hex ON sightings(hex);
            """)
            cols = {r["name"] for r in self.db.execute("PRAGMA table_info(sightings)")}
            if "photo" not in cols:      # added after the first release
                self.db.execute("ALTER TABLE sightings ADD COLUMN photo TEXT")
            if "model" not in cols:      # the registry's model name, which picks a drawing's variant
                self.db.execute("ALTER TABLE sightings ADD COLUMN model TEXT")
            if "seats" not in cols:      # estimated seats on board, added later
                self.db.execute("ALTER TABLE sightings ADD COLUMN seats INTEGER")
            if "photo_by" not in cols:   # the photo's credit and its page, for planespotters.net photos
                self.db.execute("ALTER TABLE sightings ADD COLUMN photo_by TEXT")
                self.db.execute("ALTER TABLE sightings ADD COLUMN photo_link TEXT")
            if "lat" not in cols:        # where its closest point was, which way it was flying and how fast it was
                for col in ("lat REAL", "lon REAL", "track REAL", "vrate REAL"):     # climbing: empty for older entries
                    self.db.execute(f"ALTER TABLE sightings ADD COLUMN {col}")

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

    # -- logbook -------------------------------------------------------------
    def count(self, where, args=()):
        with self.lock:
            return self.db.execute(
                f"SELECT COUNT(*) FROM sightings WHERE {where}", args).fetchone()[0]

    def seat_total(self, where, args=()):
        """Estimated seats over the house: the sum, and how many flyovers it covers."""
        with self.lock:
            r = self.db.execute(f"SELECT SUM(seats), COUNT(seats), COUNT(*) FROM sightings WHERE {where}",
                                args).fetchone()
        return {"seats": r[0] or 0, "known": r[1], "flights": r[2]}

    def add_sighting(self, **f):
        f["badges"] = json.dumps(f.get("badges", []))
        cols = ",".join(f)
        with self.lock, self.db:
            cur = self.db.execute(
                f"INSERT INTO sightings({cols}) VALUES({','.join('?' * len(f))})",
                tuple(f.values()))
            return cur.lastrowid

    def update_sighting(self, sid, **f):
        if "badges" in f:
            f["badges"] = json.dumps(f["badges"])
        sets = ",".join(f"{k}=?" for k in f)
        with self.lock, self.db:
            self.db.execute(f"UPDATE sightings SET {sets} WHERE id=?", (*f.values(), sid))

    def query(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def logbook(self, day):
        def rec(col, order, where="1"):
            rows = self.query(
                f"SELECT callsign, flight, type, origin, dest, {col} AS value, ts FROM sightings "
                f"WHERE {col} IS NOT NULL AND {where} ORDER BY {col} {order} LIMIT 1")
            return rows[0] if rows else None

        def records(where):
            return {"highest": rec("alt_ft", "DESC", where), "lowest": rec("alt_ft", "ASC", where),
                    "fastest": rec("gs", "DESC", where), "closest": rec("min_dist_nm", "ASC", where),
                    "furthest_origin": rec("origin_nm", "DESC", where)}

        recent = self.query("SELECT * FROM sightings ORDER BY ts DESC LIMIT 40")
        for r in recent:
            r["badges"] = json.loads(r["badges"] or "[]")
        today = f"day='{day}'"
        return {
            "today": self.count("day=?", (day,)),
            "seats_today": self.seat_total("day=?", (day,)),
            "seats_total": self.seat_total("1"),
            "total": self.count("1"),
            "types": self.query(
                "SELECT type, MAX(type_name) AS name, MAX(model) AS model, COUNT(*) AS n, MIN(ts) AS first "
                "FROM sightings WHERE type IS NOT NULL GROUP BY type ORDER BY n DESC"),
            "types_today": self.query(
                "SELECT type, MAX(type_name) AS name, MAX(model) AS model, COUNT(*) AS n "
                "FROM sightings WHERE day=? AND type IS NOT NULL GROUP BY type ORDER BY n DESC", (day,)),
            "airlines": self.query(
                "SELECT airline_icao AS icao, MAX(airline) AS name, COUNT(*) AS n FROM sightings "
                "WHERE airline_icao IS NOT NULL GROUP BY airline_icao ORDER BY n DESC"),
            "hours": self.query(
                "SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS hour, "
                "COUNT(*) AS n FROM sightings WHERE day=? GROUP BY hour", (day,)),
            "records_today": records(today),
            "records_all": records("1"),
            "recent": recent,
        }
