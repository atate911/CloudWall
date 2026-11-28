"""Configuration: defaults overlaid with an optional TOML file."""
import copy
import logging
import math
import os
import re
import shutil
import tomllib
from pathlib import Path

from . import keys, paths

log = logging.getLogger("cloudwall")

EXAMPLE = paths.EXAMPLE

DEFAULTS = {
    "home": {
        # placeholder (east Vancouver, WA); or zip = a US ZIP code. elevation_ft None: the airport's
        "name": "Home",
        "lat": 45.5900,
        "lon": -122.4740,
        "elevation_ft": None,
    },
    # "auto": the nearest large airport within 30 nm, else the nearest with airline service
    "airport": {"icao": "auto"},
    "tracking": {
        "radius_nm": 15,        # board, flight card and logbook (the radar can look further)
        "overhead_nm": 3.5,     # inside this, an aircraft counts as "overhead" and is logged
        "max_overhead_alt_ft": 45000,
        "poll_seconds": 5,
        "when_idle": "pause",          # no screen open: "pause" all requests, or "log" slowly
        "idle_after_seconds": 90,
    },
    # feeds tried in order, failing over; merge: the first is your own receiver, combined with the others
    "source": {"urls": ["https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}",
                        "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"],
               "merge": False},
    # monthly_credits (FR24) and monthly_limit (FlightAware): either name is taken for either provider
    "flightradar24": {"api_key": "", "monthly_credits": 0, "safety_margin": 0.15, "billing_day": 1,
                      "daily_limit": 0, "mode": "always",
                      "general_aviation": False, "sandbox": False},
    "flightaware": {"api_key": "", "monthly_limit": 0, "safety_margin": 0.15, "billing_day": 1,
                    "daily_limit": 0, "mode": "always",
                    "general_aviation": False},
    # Map behind the radar: "dark", "light", "satellite", "osm" or "off" (or set url = a tile URL template)
    # route: the map behind the flight's route on its card, one of the same styles (not a url), or "off"
    # cache_mb: the most disk the downloaded map and chart tiles may take, all layers together
    "map": {"style": "dark", "opacity": 0.45, "url": "", "attribution": "", "route": "satellite", "atc": "off", "cache_mb": 2000},
    # Airline logos on the flight card, fetched by airline code and cached on disk
    "logos": {"enabled": True, "url": ""},
    # Extra free data: military jets heard without a position, temporary flight
    # restrictions (FAA), and the contrail forecast (Open-Meteo upper-air data).
    "extras": {"military": True, "military_radius_nm": 40, "military_url": "https://opendata.adsb.fi/api/v2/mil",
               "tfr": True, "tfr_radius_nm": 30, "contrails": True},
    # The kiosk has no buttons: its place and radar are set here. place: a place's name (empty for
    # the first); view: "card" (the aircraft overhead across the whole screen), or "radar", "map" or "sky"
    # to put the radar, or the flights on an everyday map, beside it; radar: "chart" or
    # "atc" (drawn like an air traffic control screen); tracks: the
    # selected aircraft's track and one-minute lines; range_nm: 0 for the tracking radius, or 20 or 30 to see further;
    # density: the radar's labels, "simple" (the aircraft that matter) or "detailed" (every one);
    # quiet: hours when the panel shows only a dim clock and what's next ("23:00-06:30"; "" for none),
    # waking for something coming over the house, something new worth a look, an emergency or a tap.
    "kiosk": {"place": "", "view": "card", "radar": "chart", "tracks": True, "range_nm": 0, "density": "simple", "quiet": ""},
    # key: with one set, CloudWall answers only under /k/<key>/ (access.py, keys.py): a private link for
    # reaching it from outside the house. Empty: open to whoever can reach it, as on a home network.
    # address: the name CloudWall has on the internet (behind Caddy), for the links it prints
    "server": {"host": "0.0.0.0", "port": 5050, "key": "", "address": ""},
    # db_path empty: <data dir>/cloudwall.db (config.data_dir); cache_dir empty: beside it
    "storage": {"db_path": "", "cache_dir": ""},
    # notify_url: a webhook told when a major problem starts and ends (e.g. an ntfy.sh topic's URL)
    "health": {"notify_url": ""},
    # Your own receiver, as the control board shows it. url: where its web server answers from here
    # (empty: worked out from [source] urls when merge is on); coverage_url: Coverage3D's (empty: the
    # port after the receiver's: the tunnel's 18090 beside its 18080); home_url: its address on the
    # home network, for adsb.im's own pages, which the board links to but never opens to the internet.
    "receiver": {"url": "", "coverage_url": "", "home_url": ""},
}


