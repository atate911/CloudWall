"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PLANE = "M0,-4 L1,-1 L4.2,1.2 L4.2,2 L1,1 L.8,3 L2,4 L2,4.6 L0,4 L-2,4.6 L-2,4 L-.8,3 L-1,1 L-4.2,2 L-4.2,1.2 L-1,-1 Z";

let state = null, stateAt = 0, lastTouch = 0, lastHero = null, view = "now";

// ---------- helpers ----------
const ident = (a) => (a.route && a.route.plausible && a.route.flight) || a.callsign || a.reg || a.hex.toUpperCase();
const fl = (a) => (a.on_ground ? "GND" : a.alt == null ? "–" : num(a.alt));
function badgeClass(b) {
  if (/EMERGENCY|HIJACK|RADIO|MILITARY/.test(b)) return "hot";
  if (/^NEW/.test(b)) return "new";
  if (/RARE/.test(b)) return "rare";
  return "";
}
const badges = (list) => (list || []).map((b) => `<span class="badge ${badgeClass(b)}">${esc(b)}</span>`).join("");

// Dead-reckon between polls so the scope moves smoothly.
function projected(a, dt) {
  const d = ((a.gs || 0) * dt) / 3600, t = ((a.track || 0) * Math.PI) / 180;
  return { lat: a.lat + (d * Math.cos(t)) / 60, lon: a.lon + (d * Math.sin(t)) / (60 * Math.cos((a.lat * Math.PI) / 180)) };
}
function offset(home, p) { // nm east / north of home
  return { x: (p.lon - home.lon) * 60 * Math.cos((home.lat * Math.PI) / 180), y: (p.lat - home.lat) * 60 };
}

// ---------- hero ----------
function routeHtml(a) {
  const r = a.route;
  if (!r) {
    const what = a.owner && a.owner !== "Private" ? a.owner : a.callsign && a.callsign !== a.reg ? "No published route" : "Private / general aviation";
    return `<div class="noroute">${esc(a.type_name || a.type || "Unknown aircraft")}<small>${esc(what)}</small></div>`;
  }
  const p = Math.min(0.97, Math.max(0.03, r.progress));
  // point on the quadratic arc M4,34 Q100,-22 196,34 at parameter p
  const x = (1 - p) * (1 - p) * 4 + 2 * (1 - p) * p * 100 + p * p * 196;
  const y = (1 - p) * (1 - p) * 34 + 2 * (1 - p) * p * -22 + p * p * 34;
  const ang = (Math.atan2(2 * (1 - p) * -56 + 2 * p * 56, 2 * (1 - p) * 96 + 2 * p * 96) * 180) / Math.PI + 90;
  const iata = state.airport.iata;
  return `<div class="route ${r.plausible ? "" : "unsure"}">
    <div class="apt ${r.origin.iata === iata ? "local" : ""}">${esc(r.origin.iata)}<small>${esc(r.origin.city)}</small></div>
    <div><svg class="arc" viewBox="0 0 200 40">
      <path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--line)" stroke-width="1"/>
      <path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--amber)" stroke-width="1.4" stroke-linecap="round" pathLength="1" stroke-dasharray="${p} 1"/>
      </svg>
      <div class="arc-note">${r.plausible ? routeNote(r) : "route unverified — aircraft is off this track"}</div></div>
    <div class="apt r ${r.dest.iata === iata ? "local" : ""}">${esc(r.dest.iata)}<small>${esc(r.dest.city)}</small></div>
  </div>`;
}

function routeNote(r) {
  const parts = [];
  if (r.flown_nm != null) parts.push(`${num(r.flown_nm)} nm flown · ${num(r.left_nm)} nm to go`);
  if (r.eta) {
    const late = Math.round((r.arrival_delay_s || 0) / 60);
    parts.push(`arrives ${new Date(r.eta * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` +
      (late >= 5 ? ` (${late} min late)` : late <= -5 ? ` (${-late} min early)` : ""));
  }
  if (r.source_label) parts.push(r.source_label);
  return esc(parts.join(" · "));
}

