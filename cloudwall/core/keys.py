"""The private link's key: how one is made, compared and judged.

A key is made to be typed once on a touchscreen and to be hard to guess: sixteen lower-case
letters in four groups that can be said aloud ("tafo-kemi-luza-nobe"), about 50 bits. Typed with
or without the hyphens, in either case, it is the same key. What the key does is access.py's;
setting one up is privatelink.py's.
"""
import re
import secrets

CONSONANTS, VOWELS = "bdfghjkmnprstvz", "aeiou"      # none that look or sound like another (no c/k, l/i, q, w, x, y)
MIN_LETTERS = 12                                     # a key of one's own: no shorter than this, letters and digits counted


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
