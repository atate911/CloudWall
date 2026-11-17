import json
import urllib.error
import urllib.request

UA = "CloudWall/0.1 (hobby flight board)"


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
