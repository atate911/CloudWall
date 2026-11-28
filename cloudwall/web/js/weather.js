// Aviation weather: the Weather tab, and a compact version for the quiet-sky rotation.
// Charts are SVG at the container's real pixel size, so text stays a fixed size.
import { $, esc, num, offset, POINTS, degF } from "./util.js";
import { runwaysFor } from "./map.js";
import { skyToday, moonSvg } from "./astro.js";

const CAT_NAME = { VFR: "Visual flight rules", MVFR: "Marginal visual flight rules", IFR: "Instrument flight rules", LIFR: "Low instrument flight rules" };
const CAT_ORDER = ["VFR", "MVFR", "IFR", "LIFR"];
const COVER = { FEW: "Few clouds", SCT: "Scattered", BKN: "Broken", OVC: "Overcast", OVX: "Obscured", VV: "Obscured" };
const NO_CLOUD = ["SKC", "CLR", "NSC", "NCD", "CAVOK"];
// A report may have no category; one no longer current (`old`) keeps its category, dimmed.
export const catBadge = (n, old) =>
  `<div class="cat-badge${old ? " old" : ""}"><i class="sw big cat-${esc(n.category)}"></i><b>${esc(n.category || "–")}</b></div>`;
const hoursAgo = (min) => (min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`);
const RAD = Math.PI / 180;
const f = (c) => (c == null ? null : (c * 9) / 5 + 32);
const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hourLabel = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric" });
const compass = (d) => POINTS[Math.round(d / 22.5) % 16];

// ---------- words ----------

// Reports usually start with their kind ("METAR KPDX ..."), so that word becomes the label.
function rawLine(kind, raw) {
  const m = /^(METAR|SPECI|TAF(?: AMD| COR)?)\s+/.exec(raw || "");
  return `<p><b>${m ? m[1] : kind}</b> ${esc(m ? raw.slice(m[0].length) : raw || "")}</p>`;
}

export function windWords(w) {
  if (!w || !w.speed) return "Calm wind";
  const from = w.variable ? "Variable" : `From ${String(w.dir).padStart(3, "0")}° (${compass(w.dir)})`;
  return `${from} at ${w.speed} kt${w.gust ? `, gusting ${w.gust}` : ""}`;
}
function visWords(n) {
  if (n.visibility == null) return null;
  // ("10+" from a US station, "6+" from one that reports in metres and tops out at 9999)
  const far = n.visibility_plus || n.visibility >= 10;
  return `${far ? `${Math.round(n.visibility)}+` : num(n.visibility * 10) / 10} mile${n.visibility === 1 ? "" : "s"} visibility`;
}
export function skyWords(n) {
  if (!n.clouds.length) return "Clear skies";
  const deck = n.clouds.find((c) => c.base === n.ceiling) || n.clouds[0];
  return `${COVER[deck.cover] || deck.cover} at ${num(deck.base)} ft`;
}
const lowerFirst = (t) => t[0].toLowerCase() + t.slice(1);
export function summary(n) {
  return [n.weather && n.weather[0].toUpperCase() + n.weather.slice(1), skyWords(n), visWords(n), lowerFirst(windWords(n.wind))]
    .filter(Boolean).join(", ");
}

// ---------- wind and runways ----------
export function runwayHeadings(state) {
  const home = state.home;
  return runwaysFor(state).map((r) => {
    const [a, b] = r.ends.map(([lat, lon]) => offset(home, { lat, lon }));
    const hdg = (Math.atan2(b.x - a.x, b.y - a.y) / RAD + 360) % 360;   // true heading of the first end's direction
    const [n1, n2] = r.name.split("/");
    return { name: r.name, ends: [n1, n2], hdg };
  });
}

// Headwind and crosswind for each runway direction, most headwind first.
function components(w, runways) {
  if (!w || !w.speed || w.variable || w.dir == null) return [];
  const byHeading = new Map();
  for (const r of runways) {
    for (const [name, h] of [[r.ends[0], r.hdg], [r.ends[1], (r.hdg + 180) % 360]]) {
      const key = Math.round(h / 10);
      const e = byHeading.get(key) || { names: [], hdg: h };
      e.names.push(name);
      byHeading.set(key, e);
    }
  }
  return [...byHeading.values()].map((e) => {
    const diff = ((w.dir - e.hdg + 540) % 360) - 180;
    return { ...e, head: w.speed * Math.cos(diff * RAD), cross: w.speed * Math.sin(diff * RAD), side: diff > 0 ? "right" : "left" };
  }).sort((a, b) => b.head - a.head);
}

export function windRose(size, w, runways) {
  const c = size / 2, R = size / 2 - 22, cx = c, cy = c;
  let s = `<circle class="rose-ring" cx="${cx}" cy="${cy}" r="${R}"/>`;
  for (let d = 0; d < 360; d += 30) {
    const big = d % 90 === 0, x1 = cx + Math.sin(d * RAD) * R, y1 = cy - Math.cos(d * RAD) * R;
    const x2 = cx + Math.sin(d * RAD) * (R - (big ? 9 : 5)), y2 = cy - Math.cos(d * RAD) * (R - (big ? 9 : 5));
    s += `<line class="rose-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  for (const [d, l] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]]) {
    s += `<text class="rose-dir" x="${cx + Math.sin(d * RAD) * (R + 12)}" y="${cy - Math.cos(d * RAD) * (R + 12) + 4}" text-anchor="middle">${l}</text>`;
  }
  // runways, parallels side by side
  const groups = new Map();
  runways.forEach((r) => { const k = Math.round(r.hdg / 10); groups.set(k, [...(groups.get(k) || []), r]); });
  let labels = "";   // drawn last, so the wind arrow never hides a runway number
  for (const rs of groups.values()) {
    const L = R * 0.6, r0 = rs[0], ux = Math.sin(r0.hdg * RAD), uy = -Math.cos(r0.hdg * RAD);
    rs.forEach((r, i) => {
      const off = (i - (rs.length - 1) / 2) * 12, px = -uy * off, py = ux * off;
      s += `<line class="rose-rwy" x1="${cx - ux * L + px}" y1="${cy - uy * L + py}" x2="${cx + ux * L + px}" y2="${cy + uy * L + py}"/>`;
    });
    const join = (names) => names.length > 1 && names.every((n) => n.slice(0, -1) === names[0].slice(0, -1))
      ? names[0].slice(0, -1) + names.map((n) => n.slice(-1)).join("/") : names.join(" ");
    const a = join(rs.map((r) => r.ends[0])), b = join(rs.map((r) => r.ends[1]));
    labels += `<text class="rose-rwy-label" x="${cx - ux * (L + 18)}" y="${cy - uy * (L + 18) + 4}" text-anchor="middle">${esc(a)}</text>`;
    labels += `<text class="rose-rwy-label" x="${cx + ux * (L + 18)}" y="${cy + uy * (L + 18) + 4}" text-anchor="middle">${esc(b)}</text>`;
  }
  s += planSock(cx, cy, R, w);
  s += labels;
  return `<svg class="rose" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(windWords(w))}">${s}</svg>`;
}

