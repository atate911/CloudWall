"""--demo: synthetic traffic around the station, with a plausible coverage pattern and an antenna
that "moved outside" after day 3 so before/after comparison has something to show.
"""
from __future__ import annotations

import math
import random
import time

from . import geo
from .filters import PointFilter


def range_model(brg, alt_ft, ant_ft, outside: bool):
    """Maximum distance (nm) this fake antenna hears at a bearing and altitude."""
    horizon = geo.radio_horizon_nm(ant_ft, alt_ft)
    f = 0.62 + 0.38 * math.cos(math.radians(brg - 340)) ** 2          # best towards NNW
    east = math.exp(-((((brg - 95 + 180) % 360) - 180) / 28) ** 2)     # Cascades block the east
    south = math.exp(-((((brg - 190 + 180) % 360) - 180) / 18) ** 2)
    block = 1.0 - (0.62 if not outside else 0.30) * east - 0.25 * south
    gain = 0.72 if not outside else 0.95
    return max(2.0, horizon * f * block * gain)


def synthetic_snapshot_points(station, cfg, now, rng, days=7, n_flights=2600):
    flt = PointFilter(station.lat, station.lon, station.antenna_asl_m, station.ground_elevation_m,
                      {**cfg.sampler, "min_nac_p": 0, "max_seen_pos_s": 99, "record_mlat": True})
    pts = []
    antenna_ft = station.antenna_asl_m * geo.FT_PER_M
    moved_t = now - (days - 3.5) * 86400
    for fi in range(n_flights):
        t_start = now - rng.random() * days * 86400
        outside = t_start > moved_t
        kind = rng.random()
        brg0 = rng.uniform(0, 360)
        if kind < 0.35:                      # local traffic: low and close
            alt0 = rng.uniform(800, 6000); r0 = rng.uniform(5, 45); cruise = alt0
        else:                                 # airliners crossing the region
            cruise = rng.choice(range(7000, 43000, 1000))      # every level, so each band fills
            alt0 = cruise; r0 = rng.uniform(180, 260)
        # straight line from the start point through a point near the station
        x0 = r0 * math.sin(math.radians(brg0)); y0 = r0 * math.cos(math.radians(brg0))
        aim = rng.uniform(0, 40)
        ax = aim * math.sin(math.radians(rng.uniform(0, 360))); ay = aim * math.cos(math.radians(rng.uniform(0, 360)))
        vx, vy = ax - x0, ay - y0
        norm = math.hypot(vx, vy) or 1
        speed = rng.uniform(110, 160) if kind < 0.35 else rng.uniform(420, 500)    # kt
        vx, vy = vx / norm * speed / 3600, vy / norm * speed / 3600                 # nm per s
        steps = int(2 * r0 / (speed / 3600) / 8)
        x, y, t = x0, y0, t_start
        for _ in range(steps):
            x += vx * 8; y += vy * 8; t += 8
            d = math.hypot(x, y)
            brg = math.degrees(math.atan2(x, y)) % 360
            alt = cruise if kind >= 0.35 else max(300, cruise + 900 * math.sin(t / 700))
            if d > 400 or d < 0.2:
                continue
            if d <= range_model(brg, alt, antenna_ft, outside) and rng.random() < 0.9:
                lat, lon = geo.destination(station.lat, station.lon, brg, d)
                rssi = -8 - 24 * min(1.0, d / max(1.0, range_model(brg, alt, antenna_ft, outside))) ** 1.3 + rng.gauss(0, 1.5)
                ac = {"hex": f"a{fi:05x}", "type": "adsb_icao", "flight": f"DMO{fi % 9000:04d}",
                      "alt_baro": int(alt - 100), "alt_geom": int(alt + 50), "lat": lat, "lon": lon,
                      "seen_pos": 0.4, "nac_p": 9, "rssi": max(-33, min(-1, rssi))}
                p = flt.process(ac, t + 0.4)
                if p:
                    pts.append(p)
    return pts


def fill_database(cfg, store, station, days=7, seed=7):
    rng = random.Random(seed)
    pts = synthetic_snapshot_points(station, cfg, time.time(), rng, days)
    store.insert_points(pts)
    return len(pts)


class DemoFeed:
    """Looks like a ReadsbFeed but invents ~25 moving aircraft."""
    name, band = "demo", "1090"

    def __init__(self, station, seed=3):
        self.st = station
        self.rng = random.Random(seed)
        self.ac = []
        for i in range(25):
            self.ac.append(self._new(i))
        self.t0 = time.time()

    def _new(self, i):
        r = self.rng
        local = r.random() < 0.4
        brg = r.uniform(0, 360)
        d = r.uniform(5, 40) if local else r.uniform(60, 180)
        return {"id": i, "x": d * math.sin(math.radians(brg)), "y": d * math.cos(math.radians(brg)),
                "hdg": r.uniform(0, 360), "gs": r.uniform(120, 170) if local else r.uniform(420, 490),
                "alt": r.uniform(1500, 7000) if local else r.choice([28000, 33000, 37000, 40000]),
                "last": time.time()}

    def aircraft(self):
        now = time.time()
        out = []
        for i, a in enumerate(self.ac):
            dt = now - a["last"]
            a["last"] = now
            a["x"] += math.sin(math.radians(a["hdg"])) * a["gs"] / 3600 * dt
            a["y"] += math.cos(math.radians(a["hdg"])) * a["gs"] / 3600 * dt
            if math.hypot(a["x"], a["y"]) > 230:
                self.ac[i] = a = self._new(a["id"])
            d = math.hypot(a["x"], a["y"])
            brg = math.degrees(math.atan2(a["x"], a["y"])) % 360
            lat, lon = geo.destination(self.st.lat, self.st.lon, brg, d)
            if d > range_model(brg, a["alt"], self.st.antenna_asl_m * geo.FT_PER_M, True):
                continue
            out.append({"hex": f"ad{a['id']:04x}", "type": "adsb_icao", "flight": f"DEMO{a['id']:03d} ",
                        "alt_baro": int(a["alt"]), "alt_geom": int(a["alt"] + 100), "lat": lat, "lon": lon,
                        "seen_pos": 0.3, "nac_p": 9, "gs": a["gs"], "track": a["hdg"], "r_dst": d,
                        "rssi": -10 - min(21.0, d / 8)})
        return {"now": now, "messages": int(now * 100), "aircraft": out}

    def receiver(self):
        return {"lat": self.st.lat, "lon": self.st.lon, "version": "demo"}

    def stats(self):
        return {"last1min": {"messages": 9000, "max_distance": 120000,
                             "local": {"signal": -12.0, "noise": -36.0, "peak_signal": -1.0, "strong_signals": 240}},
                "gain_db": 40.2, "now": time.time()}

    def outline(self):
        pts = []
        for b in range(360):
            dist = range_model(b, 35000, self.st.antenna_asl_m * geo.FT_PER_M, True) * 0.9
            la, lo = geo.destination(self.st.lat, self.st.lon, b, dist)
            pts.append([round(la, 4), round(lo, 4), 35000])
        return {"actualRange": {"last24h": {"points": pts}}}
