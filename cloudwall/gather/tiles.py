"""Map tiles served from CloudWall's own disk cache, downloaded from the provider only when
missing or a month old; the display only ever talks to this server.
"""
import hashlib
import logging
import math
import os
import threading
import time
import urllib.error
from pathlib import Path

from ..core.geo import haversine_nm
from ..core.http import fetch

log = logging.getLogger("cloudwall.tiles")
MAX_AGE = 30 * 86400
RETRY_S = 300
OSM = "© OpenStreetMap contributors"
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{{z}}/{{y}}/{{x}}"
STYLES = {
    # Esri: no key, attribution required (CARTO's free basemaps now return "API key required" tiles)
    "dark": (ESRI.format(service="Canvas/World_Dark_Gray_Base"), f"Tiles © Esri — Esri, HERE, Garmin, {OSM}"),
    "light": (ESRI.format(service="Canvas/World_Light_Gray_Base"), f"Tiles © Esri — Esri, HERE, Garmin, {OSM}"),
    "satellite": (ESRI.format(service="World_Imagery"), "Imagery © Esri, Maxar, Earthstar Geographics"),
    # the Map view's; places and roads are transparent overlays for the satellite imagery
    "streets": (ESRI.format(service="World_Street_Map"), f"Map © Esri — Esri, HERE, Garmin, USGS, {OSM}"),
    "places": (ESRI.format(service="Reference/World_Boundaries_and_Places"), "Labels © Esri, HERE, Garmin"),
    "roads": (ESRI.format(service="Reference/World_Transportation"), "Roads © Esri, HERE, Garmin"),
    "osm": ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", OSM),
}


def sweep(root, max_bytes, now=None):
    """Remove tiles past twice MAX_AGE and .tmp leftovers, then the oldest until under max_bytes.
    Returns (files removed, bytes kept)."""
    now = now or time.time()
    files, removed = [], 0
    for dirpath, _, names in os.walk(root):
        for name in names:
            p = os.path.join(dirpath, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if name.endswith(".tmp") or now - st.st_mtime > 2 * MAX_AGE:
                try:
                    os.remove(p)
                    removed += 1
                except OSError:
                    pass
            else:
                files.append((st.st_mtime, st.st_size, p))
    total = sum(f[1] for f in files)
    if total > max_bytes:
        for _, size, p in sorted(files):
            try:
                os.remove(p)
            except OSError:
                continue
            removed += 1
            total -= size
            if total <= max_bytes * 0.9:        # a little under, so it isn't swept again tomorrow
                break
    for dirpath, dirs, names in os.walk(root, topdown=False):
        if dirpath != str(root) and not dirs and not names:
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
    return removed, total


def keep_tidy(root, max_mb, every_s=86400):
    """Sweep the cache a minute after starting and then daily, on its own thread."""
    def loop():
        time.sleep(60)
        while True:
            try:
                removed, kept = sweep(root, max_mb * 1e6)
                if removed:
                    log.info("tile cache: %d old files removed, %.0f MB kept", removed, kept / 1e6)
            except Exception as e:
                log.warning("tile cache sweep failed: %s", e)
            time.sleep(every_s)
    if max_mb and max_mb > 0:
        threading.Thread(target=loop, daemon=True, name="tile-sweep").start()


def tile_corner(z, x, y):
    """(lat, lon) of a tile's north-west corner; x, y may be fractional."""
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))), x / n * 360 - 180


def tile_nearest(z, x, y, lat, lon):
    """The point of a tile nearest a place (the place clamped into the tile's lat/lon span)."""
    north, west = tile_corner(z, x, y)
    south, east = tile_corner(z, x + 1, y + 1)
    return min(max(lat, south), north), min(max(lon, west), east)


