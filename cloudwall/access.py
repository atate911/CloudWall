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
import os
import re
import secrets
import socket
import subprocess
import tomllib
from pathlib import Path

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


# -- setting it up: `cloudwall --private-link` ---------------------------------------------------

SECTION = re.compile(r"^\s*\[")


def write_key(path, key):
    """Set (or, with key "", clear) `[server] key` in the config file at `path`."""
    write_setting(path, "server", "key", key)


def write_setting(path, section, name, value):
    """Set `[section] name` to the text `value` in the config file at `path`, leaving every other
    line as it was: the setting's line replaced where there is one, added under [section] where
    there isn't, and a [section] added where there's none. The file must still read as TOML after,
    with the setting as asked, or it is left as it was."""
    path = Path(path)
    text = path.read_text() if path.exists() else ""
    lines = text.splitlines()
    line = f'{name} = "{value}"'
    setting = re.compile(rf"^\s*{re.escape(name)}\s*=")
    head = next((i for i, l in enumerate(lines) if re.match(rf"^\s*\[{re.escape(section)}\]\s*(#.*)?$", l)), None)
    if head is None:
        lines += ([""] if lines and lines[-1].strip() else []) + [f"[{section}]", line]
    else:
        end = next((i for i in range(head + 1, len(lines)) if SECTION.match(lines[i])), len(lines))
        at = next((i for i in range(head + 1, end) if setting.match(lines[i])), None)
        if at is not None:
            lines[at] = line
        else:
            # after the section's last setting, ahead of the comments and blank lines before the next one
            last = max((i for i in range(head, end) if lines[i].strip() and not lines[i].lstrip().startswith("#")), default=head)
            lines.insert(last + 1, line)
    new = "\n".join(lines) + "\n"
    try:
        got = tomllib.loads(new).get(section, {}).get(name)
    except tomllib.TOMLDecodeError as e:
        raise ValueError(f"{path} would no longer read as TOML: {e}") from None
    if got != value:
        raise ValueError(f"{path}: couldn't set [{section}] {name} (it reads {got!r})")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new)


def lan_address():
    """This machine's address on the home network, for the links it prints: the one it would send
    from (nothing is sent: a UDP socket only picks its route), or its name when it has none."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostname()


def links(key, host, port, address=""):
    """The addresses to open, as [(what, address)], for a server listening on host:port. With
    `address` (the name it has on the internet, through Caddy: `cloudwall --public`), the links
    are that address's, the same for every screen wherever it is."""
    k = f"/k/{key}" if key else ""
    if address:
        return [("Every screen (a car, a phone, a PC)", f"https://{address}{k}/"),
                ("The wall panel", f"https://{address}{k}/kiosk")]
    here = lan_address() if host in ("0.0.0.0", "::", "") else host
    return [("On the home network (a PC, a phone)", f"http://{here}:{port}{k}/"),
            ("The wall panel", f"http://{here}:{port}{k}/kiosk"),
            ("From outside the house", f"https://<your address>{k}/  (through your tunnel or reverse proxy: cloudwall --public)")]


def as_root(cmd):
    """`cmd` run as root: as it is when this already runs as root, through sudo when not."""
    return list(cmd) if os.geteuid() == 0 else ["sudo", *cmd]


def restart_service():
    """Restart CloudWall's systemd service if it is running as one, so a new setting takes effect:
    the user service `make service` sets up, or else a system-wide one called cloudwall. True when
    restarted, False when it isn't running as either, or None when systemd isn't there to ask."""
    try:
        quiet = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if subprocess.run(["systemctl", "--user", "is-active", "--quiet", "cloudwall"], timeout=10, **quiet).returncode == 0:
            return subprocess.run(["systemctl", "--user", "restart", "cloudwall"], timeout=30).returncode == 0
        if subprocess.run(["systemctl", "is-active", "--quiet", "cloudwall"], timeout=10, **quiet).returncode == 0:
            return subprocess.run(as_root(["systemctl", "restart", "cloudwall"]), timeout=60).returncode == 0
        return False
    except (OSError, subprocess.SubprocessError):
        return None
