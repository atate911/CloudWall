"""Turns raw positions into the board state: geometry, hero selection, logbook, badges."""
import json
import math
import re
import threading
import time
from collections import deque

from . import config, contrails as contrail_mod, geo, wake
from .seats import seats as seat_estimate
from .logos import AIRLINE_NAMES, flight_number, iata_for

RARE_TYPES = {
    "A388", "B741", "B742", "B744", "B748", "BLCF", "A3ST", "A337", "A342", "A343", "A345",
    "A346", "MD11", "DC10", "DC3", "DC6", "B703", "B722", "B752", "B753", "IL76", "A124",
    "A225", "C17", "C5M", "C130", "C30J", "K35R", "KC10", "K46", "B52", "B1", "E3TF", "E6",
    "P8", "F15", "F16", "F18", "F35", "F22", "A10", "V22", "H60", "H47", "B17", "B29", "P51",
    "CONC", "U2", "T38", "SF50", "PC24", "GLF6", "GL7T", "B37M", "A35K", "B78X", "B779",
}
EMERGENCY = {"7500": "HIJACK 7500", "7600": "RADIO FAIL 7600", "7700": "EMERGENCY 7700"}
AIRLINE = re.compile(r"^([A-Z]{3})\d")

# Transponder codes that mean trouble, and the matching status some transponders send directly.
EMERGENCIES = {
    "7700": ("Emergency", "The crew has declared an emergency."),
    "7600": ("Radio failure", "The crew has lost radio contact with air traffic control."),
    "7500": ("Hijack code", "The code for unlawful interference. It is occasionally set by mistake and "
                            "corrected within seconds."),
}
EMERGENCY_STATUS = {"general": "7700", "nordo": "7600", "unlawful": "7500"}
EMERGENCY_CONFIRM = 2       # consecutive updates before the screen turns red: one stray code isn't enough
RESIGHT_SECONDS = 30 * 60
LOOKAHEAD_S = 10 * 60        # look routes up this far ahead of an aircraft reaching the house
STALE_SECONDS = 60
TRAIL_POINTS = 48           # recent reported positions (~4 minutes at the default poll rate): the
                            # radar's short trails and the ATC style's history dots
