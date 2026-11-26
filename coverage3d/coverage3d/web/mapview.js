// The 3D map: MapLibre basemap + terrain + native label/ring layers, and deck.gl data layers on top.
import { destination, bearingDeg, haversineNm, altColor, rssiColor, GROUND_COLOR, ringLabel, FT_M, radioHorizonNm, fmtAlt } from "./util.js";

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ESRI = (svc) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
const ESRI_ATTR = "Tiles © Esri — Source: Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors and the GIS User Community";
const OFM_ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

export const BASEMAPS = {
  liberty: { label: "Street – OpenFreeMap Liberty (default)", style: "https://tiles.openfreemap.org/styles/liberty", dark: false },
  bright: { label: "Street – OpenFreeMap Bright", style: "https://tiles.openfreemap.org/styles/bright", dark: false },
  positron: { label: "Light – OpenFreeMap Positron", style: "https://tiles.openfreemap.org/styles/positron", dark: false },
  topo: { label: "Topographic – Esri", raster: [ESRI("World_Topo_Map")], attribution: ESRI_ATTR, dark: false },
  street: { label: "Street – Esri World Street Map", raster: [ESRI("World_Street_Map")], attribution: ESRI_ATTR, dark: false },
  satellite: { label: "Satellite + labels – Esri", raster: [ESRI("World_Imagery")], labels: [ESRI("Reference/World_Boundaries_and_Places")], attribution: ESRI_ATTR, dark: true },
  dark: { label: "Dark + labels – Esri Dark Gray", raster: [ESRI("Canvas/World_Dark_Gray_Base")], labels: [ESRI("Canvas/World_Dark_Gray_Reference")], attribution: ESRI_ATTR, dark: true },
  offline: { label: "Offline – local tiles", raster: ["{origin}/tiles/{z}/{x}/{y}.png"], attribution: "Local tiles (adsb.im / OpenStreetMap)", offline: true, dark: false },
};

function rasterStyle(bm) {
  const sources = { base: { type: "raster", tiles: bm.raster.map((u) => u.replace("{origin}", location.origin)), tileSize: 256, maxzoom: 17, attribution: bm.attribution } };
  const layers = [{ id: "base", type: "raster", source: "base" }];
  if (bm.labels) {
    sources.labels = { type: "raster", tiles: bm.labels, tileSize: 256, maxzoom: 17 };
    layers.push({ id: "ref-labels", type: "raster", source: "labels" });   // place names stay on top of imagery
  }
  return { version: 8, glyphs: GLYPHS, sources, layers };
}

const EMPTY = { type: "FeatureCollection", features: [] };
const circle = (lat, lon, nm, n = 360) => Array.from({ length: n + 1 }, (_, i) => destination(lat, lon, (i * 360) / n, nm));
const FONT = ["Noto Sans Bold"];

export class MapView {
  constructor(containerId, handlers) {
    this.containerId = containerId;
    this.h = handlers;           // {onHover(lngLat), onClick(info), onCamera(cam), onError(msg)}
    this.map = null;
    this.overlay = null;
    this.orbiting = false;
    this.ready = false;
    this.state = null;           // last state given to update()
  }

