"""A private link: CloudWall reached from outside the house without a login to type.

CloudWall has no accounts. On the home network that is as it should be; put on the internet (to
watch from a car, say) it would show anyone the house's position, let them add and remove places
and spend the paid route lookups. With `[server] key` set, CloudWall answers only under
/k/<key>/: the key is part of the address, so a bookmark or a favourite carries it and nothing
is typed again. Every address the page asks for is relative, so each of them carries the key too,
with no cookie to expire or be cleared.

How a key is made and judged is keys.py's; setting one up from the command line is
privatelink.py's.
"""
import hmac
import re

from .keys import tidy

PREFIX = "/k/"


def admit(path, key):
    """What a request for `path` comes to on a server whose key is `key` (tidied):
    ("in", the path without the key's prefix), ("slash", where to send it: the key's address wants
    its closing slash, for the page's relative addresses), or ("out", None)."""
    m = re.match(r"^/k/([^/?#]*)(.*)$", path, re.S)
    if not m or not hmac.compare_digest(tidy(m.group(1)).encode(), key.encode()):
        return "out", None
    rest = m.group(2)
    if not rest.startswith("/"):
        return "slash", f"{m.group(1)}/{rest}"          # relative to /k/, so it works behind a proxy's own prefix too
    return "in", rest
