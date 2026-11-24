// The ground under the displays, for whichever of them draws on it: the map tiles around home, the
// hand-drawn map some airports have, and the airport's runways. The radar, the traffic heatmap and
// the wind rose all use these.
import { offset, clamp } from "./util.js";

const RAD = Math.PI / 180;

// The hand-drawn map for the airport, if it has one (maps/<icao>.json): rivers, place names and,
// for an airport the server's table doesn't cover, runways.
export let map = null;
export async function loadMap(icao) {
  try {
    const m = await (await fetch(`maps/${String(icao).toLowerCase()}.json`)).json();
    if (m && (m.water || m.runways)) map = m;
  } catch (e) { /* no map for this airport: the scope simply has no backdrop */ }
}

// ---- background map tiles (Web Mercator), served and cached by CloudWall at /tiles ----
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD;

// Tiles covering `radiusNm` around home, at a zoom that gives about one tile pixel per
// screen pixel, within the layer's zooms. Rectangles are in nm east (x) and north (y) of home.
// layer: a chart layer from state.charts ({layer, zooms}); the radar's map when left out.
export function tileLayout(home, radiusNm, screenPxPerNm, layer = null) {
  const [zmin, zmax] = layer && layer.zooms ? [Math.max(layer.zooms[0], 6), layer.zooms[1]] : [8, 15];
  const prefix = layer && layer.layer && layer.layer !== "map" ? `tiles/${layer.layer}` : "tiles";
  const z = clamp(Math.round(Math.log2((40075016.686 * Math.cos(home.lat * RAD) * screenPxPerNm) / (256 * 1852))), zmin, zmax);
  const dLat = radiusNm / 60, dLon = radiusNm / (60 * Math.cos(home.lat * RAD));
  const x0 = Math.floor(lon2x(home.lon - dLon, z)), x1 = Math.floor(lon2x(home.lon + dLon, z));
  const y0 = Math.floor(lat2y(home.lat + dLat, z)), y1 = Math.floor(lat2y(home.lat - dLat, z));
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const nw = offset(home, { lat: y2lat(y, z), lon: x2lon(x, z) }), se = offset(home, { lat: y2lat(y + 1, z), lon: x2lon(x + 1, z) });
    // the server serves tiles only within reach of home: one wholly beyond it isn't asked for
    // (it lies past the edge the display shows anyway, in the corners a square layout covers)
    const reach = layer && layer.reach_nm;
    if (reach && Math.hypot(Math.max(nw.x, 0, -se.x), Math.max(se.y, 0, -nw.y)) > reach + 0.1) continue;    // (a hair of margin: the server measures on the sphere)
    tiles.push({ url: `${prefix}/${z}/${x}/${y}`, x0: nw.x, y0: nw.y, x1: se.x, y1: se.y });
  }
  return { z, tiles };
}

// The airport's runways: from the server's runway table, or the hand-drawn map for an airport
// the table doesn't cover. Each is { name: "10R/28L", ends: [[lat, lon], [lat, lon]] }.
export function runwaysFor(state) {
  const r = state && state.airport && state.airport.runways;
  return r && r.length ? r : (map && map.runways) || [];
}