function heroHtml(a) {
  const v = a.vrate || 0;
  const arrow = v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : "";
  const r = a.route && a.route.plausible ? a.route : null;
  const sub = [a.callsign && a.callsign !== ident(a) ? a.callsign : null, a.reg, a.squawk ? "SQ " + a.squawk : null].filter(Boolean).join(" · ");
  const where = a.elev > 75 ? "Straight overhead" : `Look ${a.compass}, ${Math.round(a.elev)}° up`;
  const cpa = a.cpa_s > 5 ? `Closest in ${mmss(a.cpa_s)} at ${a.cpa_nm.toFixed(1)} nm` : "Passing now — moving away";
  const local = a.local === "arriving" ? `On approach to ${state.airport.iata}` : a.local === "departing" ? `Climbing out of ${state.airport.iata}` : a.phase[0].toUpperCase() + a.phase.slice(1);
  return `
  <div class="h-top">
    <div class="flight">${esc(ident(a))}</div>
    <div class="airline">${esc((r && r.airline) || a.owner || "")}<small>${esc(sub)}</small></div>
  </div>
  ${(a.badges && a.badges.length) || state.pinned ? `<div class="badges">${badges(a.badges)}${state.pinned ? '<span class="pinned">PINNED · tap to release</span>' : ""}</div>` : ""}
  ${routeHtml(a)}
  <div class="metrics">
    <div class="metric"><div class="label">Altitude</div><div class="v">${fl(a)} <small>ft</small> ${arrow}</div><div class="s">${v ? (v > 0 ? "+" : "") + num(v) + " fpm" : "level"}</div></div>
    <div class="metric"><div class="label">Speed</div><div class="v">${num(a.gs)} <small>kt</small></div><div class="s">${num((a.gs || 0) * 1.15078)} mph</div></div>
    <div class="metric"><div class="label">Distance</div><div class="v">${a.dist.toFixed(1)} <small>nm</small></div><div class="s">${(a.dist * 1.15078).toFixed(1)} mi ${a.compass}</div></div>
    <div class="metric"><div class="label">Heading</div><div class="v">${a.track == null ? "–" : String(Math.round(a.track)).padStart(3, "0") + "°"}</div><div class="s">${esc(local)}</div></div>
  </div>
  <div class="h-bottom">
    <div class="look"><div class="big">${where}</div><div class="sub">${cpa}</div>
      ${a.route ? `<div class="sub">${esc([a.type_name || a.type, a.type_name && a.type ? `(${a.type})` : null].filter(Boolean).join(" "))}</div>` : ""}</div>
    ${a.photo ? `<img class="photo" src="${esc(a.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
  </div>`;
}

function idleHtml() {
  const n = state.next, w = state.weather;
  const wx = w ? `${w.category || ""} at ${state.airport.iata} · wind ${w.wind_dir === "VRB" ? "variable" : String(w.wind_dir ?? 0).padStart(3, "0") + "°"} at ${w.wind_kt ?? 0} kt · ${Math.round(w.temp_c * 9 / 5 + 32)}°F` : "";
  return `<div class="idle">
    <div class="label">Nothing overhead</div>
    <h1>SKY'S QUIET</h1>
    <div class="next">${n ? `Next up: <b>${esc(ident(n))}</b> ${esc(n.type || "")} in <b>${mmss(n.cpa_s)}</b>, passing ${n.cpa_nm.toFixed(1)} nm away at about ${fl(n)} ft` : "No inbound traffic on a track toward the house right now."}</div>
    <div>${state.today} aircraft logged overhead today${state.flow ? ` · ${state.airport.iata} is landing ${state.flow.dir} (${state.flow.runways})` : ""}</div>
    <div class="dim">${esc(wx)}</div>
    ${w && w.raw ? `<div class="raw">${esc(w.raw)}</div>` : ""}
  </div>`;
}

// ---------- radar ----------
function drawRadar() {
  if (!state) return;
  const R = state.tracking.radius_nm, k = 100 / R, dt = (Date.now() - stateAt) / 1000;
  const hero = state.hero && state.hero.hex;
  let s = "";
  for (const r of [R, R * 2 / 3, R / 3]) s += `<circle class="ring" r="${r * k}"/><text x="2" y="${-r * k + 7}">${Math.round(r)}</text>`;
  s += `<circle class="ring oh" r="${state.tracking.overhead_nm * k}"/>`;
  s += `<text x="-3" y="-102">N</text><text x="103" y="2">E</text><text x="-3" y="108">S</text><text x="-109" y="2">W</text>`;
  const ap = offset(state.home, state.airport);
  if (Math.hypot(ap.x, ap.y) < R) s += `<rect class="apt-mark" x="${ap.x * k - 2.5}" y="${-ap.y * k - 2.5}" width="5" height="5"/><text x="${ap.x * k + 5}" y="${-ap.y * k + 2}">${esc(state.airport.iata)}</text>`;
  s += `<circle class="home" r="2"/>`;
  for (const a of state.aircraft) {
    const o = offset(state.home, a.on_ground ? a : projected(a, dt));
    if (Math.hypot(o.x, o.y) > R) continue;
    const x = o.x * k, y = -o.y * k, h = a.hex === hero;
    if (a.on_ground) { s += `<circle class="blip gnd" cx="${x}" cy="${y}" r="1.2"/>`; continue; }
    s += `<g data-hex="${esc(a.hex)}"><circle cx="${x}" cy="${y}" r="9" fill="transparent"/>
      <path class="blip ${h ? "hero" : ""}" d="${PLANE}" transform="translate(${x},${y}) rotate(${a.track || 0}) scale(${h ? 1.5 : 1})"/>
      <text class="tag ${h ? "hero" : ""}" x="${x + 6}" y="${y - 3}">${esc(ident(a))}</text>
      <text x="${x + 6}" y="${y + 3.5}">${a.alt == null ? "" : Math.round(a.alt / 100)}</text></g>`;
  }
  $("radar").innerHTML = s;
}

// ---------- board ----------
function boardHtml() {
  const rows = state.aircraft.filter((a) => !a.on_ground).map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0;
    return `<tr data-hex="${esc(a.hex)}" class="${state.hero && a.hex === state.hero.hex ? "hero" : ""}">
      <td class="fl">${esc(ident(a))}</td>
      <td>${r ? `${esc(r.origin.iata)} → ${esc(r.dest.iata)}` : '<span class="dim">—</span>'}</td>
      <td>${esc(a.type || "")}</td>
      <td class="num">${fl(a)} ${v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : "&nbsp;"}</td>
      <td class="num">${num(a.gs)}</td>
      <td class="num">${a.dist.toFixed(1)} ${a.compass}</td>
      <td class="num">${a.cpa_s > 0 && a.cpa_nm <= state.tracking.overhead_nm ? mmss(a.cpa_s) : '<span class="dim">—</span>'}</td></tr>`;
  });
  return `<table><thead><tr><th>Flight</th><th>Route</th><th>Type</th><th class="num">Alt ft</th><th class="num">Kt</th><th class="num">From home</th><th class="num">Overhead in</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="7" class="dim">No airborne traffic in range.</td></tr>'}</tbody></table>`;
}

