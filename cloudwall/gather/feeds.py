"""Position feeds: readsb-style JSON read with failover (Feeds) or together with your own
receiver (Merged), into CloudWall's aircraft shape (normalise); and the military feed's
aircraft heard with no position."""
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as WaitedTooLong
from urllib.parse import urlparse

from ..core.geo import haversine_nm
from ..core.http import get_json

log = logging.getLogger("cloudwall.feeds")


def normalise(a):
    """Convert a readsb/adsb.lol aircraft record to CloudWall's shape."""
    alt = a.get("alt_baro", a.get("alt_geom"))
    on_ground = alt == "ground"
    if not isinstance(alt, (int, float)):
        alt = 0 if on_ground else None
    vrate = a.get("baro_rate", a.get("geom_rate"))
    flags = a.get("dbFlags") if isinstance(a.get("dbFlags"), int) else 0
    return {
        "hex": (a.get("hex") or "").lstrip("~").lower(),
        "callsign": (a.get("flight") or "").strip() or None,
        "reg": a.get("r"),
        "type": a.get("t"),
        "alt": alt,
        "on_ground": on_ground,
        "gs": _num(a.get("gs")),          # a number or None: a feed's odd value mustn't reach the sums
        "vrate": _num(vrate),
        "lat": _num(a.get("lat")),
        "lon": _num(a.get("lon")),
        "squawk": a.get("squawk"),
        # general, lifeguard, minfuel, nordo, unlawful, downed
        "emergency_status": a.get("emergency") if a.get("emergency") not in (None, "none") else None,
        "category": a.get("category"),
        "military": bool(flags & 1),
        # LADD, PIA: the owner asked not to be identified
        "private_owner": bool(flags & 12),
        "desc": tidy_type(a.get("desc")),
        "year": _year(a.get("year")),
        "owner_op": a.get("ownOp"),
        "target_alt": _num(a.get("nav_altitude_mcp") or a.get("nav_altitude_fms")),
        "modes": [m for m in a.get("nav_modes") or [] if isinstance(m, str)],
        "alt_gps": _num(a.get("alt_geom")),
        "track": _num(a.get("track") if a.get("track") is not None else a.get("true_heading")),
    }


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _year(v):
    try:
        y = int(v)
        return y if 1900 < y <= 2100 else None
    except (TypeError, ValueError):
        return None


KEEP_UPPER = {"MAX", "NG", "ER", "LR", "SR", "XR", "ATR", "CRJ", "EMB", "ERJ", "MD", "DC", "II", "III", "IV",
              "SP", "XL", "XLS", "CJ", "CJ2", "CJ3", "CJ4", "LX", "GX", "EX", "BBJ", "TBM", "PC", "DHC", "RJ",
              "ACJ", "NEO", "CEO", "STOL", "VTOL", "AS", "EC", "SA", "AW", "UH", "CH", "KC", "C", "F", "G", "B", "A"}


def tidy_type(desc):
    """'BOEING 737 MAX 8' -> 'Boeing 737 MAX 8'; mixed case is left alone."""
    if not desc or not isinstance(desc, str):
        return None
    if desc != desc.upper():
        return desc
    words = []
    for w in desc.split():
        if any(ch.isdigit() for ch in w) or w in KEEP_UPPER or len(w) <= 2:
            words.append(w)
        else:
            words.append(w[0] + w[1:].lower())
    return " ".join(words)


class Feeds:
    """readsb-style JSON feeds tried in order; on failure it moves to the next and stays there."""

    def __init__(self, urls, quiet=False):
        self.urls = list(urls)
        self.current = 0
        self.name = self._host(self.urls[0])
        self.quiet = quiet          # the caller reports failures itself (Merged)
        self.vitals = Vitals()
        self.parts = {"the position feed": self}      # Merged has two

    @staticmethod
    def _host(url):
        return urlparse(url).hostname or url

    def fetch(self, lat, lon, radius_nm):
        return [n for n, _ in self.fetch_timed(lat, lon, radius_nm)]

    def fetch_timed(self, lat, lon, radius_nm, clock=time.time):
        """As fetch, with when each position was reported: [(aircraft, unix time), ...]."""
        last = None
        for step in range(len(self.urls)):
            i = (self.current + step) % len(self.urls)
            url = self.urls[i].format(lat=f"{lat:.4f}", lon=f"{lon:.4f}", radius=int(radius_nm))
            try:
                data = get_json(url, timeout=8)
                if not isinstance(data, dict):     # a 404 (None), or JSON that isn't a feed's
                    raise ValueError("no aircraft list in its answer")
            except Exception as e:
                if not self.quiet:
                    log.warning("feed %s failed: %s", self._host(url), e)
                last = e
                continue
            if i != self.current:
                log.info("switched position feed to %s", self._host(url))
            self.current, self.name = i, self._host(url)
            received = clock()
            placed = placed_with_times(data, received)
            self.vitals.answered(data, placed, received, self.name)
            return placed
        self.vitals.failed(last, clock())
        raise last


