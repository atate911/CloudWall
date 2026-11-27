"""Airline logos for the flight card, fetched on demand and cached on disk.

Logos are trademarks of their airlines, so none are shipped with CloudWall: each
is downloaded the first time that airline appears, by its two-letter IATA code
(airlines.py says which code an aircraft's logo goes by), and kept for a few months.
"""
import logging
import re
import threading
import time
import urllib.error
from pathlib import Path

from .http import fetch

log = logging.getLogger("cloudwall.logos")
MAX_AGE = 90 * 86400
MISSING_AGE = 7 * 86400
CODE = re.compile(r"^[A-Z0-9]{2}$")

class Logos:
    def __init__(self, cfg, cache_dir):
        c = cfg.get("logos", {})
        self.url = c.get("url") or "https://pics.avs.io/240/80/{iata}@2x.png"
        self.enabled = bool(c.get("enabled", True)) and bool(self.url)
        self.dir = Path(cache_dir)
        self.lock = threading.Lock()

    def get(self, code):
        """PNG bytes for an airline's logo, or None if there isn't one."""
        if not self.enabled or not CODE.match(code or ""):
            return None
        path, missing = self.dir / f"{code}.png", self.dir / f"{code}.missing"
        now = time.time()
        if missing.exists() and now - missing.stat().st_mtime < MISSING_AGE:
            return None
        if not (path.exists() and now - path.stat().st_mtime < MAX_AGE):
            try:
                data, _ = fetch(self.url.format(iata=code), timeout=10, max_bytes=1024 * 1024, retries=1)
                if not data.startswith(b"\x89PNG"):
                    raise ValueError("not a PNG")
                with self.lock:
                    self.dir.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(data)
                    tmp.replace(path)
                    missing.unlink(missing_ok=True)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.dir.mkdir(parents=True, exist_ok=True)
                    missing.touch()
                    return None
                log.warning("logo %s unavailable: %s", code, e)
            except Exception as e:
                log.warning("logo %s unavailable: %s", code, e)
        return path.read_bytes() if path.exists() else None

