"""What is known of an aircraft beyond where it is: its airframe and photo, who flies it, its
seats, its route, and whether it is arriving at or leaving the place's airport.

Routes come from a database of callsigns that is often out of date, so each is checked against
where the aircraft actually is; a paid provider's route, when there is one, replaces it; and with
no believable route at all, the aircraft's own behaviour near the airport says what it is doing.
"""
import time

from ..core import geo
from ..reference import aircraft, airlines
from ..reference.seats import seats as seat_estimate


class Details:
    def __init__(self, cfg, enricher):
        self.cfg, self.enricher = cfg, enricher

    def fill(self, a, wanted=False, idle=False):
        """Add what is known of this aircraft to its record. wanted: it matters enough for a
        billed lookup (overhead, about to be, or followed by a screen). idle: no screen is open,
        so nothing is paid for whatever the aircraft."""
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
        a.update(aircraft.shape(a.get("type"), a.get("category")))      # for its drawing: shape, length, known
        airline = airlines.code(a.get("callsign"))
        # the name comes from the callsign, as the logo, colours and flight number do, so they agree;
        # the route database's (reliable even when its route isn't) for an airline the table doesn't name
        if airlines.name(airline):
            a["airline"] = airlines.name(airline)
        elif free and free.get("airline"):
            a["airline"] = free["airline"]
        a["airline_iata"] = airlines.iata_for(a.get("callsign"), (free or {}).get("airline_iata"))
        brand = airlines.flies_as(airline)
        if brand and airlines.name(brand):       # Horizon flies as Alaska: the airline you'd book, and who flies it
            a["airline"], a["operated_by"] = airlines.name(brand), airlines.name(airline)
        a["seats"] = seat_estimate(airline, a.get("type"))
        route = self._with_geometry(a, free)
        state, live = self._live_route(a, route, wanted and not idle)
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
            a["local"] = self.infer_local(a)
            a["local_inferred"] = bool(a["local"])
        if a["local"] == "arriving" and not (a.get("route") and a["route"].get("plausible")):
            # no believable route, but it's on approach here: estimate the landing from the runway distance
            ap = a.get("local_field") and next(f for f in self.cfg["airport"]["others"]
                                               if f["code"] == a["local_field"]["code"]) or self.cfg["airport"]
            a["landing_est"] = self._eta_estimate(a, geo.haversine_nm(a["lat"], a["lon"], ap["lat"], ap["lon"]), ap)
        r = a.get("route")
        a["flight_no"] = (r["flight"] if r and r.get("plausible") and r.get("source") else None) \
            or airlines.flight_number(a.get("callsign")) or (r["flight"] if r and r.get("plausible") else None)

    def _airline_from_route(self, a, route):
        """A regional partner flying for a bigger airline (SkyWest as Alaska): show the airline
        you'd book with, and say who operates it."""
        painted, operating = route.get("painted_as"), route.get("operating_as")
        if painted and operating and painted != operating:
            a["airline_iata"] = airlines.iata_for(painted + "1") or a.get("airline_iata")
            a["airline"] = airlines.name(painted) or a.get("airline")
            a["operated_by"] = airlines.name(operating) or operating

    def infer_local(self, a):
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
        if airlines.code(a.get("callsign")) or a.get("category") in ("A3", "A4", "A5"):
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

    def _live_route(self, a, free_route, fetch):
        """Route from the paid provider (Flightradar24 / FlightAware), which knows the
        flight actually in the air. Lookups are billed, so one is made only when the tracker
        says the aircraft matters (fetch): overhead, followed, or heading for the house within
        the next 10 minutes, early enough that the right route is ready when it arrives.
        Returns (state, route) as Enricher.live_route does."""
        fa = getattr(self.enricher, "live", None)
        if not fa or not fa.enabled:
            return "n/a", None
        needed = fa.mode == "always" or not (free_route and free_route["plausible"])
        state, live = self.enricher.live_route(a.get("callsign"), fetch=fetch and needed and not a["on_ground"])
        if live:
            live = self._with_geometry(a, dict(live, airline=(free_route or {}).get("airline")))
        return state, live
