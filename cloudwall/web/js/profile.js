// The side view along the runways: each aircraft at its height over the ground along the airport's
// main runway direction, the arrivals numbered in landing order down the 3° approach, the cloud
// layers from the airport's weather report, home and the airport on the ground line. Beside the
// radar's view from above, it shows who is stacked over whom. Heights are to scale up to 10,000 ft,
// so the approach is a straight line; anything higher sits in a band along the top. Aircraft well
// off the runways' line are drawn faint: they are only passing the same distance along it.
import { esc, num, clamp, offset, ident } from "./util.js";
import { drawing } from "./silhouette.js";
import { boardFlight } from "./parts.js";
import { picture } from "./situation.js";

const RAD = Math.PI / 180;
const TOP = 10000;                    // feet at the top of the scale; higher aircraft sit in a band above it
const OFF_LINE_NM = 4;                // further than this from the runways' line, an aircraft is drawn faint
const SHORT8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const GLIDE_FT_PER_NM = 318.4;        // a 3° approach
const f1 = (v) => v.toFixed(1);

// An aircraft from the side, about its size: its drawing, or a balloon or glider drawn here.
function sideOf(a, w) {
  if (a.icon === "balloon") return { html: `<g class="el-glyph"><ellipse cx="0" cy="${-w * 0.75}" rx="${w * 0.42}" ry="${w * 0.5}"/><path d="M${-w * 0.3},${-w * 0.38}L${-w * 0.1},${-w * 0.08}M${w * 0.3},${-w * 0.38}L${w * 0.1},${-w * 0.08}"/><rect x="${-w * 0.1}" y="${-w * 0.08}" width="${w * 0.2}" height="${w * 0.14}"/></g>`, h: w * 1.3, up: w * 1.3 };
  const d = drawing(a.type, a.shape || (a.icon === "heli" || a.icon === "tandem" ? "heli" : a.icon === "light" ? "piston" : "narrow"), a.length || 30, [a.model, a.type_name].filter(Boolean).join(" "));
  if (!d.svg) return { html: `<circle r="${w * 0.12}"/>`, h: w * 0.24, up: w * 0.12 };
  const h = (w * d.h) / d.w;
  return { html: d.svg.replace("<svg", `<svg width="${f1(w)}" height="${f1(h)}" x="${f1(-w / 2)}" y="${f1(-h * 0.62)}"`), h, up: h * 0.62 };
}

// The runway the view runs along: the first in use, else the longest. Its axis points out along the
// approach (east for an airport landing west), so arrivals come down from the right.
function axis(state) {
  const ap = state.airport, names = String((state.flow && state.flow.runways) || "").split("/").map((s) => s.trim()).filter(Boolean);
  const ways = (ap.runways || []).map((r) => {
    const [a, b] = r.ends.map(([lat, lon]) => offset(state.home, { lat, lon }));
    return { r, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) || 1 };
  });
  if (!ways.length) return null;
  let w = null, thr = null, far = null;
  for (const n of names) {
    w = ways.find((x) => x.r.name.split("/").includes(n));
    if (w) { const i = w.r.name.split("/").indexOf(n); thr = i ? w.b : w.a; far = i ? w.a : w.b; break; }
  }
  if (!w) {        // no flow known: the longest runway, drawn west to east
    w = ways.reduce((m, x) => (x.len > m.len ? x : m));
    [far, thr] = w.a.x < w.b.x ? [w.a, w.b] : [w.b, w.a];
  }
  const ux = (thr.x - far.x) / w.len, uy = (thr.y - far.y) / w.len;
  const along = (p) => { const o = p.x === undefined ? offset(state.home, p) : p; return o.x * ux + o.y * uy; };
  const lateral = (p) => { const o = offset(state.home, p); return Math.abs((o.x - thr.x) * uy - (o.y - thr.y) * ux); };
  const out = SHORT8[Math.round((((Math.atan2(ux, uy) / RAD) % 360) + 360) % 360 / 45) % 8];      // which way the axis points
  return { ux, uy, along, lateral, thr: along(thr), far: along(far), landing: names.length > 0, names, out, back: SHORT8[(SHORT8.indexOf(out) + 4) % 8] };
}

