"""Turns the feed's positions into the board: where each aircraft is from here, which is
overhead, which a screen follows, the airport's flow, emergencies. It calls on details.py,
logbook.py and tracks.py as each update goes by.
"""
import logging
import math
import re
import threading
import time

from ..core import geo
from ..gather import contrails as contrail_mod
from . import situation
from ..reference import aircraft, airlines, placing
from .details import Details
from ..memory.logbook import Logbook
from ..memory.tracks import Tracks

log = logging.getLogger("cloudwall.tracker")

# squawk -> (badge, headline, meaning); some transponders send the matching status instead
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
RADAR_RANGES = (20, 30)     # longer radar ranges a screen can set, nm
RANGE_HOLD_S = 90           # keep fetching a longer range this long after a screen last asked for it
PIN_HOLD_S = 15             # a followed flight counts as wanted this long after its screen last asked
PIN_GRACE_S = 30            # and is coasted from its last report this long when the feed leaves it out
FLOW_KEEP_S = 60 * 60       # the runways in use are forgotten when nothing has landed for this long


def emergency_code(a):
    """The trouble code an aircraft shows, by squawk or transponder status; or None."""
    return a.get("squawk") if a.get("squawk") in EMERGENCIES else EMERGENCY_STATUS.get(a.get("emergency_status"))


MAX_PINS = 40             # flights followed at once, across every screen


