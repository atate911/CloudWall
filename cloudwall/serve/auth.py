"""The owner: the one person who may change CloudWall. Everyone else who can reach it (the home
network, a private link's holders) watches and sets up their own screen.

The owner's password is set at the machine (`sudo cloudwall owner`) and kept as a scrypt hash in
`owner` beside the settings file, readable by the service only. Signing in on the control board
gives the browser a session cookie (HttpOnly, SameSite=Strict, Secure behind HTTPS) that lasts 30
days from its last use and survives restarts (sessions are kept, hashed, in the shared store).
Five wrong passwords from one address in five minutes and that address waits.

Until an owner password exists, CloudWall behaves as it always has: anyone who can reach it may
add places, and the control board can be used to look but changes only from this machine itself
(a browser on it, or through an SSH tunnel), so a CloudWall that was never given an owner is no
more open than it was, and the board says how to set one.

The control board also refuses a request naming a host CloudWall doesn't answer to (a DNS
rebinding attack: a web page making the browser call CloudWall under another name).
"""
import hashlib
import ipaddress
import secrets
import socket
import time

from ..core.keys import owner_file, password_matches

COOKIE = "cloudwall_owner"
SESSION_S = 30 * 86400
TRIES, TRIES_S = 5, 300


class Owner:
    """Who a request comes from, for a server whose settings file is cfg["_path"]."""

    def __init__(self, cfg, store=None, clock=time.time):
        self.cfg, self.store, self.clock = cfg, store, clock
        self.file = owner_file(cfg.get("_path"))
        self.failures = {}          # address -> [times of wrong passwords]
        self.sessions = {}          # hashed token -> last used (with the store, kept across restarts too)

    def exists(self):
        return self.file.exists()

    def _stored(self):
        try:
            return self.file.read_text()
        except OSError:
            return None

    # -- sessions -----------------------------------------------------------------------
    @staticmethod
    def _hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def sign_in(self, password, address):
        """A session token, or raises ValueError with what to say."""
        now = self.clock()
        recent = [t for t in self.failures.get(address, []) if now - t < TRIES_S]
        if len(recent) >= TRIES:
            raise ValueError(f"Too many wrong passwords: try again in {int(TRIES_S - (now - recent[0])) // 60 + 1} min")
        stored = self._stored()
        if not stored:
            raise ValueError("No owner password is set yet: set one at the machine with `sudo cloudwall owner`")
        if not password_matches(password or "", stored):
            self.failures[address] = recent + [now]
            raise ValueError("That isn't the owner's password")
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
        if now - last > 3600:                      # in use: good for another 30 days (said at most hourly)
            self._keep(h, now)
        return True

    def sign_out(self, token):
        if token:
            h = self._hash(token)
            self.sessions.pop(h, None)
            if self.store is not None:
                self.store.cache_put("owner-session", h, 0)

    # -- who is asking --------------------------------------------------------------------
    def role(self, cookies, address, proxied=False):
        """"owner", or "viewer". With no owner password set, a request from this machine itself
        counts as the owner's, and every other is a viewer. One through a proxy (Caddy, on this
        machine too) is from wherever the proxy's visitor is, so never counts as local."""
        if self.exists():
            return "owner" if self.valid(cookies.get(COOKIE)) else "viewer"
        return "owner" if is_local(address) and not proxied else "viewer"

    def host_ok(self, host):
        """Is this a name CloudWall answers to? (Only for the control board: the screens are told
        nothing that matters to an attacker.)"""
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
