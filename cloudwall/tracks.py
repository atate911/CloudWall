"""Where each aircraft has been: its recent positions, its whole path since it came in range,
and the day's heatmap of everything that flew.

The radar draws only the selected aircraft's track, but every one's is kept, so one that is
tapped shows all of it at once.
"""
import math
import time
from collections import deque

from . import geo

TRAIL_POINTS = 30           # recent reported positions, for the ATC style's history dots behind the selected aircraft
PATH_STEP_NM = 0.15         # an aircraft's full path keeps a point each time it has moved this far,
PATH_CLIMB_FT = 300         # or climbed or descended this much,
PATH_POINTS = 1500          # up to this many (hours of circling); the radar draws the selected one's
HEAT_GRID = 96
PRUNE_EVERY_S = 6 * 3600    # how often cached values past their use are cleared from the place's database


class Tracks:
    def __init__(self, radius_nm, store):
        self.radius_nm, self.store = radius_nm, store
        self.trails = {}          # hex -> deque of (lat, lon), every update
        self.paths = {}           # hex -> deque of (lat, lon, alt in hundreds of ft), since it came in range
        self.heat_day = time.strftime("%Y-%m-%d")
        self.heat = {tuple(map(int, k.split(","))): v for k, v in
                     (store.cache_get("heat", self.heat_day, 2 * 86400)[1] or {}).items()}
        self.heat_saved = time.time()
        self.pruned = time.time() - PRUNE_EVERY_S + 300    # first a few minutes in, then every few hours

    def remember(self, airborne, now, beyond=()):
        """Each aircraft's recent positions (the ATC style's history dots) and its whole path since
        it came in range or took off, with its altitude, and a coarse all-day grid for the traffic
        heatmap. The radar draws only the selected aircraft's track, but every one's is kept, so one
        that is tapped shows all of it at once. Aircraft beyond the tracking radius (shown only on a
        radar set to a longer range) get trails and paths but stay off the heatmap."""
        seen = set()
        r = self.radius_nm
        day = time.strftime("%Y-%m-%d", time.localtime(now))
        if day != self.heat_day:
            self.heat, self.heat_day = {}, day
        for a in list(beyond) + airborne:
            seen.add(a["hex"])
            if a.get("coasting"):       # carried on from its last report: nothing new to remember, nothing forgotten
                continue
            trail = self.trails.setdefault(a["hex"], deque(maxlen=TRAIL_POINTS))
            trail.append((round(a["lat"], 4), round(a["lon"], 4)))
            path = self.paths.setdefault(a["hex"], deque(maxlen=PATH_POINTS))
            alt = round(a["alt"] / 100) if a.get("alt") is not None else (path[-1][2] if path else 0)
            if (not path or abs(alt - path[-1][2]) * 100 >= PATH_CLIMB_FT
                    or geo.haversine_nm(path[-1][0], path[-1][1], a["lat"], a["lon"]) >= PATH_STEP_NM):
                path.append((round(a["lat"], 4), round(a["lon"], 4), alt))
        for a in airborne:
            if a.get("coasting"):
                continue
            x = a["dist"] * math.sin(math.radians(a["brg"]))
            y = a["dist"] * math.cos(math.radians(a["brg"]))
            gx, gy = int((x + r) / (2 * r) * HEAT_GRID), int((r - y) / (2 * r) * HEAT_GRID)
            if 0 <= gx < HEAT_GRID and 0 <= gy < HEAT_GRID:
                self.heat[(gx, gy)] = self.heat.get((gx, gy), 0) + 1
        for hexid in [h for h in self.trails if h not in seen]:
            del self.trails[hexid]
            self.paths.pop(hexid, None)
        if now - self.heat_saved > 60:
            self.heat_saved = now
            self.store.cache_put("heat", self.heat_day, {f"{x},{y}": n for (x, y), n in self.heat.items()})
        if now - self.pruned > PRUNE_EVERY_S:      # yesterday's heatmaps and the like, in this place's file
            self.pruned = now
            self.store.prune()

    def heatmap(self):
        return {"grid": HEAT_GRID, "radius_nm": self.radius_nm, "cells": [[x, y, n] for (x, y), n in self.heat.items()]}

    def of(self, hexid):
        """An aircraft's whole path and its recent positions, for the one a screen has selected."""
        return list(self.paths.get(hexid, ())), list(self.trails.get(hexid, ()))