class Tiles:
    """One tiled map, cached on disk: [map]'s by default, or layer={id, url, attribution, zooms,
    opacity, anywhere} (charts.py). fallback: another Tiles served where this one has no tile."""

    def __init__(self, cfg, cache_dir, layer=None):
        m = cfg.get("map", {})
        if layer:
            self.style, self.url, self.attribution = layer["id"], layer["url"], layer["attribution"]
            self.opacity = float(layer.get("opacity", 0.5))
        else:
            self.style = (m.get("style") or "dark").lower()
            url, attribution = STYLES.get(self.style, ("", ""))
            self.url = m.get("url") or url
            self.attribution = m.get("attribution") or attribution
            self.opacity = float(m.get("opacity", 0.45))
        self.zooms = tuple((layer or {}).get("zooms", (6, 17)))
        self.is_layer = bool(layer)
        # served anywhere, but only at its low zooms (zoom 6 and out is 5,461 tiles for the planet)
        self.anywhere = bool((layer or {}).get("anywhere"))
        self.fallback = None
        self.enabled = self.style != "off" and bool(self.url)
        self.homes = [cfg["home"]]      # every place watched (set by the caller)
        # only the area around home is served, so the proxy can't be used to scrape a whole map:
        # the corners of the ATC radar's square at 30 nm (42 nm), or three tracking radii
        self.reach_nm = max(45, cfg["tracking"]["radius_nm"] * 3)
        self.dir = Path(cache_dir) / hashlib.sha1(self.url.encode()).hexdigest()[:10]
        self.lock = threading.Lock()
        self.failed = {}          # (z, x, y) -> when its download last failed

    def look(self):
        """Which dimming the browser applies."""
        u = self.url.lower()
        if "cartocdn" in u:
            return "carto-light" if ("light" in u or "positron" in u or "voyager" in u) else "carto-dark"
        return self.style if self.style in STYLES or self.is_layer else "custom"

    def info(self):
        # reach_nm: how far from home tiles are served; None for a layer served anywhere
        return {"enabled": self.enabled, "style": self.look(), "attribution": self.attribution, "opacity": self.opacity,
                "zooms": list(self.zooms), "reach_nm": None if self.anywhere else self.reach_nm}

    def allowed(self, z, x, y):
        if not (self.zooms[0] <= z <= self.zooms[1] and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            return False
        if self.anywhere:
            return True
        # any tile with part of it in reach, not just its centre
        return any(haversine_nm(h["lat"], h["lon"], *tile_nearest(z, x, y, h["lat"], h["lon"])) <= self.reach_nm
                   for h in self.homes)

    def _download(self, z, x, y):
        # providers' templates often carry {s} (server letter) and {r} (retina suffix) too
        url = self.url.format_map({"z": z, "x": x, "y": y, "s": "a", "r": "", "-y": 2 ** z - 1 - y})
        data, ctype = fetch(url, timeout=10, max_bytes=4 * 1024 * 1024, retries=1)
        return data, ctype or "image/png"

    def get(self, z, x, y):
        """(bytes, content type) for a tile (the fallback's where this map has none), or None."""
        got = self._get(z, x, y)
        if got is None and self.fallback is not None:
            return self.fallback.get(z, x, y)
        return got

    def _get(self, z, x, y):
        if not self.enabled or not self.allowed(z, x, y):
            return None
        path = self.dir / str(z) / str(x) / f"{y}.tile"
        missing = path.with_suffix(".none")       # the provider has no tile here: don't ask again for a month
        if missing.exists() and time.time() - missing.stat().st_mtime < MAX_AGE:
            return None
        fresh = path.exists() and time.time() - path.stat().st_mtime < MAX_AGE
        # a failed tile waits RETRY_S: else, with the service down, every tile waits out a timeout
        if not fresh and time.time() - self.failed.get((z, x, y), 0) >= RETRY_S:
            try:
                data, ctype = self._download(z, x, y)
                with self.lock:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(ctype.encode()[:40].ljust(40) + data)
                    tmp.replace(path)
                self.failed.pop((z, x, y), None)
            except Exception as e:
                if len(self.failed) > 5000:
                    self.failed.clear()
                self.failed[(z, x, y)] = time.time()
                if isinstance(e, urllib.error.HTTPError) and e.code == 404 and not path.exists():
                    with self.lock:
                        missing.parent.mkdir(parents=True, exist_ok=True)
                        missing.touch()
                    return None
                if not path.exists():
                    log.warning("tile %s/%s/%s unavailable: %s", z, x, y, e)
                    return None
                log.info("tile %s/%s/%s refresh failed, serving cached copy: %s", z, x, y, e)
        if not path.exists():
            return None
        raw = path.read_bytes()
        return raw[40:], raw[:40].decode().strip() or "image/png"
