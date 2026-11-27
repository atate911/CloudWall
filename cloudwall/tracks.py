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
HEAT_GRID = 240            # the heatmap's squares across the tracking radius's width: an eighth of a nm at 15 nm
HEAT_JOIN_S = 90           # a position this soon after the last is joined to it on the heatmap,
HEAT_JOIN_NM = 3           # if it is this near; otherwise (a gap in the feed) it stands alone
PRUNE_EVERY_S = 6 * 3600    # how often cached values past their use are cleared from the place's database


class Tracks:
    def __init__(self, radius_nm, store):
        self.radius_nm, self.store = radius_nm, store
        self.trails = {}          # hex -> deque of (lat, lon), every update
        self.paths = {}           # hex -> deque of (lat, lon, alt in hundreds of ft), since it came in range
        self.heat_day = time.strftime("%Y-%m-%d")
        # the day's heatmap: how many times aircraft crossed each square, and which aircraft flew today
        # (kept as "heat-lines", so a heatmap kept the old way, positions on a coarser grid, isn't misread)
        saved = store.cache_get("heat-lines", self.heat_day, 2 * 86400)[1] or {}
        fits = saved.get("grid") == HEAT_GRID
        self.heat = {tuple(map(int, k.split(","))): v for k, v in (saved.get("cells") or {}).items()} if fits else {}
        self.heat_seen = set(saved.get("seen") or ()) if fits else set()
        self.heat_last = {}       # hex -> (x, y in nm from home, time): where each was last put on the heatmap
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
            self.heat, self.heat_seen, self.heat_day = {}, set(), day
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
            self._heat_line(a["hex"], x, y, now)
        for hexid in [h for h in self.trails if h not in seen]:
            del self.trails[hexid]
            self.paths.pop(hexid, None)
        for hexid in [h for h in self.heat_last if h not in seen]:
            del self.heat_last[hexid]
        if now - self.heat_saved > 60:
            self.heat_saved = now
            self.store.cache_put("heat-lines", self.heat_day, {"grid": HEAT_GRID, "seen": sorted(self.heat_seen),
                                                                "cells": {f"{x},{y}": n for (x, y), n in self.heat.items()}})
        if now - self.pruned > PRUNE_EVERY_S:      # yesterday's heatmaps and the like, in this place's file
            self.pruned = now
            self.store.prune()

    def _cell(self, x, y):
        r = self.radius_nm
        return int((x + r) / (2 * r) * HEAT_GRID), int((r - y) / (2 * r) * HEAT_GRID)

    def _heat_line(self, hexid, x, y, now):
        """Put an aircraft's move since its last position on the heatmap: every square its line
        crosses counts once, so a route reads as a continuous line however far apart the reports are,
        and a square's count is how many times aircraft passed through it, not how long they lingered
        there (a helicopter hovering for an hour adds nothing after its first pass)."""
        last = self.heat_last.get(hexid)
        self.heat_last[hexid] = (x, y, now)
        self.heat_seen.add(hexid)
        end = self._cell(x, y)
        if last and now - last[2] <= HEAT_JOIN_S and math.hypot(x - last[0], y - last[1]) <= HEAT_JOIN_NM:
            start = self._cell(last[0], last[1])
            # sampled at a third of a square, so no square on the line is skipped
            steps = max(1, math.ceil(math.hypot(x - last[0], y - last[1]) / (2 * self.radius_nm / HEAT_GRID) * 3))
            cells = {self._cell(last[0] + (x - last[0]) * i / steps, last[1] + (y - last[1]) * i / steps) for i in range(steps + 1)}
            cells.discard(start)        # counted when it got there
        else:
            cells = {end}
        for c in cells:
            if 0 <= c[0] < HEAT_GRID and 0 <= c[1] < HEAT_GRID:
                self.heat[c] = self.heat.get(c, 0) + 1

    def heatmap(self):
        return {"grid": HEAT_GRID, "radius_nm": self.radius_nm, "aircraft": len(self.heat_seen),
                "cells": [[x, y, n] for (x, y), n in self.heat.items()]}

    def of(self, hexid):
        """An aircraft's whole path and its recent positions, for the one a screen has selected."""
        return list(self.paths.get(hexid, ())), list(self.trails.get(hexid, ()))
