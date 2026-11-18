"""Every map CloudWall can draw under its displays: the radar's street map and the FAA's
aeronautical charts, in one place, each fetched once, cached on disk and served by CloudWall
at /tiles/<layer>/z/x/y.

The FAA charts are the Aeronautical Information Services' own tiled charts on ArcGIS Online
(US Government works, in the public domain), in Web Mercator like the street maps:

    ifr-low    IFR Enroute Low: airways, VORs, fixes, airspace (under the ATC radar)
    ifr-high   IFR Enroute High
    sectional  VFR Sectional
    terminal   VFR Terminal Area, where there is one (Portland has one); the Sectional elsewhere

A display asks for a layer by name, so a new use of a chart is a new layer here and a line in
the display, nothing else. [map] style picks the chart-style radar's map (a street map, or one
of these charts) and [map] atc the ATC-style radar's chart.
"""
from .tiles import Tiles

FAA = ("https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"
       "{service}/MapServer/tile/{{z}}/{{y}}/{{x}}")
FAA_CREDIT = "Charts © FAA Aeronautical Information Services"

# zooms: the levels with chart on them (checked over PDX: IFR Low's level 12 is blank outside
# the IFR Area charts, so it stops at 11; High stops at 9).
FAA_LAYERS = {
    "ifr-low": {"name": "IFR Enroute Low", "service": "IFR_AreaLow", "zooms": (7, 11)},
    "ifr-high": {"name": "IFR Enroute High", "service": "IFR_High", "zooms": (5, 9)},
    "sectional": {"name": "VFR Sectional", "service": "VFR_Sectional", "zooms": (8, 12)},
    "terminal": {"name": "VFR Terminal Area", "service": "VFR_Terminal", "zooms": (10, 12), "fallback": "sectional"},
}


class Charts:
    """The layers by name. "map" is the chart-style radar's map: [map] style, which may name an
    FAA chart; "atc" is the ATC-style radar's chart, [map] atc ("ifr-low" unless set, or "off")."""

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
        atc = str(m.get("atc", "ifr-low")).lower()
        self.atc = self.layers.get(atc) if atc in FAA_LAYERS else None

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
        """What the displays need: the radar's map, the ATC radar's chart, and every layer."""
        def one(lid, t):
            return dict(t.info(), layer=lid, name=FAA_LAYERS.get(t.style, {}).get("name", t.style))
        return {"map": one("map", self.map),
                "atc": one(self.atc.style, self.atc) if self.atc else None,
                "layers": {lid: one(lid, t) for lid, t in self.layers.items() if lid != "map"}}
