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
const TARGET = "M-1.3,-1.3H1.3V1.3H-1.3Z";      // the ATC style's position symbol: a small square that doesn't turn
const HISTORY = 6;                              // history dots behind each target in the ATC style
// Drawing options from the page: atc draws the radar like an air traffic control screen;
// tracks shows trails (or history dots) and the one-minute lines; range is how far out the radar
// shows, in nm (the tracking radius, or longer).
let opt = { atc: false, tracks: true, range: 15 };
const RAD = Math.PI / 180;
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
// screen pixel. Rectangles are in nm east (x) and north (y) of home.
export function tileLayout(home, radiusNm, screenPxPerNm) {
  const z = clamp(Math.round(Math.log2((40075016.686 * Math.cos(home.lat * RAD) * screenPxPerNm) / (256 * 1852))), 8, 15);
  const dLat = radiusNm / 60, dLon = radiusNm / (60 * Math.cos(home.lat * RAD));
  const x0 = Math.floor(lon2x(home.lon - dLon, z)), x1 = Math.floor(lon2x(home.lon + dLon, z));
  const y0 = Math.floor(lat2y(home.lat + dLat, z)), y1 = Math.floor(lat2y(home.lat - dLat, z));
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const nw = offset(home, { lat: y2lat(y, z), lon: x2lon(x, z) }), se = offset(home, { lat: y2lat(y + 1, z), lon: x2lon(x + 1, z) });
    tiles.push({ url: `tiles/${z}/${x}/${y}`, x0: nw.x, y0: nw.y, x1: se.x, y1: se.y });
  }
  return { z, tiles };
}

const pts = (home, line, k) => line.map(([lat, lon]) => { const o = offset(home, { lat, lon }); return `${(o.x * k).toFixed(1)},${(-o.y * k).toFixed(1)}`; }).join(" ");

