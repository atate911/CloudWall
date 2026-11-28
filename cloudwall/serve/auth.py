"""The owner: the one person who may change CloudWall; everyone else watches.

The password (`sudo cloudwall owner`) is a scrypt hash in `owner` beside the settings file. A
session cookie lasts 30 days from last use and survives restarts (hashed, in the shared store) but
not a change of password. Until an owner exists, only requests from this machine itself count as
the owner's. The control board refuses hosts CloudWall doesn't answer to (DNS rebinding).
"""
import hashlib
import ipaddress
import secrets
import socket
import threading
import time

from ..core.keys import owner_file, password_matches

COOKIE = "cloudwall_owner"
SESSION_S = 30 * 86400
TRIES, TRIES_S = 5, 300


class Owner:
    def __init__(self, cfg, store=None, clock=time.time):
        self.cfg, self.store, self.clock = cfg, store, clock
        self.file = owner_file(cfg.get("_path"))
        self.failures = {}          # address -> [times of wrong passwords]
        self.trying = threading.Lock()
        self.sessions = {}          # hashed token -> last used

    def exists(self):
        return self.file.exists()

    def _stored(self):
        try:
            return self.file.read_text()
        except OSError:
            return None

    # -- sessions --
    def _hash(self, token):
        # the password's hash is mixed in, so a session dies when the password is changed or removed
        return hashlib.sha256(f"{token}\0{(self._stored() or '').strip()}".encode()).hexdigest()

    def carry_over(self, token):
        """After the signed-in owner changes the password: keep their session under the new one."""
        if token:
            self._keep(self._hash(token), self.clock())

    def sign_in(self, password, address):
        """A session token, or raises ValueError with what to say."""
        now = self.clock()
        stored = self._stored()
        with self.trying:        # counted before judged, so simultaneous tries can't slip past the limit
            recent = [t for t in self.failures.get(address, []) if now - t < TRIES_S]
            if len(recent) >= TRIES:
                raise ValueError(f"Too many wrong passwords: try again in {int(TRIES_S - (now - recent[0])) // 60 + 1} min")
            if not stored:
                raise ValueError("No owner password is set yet: set one at the machine with `sudo cloudwall owner`")
            self.failures = {a: t for a, t in self.failures.items() if t and now - t[-1] < TRIES_S}
            self.failures[address] = recent + [now]
        if not password_matches(password or "", stored):
            raise ValueError("That isn't the owner's password")
        with self.trying:
            self.failures.pop(address, None)
        token = secrets.token_urlsafe(32)
        self._keep(self._hash(token), now)
        return token

    def _keep(self, h, now):
        self.sessions[h] = now
        if self.store is not None:
            self.store.cache_put("owner-session", h, now)

    def valid(self, token):
        if not token:
            return False
        h, now = self._hash(token), self.clock()
        last = self.sessions.get(h)
        if last is None and self.store is not None:
            found, last = self.store.cache_get("owner-session", h, SESSION_S)
            last = last if found else None
        if last is None or now - last > SESSION_S:
            return False
        if now - last > 3600:                      # in use: extended, written at most hourly
            self._keep(h, now)
        return True

    def sign_out(self, token):
        if token:
            h = self._hash(token)
            self.sessions.pop(h, None)
            if self.store is not None:
                self.store.cache_put("owner-session", h, 0)

    # -- who is asking --
    def role(self, cookies, address, proxied=False):
        """"owner" or "viewer". With no owner password set, a request from this machine itself is
        the owner's; one through a proxy (Caddy, also on this machine) never counts as local."""
        if self.exists():
            return "owner" if self.valid(cookies.get(COOKIE)) else "viewer"
        return "owner" if is_local(address) and not proxied else "viewer"

    def host_ok(self, host, proxied=False):
        """Is this a name CloudWall answers to? Guards the control board against DNS rebinding: a
        page elsewhere calling CloudWall under the attacker's name sends no cookie, but a local
        request counts as the owner's while there is no owner. Proxied requests never count as
        local and need the cookie, which the browser keeps for the real name only: any name will do."""
        if proxied:
            return True
        name = (host or "").rsplit(":", 1)[0].strip("[]").lower()
        if not name:
            return False
        try:
            ipaddress.ip_address(name)
            return True                            # an address: a rebinding attack needs a name
        except ValueError:
            pass
        known = {"localhost", socket.gethostname().lower(), socket.getfqdn().lower(),
                 (self.cfg["server"].get("address") or "").lower()}
        return name in known or name.endswith(".local") or name.endswith(".localhost")


def is_local(address):
    try:
        return ipaddress.ip_address((address or "").split("%")[0]).is_loopback
    except ValueError:
        return False


def cookies_of(header):
    out = {}
    for part in (header or "").split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            out[k] = v
    return out


def cookie_header(token, secure, clear=False):
    attrs = ["Path=/", "HttpOnly", "SameSite=Strict"] + (["Secure"] if secure else [])
    if clear:
        return f"{COOKIE}=; Max-Age=0; " + "; ".join(attrs)
    return f"{COOKIE}={token}; Max-Age={SESSION_S}; " + "; ".join(attrs)
