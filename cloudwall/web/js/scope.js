// The right-hand panel: a top-down radar scope, or a dome view of the sky.
import { esc, ident, projected, offset, azEl, clamp } from "./util.js";
import { sky } from "./sky.js";

const PLANE = "M0,-4 L1,-1 L4.2,1.2 L4.2,2 L1,1 L.8,3 L2,4 L2,4.6 L0,4 L-2,4.6 L-2,4 L-.8,3 L-1,1 L-4.2,2 L-4.2,1.2 L-1,-1 Z";
const RAD = Math.PI / 180;
export let map = null;

export async function loadMap(icao) {
  try {
    const m = await (await fetch(`maps/${String(icao).toLowerCase()}.json`)).json();
    if (m && (m.water || m.runways)) map = m;
  } catch (e) { /* no map for this airport: the scope simply has no backdrop */ }
}

const pts = (home, line, k) => line.map(([lat, lon]) => { const o = offset(home, { lat, lon }); return `${(o.x * k).toFixed(1)},${(-o.y * k).toFixed(1)}`; }).join(" ");

export function mapLayer(home, k) {
  if (!map) return "";
  let s = "";
  for (const w of map.water || []) s += `<polyline class="water" stroke-width="${Math.max(1.2, w.width_nm * k)}" points="${pts(home, w.line, k)}"/>`;
  for (const r of map.runways || []) {
    const [a, b] = r.ends.map(([lat, lon]) => offset(home, { lat, lon }));
    const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, far = 12;   // nm of extended centreline
    s += `<line class="approach" x1="${(a.x - ux * far) * k}" y1="${-(a.y - uy * far) * k}" x2="${(b.x + ux * far) * k}" y2="${-(b.y + uy * far) * k}"/>`;
    s += `<line class="runway" x1="${a.x * k}" y1="${-a.y * k}" x2="${b.x * k}" y2="${-b.y * k}"/>`;
  }
  for (const p of map.places || []) {
    const o = offset(home, { lat: p.at[0], lon: p.at[1] });
    s += `<text class="place" x="${o.x * k}" y="${-o.y * k}" text-anchor="middle">${esc(p.name)}</text>`;
  }
  return s;
}

