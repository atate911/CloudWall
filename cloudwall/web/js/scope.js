// The right-hand panel: the radar scope (chart or ATC style), the Map view, or the Sky view (a
// dome: centre straight up, the edge the horizon).
// Two layers: the static layer is rebuilt only when the data or mode changes; the aircraft layer is
// persistent elements moved every frame, dead-reckoned from the last report and eased to each new one.
import { esc, num, ident, projected, offset, azEl, clamp, POINTS } from "./util.js";
import { sky } from "./sky.js";
import { moonPosition, moonPhase, moonGlyph } from "./astro.js";
import { map, tileLayout, runwaysFor } from "./map.js";
import { iconFor } from "./icons.js";
import { plainName, boardFlight } from "./parts.js";
import { kind, MED_CROSS, hospitalShort } from "./situation.js";

// Drawing options from the page. tracks: past tracks and the one-minute lines; range: nm;
// simple: only the landing order, the selected aircraft and anything worth a look are labelled.
let opt = { atc: false, map: false, sky: false, heading: null, tracks: true, range: 15, mapStyle: "sat", simple: false, wall: false };
const RAD = Math.PI / 180;

// ---- the ATC style: a STARS display, the FAA's terminal radar, drawn to its conventions ----
// The display is a square, and its range is from the centre to the edge, as STARS sets it.
const SQ = 108;
// The Map view fills its panel: half-width MX and half-height MY drawing units, the range from
// the centre to its nearer edges. UI: where the panel's buttons sit, so labels stay out from under them.
let MX = SQ, MY = SQ, UI = [];
const square = () => opt.atc || opt.map;
const K = () => (square() ? SQ : 100) / opt.range;          // drawing units per nm
const inView = (x, y) => (opt.map ? Math.abs(x) <= MX && Math.abs(y) <= MY
  : square() ? Math.max(Math.abs(x), Math.abs(y)) <= SQ : Math.hypot(x, y) <= 100);
// how many times the range the Map view's corners reach, for the server to fetch that far
export const mapReach = () => Math.hypot(MX, MY) / SQ;
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
// a.spc is the trouble code the server found, by the squawk or by the transponder's own status
const spcOf = (a) => SPC[a.spc] || SPC[a.squawk] || "";
// Leader directions, clockwise from north. A data block left of its leader (south through
// north-west) is right-justified against it.
const DIRS = [...Array(8)].map((_, i) => ({ ux: Math.sin(i * 45 * RAD), uy: -Math.cos(i * 45 * RAD), right: i >= 4 }));
// The data blocks' timeshared fields follow a clock: phases 1, 2, 1, 3 for 2, 1, 2 and 1 seconds.
const clockPhase = (ms) => { const t = (ms / 1000) % 6; return t < 2 ? 1 : t < 3 ? 2 : t < 5 ? 1 : 3; };
const NS = "http://www.w3.org/2000/svg";
const CHAR_W = 3.35;                          // estimated label width per character, until a label can be measured
// Icons are drawn at least as large on screen as on a 1920-wide desktop's radar (2.5 CSS px to the
// unit): on a smaller radar up to half as large again.
const ICON_UNIT_PX = 2.5, ICON_BOOST_MAX = 1.5;
let placeBoxes = [];        // where the place names sit, so aircraft labels can avoid them
const MOVE_ON_S = 30;       // how long aircraft are moved on from their last reports
// The chart style's fixed names give way to traffic: while an aircraft or its label is over one, it fades out.
const YIELDING = ".ring-label, .apt-label, .field-label, .place, .tfr-label, .final-label, .helipad-label, .helipad:not(.dest)";
let yielders = [];

// The selected aircraft's track fades with height: the bands' lower edges in feet.
const BANDS = [2000, 5000, 10000, 18000, 28000];
const band = (ft) => { let i = 0; while (i < BANDS.length && ft >= BANDS[i]) i++; return i; };

// Runs of one band each: a segment takes the band of the point it ends at.
// Points are [lat, lon, altitude in hundreds of ft].
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

// The key to the paths' shades; laid out once drawn (layoutPathKey), when its text can be measured.
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

// A bearing number the key's lines would touch (lower left) is left off.
function clearKey(svg) {
  const lines = [...svg.querySelectorAll("#s-static .legend tspan, #s-static .path-key")].map((e) => {
    try { return e.getBBox(); } catch (err) { return null; }
  }).filter((b) => b && b.width);
  for (const t of svg.querySelectorAll("#s-static .bearing")) {
    let b;
    try { b = t.getBBox(); } catch (err) { continue; }
    const hit = lines.some((l) => b.x < l.x + l.width + 1 && b.x + b.width > l.x - 1 && b.y < l.y + l.height + .5 && b.y + b.height > l.y - .5);
    t.style.display = hit ? "none" : "";
  }
}

const pts = (home, line, k) => line.map(([lat, lon]) => { const o = offset(home, { lat, lon }); return `${(o.x * k).toFixed(1)},${(-o.y * k).toFixed(1)}`; }).join(" ");

// The FAA's charts, as maps: each prints its own towns, so the radar adds no names over them.
const CHART_STYLES = new Set(["sectional", "terminal", "ifr-low", "ifr-high"]);

function mapLayer(home, k, hasBasemap, charted = false) {
  if (!map) return "";
  let s = "";
  // the hand-drawn rivers are a stand-in for when there's no real map; the ATC style draws them as thin lines
  if (opt.atc) for (const w of map.water || []) s += `<polyline class="vmap" points="${pts(home, w.line, k)}"/>`;
  else if (!hasBasemap) for (const w of map.water || []) s += `<polyline class="water" stroke-width="${Math.max(1.2, w.width_nm * k)}" points="${pts(home, w.line, k)}"/>`;
  if (opt.atc || charted) return s;             // a controller's map has no town names; a chart has its own
  for (const p of map.places || []) {
    const o = offset(home, { lat: p.at[0], lon: p.at[1] });
    if (Math.hypot(o.x, o.y) * k < 7) continue;   // the town you're in: the home reticle already marks it
    s += `<text class="place" x="${o.x * k}" y="${-o.y * k}" text-anchor="middle">${esc(p.name)}</text>`;
    const w = p.name.length * 3.1;
    placeBoxes.push({ x0: o.x * k - w / 2, x1: o.x * k + w / 2, y0: -o.y * k - 4.5, y1: -o.y * k + 1, soft: true });
  }
  return s;
}