# Settings that have no default, and what each may be. ([airport] takes an airport's own details,
# as many as are needed, so it isn't checked name by name.)
NUMBER = (int, float)
OPTIONAL = {
    "home": {"zip": (str, int), "elevation_ft": NUMBER},
    "source": {"url": str},
    "flightradar24": {"monthly_limit": NUMBER},
    "flightaware": {"monthly_credits": NUMBER},
    "map": {"atc": str},
}
# Settings that take one of a few words. (A word CloudWall doesn't know would otherwise quietly
# act as one of the others, as an unknown provider mode acted as "fallback".)
CHOICES = {
    ("kiosk", "view"): ("card", "radar", "map", "sky"),
    ("kiosk", "radar"): ("chart", "atc"),
    ("kiosk", "density"): ("simple", "detailed"),
    ("tracking", "when_idle"): ("pause", "log"),
    ("flightradar24", "mode"): ("always", "fallback"),
    ("flightaware", "mode"): ("always", "fallback"),
    ("map", "style"): ("dark", "light", "satellite", "streets", "osm", "sectional", "terminal", "ifr-low", "ifr-high",
                       "custom", "off"),
    ("map", "route"): ("satellite", "dark", "light", "streets", "osm", "off"),
    ("map", "atc"): ("off", "ifr-low", "ifr-high", "sectional", "terminal"),
}
BETWEEN = {("map", "opacity"): (0, 1), ("kiosk", "range_nm"): (0, 30), ("map", "cache_mb"): (0, 10 ** 6),
           ("flightradar24", "safety_margin"): (0, 0.9), ("flightaware", "safety_margin"): (0, 0.9),
           ("flightradar24", "billing_day"): (1, 28), ("flightaware", "billing_day"): (1, 28),
           ("home", "lat"): (-90, 90), ("home", "lon"): (-180, 180),
           # (the free feeds ask for no more than about one request a second, and reach 250 nm)
           ("tracking", "poll_seconds"): (1, 3600), ("tracking", "radius_nm"): (1, 250),
           ("tracking", "idle_after_seconds"): (10, 86400),
           ("flightradar24", "monthly_credits"): (0, 10 ** 9), ("flightradar24", "monthly_limit"): (0, 10 ** 9),
           ("flightradar24", "daily_limit"): (0, 10 ** 9), ("flightaware", "monthly_limit"): (0, 10 ** 9),
           ("flightaware", "monthly_credits"): (0, 10 ** 9), ("flightaware", "daily_limit"): (0, 10 ** 9),
           ("extras", "military_radius_nm"): (0, 250), ("extras", "tfr_radius_nm"): (0, 250)}
WHOLE = {("flightradar24", "billing_day"), ("flightaware", "billing_day")}
MORE_THAN_ZERO = {"tracking": ("radius_nm", "overhead_nm", "max_overhead_alt_ft", "poll_seconds", "idle_after_seconds")}


_said = set()
_reading = [None]           # the file being read, so each of its warnings is said once


