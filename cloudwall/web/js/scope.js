// The right-hand panel: a top-down radar scope, or a dome view of the sky.
//
// Drawn in two layers. The static layer (map, rings, the overhead aircraft's sky
// path) is rebuilt only when the data or mode changes. The aircraft layer is a set of
// persistent elements, one per aircraft, moved every animation frame: positions are
// dead-reckoned from the last report and eased toward each new one, so aircraft glide
// instead of hopping between updates.
import { esc, ident, projected, offset, azEl, clamp } from "./util.js";
import { sky } from "./sky.js";
import { moonPosition, moonPhase, moonGlyph } from "./astro.js";

const PLANE = "M0,-4 L1,-1 L4.2,1.2 L4.2,2 L1,1 L.8,3 L2,4 L2,4.6 L0,4 L-2,4.6 L-2,4 L-.8,3 L-1,1 L-4.2,2 L-4.2,1.2 L-1,-1 Z";
// Drawing options from the page: atc draws the radar like an air traffic control screen;
// tracks shows the selected aircraft's past track (all of it; its history dots in the ATC style;
// no other aircraft has one) and the one-minute lines; range is how far out the radar shows, in nm
// (the tracking radius, or longer).
let opt = { atc: false, tracks: true, range: 15 };
const RAD = Math.PI / 180;

// ---- the ATC style: a STARS display, the FAA's terminal radar, drawn to its conventions ----
// The display is a square, and its range is from the centre to the edge, as STARS sets it.
const SQ = 108;
const K = () => (opt.atc ? SQ : 100) / opt.range;          // drawing units per nm
const inView = (x, y) => (opt.atc ? Math.max(Math.abs(x), Math.abs(y)) <= SQ : Math.hypot(x, y) <= 100);
// A fused track's target: a filled circle, which STARS draws with eight sides at this size.
const OCTAGON = "M" + [...Array(8)].map((_, i) => {
  const t = (22.5 + 45 * i) * RAD;
  return `${(2.3 * Math.sin(t)).toFixed(2)},${(-2.3 * Math.cos(t)).toFixed(2)}`;
}).join("L") + "Z";
// Position symbols of tracks with no flight plan: * reporting altitude, + without.
const STAR_SYM = "M0,-1.9V1.9M-1.9,0H1.9M-1.35,-1.35L1.35,1.35M-1.35,1.35L1.35,-1.35";
const PLUS_SYM = "M0,-1.9V1.9M-1.9,0H1.9";
const HISTORY = 5, HISTORY_S = 4.5;          // history dots behind the selected target, this many seconds apart
// Special purpose codes: shown in red on the data block's top line and in the status area.
const SPC = { 7500: "HJ", 7600: "RF", 7700: "EM", 7777: "MI" };
const SPC_STATUS = { general: "7700", nordo: "7600", unlawful: "7500" };
const spcOf = (a) => SPC[a.squawk] || SPC[SPC_STATUS[a.emergency_status]] || "";
// Leader directions, clockwise from north. A data block left of its leader (south through
// north-west) is right-justified against it.
const DIRS = [...Array(8)].map((_, i) => ({ ux: Math.sin(i * 45 * RAD), uy: -Math.cos(i * 45 * RAD), right: i >= 4 }));
// The data blocks' timeshared fields follow a clock: phases 1, 2, 1, 3 for 2, 1, 2 and 1 seconds.
const clockPhase = (ms) => { const t = (ms / 1000) % 6; return t < 2 ? 1 : t < 3 ? 2 : t < 5 ? 1 : 3; };
const NS = "http://www.w3.org/2000/svg";
const CHAR_W = 3.35;                          // estimated label width per character, until a label can be measured
export let map = null;
let placeBoxes = [];        // where the place names sit, so aircraft labels can avoid them

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
    tiles.push({ url: `${prefix}/${z}/${x}/${y}`, x0: nw.x, y0: nw.y, x1: se.x, y1: se.y });
  }
  return { z, tiles };
}

// The selected aircraft's whole track is drawn in its colour, strongest near the ground and fading
// with height: these are the bands' lower edges in feet (0-2, 2-5, 5-10, 10-18, 18-28, 28+ thousand).
const BANDS = [2000, 5000, 10000, 18000, 28000];
const band = (ft) => { let i = 0; while (i < BANDS.length && ft >= BANDS[i]) i++; return i; };

// The path since it came in range, as runs of one band each: a segment takes the band of the
// point it ends at. Points are [lat, lon, altitude in hundreds of ft].
function pathRuns(home, path, k) {
  const p = path.map(([lat, lon, h]) => { const o = offset(home, { lat, lon }); return [(o.x * k).toFixed(1), (-o.y * k).toFixed(1), band(h * 100)]; });
  let s = "", run = [], cur = -1;
  for (let i = 1; i < p.length; i++) {
    if (p[i][2] !== cur) {
      if (run.length > 1) s += `<polyline class="b${cur}" points="${run.join(" ")}"/>`;
      run = [`${p[i - 1][0]},${p[i - 1][1]}`];
      cur = p[i][2];
    }
    run.push(`${p[i][0]},${p[i][1]}`);
  }
  if (run.length > 1) s += `<polyline class="b${cur}" points="${run.join(" ")}"/>`;
  return s;
}

// The key to the paths' shades, under the radar's legend; laid out once drawn (layoutPathKey),
// when its text can be measured.
const pathKey = (x, y) => `<g class="legend path-key" data-x="${x}"><text x="${x}" y="${y}">Track 0</text><g class="pk-sw">` +
  [...Array(BANDS.length + 1)].map((_, i) => `<line class="b${i}" x1="${i * 3.2}" y1="${y - 1.4}" x2="${i * 3.2 + 2.7}" y2="${y - 1.4}"/>`).join("") +
  `</g><text class="pk-end" y="${y}">28,000 ft</text></g>`;
function layoutPathKey(svg) {
  const k = svg.querySelector(".path-key");
  if (!k) return;
  let w = 0;
  try { w = k.querySelector("text").getComputedTextLength(); } catch (e) { /* hidden (the kiosk) */ }
  if (!w) return;
  const x = +k.dataset.x + w + 1.6, sw = (BANDS.length + 1) * 3.2;
  k.querySelector(".pk-sw").setAttribute("transform", `translate(${x.toFixed(2)},0)`);
  k.querySelector(".pk-end").setAttribute("x", (x + sw + 1.1).toFixed(2));
}

const pts = (home, line, k) => line.map(([lat, lon]) => { const o = offset(home, { lat, lon }); return `${(o.x * k).toFixed(1)},${(-o.y * k).toFixed(1)}`; }).join(" ");

