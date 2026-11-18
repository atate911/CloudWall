"""Background map tiles for the radar, fetched once and cached on disk.

The browser asks CloudWall for /tiles/z/x/y and CloudWall serves it from its own
cache, downloading from the map provider only when a tile is missing or a month
old. That keeps load on the free tile services tiny, lets the board survive short
internet outages, and means the display only ever talks to your own server.
"""
import hashlib
import logging
import math
import threading
import time
import urllib.request
from pathlib import Path

from .geo import haversine_nm
from .http import UA

log = logging.getLogger("cloudwall.tiles")
MAX_AGE = 30 * 86400
OSM = "© OpenStreetMap contributors"
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{{z}}/{{y}}/{{x}}"
STYLES = {
    # Esri's public basemaps: no key needed, attribution required. (CARTO's free
    # basemaps now return "API key required" placeholder tiles, so they're not offered.)
    "dark": (ESRI.format(service="Canvas/World_Dark_Gray_Base"), f"Tiles © Esri — Esri, HERE, Garmin, {OSM}"),
    "light": (ESRI.format(service="Canvas/World_Light_Gray_Base"), f"Tiles © Esri — Esri, HERE, Garmin, {OSM}"),
    "satellite": (ESRI.format(service="World_Imagery"), "Imagery © Esri, Maxar, Earthstar Geographics"),
    # OpenStreetMap's own tiles: fine for light personal use like this, with the cache
    "osm": ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", OSM),
}


def tile_center(z, x, y):
    n = 2 ** z
    lon = (x + 0.5) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n))))
    return lat, lon


class Tiles:
    def __init__(self, cfg, cache_dir):
        m = cfg.get("map", {})
        self.style = (m.get("style") or "dark").lower()
        url, attribution = STYLES.get(self.style, ("", ""))
        self.url = m.get("url") or url
        self.attribution = m.get("attribution") or attribution
        self.opacity = float(m.get("opacity", 0.32))
        self.enabled = self.style != "off" and bool(self.url)
        self.homes = [cfg["home"]]      # every place watched (set by the caller when there are several)
        # only serve the area around home, so the proxy can't be used to scrape a whole map
        self.reach_nm = max(40, cfg["tracking"]["radius_nm"] * 3)
        self.dir = Path(cache_dir) / hashlib.sha1(self.url.encode()).hexdigest()[:10]
        self.lock = threading.Lock()

    def look(self):
        """Which dimming the browser applies: maps differ in how dark they start out."""
        u = self.url.lower()
        if "cartocdn" in u:
            return "carto-light" if ("light" in u or "positron" in u or "voyager" in u) else "carto-dark"
        return self.style if self.style in STYLES else "custom"

    def info(self):
        return {"enabled": self.enabled, "style": self.look(), "attribution": self.attribution, "opacity": self.opacity}

    def allowed(self, z, x, y):
        if not (6 <= z <= 17 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            return False
        lat, lon = tile_center(z, x, y)
        return any(haversine_nm(h["lat"], h["lon"], lat, lon) <= self.reach_nm for h in self.homes)

    def _download(self, z, x, y):
        # Templates copied from map providers often carry {s} (server letter) and {r}
        # (retina suffix) as well as {z}/{x}/{y}; fill those in too.
        url = self.url.format_map({"z": z, "x": x, "y": y, "s": "a", "r": "", "-y": 2 ** z - 1 - y})
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read(), r.headers.get("Content-Type", "image/png")

    def get(self, z, x, y):
        """(bytes, content type) for a tile, or None if it is outside the area or unavailable."""
        if not self.enabled or not self.allowed(z, x, y):
            return None
        path = self.dir / str(z) / str(x) / f"{y}.tile"
        fresh = path.exists() and time.time() - path.stat().st_mtime < MAX_AGE
        if not fresh:
            try:
                data, ctype = self._download(z, x, y)
                with self.lock:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(ctype.encode()[:40].ljust(40) + data)
                    tmp.replace(path)
            except Exception as e:
                if not path.exists():
                    log.warning("tile %s/%s/%s unavailable: %s", z, x, y, e)
                    return None
                log.info("tile %s/%s/%s refresh failed, serving cached copy: %s", z, x, y, e)
        raw = path.read_bytes()
        return raw[40:], raw[:40].decode().strip() or "image/png"