def _warn(fmt, *args):
    """A warning about the settings, said once for each file however often it is read (an upgrade
    reads it several times)."""
    text = fmt % args if args else fmt
    key = (_reading[0], text)
    if _reading[0] is None or key not in _said:
        _said.add(key)
        log.warning("%s", text)


def _fits(v, want):
    """Is v the kind of value wanted? (true and false aren't numbers, though Python counts them so.)"""
    kinds = want if isinstance(want, tuple) else (want,)
    return isinstance(v, kinds) and (bool in kinds or not isinstance(v, bool))


def check(section, values, problems=None):
    """Refuse a setting CloudWall can't use, in words that name it: text where a number is wanted
    would otherwise surface later as a thread that stops, with nothing on screen to say why. A
    name CloudWall doesn't know (most often a typo) is only warned about. True if the section is
    one to take in.

    A word or a number CloudWall can't use is refused too, except when the file is read to run
    (problems is a list): then it is left out, the default used in its place, and what happened
    added to problems. A CloudWall that worked must go on working after an update that checks more
    than the last did; the screens and `cloudwall doctor` say what was left out. Case doesn't
    matter in a word ("Always" is "always")."""
    if section == "places":
        if not isinstance(values, list) or not all(isinstance(v, dict) for v in values):
            raise ValueError("places must be [[places]] sections, one for each place")
        return True
    if section not in DEFAULTS:
        if isinstance(values, dict):
            _warn("config: [%s] isn't a section CloudWall knows: left out", section)
        else:
            _warn("config: %s is set outside any section (settings go under a [section] heading): left out", section)
        return False
    if not isinstance(values, dict):
        raise ValueError(f"{section} must be a section: write [{section}] and its settings on the lines under it")
    if section == "airport":
        return True
    for key, v in values.items():
        default = DEFAULTS[section].get(key)
        want = OPTIONAL.get(section, {}).get(key)
        if want is None and default is not None:      # the kind of value its default is
            want = type(default) if isinstance(default, bool) or not isinstance(default, NUMBER) else NUMBER
        if want is None:
            _warn("config: [%s] %s isn't a setting CloudWall knows (a typo?): it has no effect", section, key)
            continue
        if not _fits(v, want):
            words = {bool: "true or false", str: "text in quotes", list: "a list", NUMBER: "a number"}.get(want, "text or a number")
            raise ValueError(f"[{section}] {key} must be {words}, not {v!r}")
        if isinstance(v, float) and not math.isfinite(v):
            raise ValueError(f"[{section}] {key} must be a number, not {v!r}")
        if key in MORE_THAN_ZERO.get(section, ()) and v <= 0:
            raise ValueError(f"[{section}] {key} must be more than 0, not {v!r}")
    for key, v in list(values.items()):
        words = CHOICES.get((section, key))
        wrong = None
        if words and isinstance(v, str) and v.lower() in words:
            values[key] = v.lower()
        elif words:
            listed = ", ".join(f'"{w}"' for w in words[:-1]) + f' or "{words[-1]}"'
            wrong = f"[{section}] {key} must be {listed}, not {v!r}"
        span = BETWEEN.get((section, key))
        if span and isinstance(v, NUMBER) and not span[0] <= v <= span[1]:
            wrong = f"[{section}] {key} must be from {span[0]} to {span[1]}, not {v!r}"
        if (section, key) in WHOLE and isinstance(v, float) and v != int(v):
            wrong = f"[{section}] {key} must be a whole number, not {v!r}"
        if wrong and problems is None:
            raise ValueError(wrong)
        if wrong:
            del values[key]
            problems.append(f"{wrong}: left out, so it is {DEFAULTS[section].get(key)!r}, the default")
    if section == "kiosk" and not re.fullmatch(r"\s*|\s*([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d\s*", str(values.get("quiet", ""))):
        raise ValueError(f'[kiosk] quiet must be a span of hours like "23:00-06:30", or "" for none, not {values["quiet"]!r}')
    if section == "server" and "port" in values and not (isinstance(values["port"], int) and 0 < values["port"] < 65536):
        raise ValueError(f"[server] port must be a whole number from 1 to 65535, not {values['port']!r}")
    if section == "server" and keys.problem(values.get("key", "")):
        raise ValueError(f"[server] key {keys.problem(values['key'])}")
    if section == "source" and "urls" in values and not (values["urls"] and all(isinstance(u, str) for u in values["urls"])):
        raise ValueError("[source] urls must be a list of at least one address, each in quotes")
    return True