// The FAA's charts, as maps: each prints its own towns, so the radar adds no names over them.
const CHART_STYLES = new Set(["sectional", "terminal", "ifr-low", "ifr-high"]);

function mapLayer(home, k, hasBasemap, charted = false) {
  if (!map) return "";
  let s = "";
  // the hand-drawn rivers are only a stand-in for when there's no real map underneath; the ATC
  // style draws them as thin lines, as a controller's video map shows coastlines and rivers
  if (opt.atc) for (const w of map.water || []) s += `<polyline class="vmap" points="${pts(home, w.line, k)}"/>`;
  else if (!hasBasemap) for (const w of map.water || []) s += `<polyline class="water" stroke-width="${Math.max(1.2, w.width_nm * k)}" points="${pts(home, w.line, k)}"/>`;
  if (opt.atc || charted) return s;             // a controller's map has no town names; a chart has its own
  for (const p of map.places || []) {
    const o = offset(home, { lat: p.at[0], lon: p.at[1] });
    if (Math.hypot(o.x, o.y) * k < 7) continue;   // the town you're in: the home reticle already marks it
    s += `<text class="place" x="${o.x * k}" y="${-o.y * k}" text-anchor="middle">${esc(p.name)}</text>`;
    const w = p.name.length * 3.1;
    placeBoxes.push({ x0: o.x * k - w / 2, x1: o.x * k + w / 2, y0: -o.y * k - 4.5, y1: -o.y * k + 1 });
  }
  return s;
}

// The airport's runways: from the server's runway table, or the hand-drawn map for an airport
// the table doesn't cover. Each is { name: "10R/28L", ends: [[lat, lon], [lat, lon]] }.
export function runwaysFor(state) {
  const r = state && state.airport && state.airport.runways;
  return r && r.length ? r : (map && map.runways) || [];
}