// The windsock seen from above, at the middle of the rose, streaming downwind. Like an ICAO sock
// it has five bands and is fully out at 15 kt (each band about 3 kt). Drawn along +x and turned to
// the wind. Gusts make it swing; calm leaves only its hoop round the mast.
let socks = 0;
function planSock(cx, cy, R, w) {
  const speed = (w && w.speed) || 0;
  let s = "";
  if (!speed || w.variable || w.dir == null) {
    s += `<circle class="sock-hoop calm" cx="${cx}" cy="${cy}" r="7.5"/>`;
    s += `<text class="rose-calm" x="${cx}" y="${cy + 30}" text-anchor="middle">${speed ? `Variable, ${speed} kt` : "Calm"}</text>`;
  } else {
    const n = ++socks, e = Math.min(1, speed / 15), L = R * 0.86 * (0.3 + 0.7 * e);
    const deg = (w.dir + 90) % 360;                 // +x turned to point downwind (from w.dir, toward w.dir + 180)
    const m = 5, r0 = 8.6, r1 = r0 * (0.6 - 0.12 * e), tail = m + L;     // the hoop, the radii; fuller wind, slimmer tail
    const f = (v) => v.toFixed(2);
    // the cloth's edge: taper, a slight belly, and a ripple, more in a light wind
    const half = (t) => r0 + (r1 - r0) * t + 0.6 * Math.sin(Math.PI * t) + (0.25 + 0.35 * (1 - e)) * Math.sin(Math.PI * 5 * t) * t;
    const edge = (sgn) => Array.from({ length: 25 }, (_, k) => { const t = k / 24; return `${f(m + L * t)},${f(sgn * half(t))}`; });
    const out = `M${edge(-1).join(" L")} L${edge(1).reverse().join(" L")}Z`;
    const rt = half(1), ex = Math.max(1.2, rt * 0.32);                   // the open tail, seen a little from the side
    let bands = "";
    for (let i = 0; i < 5; i++) {
      const a = m + (L / 5) * i, b = m + (L / 5) * (i + 1) + (i < 4 ? 0.2 : ex + 1), bow = i ? 1.4 : 0, bow2 = i < 4 ? 1.4 : 0;
      bands += `<path class="sock-band ${i % 2 ? "w" : "o"}" d="M${f(a)},${-r0 - 2} Q${f(a + bow * 2)},0 ${f(a)},${r0 + 2} L${f(b)},${r0 + 2} Q${f(b + bow2 * 2)},0 ${f(b)},${-r0 - 2}Z"/>`;
    }
    const gusty = w.gust && w.gust - speed >= 5;
    s += `<defs><clipPath id="sock-${n}"><path d="${out}"/></clipPath>
      <linearGradient id="sock-g${n}" x1="0" y1="0" x2="0" y2="1"><stop class="sock-sh" offset="0"/><stop class="sock-mid" offset=".3"/><stop class="sock-hi" offset=".5"/><stop class="sock-mid" offset=".7"/><stop class="sock-sh" offset="1"/></linearGradient></defs>`;
    s += `<path class="sock-shadow" d="${out}" transform="translate(${f(cx + 2.2)} ${f(cy + 3)}) rotate(${deg})"/>`;
    s += `<g class="sock-body ${gusty ? "gusty" : "breezy"}" style="transform-origin:${cx}px ${cy}px"><g transform="translate(${cx} ${cy}) rotate(${deg})">
      <line class="sock-arm" x1="0" y1="0" x2="${m}" y2="0"/>
      <g clip-path="url(#sock-${n})">${bands}<rect x="${m - 1}" y="${-r0 - 2}" width="${f(L + 6)}" height="${2 * r0 + 4}" fill="url(#sock-g${n})"/></g>
      <path class="sock-edge" d="${out}"/>
      <ellipse class="sock-mouth" cx="${f(tail)}" cy="0" rx="${f(ex)}" ry="${f(rt - 0.15)}"/>
      <ellipse class="sock-hoop" cx="${m}" cy="0" rx="1.3" ry="${f(r0 + 0.5)}"/></g></g>`;
    const t = ((w.dir + 180) % 360) * RAD, ux = Math.sin(t), uy = -Math.cos(t);
    s += `<text class="rose-speed" x="${cx - ux * 26}" y="${cy - uy * 26 + 5}" text-anchor="middle">${speed}${w.gust ? `G${w.gust}` : ""}</text>`;
  }
  return s + `<circle class="sock-mast" cx="${cx}" cy="${cy}" r="3"/>`;
}