def _xdg(var, fallback):
    return Path(os.environ.get(var) or Path.home() / fallback) / "cloudwall"


def user_config_path():
    return _xdg("XDG_CONFIG_HOME", ".config") / "config.toml"


def data_dir():
    """Where the logbooks and places.json are kept: $CLOUDWALL_DATA (set by the system install to
    /var/lib/cloudwall), else the user's data folder (~/.local/share/cloudwall)."""
    return Path(os.environ["CLOUDWALL_DATA"]) if os.environ.get("CLOUDWALL_DATA") else _xdg("XDG_DATA_HOME", ".local/share")


def default_db_path():
    return data_dir() / "cloudwall.db"


def cache_dir(cfg, db):
    """Where downloaded tiles and logos are kept: $CLOUDWALL_CACHE (the system install's
    /var/cache/cloudwall), else [storage] cache_dir, else beside the logbook."""
    if os.environ.get("CLOUDWALL_CACHE"):
        return Path(os.environ["CLOUDWALL_CACHE"])
    if cfg["storage"].get("cache_dir"):
        return Path(cfg["storage"]["cache_dir"]).expanduser()
    return Path(db).parent if db != ":memory:" else data_dir()


INSTALLED = Path("/etc/cloudwall/config.toml")
INSTALLED_UNIT = Path("/etc/systemd/system/cloudwall.service")


def find(path=None):
    """Which config file applies: --config, $CLOUDWALL_CONFIG, the system install's (once
    `cloudwall install` has set this machine up, whatever folder a command is run from: a checkout
    keeps an old config.toml after a migration, and reading that would be reading the wrong
    settings), ./config.toml, then the user one."""
    if path:
        return Path(path)
    if os.environ.get("CLOUDWALL_CONFIG"):
        return Path(os.environ["CLOUDWALL_CONFIG"])
    if INSTALLED_UNIT.exists() and INSTALLED.exists():
        return INSTALLED
    for p in (Path("config.toml"), user_config_path()):
        if p.exists():
            return p
    return None


def load(path=None):
    cfg = copy.deepcopy(DEFAULTS)
    path = find(path)
    if path and not path.exists():          # named by --config or $CLOUDWALL_CONFIG, but not there
        raise ValueError("no such file (cloudwall --init-config writes one to start from)")
    problems = []
    _reading[0] = str(Path(path).resolve()) if path else None
    if path:
        with open(path, "rb") as f:
            for section, values in tomllib.load(f).items():
                if not check(section, values, problems):
                    continue
                if section == "places":
                    cfg["places"] = [dict(v) for v in values] if isinstance(values, list) else []
                elif section == "airport" and "icao" in values:
                    cfg["airport"] = dict(values)    # this airport only: nothing carries over from the defaults
                elif section == "home" and "zip" in values and "lat" not in values and "lon" not in values:
                    cfg["home"] = dict(values, name=values.get("name", "Home"))   # placed by ZIP code, not the placeholder
                elif section == "home" and "zip" in values:
                    _warn("config: [home] gives both zip and lat/lon: lat/lon are used and the ZIP code "
                                "ignored (take out lat and lon to be placed by the ZIP code)")
                    cfg["home"].update(values)
                else:
                    cfg.setdefault(section, {}).update(values)
    src = cfg["source"]
    if src.get("url"):                      # older single-feed setting: try it first
        src["urls"] = [src["url"]] + [u for u in src["urls"] if u != src["url"]]
    cfg["_path"] = str(path) if path else None
    cfg["_problems"] = problems
    for p in problems:
        _warn("config: %s", p)
    return cfg


