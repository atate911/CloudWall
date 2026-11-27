"""Where each aircraft has been: its recent positions, its whole path since it came in range,
and the day's heatmap of everything that flew.

The radar draws only the selected aircraft's track, but every one's is kept, so one that is
tapped shows all of it at once.
"""
import math
import time
from collections import deque

from ..core import geo

TRAIL_POINTS = 30           # recent reported positions, for the ATC style's history dots behind the selected aircraft
PATH_STEP_NM = 0.15         # an aircraft's full path keeps a point each time it has moved this far,
PATH_CLIMB_FT = 300         # or climbed or descended this much,
PATH_POINTS = 1500          # up to this many (hours of circling); the radar draws the selected one's
HEAT_JOIN_S = 90           # on the day's heatmap, a position this soon after the last continues its line,
HEAT_JOIN_NM = 3           # if it is this near; otherwise (a gap in the feed) a new line starts
HEAT_STEP_NM = 0.05        # a line keeps a point each time the aircraft has moved this far,
HEAT_TOLERANCE_NM = 0.02   # and, once finished, only the points it needs to stay this close to its path
HEAT_UNIT = 100            # the lines are sent in hundredths of a nm east and north of home
PRUNE_EVERY_S = 6 * 3600    # how often cached values past their use are cleared from the place's database


class Tracks:
    def __init__(self, radius_nm, store):
        self.radius_nm, self.store = radius_nm, store
        self.trails = {}          # hex -> deque of (lat, lon), every update
        self.paths = {}           # hex -> deque of (lat, lon, alt in hundreds of ft), since it came in range
        self.heat_day = time.strftime("%Y-%m-%d")
        # the day's heatmap: every aircraft's path within the radius since midnight, as lines (the
        # page draws them at its screen's own sharpness), and which aircraft flew today. Kept as
        # "heat-paths", so a heatmap kept the old way, as a grid of squares, isn't misread.
        saved = store.cache_get("heat-paths", self.heat_day, 2 * 86400)[1] or {}
        self.heat = list(saved.get("paths") or ())    # finished lines, each flat [x0, y0, x1, y1, ...] in HEAT_UNITs
        self.heat_seen = set(saved.get("seen") or ())
        self.heat_live = {}       # hex -> [(x, y), ...] in nm, and the time of its last point: the line still being flown
        self.heat_saved = time.time()
        self.pruned = time.time() - PRUNE_EVERY_S + 300    # first a few minutes in, then every few hours

    def remember(self, airborne, now, beyond=()):
        """Each aircraft's recent positions (the ATC style's history dots) and its whole path since
        it came in range or took off, with its altitude, and its line on the day's traffic
        heatmap. The radar draws only the selected aircraft's track, but every one's is kept, so one
        that is tapped shows all of it at once. Aircraft beyond the tracking radius (shown only on a
        radar set to a longer range) get trails and paths but stay off the heatmap."""
        seen = set()
        r = self.radius_nm
        day = time.strftime("%Y-%m-%d", time.localtime(now))
        if day != self.heat_day:
            self.heat, self.heat_seen, self.heat_live, self.heat_day = [], set(), {}, day
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
        flying = {a["hex"] for a in airborne}         # (one coasting on keeps its line open)
        for hexid in [h for h in self.heat_live if h not in flying]:     # gone from the radius, or landed
            self._finish(hexid)
        if now - self.heat_saved > 60:
            self.heat_saved = now
            self.store.cache_put("heat-paths", self.heat_day, {"seen": sorted(self.heat_seen), "paths": self.heat})
        if now - self.pruned > PRUNE_EVERY_S:      # yesterday's heatmaps and the like, in this place's file
            self.pruned = now
            self.store.prune()

    def _heat_line(self, hexid, x, y, now):
        """Carry an aircraft's line on the heatmap to where it is now. A gap in the feed (too long,
        or too far) finishes the line and starts another, rather than draw a straight line across
        where it was never seen."""
        self.heat_seen.add(hexid)
        live = self.heat_live.get(hexid)
        if live and (now - live[1] > HEAT_JOIN_S or math.hypot(x - live[0][-1][0], y - live[0][-1][1]) > HEAT_JOIN_NM):
            self._finish(hexid)
            live = None
        if not live:
            self.heat_live[hexid] = [[(x, y)], now]
            return
        live[1] = now
        if math.hypot(x - live[0][-1][0], y - live[0][-1][1]) >= HEAT_STEP_NM:
            live[0].append((x, y))

    def _finish(self, hexid):
        live = self.heat_live.pop(hexid, None)
        if live and len(live[0]) > 1:
            self.heat.append(_packed(live[0]))

    def heatmap(self):
        """Today's lines: those finished, and those still being flown."""
        paths = self.heat + [_packed(pts) for pts, _ in self.heat_live.values() if len(pts) > 1]
        return {"radius_nm": self.radius_nm, "aircraft": len(self.heat_seen), "unit": HEAT_UNIT, "paths": paths}

    def of(self, hexid):
        """An aircraft's whole path and its recent positions, for the one a screen has selected."""
        return list(self.paths.get(hexid, ())), list(self.trails.get(hexid, ()))


def _simplified(pts, tol=HEAT_TOLERANCE_NM):
    """The fewest points that keep a line within tol of where it went (Douglas-Peucker): a straight
    crossing keeps its two ends, a turn as many points as its curve needs."""
    if len(pts) < 3:
        return list(pts)
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x0, y0), (x1, y1) = pts[i], pts[j]
        L = math.hypot(x1 - x0, y1 - y0)
        far, at = 0.0, None
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs((x1 - x0) * (y0 - py) - (x0 - px) * (y1 - y0)) / L if L else math.hypot(px - x0, py - y0)
            if d > far:
                far, at = d, k
        if at is not None and far > tol:
            keep.add(at)
            stack += [(i, at), (at, j)]
    return [pts[k] for k in sorted(keep)]


def _packed(pts):
    """A line as one flat list of whole hundredths of a nm: [x0, y0, x1, y1, ...], east and north."""
    return [round(v * HEAT_UNIT) for p in _simplified(pts) for v in p]