// ---------- logbook ----------
const REC = [["highest", "Highest", (v) => num(v) + " ft"], ["lowest", "Lowest", (v) => num(v) + " ft"], ["fastest", "Fastest", (v) => num(v) + " kt"],
  ["closest", "Closest pass", (v) => v.toFixed(2) + " nm"], ["furthest_origin", "Furthest origin", (v) => num(v) + " nm"]];
function recs(title, r) {
  return `<h2>${title}</h2>` + REC.map(([k, label, f]) => {
    const x = r[k];
    return `<div class="rec"><span>${label}</span><span>${x ? `<b>${f(x.value)}</b> <span class="dim">${esc(x.flight || x.callsign || "")} ${esc(k === "furthest_origin" ? x.origin : x.type || "")}</span>` : '<span class="dim">—</span>'}</span></div>`;
  }).join("");
}
async function loadLog() {
  const L = await (await fetch("api/logbook")).json();
  const fa = state && state.live_routes;
  const max = Math.max(1, ...L.hours.map((h) => h.n)), byHour = Object.fromEntries(L.hours.map((h) => [h.hour, h.n]));
  let bars = "";
  for (let h = 0; h < 24; h++) bars += `<i class="${byHour[h] ? "" : "z"}" style="height:${((byHour[h] || 0) / max) * 100}%" title="${h}:00"></i>`;
  $("n-log").textContent = L.today || "";
  $("log").innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="label">Today</div><div class="v">${num(L.today)}</div></div>
      <div class="tile"><div class="label">All time</div><div class="v">${num(L.total)}</div></div>
      <div class="tile"><div class="label">Types collected</div><div class="v">${L.types.length}</div></div>
      <div class="tile"><div class="label">Airlines</div><div class="v">${L.airlines.length}</div></div>
    </div>
    <h2>Today by hour</h2><div class="hours">${bars}</div>
    <h2>Type collection</h2><div class="types">${L.types.map((t) => `<span class="type" title="${esc(t.name)}">${esc(t.type)}<b>${t.n}</b></span>`).join("") || '<span class="dim">Nothing yet — wait for the first flyover.</span>'}</div>
    <div class="cols"><div>${recs("Records today", L.records_today)}</div><div>${recs("Records all time", L.records_all)}</div></div>
    ${fa && fa.enabled ? `<div class="dim" style="margin-top:.9rem">${esc(fa.label)} lookups today: ${fa.used_today} of ${fa.daily_limit}${fa.problem ? ` — paused: ${esc(fa.problem)}` : fa.used_today >= fa.daily_limit ? " — limit reached, using free routes until midnight" : ""}</div>` : ""}
    <h2 style="margin-top:.9rem">Recent flyovers</h2>
    ${L.recent.map((s) => `<div class="rec"><span><b>${esc(s.flight || s.callsign || s.reg || s.hex)}</b> <span class="dim">${esc(s.type || "")} ${s.origin ? esc(s.origin) + " → " + esc(s.dest) : ""}</span> ${badges(s.badges)}</span>
      <span class="dim">${new Date(s.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${num(s.alt_ft)} ft · ${s.min_dist_nm.toFixed(1)} nm</span></div>`).join("")}`;
}

// ---------- chrome ----------
function setView(v) {
  view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.toggle("active", e.id === "view-" + v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  if (v === "log") loadLog().catch(() => {});
  render();
}
function render() {
  if (!state) return;
  const w = state.weather, f = state.flow;
  $("flow").hidden = !f;
  if (f) $("flow").innerHTML = `${esc(state.airport.iata)} <b>${esc(f.label)}</b> ${esc(f.runways)}`;
  $("wx").hidden = !w;
  if (w) $("wx").innerHTML = `<b class="cat-${esc(w.category)}">${esc(w.category || "WX")}</b> ${w.wind_kt ?? 0} kt · ${Math.round(w.temp_c * 9 / 5 + 32)}°F`;
  $("link").hidden = state.status.ok || !state.status.source;
  $("n-board").textContent = state.aircraft.filter((a) => !a.on_ground).length || "";
  if (view === "now") { $("hero").innerHTML = state.hero ? heroHtml(state.hero) : idleHtml(); drawRadar(); }
  if (view === "board") $("board").innerHTML = boardHtml();
}
async function poll() {
  try {
    state = await (await fetch("api/state")).json();
    stateAt = Date.now();
    const hero = state.hero && state.hero.hex;
    // A new aircraft overhead takes the screen back, unless someone is using it.
    if (hero && hero !== lastHero && view !== "now" && Date.now() - lastTouch > 45000) setView("now");
    lastHero = hero;
    render();
  } catch (e) { $("link").hidden = false; }
}
const pin = (hex) => fetch("api/pin", { method: "POST", body: JSON.stringify({ hex }) }).then(poll);

document.addEventListener("pointerdown", () => { lastTouch = Date.now(); });
document.querySelector("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("board").addEventListener("click", (e) => { const r = e.target.closest("tr[data-hex]"); if (r) { pin(r.dataset.hex); setView("now"); } });
$("radar").addEventListener("click", (e) => { const g = e.target.closest("g[data-hex]"); if (g) pin(g.dataset.hex); });
$("hero").addEventListener("click", () => { if (state && state.pinned) pin(null); });

setInterval(poll, 2000);
setInterval(() => { if (view === "now") drawRadar(); }, 1000);
setInterval(() => { if (view === "log") loadLog().catch(() => {}); }, 30000);
setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 1000);
poll();