def kind_of(section, key):
    """What kind of value a setting takes: bool, number, list or text (str), from its default, or
    from OPTIONAL for those without one."""
    default = DEFAULTS.get(section, {}).get(key)
    if isinstance(default, bool):
        return "bool"
    if isinstance(default, (int, float)):
        return "number"
    if isinstance(default, list):
        return "list"
    want = OPTIONAL.get(section, {}).get(key)
    if want is not None:
        kinds = want if isinstance(want, tuple) else (want,)
        if str in kinds:
            return "text"
        if int in kinds or float in kinds:
            return "number"
    return "text"


def _toml_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(v, list):
        return "[" + ", ".join(_toml_value(x) for x in v) + "]"
    raise ValueError(f"can't write {v!r} into the config")


def _setting_end(lines, at, end):
    """The last line of the setting that starts on line `at`: the same line, unless its value (a
    list written over several lines) only closes further down, before line `end`."""
    for stop in range(at, end):
        try:
            tomllib.loads("\n".join(lines[at:stop + 1]))
            return stop
        except tomllib.TOMLDecodeError:
            pass
    return at


def write_setting(path, section, key, value):
    """Set `[section] key` in the config file at `path`, leaving every other line as it was: the
    setting's line replaced where there is one (its comment kept), added under [section] where
    there isn't, and the section added where there's none. The new file must read as TOML, give
    the value asked for and pass check(); otherwise nothing is written. Written whole and put in
    place, so a crash halfway never leaves half a config, and readable by its owner and group
    only, since the file may hold keys."""
    path = Path(path)
    text = path.read_text() if path.exists() else ""
    lines = text.splitlines()
    line = f"{key} = {_toml_value(value)}"
    is_key = re.compile(rf"^\s*{re.escape(key)}\s*=")
    is_section = re.compile(r"^\s*\[")
    head = next((i for i, l in enumerate(lines) if re.match(rf"^\s*\[{re.escape(section)}\]\s*(#.*)?$", l)), None)
    if head is None:
        lines += ([""] if lines and lines[-1].strip() else []) + [f"[{section}]", line]
    else:
        end = next((i for i in range(head + 1, len(lines)) if is_section.match(lines[i])), len(lines))
        at = next((i for i in range(head + 1, end) if is_key.match(lines[i])), None)
        if at is not None:
            # a comment after the old value stays after the new one
            stop = _setting_end(lines, at, end)
            m = re.match(r'^\s*[\w-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^#"]*?)(\s+#.*)?$', lines[at]) if stop == at else None
            lines[at:stop + 1] = [line + (m.group(1) or "" if m else "")]
        else:
            # after the section's last setting, ahead of the comments and blank lines before the next one
            last = max((i for i in range(head, end) if lines[i].strip() and not lines[i].lstrip().startswith("#")), default=head)
            lines.insert(last + 1, line)
    new = "\n".join(lines) + "\n"
    try:
        got = tomllib.loads(new)
    except tomllib.TOMLDecodeError as e:
        raise ValueError(f"{path} would no longer read as TOML: {e}") from None
    if got.get(section, {}).get(key) != value:
        raise ValueError(f"{path}: couldn't set [{section}] {key} (it reads {got.get(section, {}).get(key)!r})")
    # the setting written is checked strictly; the rest of its section only as it is when read (a
    # word CloudWall tolerates in another setting is no reason to refuse this one)
    check(section, {k: v for k, v in got[section].items() if k == key or (section, k) not in CHOICES and (section, k) not in BETWEEN})
    path.parent.mkdir(parents=True, exist_ok=True)
    st = path.stat() if path.exists() else None
    mode = (st.st_mode & 0o770) if st else 0o600
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as f:
        f.write(new)
    os.chmod(tmp, mode)
    if st and os.geteuid() == 0:         # root rewriting the service's file: it stays the service's
        os.chown(tmp, st.st_uid, st.st_gid)
    if path.exists():                    # the file as it was, to go back to if the new one won't start
        shutil.copy2(path, path.with_name(path.name + ".before"))
    os.replace(tmp, path)


