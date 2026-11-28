"""Every outbound request goes through fetch: one User-Agent, a timeout, a cap on bytes read
and optional retries."""
import json
import time
import urllib.error
import urllib.request

from .. import __version__

# must carry a contact URL: planespotters.net answers 403 without one
UA = f"CloudWall/{__version__} (+https://github.com/atate911/CloudWall)"
MAX_BYTES = 32 * 1024 * 1024        # the FAA's restrictions are a few MB
PASSING = (502, 503, 504)           # worth one more try


class TooBig(ValueError):
    pass


def fetch(url, timeout=12, headers=None, max_bytes=MAX_BYTES, retries=0):
    """GET url: (bytes, content type). Raises urllib.error.HTTPError for an HTTP error (a 404 too),
    OSError for the network, TooBig past max_bytes. retries: more tries, a second apart, after a
    network error or a 502/503/504."""
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


def post_json(url, body, timeout=12):
    """POST a JSON document. Returns the answer's bytes; raises on errors."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(64 * 1024)


PASSED_ON = ("Accept", "Accept-Encoding", "Accept-Language", "If-Modified-Since", "If-None-Match", "Range")
PASSED_BACK = ("Content-Type", "Content-Encoding", "Cache-Control", "ETag", "Last-Modified", "Expires",
               "Content-Range", "Accept-Ranges")


def relay(url, request_headers, timeout=20, max_bytes=64 * 1024 * 1024):
    """GET url on behalf of a browser, passing only PASSED_ON headers (never cookies) and
    PASSED_BACK ones. Returns (status, headers, body); an HTTP error is an answer, not raised."""
    headers = {k: request_headers[k] for k in PASSED_ON if request_headers.get(k)}
    req = urllib.request.Request(url, headers={"User-Agent": UA, **headers})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        r = e
    with r:
        data = r.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise TooBig(f"{url}: more than {max_bytes // 1024 // 1024} MB")
        back = {k: r.headers[k] for k in PASSED_BACK if r.headers.get(k)}
        return r.status if hasattr(r, "status") else r.code, back, data
