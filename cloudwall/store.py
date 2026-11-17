"""SQLite persistence: API response cache and the spotter's logbook."""
import json
import sqlite3
import threading
import time


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
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

    # -- cache ---------------------------------------------------------------
    def cache_get(self, kind, key, max_age):
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

    # -- logbook -------------------------------------------------------------
    def count(self, where, args=()):
        with self.lock:
            return self.db.execute(
                f"SELECT COUNT(*) FROM sightings WHERE {where}", args).fetchone()[0]

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
            "total": self.count("1"),
            "types": self.query(
                "SELECT type, MAX(type_name) AS name, COUNT(*) AS n, MIN(ts) AS first "
                "FROM sightings WHERE type IS NOT NULL GROUP BY type ORDER BY n DESC"),
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
