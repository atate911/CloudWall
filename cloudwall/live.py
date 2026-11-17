"""Shared plumbing for paid live-route providers: API key, daily cap, back-off."""
import logging
import os
import threading
import time
import urllib.error

from .http import get_json

log = logging.getLogger("cloudwall.live")
YEAR = 365 * 86400


class LiveProvider:
    name = ""            # config section and cache prefix
    label = ""           # shown in the UI
    env_key = ""
    default_limit = 30

    def __init__(self, cfg, store):
        c = cfg.get(self.name, {})
        self.key = os.environ.get(self.env_key) or c.get("api_key") or ""
        self.daily_limit = int(c.get("daily_limit", self.default_limit))
        self.mode = c.get("mode", "fallback")
        self.general_aviation = bool(c.get("general_aviation", False))
        self.store = store
        self.lock = threading.Lock()
        self.enabled = bool(self.key)
        self.blocked_until = 0
        self.problem = None

    def headers(self):
        raise NotImplementedError

    def route(self, callsign):
        raise NotImplementedError

    # -- budget ---------------------------------------------------------------
    def _day(self):
        return time.strftime("%Y-%m-%d")

    def used_today(self):
        return self.store.cache_get(f"{self.name}_usage", self._day(), 2 * 86400)[1] or 0

    def available(self):
        return (self.enabled and time.time() >= self.blocked_until
                and self.used_today() < self.daily_limit)

    def status(self):
        blocked = time.time() < self.blocked_until
        return {"name": self.name, "label": self.label, "enabled": self.enabled,
                "used_today": self.used_today() if self.enabled else 0,
                "daily_limit": self.daily_limit, "mode": self.mode,
                "problem": self.problem if blocked else None}

    def _count(self, n):
        self.store.cache_put(f"{self.name}_usage", self._day(), max(0, self.used_today() + n))

    def _call(self, url):
        """One billed request. Returns None without calling when over the cap or backing off."""
        with self.lock:
            if not self.available():
                return None
            self._count(1)   # count first: a request that reaches the provider is billed
        try:
            data = get_json(url, headers=self.headers())
            self.problem = None
            return data
        except urllib.error.HTTPError as e:
            if e.code in (401, 402, 403, 429):
                # rejected before any work was done: not billed, and no point hammering
                with self.lock:
                    self._count(-1)
                wait = 60 if e.code == 429 else 3600
                self.problem = {401: "API key rejected", 402: "out of credits", 403: "not allowed on this plan",
                                429: "rate limited"}[e.code]
                self.blocked_until = time.time() + wait
                log.error("%s: %s (HTTP %s); pausing lookups for %d min", self.label, self.problem,
                          e.code, wait // 60)
                return None
            raise
