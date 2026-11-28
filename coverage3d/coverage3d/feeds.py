"""Live data sources: read readsb's JSON files over HTTP (tar1090) or straight from disk."""
from __future__ import annotations

import json
import logging
import urllib.request

log = logging.getLogger("coverage3d.feeds")


def _sibling(location: str, name: str) -> str:
    """The file `name` next to aircraft.json (URL or path)."""
    return location.rsplit("/", 1)[0] + "/" + name


class ReadsbFeed:
    """One readsb instance. Tries each URL, then each file, and uses the first that works."""

    def __init__(self, name, band, urls, files, timeout=4.0):
        self.name, self.band, self.timeout = name, band, timeout
        self.locations = list(urls) + list(files)
        self.working: str | None = None          # last location that answered

    def _read(self, location: str):
        if location.startswith(("http://", "https://")):
            req = urllib.request.Request(location, headers={"User-Agent": "coverage3d"})
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())
        with open(location, "rb") as f:
            return json.loads(f.read())

    def _get(self, filename: str):
        order = ([self.working] if self.working else []) + [x for x in self.locations if x != self.working]
        err = None
        for loc in order:
            target = loc if filename == "aircraft.json" else _sibling(loc, filename)
            try:
                data = self._read(target)
                if filename == "aircraft.json":
                    if self.working != loc:
                        log.info("[%s] reading %s", self.name, loc)
                    self.working = loc
                return data
            except Exception as e:                 # try the next one
                err = e
        raise OSError(f"no live source answered for {filename} ({err})")

    def aircraft(self) -> dict:
        return self._get("aircraft.json")

    def receiver(self):
        return self._get("receiver.json")

    def stats(self):
        return self._get("stats.json")

    def outline(self):
        return self._get("outline.json")
