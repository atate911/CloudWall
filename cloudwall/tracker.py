"""Turns raw positions into the board state: geometry, hero selection, logbook, badges."""
import re
import threading
import time

from . import geo

RARE_TYPES = {
    "A388", "B741", "B742", "B744", "B748", "BLCF", "A3ST", "A337", "A342", "A343", "A345",
    "A346", "MD11", "DC10", "DC3", "DC6", "B703", "B722", "B752", "B753", "IL76", "A124",
    "A225", "C17", "C5M", "C130", "C30J", "K35R", "KC10", "K46", "B52", "B1", "E3TF", "E6",
    "P8", "F15", "F16", "F18", "F35", "F22", "A10", "V22", "H60", "H47", "B17", "B29", "P51",
    "CONC", "U2", "T38", "SF50", "PC24", "GLF6", "GL7T", "B37M", "A35K", "B78X", "B779",
}
EMERGENCY = {"7500": "HIJACK 7500", "7600": "RADIO FAIL 7600", "7700": "EMERGENCY 7700"}
AIRLINE = re.compile(r"^([A-Z]{3})\d")
RESIGHT_SECONDS = 30 * 60
STALE_SECONDS = 60


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Tracker:
    def __init__(self, cfg, store, enricher):
        self.cfg, self.store, self.enricher = cfg, store, enricher
        self.home = cfg["home"]
        self.lock = threading.Lock()
        self.aircraft = []
        self.hero_hex = None
        self.pinned = None
        self.active = {}          # hex -> {"id", "min", "ts", "badges"}
        self.flow = None
        self.weather = None
        self.status = {"source": None, "ok": False, "updated": 0, "error": None}

    # -- per-aircraft derivations -------------------------------------------
    def _derive(self, a):
        h = self.home
        a["dist"] = geo.haversine_nm(h["lat"], h["lon"], a["lat"], a["lon"])
        a["brg"] = geo.bearing_deg(h["lat"], h["lon"], a["lat"], a["lon"])
        a["compass"] = geo.compass(a["brg"])
        a["elev"] = (geo.elevation_deg(a["dist"], a["alt"], h.get("elevation_ft", 0))
                     if a["alt"] is not None else None)
        a["cpa_s"], a["cpa_nm"] = geo.cpa(h["lat"], h["lon"], a["lat"], a["lon"],
                                          a.get("track"), a.get("gs"))
        v = a.get("vrate") or 0
        a["phase"] = ("ground" if a["on_ground"] else
                      "climbing" if v > 300 else "descending" if v < -300 else "level")
        a["emergency"] = EMERGENCY.get(a.get("squawk"))

    def _enrich(self, a):
        info = self.enricher.aircraft(a["hex"])
        if info:
            a["type_name"] = info.get("type_name")
            a["owner"] = info.get("owner")
            a["photo"] = info.get("photo")
            a["reg"] = a.get("reg") or info.get("reg")
        route = self.enricher.route(a.get("callsign"))
        if route and route["origin"].get("lat") is not None and route["dest"].get("lat") is not None:
            o, d = route["origin"], route["dest"]
            flown = geo.haversine_nm(o["lat"], o["lon"], a["lat"], a["lon"])
            left = geo.haversine_nm(a["lat"], a["lon"], d["lat"], d["lon"])
            ap = self.cfg["airport"]
            iata = ap["iata"]
            plausible = geo.route_plausible(o["lat"], o["lon"], d["lat"], d["lon"], a["lat"], a["lon"])
            # Low and close to the local airport, yet the route doesn't touch it: the
            # callsign database is stale (airlines reuse flight numbers).
            if (iata not in (o["iata"], d["iata"]) and a["alt"] is not None and a["alt"] < 7000
                    and geo.haversine_nm(ap["lat"], ap["lon"], a["lat"], a["lon"]) < 20):
                plausible = False
            a["route"] = dict(route, flown_nm=flown, left_nm=left,
                              progress=flown / max(flown + left, 1), plausible=plausible)
            if a["route"]["plausible"]:
                a["local"] = ("arriving" if d["iata"] == iata else
                              "departing" if o["iata"] == iata else None)

    # -- selection ------------------------------------------------------------
    def _overhead(self, a):
        t = self.cfg["tracking"]
        return (not a["on_ground"] and a["alt"] is not None and a["dist"] <= t["overhead_nm"]
                and a["alt"] <= t["max_overhead_alt_ft"])

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
        if not s or now - s["ts"] > RESIGHT_SECONDS:
            badges = self._badges(a, airline_icao)
            sid = self.store.add_sighting(
                ts=now, day=time.strftime("%Y-%m-%d", time.localtime(now)), hex=a["hex"],
                callsign=a.get("callsign"), reg=a.get("reg"), type=a.get("type"),
                airline_icao=airline_icao, min_dist_nm=round(a["dist"], 2), alt_ft=a["alt"],
                gs=a.get("gs"), badges=badges)
            s = self.active[a["hex"]] = {"id": sid, "min": a["dist"], "badges": badges,
                                         "filled": False}
        s["ts"] = now
        upd = {}
        if a["dist"] < s["min"]:
            s["min"] = a["dist"]
            upd.update(min_dist_nm=round(a["dist"], 2), alt_ft=a["alt"], gs=a.get("gs"))
        r = a.get("route")
        if not s["filled"] and (r or a.get("type_name")):
            # lookups arrive a few seconds after first sight; back-fill the entry once
            upd.update(type_name=a.get("type_name"), reg=a.get("reg"))
            if r and r["plausible"]:
                upd.update(flight=r["flight"], airline=r["airline"], origin=r["origin"]["iata"],
                           dest=r["dest"]["iata"], origin_nm=round(r["flown_nm"]))
            s["filled"] = bool(r) and bool(a.get("type_name"))
        if upd:
            self.store.update_sighting(s["id"], **upd)
        a["badges"] = s["badges"]

    def _update_flow(self, aircraft):
        """Guess the airport's runway direction from low, descending traffic near it."""
        ap = self.cfg["airport"]
        for a in aircraft:
            if (a["on_ground"] or a["alt"] is None or a["alt"] > 4000 or a.get("track") is None
                    or (a.get("vrate") or 0) > -200 or (a.get("gs") or 0) < 110):
                continue
            if geo.haversine_nm(ap["lat"], ap["lon"], a["lat"], a["lon"]) > 12:
                continue
            if abs((a["track"] - 280 + 180) % 360 - 180) < 25:
                self.flow = {"dir": "west", "label": "West flow", "runways": "28L / 28R"}
            elif abs((a["track"] - 100 + 180) % 360 - 180) < 25:
                self.flow = {"dir": "east", "label": "East flow", "runways": "10L / 10R"}

    # -- main entry points ------------------------------------------------------
    def update(self, raw, source):
        now = time.time()
        for a in raw:
            self._derive(a)
        raw.sort(key=lambda a: a["dist"])
        airborne = [a for a in raw if not a["on_ground"]]
        for a in airborne[:10]:
            self._enrich(a)
        by_hex = {a["hex"]: a for a in raw}
        with self.lock:
            self.hero_hex = self._pick_hero(by_hex)
            for a in airborne:
                if self._overhead(a):
                    self._log(a, now)
            if self.cfg["airport"]["icao"] == "KPDX":
                self._update_flow(raw)
            self.aircraft = raw
            self.status = {"source": source, "ok": True, "updated": now, "error": None}

    def failed(self, source, error):
        with self.lock:
            self.status.update(source=source, ok=False, error=str(error))

    def pin(self, hexid):
        with self.lock:
            self.pinned = hexid
            if hexid:
                self.hero_hex = hexid

    def snapshot(self):
        with self.lock:
            if self.aircraft and time.time() - self.status["updated"] > STALE_SECONDS:
                self.aircraft, self.hero_hex = [], None   # don't show positions we can't trust
            hero = next((a for a in self.aircraft if a["hex"] == self.hero_hex), None)
            nxt = None
            if not hero:
                inbound = [a for a in self.aircraft if not a["on_ground"] and a["cpa_s"] > 0
                           and a["cpa_nm"] <= self.cfg["tracking"]["overhead_nm"]]
                nxt = min(inbound, key=lambda a: a["cpa_s"], default=None)
            return {
                "now": time.time(), "home": self.home, "airport": self.cfg["airport"],
                "tracking": self.cfg["tracking"], "hero": hero, "pinned": self.pinned,
                "next": nxt, "aircraft": self.aircraft, "flow": self.flow,
                "weather": self.weather, "status": self.status,
                "today": self.store.count("day=?", (time.strftime("%Y-%m-%d"),)),
            }