PATH_STEP_NM = 0.15         # an aircraft's full path keeps a point each time it has moved this far,
PATH_CLIMB_FT = 300         # or climbed or descended this much,
PATH_POINTS = 1500          # up to this many (hours of circling); the radar draws the selected one's
RADAR_RANGES = (20, 30)     # longer ranges a screen can set its radar to, in nm, beyond the tracking radius
RANGE_HOLD_S = 90           # keep fetching a longer range this long after a screen last asked for it
HEAT_GRID = 96


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Tracker:
    def __init__(self, cfg, store, enricher):
        if "runways" not in cfg["airport"]:      # not yet filled in by config.places (tests, scripts)
            cfg = config.complete_place(cfg)
        self.cfg, self.store, self.enricher = cfg, store, enricher
        self.home = cfg["home"]
        self.lock = threading.Lock()
        self.aircraft = []
        self.beyond = []          # aircraft past the tracking radius, for a radar set to a longer range
        self.range_wanted = {}    # range (nm) -> when a screen last asked for it
        self.updated_at = None
        self.trail_s = None       # seconds between trail samples, smoothed (STARS spaces history 4.5 s apart)
        self.hero_hex = None
        self.pinned = None
        self.active = {}          # hex -> {"id", "min", "ts", "badges"}
        self.flow = None
        self.weather = None
        self.weather_full = None
        self.idle = False         # no screen open: no paid lookups
        self.basemap = None
        self.charts = None        # the chart layers the displays can draw (charts.Charts.info)
        self.logos = False
        self.status = {"source": None, "ok": False, "updated": 0, "error": None}
        self.trails = {}          # hex -> deque of (lat, lon), every update
        self.paths = {}           # hex -> deque of (lat, lon, alt in hundreds of ft), since it came in range
        self.heat_day = time.strftime("%Y-%m-%d")
        self.heat = {tuple(map(int, k.split(","))): v for k, v in
                     (store.cache_get("heat", self.heat_day, 2 * 86400)[1] or {}).items()}
        self.heat_saved = time.time()
        self.emergency_seen = {}  # hex -> (consecutive updates squawking, first seen)
        self.emergency = []
        self.heard = []           # military aircraft heard nearby with no position
        self.tfrs = []
        self.contrails = None

    # -- per-aircraft derivations -------------------------------------------
    def _on_ground(self, a):
        """Many transponders never report "on ground", so a plane taxiing at an airport
        shows up as airborne at a few hundred feet. Slow and at about ground level means
        it's on the ground. Helicopters fly slowly on purpose, so they need to be lower."""
        if a["on_ground"]:
            return True
        alt, gs, field = a["alt"], a.get("gs"), self.home.get("elevation_ft", 0)
        if alt is None or gs is None:
            return False
        if a.get("category") == "A7":
            return gs < 10 and alt < field + 100
        return gs < 45 and alt < field + 400

    def _derive(self, a):
        h = self.home
        if self._on_ground(a):
            a["on_ground"] = True
        a["dist"] = geo.haversine_nm(h["lat"], h["lon"], a["lat"], a["lon"])
        a["brg"] = geo.bearing_deg(h["lat"], h["lon"], a["lat"], a["lon"])
        a["compass"] = geo.compass(a["brg"])
        a["cwt"] = wake.category(a.get("type"))          # for the ATC-style radar's data blocks
        a["elev"] = (geo.elevation_deg(a["dist"], a["alt"], h.get("elevation_ft", 0))
                     if a["alt"] is not None else None)
        a["cpa_s"], a["cpa_nm"] = geo.cpa(h["lat"], h["lon"], a["lat"], a["lon"],
                                          a.get("track"), a.get("gs"))
        v = a.get("vrate") or 0
        a["phase"] = ("ground" if a["on_ground"] else
                      "climbing" if v > 300 else "descending" if v < -300 else "level")
        a["emergency"] = EMERGENCY.get(a.get("squawk")) or EMERGENCY.get(EMERGENCY_STATUS.get(a.get("emergency_status")))

    def _enrich(self, a):
        info = self.enricher.aircraft(a["hex"])
        if info:
            a["type_name"] = info.get("type_name")
            # the registry's model ("Vans RV-7A") tells variants apart that share a type code
            a["model"] = info.get("type_name")
            a["owner"] = info.get("owner")
            a["reg"] = a.get("reg") or info.get("reg")
        pic = self.enricher.photo(a["hex"], a.get("reg"), a.get("type"))
        if pic:
            a["photo"], a["photo_link"], a["photo_by"] = pic["src"], pic["link"], pic["by"]
        # the feed's own description ("Boeing 737 MAX 8") reads better than the database's variant codes
        if a.get("desc"):
            a["type_name"] = a["desc"]
        if a.get("owner_op") and not a.get("owner"):
            a["owner"] = a["owner_op"]
        if a.get("private_owner"):
            a["owner"] = None                     # owner asked not to be identified
        if a.get("year"):
            a["age"] = max(0, time.localtime().tm_year - a["year"])
        free = self.enricher.route(a.get("callsign"))
        if free and free.get("airline"):
            a["airline"] = free["airline"]      # the airline is reliable even when the route isn't
        elif (a.get("callsign") or "")[:3] in AIRLINE_NAMES and re.match(r"^[A-Z]{3}\d", a["callsign"]):
            a["airline"] = AIRLINE_NAMES[a["callsign"][:3]]
        a["airline_iata"] = iata_for(a.get("callsign"), (free or {}).get("airline_iata"))
        m = AIRLINE.match(a.get("callsign") or "")
        a["seats"] = seat_estimate(m.group(1) if m else None, a.get("type"))
        route = self._with_geometry(a, free)
        state, live = self._live_route(a, route)
        if live:
            route = live
        elif state == "pending" and getattr(self.enricher.live, "mode", "") == "always":
            # the live route is on its way (a second or two): don't flash the database's guess
            route = None
            a["route_pending"] = True
        if route:
            a["route"] = route
            self._airline_from_route(a, route)
            iata = self.cfg["airport"]["iata"]
            if route["plausible"]:
                a["local"] = ("arriving" if route["dest"]["iata"] == iata else
                              "departing" if route["origin"]["iata"] == iata else None)
        if not a.get("local"):
            a["local"] = self._infer_local(a)
            a["local_inferred"] = bool(a["local"])
        if a["local"] == "arriving" and not (a.get("route") and a["route"].get("plausible")):
            # no believable route, but it's on approach here: estimate the landing from the runway distance
            ap = a.get("local_field") and next(f for f in self.cfg["airport"]["others"]
                                               if f["code"] == a["local_field"]["code"]) or self.cfg["airport"]
            a["landing_est"] = self._eta_estimate(a, geo.haversine_nm(a["lat"], a["lon"], ap["lat"], ap["lon"]), ap)
        r = a.get("route")
        a["flight_no"] = (r["flight"] if r and r.get("plausible") and r.get("source") else None) \
            or flight_number(a.get("callsign")) or (r["flight"] if r and r.get("plausible") else None)

    def _airline_from_route(self, a, route):
        """A regional partner flying for a bigger airline (SkyWest as Alaska): show the airline
        you'd book with, and say who operates it."""
        painted, operating = route.get("painted_as"), route.get("operating_as")
        if painted and operating and painted != operating:
            a["airline_iata"] = iata_for(painted + "1") or a.get("airline_iata")
            a["airline"] = AIRLINE_NAMES.get(painted) or a.get("airline")
            a["operated_by"] = AIRLINE_NAMES.get(operating) or operating

    def _infer_local(self, a):
        """No believable route: the aircraft's own behaviour near the airport still
        tells us whether it is landing there or has just taken off."""
        ap = self.cfg["airport"]
        if (a["on_ground"] or a["alt"] is None or a["alt"] > 6000 or a.get("track") is None
                or a.get("category") == "A7"):
            return None
        d = geo.haversine_nm(a["lat"], a["lon"], ap["lat"], ap["lon"])
        field = self._small_field(a, d)
        if field:
            return field
        if d > 18:
            return None
        to_ap = geo.bearing_deg(a["lat"], a["lon"], ap["lat"], ap["lon"])
        off = abs((a["track"] - to_ap + 180) % 360 - 180)          # 0 = heading straight at it
        v = a.get("vrate") or 0
        if v < -300 and (off < 35 or d < 2.5):
            return "arriving"
        if v > 300 and off > 120:
            return "departing"
        return None

    def _small_field(self, a, d_main):
        """Light aircraft low over Pearson Field or Troutdale are theirs, not the big airport's."""
        if AIRLINE.match(a.get("callsign") or "") or a.get("category") in ("A3", "A4", "A5"):
            return None
        for f in self.cfg["airport"].get("others") or []:
            d = geo.haversine_nm(a["lat"], a["lon"], f["lat"], f["lon"])
            if d > 3 or d > d_main or a["alt"] - f.get("elevation_ft", 0) > 2000:
                continue
            v = a.get("vrate") or 0
            a["local_field"] = {"code": f["code"], "name": f["name"], "city": f.get("city")}
            return "arriving" if v < -300 else "departing" if v > 300 else "local"
        return None

    def _with_geometry(self, a, route):
        """Add distance flown/left and a sanity check of the route against the aircraft's position."""
        if not route:
            return None
        ap = self.cfg["airport"]
        # the local airport's position and city are always known, whatever the provider sent
        route = dict(route, origin=dict(route["origin"]), dest=dict(route["dest"]))
        for end in (route["origin"], route["dest"]):
            if end.get("iata") in (ap["iata"], ap["icao"]):
                end["iata"] = ap["iata"]
                if end.get("lat") is None:
                    end["lat"], end["lon"] = ap["lat"], ap["lon"]
                end["city"] = end.get("city") or ap.get("city")
        o, d = route["origin"], route["dest"]
        if o.get("lat") is None or d.get("lat") is None:
            # no coordinates for the far end (the provider's airport lookup was unavailable):
            # trust a paid route as-is, and don't pretend to know how far along it is
            if not route.get("source"):
                return None
            pct = route.get("progress_percent")
            left = (geo.haversine_nm(a["lat"], a["lon"], d["lat"], d["lon"]) if d.get("lat") is not None else None)
            return dict(route, flown_nm=None, left_nm=left, plausible=True,
                        progress=pct / 100 if pct is not None else None, eta_est=self._eta_estimate(a, left, d))
        flown = geo.haversine_nm(o["lat"], o["lon"], a["lat"], a["lon"])
        left = geo.haversine_nm(a["lat"], a["lon"], d["lat"], d["lon"])
        plausible = geo.route_plausible(o["lat"], o["lon"], d["lat"], d["lon"], a["lat"], a["lon"])
        # Low and close to the local airport, yet the route doesn't touch it: the
        # callsign database is stale (airlines reuse flight numbers).
        if (ap["iata"] not in (o["iata"], d["iata"]) and a["alt"] is not None and a["alt"] < 7000
                and geo.haversine_nm(ap["lat"], ap["lon"], a["lat"], a["lon"]) < 20):
            plausible = False
        return dict(route, flown_nm=flown, left_nm=left, progress=flown / max(flown + left, 1),
                    plausible=plausible, eta_est=self._eta_estimate(a, left, d))

    def _eta_estimate(self, a, left_nm, dest):
        """Rough landing time from distance and ground speed, when the provider gives none.
        Aircraft slow down for the approach, so add a few minutes near the end."""
        gs = a.get("gs") or 0
        if a["on_ground"] or gs < 80 or left_nm is None:
            return None
        return time.time() + left_nm / gs * 3600 * 1.08 + (180 if left_nm < 60 else 600)

    def _live_route(self, a, free_route):
        """Route from the paid provider (Flightradar24 / FlightAware), which knows the
        flight actually in the air. Lookups are billed, so they're made only for
        aircraft that matter: overhead, pinned, or heading for the house within the
        next 10 minutes, early enough that the right route is ready when it arrives.
        Returns (state, route) as Enricher.live_route does."""
        fa = getattr(self.enricher, "live", None)
        if not fa or not fa.enabled:
            return "n/a", None
        t = self.cfg["tracking"]
        near = (self._overhead(a) or a["hex"] == self.pinned
                or (0 < a["cpa_s"] <= LOOKAHEAD_S and a["cpa_nm"] <= t["overhead_nm"]))
        needed = fa.mode == "always" or not (free_route and free_route["plausible"])
        state, live = self.enricher.live_route(a.get("callsign"), fetch=near and needed and not a["on_ground"] and not self.idle)
        if live:
            live = self._with_geometry(a, dict(live, airline=(free_route or {}).get("airline")))
        return state, live

    # -- selection ------------------------------------------------------------
    def _overhead(self, a):
        t = self.cfg["tracking"]
        # it also has to be clearly above the horizon from the house
        return (not a["on_ground"] and a["alt"] is not None and a["dist"] <= t["overhead_nm"]
                and a["alt"] <= t["max_overhead_alt_ft"] and (a["elev"] or 0) >= 2)

    def _pick_hero(self, by_hex):
        if self.pinned in by_hex:
            return self.pinned
        self.pinned = None
        cands = [a for a in by_hex.values() if self._overhead(a)]
        if not cands:
            return None
        best = max(cands, key=lambda a: a["elev"])
        cur = by_hex.get(self.hero_hex)
        # hysteresis: don't flip between two aircraft at similar elevation angles
        if cur and self._overhead(cur) and best["elev"] < cur["elev"] + 12:
            return cur["hex"]
        return best["hex"]

    # -- logbook --------------------------------------------------------------
    def _badges(self, a, airline_icao):
        b = []
        if a.get("emergency"):
            b.append(a["emergency"])
        if a.get("military"):
            b.append("MILITARY")
        if a.get("type") in RARE_TYPES:
            b.append("RARE TYPE")
        if a.get("category") == "A5":
            b.append("HEAVY")
        if a.get("category") == "A7":
            b.append("HELICOPTER")
        if a.get("type") and not self.store.count("type=?", (a["type"],)):
            b.append("NEW TYPE")
        if airline_icao and not self.store.count("airline_icao=?", (airline_icao,)):
            b.append("NEW AIRLINE")
        visits = self.store.count("hex=?", (a["hex"],))
        if visits:
            b.append(f"{ordinal(visits + 1)} VISIT")
        return b

    def _log(self, a, now):
        m = AIRLINE.match(a.get("callsign") or "")
        airline_icao = m.group(1) if m else None
        s = self.active.get(a["hex"])
        if not s:
            s = self._resume(a["hex"], now)
        if not s or now - s["ts"] > RESIGHT_SECONDS:
            badges = self._badges(a, airline_icao)
            sid = self.store.add_sighting(
                ts=now, day=time.strftime("%Y-%m-%d", time.localtime(now)), hex=a["hex"],
                callsign=a.get("callsign"), reg=a.get("reg"), type=a.get("type"),
                airline_icao=airline_icao, min_dist_nm=round(a["dist"], 2), alt_ft=a["alt"],
                gs=a.get("gs"), badges=badges, seats=(a.get("seats") or {}).get("n"))
            s = self.active[a["hex"]] = {"id": sid, "min": a["dist"], "badges": badges,
                                         "seats": (a.get("seats") or {}).get("n")}
        s["ts"] = now
        upd = {}
        if a["dist"] < s["min"]:
            s["min"] = a["dist"]
            upd.update(min_dist_nm=round(a["dist"], 2), alt_ft=a["alt"], gs=a.get("gs"))
        # Lookups arrive a few seconds after first sight (and the paid provider may later
        # correct the free route), so back-fill the entry whenever they change.
        r = a.get("route")
        if a.get("photo") and not s.get("photo"):
            s["photo"] = True
            upd.update(photo=a["photo"], photo_link=a.get("photo_link"), photo_by=a.get("photo_by"))
        n = (a.get("seats") or {}).get("n")
        if n is not None and n != s.get("seats"):
            s["seats"] = n
            upd.update(seats=n)
        if a.get("type_name") and not s.get("named"):
            s["named"] = True
            upd.update(type_name=a["type_name"], reg=a.get("reg"))
        if a.get("model") and not s.get("modeled"):
            s["modeled"] = True
            upd.update(model=a["model"])
        if r and r["plausible"]:
            key = (r["flight"], r["origin"]["iata"], r["dest"]["iata"])
            if s.get("route") != key:
                s["route"] = key
                upd.update(flight=r["flight"], airline=r.get("airline"), origin=key[1], dest=key[2],
                           origin_nm=round(r["flown_nm"]) if r.get("flown_nm") is not None else None)
        if upd:
            self.store.update_sighting(s["id"], **upd)
        a["badges"] = s["badges"]

    def _remember_tracks(self, airborne, now, beyond=()):
        """Each aircraft's recent positions (the radar's short trails, the ATC style's history
        dots) and its whole path since it came in range or took off, with its altitude (drawn on the
        radar behind the selected aircraft, so kept for every one in case it is tapped), and a
        coarse all-day grid for the traffic heatmap. Aircraft beyond the tracking radius (shown only
        on a radar set to a longer range) get trails and paths but stay off the heatmap."""
        seen = set()
        r = self.cfg["tracking"]["radius_nm"]
        day = time.strftime("%Y-%m-%d", time.localtime(now))
        if day != self.heat_day:
            self.heat, self.heat_day = {}, day
        for a in list(beyond) + airborne:
            seen.add(a["hex"])
            trail = self.trails.setdefault(a["hex"], deque(maxlen=TRAIL_POINTS))
            trail.append((round(a["lat"], 4), round(a["lon"], 4)))
            a["trail"] = list(trail)
            path = self.paths.setdefault(a["hex"], deque(maxlen=PATH_POINTS))
            alt = round(a["alt"] / 100) if a.get("alt") is not None else (path[-1][2] if path else 0)
            if (not path or abs(alt - path[-1][2]) * 100 >= PATH_CLIMB_FT
                    or geo.haversine_nm(path[-1][0], path[-1][1], a["lat"], a["lon"]) >= PATH_STEP_NM):
                path.append((round(a["lat"], 4), round(a["lon"], 4), alt))
        for a in airborne:
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

    def heatmap(self):
        with self.lock:
            return {"grid": HEAT_GRID, "radius_nm": self.cfg["tracking"]["radius_nm"],
                    "cells": [[x, y, n] for (x, y), n in self.heat.items()]}

    def _resume(self, hexid, now):
        """After a restart, carry on with a flyover already logged in the last half hour
        instead of counting the same pass twice."""
        rows = self.store.query("SELECT id, ts, min_dist_nm, badges, origin, dest, flight, type_name "
                                "FROM sightings WHERE hex=? AND ts>? ORDER BY ts DESC LIMIT 1",
                                (hexid, now - RESIGHT_SECONDS))
        if not rows:
            return None
        r = rows[0]
        s = {"id": r["id"], "ts": r["ts"], "min": r["min_dist_nm"], "badges": json.loads(r["badges"] or "[]"),
             "named": bool(r["type_name"])}
        if r["origin"]:
            s["route"] = (r["flight"], r["origin"], r["dest"])
        self.active[hexid] = s
        return s

    def _update_flow(self, aircraft):
        """Guess which way the airport is landing from low, descending traffic near it, and so
        which runways are in use: those whose landing direction its track matches."""
        ap = self.cfg["airport"]
        ways = []          # (runway as named for landing that way, its landing direction in degrees true)
        for w in ap.get("runways") or []:
            (lat1, lon1), (lat2, lon2) = w["ends"]
            first, second = w["name"].split("/")
            h = geo.bearing_deg(lat1, lon1, lat2, lon2)       # landing on the first-named end
            ways += [(first, h), (second, (h + 180) % 360)]
        if not ways:
            return
        off = lambda a, b: abs((a - b + 180) % 360 - 180)
        for a in aircraft:
            if (a["on_ground"] or a["alt"] is None or a["alt"] > 4000 or a.get("track") is None
                    or (a.get("vrate") or 0) > -200 or (a.get("gs") or 0) < 110):
                continue
            if geo.haversine_nm(ap["lat"], ap["lon"], a["lat"], a["lon"]) > 12:
                continue
            name, hdg = min(ways, key=lambda w: off(a["track"], w[1]))
            if off(a["track"], hdg) >= 25:
                continue
            word = ("north", "east", "south", "west")[round(hdg / 90) % 4]
            in_use = sorted(n for n, h in ways if off(h, hdg) < 10)      # the parallels landing the same way
            self.flow = {"dir": word, "label": f"{word.capitalize()} flow", "runways": " / ".join(in_use)}

    # -- main entry points ------------------------------------------------------
    # -- radar range -------------------------------------------------------------
    # A screen can set its radar to a longer range than the tracking radius. The feed is then
    # asked for the longer range, but only aircraft within the tracking radius count for the
    # board, the flight card, the logbook and route lookups: the rest are for the radar alone.
    def ranges(self):
        r = self.cfg["tracking"]["radius_nm"]
        return sorted({r, *(x for x in RADAR_RANGES if x > r)})

    def want_range(self, nm, square=False):
        """A screen showing the radar at this range asked for data. A square display (the ATC
        style, whose range is from its centre to its edge) reaches √2 times as far in its corners."""
        if nm in self.ranges():
            self.range_wanted[round(nm * (math.sqrt(2) if square else 1), 1)] = time.time()

    def fetch_radius(self):
        """How far out to ask the feed for: the longest range a screen asked for lately."""
        now = time.time()
        # a copy: the server's threads add to range_wanted while this runs on the poller's
        recent = [nm for nm, at in list(self.range_wanted.items()) if now - at < RANGE_HOLD_S]
        return max([self.cfg["tracking"]["radius_nm"], *recent])

    def update(self, raw, source):
        now = time.time()
        if self.updated_at is not None and 0 < now - self.updated_at < 120:
            gap = now - self.updated_at
            self.trail_s = gap if self.trail_s is None else self.trail_s * 0.8 + gap * 0.2
        self.updated_at = now
        for a in raw:
            self._derive(a)
        raw.sort(key=lambda a: a["dist"])
        r = self.cfg["tracking"]["radius_nm"]
        beyond = [a for a in raw if a["dist"] > r and not a["on_ground"]]
        raw = [a for a in raw if a["dist"] <= r]
        airborne = [a for a in raw if not a["on_ground"]]
        # look up the nearest aircraft, plus anything heading for the house soon
        t = self.cfg["tracking"]
        soon = [a for a in airborne[10:] if 0 < a["cpa_s"] <= LOOKAHEAD_S and a["cpa_nm"] <= t["overhead_nm"]]
        emergency = self._emergencies(raw, now)
        for a in airborne[:10] + soon + [a for a in emergency if a not in airborne[:10] + soon]:
            self._enrich(a)
        for a in airborne:
            a["contrail"] = contrail_mod.for_altitude(self.contrails, a["alt"])
        by_hex = {a["hex"]: a for a in raw}
        with self.lock:
            self.hero_hex = self._pick_hero(by_hex)
            for a in airborne:
                if self._overhead(a):
                    self._log(a, now)
            self._remember_tracks(airborne, now, beyond)
            self._update_flow(raw)
            self.aircraft = raw
            self.beyond = beyond
            self.emergency = emergency
            self.status = {"source": source, "ok": True, "updated": now, "error": None}

    def _emergencies(self, raw, now):
        """Aircraft squawking 7700, 7600 or 7500, confirmed over more than one update."""
        seen, out = {}, []
        for a in raw:
            code = a.get("squawk") if a.get("squawk") in EMERGENCIES else EMERGENCY_STATUS.get(a.get("emergency_status"))
            if not code:
                continue
            n, since = self.emergency_seen.get(a["hex"], (0, now))
            seen[a["hex"]] = (n + 1, since)
            if n + 1 >= EMERGENCY_CONFIRM:
                title, meaning = EMERGENCIES[code]
                a.update(emergency_code=code, emergency_title=title, emergency_meaning=meaning, emergency_since=since)
                out.append(a)
        self.emergency_seen = seen
        return sorted(out, key=lambda a: a["dist"])

    def failed(self, source, error):
        """One missed update isn't worth a warning on screen; 30 seconds without data is."""
        with self.lock:
            self.status.update(source=source, error=str(error))
            if time.time() - self.status["updated"] > 30:
                self.status["ok"] = False

    def pin(self, hexid):
        with self.lock:
            # only aircraft within the tracking radius have a flight card: a target tapped on a
            # longer-range radar isn't one of them
            if hexid and not any(a["hex"] == hexid for a in self.aircraft):
                return
            self.pinned = hexid
            if hexid:
                self.hero_hex = hexid

    def snapshot(self):
        with self.lock:
            if (self.aircraft or self.beyond) and time.time() - self.status["updated"] > STALE_SECONDS:
                self.aircraft, self.beyond, self.hero_hex = [], [], None   # don't show positions we can't trust
            hero = next((a for a in self.aircraft if a["hex"] == self.hero_hex), None)
            if hero:      # the selected aircraft (overhead, or tapped) carries its whole path
                hero = dict(hero, path=list(self.paths.get(hero["hex"], ())))
            nxt = None
            if not hero:
                inbound = [a for a in self.aircraft if not a["on_ground"] and a["cpa_s"] > 0
                           and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]]
                nxt = min(inbound, key=lambda a: a["cpa_s"], default=None)
            return {
                "now": time.time(), "home": self.home, "airport": self.cfg["airport"],
                "tracking": self.cfg["tracking"], "hero": hero, "pinned": self.pinned,
                "next": nxt, "aircraft": self.aircraft, "flow": self.flow,
                "beyond": self.beyond, "ranges": self.ranges(), "kiosk": self.cfg["kiosk"],
                "weather": self.weather, "status": self.status, "basemap": self.basemap, "charts": self.charts, "logos": self.logos,
                "trail_s": round(self.trail_s or self.cfg["tracking"]["poll_seconds"], 2),
                "live_routes": p.status() if (p := getattr(self.enricher, "live", None)) else None,
                "today": self.store.count("day=?", (time.strftime("%Y-%m-%d"),)),
                "seats_today": self.store.seat_total("day=?", (time.strftime("%Y-%m-%d"),))["seats"],
                "emergency": self.emergency if self.aircraft else [],
                "heard": self.heard, "tfrs": self.tfrs,
                "contrails": {k: v for k, v in self.contrails.items() if k != "levels"} if self.contrails else None,
            }