export function profileHtml(state, W, H, { range = state.tracking.radius_nm, fs = 1 } = {}) {
  const ax = axis(state);
  if (!ax) return "";
  const padL = 46 * fs, padR = 70 * fs, padT = 14 * fs, padB = 22 * fs;
  const band = 12 * fs, top0 = padT + band;
  const ys = (alt) => (alt > TOP ? padT + band * 0.45 : top0 + (H - top0 - padB) * (1 - clamp(alt, 0, TOP) / TOP));
  const xs = (nm) => padL + ((W - padL - padR) * (nm + range)) / (2 * range);
  const g0 = ys(0), heroHex = state.hero && state.hero.hex;
  let s = `<defs><pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="el-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`;
  for (const alt of [2000, 4000, 6000, 8000, 10000]) {
    s += `<line class="el-grid" x1="${padL}" x2="${W - padR}" y1="${f1(ys(alt))}" y2="${f1(ys(alt))}"/><text class="el-tick" x="${padL - 6}" y="${f1(ys(alt) + 3.5)}" text-anchor="end">${num(alt)}${alt === TOP ? " ft" : ""}</text>`;
  }
  s += `<text class="el-tick" x="${padL - 6}" y="${f1(padT + band * 0.45 + 3.5)}" text-anchor="end">higher</text>`;
  s += `<rect x="${padL}" y="${g0}" width="${W - padL - padR}" height="${6 * fs}" fill="url(#pf-hatch)"/><line class="el-ground" x1="${padL}" x2="${W - padR}" y1="${g0}" y2="${g0}"/>`;
  // miles along the ground, left out where the airport's and home's names sit
  const apX = ax.along(state.airport), busy = [0, apX], side = (nm) => (nm > 0 ? ax.out : ax.back);
  for (const nm of [-15, -10, -5, 5, 10, 15].filter((n) => Math.abs(n) <= range && busy.every((b) => Math.abs(n - b) > 2.2))) {
    s += `<text class="el-tick" x="${f1(xs(nm))}" y="${f1(g0 + 16 * fs)}" text-anchor="middle">${Math.abs(nm)}${Math.abs(nm) === range ? ` nm ${side(nm)}` : ""}</text>`;
  }
  // the cloud layers, a row of small clouds as thick as the cover, and their base at the right
  const frac = { FEW: 0.25, SCT: 0.45, BKN: 0.75, OVC: 1 };
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const c of ((state.weather && state.weather.clouds) || []).filter((c) => c.base != null && c.base <= TOP)) {
    const y = ys(c.base), f = frac[c.cover] || 0.5;
    for (let x = padL + 6; x < W - padR - 20; x += 26 * fs) {
      if (rnd() > f) continue;
      const k = fs * (0.8 + rnd() * 0.5);
      s += `<path class="el-cloud" d="M${f1(x)},${f1(y)}a${5 * k},${5 * k} 0 0 1 ${5 * k},${-5 * k}a${6 * k},${6 * k} 0 0 1 ${10 * k},${-1 * k}a${4.5 * k},${4.5 * k} 0 0 1 ${5 * k},${6 * k}z"/>`;
    }
    s += `<text class="el-cloud-l" x="${W - padR + 8}" y="${f1(y + 3)}">${esc(c.cover)} ${num(c.base)}</text>`;
  }
  // the runway on the ground, the 3° approach down to it, and home
  s += `<line class="el-rwy" x1="${f1(xs(Math.min(ax.thr, ax.far)))}" x2="${f1(xs(Math.max(ax.thr, ax.far)))}" y1="${f1(g0 - 1.5)}" y2="${f1(g0 - 1.5)}"/>`;
  s += `<text class="el-apt" x="${f1(xs(apX))}" y="${f1(g0 + 16 * fs)}" text-anchor="middle">${esc(state.airport.iata)}</text>`;
  if (ax.landing) {
    let d = "";
    for (let x = ax.thr; x <= range; x += 0.25) d += `${d ? "L" : "M"}${f1(xs(x))},${f1(ys((x - ax.thr) * GLIDE_FT_PER_NM))}`;
    s += `<path class="el-gs" d="${d}"/>`;
  }
  const hx = xs(0);
  s += `<path class="el-home" d="M${hx - 5 * fs},${g0} v${-6 * fs} l${5 * fs},${-5 * fs} l${5 * fs},${5 * fs} v${6 * fs} z"/><text class="el-home-l" x="${hx}" y="${f1(g0 + 16 * fs)}" text-anchor="middle">Home</text>`;
  // the aircraft, about their size, facing the way they fly along the runway
  const boxes = [{ x0: W - padR + 4, x1: W, y0: 0, y1: H }];
  let crafts = "", labels = "";
  const placed = picture(state).air.filter((a) => a.alt != null && Math.abs(ax.along(a)) <= range).map((a) => {
    const x = xs(ax.along(a)), y = ys(a.alt), w = fs * (14 + 24 * Math.sqrt(Math.min(1, (a.length || 10) / 70)));
    const fwd = Math.sin((a.track || 0) * RAD) * ax.ux + Math.cos((a.track || 0) * RAD) * ax.uy >= 0;
    const sv = sideOf(a, w), sel = a.hex === heroHex, off = !sel && ax.lateral(a) > OFF_LINE_NM;
    if (sel) crafts += `<circle class="pf-sel" cx="${f1(x)}" cy="${f1(y - sv.up * 0.2)}" r="${f1(w * 0.62)}"/>`;
    // the drawings face right, out along the approach: an arrival is turned round to face the runway
    crafts += `<g class="pf-craft c-${a.activity || "pass"}${sel ? " sel" : ""}${off ? " off" : ""}" data-hex="${esc(a.hex)}" transform="translate(${f1(x)} ${f1(y)}) scale(${fwd ? 1 : -1},1)">${sv.html}</g>`;
    boxes.push({ x0: x - w / 2, x1: x + w / 2, y0: y - sv.up, y1: y + sv.h * 0.4 });
    return { a, x, y, w, sv, sel, off };
  });
  // the approach's name along it, under the line, where no aircraft is and clear of the names on the ground
  boxes.push({ x0: padL, x1: W - padR, y0: g0 - 3, y1: H });
  if (ax.landing) {
    const text = "3° approach", len = text.length * 5.2 * fs;
    for (const from of [1.2, 4.5, 8]) {
      const p1 = [xs(ax.thr + from), ys(from * GLIDE_FT_PER_NM)], p2 = [xs(ax.thr + from + 2), ys((from + 2) * GLIDE_FT_PER_NM)];
      const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), ex = p1[0] + Math.cos(ang) * len, ey = p1[1] + Math.sin(ang) * len + 11 * fs;
      const b = { x0: p1[0], x1: ex, y0: Math.min(p1[1], ey) - 2, y1: Math.max(p1[1], ey) + 12 * fs };
      if (ex > W - padR || boxes.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1))) continue;
      s += `<text class="el-gs-l" transform="translate(${f1(p1[0])} ${f1(p1[1] + 11 * fs)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})">${esc(text)}</text>`;
      break;
    }
  }
  // labels: the selected aircraft by its flight, then the arrivals by their place in the queue
  // alone (the list beside names them), then departures by their flight
  const rank = (p) => (p.sel ? 0 : p.a.seq ? p.a.seq : p.a.activity === "dep" ? 50 : 99);
  for (const p of placed.filter((p) => !p.off && (p.sel || p.a.seq || p.a.activity === "dep")).sort((q, r) => rank(q) - rank(r))) {
    const { a, x, y, w, sv } = p, id = p.sel || !a.seq ? boardFlight(ident(a)) : "", seqW = a.seq ? 14 * fs : 0;
    const tw = seqW + id.length * 6.3 * fs + 6, th = 12 * fs;
    const tries = [[x - tw / 2, y - sv.up - 4 * fs], [x + w / 2 + 3, y - 2], [x - w / 2 - 3 - tw, y - 2], [x - tw / 2, y + sv.h * 0.5 + th]];
    let at = null;
    for (const [lx, ly] of tries) {
      const b = { x0: lx, x1: lx + tw, y0: ly - th, y1: ly + 2 };
      if (b.x0 < padL - 4 || b.x1 > W - padR || b.y0 < 0 || b.y1 > g0 - 2) continue;
      if (boxes.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1))) continue;
      at = b; break;
    }
    if (!at) continue;
    boxes.push(at);
    if (a.seq) labels += `<g class="pf-seq" transform="translate(${f1(at.x0 + 5 * fs)} ${f1(at.y1 - 6 * fs)})"><circle r="${6 * fs}"/><text y="${3.4 * fs}" text-anchor="middle">${a.seq}</text></g>`;
    if (id) labels += `<text class="pf-lab${p.sel ? " sel" : ""}" x="${f1(at.x0 + seqW)}" y="${f1(at.y1 - 2)}">${esc(id)}</text>`;
  }
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Aircraft by height along the runways">${s}${crafts}${labels}</svg>`;
}
