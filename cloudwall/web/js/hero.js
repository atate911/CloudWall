// The left-hand panel: the flight card for the aircraft overhead, or a rotating idle display.
import { $, esc, num, mmss, ident, altText, offset, clamp } from "./util.js";
import { airlineColors, typeInfo } from "./data.js";
import { silhouette, silhouetteScale } from "./silhouette.js";
import { flap, roll } from "./fx.js";
import { sky, viewingHint } from "./sky.js";
import { map, tileLayout } from "./scope.js";

// Play the entrance animation once for freshly inserted content.
function enter(el) {
  el.classList.add("enter");
  clearTimeout(el._enterTimer);
  el._enterTimer = setTimeout(() => el.classList.remove("enter"), 500);
}

let cur = { hex: null, routeKey: null, cpa0: 0, photo: null };
let slide = 0, slideAt = Date.now(), slideShown = -1, extras = { log: null, heat: null, at: 0 };
const SLIDE_SECONDS = 14;

function badgeClass(b) {
  if (/EMERGENCY|HIJACK|RADIO|MILITARY/.test(b)) return "hot";
  if (/^NEW/.test(b)) return "new";
  if (/RARE/.test(b)) return "rare";
  return "";
}
export const badges = (list) => (list || []).map((b) => `<span class="badge ${badgeClass(b)}">${esc(b)}</span>`).join("");

const SKELETON = `
  <div class="hero-photo" id="h-photo"></div><div class="hero-tint"></div>
  <div class="h-top">
    <div class="flaps flight" id="h-flight"></div>
    <div class="airline"><span id="h-airline"></span><small id="h-sub"></small></div>
    <div class="countdown" id="h-countdown"><svg viewBox="0 0 40 40"><circle class="c-track" cx="20" cy="20" r="17"/><circle class="c-fill" id="h-ring" cx="20" cy="20" r="17" pathLength="100" transform="rotate(-90 20 20)"/></svg><b id="h-count"></b></div>
  </div>
  <div class="tags"><div class="badges" id="h-badges"></div><div class="pin-chip" id="h-pin" hidden>Pinned · tap card to release</div></div>
  <div class="h-route" id="h-route"></div>
  <div class="metrics">
    <div class="metric"><div class="label">Altitude</div><div class="v"><span id="h-alt"></span> <small>ft</small> <span id="h-arrow"></span></div><div class="s" id="h-vrate"></div></div>
    <div class="metric"><div class="label">Speed</div><div class="v"><span id="h-gs"></span> <small>kt</small></div><div class="s" id="h-mph"></div></div>
    <div class="metric"><div class="label">Distance</div><div class="v"><span id="h-dist"></span> <small>nm</small></div><div class="s" id="h-dist2"></div></div>
    <div class="metric"><div class="label">Heading</div><div class="v" id="h-hdg"></div><div class="s" id="h-phase"></div></div>
  </div>
  <div class="h-bottom">
    <div class="look"><div class="big" id="h-look"></div><div class="sub" id="h-hint"></div></div>
    <div class="type"><div class="sil-box" id="h-sil"></div><div class="sub" id="h-type"></div></div>
  </div>`;

function routeHtml(a, state) {
  const r = a.route;
  if (!r) {
    // the headline above already says who flies it, so say something new here
    const what = a.squawk === "1200" ? "Flying visually, no flight plan (squawk 1200)" : a.callsign && a.callsign !== a.reg ? "No published route for this flight" : "No flight plan on file";
    return `<div class="noroute"><div class="label">No route</div>${esc(a.type_name || a.type || "Unknown aircraft")}<small>${esc(what)}</small></div>`;
  }
  const iata = state.airport.iata;
  return `<div class="route ${r.plausible ? "" : "unsure"}">
    <div class="apt ${r.origin.iata === iata ? "local" : ""}"><div class="flaps" id="h-orig"></div><small>${esc(r.origin.city || r.origin.name || "")}</small></div>
    <div><svg class="arc" viewBox="0 0 200 40">
      <path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--line)" stroke-width="1"/>
      <path id="h-arc" d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--amber)" stroke-width="1.4" stroke-linecap="round" pathLength="1"/>
      <circle id="h-arc-dot" r="2.4" fill="var(--amber)"/></svg>
      <div class="arc-note" id="h-note"></div></div>
    <div class="apt r ${r.dest.iata === iata ? "local" : ""}"><div class="flaps" id="h-dest"></div><small>${esc(r.dest.city || r.dest.name || "")}</small></div>
  </div>`;
}