# names too plain to say where a stray setting belongs ([source] name was a feed's name, not the house's)
GENERIC = {"name", "enabled", "url", "urls", "key", "host", "port", "mode", "style", "path"}


def known(section, key):
    """Is `[section] key` a setting CloudWall uses?"""
    if section == "airport":
        return True
    return key in DEFAULTS.get(section, {}) or key in OPTIONAL.get(section, {})


def strays(path):
    """Lines in the settings file that do nothing: a setting under the wrong heading (most often),
    a name CloudWall doesn't know, a heading it doesn't know. Each with the section it belongs in,
    when its name is a setting of exactly one other section: [{"section", "key", "value", "belongs"}]."""
    path = Path(path) if path else None
    if not path or not path.exists():
        return []
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return []
    out = []
    for section, values in data.items():
        if section == "places" or not isinstance(values, dict):
            continue
        for key, v in values.items():
            if section in DEFAULTS and known(section, key):
                continue
            homes = [sec for sec in DEFAULTS if sec not in ("airport", "places") and known(sec, key)]
            # a name as plain as "name" or "url" means something different under each heading: never moved
            out.append({"section": section, "key": key, "value": v,
                        "belongs": homes[0] if len(homes) == 1 and key not in GENERIC else None})
    return out


def remove_setting(path, section, key):
    """Take `[section] key` out of the settings file (the setting's own lines; a heading left with
    nothing under it goes too). Checked as write_setting is: if the file wouldn't read as TOML, or
    the setting is still there, nothing is written."""
    path = Path(path)
    lines = path.read_text().splitlines()
    head = next((i for i, l in enumerate(lines) if re.match(rf"^\s*\[{re.escape(section)}\]\s*(#.*)?$", l)), None)
    if head is None:
        raise ValueError(f"there's no [{section}] in {path}")
    end = next((i for i in range(head + 1, len(lines)) if re.match(r"^\s*\[", lines[i])), len(lines))
    at = next((i for i in range(head + 1, end) if re.match(rf"^\s*{re.escape(key)}\s*=", lines[i])), None)
    if at is None:
        raise ValueError(f"[{section}] {key} isn't in {path}")
    stop = _setting_end(lines, at, end)
    del lines[at:stop + 1]
    end -= stop + 1 - at
    if not any(lines[i].strip() and not lines[i].lstrip().startswith("#") for i in range(head + 1, end)):
        del lines[head:end]                        # the heading, now with nothing under it
    new = "\n".join(lines).rstrip("\n") + "\n"
    try:
        got = tomllib.loads(new)
    except tomllib.TOMLDecodeError:
        raise ValueError(f"[{section}] {key} runs over several lines: take it out of {path} by hand") from None
    if key in got.get(section, {}):
        raise ValueError(f"[{section}] {key} is set twice in {path}: take it out by hand")
    st = path.stat()
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, st.st_mode & 0o770)
    with os.fdopen(fd, "w") as f:
        f.write(new)
    os.chmod(tmp, st.st_mode & 0o770)
    if os.geteuid() == 0:
        os.chown(tmp, st.st_uid, st.st_gid)
    shutil.copy2(path, path.with_name(path.name + ".before"))
    os.replace(tmp, path)


def init(path=None):
    """Write a starter config file. Returns (path, created)."""
    path = Path(path) if path else user_config_path()
    if path.exists():
        return path, False
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXAMPLE, path)
    os.chmod(path, 0o600)            # it will hold keys: readable by its owner only
    return path, True