class Tracker:
    def __init__(self, cfg, store, enricher):
        if "runways" not in cfg["airport"]:      # not yet filled in by placing.places (tests, scripts)
            cfg = placing.complete_place(cfg)
        self.cfg, self.store, self.enricher = cfg, store, enricher
        self.home = cfg["home"]
        self.details = Details(cfg, enricher)
        self.logbook = Logbook(store)
        self.tracks = Tracks(cfg["tracking"]["radius_nm"], store)
        self.lock = threading.Lock()
        self.aircraft = []
        self.beyond = []          # aircraft past the tracking radius, for a radar set to a longer range
        self.range_wanted = {}    # range (nm) -> when a screen last asked for it
        self.updated_at = None
        self.trail_s = None       # seconds between trail samples, smoothed
        self.hero_hex = None      # the aircraft overhead, shared by every screen
        self.said = {}            # medical.py's hospital claims
        self.pins = {}            # hex -> when a screen last asked to follow it
        self.pinned_now = set()   # the flights screens follow, as of the last update
        self.flow = None
        self.flow_at = 0.0        # when an arrival last showed which way the airport is landing
        self.complained = 0.0     # when an unusable record was last logged
        self.storage_said = 0.0   # when a storage failure was last logged
        self.storage_error = None # why storage is failing, for the screens and the health check
        self.today = (0, 0)       # (flyovers, seats) logged today, as last read
        # for the health watcher: hours of traffic and none near the house means [home] is wrong
        self.vitals = {"since": time.time(), "updates": 0, "aircraft": 0, "closest_nm": None}
        self._stored("the logbook", lambda: setattr(self, "today", self.logbook.today()))
        self.status = {"source": None, "ok": False, "updated": 0, "error": None, "storage": None}
        self.emergency_seen = {}  # hex -> (consecutive updates squawking, first seen)
        self.emergency = []

    # -- per-aircraft derivations
    def _on_ground(self, a):
        """Many transponders never report "on ground": slow and at about ground level counts
        (helicopters, which fly slowly on purpose, must be slower and lower)."""
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
        icon = aircraft.icon(a.get("type"), a.get("desc"), a.get("category"))
        if icon:
            a["icon"] = icon
        colors = airlines.colors(a.get("callsign"))
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
            a["spc"] = code                              # for the ATC style's data block

    # -- selection
    def _soon(self, a):
        """Heading for the house, and due within LOOKAHEAD_S."""
        return 0 < a["cpa_s"] <= LOOKAHEAD_S and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]

    def _overhead(self, a):
        t = self.cfg["tracking"]
        # also clearly above the horizon from the house
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
        """Guess the runways in use from low, descending traffic near the airport whose track
        matches a landing direction; the guess lapses after FLOW_KEEP_S with no landing."""
        now = now or time.time()
        if self.flow and now - self.flow_at > FLOW_KEEP_S:
            self.flow = None
        ap = self.cfg["airport"]
        ways = []          # (runway name for landing that way, landing direction in degrees true)
        for w in ap.get("runways") or []:
            (lat1, lon1), (lat2, lon2) = w["ends"]
            first, second = w["name"].split("/")
            h = geo.bearing_deg(lat1, lon1, lat2, lon2)       # landing on the first-named end
            ways += [(first, h), (second, (h + 180) % 360)]
        if not ways:
            return
        off = lambda a, b: abs((a - b + 180) % 360 - 180)
        field = ap.get("elevation_ft") or 0        # heights here are above the airport
        for a in aircraft:
            if (a["on_ground"] or a["alt"] is None or a["alt"] - field > 4000 or a.get("track") is None
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

    # -- radar range: a screen can ask for a longer range than the tracking radius; aircraft past
    # the radius are for the radar alone (no board, card, logbook or lookups)
    def ranges(self):
        r = self.cfg["tracking"]["radius_nm"]
        return sorted({r, *(x for x in RADAR_RANGES if x > r)})

    def want_range(self, nm, square=False, reach=1.0):
        """A screen showing the radar at this range asked for data. square: its corners reach √2
        times as far; reach: how much further the Map view's corners go (capped at 3)."""
        if nm in self.ranges():
            far = max(math.sqrt(2) if square else 1, min(max(float(reach or 1), 1), 3))
            self.range_wanted[round(nm * far, 1)] = time.time()

    def fetch_radius(self):
        """The longest range a screen asked for lately."""
        now = time.time()
        # a copy: the server's threads add to range_wanted while this runs on the poller's
        recent = [nm for nm, at in list(self.range_wanted.items()) if now - at < RANGE_HOLD_S]
        return max([self.cfg["tracking"]["radius_nm"], *recent])

    # -- flights a screen follows: each screen asks for its own with every update; a followed
    # flight is looked up like one overhead
    def want_pin(self, hexid):
        if isinstance(hexid, str) and re.fullmatch(r"[~0-9a-z]{1,10}", hexid):
            if hexid not in self.pins and len(self.pins) >= MAX_PINS:
                return          # someone is asking for every aircraft
            self.pins[hexid] = time.time()

    def _pins_wanted(self, now):
        # a copy: the server's threads add to pins while this runs on the poller's
        return {h for h, at in list(self.pins.items()) if now - at < PIN_HOLD_S}

    def _coast(self, here, now):
        """Followed flights the feed left out of this update, carried along their track from the
        last report for up to PIN_GRACE_S, with "coasting" = since when. here: every hex the feed
        did report."""
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
        """One aircraft's record couldn't be used: logged once a minute at most, and the update goes on."""
        if time.time() - self.complained > 60:
            self.complained = time.time()
            log.warning("%s of %s couldn't be worked out (%s: %s): going on without",
                        what, a.get("hex"), type(e).__name__, e)

    def _stored(self, what, write):
        """Run a storage call without letting a failure stop the board (logged every ten minutes
        at most). True if it worked."""
        try:
            write()
            return True
        except Exception as e:
            self.storage_error = f"{what} couldn't be saved ({type(e).__name__}: {e})"
            if time.time() - self.storage_said > 600:
                self.storage_said = time.time()
                log.error("%s: the board carries on without it", self.storage_error)
            return False

    def update(self, raw, source, idle=False, contrails=None):
        """A new answer from the feed. idle: no screen is open, so no lookup is paid for.
        contrails: the place's forecast (contrails.fetch)."""
        now = time.time()
        if self.updated_at is not None and 0 < now - self.updated_at < 120:
            gap = now - self.updated_at
            self.trail_s = gap if self.trail_s is None else self.trail_s * 0.8 + gap * 0.2
        self.updated_at = now
        self.pinned_now = self._pins_wanted(now)
        self.pins = {h: at for h, at in list(self.pins.items()) if h in self.pinned_now}
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
        # details for the nearest ten, anything heading for the house soon, emergencies and followed flights
        soon = [a for a in airborne[10:] if self._soon(a)]
        emergency = self._emergencies(raw, now)
        followed = [a for a in raw if a["hex"] in self.pinned_now]
        done = set()
        for a in airborne[:10] + soon + emergency + followed:
            if a["hex"] not in done:
                done.add(a["hex"])
                try:    # billed only for those overhead, about to be, or followed
                    self.details.fill(a, wanted=self._overhead(a) or self._soon(a) or a["hex"] in self.pinned_now, idle=idle)
                except Exception as e:
                    self._left_out("the details", a, e)
        for a in airborne:
            a["contrail"] = contrail_mod.for_altitude(contrails, a["alt"])
            if a["hex"] not in done and "local" not in a:
                try:
                    a["local"] = self.details.infer_local(a)
                except Exception as e:
                    self._left_out("the activity", a, e)
        by_hex = {a["hex"]: a for a in raw}
        v = self.vitals
        v["updates"] += 1
        v["aircraft"] += len(airborne)
        if airborne:
            near = airborne[0]["dist"]
            v["closest_nm"] = near if v["closest_nm"] is None else min(v["closest_nm"], near)
        with self.lock:
            self.storage_error = None
            self.hero_hex = self._pick_hero(by_hex)
            self._stored("the heatmap", lambda: self.tracks.remember(airborne, now, beyond))
            self._update_flow(raw, now)
            self._describe(raw, beyond)       # before the logbook: its MEDICAL badge is worked out here

            def log_overhead():
                for a in airborne:
                    if self._overhead(a) and not a.get("coasting"):     # the logbook takes reported positions only
                        self.logbook.record(a, now)
                self.logbook.tidy(now)
                self.today = self.logbook.today()
            self._stored("the logbook", log_overhead)
            self.aircraft = raw
            self.beyond = beyond
            self.emergency = emergency
            self.status = {"source": source, "ok": True, "updated": now, "error": None, "storage": self.storage_error}

    def _describe(self, raw, beyond):
        """situation.describe, plus every aircraft's short "tail" of track for the radar."""
        try:
            situation.describe(raw, self.cfg["airport"], self.flow, self.said)
            iata = self.cfg["airport"].get("iata")
            for a in beyond:
                a["activity"] = situation.activity(a, iata, self.cfg["airport"].get("elevation_ft") or 0)
        except Exception as e:
            self._left_out("the traffic picture", {"hex": "-"}, e)
        for a in raw + beyond:
            if not a["on_ground"]:
                a["tail"] = situation.tail(self.tracks.trails.get(a["hex"], ()), self.trail_s)

    def _emergencies(self, raw, now):
        """Aircraft showing a trouble code for EMERGENCY_CONFIRM updates running, nearest first."""
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
        """The board for a screen. `pin`: the flight that screen follows, which takes the flight
        card while within the tracking radius. "pinned" says whether it held; "overhead" is the
        shared choice, so a screen following another flight still hears a new one come overhead."""
        with self.lock:
            if (self.aircraft or self.beyond) and time.time() - self.status["updated"] > STALE_SECONDS:
                self.aircraft, self.beyond, self.hero_hex = [], [], None   # don't show positions we can't trust
            overhead = next((a for a in self.aircraft if a["hex"] == self.hero_hex), None)
            chosen = next((a for a in self.aircraft if a["hex"] == pin), None) if pin else None
            hero = chosen or overhead
            if hero:      # only the selected aircraft carries its full track
                path, trail = self.tracks.of(hero["hex"])
                hero = dict(hero, path=path, trail=trail)
            nxt = None
            if not hero:
                inbound = [a for a in self.aircraft if not a["on_ground"] and a["cpa_s"] > 0
                           and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]]
                nxt = min(inbound, key=lambda a: a["cpa_s"], default=None)
            today, seats_today = self.today
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
