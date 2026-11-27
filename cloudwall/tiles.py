"""Background map tiles for the radar, fetched once and cached on disk.

The browser asks CloudWall for /tiles/z/x/y and CloudWall serves it from its own
cache, downloading from the map provider only when a tile is missing or a month
old. That keeps load on the free tile services tiny, lets the board survive short
internet outages, and means the display only ever talks to your own server.
"""
import hashlib
import logging
import math
import os
import threading
import time
import urllib.error
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
    # for the Map view: a street map, and the labels and roads that go over the satellite imagery
    "streets": (ESRI.format(service="World_Street_Map"), f"Map © Esri — Esri, HERE, Garmin, USGS, {OSM}"),
    "places": (ESRI.format(service="Reference/World_Boundaries_and_Places"), "Labels © Esri, HERE, Garmin"),
    "roads": (ESRI.format(service="Reference/World_Transportation"), "Roads © Esri, HERE, Garmin"),
    # OpenStreetMap's own tiles: fine for light personal use like this, with the cache
    "osm": ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", OSM),
}


def sweep(root, max_bytes, now=None):
    """Keep the tile cache within bounds: tiles past twice their age (they would be fetched again
    anyway) and leftovers from interrupted writes go, then the oldest until the whole cache is
    under max_bytes. Returns (files removed, bytes kept)."""
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
    """Sweep the cache a minute after starting and then once a day, on a thread of its own."""
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
    """The north-west corner of a tile (x, y may be fractional: x + 0.5, y + 0.5 is its centre)."""
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))), x / n * 360 - 180


def tile_nearest(z, x, y, lat, lon):
    """The point of a tile nearest a place (near enough at these sizes: the place clamped into
    the tile's span of latitude and longitude)."""
    north, west = tile_corner(z, x, y)
    south, east = tile_corner(z, x + 1, y + 1)
    return min(max(lat, south), north), min(max(lon, west), east)


class Tiles:
    """One tiled map, cached on disk: the radar's street map from [map] by default, or a layer
    given as layer={id, url, attribution, zooms, opacity} (see charts.py). fallback is another
    Tiles to serve from where this one has no tile."""

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
        # a layer for the whole world (the flight card's route map) is served anywhere, but only at
        # its low zooms: zoom 6 and out is at most 5,461 tiles for the entire planet
        self.anywhere = bool((layer or {}).get("anywhere"))
        self.fallback = None
        self.enabled = self.style != "off" and bool(self.url)
        self.homes = [cfg["home"]]      # every place watched (set by the caller when there are several)
        # only serve the area around home, so the proxy can't be used to scrape a whole map: out
        # to the corners of the ATC radar's square at 30 nm (42 nm), or three tracking radii
        self.reach_nm = max(45, cfg["tracking"]["radius_nm"] * 3)
        self.dir = Path(cache_dir) / hashlib.sha1(self.url.encode()).hexdigest()[:10]
        self.lock = threading.Lock()

    def look(self):
        """Which dimming the browser applies: maps differ in how dark they start out."""
        u = self.url.lower()
        if "cartocdn" in u:
            return "carto-light" if ("light" in u or "positron" in u or "voyager" in u) else "carto-dark"
        return self.style if self.style in STYLES or self.is_layer else "custom"

    def info(self):
        # reach_nm: how far from home tiles are served (none for a layer served anywhere), so a
        # display doesn't ask for the ones it would be refused
        return {"enabled": self.enabled, "style": self.look(), "attribution": self.attribution, "opacity": self.opacity,
                "zooms": list(self.zooms), "reach_nm": None if self.anywhere else self.reach_nm}

    def allowed(self, z, x, y):
        if not (self.zooms[0] <= z <= self.zooms[1] and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            return False
        if self.anywhere:
            return True
        # any tile with part of it in reach: a square display's corners at the longest range
        # take tiles whose centres are well beyond it
        return any(haversine_nm(h["lat"], h["lon"], *tile_nearest(z, x, y, h["lat"], h["lon"])) <= self.reach_nm
                   for h in self.homes)

    def _download(self, z, x, y):
        # Templates copied from map providers often carry {s} (server letter) and {r}
        # (retina suffix) as well as {z}/{x}/{y}; fill those in too.
        url = self.url.format_map({"z": z, "x": x, "y": y, "s": "a", "r": "", "-y": 2 ** z - 1 - y})
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read(), r.headers.get("Content-Type", "image/png")

    def get(self, z, x, y):
        """(bytes, content type) for a tile, or None if it is outside the area or unavailable.
        Where this map has no tile, the fallback's is served."""
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
        if not fresh:
            try:
                data, ctype = self._download(z, x, y)
                with self.lock:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(ctype.encode()[:40].ljust(40) + data)
                    tmp.replace(path)
            except Exception as e:
                if isinstance(e, urllib.error.HTTPError) and e.code == 404 and not path.exists():
                    with self.lock:
                        missing.parent.mkdir(parents=True, exist_ok=True)
                        missing.touch()
                    return None
                if not path.exists():
                    log.warning("tile %s/%s/%s unavailable: %s", z, x, y, e)
                    return None
                log.info("tile %s/%s/%s refresh failed, serving cached copy: %s", z, x, y, e)
        raw = path.read_bytes()
        return raw[40:], raw[:40].decode().strip() or "image/png"