function radar(state, dt) {
  const R = state.tracking.radius_nm, k = 100 / R, home = state.home, hero = state.hero && state.hero.hex;
  let s = `<defs><clipPath id="scope-clip"><circle r="100"/></clipPath></defs><circle class="scope-bg" r="100"/><g clip-path="url(#scope-clip)">${mapLayer(home, k)}`;
  // trails: older thirds fade out
  for (const a of state.aircraft) {
    if (a.on_ground || !a.trail || a.trail.length < 2) continue;
    const now = projected(a, dt), line = [...a.trail, [now.lat, now.lon]], n = line.length, third = Math.ceil(n / 3);
    for (let i = 0; i < 3; i++) {
      const seg = line.slice(Math.max(0, i * third - 1), (i + 1) * third);
      if (seg.length > 1) s += `<polyline class="trail ${a.hex === hero ? "hero" : ""}" opacity="${0.18 + i * 0.25}" points="${pts(home, seg, k)}"/>`;
    }
  }
  s += "</g>";
  for (const r of [R, (R * 2) / 3, R / 3]) s += `<circle class="ring" r="${r * k}"/><text x="2" y="${-r * k + 7}">${Math.round(r)}</text>`;
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>`;
  s += `<text x="-3" y="-102">N</text><text x="103" y="2">E</text><text x="-3" y="108">S</text><text x="-109" y="2">W</text>`;
  const ap = offset(home, state.airport);
  if (Math.hypot(ap.x, ap.y) < R) s += `<text class="apt-label" x="${ap.x * k}" y="${-ap.y * k + 9}" text-anchor="middle">${esc(state.airport.iata)}</text>${map ? "" : `<rect class="apt-mark" x="${ap.x * k - 2.5}" y="${-ap.y * k - 2.5}" width="5" height="5"/>`}`;
  s += `<circle class="home" r="2"/>`;
  for (const a of state.aircraft) {
    const o = offset(home, a.on_ground ? a : projected(a, dt));
    if (Math.hypot(o.x, o.y) > R) continue;
    const x = o.x * k, y = -o.y * k, h = a.hex === hero;
    if (a.on_ground) { s += `<circle class="blip gnd" cx="${x}" cy="${y}" r="1.2"/>`; continue; }
    s += `<g data-hex="${esc(a.hex)}"><circle cx="${x}" cy="${y}" r="9" fill="transparent"/>
      <path class="blip ${h ? "hero" : ""}" d="${PLANE}" transform="translate(${x},${y}) rotate(${a.track || 0}) scale(${h ? 1.5 : 1})"/>
      <text class="tag ${h ? "hero" : ""}" x="${x + 6}" y="${y - 3}">${esc(ident(a))}</text>
      <text x="${x + 6}" y="${y + 3.5}">${a.alt == null ? "" : Math.round(a.alt / 100)}</text></g>`;
  }
  return s;
}

// Sky dome: the centre is straight up, the rim is the horizon, compass as on a map.
const domeXY = (p) => { const r = ((90 - clamp(p.el, 0, 90)) / 90) * 100; return [r * Math.sin(p.az * RAD), -r * Math.cos(p.az * RAD)]; };
const skyPos = (home, a, t) => azEl(home, projected(a, t), a.alt + ((a.vrate || 0) * t) / 60);

function dome(state, dt) {
  const home = state.home, hero = state.hero && state.hero.hex;
  let s = `<circle class="dome-bg" r="100"/>`;
  for (const el of [30, 60]) s += `<circle class="ring" r="${((90 - el) / 90) * 100}"/><text x="2" y="${-((90 - el) / 90) * 100 + 7}">${el}°</text>`;
  s += `<circle class="ring horizon" r="100"/><line class="ring" x1="-4" y1="0" x2="4" y2="0"/><line class="ring" x1="0" y1="-4" x2="0" y2="4"/>`;
  s += `<text x="-3" y="-102">N</text><text x="103" y="2">E</text><text x="-3" y="108">S</text><text x="-109" y="2">W</text>`;
  if (sky.sun.el > 0) { const [x, y] = domeXY(sky.sun); s += `<circle class="sun-glow" cx="${x}" cy="${y}" r="11"/><circle class="sun" cx="${x}" cy="${y}" r="4.5"/>`; }
  const h = state.hero;
  if (h && !h.on_ground && h.alt != null) {
    // where it has been and where it is going across the sky
    const past = [], future = [];
    let best = null;
    for (let t = -180; t <= 360; t += 6) {
      const p = skyPos(home, h, dt + t);
      if (p.el < 0.5) continue;
      (t <= 0 ? past : future).push(domeXY(p).map((v) => v.toFixed(1)).join(","));
      if (!best || p.el > best.el) best = { ...p, t };
    }
    if (past.length && future.length) future.unshift(past[past.length - 1]);
    if (past.length > 1) s += `<polyline class="sky-path past" points="${past.join(" ")}"/>`;
    if (future.length > 1) s += `<polyline class="sky-path" points="${future.join(" ")}"/>`;
    if (best && best.t > 6) { const [x, y] = domeXY(best); s += `<circle class="sky-peak" cx="${x}" cy="${y}" r="2.2"/><text class="tag" x="${x + 4}" y="${y + 8}">peaks ${Math.round(best.el)}°</text>`; }
  }
  for (const a of state.aircraft) {
    if (a.on_ground || a.alt == null) continue;
    const p = skyPos(home, a, dt);
    if (p.el < 1) continue;
    const [x, y] = domeXY(p), [x2, y2] = domeXY(skyPos(home, a, dt + 8)), isHero = a.hex === hero;
    const rot = Math.hypot(x2 - x, y2 - y) > 0.01 ? Math.atan2(x2 - x, -(y2 - y)) / RAD : a.track || 0;
    const size = (isHero ? 1.6 : 0.9) + clamp(p.el / 60, 0, 1) * 0.9;       // higher in the sky = closer = bigger
    s += `<g data-hex="${esc(a.hex)}"><circle cx="${x}" cy="${y}" r="9" fill="transparent"/>
      <path class="blip ${isHero ? "hero" : ""}" d="${PLANE}" transform="translate(${x},${y}) rotate(${rot}) scale(${size})"/>
      ${isHero || p.el > 6 ? `<text class="tag ${isHero ? "hero" : ""}" x="${x + 8}" y="${y - 4}">${esc(ident(a))}</text><text x="${x + 8}" y="${y + 2.5}">${Math.round(p.el)}° up</text>` : ""}</g>`;
  }
  return s;
}

export function drawScope(svg, state, dt, mode) {
  svg.innerHTML = mode === "sky" ? dome(state, dt) : radar(state, dt);
}
