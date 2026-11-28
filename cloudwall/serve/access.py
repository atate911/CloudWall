"""A private link: with `[server] key` set, CloudWall answers only under /k/<key>/.

Every address the page asks for is relative, so each carries the key too, with no cookie.
Keys are made and judged in core/keys.py.
"""
import hmac
import re

from ..core.keys import tidy


def admit(path, key):
    """For `path` and the (tidied) key: ("in", path without the prefix), ("slash", redirect target:
    the key's address needs its closing slash for relative addresses), or ("out", None)."""
    m = re.match(r"^/k/([^/?#]*)(.*)$", path, re.S)
    if not m or not hmac.compare_digest(tidy(m.group(1)).encode(), key.encode()):
        return "out", None
    rest = m.group(2)
    if not rest.startswith("/"):
        return "slash", f"{m.group(1)}/{rest}"          # relative, so it works behind a proxy's prefix too
    return "in", rest
