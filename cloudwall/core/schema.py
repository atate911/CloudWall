"""Every setting, described once for people: what it is called, what it does, its unit, an example,
and what changing it costs (a restart, paid lookups, a new link on every screen). The control
board draws its forms and its help from here; config.py keeps the defaults and the checks (the
kinds of value, the words and ranges allowed), and this file adds the words.

The control board groups sections into its pages by `page` (a few settings live on another page
than their section's: web/js/admin/finder.js lists them). `advanced` settings are behind the
"more" of their section: they are for when something needs adjusting, not for setting up. `secret`
settings are written from the board but never shown back.

A test fails if a setting in config.DEFAULTS has no entry here, so a new setting can't arrive
without its explanation.
"""
from dataclasses import asdict, dataclass

from . import config


@dataclass(frozen=True)
class Setting:
    key: str
    label: str
    help: str
    unit: str = ""
    example: str = ""
    secret: bool = False
    advanced: bool = False
    costs: str = ""         # what changing it brings with it, beyond a restart


@dataclass(frozen=True)
class Section:
    name: str
    label: str
    page: str
    about: str
    settings: tuple


def _s(name, label, page, about, *settings):
    return Section(name, label, page, about, tuple(settings))


S = Setting
SECTIONS = (
    _s("home", "House", "places", "Where the sky is watched from: the board centres on it, and an aircraft over it is logged.",
       S("name", "Name", "What the house is called on the screens and in the menu of places.", example="Home"),
       S("lat", "Latitude", "North of the equator in decimal degrees (negative south). Your house's, to four places is enough.", "°", "45.5900"),
       S("lon", "Longitude", "East of Greenwich in decimal degrees (negative west: the Americas).", "°", "-122.4740"),
       S("zip", "ZIP code", "Instead of latitude and longitude: the centre of a US ZIP code's area. Used only when lat and lon are left out.", example="98683"),
       S("elevation_ft", "Ground elevation", "The ground's height above sea level, for how high aircraft are above the house. Left out: the airport's.", "ft", "100", advanced=True)),
    _s("airport", "Airport", "places", "Arriving and departing labels, the runways in use, landing order and the weather come from it.",
       S("icao", "Airport", "Its ICAO code, or auto for the nearest large airport within 30 nm (else the nearest with airline service).", example="KPDX")),
    _s("tracking", "Tracking", "places", "How far out the board looks, what counts as overhead, and how often the feed is asked.",
       S("radius_nm", "Tracking radius", "How far out the board, the flight card and the logbook look. The radar can be set to look further.", "nm", "15"),
       S("overhead_nm", "Overhead within", "An aircraft closer than this takes over the screen and is logged as a flyover.", "nm", "3.5"),
       S("max_overhead_alt_ft", "Overhead below", "Higher than this, an aircraft passing over isn't counted as overhead.", "ft", "45000", advanced=True),
       S("poll_seconds", "Ask the feed every", "How often positions are fetched. The free feeds ask for no less than about 3 seconds.", "s", "5", advanced=True),
       S("when_idle", "With no screen open", "pause: ask nothing (the logbook misses flyovers meanwhile); log: keep asking the free feed every 15 s so the logbook stays complete. No paid lookups or weather either way."),
       S("idle_after_seconds", "No screen open after", "How long without a screen asking before CloudWall counts as unwatched.", "s", "90", advanced=True)),
    _s("source", "Position feeds", "positions", "Where positions come from: readsb-style JSON, tried in order, failing over to the next.",
       S("urls", "Feeds", "Addresses with {lat}, {lon} and {radius} filled in, in the order to try. Your own receiver first, with merge on, to combine it with the public feeds.",
         example="http://127.0.0.1:18080/data/aircraft.json"),
       S("merge", "Combine your receiver with the public feeds", "On: the first feed is your receiver, asked every update alongside the public ones, the two combined (your receiver's fresher position where both see an aircraft).")),
    _s("flightradar24", "Flightradar24", "routes", "Accurate live routes for airliners near the house, paid per lookup from a monthly allowance.",
       S("api_key", "API key", "Your Flightradar24 API token. Also taken from CLOUDWALL_FR24_KEY.", secret=True, costs="paid lookups start"),
       S("monthly_credits", "Credits a month", "What your plan includes each month (Explorer: 30000).", "credits", "30000"),
       S("safety_margin", "Held back", "The share of the allowance never used, so the month can't run out.", "share", "0.15", advanced=True),
       S("billing_day", "Plan renews on day", "The day of the month your plan renews (1 to 28).", example="1", advanced=True),
       S("daily_limit", "Daily cap", "An extra cap per day; 0 for none (without a monthly figure, 300).", "credits", "0", advanced=True),
       S("mode", "When to look up", "always: every airliner heading for the house (recommended); fallback: only when the free route looks wrong.", costs="always spends more"),
       S("general_aviation", "Private aircraft too", "Also look up private aircraft; most have no route.", costs="spends more", advanced=True),
       S("sandbox", "Sandbox", "On with a sandbox token: free, but every route is the same sample data. Never leave on with a real key.", advanced=True)),
    _s("flightaware", "FlightAware", "routes", "The other paid route provider (AeroAPI), billed per lookup. If both have keys, Flightradar24 is used.",
       S("api_key", "API key", "Your AeroAPI key. Also taken from CLOUDWALL_FLIGHTAWARE_KEY.", secret=True, costs="paid lookups start"),
       S("monthly_limit", "Lookups a month", "What your plan allows each month; without one, 30 lookups a day.", "lookups", "0"),
       S("safety_margin", "Held back", "The share of the allowance never used.", "share", "0.15", advanced=True),
       S("billing_day", "Plan renews on day", "The day of the month your plan renews (1 to 28).", example="1", advanced=True),
       S("daily_limit", "Daily cap", "An extra cap per day; 0 for none.", "lookups", "0", advanced=True),
       S("mode", "When to look up", "always or fallback, as for Flightradar24."),
       S("general_aviation", "Private aircraft too", "Also look up private aircraft.", advanced=True)),
    _s("map", "Maps", "look", "The maps under the radar and behind the flight card's route, downloaded once and cached.",
       S("style", "Radar map", "The chart-style radar's map: dark or light grey streets, satellite, osm, an FAA chart (sectional, terminal, ifr-low, ifr-high), or off."),
       S("opacity", "Map strength", "How strongly the map shows under the radar, 0 to 1.", example="0.45"),
       S("route", "Route map", "The map behind the flight card's route: satellite, light, dark, osm, or off for the plain arc."),
       S("atc", "ATC radar's chart", "A chart under the ATC-style radar (off: a controller's screen has only its video map)."),
       S("cache_mb", "Tile cache limit", "The most disk the downloaded tiles may take, all maps together; the oldest go once a day to stay under it.", "MB", "2000", advanced=True),
       S("url", "Other tile service", "Any raster tile service's URL template ({z} {x} {y}); its key stays on the server.", secret=True, advanced=True),
       S("attribution", "Its credit", "The credit that tile service asks for.", advanced=True)),
    _s("logos", "Airline logos", "look", "Logos on the flight card, downloaded once per airline.",
       S("enabled", "Show logos", "Fetch and show airline logos."),
       S("url", "Logo source", "Where logos come from ({iata} is the airline's code).", advanced=True)),
    _s("extras", "Radar layers", "look", "Fetched only while a screen is open.",
       S("military", "Military heard", "Military jets nearby that send their altitude but no position."),
       S("military_radius_nm", "Military within", "How far out to list them.", "nm", "40", advanced=True),
       S("military_url", "Military feed", "Where they come from.", advanced=True),
       S("tfr", "Flight restrictions", "Temporary flight restrictions from the FAA, on the radar and the Weather tab."),
       S("tfr_radius_nm", "Restrictions within", "How far out to show them.", "nm", "30", advanced=True),
       S("contrails", "Contrail forecast", "Whether aircraft overhead leave contrails, from upper-air temperature and humidity.")),
    _s("kiosk", "Wall panel", "look", "The wall panel (/kiosk) has no buttons, so how it looks is set here.",
       S("place", "Place", "Which place it shows: a place's name; empty for the house."),
       S("view", "Beside the card", "card: the aircraft overhead across the whole screen; radar, map or sky beside it."),
       S("radar", "Radar style", "chart, or atc to draw it like an air traffic control screen."),
       S("tracks", "Tracks", "The selected aircraft's track, and lines to where aircraft will be in a minute."),
       S("range_nm", "Radar range", "0 for the tracking radius, or 20 or 30 to see further.", "nm", "0"),
       S("density", "Labels", "simple names the aircraft that matter; detailed every one."),
       S("quiet", "Quiet hours", "Hours when it shows only a dim clock and what's next, waking for something coming over, an emergency or a tap.", example="23:00-06:30")),
    _s("receiver", "Receiver", "receiver", "Your own ADS-B receiver, its live map and Coverage3D, as the board shows them.",
       S("url", "Its web server", "Where your receiver's web server (tar1090) answers from this machine. Empty: worked out from "
         "the first feed when combining is on (the tunnel's http://127.0.0.1:18080).", example="http://127.0.0.1:18080"),
       S("coverage_url", "Coverage3D", "Where Coverage3D answers from this machine. Empty: beside the receiver's (through the "
         "tunnel, http://127.0.0.1:18090).", example="http://127.0.0.1:18090", advanced=True),
       S("home_url", "Its address at home", "The receiver's address on your home network (adsb.im's setup page and its own "
         "maps). The board links to these, for use at home; it never opens them to the internet.", example="http://192.168.3.3")),
    _s("server", "Network", "access", "Who can reach CloudWall, and how.",
       S("host", "Listen on", "0.0.0.0 for every address (a home network); 127.0.0.1 for this machine only (behind Caddy or a tunnel).", costs="screens may lose it", advanced=True),
       S("port", "Port", "The port screens connect to.", example="5050", costs="every bookmark changes", advanced=True),
       S("key", "Private link", "With a key, CloudWall answers only at <address>/k/<key>/: a password in the address. Make one from Access.", secret=True,
         costs="every screen needs the new link"),
       S("address", "Name on the internet", "The name Caddy serves it at, for the links it prints.", example="cloudwall.example.com", advanced=True)),
    _s("storage", "Storage", "safekeeping", "Where logbooks and caches live. Left empty, the install's own folders.",
       S("db_path", "Logbook file", "The house's logbook; each other place's is beside it.", advanced=True),
       S("cache_dir", "Cache folder", "Where map tiles and logos are kept.", advanced=True)),
    _s("health", "Alerts", "health", "CloudWall checks itself every 30 s; a problem that stops it working can also be sent to you.",
       S("notify_url", "Alert address", "A web address told (a JSON POST) when a major problem starts and ends, such as an ntfy.sh topic.",
         example="https://ntfy.sh/your-topic", secret=True)),
)

