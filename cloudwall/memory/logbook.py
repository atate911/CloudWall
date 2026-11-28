"""Which flyovers go in the logbook: one entry per pass, holding its closest point, back-filled
as lookups arrive; badges are worked out as the entry starts. The rows and totals are store.py's.
"""
import json
import time

from ..reference import aircraft, airlines

RESIGHT_SECONDS = 30 * 60      # overhead again after this long is a new flyover


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def closest(a):
    """The entry's columns for an aircraft's closest point."""
    return {"min_dist_nm": round(a["dist"], 2), "alt_ft": a["alt"], "gs": a.get("gs"), "lat": round(a["lat"], 5),
            "lon": round(a["lon"], 5), "track": a.get("track"), "vrate": a.get("vrate")}


class Logbook:
    def __init__(self, store):
        self.store = store
        self.active = {}          # hex -> the flyover in progress: {"id", "min", "ts", "badges", ...}
        self.tidied = 0.0

    def today(self):
        """(flyovers logged today, estimated seats on them)."""
        day = time.strftime("%Y-%m-%d")
        return self.store.count("day=?", (day,)), self.store.seat_total("day=?", (day,))["seats"]

    def tidy(self, now):
        """Forget flyovers that ended over RESIGHT_SECONDS ago."""
        if now - self.tidied > 60:
            self.tidied = now
            self.active = {h: s for h, s in self.active.items() if now - s["ts"] <= RESIGHT_SECONDS}

    def _badges(self, a, airline_icao):
        b = []
        if a.get("emergency"):
            b.append(a["emergency"])
        if a.get("military"):
            b.append("MILITARY")
        if a.get("medical"):
            b.append("MEDICAL")
        if aircraft.rare(a.get("type")):
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
        """An aircraft is overhead: start or carry on its entry. Sets a["badges"]."""
        airline_icao = airlines.code(a.get("callsign"))
        s = self.active.get(a["hex"])
        if not s:
            s = self._resume(a["hex"], now)
        if not s or now - s["ts"] > RESIGHT_SECONDS:
            badges = self._badges(a, airline_icao)
            sid = self.store.add_sighting(
                ts=now, day=time.strftime("%Y-%m-%d", time.localtime(now)), hex=a["hex"],
                callsign=a.get("callsign"), reg=a.get("reg"), type=a.get("type"),
                airline_icao=airline_icao, badges=badges, seats=(a.get("seats") or {}).get("n"), **closest(a))
            s = self.active[a["hex"]] = {"id": sid, "min": a["dist"], "badges": badges,
                                         "seats": (a.get("seats") or {}).get("n")}
        s["ts"] = now
        upd = {}
        if a["dist"] < s["min"]:
            s["min"] = a["dist"]
            upd.update(closest(a))
        # lookups arrive after first sight, and the paid provider may later correct the free route
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
        # a helicopter is known to be medical only once seen landing at a hospital: maybe after its entry started
        if a.get("medical") and "MEDICAL" not in s["badges"]:
            first = sum(1 for b in s["badges"] if b == "MILITARY" or b == a.get("emergency"))
            s["badges"] = s["badges"][:first] + ["MEDICAL"] + s["badges"][first:]
            upd.update(badges=s["badges"])
        if upd:
            self.store.update_sighting(s["id"], **upd)
        a["badges"] = s["badges"]

    def _resume(self, hexid, now):
        """After a restart, carry on with a flyover logged in the last half hour, not count it twice."""
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
