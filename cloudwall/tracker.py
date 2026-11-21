"""Turns the feed's positions into the board: where each aircraft is from here, which one is
overhead, which a screen follows, which way the airport is landing, who is squawking trouble.

What is known of an aircraft beyond its position is details.py's, the logbook is logbook.py's
and the tracks and heatmap are tracks.py's; the tracker calls on each as an update goes by.
"""
import logging
import math
import re
import threading
import time

from . import aircraft, airlines, config, contrails as contrail_mod, geo, situation
from .details import Details
from .logbook import Logbook
from .tracks import Tracks

log = logging.getLogger("cloudwall.tracker")

# Transponder codes that mean trouble: the badge, the headline, and what it means. Some
# transponders send the matching status directly instead.
EMERGENCIES = {
    "7700": ("EMERGENCY 7700", "Emergency", "The crew has declared an emergency."),
    "7600": ("RADIO FAIL 7600", "Radio failure", "The crew has lost radio contact with air traffic control."),
    "7500": ("HIJACK 7500", "Hijack code", "The code for unlawful interference. It is occasionally set by mistake "
                                           "and corrected within seconds."),
}
EMERGENCY_STATUS = {"general": "7700", "nordo": "7600", "unlawful": "7500"}
EMERGENCY_CONFIRM = 2       # consecutive updates before the screen turns red: one stray code isn't enough
LOOKAHEAD_S = 10 * 60        # look routes up this far ahead of an aircraft reaching the house
STALE_SECONDS = 60
RADAR_RANGES = (20, 30)     # longer ranges a screen can set its radar to, in nm, beyond the tracking radius
RANGE_HOLD_S = 90           # keep fetching a longer range this long after a screen last asked for it
PIN_HOLD_S = 15             # a flight a screen follows counts as wanted this long after it last asked
PIN_GRACE_S = 30            # and is carried on from its last report this long when the feed leaves it out
FLOW_KEEP_S = 60 * 60       # the runways in use are forgotten when nothing has landed for this long


def emergency_code(a):
    """The trouble code an aircraft is showing, by its squawk or its transponder's status; or None."""
    return a.get("squawk") if a.get("squawk") in EMERGENCIES else EMERGENCY_STATUS.get(a.get("emergency_status"))