// Runways, and extended centrelines 12 nm out for the main direction (the longest runway and
// its parallels), so a crosswind runway doesn't draw approach lines across the scope.
function runwayLayer(state, k) {
  const home = state.home, rws = runwaysFor(state).map((r) => {
    const [a, b] = r.ends.map(([lat, lon]) => offset(home, { lat, lon }));
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { a, b, len, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
  });
  if (!rws.length) return "";
  const main = rws.reduce((m, r) => (r.len > m.len ? r : m)), far = 12;
  let s = "", ticks = "";
  // the ATC style's video map marks each final approach course every mile (every 5 when that's
  // too close together to read), as terminal video maps do
  const every = k >= 4 ? 1 : 5;
  for (const r of rws) {
    if (Math.abs(r.ux * main.ux + r.uy * main.uy) <= 0.985) continue;   // not within about 10° of the main direction
    s += `<line class="approach" x1="${(r.a.x - r.ux * far) * k}" y1="${-(r.a.y - r.uy * far) * k}" x2="${(r.b.x + r.ux * far) * k}" y2="${-(r.b.y + r.uy * far) * k}"/>`;
    if (!opt.atc) continue;
    for (let d = every; d <= 10; d += every) {
      for (const [p, sgn] of [[r.a, -1], [r.b, 1]]) {
        const x = (p.x + sgn * r.ux * d) * k, y = -(p.y + sgn * r.uy * d) * k, h = d % 5 ? 0.9 : 1.6;
        ticks += `M${(x - r.uy * h).toFixed(2)},${(y - r.ux * h).toFixed(2)}L${(x + r.uy * h).toFixed(2)},${(y + r.ux * h).toFixed(2)}`;
      }
    }
  }
  if (ticks) s += `<path class="approach-tick" d="${ticks}"/>`;
  for (const r of rws) s += `<line class="runway" x1="${r.a.x * k}" y1="${-r.a.y * k}" x2="${r.b.x * k}" y2="${-r.b.y * k}"/>`;
  return s;
}

// Ring labels sit on the north-east diagonal, clear of the N/E letters and of most traffic.
function ringLabel(r, text) {
  const d = r * Math.SQRT1_2;
  return `<text class="ring-label" x="${d + 1.5}" y="${-d - 1.5}">${text}</text>`;
}
// A bezel of degree marks just outside the edge, as on a compass card: every 5°, longer every
// 10° and 30°, with the bearing beside each 30° mark. The cardinal points are left to their letters.
const BEARING_BOXES = [];   // where the bearing numbers sit, so aircraft labels can avoid them
const BEZEL = (() => {
  const minor = [], major = [];
  let nums = "";
  for (let a = 5; a < 360; a += 5) {
    if (a % 90 === 0) continue;
    const r2 = a % 30 === 0 ? 104.5 : a % 10 === 0 ? 103 : 102, s = Math.sin(a * RAD), c = -Math.cos(a * RAD);
    (a % 30 === 0 ? major : minor).push(`M${(100.8 * s).toFixed(2)},${(100.8 * c).toFixed(2)}L${(r2 * s).toFixed(2)},${(r2 * c).toFixed(2)}`);
    if (a % 30 !== 0) continue;
    nums += `<text class="bearing" x="${(108.6 * s).toFixed(2)}" y="${(108.6 * c + 1.3).toFixed(2)}" text-anchor="middle">${String(a).padStart(3, "0")}</text>`;
    BEARING_BOXES.push({ x0: 108.6 * s - 5, x1: 108.6 * s + 5, y0: 108.6 * c - 2.5, y1: 108.6 * c + 2.5 });
  }
  return `<path class="bezel" d="${minor.join("")}"/><path class="bezel major" d="${major.join("")}"/>${nums}`;
})();
// Faint bearing lines every 30° between the innermost ring and the edge: with the rings, a polar grid.
const SPOKES = (r0) => {
  let d = "";
  for (let a = 0; a < 360; a += 30) {
    const s = Math.sin(a * RAD), c = -Math.cos(a * RAD);
    d += `M${(r0 * s).toFixed(2)},${(r0 * c).toFixed(2)}L${(100 * s).toFixed(2)},${(100 * c).toFixed(2)}`;
  }
  return `<path class="spoke" d="${d}"/>`;
};
// Home: a reticle, open in the middle so an aircraft right overhead stays visible.
const HOME = `<g class="home-mark"><circle r="1.9"/><path d="M0,-2.9V-5M0,2.9V5M-2.9,0H-5M2.9,0H5"/></g>`;
// A note in a lower corner of the drawing, clear of the disc: lines of text, the last line's
// baseline at y. Line spacing is in ems, so a larger font (the kiosk's) still ends at y.
const note = (cls, x, y, anchor, lines) => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">` +
  lines.map((l, i) => `<tspan x="${x}" dy="${i ? 1.25 : -1.25 * (lines.length - 1)}em">${esc(l)}</tspan>`).join("") + `</text>`;
const COMPASS = `${BEZEL}<text class="compass" x="0" y="-104" text-anchor="middle">N</text><text class="compass" x="106" y="2" text-anchor="middle">E</text>
  <text class="compass" x="0" y="110" text-anchor="middle">S</text><text class="compass" x="-106" y="2" text-anchor="middle">W</text>`;

// ---- geometry for each mode ----
const domeXY = (p) => { const r = ((90 - clamp(p.el, 0, 90)) / 90) * 100; return [r * Math.sin(p.az * RAD), -r * Math.cos(p.az * RAD)]; };
const skyPos = (home, a, t) => azEl(home, projected(a, t), (a.alt || 0) + ((a.vrate || 0) * t) / 60);

function place(state, a, t, mode) {
  if (mode === "sky") {
    const p = skyPos(state.home, a, t);
    if (p.el < 1) return null;
    const [x, y] = domeXY(p), [x2, y2] = domeXY(skyPos(state.home, a, t + 8));
    const rot = Math.hypot(x2 - x, y2 - y) > 0.01 ? Math.atan2(x2 - x, -(y2 - y)) / RAD : a.track || 0;
    return { x, y, rot, scale: 0.9 + clamp(p.el / 60, 0, 1) * 0.9, sub: `${Math.round(p.el)}° up`, el: p.el };
  }
  const k = K(), o = offset(state.home, projected(a, t));
  if (!inView(o.x * k, -o.y * k)) return null;
  // the altitude in hundreds of feet, as a controller's scope shows it, with an arrow when climbing or descending
  const v = a.vrate || 0, trend = v > 300 ? "↑" : v < -300 ? "↓" : "";
  return { x: o.x * k, y: -o.y * k, rot: a.track || 0, scale: 1, sub: a.alt == null ? "" : String(Math.max(0, Math.round(a.alt / 100))).padStart(3, "0") + trend };
}

// ---- the ATC style's fixed parts ----
// The compass along the display's edge: a tick every 5° where that bearing from the centre meets
// the edge, and the bearing every 10°.
const STARS_COMPASS = (() => {
  let d = "", nums = "";
  for (let a = 5; a <= 360; a += 5) {
    const s = Math.sin(a * RAD), c = -Math.cos(a * RAD), m = Math.max(Math.abs(s), Math.abs(c));
    const at = (inset) => [((SQ - inset) * s) / m, ((SQ - inset) * c) / m];
    const [x0, y0] = at(0), [x1, y1] = at(2.8);
    d += `M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`;
    if (a % 10) continue;
    const [x, y] = at(6.6);
    nums += `<text class="bearing" x="${x.toFixed(1)}" y="${(y + 1.2).toFixed(1)}" text-anchor="middle">${String(a).padStart(3, "0")}</text>`;
  }
  return `<path class="compass-tick" d="${d}"/>${nums}`;
})();

const pad2 = (n) => String(n).padStart(2, "0");
let ssaAltimeter = "";
// The status area's clock: UTC hours and minutes, then seconds, then the altimeter setting.
const ssaClock = (d = new Date()) => `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}/${pad2(d.getUTCSeconds())}${ssaAltimeter ? " " + ssaAltimeter : ""}`;

// The System Status Area, top left: the status indicator (a red triangle in a green box), the
// clock, the system status, the range and predicted track line length, the airport's altimeter
// (A: from the weather report), active special purpose codes in red, and general information:
// the runways in use and the wind.
function ssa(state) {
  const w = state.weather, f = state.flow, m = w && /\bA(\d\d)(\d\d)\b/.exec(w.raw || "");
  ssaAltimeter = m ? `${m[1]}.${m[2]}` : "";
  const wind = w && w.wind_kt != null ? `${w.wind_kt ? String(w.wind_dir ?? 0).padStart(3, "0") : "000"}/${pad2(w.wind_kt)}${w.gust_kt ? "G" + w.gust_kt : ""}` : "";
  const spc = [...new Set([...state.aircraft, ...(state.beyond || [])].map(spcOf).filter(Boolean))];
  // general information, a line each so the area stays narrow: the runways in use, the wind
  const gi = [f && "RWY " + f.runways.replace(/\s*\/\s*/g, " "), wind && "WIND " + wind].filter(Boolean);
  const rows = [[ssaClock(), "", "ssa-time"], ["OK/OK/NA"], [`${opt.range}NM PTL: ${opt.tracks ? "1.0" : "0.0"}`],
    ssaAltimeter && [`${state.airport.iata || state.airport.icao} ${ssaAltimeter}A`], spc.length && [spc.join(" "), "alert"], ...gi.map((t) => [t])].filter(Boolean);
  const x = -SQ + 13.5, y = -SQ + 20;
  // the indicator: a green box with a red triangle inside it, point down
  let s = `<g class="ssa-mark" transform="translate(${x + 2.2},${y - 8.5})"><path class="tri" d="M-1.7,-1.2H1.7L0,1.75Z"/><rect x="-2.2" y="-2.2" width="4.4" height="4.4"/></g>`;
  s += `<text class="ssa" x="${x}" y="${y}">` + rows.map(([t, cls, id], i) =>
    `<tspan x="${x}"${i ? ' dy="1.3em"' : ""}${cls ? ` class="${cls}"` : ""}${id ? ` id="${id}"` : ""}>${esc(t)}</tspan>`).join("") + `</text>`;
  // aircraft data blocks and the map's labels keep clear of it: monospaced at 4 px (the kiosk's
  // 5.4, a phone's 4.8), 0.6 em a character, 1.3 em a line
  const cl = document.documentElement.classList, fs = cl.contains("kiosk") ? 5.4 : cl.contains("phone") ? 4.8 : 4;
  placeBoxes.push({ x0: x - 1, x1: x + 1 + Math.max(...rows.map((r) => r[0].length)) * fs * 0.6,
    y0: y - 12, y1: y + (rows.length - 1) * fs * 1.3 + fs * 0.4 });
  return s;
}

// The video map's airspace: Class B and C (and the airport's own Class D) outlines, each area
// labelled with its ceiling over its floor in hundreds of feet ("40/17"; SFC from the surface),
// as charts and video maps mark them.
function airspaceLayer(state, k) {
  let s = "";
  for (const a of state.airport.airspace || []) {
    for (const ring of a.rings) s += `<polygon class="airspace ${a.class.toLowerCase()}" points="${pts(state.home, ring, k)}"/>`;
    const o = offset(state.home, { lat: a.label[0], lon: a.label[1] }), x = o.x * k, y = -o.y * k;
    const t = `${Math.round(a.ceiling / 100)}/${a.floor ? Math.round(a.floor / 100) : "SFC"}`;
    const box = { x0: x - t.length * 1.1, x1: x + t.length * 1.1, y0: y - 2, y1: y + 2 };
    if (Math.max(Math.abs(x), Math.abs(y)) > SQ - 12 || placeBoxes.some((b) => overlap(box, b))) continue;
    s += `<text class="airspace-label" x="${x.toFixed(1)}" y="${(y + 1.1).toFixed(1)}" text-anchor="middle">${t}</text>`;
    placeBoxes.push(box);
  }
  return s;
}

// VOR and TACAN stations: a small hexagon and the station's identifier, beside it on whichever
// side is clear of the status area and other labels (or left off when none is).
const HEXAGON = "M" + [...Array(6)].map((_, i) => `${(1.7 * Math.cos(i * 60 * RAD)).toFixed(2)},${(1.7 * Math.sin(i * 60 * RAD)).toFixed(2)}`).join("L") + "Z";
function navaidLayer(state, k) {
  let s = "";
  for (const n of state.airport.navaids || []) {
    const o = offset(state.home, n), x = o.x * k, y = -o.y * k;
    if (Math.max(Math.abs(x), Math.abs(y)) > SQ - 10) continue;
    s += `<g class="navaid" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><path d="${HEXAGON}"/><circle r=".35"/></g>`;
    const w = n.ident.length * 2.1;
    const spot = [[x + 2.8, y + 1.2, "start", x + 2.6, x + 3 + w], [x - 2.8, y + 1.2, "end", x - 3 - w, x - 2.6],
      [x, y + 5.4, "middle", x - w / 2, x + w / 2], [x, y - 2.6, "middle", x - w / 2, x + w / 2]]
      .map(([tx, ty, anchor, x0, x1]) => ({ tx, ty, anchor, box: { x0, x1, y0: ty - 2.6, y1: ty + 0.8 } }))
      .find((c) => !placeBoxes.some((b) => overlap(c.box, b)));
    if (spot) {
      s += `<text class="navaid-label" x="${spot.tx.toFixed(1)}" y="${spot.ty.toFixed(1)}" text-anchor="${spot.anchor}">${esc(n.ident)}</text>`;
      placeBoxes.push(spot.box);
    }
    placeBoxes.push({ x0: x - 2, x1: x + 2, y0: y - 2, y1: y + 2 });
  }
  return s;
}

function starsStatic(state) {
  const k = K();
  placeBoxes = [];
  const status = ssa(state);                   // first, so the map's labels keep clear of it
  let s = `<g clip-path="url(#scope-clip)">${mapLayer(state.home, k)}${airspaceLayer(state, k)}${runwayLayer(state, k)}${tfrLayer(state, k)}${fieldsLayer(state, k)}${navaidLayer(state, k)}`;
  // range rings every 5 nm out to the corners
  for (let r = 5; r * k < SQ * Math.SQRT2; r += 5) s += `<circle class="ring" r="${(r * k).toFixed(2)}"/>`;
  return s + `</g>${STARS_COMPASS}${status}${heardNote(state)}`;
}

// ---- static layer ----
function radarStatic(state) {
  if (opt.atc) return starsStatic(state);
  const R = opt.range, k = K(), home = state.home;
  placeBoxes = [];        // refilled below by the place names, flight restrictions and airfields
  // range rings every 5 nm, or every 10 beyond 20 nm
  const step = R <= 20 ? 5 : 10, rings = [];
  for (let r = step; r < R - 0.01; r += step) rings.push(r);
  rings.push(R);
  const bm = (state.charts && state.charts.map) || state.basemap, based = !!(bm && bm.enabled);
  let s = `<g clip-path="url(#scope-clip)">${mapLayer(home, k, based, based && CHART_STYLES.has(bm.style))}${runwayLayer(state, k)}${tfrLayer(state, k)}${fieldsLayer(state, k)}</g>`;
  s += SPOKES(rings[0] * k);
  for (const r of rings) s += `<circle class="ring" r="${r * k}"/>${ringLabel(r * k, Math.round(r) + " nm")}`;
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>${COMPASS}`;
  // the key, in the drawing's lower left corner, with the selected aircraft's track shades along its foot
  const keyed = opt.tracks && state.hero && state.hero.path && state.hero.path.length > 1;
  s += note("legend", -111, keyed ? 105.25 : 110.5, "start", [`${R} nm around home`, "035↑ 3,500 ft, climbing", opt.tracks ? "Line: 1 minute ahead" : ""].filter(Boolean));
  if (keyed) s += pathKey(-111, 110.5);
  const ap = offset(home, state.airport);
  if (Math.hypot(ap.x, ap.y) < R) s += `<text class="apt-label" x="${ap.x * k}" y="${-ap.y * k + 9}" text-anchor="middle">${esc(state.airport.iata)}</text>${runwaysFor(state).length ? "" : `<rect class="apt-mark" x="${ap.x * k - 2.5}" y="${-ap.y * k - 2.5}" width="5" height="5"/>`}`;
  for (const a of state.aircraft) {
    if (!a.on_ground) continue;
    const o = offset(home, a);
    if (Math.hypot(o.x, o.y) < R) s += `<circle class="blip gnd" cx="${o.x * k}" cy="${-o.y * k}" r="1.1"/>`;
  }
  return s + HOME + heardNote(state);
}

// Temporary flight restrictions: hatched while active, dashed outline when they start later.
function tfrLayer(state, k) {
  let s = "";
  for (const t of state.tfrs || []) {
    for (const ring of t.shapes || []) {
      const p = ring.map(([lat, lon]) => { const o = offset(state.home, { lat, lon }); return [o.x * k, -o.y * k]; });
      s += `<polygon class="tfr${t.active ? "" : " later"}" points="${p.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ")}"/>`;
      // label it where it's clear of place names: middle, else just inside the top or bottom edge
      const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cy = p.reduce((a, q) => a + q[1], 0) / p.length;
      const ys = p.map((q) => q[1]), spots = [cy + 2, Math.min(...ys) + 6, Math.max(...ys) - 2];
      const free = (y) => !placeBoxes.some((b) => cx + 5 > b.x0 && cx - 5 < b.x1 && y > b.y0 && y - 4.5 < b.y1);
      const y = spots.find(free) ?? spots[0];
      if (Math.hypot(cx, y) < 96) {
        s += `<text class="tfr-label" x="${cx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">TFR</text>`;
        placeBoxes.push({ x0: cx - 5, x1: cx + 5, y0: y - 4.5, y1: y + 1 });
      }
    }
  }
  return s;
}