  // ---- map creation (re-created whenever the basemap changes: the safest way to swap styles) ----
  create(basemapId, camera, station) {
    if (this.map) { this.stopOrbit(); this.map.remove(); }
    this.ready = false;
    const bm = BASEMAPS[basemapId] || BASEMAPS.liberty;
    this.basemap = bm;
    const map = (this.map = new maplibregl.Map({
      container: this.containerId,
      style: bm.style || rasterStyle(bm),
      center: camera?.center || [station.lon, station.lat],
      zoom: camera?.zoom ?? 7,
      pitch: camera?.pitch ?? 72,
      bearing: camera?.bearing ?? 0,
      maxPitch: 85,
      maxZoom: 16,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    }));
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "nautical" }), "bottom-left");
    if (window.deck) {
      try {
        this.overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
        map.addControl(this.overlay);
      } catch (e) { this.h.onError("3D overlay failed: " + e.message); }
    } else this.h.onError("deck.gl failed to load (no internet?): coverage layers unavailable");
    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (msg && !/tile|404|Failed to fetch|NetworkError|glyph/i.test(msg)) this.h.onError(msg);
    });
    this.probeFonts();
    map.on("mousemove", (e) => this.h.onHover(e.lngLat));
    map.on("click", (e) => this.h.onMapClick?.(e));
    map.on("moveend", () => this.h.onCamera(this.camera()));
    this.loaded = new Promise((res) => map.once("load", () => { this.setup(station); this.ready = true; res(); }));
    return this.loaded;
  }

  /** Text labels (rings, airports, station) need the OpenFreeMap glyph files: tell the user if they are unreachable. */
  probeFonts() {
    if (MapView.fontsChecked) return;
    MapView.fontsChecked = true;
    fetch(GLYPHS.replace("{fontstack}", "Noto%20Sans%20Bold").replace("{range}", "0-255")).then((r) => { if (!r.ok) throw new Error(r.status); })
      .catch(() => this.h.onError("Label fonts could not be loaded (needs internet): ring, airport and station labels will be hidden."));
  }

  camera() {
    const m = this.map, c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
  }

  firstSymbolId() {
    if (this.map.getLayer("ref-labels")) return "ref-labels";
    return this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  }

  // ---- static layers: terrain, hillshade, rings, labels, reference places -------------------------
  setup(station) {
    const map = this.map;
    const before = (this.beforeId = this.firstSymbolId());
    map.addSource("dem", { type: "raster-dem", tiles: [TERRARIUM], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen/AWS Terrain Tiles" });
    map.addSource("dem-hs", { type: "raster-dem", tiles: [TERRARIUM], encoding: "terrarium", tileSize: 256, maxzoom: 15 });
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs",
      paint: { "hillshade-exaggeration": this.basemap.dark ? 0.25 : 0.4, "hillshade-shadow-color": "#3a3a3a", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#555" } }, before);
    for (const id of ["bands", "rings", "bearings", "footprints", "footprints-b", "ringlabels", "bearlabels", "station", "airports", "peaks", "outline-ref"]) map.addSource(id, { type: "geojson", data: EMPTY });

    // distance-band shading between rings (very light, alternating)
    map.addLayer({ id: "bands-fill", type: "fill", source: "bands", paint: { "fill-color": "#ffffff", "fill-opacity": 0.07 } }, before);
    // rings: dark casing + amber line so they read on light, dark and satellite maps; minor rings lighter
    map.addLayer({ id: "rings-casing", type: "line", source: "rings", paint: { "line-color": "#000", "line-opacity": ["case", ["get", "major"], 0.45, 0.2], "line-width": ["case", ["get", "major"], 3.2, 2] } }, before);
    map.addLayer({ id: "rings-line", type: "line", source: "rings", paint: { "line-color": "#ffc83d", "line-opacity": ["case", ["get", "major"], 0.95, 0.55], "line-width": ["case", ["get", "major"], 1.4, 0.8] } }, before);
    map.addLayer({ id: "bearings-line", type: "line", source: "bearings", paint: { "line-color": "#ffc83d", "line-opacity": 0.5, "line-width": 0.8, "line-dasharray": [3, 3] } }, before);
    map.addLayer({ id: "footprints-line", type: "line", source: "footprints", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.95 } }, before);
    map.addLayer({ id: "footprints-b-line", type: "line", source: "footprints-b", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.95 } }, before);
    map.addLayer({ id: "outline-ref-line", type: "line", source: "outline-ref", paint: { "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.8, "line-dasharray": [1, 2] } }, before);

    // labels: drawn last (above the basemap's own labels) and kept upright with viewport alignment
    const text = (extra = {}, paint = {}) => ({
      layout: { "text-font": FONT, "text-size": 12, "text-pitch-alignment": "viewport", "text-rotation-alignment": "viewport", "text-max-width": 20, ...extra },
      paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.6, ...paint },
    });
    map.addLayer({ id: "ringlabels-sym", type: "symbol", source: "ringlabels",
      ...text({ "text-field": ["get", "label"], "text-allow-overlap": true, "text-size": 11.5 }, { "text-color": "#ffd666" }) });
    map.addLayer({ id: "bearlabels-sym", type: "symbol", source: "bearlabels",
      ...text({ "text-field": ["get", "label"], "text-allow-overlap": true, "text-size": 13 }, { "text-color": "#ffe9a8" }) });
    map.addLayer({ id: "peaks-dot", type: "circle", source: "peaks", paint: { "circle-radius": 4, "circle-color": "#8d5a3b", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 } });
    map.addLayer({ id: "peaks-sym", type: "symbol", source: "peaks",
      ...text({ "text-field": ["get", "label"], "text-anchor": "top", "text-offset": [0, 0.7], "text-size": 11.5, "symbol-sort-key": ["get", "elev"] }, { "text-color": "#f2d9c4" }) });
    map.addLayer({ id: "airports-dot", type: "circle", source: "airports", paint: { "circle-radius": ["case", ["get", "pinned"], 4.5, 3.2], "circle-color": "#2b8cff", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 } });
    for (const [id, pinned] of [["airports-other", false], ["airports-sym", true]])   // pinned airports are never hidden by collisions
      map.addLayer({ id, type: "symbol", source: "airports", filter: ["==", ["get", "pinned"], pinned],
        ...text({ "text-field": ["get", "code"], "text-anchor": "left", "text-offset": [0.7, 0], "text-size": 12.5, "text-allow-overlap": pinned, "symbol-sort-key": ["get", "rank"] }, { "text-color": "#bfe0ff" }) });
    map.addLayer({ id: "station-dot", type: "circle", source: "station", paint: { "circle-radius": 6, "circle-color": "#ff3b6b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "station-sym", type: "symbol", source: "station",
      ...text({ "text-field": ["get", "label"], "text-anchor": "bottom", "text-offset": [0, -0.9], "text-allow-overlap": true, "text-size": 13.5 }, { "text-color": "#ffb3c6" }) });

    this.applyTerrain();
    if (this.state) this.update(this.state, true);
  }

  applyTerrain() {
    const on = this.state ? this.state.settings.terrain : true;
    this.terrainOn = on;
    try {
      this.map.setTerrain(on ? { source: "dem", exaggeration: 1 } : null);
      this.map.setLayoutProperty("hillshade", "visibility", on ? "visible" : "none");
    } catch (e) { /* terrain tiles unavailable offline */ }
  }

  // ---- data updates -----------------------------------------------------------------------------
  /** Push the whole UI state to the map. `statics` re-derives the GeoJSON layers (rings, labels...). */
  update(state, statics = false) {
    this.state = state;
    if (!this.ready) return;
    const s = state.settings;
    if (statics) this.updateStatics(state);
    if (this.terrainOn !== s.terrain) this.applyTerrain();
    const vis = (id, on) => this.map.getLayer(id) && this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("rings-casing", s.rings); vis("rings-line", s.rings); vis("ringlabels-sym", s.rings);
    vis("bearings-line", s.bearings); vis("bearlabels-sym", s.bearings);
    vis("bands-fill", s.shadeBands);
    vis("footprints-line", s.footprint); vis("footprints-b-line", s.footprint && state.covB);
    vis("airports-dot", s.airports); vis("airports-sym", s.airports); vis("airports-other", s.airports);
    vis("peaks-dot", s.peaks); vis("peaks-sym", s.peaks);
    vis("outline-ref-line", false);      // the readsb outline is drawn in 3D by deck instead
    this.updateDeck(state);
  }

  updateStatics(state) {
    const { station, settings: s, maxR, ref, cov, covB } = state;
    const set = (id, features) => this.map.getSource(id)?.setData({ type: "FeatureCollection", features });
    const { lat, lon } = station;
    const rings = [], ringlabels = [], bands = [];
    if (s.minorRings) for (let r = 10; r < 50; r += 10) rings.push({ type: "Feature", properties: { nm: r, major: false }, geometry: { type: "LineString", coordinates: circle(lat, lon, r) } });
    for (let r = 50; r <= maxR; r += 50) {
      rings.push({ type: "Feature", properties: { nm: r, major: true }, geometry: { type: "LineString", coordinates: circle(lat, lon, r, 480) } });
      for (const b of [0, 90, 180, 270]) ringlabels.push({ type: "Feature", properties: { label: ringLabel(r, s.units) }, geometry: { type: "Point", coordinates: destination(lat, lon, b, r) } });
      if ((r / 50) % 2 === 1) bands.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(lat, lon, r, 240), circle(lat, lon, r - 50, 240).reverse()] } });
    }
    if (s.minorRings) for (let r = 10; r < 50; r += 10) ringlabels.push({ type: "Feature", properties: { label: `${r}` }, geometry: { type: "Point", coordinates: destination(lat, lon, 45, r) } });
    set("rings", rings); set("ringlabels", ringlabels); set("bands", bands);
    // bearing lines every 30 degrees, labelled N, 030, 060, E ...
    const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
    const bl = [], bt = [];
    for (let b = 0; b < 360; b += 30) {
      bl.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[lon, lat], destination(lat, lon, b, maxR)] } });
      bt.push({ type: "Feature", properties: { label: names[b] ?? String(b).padStart(3, "0") }, geometry: { type: "Point", coordinates: destination(lat, lon, b, maxR + 6) } });
    }
    set("bearings", bl); set("bearlabels", bt);
    set("station", [{ type: "Feature", properties: { label: `Station · antenna ${Math.round(station.antenna_asl_ft)} ft MSL` }, geometry: { type: "Point", coordinates: [lon, lat] } }]);
    if (ref) {
      const pinned = new Set(["PDX", "VUO", "HIO", "TTD", "SPB", "SLE", "EUG", "SEA", "BFI", "PAE", "YKM", "RDM"]);
      set("airports", ref.airports.map((a) => ({ type: "Feature", properties: { code: a.code, name: a.name, rank: a.rank, pinned: pinned.has(a.code) }, geometry: { type: "Point", coordinates: [a.lon, a.lat] } })));
      set("peaks", ref.peaks.map((p) => ({ type: "Feature", properties: { label: `${p.name} · ${p.elev_ft.toLocaleString()} ft`, elev: -p.elev_ft }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })));
    }
    // ground footprints of each altitude band, coloured like the 3D layers
    const fp = (c, visible) => (c ? c.bands.filter((b) => visible(b) && b.sectors.length > 2).map((b) => ({ type: "Feature", properties: { color: this.bandCss(b, c) }, geometry: { type: "LineString", coordinates: this.ring(b, c, state.station).map((p) => [p[0], p[1]]) } })) : []);
    set("footprints", fp(cov, (b) => state.isVisible(b)));
    set("footprints-b", fp(covB, (b) => state.isVisible(b)));
  }

  bandCss(b, cov) {
    const c = b.ground ? GROUND_COLOR : altColor((b.lo_ft + b.hi_ft) / 2);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  /** Distance per sector. With "smooth" on: one- or two-sector gaps are bridged from their neighbours and a
   *  light 1-2-1 average across neighbouring sectors removes spikes caused by thin data (clicks still show raw numbers). */
  dists(band, cov) {
    const n = cov.n_sectors, raw = new Array(n).fill(0);
    for (const s of band.sectors) raw[s.s] = s.dist_nm;
    if (!this.state?.settings.smooth) return raw;
    const at = (a, i) => a[((i % n) + n) % n], filled = raw.slice();
    for (let i = 0; i < n; i++) {
      if (raw[i] > 0) continue;
      for (const w of [1, 2]) { const l = at(raw, i - 1), r = at(raw, i + w); if (l > 0 && r > 0) { filled[i] = l + (r - l) / (w + 1); break; } const l2 = at(raw, i - w), r2 = at(raw, i + 1); if (l2 > 0 && r2 > 0) { filled[i] = l2 + ((r2 - l2) * w) / (w + 1); break; } }
    }
    return filled.map((v, i) => { if (v <= 0) return 0; const l = at(filled, i - 1) || v, r = at(filled, i + 1) || v; return (l + 2 * v + r) / 4; });
  }

  /** Closed outline of a band: one vertex per sector (at its centre bearing) at the sector's distance. */
  ring(band, cov, station, z = 0) {
    const n = cov.n_sectors, step = cov.sector_deg, d = this.dists(band, cov);
    const pts = [];
    for (let i = 0; i < n; i++) {
      // no data in a sector = no coverage there (the outline pinches to the station)
      const [lo, la] = d[i] > 0 ? destination(station.lat, station.lon, (i + 0.5) * step, d[i]) : [station.lon, station.lat];
      pts.push([lo, la, z]);
    }
    pts.push(pts[0]);
    return pts;
  }

  // ---- deck.gl layers ---------------------------------------------------------------------------------
  updateDeck(state) {
    if (!this.overlay) return;
    const L = this.buildLayers(state);
    this.overlay.setProps({ layers: L });
  }

  buildLayers(st) {
    const s = st.settings, ex = s.exag, before = this.beforeId, layers = [];
    const common = { beforeId: before };
    const noDepthWrite = { parameters: { depthWriteEnabled: false } };
    const bandMid = (b) => ((b.lo_ft + b.hi_ft) / 2) * FT_M * ex;
    const alpha = Math.round(s.opacity * 255);
    const stn = st.station;
    const covBands = st.cov ? st.cov.bands.filter((b) => !b.ground && st.isVisible(b) && b.sectors.length > 2) : [];

    const cake = s.style === "cake";
    if (st.cov && s.fill && cake) {
      // "Upside-down wedding cake": every altitude band is a solid tier from its floor to its ceiling,
      // as wide as the coverage at that altitude. Higher tiers reach farther, so the cake widens upward.
      const lo = (b) => b.lo_ft * FT_M * ex, hi = (b) => b.hi_ft * FT_M * ex;
      const data = covBands.map((b) => ({ band: b, polygon: this.ring(b, st.cov, stn, lo(b)), h: hi(b) - lo(b), color: [...altColor((b.lo_ft + b.hi_ft) / 2), alpha] }));
      layers.push(new deck.SolidPolygonLayer({ id: "cov-cake", data, ...common, extruded: true, getPolygon: (d) => d.polygon, getElevation: (d) => d.h, getFillColor: (d) => d.color,
        material: { ambient: 0.55, diffuse: 0.6, shininess: 4, specularColor: [40, 40, 40] }, pickable: true, onClick: (i) => this.h.onClick({ kind: "band", ...i }),
        updateTriggers: { getFillColor: [alpha], getPolygon: [ex, s.smooth], getElevation: [ex] } }));
      // crisp rim on the top and bottom edge of every tier
      const rims = covBands.flatMap((b) => [{ path: this.ring(b, st.cov, stn, hi(b)), top: true }, { path: this.ring(b, st.cov, stn, lo(b)) }]);
      layers.push(new deck.PathLayer({ id: "cov-cake-rims", data: rims, ...common, getPath: (d) => d.path, getColor: (d) => (d.top ? [255, 255, 255, 230] : [20, 30, 45, 160]), widthUnits: "pixels", getWidth: (d) => (d.top ? 1.6 : 1), updateTriggers: { getPath: [ex, s.smooth] } }));
    }
    if (st.cov && s.fill && !cake) {
      const data = covBands.map((b) => ({ band: b, polygon: this.ring(b, st.cov, stn, bandMid(b)), color: [...altColor((b.lo_ft + b.hi_ft) / 2), alpha] }));
      layers.push(new deck.SolidPolygonLayer({ id: "cov-bands", data, ...common, ...noDepthWrite, getPolygon: (d) => d.polygon, getFillColor: (d) => d.color, pickable: true, onClick: (i) => this.h.onClick({ kind: "band", ...i }), updateTriggers: { getFillColor: [alpha], getPolygon: [ex, s.smooth] } }));
    }
    if (st.cov && s.walls && !cake) {
      const quads = [];
      for (let i = 0; i + 1 < covBands.length; i++) {
        const a = covBands[i], b = covBands[i + 1];
        if (b.index !== a.index + 1) continue;       // only join neighbouring bands
        const A = this.ring(a, st.cov, stn, bandMid(a)), B = this.ring(b, st.cov, stn, bandMid(b));
        const col = [...altColor(((a.hi_ft) )), Math.round(alpha * 0.8)];
        for (let k = 0; k < A.length - 1; k++) {
          if (A[k][0] === stn.lon && B[k][0] === stn.lon && A[k + 1][0] === stn.lon && B[k + 1][0] === stn.lon) continue;
          quads.push({ polygon: [A[k], A[k + 1], B[k + 1], B[k]], color: col });
        }
      }
      layers.push(new deck.SolidPolygonLayer({ id: "cov-walls", data: quads, ...common, ...noDepthWrite, _full3d: true, getPolygon: (d) => d.polygon, getFillColor: (d) => d.color, updateTriggers: { getFillColor: [alpha] } }));
    }
    if (st.cov && s.outlines) {
      const mk = (cov, id, dashed) => {
        const bs = cov.bands.filter((b) => !b.ground && st.isVisible(b) && b.sectors.length > 2);
        const data = bs.map((b) => ({ path: this.ring(b, cov, stn, cake ? b.hi_ft * FT_M * ex : bandMid(b)), color: [...altColor((b.lo_ft + b.hi_ft) / 2), 255] }));
        return new deck.PathLayer({ id, data, ...common, getPath: (d) => d.path, getColor: (d) => d.color, widthUnits: "pixels", getWidth: 2, pickable: false,
          ...(dashed ? { getDashArray: [4, 3], extensions: [new deck.PathStyleExtension({ dash: true })], dashJustified: true } : {}), updateTriggers: { getPath: [ex, s.smooth, cake] } });
      };
      if (!cake) layers.push(mk(st.cov, "cov-outlines", false));
      if (st.covB) layers.push(mk(st.covB, "cov-outlines-b", true));
    }
    if (st.cov && s.horizon) {
      const bs = st.cov.bands.filter((b) => !b.ground && st.isVisible(b));
      const data = bs.map((b) => {
        const z = bandMid(b), path = [];
        for (let i = 0; i <= 120; i++) { const [lo, la] = destination(stn.lat, stn.lon, i * 3, b.horizon_nm); path.push([lo, la, z]); }
        return { path };
      });
      layers.push(new deck.PathLayer({ id: "horizon", data, ...common, getPath: (d) => d.path, getColor: [255, 255, 255, 70], widthUnits: "pixels", getWidth: 1, updateTriggers: { getPath: [ex] } }));
    }
    if (st.outline && s.readsbOutline) {
      const pts = st.outline;
      const path = pts.map((p) => [p[1], p[0], p[2] * FT_M * ex]);
      path.push(path[0]);
      layers.push(new deck.PathLayer({ id: "readsb-outline", data: [{ path }], ...common, getPath: (d) => d.path, getColor: [255, 255, 255, 230], widthUnits: "pixels", getWidth: 2.5, updateTriggers: { getPath: [ex] } }));
    }
    if (st.points && s.points) {
      const P = st.points, n = P.n, idx = Array.from({ length: n }, (_, i) => i);
      layers.push(new deck.ScatterplotLayer({ id: "points", data: idx, ...common, ...noDepthWrite, getPosition: (i) => [P.lon[i], P.lat[i], P.alt[i] * FT_M * ex],
        getFillColor: (i) => [...(s.colorBy === "rssi" ? rssiColor(P.rssi[i]) : altColor(P.alt[i])), 190], radiusUnits: "pixels", getRadius: 1.6, pickable: true,
        onClick: (info) => this.h.onClick({ kind: "point", index: info.object, ...info }), updateTriggers: { getPosition: [ex, n], getFillColor: [s.colorBy, n] } }));
    }
    if (st.live && s.live) {
      const A = st.live.filter((a) => a.lat != null && a.lon != null);
      const alt = (a) => (a.alt_geom ?? (typeof a.alt_baro === "number" ? a.alt_baro : 0)) * FT_M * ex;
      layers.push(new deck.LineLayer({ id: "live-stems", data: A, ...common, getSourcePosition: (a) => [a.lon, a.lat, 0], getTargetPosition: (a) => [a.lon, a.lat, alt(a)], getColor: [255, 255, 255, 70], getWidth: 1, widthUnits: "pixels", updateTriggers: { getTargetPosition: [ex] } }));
      layers.push(new deck.ScatterplotLayer({ id: "live-ac", data: A, ...common, getPosition: (a) => [a.lon, a.lat, alt(a)], getFillColor: (a) => [...altColor(a.alt_geom ?? (typeof a.alt_baro === "number" ? a.alt_baro : 0)), 255], getLineColor: [255, 255, 255, 255], stroked: true, lineWidthUnits: "pixels", getLineWidth: 1.2,
        radiusUnits: "pixels", getRadius: 5, pickable: true, onClick: (i) => this.h.onClick({ kind: "live", ...i }), updateTriggers: { getPosition: [ex] } }));
      if (s.liveLabels) layers.push(new deck.TextLayer({ id: "live-labels", data: A, ...common, getPosition: (a) => [a.lon, a.lat, alt(a)], getText: (a) => a.flight || a.hex, getSize: 12, getColor: [255, 255, 255, 255], outlineWidth: 3, outlineColor: [0, 0, 0, 220], fontSettings: { sdf: true }, getTextAnchor: "start", getPixelOffset: [9, 0], billboard: true, updateTriggers: { getPosition: [ex] } }));
    }
    // antenna: a vertical line for the antenna height, and a faint axis up through the stack
    const antM = Math.max(stn.antenna_height_m, 0.5);
    layers.push(new deck.PathLayer({ id: "station-axis", data: [{ p: [[stn.lon, stn.lat, 0], [stn.lon, stn.lat, 45000 * FT_M * ex]] }], ...common, getPath: (d) => d.p, getColor: [255, 59, 107, 90], widthUnits: "pixels", getWidth: 1, updateTriggers: { getPath: [ex] } }));
    layers.push(new deck.PathLayer({ id: "station-antenna", data: [{ p: [[stn.lon, stn.lat, stn.ground_elevation_m], [stn.lon, stn.lat, stn.ground_elevation_m + antM + 30]] }], ...common, getPath: (d) => d.p, getColor: [255, 59, 107, 255], widthUnits: "pixels", getWidth: 4 }));
    return layers;
  }

  // ---- camera ---------------------------------------------------------------------------------------
  view2D() { this.stopOrbit(); this.map.easeTo({ pitch: 0, bearing: 0, duration: 800 }); }
  view3D() { this.stopOrbit(); this.map.easeTo({ pitch: 72, bearing: 0, duration: 800 }); }
  reset(station, nm = 200) {
    this.stopOrbit();
    const b = new maplibregl.LngLatBounds();
    for (const brg of [0, 90, 180, 270]) b.extend(destination(station.lat, station.lon, brg, nm));
    const cam = this.map.cameraForBounds(b, { padding: 30 });
    this.map.easeTo({ center: [station.lon, station.lat], zoom: (cam?.zoom ?? 6) - 0.2, pitch: 72, bearing: 0, duration: 900 });
  }
  toggleOrbit() {
    if (this.orbiting) return this.stopOrbit();
    this.orbiting = true;
    let last = performance.now();
    const step = (now) => {
      if (!this.orbiting) return;
      this.map.setBearing(this.map.getBearing() + ((now - last) / 1000) * 6);   // 6 degrees per second
      last = now;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return true;
  }
  stopOrbit() { this.orbiting = false; return false; }
}
