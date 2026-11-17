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
const RAD = Math.PI / 180;
const NS = "http://www.w3.org/2000/svg";
const CHAR_W = 3.35, LINE_H = 6.5;            // label metrics at the scope's 5.5-unit font
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
  // the hand-drawn rivers are only a stand-in for when there's no real map underneath
  if (!hasBasemap) for (const w of map.water || []) s += `<polyline class="water" stroke-width="${Math.max(1.2, w.width_nm * k)}" points="${pts(home, w.line, k)}"/>`;
  for (const r of map.runways || []) {
    const [a, b] = r.ends.map(([lat, lon]) => offset(home, { lat, lon }));
    const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, far = 12;   // nm of extended centreline
    s += `<line class="approach" x1="${(a.x - ux * far) * k}" y1="${-(a.y - uy * far) * k}" x2="${(b.x + ux * far) * k}" y2="${-(b.y + uy * far) * k}"/>`;
    s += `<line class="runway" x1="${a.x * k}" y1="${-a.y * k}" x2="${b.x * k}" y2="${-b.y * k}"/>`;
  }
  placeBoxes = [];
  for (const p of map.places || []) {
    const o = offset(home, { lat: p.at[0], lon: p.at[1] });
    s += `<text class="place" x="${o.x * k}" y="${-o.y * k}" text-anchor="middle">${esc(p.name)}</text>`;
    const w = p.name.length * 3.1;
    placeBoxes.push({ x0: o.x * k - w / 2, x1: o.x * k + w / 2, y0: -o.y * k - 4.5, y1: -o.y * k + 1 });
  }
  return s;
}

// Ring labels sit on the north-east diagonal, clear of the N/E letters and of most traffic.
function ringLabel(r, text) {
  const d = r * Math.SQRT1_2;
  return `<text class="ring-label" x="${d + 1.5}" y="${-d - 1.5}">${text}</text>`;
}
// A bezel of degree marks just outside the edge, as on a compass card: every 5°, longer every
// 10° and 30°. The cardinal points are left to their letters.
const BEZEL = (() => {
  const minor = [], major = [];
  for (let a = 5; a < 360; a += 5) {
    if (a % 90 === 0) continue;
    const r2 = a % 30 === 0 ? 104.5 : a % 10 === 0 ? 103 : 102, s = Math.sin(a * RAD), c = -Math.cos(a * RAD);
    (a % 30 === 0 ? major : minor).push(`M${(100.8 * s).toFixed(2)},${(100.8 * c).toFixed(2)}L${(r2 * s).toFixed(2)},${(r2 * c).toFixed(2)}`);
  }
  return `<path class="bezel" d="${minor.join("")}"/><path class="bezel major" d="${major.join("")}"/>`;
})();
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
  const k = 100 / state.tracking.radius_nm, o = offset(state.home, projected(a, t));
  if (Math.hypot(o.x, o.y) * k > 100) return null;
  return { x: o.x * k, y: -o.y * k, rot: a.track || 0, scale: 1, sub: a.alt == null ? "" : String(Math.max(0, Math.round(a.alt / 100))).padStart(3, "0") };
}