// The small airfields nearby (Pearson Field, Grove Field, Troutdale around Vancouver), as a
// sectional chart shows them: a circle with the runways drawn inside at their true headings, not
// to scale, and the field's code. A field without runway data is the circle alone.
function fieldsLayer(state, k) {
  let s = "";
  for (const f of state.airport.others || []) {
    const o = offset(state.home, f), x = o.x * k, y = -o.y * k;
    if (Math.hypot(o.x, o.y) * k > 95) continue;
    s += `<g class="field-mark"><circle class="field" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`;
    for (const r of f.runways || []) {
      const [a, b] = r.ends.map(([lat, lon]) => offset(state.home, { lat, lon }));
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = ((b.x - a.x) / len) * 1.9, uy = ((b.y - a.y) / len) * 1.9;
      s += `<line class="field-rwy" x1="${(x - ux).toFixed(2)}" y1="${(y + uy).toFixed(2)}" x2="${(x + ux).toFixed(2)}" y2="${(y - uy).toFixed(2)}"/>`;
    }
    s += `</g><text class="field-label" x="${x.toFixed(1)}" y="${(y + 7.9).toFixed(1)}" text-anchor="middle">${esc(f.code)}</text>`;
    // aircraft labels steer around the airfield and its code, as they do around place names
    placeBoxes.push({ x0: o.x * k - 5, x1: o.x * k + 5, y0: -o.y * k - 2.5, y1: -o.y * k + 8.5 });
  }
  return s;
}