# the control board's pages, as its rail names them (web/js/admin/main.js draws them)
PAGES = (("home", "Overview"), ("receiver", "Receiver"), ("positions", "Feeds"), ("places", "Location"), ("routes", "Routes"),
         ("look", "Display"), ("access", "Access"), ("safekeeping", "Backups"), ("health", "Health"), ("settings", "All settings"),
         ("server", "System"))


def describe(cfg):
    """The schema with this config's values, for the control board: secrets as {"set": bool} only."""
    out = []
    for sec in SECTIONS:
        items = []
        for st in sec.settings:
            default = config.DEFAULTS.get(sec.name, {}).get(st.key)
            value = cfg.get(sec.name, {}).get(st.key, default)
            choices = config.CHOICES.get((sec.name, st.key))
            span = config.BETWEEN.get((sec.name, st.key))
            kind = "secret" if st.secret else "choice" if choices else config.kind_of(sec.name, st.key)
            items.append(dict(asdict(st), kind=kind, choices=list(choices) if choices else None,
                              range=list(span) if span else None,
                              value={"set": bool(value)} if st.secret else value,
                              default=None if st.secret else default,
                              changed=(value != default) if not st.secret else bool(value)))
        out.append({"name": sec.name, "label": sec.label, "page": sec.page, "about": sec.about, "settings": items})
    return out


def find(section, key):
    for sec in SECTIONS:
        if sec.name == section:
            for st in sec.settings:
                if st.key == key:
                    return st
    return None