// Runways, and extended centrelines 12 nm out for the main direction only (the longest runway and
// its parallels). The chart style draws them on the approach side only when it knows which way the
// airport is landing (finalCourses); otherwise, and in the ATC style, they run out from both ends.
function runwayLayer(state, k) {
  const home = state.home, rws = runwaysFor(state).map((r) => {
    const [a, b] = r.ends.map(([lat, lon]) => offset(home, { lat, lon }));
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { a, b, len, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
  });
  if (!rws.length) return "";
  const main = rws.reduce((m, r) => (r.len > m.len ? r : m)), far = 12;
  const finals = opt.atc ? "" : finalCourses(state, k);
  let s = "", ticks = "";
  // the ATC style marks each final every mile (every 5 when that's too close to read)
  const every = k >= 4 ? 1 : 5;
  for (const r of rws) {
    if (finals || Math.abs(r.ux * main.ux + r.uy * main.uy) <= 0.985) continue;   // not within about 10° of the main direction
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
  s += finals;
  for (const r of rws) s += `<line class="runway" x1="${r.a.x * k}" y1="${-r.a.y * k}" x2="${r.b.x * k}" y2="${-r.b.y * k}"/>`;
  return s;
}

// The chart style's final approach courses for the runways in use: ticked every mile, named once
// at the far end ("28L/R").
function finalCourses(state, k) {
  const names = String((state.flow && state.flow.runways) || "").split("/").map((n) => n.trim()).filter(Boolean);
  const home = state.home, ends = [];
  for (const n of names) {
    const r = runwaysFor(state).find((x) => x.name && x.name.split("/").includes(n));
    if (!r) continue;
    const i = r.name.split("/").indexOf(n), [t, f] = [r.ends[i], r.ends[1 - i]].map(([lat, lon]) => offset(home, { lat, lon }));
    const len = Math.hypot(t.x - f.x, t.y - f.y) || 1;
    ends.push({ n, t, ux: (t.x - f.x) / len, uy: (t.y - f.y) / len });
  }
  if (!ends.length) return "";
  let d = "", far = null, lines = "";
  for (const e of ends) {
    const x0 = e.t.x * k, y0 = -e.t.y * k, ux = e.ux, uy = -e.uy;
    // out to the disc's edge, at most 16 nm
    const b = x0 * ux + y0 * uy, L = Math.min(16 * k, -b + Math.sqrt(Math.max(0, b * b - (x0 * x0 + y0 * y0 - 99 * 99))));
    lines += `<line class="approach" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${(x0 + ux * L).toFixed(2)}" y2="${(y0 + uy * L).toFixed(2)}"/>`;
    for (let m = 1; m * k <= L; m++) {
      const h = m % 5 ? 1 : 2, cx = x0 + ux * m * k, cy = y0 + uy * m * k;
      d += `M${(cx - uy * h).toFixed(2)},${(cy + ux * h).toFixed(2)}L${(cx + uy * h).toFixed(2)},${(cy - ux * h).toFixed(2)}`;
    }
    // the name sits just inside the edge, on the course's upper side
    const flip = -ux > 0 ? -1 : 1, nx = uy * flip, ny = -ux * flip;          // the normal pointing up the screen
    far = { x: x0 + ux * (L - 8) + nx * 4.5, y: y0 + uy * (L - 8) + ny * 4.5 };
  }
  const same = ends.length > 1 && ends.every((e) => e.n.slice(0, -1) === ends[0].n.slice(0, -1));
  const label = same ? `${ends[0].n.slice(0, -1)}${ends.map((e) => e.n.slice(-1)).join("/")}` : ends.map((e) => e.n).join(" ");
  placeBoxes.push({ x0: far.x - 8, x1: far.x + 8, y0: far.y - 3, y1: far.y + 3 });
  return `${lines}<path class="final-tick" d="${d}"/><text class="final-label" x="${far.x.toFixed(2)}" y="${(far.y + 1.5).toFixed(2)}" text-anchor="middle">${esc(label)}</text>`;
}

// Ring labels sit on the north-east diagonal, clear of the N/E letters and of most traffic.
function ringLabel(r, text) {
  const d = r * Math.SQRT1_2;
  return `<text class="ring-label" x="${d + 1.5}" y="${-d - 1.5}">${text}</text>`;
}
// A bezel of degree marks just outside the edge, the bearing beside each 30° mark.
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
// Bearing lines every 30° between the innermost ring and the edge.
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
// Lines of text, the last line's baseline at y. Spacing in ems, so a larger font (the kiosk's) still ends at y.
const note = (cls, x, y, anchor, lines) => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">` +
  lines.map((l, i) => `<tspan x="${x}" dy="${i ? 1.25 : -1.25 * (lines.length - 1)}em">${esc(l)}</tspan>`).join("") + `</text>`;
const COMPASS = `${BEZEL}<text class="compass" x="0" y="-104" text-anchor="middle">N</text><text class="compass" x="106" y="2" text-anchor="middle">E</text>
  <text class="compass" x="0" y="110" text-anchor="middle">S</text><text class="compass" x="-106" y="2" text-anchor="middle">W</text>`;

// ---- where an aircraft is drawn ----
function place(state, a, t) {
  if (opt.sky) {
    const p = skyPos(state.home, a, t);
    if (p.el < 1) return null;
    const [x, y] = domeXY(p), [x2, y2] = domeXY(skyPos(state.home, a, t + 8));
    // heading across the dome, which isn't its compass track: the sky view is looking up
    const rot = Math.hypot(x2 - x, y2 - y) > 0.01 ? Math.atan2(x2 - x, -(y2 - y)) / RAD : a.track || 0;
    return { x, y, rot, scale: 0.9 + clamp(p.el / 60, 0, 1) * 0.9, sub: `${Math.round(p.el)}° up`, el: p.el };
  }
  const k = K(), o = offset(state.home, projected(a, t));
  if (!inView(o.x * k, -o.y * k)) return null;
  if (opt.map) return { x: o.x * k, y: -o.y * k, rot: a.track || 0, scale: 1.15, sub: plainLine(a, state) };
  // the altitude in hundreds of feet, with an arrow when climbing or descending
  const v = a.vrate || 0, trend = v > 300 ? "↑" : v < -300 ? "↓" : "";
  return { x: o.x * k, y: -o.y * k, rot: a.track || 0, scale: 1, sub: a.alt == null ? "" : String(Math.max(0, Math.round(a.alt / 100))).padStart(3, "0") + trend };
}

// ---- the Sky view: a dome looking straight up, centre the zenith, the edge the horizon ----
// With the phone's compass on (opt.heading), the dome turns so the way the phone faces is at the top.
const domeXY = (p) => {
  const r = ((90 - clamp(p.el, 0, 90)) / 90) * 100, az = (p.az - (opt.heading || 0)) * RAD;
  return [r * Math.sin(az), -r * Math.cos(az)];
};
// The compass round the dome: north up, or turned with the phone (letters kept upright).
function skyCompass() {
  const h = opt.heading;
  if (h == null) return COMPASS;
  let s = `<g transform="rotate(${(-h).toFixed(1)})">${BEZEL}</g>`;
  for (const [l, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
    const a = (az - h) * RAD;
    s += `<text class="compass${l === "N" ? " north" : ""}" x="${(106.5 * Math.sin(a)).toFixed(1)}" y="${(-106.5 * Math.cos(a) + 2).toFixed(1)}" text-anchor="middle">${l}</text>`;
  }
  return s + `<path class="facing" d="M0,-96.2L-2.4,-92L2.4,-92Z"/>`;
}
const skyPos = (home, a, t) => azEl(home, projected(a, t), (a.alt || 0) + ((a.vrate || 0) * t) / 60);

function domeStatic(state, dt) {
  placeBoxes = [];
  let s = opt.heading == null ? SPOKES(100 / 3) : `<g transform="rotate(${(-opt.heading).toFixed(1)})">${SPOKES(100 / 3)}</g>`;
  for (const el of [30, 60]) {
    const r = ((90 - el) / 90) * 100;
    s += `<circle class="ring" r="${r}"/>${ringLabel(r, el + "°")}`;
  }
  const facing = opt.heading == null ? "Sky view from home" : `Facing ${POINTS[Math.round(opt.heading / 22.5) % 16]}, ${String(Math.round(opt.heading) % 360).padStart(3, "0")}°`;
  s += note("legend", -111, 110.5, "start", [facing, "Centre: straight up", "Edge: the horizon"]);
  s += `<circle class="ring horizon" r="100"/>${HOME}${skyCompass()}`;
  placeBoxes.push({ x0: -5.5, x1: 5.5, y0: -5.5, y1: 5.5 });
  if (sky.sun.el > 0) {
    const [x, y] = domeXY(sky.sun);
    s += `<circle class="sun-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11"/><circle class="sun" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>`;
    placeBoxes.push({ x0: x - 5, x1: x + 5, y0: y - 5, y1: y + 5, soft: true });
  }
  const moon = moonPosition(Date.now(), state.home.lat, state.home.lon);
  if (moon.el > 0) {
    const [x, y] = domeXY(moon), ph = moonPhase(Date.now());
    s += `<g class="sky-moon" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${moonGlyph(4, ph.phase, ph.fraction)}</g>`;
    placeBoxes.push({ x0: x - 4.5, x1: x + 4.5, y0: y - 4.5, y1: y + 4.5, soft: true });
  }
  const h = state.hero;
  if (h && !h.on_ground && h.alt != null) {
    // the selected aircraft's path across the sky, and its highest point
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
      // labelled inward, toward the centre, where the path isn't
      const d = Math.hypot(x, y) || 1, lx = x - (x / d) * 7, ly = y - (y / d) * 7 + 1.5;
      s += `<circle class="sky-peak" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/><text class="peak-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${x > 0 ? "end" : "start"}">highest ${Math.round(best.el)}°</text>`;
    }
  }
  return s + heardNote(state);
}

// ---- the Map view's words ----
const city = (p) => (p && (p.city || p.name || p.iata)) || "";
function plainLine(a, state) {
  const r = a.route && a.route.plausible ? a.route : null, here = state.airport.iata;
  let where = "";
  if (r) where = r.dest.iata === here || a.local === "arriving" ? `from ${city(r.origin)}` : `to ${city(r.dest)}`;
  else if (a.hospital) where = hospitalShort(a.hospital);
  else if (a.local === "arriving") where = "landing";
  else if (a.local === "departing") where = "just took off";
  const alt = a.alt == null ? "" : `${Math.round(a.alt / 100) * 100 >= 1000 ? (Math.round(a.alt / 100) * 100).toLocaleString("en-US") : Math.max(0, Math.round(a.alt / 50) * 50)} ft`;
  return [where, alt].filter(Boolean).join(" · ");
}

// Simple's labels: the selected aircraft by flight and height, an arrival by its landing number,
// anything worth a look by what it is; everything else has none.
function simpleLabel(a, isHero) {
  const v = a.vrate || 0, trend = v > 300 ? " ↑" : v < -300 ? " ↓" : "";
  if (isHero || a.notable === "emergency") return { text: boardFlight(ident(a)), sub: a.alt == null ? "" : `${num(a.alt)} ft${trend}` };
  if (a.activity === "arr" && a.seq) return { text: String(a.seq), sub: "", seq: true };
  if (a.notable) { const k = kind(a); return { text: k[0].toUpperCase() + k.slice(1), sub: a.hospital ? hospitalShort(a.hospital) : "" }; }
  return { text: "", sub: "" };
}
// A short track as segments, fading with age.
function tailSegs(home, pts, k) {
  const xy = pts.map(([lat, lon]) => { const o = offset(home, { lat, lon }); return [(o.x * k).toFixed(1), (-o.y * k).toFixed(1)]; });
  let s = "";
  for (let i = 1; i < xy.length; i++) {
    const op = (0.1 + 0.5 * (i / xy.length) ** 1.5).toFixed(2);
    s += `<line x1="${xy[i - 1][0]}" y1="${xy[i - 1][1]}" x2="${xy[i][0]}" y2="${xy[i][1]}" opacity="${op}"/>`;
  }
  return s;
}

// ---- the ATC style's fixed parts ----
// The compass along the square's edge: a tick every 5°, the bearing every 10°.
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

// The System Status Area, top left: indicator, clock, status, range and PTL length, altimeter,
// active special purpose codes, then the runways in use and the wind.
function ssa(state) {
  const w = state.weather, f = state.flow, m = w && /\bA(\d\d)(\d\d)\b/.exec(w.raw || "");
  ssaAltimeter = m ? `${m[1]}.${m[2]}` : "";
  const wind = w && w.wind_kt != null ? `${w.wind_kt ? String(w.wind_dir ?? 0).padStart(3, "0") : "000"}/${pad2(w.wind_kt)}${w.gust_kt ? "G" + w.gust_kt : ""}` : "";
  const spc = [...new Set([...state.aircraft, ...(state.beyond || [])].map(spcOf).filter(Boolean))];
  const gi = [f && "RWY " + f.runways.replace(/\s*\/\s*/g, " "), wind && "WIND " + wind].filter(Boolean);
  const rows = [[ssaClock(), "", "ssa-time"], ["OK/OK/NA"], [`${opt.range}NM PTL: ${opt.tracks ? "1.0" : "0.0"}`],
    ssaAltimeter && [`${state.airport.iata || state.airport.icao} ${ssaAltimeter}A`], spc.length && [spc.join(" "), "alert"], ...gi.map((t) => [t])].filter(Boolean);
  const x = -SQ + 13.5, y = -SQ + 20;
  let s = `<g class="ssa-mark" transform="translate(${x + 2.2},${y - 8.5})"><path class="tri" d="M-1.7,-1.2H1.7L0,1.75Z"/><rect x="-2.2" y="-2.2" width="4.4" height="4.4"/></g>`;
  s += `<text class="ssa" x="${x}" y="${y}">` + rows.map(([t, cls, id], i) =>
    `<tspan x="${x}"${i ? ' dy="1.3em"' : ""}${cls ? ` class="${cls}"` : ""}${id ? ` id="${id}"` : ""}>${esc(t)}</tspan>`).join("") + `</text>`;
  // labels keep clear of it: monospaced at 4 px (the kiosk's 5.4, a phone's 4.8), 0.6 em a character, 1.3 em a line
  const cl = document.documentElement.classList, fs = cl.contains("kiosk") ? 5.4 : cl.contains("phone") ? 4.8 : 4;
  placeBoxes.push({ x0: x - 1, x1: x + 1 + Math.max(...rows.map((r) => r[0].length)) * fs * 0.6,
    y0: y - 12, y1: y + (rows.length - 1) * fs * 1.3 + fs * 0.4 });
  return s;
}

// Class B, C and D outlines, each labelled with its ceiling over its floor in hundreds of feet ("40/17"; SFC).
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

// VOR and TACAN stations: a hexagon and the identifier, on whichever side is clear (or left off).
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
  let s = `<g clip-path="url(#scope-clip)">${mapLayer(home, k, based, based && CHART_STYLES.has(bm.style))}${runwayLayer(state, k)}${tfrLayer(state, k)}${fieldsLayer(state, k)}${helipadLayer(state, k)}</g>`;
  s += SPOKES(rings[0] * k);
  for (const r of rings) {
    s += `<circle class="ring" r="${r * k}"/>${ringLabel(r * k, Math.round(r) + " nm")}`;
    const d = r * k * Math.SQRT1_2;
    placeBoxes.push({ x0: d + 1, x1: d + 13, y0: -d - 5.5, y1: -d - 0.5, soft: true });          // aircraft labels steer around it
  }
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>${COMPASS}`;
  const keyed = opt.tracks && !opt.simple && state.hero && state.hero.path && state.hero.path.length > 1;
  s += note("legend", -111, keyed ? 105.25 : 110.5, "start", opt.simple ? [`${R} nm around home`]
    : [`${R} nm around home`, "035↑ 3,500 ft, climbing", opt.tracks ? "Line: 1 minute ahead" : ""].filter(Boolean));
  if (keyed) s += pathKey(-111, 110.5);
  const ap = offset(home, state.airport);
  if (Math.hypot(ap.x, ap.y) < R) {
    s += `<text class="apt-label" x="${ap.x * k}" y="${-ap.y * k + 9}" text-anchor="middle">${esc(state.airport.iata)}</text>${runwaysFor(state).length ? "" : `<rect class="apt-mark" x="${ap.x * k - 2.5}" y="${-ap.y * k - 2.5}" width="5" height="5"/>`}`;
    placeBoxes.push({ x0: ap.x * k - 6, x1: ap.x * k + 6, y0: -ap.y * k + 4.5, y1: -ap.y * k + 10, soft: true });     // labels steer around the airport's name
  }
  for (const a of state.aircraft) {
    if (!a.on_ground) continue;
    const o = offset(home, a);
    if (Math.hypot(o.x, o.y) < R) s += `<circle class="blip gnd" cx="${o.x * k}" cy="${-o.y * k}" r="1.1"/>`;
  }
  placeBoxes.push({ x0: -5.5, x1: 5.5, y0: -5.5, y1: 5.5 });          // home's reticle
  return s + HOME + heardNote(state);
}

// The Map view's own marks: home, the airport, and a note of what's shown.
function mapStatic(state) {
  const k = K(), home = state.home, miles = Math.round(opt.range * 1.15078);
  placeBoxes = [{ x0: -4, x1: 22, y0: -4, y1: 4 }];
  let s = `<g class="map-home"><circle r="3.2"/><circle class="dot" r="1.3"/></g><text class="map-label" x="5" y="1.7">Home</text>`;
  const ap = offset(home, state.airport), ax = ap.x * k, ay = -ap.y * k;
  if (inView(ax, ay) && Math.hypot(ap.x, ap.y) > 1.5) {
    const name = `${state.airport.iata} airport`;
    s += `<g class="map-apt" transform="translate(${ax.toFixed(1)},${ay.toFixed(1)})"><rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1"/>` +
      `<path d="M0,-1.8L.45,-.5L1.9,.3V.8L.45,.35V1.1L.9,1.5V1.8L0,1.55L-.9,1.8V1.5L-.45,1.1V.35L-1.9,.8V.3L-.45,-.5Z"/></g>` +
      `<text class="map-label" x="${(ax + 4).toFixed(1)}" y="${(ay + 1.7).toFixed(1)}">${esc(name)}</text>`;
    placeBoxes.push({ x0: ax - 3, x1: ax + 5 + name.length * 3, y0: ay - 4, y1: ay + 4 });
  }
  // the hospital a medical helicopter is going to, or has just left
  for (const h of hospitalsInUse(state).values()) {
    const o = offset(home, h), hx = o.x * k, hy = -o.y * k;
    if (!inView(hx, hy)) continue;
    s += `<g class="map-hosp" transform="translate(${hx.toFixed(1)},${hy.toFixed(1)})"><rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1.1"/><path d="${H_MARK}"/></g>` +
      `<text class="map-label" x="${(hx + 4).toFixed(1)}" y="${(hy + 1.7).toFixed(1)}">${esc(h.name)}</text>`;
    placeBoxes.push({ x0: hx - 3, x1: hx + 5 + h.name.length * 3, y0: hy - 4, y1: hy + 4 });
  }
  // the note sits just above the buttons along the foot of the panel
  const note = `Live flights within ${miles} miles of home`, foot = UI.reduce((y, b) => (b.y1 >= MY - 0.5 ? Math.min(y, b.y0) : y), MY);
  const nx = -MX + 2, ny = foot - 10;
  s += `<g class="map-note"><rect x="${nx}" y="${ny}" width="${note.length * 2.25 + 6}" height="8" rx="2"/>` +
    `<text x="${nx + 3}" y="${ny + 5.4}">${esc(note)}</text></g>`;
  placeBoxes.push({ x0: nx - 1, x1: nx + note.length * 2.25 + 8, y0: ny - 1, y1: ny + 9 }, ...UI);
  return s;
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
        placeBoxes.push({ x0: cx - 5, x1: cx + 5, y0: y - 4.5, y1: y + 1, soft: true });
      }
    }
  }
  return s;
}

