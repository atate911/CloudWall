"""The logbook's file: one row per flyover in `sightings`, and the questions the Logbook tab and
the badges ask of it. Opening, the cache and migrations are db.py's."""
import json

from .db import Database


def _sightings_v1(db):
    """The logbook as every CloudWall before numbered migrations left it: the table, and each
    column added since its first release (added here where an older file lacks it)."""
    db.executescript("""
    CREATE TABLE IF NOT EXISTS sightings(
        id INTEGER PRIMARY KEY, ts REAL, day TEXT, hex TEXT, callsign TEXT,
        flight TEXT, reg TEXT, type TEXT, type_name TEXT, airline_icao TEXT,
        airline TEXT, origin TEXT, dest TEXT, origin_nm REAL,
        min_dist_nm REAL, alt_ft INTEGER, gs REAL, badges TEXT);
    CREATE INDEX IF NOT EXISTS sightings_day ON sightings(day);
    CREATE INDEX IF NOT EXISTS sightings_hex ON sightings(hex);
    """)
    cols = {r["name"] for r in db.execute("PRAGMA table_info(sightings)")}
    for col in ("photo TEXT", "model TEXT", "seats INTEGER", "photo_by TEXT", "photo_link TEXT",
                "lat REAL", "lon REAL", "track REAL", "vrate REAL"):
        if col.split()[0] not in cols:
            db.execute(f"ALTER TABLE sightings ADD COLUMN {col}")


class Store(Database):
    MIGRATIONS = [(1, _sightings_v1)]

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

    def type_seen(self, type_code):
        """A type in the logbook: how often it has come over (n, of all flyovers), when first and
        last, how many different airframes, its rank among the types logged (1: the most often;
        types with equal counts share a rank), and the airlines that fly it here most, at most 3."""
        r = self.query("SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last, COUNT(DISTINCT hex) AS airframes "
                       "FROM sightings WHERE type=?", (type_code,))[0]
        counts = [c["n"] for c in self.query("SELECT COUNT(*) AS n FROM sightings WHERE type IS NOT NULL GROUP BY type")]
        airlines = self.query("SELECT airline_icao AS icao, MAX(airline) AS name, COUNT(*) AS n FROM sightings "
                              "WHERE type=? AND airline_icao IS NOT NULL GROUP BY airline_icao ORDER BY n DESC LIMIT 3",
                              (type_code,))
        return dict(r, of=self.count("1"), rank=1 + sum(c > r["n"] for c in counts) if r["n"] else None,
                    types=len(counts), airlines=airlines)

    def airframe_seen(self, hexid):
        """One airframe in the logbook: how many times it has come over, and when first."""
        return self.query("SELECT COUNT(*) AS n, MIN(ts) AS first FROM sightings WHERE hex=?", (hexid,))[0]

    def type_name(self, type_code):
        """The name a type was last logged under ("Boeing 737 MAX 9"), or None."""
        rows = self.query("SELECT type_name FROM sightings WHERE type=? AND type_name IS NOT NULL ORDER BY ts DESC LIMIT 1",
                          (type_code,))
        return rows[0]["type_name"] if rows else None

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