function mapLayer(home, k, hasBasemap) {
  if (!map) return "";
  let s = "";
  // the hand-drawn rivers are only a stand-in for when there's no real map underneath; the ATC
  // style draws them as thin lines, as a controller's video map shows coastlines and rivers
  if (opt.atc) for (const w of map.water || []) s += `<polyline class="vmap" points="${pts(home, w.line, k)}"/>`;
  else if (!hasBasemap) for (const w of map.water || []) s += `<polyline class="water" stroke-width="${Math.max(1.2, w.width_nm * k)}" points="${pts(home, w.line, k)}"/>`;
  if (opt.atc) return s;                        // a controller's map has no town names
  for (const p of map.places || []) {
    const o = offset(home, { lat: p.at[0], lon: p.at[1] });
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
  let s = "";
  for (const r of rws) {
    if (Math.abs(r.ux * main.ux + r.uy * main.uy) > 0.985)        // within about 10° of the main direction
      s += `<line class="approach" x1="${(r.a.x - r.ux * far) * k}" y1="${-(r.a.y - r.uy * far) * k}" x2="${(r.b.x + r.ux * far) * k}" y2="${-(r.b.y + r.uy * far) * k}"/>`;
  }
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
  const k = 100 / opt.range, o = offset(state.home, projected(a, t));
  if (Math.hypot(o.x, o.y) * k > 100) return null;
  // the altitude in hundreds of feet, as a controller's scope shows it, with an arrow when climbing or descending
  const v = a.vrate || 0, trend = v > 300 ? "↑" : v < -300 ? "↓" : "";
  return { x: o.x * k, y: -o.y * k, rot: a.track || 0, scale: 1, sub: a.alt == null ? "" : String(Math.max(0, Math.round(a.alt / 100))).padStart(3, "0") + trend };
}

// The ATC style's status area, as a controller's screen keeps one in a corner: the time in UTC,
// the airport's altimeter setting, the wind, the runways in use, the range and the line length.
function statusLines(state) {
  const d = new Date(), w = state.weather, f = state.flow;
  const z = String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z";
  const alt = w && /\bA(\d{4})\b/.exec(w.raw || "");
  const wind = w && w.wind_kt != null ? `Wind ${w.wind_kt ? String(w.wind_dir ?? 0).padStart(3, "0") : "000"}/${String(w.wind_kt).padStart(2, "0")}${w.gust_kt ? "G" + w.gust_kt : ""}` : "";
  return [`${z} ${state.airport.icao}${alt ? " " + alt[1] : ""}`, wind, f ? `Rwy ${f.runways.replace(" / ", " ")}` : "",
    `Rng ${opt.range}${opt.tracks ? " PTL 1.0" : ""}`].filter(Boolean);
}

// ---- static layer ----
function radarStatic(state) {
  const R = opt.range, k = 100 / R, home = state.home;
  placeBoxes = [];        // refilled below by the place names, flight restrictions and airfields
  // range rings every 5 nm, or every 10 beyond 20 nm
  const step = R <= 20 ? 5 : 10, rings = [];
  for (let r = step; r < R - 0.01; r += step) rings.push(r);
  rings.push(R);
  const based = !!(state.basemap && state.basemap.enabled);
  let s = `<g clip-path="url(#scope-clip)">${mapLayer(home, k, based)}${runwayLayer(state, k)}${tfrLayer(state, k)}${fieldsLayer(state, k)}</g>`;
  if (!opt.atc) s += SPOKES(rings[0] * k);
  for (const r of rings) s += `<circle class="ring" r="${r * k}"/>${ringLabel(r * k, Math.round(r) + (opt.atc ? "" : " nm"))}`;
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>${COMPASS}`;
  // the key, in the drawing's lower left corner; the ATC style adds a status area at the top left
  if (opt.atc) {
    s += note("status", -111, -92, "start", statusLines(state));
    s += note("legend", -111, 110.5, "start", ["Data block: callsign", "Alt/100 ft ↑↓ speed kt", "or type, destination"]);
  } else s += note("legend", -111, 110.5, "start", [`${R} nm around home`, "035↑ 3,500 ft, climbing", opt.tracks ? "Line: 1 minute ahead" : ""].filter(Boolean));
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

// The small airfields nearby (Pearson, Troutdale): a ring and their code.
function fieldsLayer(state, k) {
  let s = "";
  for (const f of state.airport.others || []) {
    const o = offset(state.home, f);
    if (Math.hypot(o.x, o.y) * k > 95) continue;
    s += `<circle class="field" cx="${(o.x * k).toFixed(1)}" cy="${(-o.y * k).toFixed(1)}" r="2.2"/>` +
      `<text class="field-label" x="${(o.x * k).toFixed(1)}" y="${(-o.y * k + 7.5).toFixed(1)}" text-anchor="middle">${esc(f.code)}</text>`;
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
  return note("heard-note", 111, 110.5, "end", ["Heard nearby,", "no position:", what]);
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
const live = new Map();     // hex -> { g, icon, tag, sub, trail, tail, x, y, rot, corner, seen }
let lastFrame = 0, layerMode = null, staticKey = null, baseKey = null;

// The map layer is rebuilt only when the zoom or view changes, so it never flickers.
function drawBase(svg, state, mode) {
  const g = svg.querySelector("#s-base"), bm = state.basemap;
  const R = opt.range, k = 100 / R;
  const box = svg.getBoundingClientRect(), unitsPx = Math.min(box.width, box.height) / 224;
  const screenPxPerNm = unitsPx * k * (window.devicePixelRatio || 1);
  if (mode !== "radar" || opt.atc || !bm || !bm.enabled || !unitsPx) {
    if (baseKey !== "none") { g.innerHTML = ""; baseKey = "none"; }
    return;
  }
  const layout = tileLayout(state.home, R * 1.05, screenPxPerNm);
  const key = `${layout.z}|${R}|${state.home.lat},${state.home.lon}|${bm.style}`;
  if (key === baseKey) return;
  baseKey = key;
  g.style.opacity = bm.opacity;
  g.setAttribute("class", `basemap ${bm.style}`);
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
  el("circle", { r: 100 }, el("clipPath", { id: "scope-clip" }, defs));
  // diagonal hatching for active flight restrictions
  const hatch = el("pattern", { id: "tfr-hatch", width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 3, class: "tfr-hatch-line" }, hatch);
  el("circle", { class: "scope-bg", r: 100 }, svg);
  el("g", { id: "s-base", "clip-path": "url(#scope-clip)" }, svg);
  for (const id of ["s-static", "s-trails", "s-craft"]) el("g", { id }, svg);
}

function craftFor(svg, hex) {
  let c = live.get(hex);
  if (c) return c;
  const g = el("g", { "data-hex": hex, class: "craft entering" }, svg.querySelector("#s-craft"));
  el("circle", { r: 10, fill: "transparent" }, g);                    // generous touch target
  const vec = el("line", { class: "vec" }, g);                         // where it will be in a minute
  const leader = el("line", { class: "leader" }, g);                   // ATC style: target to data block
  const icon = el("path", { class: "blip", d: opt.atc ? TARGET : PLANE }, g);   // a change of style rebuilds every craft
  const hist = el("g", { class: "hist" }, svg.querySelector("#s-trails"));
  // hidden until placed: a dot without a position would sit on home
  for (let i = 0; i < HISTORY; i++) el("circle", { r: 0.75, "fill-opacity": (0.75 * (1 - i / HISTORY)).toFixed(2), style: "display:none" }, hist);
  const tag = el("text", { class: "tag" }, g), sub = el("text", { class: "tag-sub" }, g);
  // each trail fades from transparent at its oldest point to solid at the aircraft
  const gid = "tg-" + hex.replace(/[^a-z0-9]/gi, ""), grad = el("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse" }, svg.querySelector("#s-defs"));
  el("stop", { offset: 0, "stop-opacity": 0 }, grad);       // colour comes from the stylesheet
  el("stop", { offset: 1, "stop-opacity": 0.8 }, grad);
  const trail = el("polyline", { class: "trail", stroke: `url(#${gid})` }, svg.querySelector("#s-trails"));
  c = { g, icon, vec, leader, hist, tag, sub, trail, grad, x: null, y: null, rot: 0, corner: 0, text: "", vx: 0, vy: 0, subs: [""] };
  live.set(hex, c);
  requestAnimationFrame(() => g.classList.remove("entering"));
  return c;
}

function dropCraft(hex) {
  const c = live.get(hex);
  c.g.remove();
  c.trail.remove();
  c.hist.remove();
  c.grad.remove();
  live.delete(hex);
}

// Label corners: right-above, right-below, left-above, left-below. The ATC style sets its data
// blocks further out, on leader lines.
const CHART_CORNERS = [[7, -2.5, "start"], [7, 7.5, "start"], [-7, -2.5, "end"], [-7, 7.5, "end"]];
const ATC_CORNERS = [[11, -5, "start"], [11, 11, "start"], [-11, -5, "end"], [-11, 11, "end"]];
const corners = () => (opt.atc ? ATC_CORNERS : CHART_CORNERS);

// The box a label covers at a corner, from its measured size: the kiosk sets labels larger.
function measure(c) {
  const fs = (e, d) => parseFloat(getComputedStyle(e).fontSize) || d;
  let w = 0;
  try {
    // the second line may take turns between two texts: allow for the longer one
    const sub = c.sub.getComputedTextLength(), now = c.sub.textContent.length || 1;
    w = Math.max(c.tag.getComputedTextLength(), (sub * Math.max(...c.subs.map((t) => t.length))) / now);
  } catch (e) { /* not laid out yet */ }
  c.w = (w || c.text.length * CHAR_W) + 1;
  c.top = 3.2 + fs(c.tag, 5) * 0.75;        // cap height above the callsign's baseline
  c.bot = 3.3 + fs(c.sub, 4.2) * 0.25;      // descent below the second line's baseline
}
function labelBox(c, corner) {
  const [dx, dy, anchor] = corners()[corner], w = c.w;
  const x0 = anchor === "start" ? c.x + dx : c.x + dx - w;
  return { x0, x1: x0 + w, y0: c.y + dy - c.top, y1: c.y + dy + c.bot };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Choose a label corner for each aircraft that avoids other labels, aircraft, the
// compass letters and the edge. Re-run on each data update, not every frame, and
// keep the current corner unless it is clearly worse, so labels don't flicker.
function placeLabels(heroHex) {
  const placed = [...(layerMode.startsWith("radar") ? placeBoxes : []), ...BEARING_BOXES, { x0: -5, x1: 5, y0: -112, y1: -100 }, { x0: 101, x1: 112, y0: -6, y1: 6 }, { x0: -5, x1: 5, y0: 102, y1: 114 }, { x0: -112, x1: -101, y0: -6, y1: 6 }];
  const all = [...live.values()].filter((c) => c.x != null);
  const blips = all.map((c) => ({ x0: c.x - 4.5, x1: c.x + 4.5, y0: c.y - 4.5, y1: c.y + 4.5, c }));
  for (const c of all) for (const f of [0.4, 0.7, 1]) {
    const x = c.x + c.vx * f, y = c.y + c.vy * f;
    if (Math.hypot(c.vx, c.vy) * f > 5) blips.push({ x0: x - 2, x1: x + 2, y0: y - 2, y1: y + 2, c: null });   // its own line too
  }
  all.forEach(measure);
  all.sort((a, b) => (b.hex === heroHex) - (a.hex === heroHex));
  for (const c of all) {
    const score = (i) => {
      const b = labelBox(c, i);
      let s = placed.reduce((n, p) => n + overlap(b, p), 0) + blips.reduce((n, p) => n + (p.c === c ? 0 : overlap(b, p)), 0);
      s += Math.max(0, b.x1 - 112) * 20 + Math.max(0, -112 - b.x0) * 20;   // off the edge
      return s - (i === c.corner ? 6 : 0);                                  // stickiness
    };
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < 4; i++) { const s = score(i); if (s < bestScore) { bestScore = s; best = i; } }
    c.corner = best;
    placed.push(labelBox(c, best));
  }
}

function applyLabel(c) {
  const [dx, dy, anchor] = corners()[c.corner];
  c.tag.setAttribute("x", dx); c.tag.setAttribute("y", dy - 3.2); c.tag.setAttribute("text-anchor", anchor);
  c.sub.setAttribute("x", dx); c.sub.setAttribute("y", dy + 3.3); c.sub.setAttribute("text-anchor", anchor);
  // the leader runs from the target's edge to the middle of the data block's first line
  const ex = dx - Math.sign(dx) * 1.2, ey = dy - 4.6, d = Math.hypot(ex, ey) || 1;
  c.leader.setAttribute("x1", ((ex / d) * 2.6).toFixed(2)); c.leader.setAttribute("y1", ((ey / d) * 2.6).toFixed(2));
  c.leader.setAttribute("x2", ex.toFixed(2)); c.leader.setAttribute("y2", ey.toFixed(2));
}

// ATC style: history dots at the aircraft's last reported positions, newest first, at least a dot's
// spacing apart, fading with age, as a controller's screen shows them.
function historyDots(c, a, k, home) {
  const dots = c.hist.children;
  let n = 0, lx = c.x, ly = c.y;
  for (let i = (a.trail || []).length - 1; i >= 0 && n < HISTORY; i--) {
    const o = offset(home, { lat: a.trail[i][0], lon: a.trail[i][1] }), x = o.x * k, y = -o.y * k;
    if (Math.hypot(x - lx, y - ly) < 2.6) continue;
    dots[n].setAttribute("cx", x.toFixed(1)); dots[n].setAttribute("cy", y.toFixed(1)); dots[n].style.display = "";
    lx = x; ly = y; n++;
  }
  for (; n < HISTORY; n++) dots[n].style.display = "none";
}

// ---- entry point: called every animation frame ----
export function drawScope(svg, state, now, stateAt, mode, options = {}) {
  ensureLayers(svg);
  const dt = (now - stateAt) / 1000, frameDt = lastFrame ? Math.min(1, (now - lastFrame) / 1000) : 1;
  lastFrame = now;
  opt = { atc: !!options.atc, tracks: options.tracks !== false, range: options.range || state.tracking.radius_nm };
  const layer = mode + (opt.atc ? ":atc" : "");
  if (layer !== layerMode) {                      // switching views or styles: start every aircraft fresh
    for (const hex of [...live.keys()]) dropCraft(hex);
    layerMode = layer;
    staticKey = null;
    svg.classList.remove("fade-in"); void svg.getBBox(); svg.classList.add("fade-in");
  }
  drawBase(svg, state, mode);
  const key = `${layer}|${stateAt}|${map ? 1 : 0}|${opt.tracks}|${opt.range}`;
  const fresh = key !== staticKey;
  if (fresh) {
    staticKey = key;
    svg.querySelector("#s-static").innerHTML = mode === "sky" ? domeStatic(state, dt) : radarStatic(state);
  }

  const heroHex = state.hero && state.hero.hex, seen = new Set(), ease = 1 - Math.exp(-frameDt / 0.6);
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
    c.icon.setAttribute("transform", opt.atc ? `scale(${isHero ? 1.35 : 1})` : `rotate(${c.rot.toFixed(1)}) scale(${(isHero ? 1.55 : 1) * p.scale})`);
    // the lead line: one minute ahead at its ground speed, from the nose (the ATC style's
    // predicted track line, from the target), on the radar only
    const lead = opt.tracks && mode === "radar" && a.gs && a.track != null ? (a.gs / 60) * (100 / opt.range) : 0;
    const sin = Math.sin(c.rot * RAD), cos = -Math.cos(c.rot * RAD), nose = opt.atc ? 2.2 : 4.2 * (isHero ? 1.55 : 1);
    c.vx = sin * lead; c.vy = cos * lead;
    if (lead > nose) {
      c.vec.setAttribute("x1", (sin * nose).toFixed(2)); c.vec.setAttribute("y1", (cos * nose).toFixed(2));
      c.vec.setAttribute("x2", c.vx.toFixed(2)); c.vec.setAttribute("y2", c.vy.toFixed(2));
      c.vec.style.display = "";
    } else c.vec.style.display = "none";
    c.g.classList.toggle("hero", isHero);
    c.trail.classList.toggle("hero", isHero);
    c.hist.classList.toggle("hero", isHero);
    c.grad.classList.toggle("hero", isHero);
    const showLabel = mode !== "sky" || isHero || p.el > 6;
    // the ATC style's data block: the ICAO callsign, then altitude, trend and ground speed, taking
    // turns with the type and destination every two seconds
    const text = !showLabel ? "" : opt.atc ? a.callsign || ident(a) : ident(a);
    if (text !== c.text) { c.text = text; c.tag.textContent = text; }
    if (opt.atc && showLabel) {
      const r = a.route && a.route.plausible ? a.route : null, gs = a.gs == null ? "" : " " + String(Math.round(a.gs)).padStart(3, "0");
      const alt = a.alt == null ? "---" : p.sub.slice(0, 3), trend = p.sub.slice(3) || " ";
      c.subs = [`${alt}${trend}${gs}`, [a.type, r && r.dest && r.dest.iata].filter(Boolean).join(" ")].filter(Boolean);
    } else c.subs = [showLabel ? p.sub : ""];
    const line2 = c.subs[Math.floor(now / 2000) % c.subs.length];
    if (c.sub.textContent !== line2) c.sub.textContent = line2;
    c.leader.style.display = opt.atc && showLabel ? "" : "none";
    if (opt.atc && opt.tracks && (fresh || arrived)) historyDots(c, a, 100 / opt.range, state.home);
    c.hist.style.display = opt.atc && opt.tracks ? "" : "none";
    if (!opt.atc && opt.tracks && mode === "radar" && a.trail && a.trail.length > 1) {
      if (fresh || !c.trailPts) {
        c.trailPts = pts(state.home, a.trail, 100 / opt.range);
        const [x1, y1] = c.trailPts.split(" ")[0].split(",");
        c.grad.setAttribute("x1", x1); c.grad.setAttribute("y1", y1);
      }
      c.grad.setAttribute("x2", c.x.toFixed(1)); c.grad.setAttribute("y2", c.y.toFixed(1));
      c.trail.setAttribute("points", `${c.trailPts} ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    } else c.trail.setAttribute("points", "");
  }
  for (const hex of [...live.keys()]) if (!seen.has(hex)) dropCraft(hex);
  if (fresh) { placeLabels(heroHex); for (const c of live.values()) applyLabel(c); }
}
