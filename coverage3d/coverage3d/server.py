"""HTTP server (stdlib only): the JSON API and the static single page."""
from __future__ import annotations

import datetime as dt
import json
import logging
import mimetypes
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import __version__, binning, geo, reference
from .filters import SOURCE_IDS, format_hex

log = logging.getLogger("coverage3d.server")
WEB = Path(__file__).parent / "web"


class TTLCache:
    """Tiny thread-safe cache so repeated page loads don't re-run heavy SQL."""

    def __init__(self):
        self.d, self.lock = {}, threading.Lock()

    def get(self, key, ttl, fn):
        now = time.time()
        with self.lock:
            hit = self.d.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        val = fn()
        with self.lock:
            if len(self.d) > 200:
                self.d.clear()
            self.d[key] = (now, val)
        return val


def parse_time(v, default):
    if v in (None, ""):
        return default
    try:
        return int(float(v))
    except ValueError:
        return int(dt.datetime.fromisoformat(v).replace(tzinfo=dt.timezone.utc).timestamp()) \
            if "T" in v or "-" in v else default


class App:
    """Everything the request handlers need."""

    def __init__(self, cfg, store, sampler, feeds, demo=False):
        self.cfg, self.store, self.sampler, self.feeds, self.demo = cfg, store, sampler, feeds, demo
        self.cache = TTLCache()
        self.started = time.time()
        extra = cfg.server["airports_csv"]
        if not extra:                                 # picked up automatically if install.sh --airports fetched it
            guess = Path(cfg.storage["db_path"]).parent / "airports.csv"
            extra = str(guess) if guess.is_file() else ""
        self.airports = reference.load_airports(extra)
        self.peaks, self.places = reference.load_peaks(), reference.load_places()

    # ---- helpers ------------------------------------------------------------------------------
    @property
    def station(self):
        return self.sampler.station

    def sources(self, q) -> list[int]:
        names = (q.get("source", ["adsb"])[0] or "adsb").split(",")
        ids = [SOURCE_IDS[n] for n in names if n in SOURCE_IDS]
        return ids or [0]

    def window(self, q, prefix=""):
        now = int(time.time())
        t1 = parse_time(q.get(prefix + "to", [None])[0], now + 1)
        last = q.get(prefix + "last", [None])[0]
        if last:
            return now - int(float(last)), now + 1
        lo, _ = self.store.time_bounds()
        t0 = parse_time(q.get(prefix + "from", [None])[0], lo if lo is not None else now - 86400)
        return t0, t1

    def resolution(self, q):
        cv = self.cfg.coverage
        sector = int(q.get("sector", [cv["sector_deg"]])[0])
        band = int(q.get("bands", q.get("band", [cv["band_ft"]]))[0])
        if not (1 <= sector <= 10 and 360 % sector == 0):
            raise ValueError("sector must be 1..10 and divide 360")
        if not 500 <= band <= 15000:
            raise ValueError("bands must be 500..15000 ft")
        return sector, band, cv["max_alt_ft"]

    # ---- endpoints ----------------------------------------------------------------------------
    def api_station(self, q):
        d = self.station.to_dict()
        d["horizon_note"] = "radio horizon = 1.23*(sqrt(h_antenna_ft)+sqrt(h_ft)) nm"
        return d

    def api_config(self, q):
        cv, w = self.cfg.coverage, self.cfg.web
        tiles = self.cfg.server["offline_tiles_dir"]
        return {"version": __version__, "demo": self.demo, "station": self.station.to_dict(),
                "coverage": {"sector_deg": cv["sector_deg"], "band_ft": cv["band_ft"], "max_alt_ft": cv["max_alt_ft"],
                             "stat": cv["stat"]},
                "web": w, "offline_tiles": bool(tiles and os.path.isdir(tiles)),
                "time_bounds": self.store.time_bounds(), "sources": [f.name for f in self.feeds]}

    def coverage(self, t0, t1, srcs, sector, band, stat, min_pts):
        cv = self.cfg.coverage
        d, r = self.store.coverage_hist(t0, t1, srcs, sector, band, cv["max_alt_ft"])
        bins = binning.build_bins(d, r, min_pts)
        ant_ft = self.station.antenna_asl_m * geo.FT_PER_M
        nb, ns = binning.n_bands(band, cv["max_alt_ft"]), binning.n_sectors(sector)
        key = "max_nm" if stat == "max" else "p95_nm"
        bands = []
        for b in [binning.GROUND] + list(range(nb)):
            sectors = []
            for s in range(ns):
                v = bins.get((s, b))
                if v:
                    sectors.append({"s": s, "brg0": s * sector, "brg1": (s + 1) * sector,
                                    "dist_nm": v[key], **v})
            if not sectors:
                continue
            lo, hi = binning.band_range_ft(b, band) if b >= 0 else (0, 0)
            bands.append({"index": b, "ground": b < 0, "lo_ft": lo, "hi_ft": hi,
                          "horizon_nm": round(geo.radio_horizon_nm(ant_ft, (lo + hi) / 2), 1),
                          "sectors": sectors})
        # best / worst bearing over all bands (by the chosen statistic)
        per_sector = [0.0] * ns
        for bd in bands:
            for s in bd["sectors"]:
                per_sector[s["s"]] = max(per_sector[s["s"]], s["dist_nm"])
        total = sum(s["count"] for bd in bands for s in bd["sectors"])
        summary = {"points": total, "max_nm": max((s["max_nm"] for bd in bands for s in bd["sectors"]), default=0),
                   "best_sector": max(range(ns), key=lambda i: per_sector[i]) * sector if bands else None,
                   "worst_sector": min(range(ns), key=lambda i: per_sector[i]) * sector if bands else None,
                   "best_nm": max(per_sector) if bands else 0, "worst_nm": min(per_sector) if bands else 0}
        return {"t0": t0, "t1": t1, "sector_deg": sector, "band_ft": band, "stat": stat,
                "n_sectors": ns, "n_bands": nb, "bands": bands, "summary": summary}

    def api_coverage(self, q):
        t0, t1 = self.window(q)
        srcs = self.sources(q)
        sector, band, _ = self.resolution(q)
        stat = q.get("stat", [self.cfg.coverage["stat"]])[0]
        if stat not in ("p95", "max"):
            raise ValueError("stat must be p95 or max")
        min_pts = int(q.get("min", [self.cfg.coverage["min_points_per_bin"]])[0])
        ttl = self.cfg.coverage["cache_s"]
        # round the window so a sliding "last 1h" query still hits the cache within the TTL
        key = ("cov", t0 // 60, t1 // 60, tuple(srcs), sector, band, stat, min_pts)
        return self.cache.get(key, ttl, lambda: self.coverage(t0, t1, srcs, sector, band, stat, min_pts))

    def api_compare(self, q):
        sector, band, _ = self.resolution(q)
        stat = q.get("stat", [self.cfg.coverage["stat"]])[0]
        srcs = self.sources(q)
        min_pts = int(q.get("min", [self.cfg.coverage["min_points_per_bin"]])[0])
        out = {}
        for tag in ("a", "b"):
            t0 = parse_time(q.get(f"{tag}_from", [None])[0], None)
            t1 = parse_time(q.get(f"{tag}_to", [None])[0], None)
            if t0 is None or t1 is None:
                raise ValueError(f"{tag}_from and {tag}_to are required")
            key = ("cov", t0 // 60, t1 // 60, tuple(srcs), sector, band, stat, min_pts)
            out[tag] = self.cache.get(key, self.cfg.coverage["cache_s"],
                                      lambda: self.coverage(t0, t1, srcs, sector, band, stat, min_pts))
        return out

    def api_points(self, q):
        t0, t1 = self.window(q)
        limit = min(int(q.get("limit", [100000])[0]), 200000)
        key = ("pts", t0 // 60, t1 // 60, tuple(self.sources(q)), limit)
        total, k, rows = self.cache.get(key, 60, lambda: self.store.points(t0, t1, self.sources(q), limit))
        # columns: lon, lat, alt_ft, rssi, t, hex, dist_nm, ground
        cols = list(zip(*rows)) if rows else [[]] * 8
        return {"total": total, "stride": k, "n": len(rows),
                "lon": [v / 1e5 for v in cols[0]], "lat": [v / 1e5 for v in cols[1]], "alt": list(cols[2]),
                "rssi": [None if v is None else v / 10 for v in cols[3]], "t": list(cols[4]),
                "hex": [format_hex(v) for v in cols[5]], "dist": [v / 100 for v in cols[6]],
                "ground": list(cols[7])}

    def api_vertical(self, q):
        t0, t1 = self.window(q)
        srcs = self.sources(q)
        rows = self.cache.get(("vert", t0 // 60, t1 // 60, tuple(srcs)), 60, lambda: self.store.vertical(t0, t1, srcs))
        return {"dist_nm": 2, "alt_ft": 500, "cells": [[d, a, n] for d, a, n in rows],
                "antenna_ft": self.station.antenna_asl_m * geo.FT_PER_M}

    def api_live(self, q):
        with self.sampler.lock:
            return {"time": self.sampler.live_time, "up": self.sampler.up, "aircraft": list(self.sampler.live)}

    def api_stats(self, q):
        t0, t1 = self.window(q)
        srcs = self.sources(q)
        rng = self.cache.get(("rs", t0 // 60, t1 // 60, tuple(srcs)), 60, lambda: self.store.range_stats(t0, t1, srcs))
        s = self.sampler
        rx = None
        try:
            st = self.feeds[0].stats()
            l1 = st.get("last1min", {})
            loc = l1.get("local", {})
            strong = (100.0 * loc["strong_signals"] / l1["messages"]) if l1.get("messages") and "strong_signals" in loc else None
            rx = {"messages_1min": l1.get("messages"), "msg_per_s": (l1.get("messages") or 0) / 60.0,
                  "signal_dbfs": loc.get("signal"), "noise_dbfs": loc.get("noise"), "peak_dbfs": loc.get("peak_signal"),
                  "strong_pct": strong, "gain_db": st.get("gain_db"),
                  "max_distance_nm": (l1["max_distance"] / 1852.0) if l1.get("max_distance") is not None else None,
                  "aircraft_with_pos": st.get("aircraft_with_pos"), "aircraft_without_pos": st.get("aircraft_without_pos")}
        except Exception as e:
            rx = {"error": str(e)}
        return {"range": rng, "receiver": rx, "total_points_db": self.store.total_points(),
                "recorder": {"uptime_s": int(time.time() - self.started), "buffered": len(s.buffer),
                             "counters": dict(s.counters), "rejects": s.reject_stats(), "feed_up": s.up}}

    def api_outline(self, q):
        try:
            return self.feeds[0].outline()
        except Exception as e:
            return {"error": str(e)}

    def api_reference(self, q):
        st = self.station
        return {"station": {"lat": st.lat, "lon": st.lon}, "airports": self.airports,
                "peaks": self.peaks, "places": self.places}

    def api_aircraft(self, q):
        h = q.get("hex", [""])[0].lower()
        try:
            v = int(h.lstrip("~"), 16) | ((1 << 24) if h.startswith("~") else 0)
        except ValueError:
            raise ValueError("bad hex")
        return {"hex": h, "callsign": self.store.aircraft_name(v)}

    ROUTES = {"/api/station": "api_station", "/api/config": "api_config", "/api/coverage": "api_coverage",
              "/api/compare": "api_compare", "/api/points": "api_points", "/api/vertical": "api_vertical",
              "/api/live": "api_live", "/api/stats": "api_stats", "/api/outline": "api_outline",
              "/api/reference": "api_reference", "/api/aircraft": "api_aircraft"}


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Coverage3D/" + __version__
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *a):           # keep the journal quiet: errors only
            log.debug("%s " + fmt, self.address_string(), *a)

        def _send(self, code, body: bytes, ctype, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, obj, code=200):
            self._send(code, json.dumps(obj, separators=(",", ":")).encode(), "application/json",
                       {"Cache-Control": "no-store"})

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            u = urlparse(self.path)
            path = u.path
            try:
                if path in app.ROUTES:
                    return self._json(getattr(app, app.ROUTES[path])(parse_qs(u.query)))
                if path == "/healthz":
                    return self._json({"ok": True})
                if path.startswith("/tiles/"):
                    return self._tile(path)
                return self._static(path)
            except (ValueError, KeyError) as e:
                return self._json({"error": str(e)}, 400)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                log.exception("request failed: %s", self.path)
                try:
                    self._json({"error": "internal error"}, 500)
                except Exception:
                    pass

        def _static(self, path):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            f = (WEB / rel).resolve()
            if WEB.resolve() not in f.parents or not f.is_file():
                return self._json({"error": "not found"}, 404)
            ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            self._send(200, f.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text") or "javascript" in ctype else ""),
                       {"Cache-Control": "no-cache"})

        def _tile(self, path):
            root = app.cfg.server["offline_tiles_dir"]
            m = re.fullmatch(r"/tiles/(\d{1,2})/(\d+)/(\d+)\.(png|jpg|jpeg|webp)", path)
            if not root or not m:
                return self._json({"error": "not found"}, 404)
            z, x, y, ext = m.groups()
            f = Path(root) / z / x / f"{y}.{ext}"
            if not f.is_file():
                return self._json({"error": "no tile"}, 404)
            self._send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or "image/png",
                       {"Cache-Control": "max-age=86400"})

    return Handler


def serve(app: App) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer((app.cfg.server["bind"], int(app.cfg.server["port"])), make_handler(app))
    srv.daemon_threads = True
    return srv