function routeNote(r) {
  if (!r.plausible) return "route unverified — aircraft is off this track";
  const parts = [];
  if (r.flown_nm != null) parts.push(`${num(r.flown_nm)} nm flown · ${num(r.left_nm)} nm to go`);
  if (r.eta) {
    const late = Math.round((r.arrival_delay_s || 0) / 60);
    parts.push(`arrives ${new Date(r.eta * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` + (late >= 5 ? ` (${late} min late)` : late <= -5 ? ` (${-late} min early)` : ""));
  }
  if (r.source_label) parts.push(r.source_label);
  return parts.join(" · ");
}

function showHero(el, a, state) {
  const fresh = cur.hex !== a.hex;
  if (fresh) {
    el.innerHTML = SKELETON;
    el.className = "panel hero-card";
    enter(el);
    cur = { hex: a.hex, routeKey: null, cpa0: 0, photo: null };
    slideShown = -1;
    const colors = airlineColors(a);
    el.style.setProperty("--air1", colors ? colors[0] : "transparent");
    el.style.setProperty("--air2", colors ? colors[1] : "transparent");
    el.classList.toggle("liveried", !!colors);
  }
  const r = a.route, pr = r && r.plausible ? r : null;
  const id = ident(a), info = typeInfo(a);
  flap($("h-flight"), id);
  const ga = info.shape === "piston" || info.shape === "heli" || /^N\d/.test(a.callsign || "");
  $("h-airline").textContent = (pr && pr.airline) || (r && r.airline) || (a.owner && a.owner !== "Private" ? a.owner : ga ? "General aviation" : "");
  $("h-sub").textContent = [a.callsign !== id ? a.callsign : null, a.reg !== id ? a.reg : null, a.squawk ? "Squawk " + a.squawk : null].filter(Boolean).join(" · ");
  const bh = badges(a.badges);
  if ($("h-badges").innerHTML !== bh) $("h-badges").innerHTML = bh;
  $("h-pin").hidden = !state.pinned;

  const key = r ? [r.flight, r.origin.iata, r.dest.iata, r.plausible].join("|") : "none:" + (a.type_name || a.type || "");
  if (key !== cur.routeKey) {
    cur.routeKey = key;
    $("h-route").innerHTML = routeHtml(a, state);
    if (r) { flap($("h-orig"), r.origin.iata || "???"); flap($("h-dest"), r.dest.iata || "???"); }
  }
  if (r) {
    const p = clamp(r.progress, 0.03, 0.97);
    $("h-arc").setAttribute("stroke-dasharray", `${p} 1`);
    $("h-arc-dot").setAttribute("cx", (1 - p) ** 2 * 4 + 2 * (1 - p) * p * 100 + p * p * 196);
    $("h-arc-dot").setAttribute("cy", (1 - p) ** 2 * 34 + 2 * (1 - p) * p * -22 + p * p * 34);
    $("h-note").textContent = routeNote(r);
  }

  const v = a.vrate || 0;
  roll($("h-alt"), a.on_ground ? 0 : a.alt);
  $("h-arrow").innerHTML = v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : "";
  $("h-vrate").textContent = Math.abs(v) > 100 ? (v > 0 ? "+" : "") + num(v) + " fpm" : "level";
  roll($("h-gs"), a.gs);
  $("h-mph").textContent = num((a.gs || 0) * 1.15078) + " mph";
  roll($("h-dist"), a.dist, (x) => x.toFixed(1));
  $("h-dist2").textContent = `${(a.dist * 1.15078).toFixed(1)} mi ${a.compass}`;
  $("h-hdg").textContent = a.track == null ? "–" : String(Math.round(a.track)).padStart(3, "0") + "°";
  $("h-phase").textContent = a.local === "arriving" ? `On approach to ${state.airport.iata}` : a.local === "departing" ? `Climbing out of ${state.airport.iata}` : a.phase[0].toUpperCase() + a.phase.slice(1);

  $("h-look").textContent = a.elev > 75 ? "Straight overhead" : `Look ${a.compass}, ${Math.round(a.elev)}° up`;
  $("h-hint").textContent = viewingHint(a);

  const sil = $("h-sil");
  if (sil.dataset.shape !== info.shape + info.length) {
    sil.dataset.shape = info.shape + info.length;
    sil.innerHTML = silhouette(info.shape);
    sil.firstElementChild.style.width = silhouetteScale(info.length) * 100 + "%";
  }
  // with no route the type name is already the headline, so keep this line short
  const name = r ? a.type_name || a.type : a.type;
  $("h-type").textContent = [name, r && a.type_name && a.type ? `(${a.type})` : null, info.known ? `${info.length} m long` : null].filter(Boolean).join(" · ").replace(" · (", " (");

  if (a.photo && cur.photo !== a.photo) {
    cur.photo = a.photo;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => { if (cur.photo === a.photo) { $("h-photo").style.backgroundImage = `url("${encodeURI(a.photo)}")`; $("h-photo").classList.add("on"); } };
    img.src = a.photo;
  }
  cur.a = a;
  tickHero(0);
}