function windCaption(w, runways, flow) {
  const comps = components(w, runways);
  if (!comps.length) return `<p class="cap-main">${esc(windWords(w))}</p>`;
  const best = comps[0];
  const cross = Math.abs(best.cross) < 0.5 ? "no crosswind" : `${Math.round(Math.abs(best.cross))} kt crosswind from the ${best.side}`;
  return `<p class="cap-main">${esc(windWords(w))}</p>
    <p>Best into the wind: runway${best.names.length > 1 ? "s" : ""} ${esc(best.names.join(" and "))}, ${Math.round(Math.max(0, best.head))} kt headwind and ${cross}</p>
    ${flow ? `<p class="dim">Currently landing ${esc(flow.dir)}</p>` : ""}`;
}

// ---------- clouds, side view ----------
function cloudView(width, height, n) {
  const top = Math.max(10000, ...n.clouds.map((c) => Math.min(c.base + 2000, 25000)));
  const padL = 64, padR = 8, padT = 14, padB = 26, plotH = height - padT - padB, plotW = width - padL - padR;
  const y = (ft) => padT + plotH * (1 - Math.min(ft, top) / top);
  let s = "";
  const step = top > 15000 ? 5000 : 2000;
  for (let ft = 0; ft <= top; ft += step) {
    s += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y(ft)}" y2="${y(ft)}"/>`;
    s += `<text class="tick" x="${padL - 8}" y="${y(ft) + 4}" text-anchor="end">${ft ? num(ft) : "Ground"}</text>`;
  }
  s += `<line class="ground" x1="${padL}" x2="${width - padR}" y1="${y(0)}" y2="${y(0)}"/>`;
  // keep room on the right for the layer's name and height, however narrow the figure is
  const blocks = 8, gap = 3, bw = Math.max(5, Math.min(16, (plotW - 128 - gap * (blocks - 1)) / blocks));
  n.clouds.forEach((c) => {
    const yy = y(c.base), ceil = c.base === n.ceiling;
    for (let i = 0; i < blocks; i++) {
      s += `<rect class="okta ${i < c.oktas ? "on" : ""} ${ceil ? "ceil" : ""}" x="${padL + 6 + i * (bw + gap)}" y="${yy - 7}" width="${bw}" height="14" rx="4"/>`;
    }
    s += `<text class="layer ${ceil ? "ceil" : ""}" x="${padL + 6 + blocks * (bw + gap) + 8}" y="${yy + 5}">${esc(COVER[c.cover] || c.cover)} ${num(c.base)}</text>${ceil ? `<text class="layer-note" x="${padL + 6 + blocks * (bw + gap) + 8}" y="${yy + 19}">ceiling</text>` : ""}`;
  });
  if (!n.clouds.length) s += `<text class="layer" x="${padL + 10}" y="${y(top / 2)}">No clouds reported</text>`;
  return `<svg class="clouds" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(skyWords(n))}">${s}</svg>`;
}