class Tracker:
    def __init__(self, cfg, store, enricher):
        if "runways" not in cfg["airport"]:      # not yet filled in by config.places (tests, scripts)
            cfg = config.complete_place(cfg)
        self.cfg, self.store, self.enricher = cfg, store, enricher
        self.home = cfg["home"]
        self.details = Details(cfg, enricher)                       # routes, airframes, arriving or leaving
        self.logbook = Logbook(store)                               # the flyovers
        self.tracks = Tracks(cfg["tracking"]["radius_nm"], store)   # where each has been, and the heatmap
        self.lock = threading.Lock()
        self.aircraft = []
        self.beyond = []          # aircraft past the tracking radius, for a radar set to a longer range
        self.range_wanted = {}    # range (nm) -> when a screen last asked for it
        self.updated_at = None
        self.trail_s = None       # seconds between trail samples, smoothed (STARS spaces history 4.5 s apart)
        self.hero_hex = None      # the aircraft overhead, shared by every screen
        self.said = {}            # the hospitals medical helicopters were last said to be going to (medical.py)
        self.pins = {}            # hex -> when a screen last asked to follow it: each screen picks its own
        self.pinned_now = set()   # the flights screens follow, as of the last update
        self.flow = None
        self.flow_at = 0.0        # when an arrival last showed which way the airport is landing
        self.complained = 0.0     # when a record that couldn't be used was last reported
        self.status = {"source": None, "ok": False, "updated": 0, "error": None}
        self.emergency_seen = {}  # hex -> (consecutive updates squawking, first seen)
        self.emergency = []

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
        a["cwt"] = aircraft.wake(a.get("type"))          # for the ATC-style radar's data blocks
        icon = aircraft.icon(a.get("type"), a.get("desc"), a.get("category"))    # and the chart style's icon
        if icon:
            a["icon"] = icon
        colors = airlines.colors(a.get("callsign"))      # and the board's swatch
        if colors:
            a["colors"] = colors
        a["elev"] = (geo.elevation_deg(a["dist"], a["alt"], h.get("elevation_ft", 0))
                     if a["alt"] is not None else None)
        a["cpa_s"], a["cpa_nm"] = geo.cpa(h["lat"], h["lon"], a["lat"], a["lon"],
                                          a.get("track"), a.get("gs"))
        v = a.get("vrate") or 0
        a["phase"] = ("ground" if a["on_ground"] else
                      "climbing" if v > 300 else "descending" if v < -300 else "level")
        code = emergency_code(a)
        a["emergency"] = EMERGENCIES[code][0] if code else None
        if code:
            a["spc"] = code                              # the code itself, for the ATC style's data block

    # -- selection ------------------------------------------------------------
    def _soon(self, a):
        """Heading for the house, and due within the next ten minutes."""
        return 0 < a["cpa_s"] <= LOOKAHEAD_S and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]

    def _overhead(self, a):
        t = self.cfg["tracking"]
        # it also has to be clearly above the horizon from the house
        return (not a["on_ground"] and a["alt"] is not None and a["dist"] <= t["overhead_nm"]
                and a["alt"] <= t["max_overhead_alt_ft"] and (a["elev"] or 0) >= 2)

    def _pick_hero(self, by_hex):
        cands = [a for a in by_hex.values() if self._overhead(a)]
        if not cands:
            return None
        best = max(cands, key=lambda a: a["elev"])
        cur = by_hex.get(self.hero_hex)
        # hysteresis: don't flip between two aircraft at similar elevation angles
        if cur and self._overhead(cur) and best["elev"] < cur["elev"] + 12:
            return cur["hex"]
        return best["hex"]

    def _update_flow(self, aircraft, now=None):
        """Guess which way the airport is landing from low, descending traffic near it, and so
        which runways are in use: those whose landing direction its track matches. The guess
        lapses when nothing has landed for an hour: overnight the wind, and the runways, change."""
        now = now or time.time()
        if self.flow and now - self.flow_at > FLOW_KEEP_S:
            self.flow = None
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
            self.flow_at = now

    # -- main entry points ------------------------------------------------------
    # -- radar range -------------------------------------------------------------
    # A screen can set its radar to a longer range than the tracking radius. The feed is then
    # asked for the longer range, but only aircraft within the tracking radius count for the
    # board, the flight card, the logbook and route lookups: the rest are for the radar alone.
    def ranges(self):
        r = self.cfg["tracking"]["radius_nm"]
        return sorted({r, *(x for x in RADAR_RANGES if x > r)})

    def want_range(self, nm, square=False, reach=1.0):
        """A screen showing the radar at this range asked for data. A square display (the ATC
        style, whose range is from its centre to its edge) reaches √2 times as far in its corners;
        the Map view, a rectangle the shape of its panel, gives how much further its corners reach
        (no more than three times)."""
        if nm in self.ranges():
            far = max(math.sqrt(2) if square else 1, min(max(float(reach or 1), 1), 3))
            self.range_wanted[round(nm * far, 1)] = time.time()

    def fetch_radius(self):
        """How far out to ask the feed for: the longest range a screen asked for lately."""
        now = time.time()
        # a copy: the server's threads add to range_wanted while this runs on the poller's
        recent = [nm for nm, at in list(self.range_wanted.items()) if now - at < RANGE_HOLD_S]
        return max([self.cfg["tracking"]["radius_nm"], *recent])

    # -- flights a screen follows ---------------------------------------------------
    # A tap on a screen picks a flight for that screen alone: it asks for it with each update and
    # gets its card back, while every other screen goes on showing what's overhead. A flight any
    # screen is following is looked up like one overhead.
    def want_pin(self, hexid):
        """A screen following this aircraft asked for data."""
        if isinstance(hexid, str) and re.fullmatch(r"[~0-9a-z]{1,10}", hexid):
            self.pins[hexid] = time.time()

    def _pins_wanted(self, now):
        # a copy: the server's threads add to pins while this runs on the poller's
        return {h for h, at in list(self.pins.items()) if now - at < PIN_HOLD_S}

    def _coast(self, here, now):
        """The flights screens follow that the feed left out of this update. Aircraft drop out of
        the feed for a few seconds at a time, low ones most of all, and a screen lets go of a
        flight that isn't there. So for up to PIN_GRACE_S each is carried on from its last report,
        moved along its track, with "coasting" saying since when. here: the hex of every aircraft
        the feed did report."""
        out, last = [], self.status["updated"]
        for a in self.aircraft:
            if a["hex"] not in self.pinned_now or a["hex"] in here or a["on_ground"] or not last:
                continue
            since = a.get("coasting") or last
            if now - since > PIN_GRACE_S:
                continue
            b = dict(a, coasting=since)
            nm, track = (a.get("gs") or 0) * (now - last) / 3600, math.radians(a.get("track") or 0)
            b["lat"] = a["lat"] + nm * math.cos(track) / 60
            b["lon"] = a["lon"] + nm * math.sin(track) / (60 * math.cos(math.radians(a["lat"])))
            self._derive(b)
            if b["dist"] <= self.cfg["tracking"]["radius_nm"]:
                out.append(b)
        return out

    def _left_out(self, what, a, e):
        """One aircraft's record couldn't be used. The update goes ahead without it (or without
        its details): one odd record mustn't take the whole board down. Said once a minute at most."""
        if time.time() - self.complained > 60:
            self.complained = time.time()
            log.warning("%s of %s couldn't be worked out (%s: %s): going on without",
                        what, a.get("hex"), type(e).__name__, e)

    def update(self, raw, source, idle=False, contrails=None):
        """A new answer from the feed. idle: no screen is open, so no lookup is paid for.
        contrails: the place's forecast (contrails.fetch), from which each aircraft is marked as
        likely to be leaving one or not."""
        now = time.time()
        if self.updated_at is not None and 0 < now - self.updated_at < 120:
            gap = now - self.updated_at
            self.trail_s = gap if self.trail_s is None else self.trail_s * 0.8 + gap * 0.2
        self.updated_at = now
        self.pinned_now = self._pins_wanted(now)
        self.pins = {h: at for h, at in list(self.pins.items()) if h in self.pinned_now}   # forget the rest
        placed = []
        for a in raw:
            try:
                self._derive(a)
                placed.append(a)
            except Exception as e:
                self._left_out("the position", a, e)
        placed.sort(key=lambda a: a["dist"])
        r = self.cfg["tracking"]["radius_nm"]
        beyond = [a for a in placed if a["dist"] > r and not a["on_ground"]]
        raw = [a for a in placed if a["dist"] <= r]
        raw += self._coast({a["hex"] for a in placed}, now)
        raw.sort(key=lambda a: a["dist"])
        airborne = [a for a in raw if not a["on_ground"]]
        # look up the nearest aircraft, anything heading for the house soon, and any a screen follows
        soon = [a for a in airborne[10:] if self._soon(a)]
        emergency = self._emergencies(raw, now)
        followed = [a for a in raw if a["hex"] in self.pinned_now]
        done = set()
        for a in airborne[:10] + soon + emergency + followed:
            if a["hex"] not in done:
                done.add(a["hex"])
                try:    # a billed lookup only for those that matter: overhead, about to be, or followed
                    self.details.fill(a, wanted=self._overhead(a) or self._soon(a) or a["hex"] in self.pinned_now, idle=idle)
                except Exception as e:
                    self._left_out("the details", a, e)
        for a in airborne:
            a["contrail"] = contrail_mod.for_altitude(contrails, a["alt"])
            if a["hex"] not in done and "local" not in a:
                # not looked up: how it flies near the airport still says if it's landing or leaving
                try:
                    a["local"] = self.details.infer_local(a)
                except Exception as e:
                    self._left_out("the activity", a, e)
        by_hex = {a["hex"]: a for a in raw}
        with self.lock:
            self.hero_hex = self._pick_hero(by_hex)
            self.tracks.remember(airborne, now, beyond)
            self._update_flow(raw, now)
            self._describe(raw, beyond)       # before the logbook: its MEDICAL badge is worked out here
            for a in airborne:
                if self._overhead(a) and not a.get("coasting"):     # the logbook takes reported positions only
                    self.logbook.record(a, now)
            self.logbook.tidy(now)
            self.aircraft = raw
            self.beyond = beyond
            self.emergency = emergency
            self.status = {"source": source, "ok": True, "updated": now, "error": None}

    def _describe(self, raw, beyond):
        """What each aircraft is doing and the arrivals' landing order (situation.py), and the
        last two minutes of every one's track, for the radar to draw behind it."""
        try:
            situation.describe(raw, self.cfg["airport"], self.flow, self.said)
            iata = self.cfg["airport"].get("iata")
            for a in beyond:
                a["activity"] = situation.activity(a, iata)
        except Exception as e:
            self._left_out("the traffic picture", {"hex": "-"}, e)
        for a in raw + beyond:
            if not a["on_ground"]:
                a["tail"] = situation.tail(self.tracks.trails.get(a["hex"], ()), self.trail_s)

    def _emergencies(self, raw, now):
        """Aircraft squawking 7700, 7600 or 7500, confirmed over more than one update."""
        seen, out = {}, []
        for a in raw:
            code = emergency_code(a)
            if not code:
                continue
            n, since = self.emergency_seen.get(a["hex"], (0, now))
            seen[a["hex"]] = (n + 1, since)
            if n + 1 >= EMERGENCY_CONFIRM:
                _, title, meaning = EMERGENCIES[code]
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

    def heatmap(self):
        with self.lock:
            return self.tracks.heatmap()

    def snapshot(self, pin=None):
        """The board as it stands, for a screen (Place.state adds the place's weather and the rest).
        `pin` is the flight that screen follows: while it's within the tracking radius it takes the
        flight card, for that screen only. (A target past the radius, on a longer-range radar, has no
        card.) "pinned" says whether it held; "overhead" is the shared choice, so a screen following
        another flight still hears a new one come overhead."""
        with self.lock:
            if (self.aircraft or self.beyond) and time.time() - self.status["updated"] > STALE_SECONDS:
                self.aircraft, self.beyond, self.hero_hex = [], [], None   # don't show positions we can't trust
            overhead = next((a for a in self.aircraft if a["hex"] == self.hero_hex), None)
            chosen = next((a for a in self.aircraft if a["hex"] == pin), None) if pin else None
            hero = chosen or overhead
            if hero:      # the selected aircraft (this screen's choice, or overhead) carries its track: no other does
                path, trail = self.tracks.of(hero["hex"])
                hero = dict(hero, path=path, trail=trail)
            nxt = None
            if not hero:
                inbound = [a for a in self.aircraft if not a["on_ground"] and a["cpa_s"] > 0
                           and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]]
                nxt = min(inbound, key=lambda a: a["cpa_s"], default=None)
            today, seats_today = self.logbook.today()
            return {
                "now": time.time(), "home": self.home, "airport": self.cfg["airport"],
                "tracking": self.cfg["tracking"], "hero": hero, "pinned": chosen and chosen["hex"],
                "overhead": overhead and overhead["hex"],
                "next": nxt, "aircraft": self.aircraft, "flow": self.flow,
                "beyond": self.beyond, "ranges": self.ranges(), "kiosk": self.cfg["kiosk"], "status": self.status,
                "trail_s": round(self.trail_s or self.cfg["tracking"]["poll_seconds"], 2),
                "today": today, "seats_today": seats_today,
                "emergency": self.emergency if self.aircraft else [],
            }
