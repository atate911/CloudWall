"""The private link's key (made, compared, judged) and the owner's password hash. A key is four
pronounceable groups ("tafo-kemi-luza-nobe", about 50 bits); hyphens and case don't matter.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path

CONSONANTS, VOWELS = "bdfghjkmnprstvz", "aeiou"      # none that look or sound like another (no c/k, l/i, q, w, x, y)
MIN_LETTERS = 12                                     # for a key of one's own; letters and digits counted


def new_key():
    return "-".join("".join(secrets.choice(CONSONANTS) + secrets.choice(VOWELS) for _ in range(2)) for _ in range(4))


def tidy(key):
    """A key as it is compared: its letters and digits, lower case."""
    return re.sub(r"[^a-z0-9]", "", str(key or "").lower())


def problem(key):
    """What is wrong with a key someone set, or None."""
    if not isinstance(key, str):
        return "must be text in quotes"
    if key and not re.fullmatch(r"[A-Za-z0-9-]+", key):
        return "may have only letters, digits and hyphens (it is typed into an address)"
    if key and len(tidy(key)) < MIN_LETTERS:
        return f"must have at least {MIN_LETTERS} letters and digits: `cloudwall --new-key` makes a good one"
    return None


# the owner's password (the control board's sign-in: serve/auth.py)
MIN_PASSWORD = 10
N, R, P = 2 ** 14, 8, 1             # scrypt's cost: about 50 ms and 16 MB a try


def owner_file(cfg_path=None):
    path = _config().find(cfg_path) or _config().user_config_path()
    return Path(path).with_name("owner")


def hash_password(password, salt=None):
    salt = salt or os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def password_matches(password, stored):
    try:
        _, n, r, p, salt, h = stored.strip().split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


def set_password(password, cfg_path=None):
    """Write the owner's password (hashed) beside the settings, owned like the settings file."""
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"the password needs at least {MIN_PASSWORD} characters")
    path = owner_file(cfg_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    like = _config().find(cfg_path)
    st = Path(like).stat() if like and Path(like).exists() else None
    tmp = path.with_name("owner.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640 if st else 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(hash_password(password) + "\n")
    if st and os.geteuid() == 0:
        os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, path)
    return path


def _config():
    from . import config            # lazy: config imports this module
    return config
