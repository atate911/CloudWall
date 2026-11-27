"""The incident log: each problem the health watcher saw, when it started and ended, kept across
restarts in its own file (health.db beside the logbooks), so "has the receiver been dropping out
this week?" has an answer. Only the last KEEP_DAYS are kept."""
import json

from ..core.db import Database

KEEP_DAYS = 60


def _incidents_v1(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS incidents(
        id INTEGER PRIMARY KEY, key TEXT, code TEXT, part TEXT, state TEXT, major INTEGER,
        summary TEXT, started REAL, ended REAL, finding TEXT);
    CREATE INDEX IF NOT EXISTS incidents_open ON incidents(ended);
    CREATE INDEX IF NOT EXISTS incidents_started ON incidents(started);
    """)


class Incidents(Database):
    MIGRATIONS = [(1, _incidents_v1)]

    def record(self, changes, now):
        """The Monitor's changes: [("started" | "ended", finding)]."""
        with self.lock, self.db:
            for what, f in changes:
                if what == "started":
                    self.db.execute("INSERT INTO incidents(key, code, part, state, major, summary, started, finding) "
                                    "VALUES(?,?,?,?,?,?,?,?)", (f.key, f.code, f.part, f.state, int(f.major),
                                                                f.summary, now, json.dumps(f.to_dict())))
                else:
                    self.db.execute("UPDATE incidents SET ended=? WHERE key=? AND ended IS NULL", (now, f.key))
            self.db.execute("DELETE FROM incidents WHERE started < ?", (now - KEEP_DAYS * 86400,))

    def close_all(self, now):
        """At start: whatever was open when CloudWall last stopped ended then, as far as anyone knows."""
        with self.lock, self.db:
            self.db.execute("UPDATE incidents SET ended=? WHERE ended IS NULL", (now,))

    def recent(self, limit=50):
        with self.lock:
            rows = self.db.execute("SELECT key, code, part, state, major, summary, started, ended FROM incidents "
                                   "ORDER BY started DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def counts(self, since):
        """How often each problem started since then: {key: n}."""
        with self.lock:
            rows = self.db.execute("SELECT key, COUNT(*) n FROM incidents WHERE started >= ? GROUP BY key", (since,)).fetchall()
        return {r["key"]: r["n"] for r in rows}