// Military jets heard with no position (e.g. F-16s with an older transponder).
function heardNote(state) {
  const h = state.heard || [];
  if (!h.length) return "";
  const by = {};
  for (const a of h) by[a.type || "?"] = (by[a.type || "?"] || 0) + 1;
  const what = Object.entries(by).map(([t, n]) => `${n > 1 ? n + " × " : ""}${/^[A-Z]{1,2}\d/.test(t) ? t.replace(/^([A-Z]+)(\d)/, "$1-$2") : t}`).join(", ");
  // the ATC style lists them inside the display's lower right corner
  return opt.atc ? note("heard-note", SQ - 10, SQ - 9, "end", ["No position:", what])
    : note("heard-note", 111, 110.5, "end", ["Heard nearby,", "no position:", what]);
}

function domeStatic(state, dt) {
  let s = `<circle class="dome-bg" r="100"/>${SPOKES(100 / 3)}`;
  for (const el of [30, 60]) { const r = ((90 - el) / 90) * 100; s += `<circle class="ring" r="${r}"/>${ringLabel(r, el + "°")}`; }
  s += note("legend", -111, 110.5, "start", ["Sky view from home", "Centre: straight up", "Edge: the horizon"]);
  s += `<circle class="ring horizon" r="100"/><line class="ring" x1="-4" y1="0" x2="4" y2="0"/><line class="ring" x1="0" y1="-4" x2="0" y2="4"/>${COMPASS}`;
  if (sky.sun.el > 0) { const [x, y] = domeXY(sky.sun); s += `<circle class="sun-glow" cx="${x}" cy="${y}" r="11"/><circle class="sun" cx="${x}" cy="${y}" r="4.5"/>`; }
  const moon = moonPosition(Date.now(), state.home.lat, state.home.lon);
  if (moon.el > 0) { const [x, y] = domeXY(moon), ph = moonPhase(Date.now()); s += `<g class="sky-moon" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${moonGlyph(4, ph.phase, ph.fraction)}</g>`; }
  const h = state.hero;
  if (h && !h.on_ground && h.alt != null) {
    // where it has been and where it is going across the sky
    const past = [], future = [];
    let best = null;
    for (let t = -180; t <= 360; t += 5) {
      const p = skyPos(state.home, h, dt + t);
      if (p.el < 0.5) continue;
      (t <= 0 ? past : future).push(domeXY(p).map((v) => v.toFixed(1)).join(","));
      if (!best || p.el > best.el) best = { ...p, t };
    }
    if (past.length && future.length) future.unshift(past[past.length - 1]);
    if (past.length > 1) s += `<polyline class="sky-path past" points="${past.join(" ")}"/>`;
    if (future.length > 1) s += `<polyline class="sky-path" points="${future.join(" ")}"/>`;
    if (best && best.t > 6) {
      const [x, y] = domeXY(best);
      // label inward, toward the centre, where the path isn't
      const d = Math.hypot(x, y) || 1, lx = x - (x / d) * 7, ly = y - (y / d) * 7 + 1.5;
      s += `<circle class="sky-peak" cx="${x}" cy="${y}" r="2.2"/><text class="peak-label" x="${lx}" y="${ly}" text-anchor="${x > 0 ? "end" : "start"}">highest ${Math.round(best.el)}°</text>`;
    }
  }
  return s + heardNote(state);
}

// ---- persistent aircraft elements ----
const live = new Map();     // hex -> { g, icon, pos, sym, vec, leader, hist, l0, tag, sub, trk, segs, tail, x, y, rot, slot, ... }
let lastFrame = 0, layerMode = null, staticKey = null, baseKey = null, lastSecond = -1;

