"""Every tile layer by name, each cached on disk and served at /tiles/<layer>/z/x/y: the FAA
charts (public-domain ArcGIS tiles, Web Mercator), the Map view's sat/places/roads/streets
around home, and "world" (the flight card's route map, zooms 0 to 6, anywhere).
"""
from .tiles import STYLES, Tiles

FAA = ("https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"
       "{service}/MapServer/tile/{{z}}/{{y}}/{{x}}")
FAA_CREDIT = "Charts © FAA Aeronautical Information Services"

# zooms: the levels with chart on them (IFR Low's 12 is blank outside the IFR Area charts)
FAA_LAYERS = {
    "ifr-low": {"name": "IFR Enroute Low", "service": "IFR_AreaLow", "zooms": (7, 11)},
    "ifr-high": {"name": "IFR Enroute High", "service": "IFR_High", "zooms": (5, 9)},
    "sectional": {"name": "VFR Sectional", "service": "VFR_Sectional", "zooms": (8, 12)},
    "terminal": {"name": "VFR Terminal Area", "service": "VFR_Terminal", "zooms": (10, 12), "fallback": "sectional"},
}


class Charts:
    """The layers by name. "map" is [map] style (may name an FAA chart); atc is [map] atc, or None."""

    def __init__(self, cfg, cache_dir):
        m = cfg.get("map", {})
        self.layers = {}
        for lid, spec in FAA_LAYERS.items():
            self.layers[lid] = Tiles(cfg, cache_dir, layer={"id": lid, "url": FAA.format(service=spec["service"]),
                                                            "attribution": FAA_CREDIT, "zooms": spec["zooms"]})
        for lid, spec in FAA_LAYERS.items():
            if spec.get("fallback"):
                self.layers[lid].fallback = self.layers[spec["fallback"]]
        style = str(m.get("style") or "dark").lower()
        if style in FAA_LAYERS and not m.get("url"):
            self.map = self.layers[style]
            self.map.opacity = float(m.get("opacity", self.map.opacity))
        else:
            self.map = Tiles(cfg, cache_dir)
        self.layers["map"] = self.map
        atc = str(m.get("atc") or "off").lower()
        self.atc = self.layers.get(atc) if atc in FAA_LAYERS else None
        # dark, light and osm too: the control board shows each style as a picture to choose by
        for lid, style in (("sat", "satellite"), ("streets", "streets"), ("places", "places"), ("roads", "roads"),
                           ("dark", "dark"), ("light", "light"), ("osm", "osm")):
            url, credit = STYLES[style]
            self.layers[lid] = Tiles(cfg, cache_dir, layer={"id": style, "url": url, "attribution": credit, "zooms": (6, 17)})
        route = str(m.get("route") or "satellite").lower()
        if route in STYLES:
            url, credit = STYLES[route]
            self.layers["world"] = Tiles(cfg, cache_dir, layer={"id": route, "url": url, "attribution": credit,
                                                                "zooms": (0, 6), "anywhere": True})

    @property
    def homes(self):
        return self.map.homes

    @homes.setter
    def homes(self, homes):
        """Every place watched: tiles are served around each of them only."""
        for t in self.layers.values():
            t.homes = homes

    def get(self, layer, z, x, y):
        t = self.layers.get(layer)
        return t.get(z, x, y) if t else None

    def info(self):
        def one(lid, t):
            return dict(t.info(), layer=lid, name=FAA_LAYERS.get(t.style, {}).get("name", t.style))
        return {"map": one("map", self.map),
                "atc": one(self.atc.style, self.atc) if self.atc else None,
                "layers": {lid: one(lid, t) for lid, t in self.layers.items() if lid != "map"}}