class Vitals:
    """Whether a feed's answers are believable (frozen, clock skew, old positions), for the
    health watcher (app/watch.py)."""

    def __init__(self):
        self.ok_at = None
        self.failed_at = None
        self.error = None
        self.down_since = None      # None while it answers
        self.count = 0              # aircraft with a position in its last answer
        self.moving = 0             # of which over 50 kt
        self.same = 0               # answers in a row identical to the one before
        self.skew_s = None          # its clock less ours (measured here: feed_time ignores a clock over 5 min off)
        self.lag_s = None           # the median age of its positions on arrival
        self.host = None
        self._signature = None

    def answered(self, data, placed, received, host):
        self.ok_at, self.down_since, self.error, self.host = received, None, None, host
        self.count = len(placed)
        self.moving = sum(1 for a, _ in placed if (a.get("gs") or 0) > 50)
        # Frozen = the same "now" stamp again. An unchanged position is no sign (a decoder lists a
        # lost aircraft at its last position for up to a minute), so only a feed with no stamp is
        # judged by its positions, and then only with several aircraft moving.
        now = (data or {}).get("now")
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            signature = ("now", now)
        elif self.moving >= 3:
            signature = hash(tuple(sorted((a["hex"], round(a["lat"], 5), round(a["lon"], 5)) for a, _ in placed)))
        else:
            signature = None
        self.same = self.same + 1 if signature is not None and signature == self._signature else 0
        self._signature = signature
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            self.skew_s = round((now / 1000 if now > 1e11 else now) - received, 1)
        ages = sorted(_num(a.get("seen_pos")) for a in (data or {}).get("ac") or (data or {}).get("aircraft") or []
                      if _num(a.get("seen_pos")) is not None and a.get("lat") is not None)
        self.lag_s = ages[len(ages) // 2] if ages else None

    def failed(self, error, at):
        self.failed_at, self.error = at, str(error)
        self.down_since = self.down_since or at


def feed_time(data, received):
    """When a feed's answer was made, unix seconds (readsb gives seconds, the community APIs
    milliseconds); `received` if it gives no time or one over 5 min from our clock."""
    now = (data or {}).get("now")
    if isinstance(now, (int, float)) and not isinstance(now, bool):
        now = now / 1000 if now > 1e11 else now
        if abs(now - received) < 300:
            return now
    return received


def placed_with_times(data, received):
    """[(aircraft, time its position was reported)] for those with a position: the answer's time
    less seen_pos."""
    made, out = feed_time(data, received), []
    for a in (data or {}).get("ac") or (data or {}).get("aircraft") or []:
        n = normalise(a)
        if n["hex"] and n["lat"] is not None and n["lon"] is not None:
            age = _num(a.get("seen_pos"))
            out.append((n, made - max(0.0, age) if age is not None else made))
    return out


MERGE_MAX_AGE_S = 60        # older positions are left out, as readsb itself drops them
MERGE_WAIT_S = 25           # the longest an update waits for either side
MERGE_PROJECT_MAX_S = 15    # carry a position along its track for at most this long


def project(a, seconds):
    """The aircraft moved on along its track at its ground speed for `seconds` (capped; flat-earth)."""
    seconds = min(seconds, MERGE_PROJECT_MAX_S)
    if seconds <= 0.05 or a["on_ground"] or not a.get("gs") or a.get("track") is None:
        return a
    nm, track = a["gs"] * seconds / 3600, math.radians(a["track"])
    return dict(a, lat=a["lat"] + nm * math.cos(track) / 60,
                lon=a["lon"] + nm * math.sin(track) / (60 * math.cos(math.radians(a["lat"]))))


class Merged:
    """urls[0] (your receiver) and the public feeds asked at once. An aircraft both have takes the
    more recent position, with missing details filled from the other. Every position is projected
    along its track to the moment of the update (the two run at different delays), and an aircraft
    never goes back: a report older than the one used last time loses to it.
    """

    def __init__(self, urls, clock=time.time):
        self.receiver = Feeds(urls[:1], quiet=True)
        self.public = Feeds(urls[1:]) if len(urls) > 1 else None
        self.parts = {"your receiver": self.receiver, "the public feed": self.public} if self.public \
            else {"your receiver": self.receiver}
        self.clock = clock
        self.name = " + ".join(f.name for f in (self.receiver, self.public) if f)
        self.last = {}               # hex -> (time of the position used last, that record)
        self.down = set()            # feeds known to be failing, so each is logged once
        # four, not two: a feed that hangs past MERGE_WAIT_S still holds its worker
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="feed")

    def close(self):
        self.pool.shutdown(wait=False, cancel_futures=True)

    def _answer(self, future, label, feed):
        try:
            return future.result(timeout=MERGE_WAIT_S)
        except WaitedTooLong:
            e = TimeoutError(f"no answer in {MERGE_WAIT_S} s")
            feed.vitals.failed(e, self.clock())
            if label not in self.down:
                self.down.add(label)
                log.warning("merged feeds: %s isn't answering (%s); carrying on with the other", label, e)
            return None, e

    def _ask(self, feed, lat, lon, radius_nm, label):
        try:
            got = feed.fetch_timed(lat, lon, radius_nm, self.clock)
        except Exception as e:
            if label not in self.down:
                self.down.add(label)
                log.warning("merged feeds: %s isn't answering (%s); carrying on with the other", label, e)
            return None, e
        if label in self.down:
            self.down.discard(label)
            log.info("merged feeds: %s is answering again", label)
        return got, None

    def fetch(self, lat, lon, radius_nm):
        jobs = [(self.receiver, "your receiver")] + ([(self.public, "the public feed")] if self.public else [])
        futures = [self.pool.submit(self._ask, f, lat, lon, radius_nm, label) for f, label in jobs]
        answers = [self._answer(fu, label, feed) for fu, (feed, label) in zip(futures, jobs)]
        now = self.clock()
        if all(got is None for got, _ in answers):
            raise answers[0][1]
        self.name = " + ".join(f.name for (f, _), (got, _) in zip(jobs, answers) if got is not None)

        offers = {}                  # hex -> [(position time, rank, record)], rank 0 = your receiver
        for rank, (got, _) in enumerate(answers):
            for a, at in got or ():
                at = min(at, now)    # a clock a little ahead mustn't make a report look newer than now
                if now - at <= MERGE_MAX_AGE_S:
                    offers.setdefault(a["hex"], []).append((at, rank, a))

        out = []
        for hexid, offered in offers.items():
            offered.sort(key=lambda o: (-o[0], o[1]))        # newest first; your receiver wins a tie
            at, _, best = offered[0]
            prev = self.last.get(hexid)
            if prev and prev[0] > at:                        # nothing newer than last time: don't go back
                at, best = prev
            filled = dict(best)
            for _, _, other in offered:
                for k, v in other.items():
                    if filled.get(k) in (None, [], "") and v not in (None, [], ""):
                        filled[k] = v
                if other.get("military"):
                    filled["military"] = True
            self.last[hexid] = (at, filled)
            out.append(dict(project(filled, now - at)))      # a copy: downstream changes stay out of `last`
        self.last = {h: v for h, v in self.last.items() if now - v[0] <= MERGE_MAX_AGE_S}
        return out


def military_unplaced(url="https://opendata.adsb.fi/api/v2/mil"):
    """Raw records of military aircraft heard without a position, worldwide: they send altitude
    only, and the feed gives the rough location of the receiver that heard them (rr_lat/rr_lon).
    One request serves every place (shared.py)."""
    data = get_json(url, timeout=10)
    return [a for a in (data or {}).get("ac") or []
            if a.get("lat") is None and a.get("rr_lat") is not None and a.get("rr_lon") is not None
            and (a.get("seen") or 0) <= 90]


def heard_near(unplaced, home, radius_nm):
    """Those of military_unplaced's aircraft heard by a receiver within radius_nm of home."""
    out = []
    for a in unplaced:
        d = haversine_nm(home["lat"], home["lon"], a["rr_lat"], a["rr_lon"])
        if d <= radius_nm:
            n = normalise(a)
            n.update(rough_nm=round(d), lat=None, lon=None)
            out.append(n)
    return out
