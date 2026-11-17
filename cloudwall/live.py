"""Shared plumbing for paid live-route providers: API key, budget, back-off."""
import calendar
import datetime as dt
import logging
import os
import threading
import time
import urllib.error

from .http import get_json

log = logging.getLogger("cloudwall.live")
YEAR = 365 * 86400
USAGE_KEEP = 70 * 86400      # per-day usage counts are kept long enough to cover a billing period


def billing_period(today, billing_day):
    """(first day, first day of the next period) for a plan that renews on `billing_day`."""
    def on(year, month):
        return dt.date(year, month, min(billing_day, calendar.monthrange(year, month)[1]))
    start = on(today.year, today.month)
    if start > today:
        y, m = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
        start = on(y, m)
    y, m = (start.year, start.month + 1) if start.month < 12 else (start.year + 1, 1)
    return start, on(y, m)


class LiveProvider:
    name = ""            # config section and cache prefix
    label = ""           # shown in the UI
    env_key = ""
    default_limit = 30

    def __init__(self, cfg, store):
        c = cfg.get(self.name, {})
        self.key = os.environ.get(self.env_key) or c.get("api_key") or ""
        # A monthly allowance (with a safety margin held back) is spread over the days left
        # in the billing period; daily_limit is an optional extra ceiling per day.
        self.monthly_limit = int(c.get("monthly_limit", 0) or 0)
        self.margin = min(0.9, max(0.0, float(c.get("safety_margin", 0.15))))
        self.billing_day = min(28, max(1, int(c.get("billing_day", 1) or 1)))
        self.daily_cap = int(c.get("daily_limit", 0) or 0) or (0 if self.monthly_limit else self.default_limit)
        self.mode = c.get("mode", "always")
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
    def _today(self):
        return dt.date.today()

    def _day(self, d=None):
        return (d or self._today()).isoformat()

    def _used(self, d):
        return self.store.cache_get(f"{self.name}_usage", self._day(d), USAGE_KEEP)[1] or 0

    def used_today(self):
        return self._used(self._today())

    def budget(self):
        """Where the money stands: today's allowance and the billing period's totals."""
        today = self._today()
        out = {"used_today": self.used_today(), "daily_limit": None, "period_used": None,
               "period_budget": None, "monthly_limit": self.monthly_limit or None, "resets": None}
        allowance = self.daily_cap or None
        if self.monthly_limit:
            start, end = billing_period(today, self.billing_day)
            before = sum(self._used(start + dt.timedelta(days=i)) for i in range((today - start).days))
            budget = int(self.monthly_limit * (1 - self.margin))
            days_left = (end - today).days                       # including today
            share = max(0, budget - before) // max(1, days_left)  # today's even share of what's left
            allowance = share if allowance is None else min(allowance, share)
            out.update(period_used=before + out["used_today"], period_budget=budget, resets=end.isoformat())
        out["daily_limit"] = allowance
        return out

    def available(self):
        if not self.enabled or time.time() < self.blocked_until:
            return False
        b = self.budget()
        if b["period_budget"] is not None and b["period_used"] >= b["period_budget"]:
            return False
        return b["daily_limit"] is None or b["used_today"] < b["daily_limit"]

    def status(self):
        blocked = time.time() < self.blocked_until
        b = self.budget() if self.enabled else {"used_today": 0, "daily_limit": self.daily_cap}
        return {"name": self.name, "label": self.label, "enabled": self.enabled, "mode": self.mode,
                "margin": self.margin, **b, "problem": self.problem if blocked else None}

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