// The map under the radar: the chart-style radar's map, or the ATC style's chart (the FAA's
// IFR Enroute Low unless [map] atc says otherwise), from the server's chart layers. Rebuilt only
// when the zoom or view changes, so it never flickers.
function drawBase(svg, state, mode) {
  const g = svg.querySelector("#s-base"), charts = state.charts || { map: state.basemap };
  const bm = opt.atc ? charts.atc : charts.map;
  const R = opt.range, k = K();
  const box = svg.getBoundingClientRect(), unitsPx = Math.min(box.width, box.height) / 224;
  const screenPxPerNm = unitsPx * k * (window.devicePixelRatio || 1);
  if (mode !== "radar" || !bm || !bm.enabled || !unitsPx) {
    if (baseKey !== "none") { g.innerHTML = ""; baseKey = "none"; }
    return;
  }
  const layout = tileLayout(state.home, R * 1.05, screenPxPerNm, bm);      // the ATC square reaches R east, west, north and south
  const key = `${layout.z}|${R}|${state.home.lat},${state.home.lon}|${bm.layer}|${bm.style}|${opt.atc}`;
  if (key === baseKey) return;
  baseKey = key;
  g.style.opacity = opt.atc ? "" : bm.opacity;          // the ATC chart's dimming is in the stylesheet
  g.setAttribute("class", `basemap ${bm.style}${opt.atc ? " atc-chart" : ""}`);
  g.innerHTML = layout.tiles.map((t) => `<image href="${t.url}" x="${(t.x0 * k).toFixed(2)}" y="${(-t.y0 * k).toFixed(2)}"
    width="${((t.x1 - t.x0) * k + 0.15).toFixed(2)}" height="${((t.y0 - t.y1) * k + 0.15).toFixed(2)}" preserveAspectRatio="none"/>`).join("");
}

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function ensureLayers(svg) {
  if (svg.querySelector("#s-static")) return;
  svg.innerHTML = "";
  const defs = el("defs", { id: "s-defs" }, svg);
  el("clipPath", { id: "scope-clip" }, defs);
  // diagonal hatching for active flight restrictions
  const hatch = el("pattern", { id: "tfr-hatch", width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 3, class: "tfr-hatch-line" }, hatch);
  el("g", { id: "s-bg" }, svg);
  el("g", { id: "s-base", "clip-path": "url(#scope-clip)" }, svg);
  for (const id of ["s-static", "s-trails", "s-craft"]) el("g", { id }, svg);
}

// The display's outline, which also clips the map: a disc, or the ATC style's square screen.
function setShape(svg) {
  const shape = opt.atc ? `<rect x="${-SQ}" y="${-SQ}" width="${2 * SQ}" height="${2 * SQ}"/>` : `<circle r="100"/>`;
  svg.querySelector("#scope-clip").innerHTML = shape;
  svg.querySelector("#s-bg").innerHTML = shape.replace(/^<(\w+)/, '<$1 class="scope-bg"');
}

function craftFor(svg, hex) {
  let c = live.get(hex);
  if (c) return c;
  const g = el("g", { "data-hex": hex, class: "craft entering" }, svg.querySelector("#s-craft"));
  el("circle", { r: 10, fill: "transparent" }, g);                    // generous touch target
  const vec = el("line", { class: "vec" }, g);                         // where it will be in a minute
  const leader = el("line", { class: "leader" }, g);                   // ATC style: target to data block
  const icon = el("path", { class: "blip", d: opt.atc ? OCTAGON : PLANE }, g);   // a change of style rebuilds every craft
  // ATC style: the position symbol on the target, a letter, or a drawn * or +
  const pos = el("text", { class: "pos", "text-anchor": "middle", dy: "0.36em" }, g), sym = el("path", { class: "sym" }, g);
  const hist = el("g", { class: "hist" }, svg.querySelector("#s-trails"));
  // hidden until placed: a dot without a position would sit on home
  for (let i = 0; i < HISTORY; i++) el("circle", { r: 1.05, class: `h${i}`, style: "display:none" }, hist);
  const l0 = el("text", { class: "tag-top" }, g), tag = el("text", { class: "tag" }, g), sub = el("text", { class: "tag-sub" }, g);
  // the chart style's track, while it is the selected aircraft: runs of one altitude band,
  // rebuilt on each update, and the stretch from its last point to the aircraft, moved every frame
  const trk = el("g", { class: "trk" }, svg.querySelector("#s-trails")), segs = el("g", {}, trk), tail = el("line", {}, trk);
  c = { g, icon, pos, sym, vec, leader, hist, l0, tag, sub, trk, segs, tail, x: null, y: null, rot: 0, slot: 0, text: "", symbol: null, vx: 0, vy: 0, subs: [""] };
  live.set(hex, c);
  requestAnimationFrame(() => g.classList.remove("entering"));
  return c;
}

function dropCraft(hex) {
  const c = live.get(hex);
  c.g.remove();
  c.trk.remove();
  c.hist.remove();
  live.delete(hex);
}

// Where a label can go. Chart style: a corner beside the aircraft (right-above, right-below,
// left-above, left-below). ATC style: the end of a leader line in any of the eight directions,
// as a controller sets them, the text 4 px from the line's end.
const CHART_CORNERS = [[7, -2.5, "start"], [7, 7.5, "start"], [-7, -2.5, "end"], [-7, 7.5, "end"]];
const slotCount = () => (opt.atc ? DIRS.length : CHART_CORNERS.length);
function slot(c, i) {
  if (!opt.atc) { const [tx, ty, anchor] = CHART_CORNERS[i]; return { tx, ty, anchor }; }
  const d = DIRS[i], ex = d.ux * c.lead, ey = d.uy * c.lead;
  return { d, ex, ey, tx: ex + (d.right ? -c.gap : c.gap), ty: ey, anchor: d.right ? "end" : "start" };
}