// ---------- 24-hour history ----------
function histCharts(width, hist) {
  if (hist.length < 2) return "";
  const t0 = hist[0].time, t1 = hist[hist.length - 1].time, padL = 52, padR = 74;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (width - padL - padR);
  const charts = [];
  const frame = (h, body, title, yticks, legend = "") =>
    `<div class="hchart"><div class="htitle">${title}${legend}</div><svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${yticks}${body}<line class="xh" y1="0" y2="${h}" x1="0" x2="0" visibility="hidden"/></svg></div>`;
  const scale = (lo, hi, h, pad = 6) => (v) => pad + (h - 2 * pad) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
  const ticks = (vals, yf, fmt) => vals.map((v) => `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${yf(v)}" y2="${yf(v)}"/><text class="tick" x="${padL - 8}" y="${yf(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("");
  const path = (pts) => pts.filter((p) => p[1] != null).map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const stepPath = (pts) => pts.map((p, i) => (i ? `H${p[0].toFixed(1)}V${p[1].toFixed(1)}` : `M${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join("") + `H${(width - padR).toFixed(1)}`;

  // flight category strip
  let strip = "";
  hist.forEach((o, i) => {
    const xa = x(o.time), xb = i < hist.length - 1 ? x(hist[i + 1].time) : width - padR;
    strip += `<rect class="cat-fill cat-${esc(o.category)}" x="${xa}" y="4" width="${Math.max(1, xb - xa - 2)}" height="18" rx="3"/>`;
  });
  const catLegend = `<span class="lg">${CAT_ORDER.map((k) => `<i class="sw cat-${k}"></i>${k}`).join(" ")}</span>`;
  charts.push(frame(26, strip, "Flight category", "", catLegend));

  // temperature and dew point (°F): a report can lack either (a sensor out); its point is left off
  const temps = hist.flatMap((o) => [f(o.temp_c), f(o.dew_c)]).filter((v) => v != null);
  const tLast = hist[hist.length - 1];
  if (temps.length) {
    const lo = Math.floor(Math.min(...temps) - 2), hi = Math.ceil(Math.max(...temps) + 2), h1 = 96, y1 = scale(lo, hi, h1);
    const tNow = f(tLast.temp_c), dNow = f(tLast.dew_c), close = tNow != null && dNow != null && tNow - dNow < 3;
    const tBody = `<path class="ln temp" d="${path(hist.map((o) => [x(o.time), o.temp_c == null ? null : y1(f(o.temp_c))]))}"/>
    <path class="ln dew" d="${path(hist.map((o) => [x(o.time), o.dew_c == null ? null : y1(f(o.dew_c))]))}"/>
    ${tNow == null ? "" : `<text class="dlabel" x="${width - padR + 8}" y="${y1(tNow) + 4}">${Math.round(tNow)}° temp</text>`}
    ${dNow == null ? "" : `<text class="dlabel" x="${width - padR + 8}" y="${y1(dNow) + (close ? 16 : 4)}">${Math.round(dNow)}° dew pt</text>`}`;
    const tTicks = ticks([lo + 2, Math.round((lo + hi) / 2), hi - 2], y1, (v) => `${v}°`);
    charts.push(frame(h1, tBody, "Temperature and dew point, °F", tTicks, `<span class="lg"><i class="sw ln-temp"></i>Temperature <i class="sw ln-dew"></i>Dew point</span>`));
  }

  // wind and gusts (kt)
  const wmax = Math.ceil(Math.max(10, ...hist.map((o) => Math.max(o.wind.speed || 0, o.wind.gust || 0))) / 10) * 10, h2 = 76, y2 = scale(0, wmax, h2);
  const gusts = hist.filter((o) => o.wind.gust).map((o) => `<circle class="gust" cx="${x(o.time)}" cy="${y2(o.wind.gust)}" r="4"/>`).join("");
  const wBody = `<path class="ln wind" d="${path(hist.map((o) => [x(o.time), y2(o.wind.speed || 0)]))}"/>${gusts}
    <text class="dlabel" x="${width - padR + 8}" y="${y2(tLast.wind.speed || 0) + 4}">${tLast.wind.speed || 0} kt</text>`;
  charts.push(frame(h2, wBody, "Wind, knots", ticks([0, Math.round(wmax / 2), Math.round(wmax)], y2, (v) => v),
    `<span class="lg"><i class="sw ln-wind"></i>Wind <i class="sw dot-gust"></i>Gusts</span>`));

  // ceiling (ft); no ceiling is drawn at the top
  const CAP = 10000, h3 = 76, y3 = scale(0, CAP, h3);
  const cBody = `<path class="ln ceil step" d="${stepPath(hist.map((o) => [x(o.time), y3(Math.min(o.ceiling ?? CAP, CAP))]))}"/>
    <text class="dlabel" x="${width - padR + 8}" y="${y3(Math.min(tLast.ceiling ?? CAP, CAP)) + 4}">${tLast.ceiling == null ? "none" : num(tLast.ceiling)}</text>`;
  charts.push(frame(h3, cBody, "Ceiling, feet", ticks([0, 5000, CAP], y3, (v) => (v ? num(v / 1000) + "k" : "0")), `<span class="lg">Top line: no ceiling below ${num(CAP)}</span>`));

  // visibility (mi)
  const h4 = 64, y4 = scale(0, 10, h4);
  const vBody = `<path class="ln vis step" d="${stepPath(hist.map((o) => [x(o.time), y4(Math.min(o.visibility ?? 10, 10))]))}"/>
    <text class="dlabel" x="${width - padR + 8}" y="${y4(Math.min(tLast.visibility ?? 10, 10)) + 4}">${tLast.visibility == null ? "–" : tLast.visibility >= 10 ? "10+" : tLast.visibility} mi</text>`;
  charts.push(frame(h4, vBody, "Visibility, miles", ticks([0, 5, 10], y4, (v) => v), ""));

  // shared time axis
  let axis = "";
  const firstHour = Math.ceil(t0 / 21600) * 21600;
  for (let t = firstHour; t <= t1; t += 21600) axis += `<text class="tick" x="${x(t)}" y="14" text-anchor="middle">${hourLabel(t)}</text><line class="grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="4"/>`;
  charts.push(`<svg class="haxis" width="${width}" height="18" viewBox="0 0 ${width} 18">${axis}</svg>`);
  return { html: charts.join(""), x, t0, t1, padL, padR };
}

// ---------- TAF ----------
function tafStrip(width, taf, maxRows = 99) {
  if (!taf || !taf.periods.length) return `<p class="dim">No forecast available.</p>`;
  const now = Date.now() / 1000, t0 = Math.max(taf.from || now, now - 3600), t1 = taf.to || t0 + 86400;
  const padL = 8, padR = 8, x = (t) => padL + ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * (width - padL - padR);
  const base = taf.periods.filter((p) => !p.change || p.change === "FM" || p.change === "BECMG");
  const temp = taf.periods.filter((p) => p.change === "TEMPO" || p.probability);
  let s = "";
  base.forEach((p) => { if (p.to > t0) s += `<rect class="cat-fill cat-${p.category}" x="${x(p.from)}" y="18" width="${Math.max(2, x(p.to) - x(p.from) - 2)}" height="20" rx="4"/>`; });
  temp.forEach((p) => { if (p.to > t0) s += `<rect class="cat-fill cat-${p.category} tempo" x="${x(p.from)}" y="42" width="${Math.max(2, x(p.to) - x(p.from) - 2)}" height="9" rx="3"/>`; });
  for (let t = Math.ceil(t0 / 10800) * 10800; t <= t1; t += 10800) s += `<text class="tick" x="${x(t)}" y="12" text-anchor="middle">${hourLabel(t)}</text>`;
  const strip = `<svg class="taf-strip" width="${width}" height="56" viewBox="0 0 ${width} 56" role="img" aria-label="Forecast flight categories">${s}</svg>`;
  const rows = taf.periods.filter((p) => p.to > now).slice(0, maxRows).map((p) => {
    const passing = p.change === "TEMPO" || p.change === "PROB" || p.probability, span = `${clock(p.from)} to ${clock(p.to)}`;
    const when = p.probability ? `${p.probability}% chance${p.change === "TEMPO" ? " at times" : ""} ${span}`
      : p.change === "TEMPO" ? `At times ${span}`
      : p.change === "BECMG" && p.becoming_by > now ? `Becoming, ${clock(Math.max(p.from, now))} to ${clock(p.becoming_by)}`
      : `From ${clock(Math.max(p.from, now))}`;
    // (a passing group says only what differs: no cloud written is not a clear sky)
    const layers = p.clouds.filter((c) => c.base != null).map((c) => `${COVER[c.cover] || c.cover} ${num(c.base)}`);
    const sky = layers.length ? layers.join(", ") : p.clouds.some((c) => NO_CLOUD.includes(c.cover)) ? "no significant cloud" : passing ? null : "clear";
    const vis = p.visibility == null ? null : `${p.visibility >= 6 ? "6+" : +p.visibility.toFixed(1)} mi`;
    const bits = [p.wind && p.wind.speed != null ? windWords(p.wind) : null, vis, p.weather, sky, p.wind_shear ? "wind shear" : null].filter(Boolean);
    return `<li><span class="when">${esc(when)}</span><span class="cat-tag"><i class="sw cat-${esc(p.category)}"></i>${esc(p.category || "–")}</span><span>${esc(bits.join(", "))}</span></li>`;
  }).join("");
  return `${strip}<ul class="taf-list">${rows}</ul>`;
}

// ---------- the tab ----------
let hover = null;
export function renderWeatherTab(el, W, state) {
  if (!W || !W.now) {
    el.innerHTML = `<div class="wx-empty"><h1>Weather</h1><p>Waiting for the latest report from ${esc(state ? state.airport.icao : "the airport")}.</p></div>`;
    return;
  }
  const n = W.now, home = state.home, runways = runwayHeadings(state);
  const age = Math.round((Date.now() / 1000 - n.time) / 60);
  el.innerHTML = `<div class="wx-grid">
    <section class="wx-now">
      <div class="wx-head">
        ${catBadge(n, W.stale)}
        <div><h1>${esc(CAT_NAME[n.category] || n.category || "No flight category")}</h1><p class="sum">${esc(summary(n))}</p>
          <p class="dim${W.stale ? " old-note" : ""}">${esc(W.station)} ${n.special ? "special report" : "report"} from ${clock(n.time)}, ${age < 1 ? "just now" : hoursAgo(age)}${W.stale ? ": no newer report has come, so this is how it was, not how it is" : ""}</p></div>
      </div>
      <dl class="wx-read">
        <div><dt>Temperature</dt><dd>${degF(n.temp_c)}</dd><dd class="s">dew point ${degF(n.dew_c)}</dd></div>
        <div><dt>Humidity</dt><dd>${n.humidity == null ? "–" : `${n.humidity}%`}</dd><dd class="s">${n.temp_c == null || n.dew_c == null ? "" : n.temp_c - n.dew_c <= 2 ? "fog or low cloud likely" : `${Math.round((n.temp_c - n.dew_c) * 1.8)}°F spread`}</dd></div>
        <div><dt>Altimeter</dt><dd>${n.altimeter_inhg ?? "–"}</dd><dd class="s">inHg, ${num(n.altimeter_hpa)} hPa</dd></div>
        <div><dt>Density altitude</dt><dd>${num(n.density_alt)}</dd><dd class="s">feet; field is ${num(W.elevation_ft)} ft</dd></div>
      </dl>
      <div class="wx-figs">
        <figure class="fig-wind" id="fig-wind"></figure>
        <figure class="fig-clouds" id="fig-clouds"></figure>
      </div>
    </section>
    <section class="wx-trend">
      <h2>Last 24 hours</h2>
      <div class="hist" id="wx-hist"></div>
      <div class="hreadout" id="wx-readout">Touch or hover over the charts to read a report</div>
      <h2>Forecast</h2>
      <div id="wx-taf"></div>
      <div class="raw">${rawLine("METAR", n.raw)}${W.taf && W.taf.raw ? rawLine("TAF", W.taf.raw) : ""}</div>
    </section>
    <section class="wx-more">
      <div class="panel-sky">${sunMoonPanel(skyToday(home.lat, home.lon))}</div>
      <div class="panel-contrails">${contrailPanel(W.contrails)}</div>
      <div class="panel-airspace">${airspacePanel(W.tfrs)}</div>
    </section>
  </div>`;
  const rose = Math.min($("fig-wind").clientWidth, 260);
  $("fig-wind").innerHTML = windRose(rose, n.wind, runways) + `<figcaption>${windCaption(n.wind, runways, state.flow)}</figcaption>`;
  $("fig-clouds").innerHTML = cloudView($("fig-clouds").clientWidth, rose, n) + `<figcaption><p class="cap-main">${esc(skyWords(n))}</p><p>${esc(visWords(n) || "")}</p></figcaption>`;
  const hw = $("wx-hist").clientWidth, hc = histCharts(hw, W.history);
  $("wx-hist").innerHTML = hc.html || `<p class="dim">Not enough reports yet.</p>`;
  $("wx-taf").innerHTML = tafStrip($("wx-taf").clientWidth, W.taf);
  hover = hc;
  hookCrosshair(W.history);
}

// ---------- sun and moon, contrails, airspace ----------
// "Sunset 4:38 PM, first quarter moon"
export function sunMoonLine(home, short = false) {
  const now = Date.now(), k = skyToday(home.lat, home.lon, now);
  let sun;
  if (k.sunrise && now < k.sunrise) sun = `Sunrise ${clock(k.sunrise / 1000)}`;
  else if (k.sunset && now < k.sunset) sun = `Sunset ${clock(k.sunset / 1000)}`;
  else { const t = skyToday(home.lat, home.lon, now + 86400000).sunrise; sun = t ? `Sunrise ${clock(t / 1000)}` : null; }
  const moon = `${k.phaseName.toLowerCase()}${k.phaseName.endsWith("moon") ? "" : " moon"}`;
  if (short) return [sun, moon[0].toUpperCase() + moon.slice(1)].filter(Boolean).join("<br>");
  return [sun, `${moon}, ${Math.round(k.lit * 100)}% lit`].filter(Boolean).join(", ");
}
const dayClock = (ms) => {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString([], today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
};
const dateOnly = (ms) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const hm = (ms) => { const min = Math.round(ms / 60000); return `${Math.floor(min / 60)} h ${min % 60} min`; };

export function sunMoonPanel(k) {
  const t = (ms) => (ms ? dayClock(ms) : "–");
  return `<h2>Sun and moon</h2>
    <div class="sm">
      <dl class="sm-sun">
        <div><dt>First light</dt><dd>${t(k.dawn)}</dd></div>
        <div><dt>Sunrise</dt><dd>${t(k.sunrise)}</dd></div>
        <div><dt>Sunset</dt><dd>${t(k.sunset)}</dd></div>
        <div><dt>Last light</dt><dd>${t(k.dusk)}</dd></div>
      </dl>
      <p class="dim">${k.daylight ? `${hm(k.daylight)} of daylight` : ""}</p>
      <div class="sm-moon">${moonSvg(84, k.phase, k.lit)}
        <div><b>${esc(k.phaseName)}</b><span>${Math.round(k.lit * 100)}% lit${k.moonUp ? ", up now" : ""}</span>
          <span>${[k.moonrise ? `Rises ${t(k.moonrise)}` : null, k.moonset ? `sets ${t(k.moonset)}` : null].filter(Boolean).join(", ")}</span>
          <span class="dim">${k.nextFull && (!k.nextNew || k.nextFull < k.nextNew) ? `Full moon ${dateOnly(k.nextFull)}` : k.nextNew ? `New moon ${dateOnly(k.nextNew)}` : ""}</span></div>
      </div>
    </div>`;
}

const TRAIL = { persistent: "Long-lasting", short: "Short-lived", none: "None" };
export function contrailPanel(c) {
  if (!c || !c.levels) return `<h2>Contrails</h2><p class="dim">Waiting for the upper-air forecast.</p>`;
  const rows = [...c.levels].reverse().map((l) => `<tr class="ct-${l.state}"><td>${num(l.ft)} ft</td><td>${Math.round(l.temp_c)}°C</td>
    <td>${l.rhi}%</td><td><i class="ct-bar"></i>${TRAIL[l.state]}</td></tr>`).join("");
  return `<h2>Contrails</h2>
    <p class="sum">${esc(c.summary)}.</p>
    <table class="ct"><thead><tr><th>Altitude</th><th>Air</th><th>Humidity<small> (over ice)</small></th><th>Trail</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="dim">A trail forms where the air is cold enough for the exhaust's water to condense; it lingers and spreads only where the air is saturated over ice. Forecast for ${clock(c.at)} from the ${esc(c.source)} model.</p>`;
}

export function tfrWhen(t) {
  if (!t.start && !t.end) return "Until further notice";
  if (t.active) return t.end ? `Active until ${dayClock(t.end * 1000)}` : "Active, until further notice";
  return `${dayClock(t.start * 1000)}${t.end ? ` to ${dayClock(t.end * 1000)}` : ""}`;
}
export function tfrAlt(t) {
  if (!t.floor || !t.ceiling) return "";
  return `${t.floor.text === "the surface" ? "Surface" : t.floor.text} to ${t.ceiling.text}`;
}
export function airspacePanel(tfrs) {
  if (!tfrs) return `<h2>Flight restrictions</h2><p class="dim">Checking the FAA's list.</p>`;
  if (!tfrs.length) return `<h2>Flight restrictions</h2><p class="sum">None nearby.</p><p class="dim">Temporary flight restrictions (TFRs) close airspace for things like presidential visits, wildfires and stadium events. Source: FAA.</p>`;
  return `<h2>Flight restrictions</h2>` + tfrs.map((t) => `<article class="tfr-item${t.active ? " active" : ""}">
      <div class="tfr-top"><b>${esc(t.name || "Flight restriction")}</b>${t.drones_only ? `<span class="tag">Drones only</span>` : ""}${t.active ? `<span class="tag on">Active</span>` : ""}</div>
      <p>${esc(t.kind)}. ${esc(tfrAlt(t))}${t.dist_nm != null ? `, ${t.dist_nm < 0.5 ? "over the house" : `${t.dist_nm} nm away`}` : ""}.</p>
      <p class="dim">${esc(tfrWhen(t))}. NOTAM ${esc(t.id)}</p>
      ${t.text ? `<details><summary>Full notice</summary><p class="notam">${esc(t.text)}</p></details>` : ""}
    </article>`).join("");
}

// One vertical line across all the history charts, with the report it lands on.
function hookCrosshair(hist) {
  const box = $("wx-hist");
  if (!box || !hover || !hover.x) return;
  const move = (e) => {
    const r = box.getBoundingClientRect(), px = e.clientX - r.left;
    let best = 0;
    hist.forEach((o, i) => { if (Math.abs(hover.x(o.time) - px) < Math.abs(hover.x(hist[best].time) - px)) best = i; });
    const o = hist[best], xx = hover.x(o.time);
    box.querySelectorAll(".xh").forEach((l) => { l.setAttribute("x1", xx); l.setAttribute("x2", xx); l.removeAttribute("visibility"); });
    $("wx-readout").textContent = `${clock(o.time)}: ${o.category}, ${degF(o.temp_c)} with dew point ${degF(o.dew_c)}, ${lowerFirst(windWords(o.wind))}, ` +
      `${o.ceiling == null ? "no ceiling" : `ceiling ${num(o.ceiling)} ft`}, ${o.visibility == null ? "–" : o.visibility >= 10 ? "10+" : o.visibility} mi${o.weather ? `, ${o.weather}` : ""}`;
  };
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerdown", move);
}

// ---------- compact version for the quiet-sky rotation ----------
export function weatherSlide(el, W, state) {
  const n = W.now, runways = runwayHeadings(state);
  el.innerHTML = `<div class="idle wx-slide">
      <div class="wx-head">
        ${catBadge(n, W.stale)}
        <div><h1>Weather at ${esc(state.airport.iata)}</h1><p class="sum">${esc(summary(n))}</p>
          <p class="dim">${degF(n.temp_c)}, dew point ${degF(n.dew_c)}, altimeter ${n.altimeter_inhg ?? "–"}. Report from ${clock(n.time)}.</p>
          <p class="dim">${esc(sunMoonLine(state.home))}.${W.contrails ? ` ${esc(W.contrails.summary)}.` : ""}</p></div>
      </div>
      <div class="wx-figs"><figure class="fig-wind" id="sw-wind"></figure><figure class="fig-clouds" id="sw-clouds"></figure></div>
      ${W.taf ? `<div class="sw-taf"><h2>Forecast</h2><div id="sw-taf"></div></div>` : ""}
    </div>`;
  const size = Math.min($("sw-wind").clientWidth, $("sw-wind").clientHeight || 240, 240);
  $("sw-wind").innerHTML = windRose(size, n.wind, runways) + `<figcaption>${windCaption(n.wind, runways, state.flow)}</figcaption>`;
  $("sw-clouds").innerHTML = cloudView($("sw-clouds").clientWidth, size, n);
  if ($("sw-taf")) $("sw-taf").innerHTML = tafStrip($("sw-taf").clientWidth, W.taf, 2);
}