// Called every second: drains the countdown ring between data updates.
export function tickHero(elapsed) {
  const a = cur.a, ring = $("h-ring");
  if (!a || !ring) return;
  const left = a.cpa_s - elapsed;
  cur.cpa0 = Math.max(cur.cpa0, a.cpa_s, 30);
  const box = $("h-countdown");
  if (left > 3) {
    ring.setAttribute("stroke-dasharray", `${clamp((left / cur.cpa0) * 100, 0, 100)} 100`);
    $("h-count").textContent = mmss(left);
    box.title = "time to closest pass";
    box.classList.remove("gone");
  } else {
    ring.setAttribute("stroke-dasharray", "0 100");
    $("h-count").textContent = "PAST";
    box.classList.add("gone");
  }
}

// ---------- idle: rotate through a few quiet-sky displays ----------
function quietSlide(state) {
  const n = state.next, w = state.weather;
  const wx = w ? `${w.category || ""} at ${state.airport.iata} · wind ${w.wind_dir === "VRB" ? "variable" : String(w.wind_dir ?? 0).padStart(3, "0") + "°"} at ${w.wind_kt ?? 0} kt · ${Math.round((w.temp_c * 9) / 5 + 32)}°F` : "";
  return `<div class="label">Nothing overhead</div><h1>SKY'S QUIET</h1>
    <div class="next">${n ? `Next up: <b>${esc(ident(n))}</b> ${esc(n.type || "")} in <b>${mmss(n.cpa_s)}</b>, passing ${n.cpa_nm.toFixed(1)} nm away at about ${altText(n)} ft` : "No inbound traffic on a track toward the house right now."}</div>
    <div>${state.today} aircraft logged overhead today${state.flow ? ` · ${esc(state.airport.iata)} is landing ${state.flow.dir} (${esc(state.flow.runways)})` : ""}</div>
    <div class="dim">${esc(wx)}</div>${w && w.raw ? `<div class="raw">${esc(w.raw)}</div>` : ""}`;
}
const REC = [["highest", "Highest", (v) => num(v) + " ft"], ["lowest", "Lowest", (v) => num(v) + " ft"], ["fastest", "Fastest", (v) => num(v) + " kt"],
  ["closest", "Closest pass", (v) => v.toFixed(2) + " nm"], ["furthest_origin", "Furthest origin", (v) => num(v) + " nm"]];