// The size of a label, measured: the kiosk sets labels larger.
function measure(c) {
  const fs = (e, d) => parseFloat(getComputedStyle(e).fontSize) || d;
  if (opt.atc) {
    // monospaced, so a block is as wide as its longest line; a leader is about one and a half
    // characters tall, as STARS draws its shortest
    const f = fs(c.tag, 4.6);
    let cw = 0;
    try { cw = c.tag.getComputedTextLength() / (c.tag.textContent.length || 1); } catch (e) { /* not laid out yet */ }
    c.fs = f; c.lead = Math.max(6.5, f * 1.45); c.gap = f * 0.35;
    // with half a line's clearance all round, so two blocks never read as one
    c.w = Math.max(c.text.length, c.l0.textContent.length, ...c.subs.map((t) => t.length)) * (cw || f * 0.6) + f * 0.5;
    c.up = f * (c.l0.textContent ? 1.9 : 0.9);       // above the leader's end
    c.down = f * (c.subs[0] ? 1.9 : 0.8);            // below it
    return;
  }
  let w = 0;
  try {
    // the second line may take turns between two texts: allow for the longer one
    const sub = c.sub.getComputedTextLength(), now = c.sub.textContent.length || 1;
    w = Math.max(c.tag.getComputedTextLength(), (sub * Math.max(...c.subs.map((t) => t.length))) / now);
  } catch (e) { /* not laid out yet */ }
  c.w = (w || c.text.length * CHAR_W) + 1;
  c.up = 3.2 + fs(c.tag, 5) * 0.75;         // cap height above the callsign's baseline
  c.down = 3.3 + fs(c.sub, 4.2) * 0.25;     // descent below the second line's baseline
}
function labelBox(c, i) {
  const s = slot(c, i), x0 = s.anchor === "start" ? c.x + s.tx : c.x + s.tx - c.w;
  return { x0, x1: x0 + c.w, y0: c.y + s.ty - c.up, y1: c.y + s.ty + c.down };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Choose a place for each aircraft's label that avoids other labels, aircraft, the compass and
// the edge. Re-run on each data update, not every frame, and keep the current place unless it
// is clearly worse, so labels don't flicker. The ATC style prefers its leaders pointing north.
function placeLabels(heroHex) {
  const placed = opt.atc ? [...placeBoxes] : [...(layerMode.startsWith("radar") ? placeBoxes : []), ...BEARING_BOXES,
    { x0: -5, x1: 5, y0: -112, y1: -100 }, { x0: 101, x1: 112, y0: -6, y1: 6 }, { x0: -5, x1: 5, y0: 102, y1: 114 }, { x0: -112, x1: -101, y0: -6, y1: 6 }];
  const all = [...live.values()].filter((c) => c.x != null), r = opt.atc ? 3 : 4.5;
  const blips = all.map((c) => ({ x0: c.x - r, x1: c.x + r, y0: c.y - r, y1: c.y + r, c }));
  for (const c of all) for (const f of [0.4, 0.7, 1]) {
    const x = c.x + c.vx * f, y = c.y + c.vy * f;
    if (Math.hypot(c.vx, c.vy) * f > 5) blips.push({ x0: x - 2, x1: x + 2, y0: y - 2, y1: y + 2, c: null });   // its own line too
  }
  const labelled = all.filter((c) => c.text);
  labelled.forEach(measure);
  labelled.sort((a, b) => (b.hex === heroHex) - (a.hex === heroHex));
  const edge = opt.atc ? SQ - 9.5 : 112;          // the ATC style keeps data blocks inside the compass
  for (const c of labelled) {
    const score = (i) => {
      const b = labelBox(c, i);
      let s = placed.reduce((n, p) => n + overlap(b, p), 0) + blips.reduce((n, p) => n + (p.c === c ? 0 : overlap(b, p)), 0);
      s += (Math.max(0, b.x1 - edge) + Math.max(0, -edge - b.x0)) * 20;
      if (opt.atc) s += (Math.max(0, b.y1 - edge) + Math.max(0, -edge - b.y0)) * 20 + (i ? 1.5 : 0);
      return s - (i === c.slot ? 6 : 0);                                    // stickiness
    };
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < slotCount(); i++) { const s = score(i); if (s < bestScore) { bestScore = s; best = i; } }
    c.slot = best;
    placed.push(labelBox(c, best));
  }
}

function applyLabel(c) {
  if (!c.text) return;
  const s = slot(c, c.slot);
  const put = (e, y) => { e.setAttribute("x", s.tx.toFixed(2)); e.setAttribute("y", y.toFixed(2)); e.setAttribute("text-anchor", s.anchor); };
  if (!opt.atc) { put(c.tag, s.ty - 3.2); put(c.sub, s.ty + 3.3); return; }
  // the leader ends level with the block's first line (an LDB's altitude), and lines step down
  // a character height at a time; it starts at the target's edge
  const f = c.fs, base = s.ty + f * 0.36;
  put(c.l0, base - f); put(c.tag, base); put(c.sub, base + f);
  c.leader.setAttribute("x1", (s.d.ux * 2.9).toFixed(2)); c.leader.setAttribute("y1", (s.d.uy * 2.9).toFixed(2));
  c.leader.setAttribute("x2", s.ex.toFixed(2)); c.leader.setAttribute("y2", s.ey.toFixed(2));
}

// What STARS shows for an aircraft. A track with a flight plan (a callsign on a code other than
// VFR's 1200) gets a full data block: the callsign; then the altitude in hundreds of feet and the
// ground speed in tens of knots, the flight rules (V for VFR) and the wake category, taking turns
// with the aircraft type. Its position symbol is the letter of the position that owns it: here A
// for arrivals, D for departures and C (the en route centre) for the rest. The aircraft overhead
// is the one this screen tracks, white, always with a full block. A track without a flight plan
// shows * with a limited block, its altitude, or + with none when it reports no altitude.
function starsBlock(a, owned) {
  const spc = spcOf(a), cs = (a.callsign || "").trim();
  const alt = a.alt == null ? "" : a.alt < 0 ? "N" + pad2(Math.round(-a.alt / 100)) : String(Math.round(a.alt / 100)).padStart(3, "0");
  const gs = a.gs == null ? "" : pad2(Math.round(a.gs / 10));
  if (!owned && !(cs && a.squawk !== "1200")) {
    if (spc) return { sym: alt ? "*" : "+", l0: `${spc} ${a.squawk || ""}`.trim(), l1: `${alt || "RDR"} ${gs}`.trim(), subs: [cs || ""] };
    return { sym: alt ? "*" : "+", l0: "", l1: alt, subs: [""] };
  }
  const f34 = (alt || "").padEnd(3) + " ";
  const p1 = `${f34}${gs || "  "}${a.squawk === "1200" ? "V" : " "}${a.cwt || ""}`.trimEnd();
  return { sym: a.local === "arriving" ? "A" : a.local === "departing" ? "D" : "C", l0: spc, l1: cs || ident(a),
    subs: a.type ? [p1, `${f34}${a.type}`] : [p1] };
}

// ATC style: history dots behind the selected aircraft, at its reported positions (`trail`)
// 4.5 s apart (as near as the feed's update rate allows), newest first, each a dimmer blue.
function historyDots(c, trail, k, home, trailS) {
  const dots = c.hist.children, t = trail || [], step = Math.max(1, Math.round(HISTORY_S / (trailS || HISTORY_S)));
  let n = 0;
  for (let i = t.length - 1 - step; i >= 0 && n < HISTORY; i -= step, n++) {
    const o = offset(home, { lat: t[i][0], lon: t[i][1] });
    dots[n].setAttribute("cx", (o.x * k).toFixed(1)); dots[n].setAttribute("cy", (-o.y * k).toFixed(1)); dots[n].style.display = "";
  }
  for (; n < HISTORY; n++) dots[n].style.display = "none";
}