// ---- static layer ----
function radarStatic(state) {
  const R = state.tracking.radius_nm, k = 100 / R, home = state.home;
  const based = !!(state.basemap && state.basemap.enabled);
  let s = `<g clip-path="url(#scope-clip)">${mapLayer(home, k, based)}${tfrLayer(state, k)}${fieldsLayer(state, k)}</g>`;
  for (const r of [R, (R * 2) / 3, R / 3]) s += `<circle class="ring" r="${r * k}"/>${ringLabel(r * k, Math.round(r) + " nm")}`;
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>${COMPASS}`;
  const ap = offset(home, state.airport);
  if (Math.hypot(ap.x, ap.y) < R) s += `<text class="apt-label" x="${ap.x * k}" y="${-ap.y * k + 9}" text-anchor="middle">${esc(state.airport.iata)}</text>${map ? "" : `<rect class="apt-mark" x="${ap.x * k - 2.5}" y="${-ap.y * k - 2.5}" width="5" height="5"/>`}`;
  for (const a of state.aircraft) {
    if (!a.on_ground) continue;
    const o = offset(home, a);
    if (Math.hypot(o.x, o.y) < R) s += `<circle class="blip gnd" cx="${o.x * k}" cy="${-o.y * k}" r="1.1"/>`;
  }
  return s + `<circle class="home" r="2.2"/>` + heardNote(state);
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
  return `<text class="heard-note" x="0" y="96" text-anchor="middle">Heard nearby, no position: ${esc(what)}</text>`;
}

function domeStatic(state, dt) {
  let s = `<circle class="dome-bg" r="100"/>`;
  for (const el of [30, 60]) { const r = ((90 - el) / 90) * 100; s += `<circle class="ring" r="${r}"/>${ringLabel(r, el + "°")}`; }
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
  const R = state.tracking.radius_nm, k = 100 / R;
  const box = svg.getBoundingClientRect(), unitsPx = Math.min(box.width, box.height) / 224;
  const screenPxPerNm = unitsPx * k * (window.devicePixelRatio || 1);
  if (mode !== "radar" || !bm || !bm.enabled || !unitsPx) {
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
  const icon = el("path", { class: "blip", d: PLANE }, g);
  const tag = el("text", { class: "tag" }, g), sub = el("text", { class: "tag-sub" }, g);
  // each trail fades from transparent at its oldest point to solid at the aircraft
  const gid = "tg-" + hex.replace(/[^a-z0-9]/gi, ""), grad = el("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse" }, svg.querySelector("#s-defs"));
  el("stop", { offset: 0, "stop-opacity": 0 }, grad);       // colour comes from the stylesheet
  el("stop", { offset: 1, "stop-opacity": 0.8 }, grad);
  const trail = el("polyline", { class: "trail", stroke: `url(#${gid})` }, svg.querySelector("#s-trails"));
  c = { g, icon, tag, sub, trail, grad, x: null, y: null, rot: 0, corner: 0, text: "" };
  live.set(hex, c);
  requestAnimationFrame(() => g.classList.remove("entering"));
  return c;
}

function dropCraft(hex) {
  const c = live.get(hex);
  c.g.remove();
  c.trail.remove();
  c.grad.remove();
  live.delete(hex);
}

// Label corners: right-above, right-below, left-above, left-below.
const CORNERS = [[7, -2.5, "start"], [7, 7.5, "start"], [-7, -2.5, "end"], [-7, 7.5, "end"]];

function labelBox(c, corner) {
  const [dx, dy, anchor] = CORNERS[corner], w = c.text.length * CHAR_W + 1;
  const x0 = anchor === "start" ? c.x + dx : c.x + dx - w;
  return { x0, x1: x0 + w, y0: c.y + dy - LINE_H, y1: c.y + dy + LINE_H * 0.9 };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Choose a label corner for each aircraft that avoids other labels, aircraft, the
// compass letters and the edge. Re-run on each data update, not every frame, and
// keep the current corner unless it is clearly worse, so labels don't flicker.
function placeLabels(heroHex) {
  const placed = [...(layerMode === "radar" ? placeBoxes : []), { x0: -5, x1: 5, y0: -112, y1: -100 }, { x0: 101, x1: 112, y0: -6, y1: 6 }, { x0: -5, x1: 5, y0: 102, y1: 114 }, { x0: -112, x1: -101, y0: -6, y1: 6 }];
  const all = [...live.values()].filter((c) => c.x != null);
  const blips = all.map((c) => ({ x0: c.x - 4.5, x1: c.x + 4.5, y0: c.y - 4.5, y1: c.y + 4.5, c }));
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
  const [dx, dy, anchor] = CORNERS[c.corner];
  c.tag.setAttribute("x", dx); c.tag.setAttribute("y", dy - 3.2); c.tag.setAttribute("text-anchor", anchor);
  c.sub.setAttribute("x", dx); c.sub.setAttribute("y", dy + 3.3); c.sub.setAttribute("text-anchor", anchor);
}

// ---- entry point: called every animation frame ----
export function drawScope(svg, state, now, stateAt, mode) {
  ensureLayers(svg);
  const dt = (now - stateAt) / 1000, frameDt = lastFrame ? Math.min(1, (now - lastFrame) / 1000) : 1;
  lastFrame = now;
  if (mode !== layerMode) {                       // switching views: start every aircraft fresh
    for (const hex of [...live.keys()]) dropCraft(hex);
    layerMode = mode;
    staticKey = null;
    svg.classList.remove("fade-in"); void svg.getBBox(); svg.classList.add("fade-in");
  }
  drawBase(svg, state, mode);
  const key = `${mode}|${stateAt}|${map ? 1 : 0}`;
  const fresh = key !== staticKey;
  if (fresh) {
    staticKey = key;
    svg.querySelector("#s-static").innerHTML = mode === "sky" ? domeStatic(state, dt) : radarStatic(state);
  }

  const heroHex = state.hero && state.hero.hex, seen = new Set(), ease = 1 - Math.exp(-frameDt / 0.6);
  for (const a of state.aircraft) {
    if (a.on_ground || (mode === "sky" && a.alt == null)) continue;
    const p = place(state, a, dt, mode);
    if (!p) continue;
    seen.add(a.hex);
    const c = craftFor(svg, a.hex), isHero = a.hex === heroHex;
    c.hex = a.hex;
    // ease toward the dead-reckoned position; jump if it's far off (new aircraft, big correction)
    if (c.x == null || Math.hypot(p.x - c.x, p.y - c.y) > 12) { c.x = p.x; c.y = p.y; c.rot = p.rot; }
    else {
      c.x += (p.x - c.x) * ease; c.y += (p.y - c.y) * ease;
      c.rot += (((p.rot - c.rot + 540) % 360) - 180) * ease;
    }
    c.g.setAttribute("transform", `translate(${c.x.toFixed(2)},${c.y.toFixed(2)})`);
    c.icon.setAttribute("transform", `rotate(${c.rot.toFixed(1)}) scale(${(isHero ? 1.55 : 1) * p.scale})`);
    c.g.classList.toggle("hero", isHero);
    c.trail.classList.toggle("hero", isHero);
    c.grad.classList.toggle("hero", isHero);
    const showLabel = mode !== "sky" || isHero || p.el > 6;
    const text = showLabel ? ident(a) : "";
    if (text !== c.text) { c.text = text; c.tag.textContent = text; }
    c.sub.textContent = showLabel ? p.sub : "";
    if (mode === "radar" && a.trail && a.trail.length > 1) {
      if (fresh || !c.trailPts) {
        c.trailPts = pts(state.home, a.trail, 100 / state.tracking.radius_nm);
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
