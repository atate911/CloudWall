"""Background sampler: polls readsb every few seconds, filters, buffers, batch-writes to SQLite."""
from __future__ import annotations

import logging
import threading
import time
from collections import Counter

from .filters import PointFilter
from .station import build_station

log = logging.getLogger("coverage3d.sampler")


class Sampler(threading.Thread):
    def __init__(self, cfg, store, feeds):
        super().__init__(name="sampler", daemon=True)
        self.cfg, self.store, self.feeds = cfg, store, feeds
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        rec = self._safe(feeds[0].receiver) if feeds else None
        self.station = build_station(cfg, rec)
        # Told to take the station's position from the receiver, nothing is sampled until the
        # receiver has said it (it may still be starting): distances from the config's stand-in
        # position would be kept for good.
        self.placed = not feeds or cfg.station.get("position_source", "receiver") != "receiver" or self._has_position(rec)
        if not self.placed:
            log.warning("receiver.json isn't there yet: sampling waits until the receiver gives the station's position")
        self.filters = [self._new_filter(f) for f in feeds]
        self.last_now = [None] * len(feeds)
        self.up = [None] * len(feeds)                  # None = unknown, True/False = last state
        self.buffer = []
        self.live = []                                 # latest compact aircraft list (for /api/live)
        self.live_by_feed = [[] for _ in feeds]
        self.live_time = 0.0
        self.counters = Counter()                      # lifetime counters for /api/stats
        self.last_flush = time.time()
        self.last_hourly = time.time()

    def _new_filter(self, feed):
        s = self.station
        return PointFilter(s.lat, s.lon, s.antenna_asl_m, s.ground_elevation_m,
                           self.cfg.sampler, feed.band)

    @staticmethod
    def _has_position(rec):
        return bool(rec) and "lat" in rec and "lon" in rec

    @staticmethod
    def _safe(fn):
        try:
            return fn()
        except Exception:
            return None

    # ------------------------------------------------------------------------------------------
    def poll_once(self):
        """One poll of every feed. Public so tests can drive it."""
        if not self.placed:
            self.refresh_station()
            if not self.placed:
                return
        fresh = False
        for i, feed in enumerate(self.feeds):
            try:
                snap = feed.aircraft()
            except Exception as e:
                if self.up[i] is not False:
                    log.warning("[%s] live feed unavailable (%s); will keep retrying", feed.name, e)
                self.up[i] = False
                self.live_by_feed[i] = []
                continue
            if self.up[i] is False:
                log.info("[%s] live feed is back", feed.name)
            self.up[i] = True
            now = snap.get("now")
            if now is None or now == self.last_now[i]:
                continue                                # same snapshot as last poll
            self.last_now[i] = now
            flt = self.filters[i]
            new, live, fresh = [], [], True
            for ac in snap.get("aircraft", ()):
                if ac.get("type") == "mode_s":
                    self.counters["mode_s_seen"] += 1
                p = flt.process(ac, now)
                if p:
                    new.append(p)
                if ac.get("lat") is not None and ac.get("lon") is not None:
                    live.append(self._live_entry(ac, feed))
            if new:
                with self.lock:
                    self.buffer.extend(new)
                self.counters["points_sampled"] += len(new)
            self.live_by_feed[i] = live
            if len(flt.last) > 5000 or int(now) % 300 == 0:
                flt.prune(now)
        # (a poll that finds only the snapshot it already had leaves the list, and its time, as they were)
        live = [entry for per_feed in self.live_by_feed for entry in per_feed]
        with self.lock:
            self.live = live
            if fresh:
                self.live_time = time.time()

    @staticmethod
    def _live_entry(ac, feed):
        return {"hex": ac.get("hex"), "flight": (ac.get("flight") or "").strip(), "type": ac.get("type"),
                "lat": ac.get("lat"), "lon": ac.get("lon"), "alt_baro": ac.get("alt_baro"),
                "alt_geom": ac.get("alt_geom"), "gs": ac.get("gs"), "track": ac.get("track"),
                "rssi": ac.get("rssi"), "seen_pos": ac.get("seen_pos"), "r_dst": ac.get("r_dst"),
                "t": ac.get("t"), "source": feed.name}

    def flush(self) -> int:
        with self.lock:
            batch, self.buffer = self.buffer, []
        if not batch:
            return 0
        try:
            n = self.store.insert_points(batch)
        except Exception:
            log.exception("database write failed; keeping %d points to retry", len(batch))
            with self.lock:
                self.buffer = batch + self.buffer
            return 0
        self.counters["points_written"] += n
        log.debug("wrote %d points", n)
        return n

    def reject_stats(self) -> dict:
        tot = Counter()
        for f in self.filters:
            tot.update(f.stats)
        return dict(tot)

    def maintenance(self):
        c = self.cfg
        try:
            self.store.aggregate_days(c.coverage["sector_deg"], c.coverage["band_ft"], c.coverage["max_alt_ft"])
            self.store.prune(c.storage["retention_days"])
        except Exception:
            log.exception("maintenance failed")

    def refresh_station(self):
        rec = self._safe(self.feeds[0].receiver) if self.feeds else None
        if self.cfg.station.get("position_source", "receiver") == "receiver" and self.feeds:
            if not self._has_position(rec):
                return                     # not answering just now: the station stays where it was
            if not self.placed:
                log.info("the receiver has given the station's position: sampling starts")
            self.placed = True
        st = build_station(self.cfg, rec)
        if (st.lat, st.lon, st.antenna_asl_m) != (self.station.lat, self.station.lon, self.station.antenna_asl_m):
            log.warning("station position/height changed: now %.6f, %.6f, antenna %.1f m ASL",
                        st.lat, st.lon, st.antenna_asl_m)
            self.station = st
            for f in self.filters:
                f.set_station(st.lat, st.lon, st.antenna_asl_m, st.ground_elevation_m)

    def run(self):
        interval = self.cfg.sampler["poll_interval_s"]
        flush_s = self.cfg.sampler["flush_interval_s"]
        log.info("sampler started: polling every %.1f s, writing every %.0f s", interval, flush_s)
        self.maintenance()
        while not self.stop_event.is_set():
            t0 = time.time()
            try:
                self.poll_once()
                if t0 - self.last_flush >= flush_s:
                    self.flush()
                    self.last_flush = t0
                if t0 - self.last_hourly >= 3600:
                    self.last_hourly = t0
                    self.refresh_station()
                    self.maintenance()
            except Exception:
                log.exception("sampler iteration failed")
            self.stop_event.wait(max(0.2, interval - (time.time() - t0)))
        self.flush()
        log.info("sampler stopped")

    def stop(self):
        self.stop_event.set()