// ---- entry point: called every animation frame ----
export function drawScope(svg, state, now, stateAt, mode, options = {}) {
  ensureLayers(svg);
  const dt = (now - stateAt) / 1000, frameDt = lastFrame ? Math.min(1, (now - lastFrame) / 1000) : 1;
  lastFrame = now;
  opt = { atc: !!options.atc && mode === "radar", tracks: options.tracks !== false, range: options.range || state.tracking.radius_nm };
  const layer = mode + (opt.atc ? ":atc" : "");
  if (layer !== layerMode) {                      // switching views or styles: start every aircraft fresh
    for (const hex of [...live.keys()]) dropCraft(hex);
    layerMode = layer;
    staticKey = null;
    setShape(svg);
    svg.classList.remove("fade-in"); void svg.getBBox(); svg.classList.add("fade-in");
  }
  drawBase(svg, state, mode);
  const key = `${layer}|${stateAt}|${map ? 1 : 0}|${opt.tracks}|${opt.range}`;
  const fresh = key !== staticKey;
  if (fresh) {
    staticKey = key;
    svg.querySelector("#s-static").innerHTML = mode === "sky" ? domeStatic(state, dt) : radarStatic(state);
    layoutPathKey(svg);
  }
  const wall = Date.now(), phase = clockPhase(wall);
  if (opt.atc && Math.floor(wall / 1000) !== lastSecond) {          // the status area's clock shows seconds
    lastSecond = Math.floor(wall / 1000);
    const t = svg.querySelector("#ssa-time");
    if (t) t.textContent = ssaClock();
  }

  const heroHex = state.hero && state.hero.hex, seen = new Set(), ease = 1 - Math.exp(-frameDt / 0.6), k = K();
  // past the tracking radius, aircraft are fetched only for a radar set to a longer range
  const aircraft = mode === "radar" ? [...state.aircraft, ...(state.beyond || [])] : state.aircraft;
  for (const a of aircraft) {
    if (a.on_ground || (mode === "sky" && a.alt == null)) continue;
    const p = place(state, a, dt, mode);
    if (!p) continue;
    seen.add(a.hex);
    const c = craftFor(svg, a.hex), isHero = a.hex === heroHex;
    c.hex = a.hex;
    // ease toward the dead-reckoned position; jump if it's far off (new aircraft, big correction)
    const arrived = c.x == null;                 // new on the scope since the last update
    if (arrived || Math.hypot(p.x - c.x, p.y - c.y) > 12) { c.x = p.x; c.y = p.y; c.rot = p.rot; }
    else {
      c.x += (p.x - c.x) * ease; c.y += (p.y - c.y) * ease;
      c.rot += (((p.rot - c.rot + 540) % 360) - 180) * ease;
    }
    c.g.setAttribute("transform", `translate(${c.x.toFixed(2)},${c.y.toFixed(2)})`);
    if (!opt.atc) c.icon.setAttribute("transform", `rotate(${c.rot.toFixed(1)}) scale(${(isHero ? 1.55 : 1) * p.scale})`);
    // the lead line: one minute ahead at its ground speed, from the nose (the ATC style's
    // predicted track line, from the target), on the radar only
    const lead = opt.tracks && mode === "radar" && a.gs && a.track != null ? (a.gs / 60) * k : 0;
    const sin = Math.sin(c.rot * RAD), cos = -Math.cos(c.rot * RAD), nose = opt.atc ? 2.3 : 4.2 * (isHero ? 1.55 : 1);
    c.vx = sin * lead; c.vy = cos * lead;
    if (lead > nose) {
      c.vec.setAttribute("x1", (sin * nose).toFixed(2)); c.vec.setAttribute("y1", (cos * nose).toFixed(2));
      c.vec.setAttribute("x2", c.vx.toFixed(2)); c.vec.setAttribute("y2", c.vy.toFixed(2));
      c.vec.style.display = "";
    } else c.vec.style.display = "none";
    c.g.classList.toggle("hero", isHero);
    c.trk.classList.toggle("hero", isHero);
    c.hist.classList.toggle("hero", isHero);
    let text, line0 = "";
    if (opt.atc) {
      const b = starsBlock(a, isHero);
      c.g.classList.toggle("ldb", b.subs.length === 1 && !b.subs[0]);
      if (b.sym !== c.symbol) {
        c.symbol = b.sym;
        const drawn = b.sym === "*" || b.sym === "+";
        c.pos.textContent = drawn ? "" : b.sym;
        c.sym.setAttribute("d", b.sym === "*" ? STAR_SYM : b.sym === "+" ? PLUS_SYM : "");
      }
      text = b.l1; line0 = b.l0; c.subs = b.subs;
    } else {
      // the chart style's label: the flight, then the altitude and its trend
      const showLabel = mode !== "sky" || isHero || p.el > 6;
      text = showLabel ? ident(a) : "";
      c.subs = [showLabel ? p.sub : ""];
    }
    if (text !== c.text) { c.text = text; c.tag.textContent = text; }
    if (c.l0.textContent !== line0) c.l0.textContent = line0;
    // the data block's timeshared field: phase 1 shows the first text, phases 2 and 3 the second
    const line2 = c.subs[phase === 1 || c.subs.length < 2 ? 0 : 1];
    if (c.sub.textContent !== line2) c.sub.textContent = line2;
    c.leader.style.display = opt.atc && text ? "" : "none";
    // only the selected aircraft (overhead, or tapped) shows where it has been: the ATC style's
    // history dots, or the chart style's whole track since it came in range or took off
    const dots = opt.atc && opt.tracks && isHero;
    if (dots && (fresh || arrived)) historyDots(c, state.hero.trail, k, state.home, state.trail_s);
    c.hist.style.display = dots ? "" : "none";
    const path = !opt.atc && opt.tracks && mode === "radar" && isHero && state.hero.path && state.hero.path.length ? state.hero.path : null;
    if (path && (fresh || !c.drawn)) {
      c.segs.innerHTML = pathRuns(state.home, path, k);
      const [lat, lon] = path[path.length - 1], o = offset(state.home, { lat, lon });
      c.tail.setAttribute("x1", (o.x * k).toFixed(1)); c.tail.setAttribute("y1", (-o.y * k).toFixed(1));
      c.tail.setAttribute("class", `b${band(a.alt ?? path[path.length - 1][2] * 100)}`);
      c.drawn = true;
    } else if (!path && c.drawn) { c.segs.innerHTML = ""; c.drawn = false; }
    c.trk.style.display = path ? "" : "none";
    if (path) { c.tail.setAttribute("x2", c.x.toFixed(1)); c.tail.setAttribute("y2", c.y.toFixed(1)); }
  }
  for (const hex of [...live.keys()]) if (!seen.has(hex)) dropCraft(hex);
  if (fresh) { placeLabels(heroHex); for (const c of live.values()) applyLabel(c); }
}
