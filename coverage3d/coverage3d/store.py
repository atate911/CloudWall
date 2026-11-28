"""SQLite storage: raw points (compact integers), per-day aggregates, batched writes.

`points` units: t unix s; hex with bit 24 set for '~' addresses; src 0 ADS-B, 1 MLAT, 2 UAT;
lat_e5/lon_e5 degrees * 1e5; alt* feet; rssi_d dBFS * 10; dist_c nm * 100; brg_d degrees * 10
(0..3599); elev_c degrees * 100.

Each completed UTC day's histogram rows (binning.py) are kept forever in daily_dist / daily_rssi
at the resolution then in force; raw points are deleted after `retention_days`. Queries use
aggregates for whole days and raw rows for the partial days at the edges.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time

from . import binning
from .filters import Point

log = logging.getLogger("coverage3d.store")
DAY = 86400

SCHEMA = """
CREATE TABLE IF NOT EXISTS points (
    t INTEGER NOT NULL, hex INTEGER NOT NULL, src INTEGER NOT NULL,
    lat_e5 INTEGER NOT NULL, lon_e5 INTEGER NOT NULL,
    alt_baro INTEGER, alt_geom INTEGER, alt INTEGER NOT NULL, ground INTEGER NOT NULL,
    rssi_d INTEGER, dist_c INTEGER NOT NULL, brg_d INTEGER NOT NULL, elev_c INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS points_t ON points(t);
CREATE TABLE IF NOT EXISTS aircraft (hex INTEGER PRIMARY KEY, callsign TEXT, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS daily_done (day INTEGER NOT NULL, res TEXT NOT NULL, PRIMARY KEY(day, res));
CREATE TABLE IF NOT EXISTS daily_dist (
    day INTEGER NOT NULL, res TEXT NOT NULL, src INTEGER NOT NULL, sector INTEGER NOT NULL,
    band INTEGER NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL, dmax REAL NOT NULL,
    rmin REAL, tmin INTEGER NOT NULL, tmax INTEGER NOT NULL,
    PRIMARY KEY(day, res, src, sector, band, bucket)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS daily_rssi (
    day INTEGER NOT NULL, res TEXT NOT NULL, src INTEGER NOT NULL, sector INTEGER NOT NULL,
    band INTEGER NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY(day, res, src, sector, band, bucket)) WITHOUT ROWID;
"""

COLS = ("t,hex,src,lat_e5,lon_e5,alt_baro,alt_geom,alt,ground,rssi_d,dist_c,brg_d,elev_c")


def point_row(p: Point) -> tuple:
    return (p.t, p.hex, p.src, int(round(p.lat * 1e5)), int(round(p.lon * 1e5)),
            p.alt_baro, p.alt_geom, p.alt, 1 if p.ground else 0,
            None if p.rssi is None else int(round(p.rssi * 10)),
            int(p.dist_nm * 100), min(int((p.brg % 360.0) * 10), 3599), int(round(p.elev * 100)))


def res_key(sector_deg, band_ft, max_alt_ft) -> str:
    return f"{sector_deg}/{band_ft}/{max_alt_ft}"


class Store:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._local = threading.local()
        self._mem = None
        if path == ":memory:":                    # tests: one shared connection
            self._mem = self._open()
        with self.db() as c:
            c.executescript(SCHEMA)

    def _open(self):
        c = sqlite3.connect(self.path, timeout=30, check_same_thread=False, isolation_level=None)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")      # WAL + NORMAL: safe, far fewer fsyncs
        c.execute("PRAGMA busy_timeout=30000")
        return c

    def db(self) -> sqlite3.Connection:
        if self._mem is not None:
            return self._mem
        c = getattr(self._local, "c", None)
        if c is None:
            c = self._local.c = self._open()
        return c

    # ---- writes ----
    def insert_points(self, points: list[Point]) -> int:
        if not points:
            return 0
        rows = [point_row(p) for p in points]
        names = {}
        for p in points:
            if p.callsign:
                names[p.hex] = (p.hex, p.callsign, p.t)
        c = self.db()
        c.execute("BEGIN")
        try:
            c.executemany(f"INSERT INTO points({COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            c.executemany("INSERT INTO aircraft(hex,callsign,last_seen) VALUES(?,?,?) "
                          "ON CONFLICT(hex) DO UPDATE SET callsign=excluded.callsign, "
                          "last_seen=MAX(last_seen, excluded.last_seen)", list(names.values()))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
        return len(rows)

    def existing_times(self, t0: int, t1: int) -> set:
        """(t, hex) pairs already stored in a window."""
        return set(self.db().execute("SELECT t, hex FROM points WHERE t BETWEEN ? AND ?", (t0, t1)))

    def invalidate_days(self, t0: int, t1: int):
        d0, d1 = t0 // DAY, t1 // DAY
        c = self.db()
        for tbl in ("daily_done", "daily_dist", "daily_rssi"):
            c.execute(f"DELETE FROM {tbl} WHERE day BETWEEN ? AND ?", (d0, d1))

    def set_meta(self, k, v):
        self.db().execute("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))

    def get_meta(self, k, default=None):
        r = self.db().execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return r[0] if r else default

    # ---- aggregation / retention ----
    @staticmethod
    def _group_sql(sector_deg, band_ft, max_alt_ft):
        nb = binning.n_bands(band_ft, max_alt_ft)
        sector = f"(brg_d / {sector_deg * 10})"
        band = f"(CASE WHEN ground=1 THEN -1 ELSE min(max(alt,0) / {band_ft}, {nb - 1}) END)"
        rb = "((rssi_d - ((rssi_d % 10) + 10) % 10) / 10)"       # exact floor(rssi_d / 10)
        return sector, band, rb

    def raw_hist(self, t0, t1, srcs, sector_deg, band_ft, max_alt_ft):
        """Histogram rows (binning.py) for raw points with t0 <= t < t1."""
        sector, band, rb = self._group_sql(sector_deg, band_ft, max_alt_ft)
        ph = ",".join("?" * len(srcs))
        a = (t0, t1, *srcs)
        d = self.db().execute(
            f"SELECT {sector}, {band}, dist_c/100, count(*), max(dist_c)/100.0, min(rssi_d)/10.0, min(t), max(t) "
            f"FROM points WHERE t>=? AND t<? AND src IN ({ph}) GROUP BY 1,2,3", a).fetchall()
        r = self.db().execute(
            f"SELECT {sector}, {band}, {rb}, count(*) FROM points "
            f"WHERE t>=? AND t<? AND src IN ({ph}) AND rssi_d IS NOT NULL GROUP BY 1,2,3", a).fetchall()
        return d, r

    def aggregate_days(self, sector_deg, band_ft, max_alt_ft, now=None, limit_days=400) -> int:
        """Aggregate completed days that have raw points but no aggregate yet. Returns days done."""
        now = now or time.time()
        res = res_key(sector_deg, band_ft, max_alt_ft)
        c = self.db()
        cur_day = int((now - 600) // DAY)            # a day is "complete" 10 minutes after midnight
        first = c.execute("SELECT min(t) FROM points").fetchone()[0]
        if first is None:
            return 0
        done = {r[0] for r in c.execute("SELECT day FROM daily_done WHERE res=?", (res,))}
        n = 0
        for day in range(first // DAY, cur_day):
            if day in done or n >= limit_days:
                continue
            t0, t1 = day * DAY, (day + 1) * DAY
            if not c.execute("SELECT 1 FROM points WHERE t>=? AND t<? LIMIT 1", (t0, t1)).fetchone():
                continue
            c.execute("BEGIN")
            try:
                for src in (0, 1, 2):
                    d, r = self.raw_hist(t0, t1, [src], sector_deg, band_ft, max_alt_ft)
                    c.executemany("INSERT OR REPLACE INTO daily_dist VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                  [(day, res, src, s, b, k, cnt, mx, rm, a, z) for s, b, k, cnt, mx, rm, a, z in d])
                    c.executemany("INSERT OR REPLACE INTO daily_rssi VALUES (?,?,?,?,?,?,?)",
                                  [(day, res, src, s, b, k, cnt) for s, b, k, cnt in r])
                c.execute("INSERT OR REPLACE INTO daily_done VALUES (?,?)", (day, res))
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise
            n += 1
        if n:
            log.info("aggregated %d day(s) at resolution %s", n, res)
        return n

    def prune(self, retention_days: int, now=None) -> int:
        """Delete raw points older than the retention window; aggregates are kept."""
        cutoff = int((now or time.time()) - retention_days * DAY)
        c = self.db()
        cur = c.execute("DELETE FROM points WHERE t < ?", (cutoff,))
        c.execute("DELETE FROM aircraft WHERE last_seen < ?", (cutoff,))
        n = cur.rowcount
        if n:
            log.info("pruned %d raw points older than %d days", n, retention_days)
        return n

    # ---- reads ----
    def time_bounds(self):
        c = self.db()
        a = c.execute("SELECT min(t), max(t) FROM points").fetchone()
        d = c.execute("SELECT min(day), max(day) FROM daily_done").fetchone()
        lo = [x for x in (a[0], None if d[0] is None else d[0] * DAY) if x is not None]
        hi = [x for x in (a[1], None if d[1] is None else (d[1] + 1) * DAY - 1) if x is not None]
        return (min(lo), max(hi)) if lo else (None, None)

    def coverage_hist(self, t0, t1, srcs, sector_deg, band_ft, max_alt_ft):
        """Histogram rows for [t0, t1): aggregates for whole days, raw rows for the rest."""
        lo, hi = self.time_bounds()
        if lo is None or not srcs:
            return [], []
        t0, t1 = max(t0, lo), min(t1, hi + 1)
        if t1 <= t0:
            return [], []
        c = self.db()
        # aggregates exist at one resolution; a coarser one it divides evenly is folded from its rows
        res, fold_s, fold_b, done = res_key(sector_deg, band_ft, max_alt_ft), 1, 1, set()
        for have, in c.execute("SELECT DISTINCT res FROM daily_done WHERE day BETWEEN ? AND ?", (t0 // DAY, t1 // DAY)).fetchall():
            try:
                fs, fb, fmax = (int(x) for x in have.split("/"))
            except ValueError:
                continue
            if fmax != max_alt_ft or sector_deg % fs or band_ft % fb:
                continue
            days = {r[0] for r in c.execute("SELECT day FROM daily_done WHERE res=? AND day BETWEEN ? AND ?",
                                            (have, t0 // DAY, t1 // DAY))}
            if len(days) > len(done) or (len(days) == len(done) and have == res_key(sector_deg, band_ft, max_alt_ft)):
                res, fold_s, fold_b, done = have, sector_deg // fs, band_ft // fb, days
        fold = lambda s, b: (s // fold_s, b if b < 0 else b // fold_b)
        d0 = -(-t0 // DAY)                 # first day that starts inside the range
        d1 = t1 // DAY                     # days d0..d1-1 are entirely inside
        agg_days = [d for d in range(d0, d1) if d in done]
        raw_iv = []
        cursor = t0
        for d in agg_days:
            if d * DAY > cursor:
                raw_iv.append((cursor, d * DAY))
            cursor = (d + 1) * DAY
        if cursor < t1:
            raw_iv.append((cursor, t1))
        drows, rrows = [], []
        for a, b in raw_iv:
            d, r = self.raw_hist(a, b, srcs, sector_deg, band_ft, max_alt_ft)
            drows += d
            rrows += r
        if agg_days:
            ph = ",".join("?" * len(srcs))
            base = (res, agg_days[0], agg_days[-1], *srcs)
            dayset = set(agg_days)
            for row in c.execute(
                    f"SELECT day, sector, band, bucket, n, dmax, rmin, tmin, tmax FROM daily_dist "
                    f"WHERE res=? AND day BETWEEN ? AND ? AND src IN ({ph})", base):
                if row[0] in dayset:
                    drows.append((*fold(row[1], row[2]), *row[3:]))
            for row in c.execute(
                    f"SELECT day, sector, band, bucket, n FROM daily_rssi "
                    f"WHERE res=? AND day BETWEEN ? AND ? AND src IN ({ph})", base):
                if row[0] in dayset:
                    rrows.append((*fold(row[1], row[2]), *row[3:]))
        return drows, rrows

    def points(self, t0, t1, srcs, limit):
        """(total, stride k, rows): raw points down-sampled by keeping every k-th second."""
        ph = ",".join("?" * len(srcs))
        c = self.db()
        total = c.execute(f"SELECT count(*) FROM points WHERE t>=? AND t<? AND src IN ({ph})",
                          (t0, t1, *srcs)).fetchone()[0]
        k = max(1, -(-total // max(limit, 1)))
        rows = c.execute(
            f"SELECT lon_e5, lat_e5, alt, rssi_d, t, hex, dist_c, ground FROM points "
            f"WHERE t>=? AND t<? AND src IN ({ph}) AND t % ? = 0 ORDER BY t LIMIT ?",
            (t0, t1, *srcs, k, limit)).fetchall()
        return total, k, rows

    def vertical(self, t0, t1, srcs, dist_nm=2, alt_ft=500):
        ph = ",".join("?" * len(srcs))
        return self.db().execute(
            f"SELECT dist_c / {int(dist_nm * 100)}, (CASE WHEN ground=1 THEN -1 ELSE max(alt,0) / {alt_ft} END), count(*) "
            f"FROM points WHERE t>=? AND t<? AND src IN ({ph}) GROUP BY 1,2", (t0, t1, *srcs)).fetchall()

    def range_stats(self, t0, t1, srcs):
        ph = ",".join("?" * len(srcs))
        n, ac, dmax = self.db().execute(
            f"SELECT count(*), count(DISTINCT hex), max(dist_c)/100.0 FROM points "
            f"WHERE t>=? AND t<? AND src IN ({ph})", (t0, t1, *srcs)).fetchone()
        return {"points": n, "aircraft": ac, "max_nm": dmax}

    def aircraft_name(self, hexv: int):
        r = self.db().execute("SELECT callsign FROM aircraft WHERE hex=?", (hexv,)).fetchone()
        return r[0] if r else None

    def total_points(self) -> int:
        return self.db().execute("SELECT count(*) FROM points").fetchone()[0]
