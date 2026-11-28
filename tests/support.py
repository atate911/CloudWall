"""What the tests share: the guard that keeps them off the network, stand-ins and builders."""
import time

from cloudwall.core import config

PDX = (45.5887, -122.5975)


SFO = (37.619, -122.375)


AUS = (30.1975, -97.662)


# The tests stay on this machine. A lookup no test stubbed finds nothing, as a 404 would, and any
# other attempt to reach a service is stopped and fails the run.
_net = {}


def setUpModule():
    import urllib.request
    from cloudwall.gather import enrich
    _net.update(urlopen=urllib.request.urlopen, get_json=enrich.get_json, reached=[])

    def local_only(req, *a, **kw):
        url = getattr(req, "full_url", req)
        if urllib.request.urlparse(url).hostname not in ("127.0.0.1", "localhost", "::1"):
            _net["reached"].append(url)
            raise OSError("the tests don't use the network")
        return _net["urlopen"](req, *a, **kw)
    urllib.request.urlopen = local_only
    enrich.get_json = lambda url, timeout=12, headers=None: None


def tearDownModule():
    import urllib.request
    from cloudwall.gather import enrich
    urllib.request.urlopen, enrich.get_json = _net["urlopen"], _net["get_json"]
    if _net["reached"]:
        raise AssertionError(f"tests reached for the network: {sorted(set(_net['reached']))[:5]}")


RX, PUB = "http://receiver.local/data/aircraft.json", "https://public.example/{lat}/{lon}/{radius}"


class StubEnricher:
    live = None

    def __init__(self):
        self.routes = {}

    def aircraft(self, hexid):
        return None

    def photo(self, hexid, reg=None, icao_type=None):
        return None

    def route(self, callsign):
        return self.routes.get(callsign)


def plane(hexid, callsign, north_nm, alt=3000, typ="B738", home=None, **kw):
    home = home or config.DEFAULTS["home"]
    return dict({"hex": hexid, "callsign": callsign, "reg": None, "type": typ, "alt": alt,
                 "on_ground": False, "gs": 180, "track": 280, "vrate": -700,
                 "lat": home["lat"] + north_nm / 60, "lon": home["lon"], "squawk": "1234",
                 "category": "A3", "military": False}, **kw)


def iso(offset_s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_s))


def fa_flight(origin, dest, off=None, on=None, sched_off=0, **kw):
    apt = lambda c: {"code": "K" + c, "code_icao": "K" + c, "code_iata": c, "name": c + " Intl", "city": c}
    return dict({"ident": "SWA2327", "ident_iata": "WN2327", "origin": apt(origin), "destination": apt(dest),
                 "scheduled_off": iso(sched_off), "actual_off": off, "actual_on": on,
                 "estimated_in": iso(1200), "arrival_delay": 720, "status": "En Route / Delayed",
                 "progress_percent": 95, "route_distance": 540, "cancelled": False}, **kw)
