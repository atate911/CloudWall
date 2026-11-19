"""Which flyovers go in the logbook, and what is noted of each.

An aircraft that comes overhead gets one entry for the pass, however many updates it is
overhead for, with its closest point; lookups that arrive a few seconds later (its name, its
route, its photo) are filled in as they come. Its badges (a new type, a rare one, a repeat
visitor) are worked out as the entry starts, from what the logbook already holds. The rows
themselves, and the Logbook tab's totals, are store.py's.
"""
import json
import re
import time

AIRLINE = re.compile(r"^([A-Z]{3})\d")
RESIGHT_SECONDS = 30 * 60      # overhead again after this long is a new flyover

RARE_TYPES = {
    "A388", "B741", "B742", "B744", "B748", "BLCF", "A3ST", "A337", "A342", "A343", "A345",
    "A346", "MD11", "DC10", "DC3", "DC6", "B703", "B722", "B752", "B753", "IL76", "A124",
    "A225", "C17", "C5M", "C130", "C30J", "K35R", "KC10", "K46", "B52", "B1", "E3TF", "E6",
    "P8", "F15", "F16", "F18", "F35", "F22", "A10", "V22", "H60", "H47", "B17", "B29", "P51",
    "CONC", "U2", "T38", "SF50", "PC24", "GLF6", "GL7T", "B37M", "A35K", "B78X", "B779",
}


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Logbook:
    def __init__(self, store):
        self.store = store
        self.active = {}          # hex -> the flyover in progress: {"id", "min", "ts", "badges", ...}
        self.tidied = 0.0         # when finished flyovers were last cleared out of active

    def today(self):
        """Flyovers logged today, and the seats estimated to have been on them."""
        day = time.strftime("%Y-%m-%d")
        return self.store.count("day=?", (day,)), self.store.seat_total("day=?", (day,))["seats"]

    def tidy(self, now):
        """Forget flyovers that ended over half an hour ago (seen again, they'd be new entries
        anyway), so this doesn't grow with every aircraft that ever came overhead."""
        if now - self.tidied > 60:
            self.tidied = now
            self.active = {h: s for h, s in self.active.items() if now - s["ts"] <= RESIGHT_SECONDS}

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

    def record(self, a, now):
        """An aircraft is overhead: start its entry, or carry on with the one it has, filling in
        what has been learned since. Sets the aircraft's badges."""
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
