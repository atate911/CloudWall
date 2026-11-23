"""A private link: CloudWall reached from outside the house without a login to type.

CloudWall has no accounts. On the home network that is as it should be; put on the internet (to
watch from a car, say) it would show anyone the house's position, let them add and remove places
and spend the paid route lookups. With `[server] key` set, CloudWall answers only under
/k/<key>/: the key is part of the address, so a bookmark or a favourite carries it and nothing
is typed again. Every address the page asks for is relative, so each of them carries the key too,
with no cookie to expire or be cleared.

A key is made to be typed once on a touchscreen and to be hard to guess: sixteen lower-case
letters in four groups that can be said aloud ("tafo-kemi-luza-nobe"), about 50 bits. Typed with
or without the hyphens, in either case, it is the same key.
"""
import hmac
import re
import secrets

CONSONANTS, VOWELS = "bdfghjkmnprstvz", "aeiou"      # none that look or sound like another (no c/k, l/i, q, w, x, y)
MIN_LETTERS = 12                                     # a key of one's own: no shorter than this, letters and digits counted
PREFIX = "/k/"


def new_key():
    """A fresh key: four groups of consonant-vowel-consonant-vowel."""
    return "-".join("".join(secrets.choice(CONSONANTS) + secrets.choice(VOWELS) for _ in range(2)) for _ in range(4))


def tidy(key):
    """A key as it is compared: its letters and digits, lower case."""
    return re.sub(r"[^a-z0-9]", "", str(key or "").lower())


def problem(key):
    """What is wrong with a key someone set, or None: it has to be worth having."""
    if not isinstance(key, str):
        return "must be text in quotes"
    if key and not re.fullmatch(r"[A-Za-z0-9-]+", key):
        return "may have only letters, digits and hyphens (it is typed into an address)"
    if key and len(tidy(key)) < MIN_LETTERS:
        return f"must have at least {MIN_LETTERS} letters and digits: `cloudwall --new-key` makes a good one"
    return None


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
