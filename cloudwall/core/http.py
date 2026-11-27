"""Every request CloudWall makes to another service goes through fetch: one User-Agent, a
timeout, a cap on how much it will read (a service that sends without end can't fill memory),
and, where asked, one more try after a moment for trouble that passes (a dropped connection, a
busy server). get_json and get_text are fetch for the two kinds of answer most services give."""
import json
import time
import urllib.error
import urllib.request

from .. import __version__

# How CloudWall names itself to the services it asks: with a way to reach its makers, which some ask
# for and planespotters.net requires (without one, every photo lookup is refused with a 403)
UA = f"CloudWall/{__version__} (+https://github.com/atate911/CloudWall)"
MAX_BYTES = 32 * 1024 * 1024        # the largest answer read (the FAA's restrictions are a few MB)
PASSING = (502, 503, 504)           # a server's trouble worth one more try


class TooBig(ValueError):
    pass


def fetch(url, timeout=12, headers=None, max_bytes=MAX_BYTES, retries=0):
    """GET url: (bytes, content type). Raises urllib.error.HTTPError for an HTTP error (a 404 too),
    OSError for the network, TooBig past max_bytes. retries: how many more tries, a second
    apart, after a network error or a 502/503/504."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise TooBig(f"{url}: more than {max_bytes // 1024} KB")
                return data, r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code not in PASSING or attempt == retries:
                raise
        except OSError:
            if attempt == retries:
                raise
        time.sleep(1)


def get_json(url, timeout=12, headers=None):
    """GET a JSON document. Returns None on HTTP 404, raises on other errors."""
    try:
        data, _ = fetch(url, timeout, {"Accept": "application/json", **(headers or {})})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return json.loads(data.decode("utf-8"))


def get_text(url, timeout=12):
    data, _ = fetch(url, timeout)
    return data.decode("utf-8-sig", "replace")