export function recordsHtml(title, r) {
  return `<h2>${title}</h2>` + REC.map(([k, label, f]) => {
    const x = r[k];
    return `<div class="rec"><span>${label}</span><span>${x ? `<b>${f(x.value)}</b> <span class="dim">${esc(x.flight || x.callsign || "")} ${esc(k === "furthest_origin" ? x.origin : x.type || "")}</span>` : '<span class="dim">—</span>'}</span></div>`;
  }).join("");
}
function lastSlide(s) {
  const when = new Date(s.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `<div class="label">Last flyover · ${when}</div><h1 class="amber">${esc(s.flight || s.callsign || s.reg || s.hex)}</h1>
    <div class="next">${esc(s.airline || "")} ${esc(s.type_name || s.type || "")}</div>
    <div>${s.origin ? `${esc(s.origin)} → ${esc(s.dest)} · ` : ""}${num(s.alt_ft)} ft · passed ${s.min_dist_nm.toFixed(1)} nm away</div>
    <div class="badges">${badges(s.badges)}</div>`;
}

// Load the map tiles for the heatmap, then draw (and draw again once they arrive).
function drawHeat(canvas, state, heat) {
  const bm = state.basemap;
  if (!bm || !bm.enabled) return paintHeat(canvas, state, heat, null);
  const R = heat.radius_nm, px = Math.min(canvas.parentElement.clientHeight * 0.94, canvas.parentElement.clientWidth * 0.56) * (window.devicePixelRatio || 1);
  const tiles = tileLayout(state.home, R, px / (2 * R)).tiles.map((t) => ({ ...t, img: new Image() }));
  let pending = tiles.length;
  const done = () => { if (--pending === 0 && canvas.isConnected) paintHeat(canvas, state, heat, tiles); };
  for (const t of tiles) { t.img.onload = t.img.onerror = done; t.img.src = t.url; }
  paintHeat(canvas, state, heat, tiles);
}

function paintHeat(canvas, state, heat, tiles) {
  // a square that fits beside the caption, sized here because CSS can't keep a canvas square in a flex row
  const box = canvas.parentElement, css = Math.floor(Math.min(box.clientHeight * 0.94, box.clientWidth * 0.56));
  canvas.style.width = canvas.style.height = css + "px";
  const size = css * (window.devicePixelRatio || 1);
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d"), n = heat.grid, cell = size / n, R = heat.radius_nm, k = size / (2 * R);
  const XY = (lat, lon) => { const o = offset(state.home, { lat, lon }); return [size / 2 + o.x * k, size / 2 - o.y * k]; };
  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, 7); g.clip();
  g.fillStyle = "rgba(6,10,15,.55)"; g.fillRect(0, 0, size, size);
  const bm = state.basemap;
  if (bm && bm.enabled && tiles) {
    // the same faint map as the radar, so the hot spots line up with real places
    g.globalAlpha = bm.opacity;
    g.filter = bm.style === "dark" ? "contrast(1.35)" : bm.style === "light" ? "invert(1) contrast(1.1) brightness(.8)" : "saturate(.5) brightness(.6)";
    for (const t of tiles) if (t.img.complete && t.img.naturalWidth) g.drawImage(t.img, size / 2 + t.x0 * k, size / 2 - t.y0 * k, (t.x1 - t.x0) * k + 0.5, (t.y0 - t.y1) * k + 0.5);
    g.globalAlpha = 1; g.filter = "none";
  } else if (map) {
    g.strokeStyle = "rgba(74,144,196,.45)"; g.lineCap = g.lineJoin = "round";
    for (const w of map.water || []) { g.lineWidth = Math.max(2, w.width_nm * k); g.beginPath(); w.line.forEach(([la, lo], i) => { const [x, y] = XY(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  }
  const max = Math.max(1, ...heat.cells.map((c) => c[2]));
  g.globalCompositeOperation = "lighter";
  for (const [x, y, c] of heat.cells) {
    const t = Math.sqrt(c / max), cx = (x + 0.5) * cell, cy = (y + 0.5) * cell, rad = cell * 2.2;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(255,${Math.round(120 + 110 * t)},${Math.round(40 + 120 * t * t)},${0.1 + 0.5 * t})`);
    grad.addColorStop(1, "rgba(255,150,40,0)");
    g.fillStyle = grad; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  g.restore();
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1; g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, 7); g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(size / 2, size / 2, Math.max(3, size / 110), 0, 7); g.fill();
  const [ax, ay] = XY(state.airport.lat, state.airport.lon);
  g.font = `${Math.round(size / 32)}px ui-monospace, monospace`; g.fillStyle = "rgba(255,255,255,.8)"; g.textAlign = "center"; g.fillText(state.airport.iata, ax, ay + size / 24);
}

async function refreshExtras() {
  if (Date.now() - extras.at < 60000) return;
  extras.at = Date.now();
  try {
    const [log, heat] = await Promise.all([fetch("api/logbook").then((r) => r.json()), fetch("api/heat").then((r) => r.json())]);
    extras.log = log; extras.heat = heat;
  } catch (e) { /* keep showing what we had */ }
}

function showIdle(el, state) {
  if (cur.hex !== null) { cur = { hex: null }; slide = 0; slideAt = Date.now(); slideShown = -1; }   // a flight just left
  refreshExtras();
  const L = extras.log, H = extras.heat;
  const slides = ["quiet"];
  if (H && H.cells.length > 8) slides.push("heat");
  if (L && L.today > 0) slides.push("records");
  if (L && L.recent.length) slides.push("last");
  if (Date.now() - slideAt > SLIDE_SECONDS * 1000) { slide++; slideAt = Date.now(); }
  slide %= slides.length;
  const kind = slides[slide], dots = slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<i class="${i === slide ? "on" : ""}"></i>`).join("")}</div>` : "";
  const changed = slideShown !== slide;
  if (changed) { el.className = "panel idle-card"; enter(el); }
  if (kind === "quiet") {
    const html = `<div class="idle">${quietSlide(state)}</div>${dots}`;
    if (changed || el._html !== html) { el.innerHTML = el._html = html; }
    slideShown = slide;
    return;
  }
  if (!changed) return;                             // other slides are drawn once
  slideShown = slide;
  el._html = null;
  if (kind === "heat") {
    el.innerHTML = `<div class="idle heat"><div><div class="label">Today's traffic</div><h1>WHERE THEY FLEW</h1><div class="dim">Every aircraft tracked today within ${H.radius_nm} nm. Brighter means busier. The white dot is home.</div></div><canvas id="heat"></canvas></div>${dots}`;
    drawHeat($("heat"), state, H);
  } else if (kind === "records") {
    el.innerHTML = `<div class="idle"><div class="label">${L.today} flyovers today · ${L.types.length} aircraft types all time</div>${recordsHtml("Today's records", L.records_today)}</div>${dots}`;
  } else {
    const s = L.recent[0];
    el.innerHTML = `${s.photo ? `<div class="hero-photo on strong" style="background-image:url('${encodeURI(s.photo)}')"></div>` : ""}<div class="idle">${lastSlide(s)}</div>${dots}`;
  }
}

export function nextSlide() { slide++; slideAt = Date.now(); }
export function renderHero(el, state) {
  if (state.hero) showHero(el, state.hero, state);
  else { cur.a = null; showIdle(el, state); }
}
