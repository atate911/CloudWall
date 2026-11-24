import json
import urllib.error
import urllib.request

from . import __version__

# How CloudWall names itself to the services it asks: with a way to reach its makers, which some ask
# for and planespotters.net requires (without one, every photo lookup is refused with a 403)
UA = f"CloudWall/{__version__} (+https://github.com/atate911/CloudWall)"


def get_json(url, timeout=12, headers=None):
    """GET a JSON document. Returns None on HTTP 404, raises on other errors."""
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def get_text(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig", "replace")