// The small airfields nearby, as a sectional shows them: a circle with the runways inside at
// their true headings (not to scale), and the field's code.
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
    placeBoxes.push({ x0: o.x * k - 5, x1: o.x * k + 5, y0: -o.y * k - 2.5, y1: -o.y * k + 8.5, soft: true });
  }
  return s;
}

// Hospital helipads: an H in a circle (Detailed). One a medical helicopter is using is drawn in
// the medical blue with its name, in Simple too.
function hospitalsInUse(state) {
  const out = new Map();
  for (const a of state.aircraft) if (a.hospital && !a.on_ground) out.set(a.hospital.code, a.hospital);
  return out;
}
const H_MARK = "M-.85,-1.1V1.1M.85,-1.1V1.1M-.85,0H.85";
function helipadLayer(state, k) {
  let s = "";
  const used = hospitalsInUse(state);
  for (const p of state.airport.helipads || []) {
    const o = offset(state.home, p), x = o.x * k, y = -o.y * k, dest = used.has(p.code);
    if (Math.hypot(x, y) > 96) continue;
    s += `<g class="helipad${dest ? " dest" : ""}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="2.1"/><path d="${H_MARK}"/></g>`;
    placeBoxes.push({ x0: x - 2.5, x1: x + 2.5, y0: y - 2.5, y1: y + 2.5, soft: true });
    if (dest) {
      s += `<text class="helipad-label" x="${x.toFixed(1)}" y="${(y + 7.4).toFixed(1)}" text-anchor="middle">${esc(p.short)}</text>`;
      placeBoxes.push({ x0: x - p.short.length * 1.6, x1: x + p.short.length * 1.6, y0: y + 3, y1: y + 8.5, soft: true });
    }
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

// ---- persistent aircraft elements ----
const live = new Map();     // hex -> { g, icon, pos, sym, vec, leader, hist, l0, tag, sub, trk, segs, tail, x, y, rot, slot, ... }
let lastFrame = 0, layerMode = null, staticKey = null, baseKey = null, lastSecond = -1;

// The map under the radar, from the server's chart layers. Rebuilt only when the zoom or view
// changes, so it never flickers.
function drawBase(svg, state, mode) {
  const g = svg.querySelector("#s-base"), charts = state.charts || { map: state.basemap };
  const layers = charts.layers || {}, bm = opt.sky ? null : opt.map ? layers[opt.mapStyle] : opt.atc ? charts.atc : charts.map;
  // the satellite imagery has no names on it: Esri's roads and place names go over it
  const over = opt.map && opt.mapStyle === "sat" ? [layers.roads, layers.places].filter((l) => l && l.enabled) : [];
  const R = opt.range, k = K();
  const box = svg.getBoundingClientRect(), unitsPx = Math.min(box.width, box.height) / 224;
  const screenPxPerNm = unitsPx * k * (window.devicePixelRatio || 1);
  if (!bm || !bm.enabled || !unitsPx) {
    if (baseKey !== "none") { g.innerHTML = ""; baseKey = "none"; }
    return;
  }
  // the square displays reach R east, west, north and south, so their corners a little further
  const layout = tileLayout(state.home, R * (opt.map ? (Math.max(MX, MY) / SQ) * 1.02 : square() ? 1.45 : 1.05), screenPxPerNm, bm);
  const key = `${layout.z}|${R}|${state.home.lat},${state.home.lon}|${bm.layer}|${bm.style}|${opt.atc}|${opt.map}|${opt.mapStyle}|${MX.toFixed(1)},${MY.toFixed(1)}`;
  if (key === baseKey) return;
  baseKey = key;
  g.style.opacity = opt.atc || opt.map ? "" : bm.opacity;          // the ATC chart's dimming is in the stylesheet; the Map view's map is full strength
  g.setAttribute("class", `basemap ${bm.style}${opt.atc ? " atc-chart" : ""}${opt.map ? " plain-map" : ""}`);
  const images = (prefix) => layout.tiles.map((t) => `<image href="${t.url.replace(/^tiles\/(?:[a-z-]+\/)?/, prefix)}" x="${(t.x0 * k).toFixed(2)}" y="${(-t.y0 * k).toFixed(2)}"
    width="${((t.x1 - t.x0) * k + 0.15).toFixed(2)}" height="${((t.y0 - t.y1) * k + 0.15).toFixed(2)}" preserveAspectRatio="none"/>`).join("");
  const prefixOf = (l) => (l.layer && l.layer !== "map" ? `tiles/${l.layer}/` : "tiles/");
  g.innerHTML = images(prefixOf(bm)) + over.map((l) => `<g class="overlay">${images(prefixOf(l))}</g>`).join("");
}

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// A filter mapping a tile's greys onto three colours: darkest to `water`, middle to `land`, lightest to `road`.
function chartTint(id, water, land, road) {
  const ch = (i) => [water[i], water[i], (water[i] + land[i]) / 2, land[i], (land[i] + road[i]) / 2, ...Array(6).fill(road[i])].map((v) => (v / 255).toFixed(3)).join(" ");
  return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>` +
    `<feFuncR type="table" tableValues="${ch(0)}"/><feFuncG type="table" tableValues="${ch(1)}"/><feFuncB type="table" tableValues="${ch(2)}"/></feComponentTransfer></filter>`;
}

function ensureLayers(svg) {
  if (svg.querySelector("#s-static")) return;
  svg.innerHTML = "";
  const defs = el("defs", { id: "s-defs" }, svg);
  el("clipPath", { id: "scope-clip" }, defs);
  const hatch = el("pattern", { id: "tfr-hatch", width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 3, class: "tfr-hatch-line" }, hatch);
  // The chart style's dark grey street map, recoloured as a chart, by day and by night.
  defs.insertAdjacentHTML("beforeend", chartTint("chart-tint", [182, 204, 220], [237, 240, 230], [252, 252, 248]) +
    chartTint("chart-tint-night", [7, 18, 34], [28, 45, 63], [58, 77, 98]));
  defs.insertAdjacentHTML("beforeend", `<radialGradient id="sky-grad"><stop class="sky-z" offset=".05"/><stop class="sky-h" offset="1"/></radialGradient>`);
  el("g", { id: "s-bg" }, svg);
  el("g", { id: "s-base", "clip-path": "url(#scope-clip)" }, svg);
  for (const id of ["s-static", "s-trails", "s-craft"]) el("g", { id }, svg);
}

// The display's outline, which also clips the map: a disc, or the ATC style's square screen.
function setShape(svg) {
  const shape = opt.atc ? `<rect x="${-SQ}" y="${-SQ}" width="${2 * SQ}" height="${2 * SQ}"/>`
    : opt.map ? `<rect x="${-MX}" y="${-MY}" width="${2 * MX}" height="${2 * MY}"/>` : `<circle r="100"/>`;
  svg.querySelector("#scope-clip").innerHTML = shape;
  svg.querySelector("#s-bg").innerHTML = shape.replace(/^<(\w+)/, '<$1 class="scope-bg"');
}

function craftFor(svg, hex) {
  let c = live.get(hex);
  if (c) return c;
  const g = el("g", { "data-hex": hex, class: "craft entering" }, svg.querySelector("#s-craft"));
  el("circle", { r: 10, fill: "transparent" }, g);                    // generous touch target
  const ring = el("circle", { class: "sel-ring", style: "display:none" }, g);      // chart style: the selected aircraft
  const vec = el("line", { class: "vec" }, g);                         // where it will be in a minute
  const leader = el("line", { class: "leader" }, g);                   // ATC style: target to data block
  const glow = el("circle", { class: "glow" }, g);                     // a soft ring, once, for something new
  const icon = el("path", { class: "blip", d: opt.atc ? OCTAGON : "" }, g);
  // a medical flight's mark (chart style and Map view)
  const med = el("g", { class: "med", style: "display:none" }, g);
  el("rect", { x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1.1 }, med);
  el("path", { d: MED_CROSS }, med);
  // ATC style: the position symbol on the target, a letter, or a drawn * or +
  const pos = el("text", { class: "pos", "text-anchor": "middle", dy: "0.36em" }, g), sym = el("path", { class: "sym" }, g);
  const hist = el("g", { class: "hist" }, svg.querySelector("#s-trails"));
  // hidden until placed: a dot without a position would sit on home
  for (let i = 0; i < HISTORY; i++) el("circle", { r: 1.05, class: `h${i}`, style: "display:none" }, hist);
  const l0 = el("text", { class: "tag-top" }, g), seqring = el("circle", { class: "seqring", style: "display:none" }, g);
  // the label stays hidden until it's first placed, on the next update
  const tag = el("text", { class: "tag", style: "display:none" }, g), sub = el("text", { class: "tag-sub", style: "display:none" }, g);
  // the chart style's short track behind every other aircraft: its last two minutes
  const tl = el("g", { class: "tl" }, svg.querySelector("#s-trails")), tlSegs = el("g", {}, tl), tlEnd = el("line", {}, tl);
  // the selected aircraft's track: runs rebuilt on each update, and the stretch from its last
  // point to the aircraft, moved every frame
  const trk = el("g", { class: "trk" }, svg.querySelector("#s-trails")), segs = el("g", {}, trk), tail = el("line", {}, trk);
  c = { g, glow, icon, med, pos, sym, vec, leader, hist, l0, tag, sub, trk, segs, tail, ring, seqring, tl, tlSegs, tlEnd, x: null, y: null, rot: 0, slot: 0, text: "", symbol: null, vx: 0, vy: 0, subs: [""], act: null, pri: 9, hide: false };
  live.set(hex, c);
  requestAnimationFrame(() => g.classList.remove("entering"));
  return c;
}

// Something new: a ring round the aircraft swells and fades twice.
export function flashCraft(hex) {
  const c = live.get(hex);
  if (!c) return;
  c.glow.setAttribute("r", ((c.reach || 4.5) + 2.5).toFixed(2));
  c.g.classList.remove("fresh");
  void c.g.getBBox();
  c.g.classList.add("fresh");
  clearTimeout(c.freshTimer);
  c.freshTimer = setTimeout(() => c.g.classList.remove("fresh"), 3200);
}

function dropCraft(hex) {
  const c = live.get(hex);
  c.g.remove();
  c.trk.remove();
  c.tl.remove();
  c.hist.remove();
  live.delete(hex);
}

// Where a label can go. Chart style: a corner beside the aircraft. ATC style: the end of a leader
// line in any of the eight directions.
const CHART_CORNERS = [[7, -2.5, "start"], [7, 7.5, "start"], [-7, -2.5, "end"], [-7, 7.5, "end"], [7, 2.5, "start"], [-7, 2.5, "end"]];
const slotCount = () => (opt.atc ? DIRS.length : CHART_CORNERS.length);
function slot(c, i) {
  if (!opt.atc) {             // further out beside a large icon (a heavy, the selected aircraft)
    const [tx, ty, anchor] = CHART_CORNERS[i], out = Math.max(0, (c.reach || 0) - 6.5), k = c.k || 1;
    // a landing number's ring sits close in, just off the icon
    if (c.seqtag) return { tx: Math.sign(tx) * Math.max(3.4, (c.reach || 4) * 0.8), ty: (ty === -2.5 ? -1.4 : ty === 7.5 ? 7.6 : 3.2) * k, anchor };
    return { tx: tx * k + Math.sign(tx) * out, ty: ty * k, anchor };
  }
  const d = DIRS[i], ex = d.ux * c.lead, ey = d.uy * c.lead;
  return { d, ex, ey, tx: ex + (d.right ? -c.gap : c.gap), ty: ey, anchor: d.right ? "end" : "start" };
}

// A label hidden last time (or not yet placed) is shown for the measuring, as hidden text
// measures nothing; applyLabel sets it after.
function measure(c) {
  if (c.tag.style.display === "none") c.tag.style.display = c.sub.style.display = "";
  const fs = (e, d) => parseFloat(getComputedStyle(e).fontSize) || d;
  if (opt.atc) {
    // monospaced, so a block is as wide as its longest line
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
  // the offsets are drawn for labels up to 8 px; larger lettering (the wall panel's) spreads them in step
  const k = c.k = Math.max(1, fs(c.tag, 5) / 8);
  c.up = 3.2 * k + fs(c.tag, 5) * 0.75;         // cap height above the callsign's baseline
  c.down = c.subs[0] ? 3.3 * k + fs(c.sub, 4.2) * 0.25 : fs(c.tag, 5) * 0.25 - 3.2 * k;     // descent below the last line's baseline
  if (c.seqtag) {           // a landing number in its ring, the ring's centre level with the first line's middle
    c.ringR = fs(c.tag, 4.4) * 0.62 + 0.9;
    c.w = 2 * c.ringR; c.up = 3.2 * k + c.ringR; c.down = c.ringR - 3.2 * k;
  }
}
function labelBox(c, i) {
  const s = slot(c, i), x0 = s.anchor === "start" ? c.x + s.tx : c.x + s.tx - c.w;
  return { x0, x1: x0 + c.w, y0: c.y + s.ty - c.up, y1: c.y + s.ty + c.down };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Place each label clear of other labels, aircraft, the compass and the edge. Run on each data
// update, not every frame, keeping the current place unless clearly worse, so labels don't flicker.
function placeLabels(heroHex) {
  const placed = opt.atc || opt.map ? [...placeBoxes] : opt.heading != null ? [...placeBoxes, { x0: -6, x1: 6, y0: -98, y1: -91 }] : [...placeBoxes, ...BEARING_BOXES,
    { x0: -5, x1: 5, y0: -112, y1: -100 }, { x0: 101, x1: 112, y0: -6, y1: 6 }, { x0: -5, x1: 5, y0: 102, y1: 114 }, { x0: -112, x1: -101, y0: -6, y1: 6 }];
  const all = [...live.values()].filter((c) => c.x != null), r = (c) => (opt.atc ? 3 : Math.max(3.5, c.reach || 4.5));
  const blips = all.map((c) => ({ x0: c.x - r(c), x1: c.x + r(c), y0: c.y - r(c), y1: c.y + r(c), c }));
  for (const c of all) if (c.medOn) blips.push({ x0: c.x + c.medX - c.medR, x1: c.x + c.medX + c.medR, y0: c.y + c.medY - c.medR, y1: c.y + c.medY + c.medR, c: null });
  for (const c of all) for (const f of [0.4, 0.7, 1]) {
    const x = c.x + c.vx * f, y = c.y + c.vy * f;
    if (Math.hypot(c.vx, c.vy) * f > 5) blips.push({ x0: x - 2, x1: x + 2, y0: y - 2, y1: y + 2, c: null });   // its own line too
  }
  const labelled = all.filter((c) => c.text);
  for (const c of labelled) if (c.fallback) { c.fallback = false; showFull(c); }
  labelled.forEach(measure);
  labelled.sort((a, b) => (b.hex === heroHex) - (a.hex === heroHex) || a.pri - b.pri);
  const edge = opt.atc ? SQ - 9.5 : opt.map ? MX - 1.5 : 112;          // the ATC style keeps data blocks inside the compass
  const edgeY = opt.map ? MY - 1.5 : edge;
  const pick = (c) => {
    // the chart style never leaves off the selected aircraft's label, so running off the edge
    // costs it far more than sitting over a neighbour
    const offCost = !opt.atc && !opt.map && c.hex === heroHex ? 400 : 20;
    const score = (i) => {
      const b = labelBox(c, i);
      let s = placed.reduce((n, p) => n + overlap(b, p), 0) + blips.reduce((n, p) => n + (p.c === c ? 0 : overlap(b, p)), 0);
      s += (Math.max(0, b.x1 - edge) + Math.max(0, -edge - b.x0)) * offCost;
      if (square()) s += (Math.max(0, b.y1 - edgeY) + Math.max(0, -edgeY - b.y0)) * 20 + (opt.atc && i ? 1.5 : 0);
      return s - (i === c.slot ? 6 : 0);                                    // stickiness
    };
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < slotCount(); i++) { const s = score(i); if (s < bestScore) { bestScore = s; best = i; } }
    c.slot = best;
    return labelBox(c, best);
  };
  for (const c of labelled) {
    // the chart style leaves off a label that would touch another label or the compass, cover an
    // aircraft by more than a quarter of itself, or run off the edge. A fixed name (soft) only
    // steers a label: if there's no better place, the name fades under it (giveWay).
    let b = pick(c);
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    const textHit = placed.reduce((n, p) => n + (p.soft ? 0 : overlap(b, p)), 0), iconHit = blips.reduce((n, p) => n + (p.c === c ? 0 : overlap(b, p)), 0);
    const off = Math.max(0, b.x1 - edge) + Math.max(0, -edge - b.x0) + (square() ? Math.max(0, b.y1 - edgeY) + Math.max(0, -edgeY - b.y0) : 0);
    const key = c.act === "arr" || c.act === "dep";          // arrivals and departures may sit over an icon
    // (the Map view labels everything, except on the wall panel, whose large lettering can't)
    c.hide = !opt.atc && (!opt.map || opt.wall) && c.hex !== heroHex && !c.seqtag && (textHit > 0.03 * area || (!key && iconHit > 0.25 * area) || off > 1.5);
    // an arrival keeps its landing number in its ring (until the next update tries its whole label again)
    if (c.hide && c.seqNum && c.full) {
      c.fallback = c.seqtag = true; c.tag.classList.add("seqtag");
      c.text = c.tag.textContent = String(c.seqNum); c.subs = [""]; c.sub.textContent = "";
      measure(c);
      b = pick(c);
      c.hide = false;
    }
    // with a soft margin round it, so two labels side by side don't read as one block (the chart style)
    if (!c.hide) placed.push(b, ...(opt.atc || opt.map ? [] : [{ x0: b.x0 - 1.5, x1: b.x1 + 1.5, y0: b.y0 - 1.5, y1: b.y1 + 1.5, soft: true }]));
  }
}

// Back from a landing number to the whole label, to see whether it fits now.
function showFull(c) {
  c.seqtag = false; c.tag.classList.remove("seqtag");
  c.text = c.tag.textContent = c.full.text; c.subs = [c.full.sub]; c.sub.textContent = c.full.sub;
}

function applyLabel(c) {
  const shown = !!c.text && !c.hide;
  c.tag.style.display = c.sub.style.display = shown ? "" : "none";
  c.seqring.style.display = shown && c.seqtag ? "" : "none";
  if (!shown) return;
  const s = slot(c, c.slot);
  const put = (e, y) => { e.setAttribute("x", s.tx.toFixed(2)); e.setAttribute("y", y.toFixed(2)); e.setAttribute("text-anchor", s.anchor); };
  if (c.seqtag) {
    const R = c.ringR, cx = s.anchor === "start" ? s.tx + R : s.tx - R, cy = s.ty - 3.2 * (c.k || 1);
    c.seqring.setAttribute("cx", cx.toFixed(2)); c.seqring.setAttribute("cy", cy.toFixed(2)); c.seqring.setAttribute("r", R.toFixed(2));
    c.tag.setAttribute("x", cx.toFixed(2)); c.tag.setAttribute("y", (cy + R * 0.42).toFixed(2)); c.tag.setAttribute("text-anchor", "middle");
    return;
  }
  if (!opt.atc) { const k = c.k || 1; put(c.tag, s.ty - 3.2 * k); put(c.sub, s.ty + 3.3 * k); return; }
  // the leader starts at the target's edge and ends level with the block's first line
  const f = c.fs, base = s.ty + f * 0.36;
  put(c.l0, base - f); put(c.tag, base); put(c.sub, base + f);
  c.leader.setAttribute("x1", (s.d.ux * 2.9).toFixed(2)); c.leader.setAttribute("y1", (s.d.uy * 2.9).toFixed(2));
  c.leader.setAttribute("x2", s.ex.toFixed(2)); c.leader.setAttribute("y2", s.ey.toFixed(2));
}

// What STARS shows. A track with a flight plan (a callsign on a code other than 1200) gets a full
// data block: callsign; altitude in hundreds of feet, ground speed in tens of knots, V for VFR
// and the wake category, taking turns with the type. Its symbol: A arrivals, D departures, C the
// rest. The selected aircraft always has a full block. A track without a flight plan shows * with
// its altitude, or + when it reports none.
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

// ATC style: history dots at the selected aircraft's reported positions (`trail`), 4.5 s apart
// (as near as the feed's update rate allows), newest first.
function historyDots(c, trail, k, home, trailS) {
  const dots = c.hist.children, t = trail || [], step = Math.max(1, Math.round(HISTORY_S / (trailS || HISTORY_S)));
  let n = 0;
  for (let i = t.length - 1 - step; i >= 0 && n < HISTORY; i -= step, n++) {
    const o = offset(home, { lat: t[i][0], lon: t[i][1] });
    dots[n].setAttribute("cx", (o.x * k).toFixed(1)); dots[n].setAttribute("cy", (-o.y * k).toFixed(1)); dots[n].style.display = "";
  }
  for (; n < HISTORY; n++) dots[n].style.display = "none";
}

// The note's box, fitted to its text as drawn, and kept clear of the labels.
function fitMapNote(svg) {
  const t = svg.querySelector(".map-note text"), r = svg.querySelector(".map-note rect");
  let w = 0;
  try { w = t.getComputedTextLength(); } catch (e) { /* not laid out yet */ }
  if (!w) return;
  r.setAttribute("width", (w + 6).toFixed(1));
  const x0 = +r.getAttribute("x"), y0 = +r.getAttribute("y");
  placeBoxes.push({ x0: x0 - 1, x1: x0 + w + 8, y0: y0 - 1, y1: y0 + 9 });
}

// The Map view's viewBox is widened (or made taller) to the panel's shape, the shorter side the
// radar's usual 224 units.
const SQUARE_BOX = "-112 -112 224 224";
function mapShape(svg) {
  const r = svg.getBoundingClientRect(), panel = svg.parentElement.getBoundingClientRect();
  if (!r.width || !r.height) return `|${MX}x${MY}`;
  const u = 224 / Math.min(r.width, r.height);           // drawing units per CSS px
  const vx = (r.width * u) / 2, vy = (r.height * u) / 2;
  MX = vx - 1; MY = vy - 1;
  UI = [...svg.parentElement.querySelectorAll(":scope > .seg, :scope > .scope-tools > .seg, :scope > .attrib")]
    .map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height)
    .map((b) => ({ x0: (b.left - r.left) * u - vx - 2, x1: (b.right - r.left) * u - vx + 2, y0: (b.top - r.top) * u - vy - 2, y1: (b.bottom - r.top) * u - vy + 2 }));
  const box = `${(-vx).toFixed(2)} ${(-vy).toFixed(2)} ${(2 * vx).toFixed(2)} ${(2 * vy).toFixed(2)}`;
  if (svg.getAttribute("viewBox") !== box) svg.setAttribute("viewBox", box);
  return `|${Math.round(r.width)}x${Math.round(r.height)}|${Math.round(panel.width)}`;
}

// ---- entry point: called every animation frame ----
export function drawScope(svg, state, now, stateAt, mode, options = {}) {
  ensureLayers(svg);
  // aircraft glide on from their last reports, but past MOVE_ON_S with nothing new they stop where they are
  const dt = Math.min(MOVE_ON_S, (now - stateAt) / 1000), frameDt = lastFrame ? Math.min(1, (now - lastFrame) / 1000) : 1;
  lastFrame = now;
  const turned = mode === "sky" && options.heading != null ? Math.round(options.heading) % 360 : null;
  const spun = turned !== opt.heading;             // the phone turned: the sky turns with it at once
  opt = { atc: !!options.atc && mode === "radar", map: mode === "map", sky: mode === "sky", heading: turned, tracks: options.tracks !== false,
    range: options.range || state.tracking.radius_nm, mapStyle: options.mapStyle || "sat", simple: !!options.simple, wall: !!options.wall };
  svg.classList.toggle("simple", opt.simple && !opt.atc && !opt.map && !opt.sky);
  if (!opt.map && svg.getAttribute("viewBox") !== SQUARE_BOX) { svg.setAttribute("viewBox", SQUARE_BOX); MX = MY = SQ; UI = []; }
  const shape = opt.map ? mapShape(svg) : "";
  const layer = mode + (opt.atc ? ":atc" : "") + shape;
  if (layer !== layerMode) {                      // switching views or styles: start every aircraft fresh
    for (const hex of [...live.keys()]) dropCraft(hex);
    layerMode = layer;
    staticKey = null;
    setShape(svg);
    svg.classList.remove("fade-in"); void svg.getBBox(); svg.classList.add("fade-in");
  }
  drawBase(svg, state, mode);
  const key = `${layer}|${stateAt}|${map ? 1 : 0}|${opt.tracks}|${opt.range}|${opt.simple}|${opt.heading}`;
  const fresh = key !== staticKey;
  if (fresh) {
    staticKey = key;
    svg.querySelector("#s-static").innerHTML = opt.map ? mapStatic(state) : opt.sky ? domeStatic(state, dt) : radarStatic(state);
    if (opt.map) fitMapNote(svg);
    else if (!opt.atc) measureYielders(svg);
    layoutPathKey(svg);
    if (!opt.map && !opt.atc) clearKey(svg);
  }
  const wall = Date.now(), phase = clockPhase(wall);
  if (opt.atc && Math.floor(wall / 1000) !== lastSecond) {          // the status area's clock shows seconds
    lastSecond = Math.floor(wall / 1000);
    const t = svg.querySelector("#ssa-time");
    if (t) t.textContent = ssaClock();
  }

  const heroHex = state.hero && state.hero.hex, seen = new Set(), ease = 1 - Math.exp(-frameDt / 0.6), k = K();
  // with nothing overhead, Simple names the next aircraft over the house, as its side panel does
  const nextHex = !heroHex && state.next ? state.next.hex : null;
  const box = svg.getBoundingClientRect(), unitPx = Math.min(box.width, box.height) / 224;
  const boost = unitPx ? clamp(ICON_UNIT_PX / unitPx, 1, ICON_BOOST_MAX) : 1;
  // `beyond`: past the tracking radius, for a radar set to a longer range (not the sky view)
  const aircraft = opt.sky ? state.aircraft : [...state.aircraft, ...(state.beyond || [])];
  for (const a of aircraft) {
    if (a.on_ground || (opt.sky && a.alt == null)) continue;
    const p = place(state, a, dt);
    if (!p) continue;
    seen.add(a.hex);
    const c = craftFor(svg, a.hex), isHero = a.hex === heroHex;
    c.hex = a.hex;
    // ease toward the dead-reckoned position; jump if it's far off (new aircraft, big correction)
    const arrived = c.x == null;                 // new on the scope since the last update
    if (arrived || spun || Math.hypot(p.x - c.x, p.y - c.y) > 12) { c.x = p.x; c.y = p.y; c.rot = p.rot; }
    else {
      c.x += (p.x - c.x) * ease; c.y += (p.y - c.y) * ease;
      c.rot += (((p.rot - c.rot + 540) % 360) - 180) * ease;
    }
    c.g.setAttribute("transform", `translate(${c.x.toFixed(2)},${c.y.toFixed(2)})`);
    // the selected one a little larger, but not so much that an airliner passes for a heavy
    const size = (isHero ? 1.25 : 1) * p.scale * boost;
    if (!opt.atc) {
      const kind = a.icon || null;                 // its kind of traffic, as the server made it out
      if (kind !== c.kind || !c.ic) { c.kind = kind; c.ic = iconFor(kind); c.icon.setAttribute("d", c.ic.d); }
      c.reach = c.ic.r * size;
      c.icon.setAttribute("transform", `rotate(${c.ic.upright ? 0 : c.rot.toFixed(1)}) scale(${size})`);
    }
    const medOn = !opt.atc && !!a.medical;
    if (medOn !== !!c.medOn) { c.medOn = medOn; c.med.style.display = medOn ? "" : "none"; c.g.classList.toggle("medc", medOn); }
    if (medOn) {             // off the icon's upper left corner, as large as the icon is boosted; never turned
      const s = 1.45 * boost, d = (c.reach || 4.5) * 0.62 + 2.1;
      c.medX = -d; c.medY = -d; c.medR = 2.6 * s;
      c.med.setAttribute("transform", `translate(${(-d).toFixed(2)},${(-d).toFixed(2)}) scale(${s.toFixed(2)})`);
    }
    // the lead line: one minute ahead at its ground speed, from the nose, on the radar only
    const lead = opt.tracks && !opt.map && !opt.sky && a.gs && a.track != null ? (a.gs / 60) * k : 0;
    const sin = Math.sin(c.rot * RAD), cos = -Math.cos(c.rot * RAD), nose = opt.atc ? 2.3 : c.ic.nose * size;
    c.vx = sin * lead; c.vy = cos * lead;
    if (lead > nose) {
      c.vec.setAttribute("x1", (sin * nose).toFixed(2)); c.vec.setAttribute("y1", (cos * nose).toFixed(2));
      c.vec.setAttribute("x2", c.vx.toFixed(2)); c.vec.setAttribute("y2", c.vy.toFixed(2));
      c.vec.style.display = "";
    } else c.vec.style.display = "none";
    c.g.classList.toggle("hero", isHero);
    c.g.classList.toggle("coasting", !!a.coasting);      // a followed flight the feed left out: where it should be, faded
    c.trk.classList.toggle("hero", isHero);
    c.hist.classList.toggle("hero", isHero);
    const act = a.activity || "pass";
    if (act !== c.act) {
      if (c.act) c.g.classList.remove("c-" + c.act);
      c.g.classList.add("c-" + act); c.act = act;
    }
    const tlClass = `tl c-${act}${isHero ? " hero" : ""}`;
    if (c.tl.getAttribute("class") !== tlClass) c.tl.setAttribute("class", tlClass);
    c.pri = isHero || a.hex === nextHex ? 0 : act === "arr" ? 1 + (a.seq || 50) / 100 : act === "dep" ? 2 : act === "pass" ? 2.5 : 3 + a.dist / 100;
    const ringed = isHero && !opt.atc && !opt.map;
    c.ring.style.display = ringed ? "" : "none";
    if (ringed) c.ring.setAttribute("r", ((c.reach || 4) + 2.2).toFixed(2));
    let text, line0 = "", seqtag = false;
    c.full = null;              // Detailed's whole label, while an arrival shows only its landing number
    c.seqNum = !opt.atc && !opt.map && !opt.sky && act === "arr" ? a.seq || null : null;
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
    } else if (opt.map) {
      text = plainName(a); c.subs = [p.sub];               // the Map view's label, in words
    } else if (opt.sky) {
      // near the horizon only the selected aircraft is named: the rest crowd the edge
      const named = isHero || a.notable || p.el > 6;
      text = named ? ident(a) : ""; c.subs = [named ? p.sub : ""];
    } else if (opt.simple) {
      ({ text, sub: c.subs[0], seq: seqtag } = simpleLabel(a, isHero || a.hex === nextHex)); c.subs.length = 1;
      if (opt.wall && isHero) c.subs[0] = "";              // the wall panel's card gives its altitude, large
    } else {
      const r = a.route && a.route.plausible ? a.route : null;
      text = ident(a);
      c.subs = [p.sub + (a.activity === "arr" && a.rwy ? ` ${a.rwy}${a.seq ? ` #${a.seq}` : ""}` : a.activity === "dep" && r && r.dest.iata ? ` ${r.dest.iata}`
        : a.hospital ? ` ${a.hospital.state === "left" ? "from" : "to"} ${a.hospital.short}` : a.medical ? " medical" : "")];
      c.full = { text, sub: c.subs[0] };
      // an arrival whose whole label found no room keeps its landing number until the next update
      if (c.fallback && c.seqNum) { text = String(c.seqNum); c.subs = [""]; seqtag = true; }
    }
    if (!c.full || !seqtag) c.fallback = false;
    if (!!seqtag !== !!c.seqtag) { c.seqtag = !!seqtag; c.tag.classList.toggle("seqtag", c.seqtag); }
    if (text !== c.text) { c.text = text; c.tag.textContent = text; }
    if (c.l0.textContent !== line0) c.l0.textContent = line0;
    // the data block's timeshared field: phase 1 shows the first text, phases 2 and 3 the second
    const line2 = c.subs[phase === 1 || c.subs.length < 2 ? 0 : 1];
    if (c.sub.textContent !== line2) c.sub.textContent = line2;
    c.leader.style.display = opt.atc && text ? "" : "none";
    // only the selected aircraft shows where it has been: history dots (ATC) or its whole track (chart)
    const dots = opt.atc && opt.tracks && isHero;
    if (dots && (fresh || arrived)) historyDots(c, state.hero.trail, k, state.home, state.trail_s);
    c.hist.style.display = dots ? "" : "none";
    const path = !opt.atc && !opt.sky && !opt.simple && (opt.tracks || opt.map) && isHero && state.hero.path && state.hero.path.length ? state.hero.path : null;
    if (path && (fresh || !c.drawn)) {
      c.segs.innerHTML = pathRuns(state.home, path, k);
      const [lat, lon] = path[path.length - 1], o = offset(state.home, { lat, lon });
      c.tail.setAttribute("x1", (o.x * k).toFixed(1)); c.tail.setAttribute("y1", (-o.y * k).toFixed(1));
      c.tail.setAttribute("class", `b${band(a.alt ?? path[path.length - 1][2] * 100)}`);
      c.drawn = true;
    } else if (!path && c.drawn) { c.segs.innerHTML = ""; c.drawn = false; }
    c.trk.style.display = path ? "" : "none";
    if (path) { c.tail.setAttribute("x2", c.x.toFixed(1)); c.tail.setAttribute("y2", c.y.toFixed(1)); }
    // the short track behind each other aircraft; Simple draws it for the selected aircraft alone
    const tl = !opt.atc && !opt.map && !opt.sky && opt.tracks && (!opt.simple || isHero) && !path && a.tail && a.tail.length > 1 ? a.tail : null;
    if (tl && (fresh || !c.tlDrawn)) {
      c.tlSegs.innerHTML = tailSegs(state.home, tl, k);
      const [lat, lon] = tl[tl.length - 1], o = offset(state.home, { lat, lon });
      c.tlEnd.setAttribute("x1", (o.x * k).toFixed(1)); c.tlEnd.setAttribute("y1", (-o.y * k).toFixed(1));
      c.tlDrawn = true;
    } else if (!tl && c.tlDrawn) { c.tlSegs.innerHTML = ""; c.tlDrawn = false; }
    c.tl.style.display = tl ? "" : "none";
    if (tl) { c.tlEnd.setAttribute("x2", c.x.toFixed(1)); c.tlEnd.setAttribute("y2", c.y.toFixed(1)); }
  }
  for (const hex of [...live.keys()]) if (!seen.has(hex)) dropCraft(hex);
  if (fresh) { placeLabels(heroHex); for (const c of live.values()) applyLabel(c); }
  if (!opt.atc && !opt.map) giveWay();
}

// Each fixed name's box as drawn, added to the boxes aircraft labels keep clear of. The layer is
// rebuilt on each update: a name that had faded starts out faded, so it doesn't flash back.
function measureYielders(svg) {
  const was = new Set(yielders.filter((y) => y.off).map((y) => y.key)), els = [...svg.querySelectorAll(`#s-static :is(${YIELDING})`)];
  yielders = [];
  for (const e of els) {
    const key = `${e.getAttribute("class")}|${e.textContent}|${e.getAttribute("x")}|${e.getAttribute("y")}|${e.getAttribute("transform")}`, off = was.has(key);
    if (off) e.classList.add("yield");
    yielders.push({ e, key, off });
  }
  for (const y of yielders) {
    let b;
    try { b = y.e.getBBox(); } catch (err) { b = null; }       // not laid out yet
    // a mark placed by its transform (a helipad) measures in its own space: move it to where it's drawn
    const t = y.e.transform && y.e.transform.baseVal.numberOfItems ? y.e.transform.baseVal.consolidate().matrix : { e: 0, f: 0 };
    y.box = b && b.width ? { x0: b.x + t.e - 0.5, x1: b.x + t.e + b.width + 0.5, y0: b.y + t.f, y1: b.y + t.f + b.height, soft: true } : null;
    if (y.box) placeBoxes.push(y.box);
  }
  yielders = yielders.filter((y) => y.box);
}

// Fade out a fixed name while an aircraft or label covers it; back once clear by a margin, so it doesn't flicker.
function giveWay() {
  if (!yielders.length) return;
  const over = [];
  for (const c of live.values()) {
    if (c.x == null) continue;
    const r = Math.max(3, c.reach || 4.5);
    over.push({ x0: c.x - r, x1: c.x + r, y0: c.y - r, y1: c.y + r });
    // a label's box is its letters' cap height and descent: allow for the rest of the line above
    if (c.text && !c.hide && c.w) { const l = labelBox(c, c.slot); over.push({ x0: l.x0 - 0.5, x1: l.x1 + 0.5, y0: l.y0 - 1.2, y1: l.y1 + 0.5 }); }
  }
  for (const y of yielders) {
    const m = y.off ? 1.2 : 0, b = { x0: y.box.x0 - m, x1: y.box.x1 + m, y0: y.box.y0 - m, y1: y.box.y1 + m };
    const area = (y.box.x1 - y.box.x0) * (y.box.y1 - y.box.y0);
    const off = over.some((o) => overlap(b, o) > (y.off ? 0 : Math.max(0.5, 0.04 * area)));
    if (off !== y.off) { y.off = off; y.e.classList.toggle("yield", off); }
  }
}
