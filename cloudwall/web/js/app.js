"use strict";
import { $, esc, num, mmss, ident, altText, store, phone } from "./util.js";
import { updateSky, sky } from "./sky.js";
import { drawScope, loadMap } from "./scope.js";
import { renderHero, tickHero, nextSlide, badges, recordsHtml, forgetHero, boardFlight } from "./hero.js";
import { renderEmergency } from "./emergency.js";
import { chime, soundOn, setSound } from "./fx.js";
import { airlineColors, typeInfo } from "./data.js";
import { plate, drawn } from "./plate.js";
import { renderWeatherTab } from "./weather.js";
import { renderKiosk, tickKiosk, kioskNext, forgetKiosk } from "./kiosk.js";

// Kiosk mode (/kiosk, or ?mode=kiosk): the across-the-room display. Otherwise the desktop view.
const KIOSK = /\/kiosk\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("mode") === "kiosk";
document.documentElement.classList.add(KIOSK ? "kiosk" : "desk");
document.body.classList.add(KIOSK ? "kiosk" : "desk");
if (KIOSK) store("scope", "auto");   // the kiosk has no switch; sky view when something is overhead

let state = null, stateAt = 0, stateAtPerf = 0, lastTouch = 0, lastHero = null, view = "now", mapFor = null;

// Phone layout: the desktop page rearranged for a phone in the hand, taken on by any screen that
// small, and changing with it as the phone turns. ?mode=phone forces it; ?mode=desktop keeps it off.
const MODE = new URLSearchParams(location.search).get("mode");
const phoneQ = matchMedia("(max-width: 700px), (max-height: 500px) and (orientation: landscape)");
const landQ = matchMedia("(orientation: landscape)");
function applyPhone() {
  const on = !KIOSK && MODE !== "desktop" && (MODE === "phone" || phoneQ.matches);
  const was = phone(), cl = document.documentElement.classList;
  cl.toggle("phone", on);
  cl.toggle("land", on && landQ.matches);
  if (phone() === was) return;
  forgetHero();                    // the card and its slides are sized for the layout: draw them again
  scopeLabel = "";
  if (view === "wx") loadWeather(true);
  render();
}
phoneQ.addEventListener("change", applyPhone);
landQ.addEventListener("change", applyPhone);

// Upright on a phone the radar sits under the card, so a card that changes height (the next slide, a
// new flight) would move the radar under the reader's eyes. Browsers that anchor the scroll keep it
// still themselves; elsewhere, when the card is mostly scrolled past, scroll by what it grew.
const anchors = CSS.supports("overflow-anchor", "auto");
function keepPlace(draw) {
  if (anchors || phone() !== "stack") return draw();
  const hero = $("hero"), h0 = hero.offsetHeight, above = hero.getBoundingClientRect().bottom < innerHeight / 2;
  draw();
  const d = hero.offsetHeight - h0;
  if (d && above) scrollBy(0, d);
}

// The browser's own bars take the chart's paper colour, by day, by night and in an emergency.
const themeMeta = document.querySelector('meta[name="theme-color"]');
function paintTheme() {
  const c = getComputedStyle(document.body).getPropertyValue("--paper").trim();
  if (themeMeta && c && themeMeta.content !== c) themeMeta.content = c;
}

// ---------- emergencies ----------
const hidden = new Set();                 // "hex:code" the desktop user chose to hide
let emShown = "";
const emKey = (a) => `${a.hex}:${a.emergency_code}`;
function emergencies() {
  return ((state && state.emergency) || []).filter((a) => !hidden.has(emKey(a)));
}

// ---------- board ----------
function boardHtml() {
  const R = state.tracking, heroHex = state.hero && state.hero.hex;
  const air = state.aircraft.filter((a) => !a.on_ground).sort((a, b) => {
    // inbound to the house first, soonest first; then everything else by distance
    const ia = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm, ib = b.cpa_s > 0 && b.cpa_nm <= R.overhead_nm;
    return ia !== ib ? ib - ia : ia ? a.cpa_s - b.cpa_s : a.dist - b.dist;
  });
  if (phone()) return phoneBoardHtml(air, heroHex, R);
  const rows = air.map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0, c = airlineColors(a);
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    return `<tr data-hex="${esc(a.hex)}" class="${a.hex === heroHex ? "hero" : ""}">
      <td class="lg">${state.logos && a.airline_iata ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc((r && r.airline) || a.airline || "")}"></span>` : ""}<i class="sw" style="background:${c ? c[0] : "var(--rule)"}"></i></td>
      <td class="fl">${esc(ident(a))}<small>${esc((r && r.airline) || a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || a.type_name || "")}</small></td>
      <td class="rt">${r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}<small>${esc(r.origin.city || "")} to ${esc(r.dest.city || "")}</small>` : '<span class="dim">—</span>'}</td>
      <td class="ty">${esc(a.type || "")}<small>${esc(shortType(a.type_name))}</small></td>
      <td class="num">${altText(a)} <small class="u">ft</small><span class="vs">${v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : ""}</span></td>
      <td class="num">${num(a.gs)} <small class="u">kt</small></td>
      <td class="num">${a.dist.toFixed(1)} <small class="u">nm</small><span class="cmp">${a.compass}</span></td>
      <td class="num ${soon ? "soon" : ""}">${soon ? mmss(a.cpa_s) : '<span class="dim">—</span>'}</td></tr>`;
  });
  return `<table class="board"><thead><tr><th></th><th>Flight</th><th>Route</th><th>Type</th><th class="num">Altitude</th><th class="num">Speed</th><th class="num">Distance</th><th class="num">Overhead in</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="8" class="empty">No airborne traffic within ' + R.radius_nm + " nm.</td></tr>"}</tbody>
    ${(state.heard || []).length ? `<tbody class="heard"><tr><th colspan="8">Heard nearby, position unknown</th></tr>${state.heard.map((a) => `<tr>
      <td class="lg"></td><td class="fl">${esc(a.callsign || a.reg || a.hex.toUpperCase())}<small>${esc(a.owner_op || "Military")}</small></td>
      <td class="rt"><span class="dim">No position sent</span></td><td class="ty">${esc(a.type || "")}<small>${esc(shortType(a.desc))}</small></td>
      <td class="num">${a.alt == null ? "–" : num(a.alt)} <small class="u">ft</small></td><td class="num">${a.gs == null ? "–" : num(a.gs)} <small class="u">kt</small></td>
      <td class="num"><span class="dim">within ~${Math.max(a.rough_nm, 10)}</span> <small class="u">nm</small></td><td class="num"><span class="dim">—</span></td></tr>`).join("")}</tbody>` : ""}</table>
    <div class="board-foot">Soonest overhead first. Tap a flight to show it on the flight card.</div>`;
}

// On a phone the eight columns become two lines a flight, everything the table says in a thumb's width:
//   AS 512   SFO to PDX              2:14      (overhead in, or how far away)
//   [Alaska logo] B739      12,300 ft ▼ 280 kt
function phoneBoardHtml(air, heroHex, R) {
  const vs = (v) => (v > 300 ? ' <span class="up">▲</span>' : v < -300 ? ' <span class="down">▼</span>' : "");
  const row = (a) => {
    const r = a.route && a.route.plausible ? a.route : null, c = airlineColors(a);
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    const name = (r && r.airline) || a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || shortType(a.type_name) || "";
    // the logo stands for the airline's name; if it fails to load, the name shows instead
    const logo = state.logos && a.airline_iata && name ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc(name)}"></span>` : "";
    return `<button class="pb-row${a.hex === heroHex ? " hero" : ""}" data-hex="${esc(a.hex)}">
      <i class="sw" style="background:${c ? c[0] : "var(--rule)"}"></i>
      <span class="pb-id">${esc(boardFlight(ident(a)))}</span>
      <span class="pb-rt">${r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}` : a.local ? `<span class="dim">${esc(a.local === "arriving" ? "Landing" : a.local === "departing" ? "Departing" : "Local")}</span>` : '<span class="dim">—</span>'}</span>
      <span class="pb-when${soon ? " soon" : ""}">${soon ? mmss(a.cpa_s) : `${a.dist.toFixed(1)}<small> nm<span class="pb-cmp"> ${esc(a.compass)}</span></small>`}</span>
      <span class="pb-l2"><span class="pb-sub">${logo}${name ? `<span class="pb-name">${esc(name)}</span>` : ""}${a.type ? `<span class="pb-type">${esc(a.type)}</span>` : ""}</span>
      <span class="pb-data">${altText(a)}<small> ft</small>${vs(a.vrate || 0)}<span class="pb-gs">${num(a.gs)}<small> kt</small></span></span></span></button>`;
  };
  const heard = (state.heard || []).map((a) => `<div class="pb-row heard">
      <i class="sw"></i><span class="pb-id">${esc(a.callsign || a.reg || a.hex.toUpperCase())}</span>
      <span class="pb-rt"><span class="dim">No position</span></span><span class="pb-when"><small>~${Math.max(a.rough_nm, 10)} nm</small></span>
      <span class="pb-l2"><span class="pb-sub"><span class="pb-name">${esc(a.owner_op || "Military")}</span>${a.type ? `<span class="pb-type">${esc(a.type)}</span>` : ""}</span>
      <span class="pb-data">${a.alt == null ? "–" : num(a.alt)}<small> ft</small><span class="pb-gs">${a.gs == null ? "–" : num(a.gs)}<small> kt</small></span></span></span></div>`).join("");
  return `<div class="pboard">${air.map(row).join("") || `<p class="empty">No airborne traffic within ${R.radius_nm} nm.</p>`}</div>
    ${heard ? `<h2>Heard nearby, position unknown</h2><div class="pboard">${heard}</div>` : ""}
    <div class="board-foot">Soonest overhead first. Tap a flight to show it on the flight card.</div>`;
}

// "Boeing 737-800" stays; the database's long variants ("737NG 890/W") are trimmed to the model
function shortType(name) {
  if (!name) return "";
  return name.length > 22 ? name.split(/[\s/]/).slice(0, 2).join(" ") : name;
}

// ---------- desktop: compact list beside the radar on wide screens ----------
function renderMiniBoard() {
  const box = $("mini-board");
  if (!box || getComputedStyle(box).display === "none") return;
  const R = state.tracking, heroHex = state.hero && state.hero.hex;
  const air = state.aircraft.filter((a) => !a.on_ground).sort((a, b) => a.dist - b.dist).slice(0, 14);
  box.innerHTML = `<h2>Nearby</h2>` + (air.map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0;
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    return `<button class="mb-row ${a.hex === heroHex ? "hero" : ""}" data-hex="${esc(a.hex)}">
      <span class="mb-id">${esc(ident(a))}</span><span class="mb-rt">${r ? `${esc(r.origin.iata)}–${esc(r.dest.iata)}` : esc(a.type || "")}</span>
      <span class="mb-alt">${altText(a)}${v > 300 ? " ▲" : v < -300 ? " ▼" : ""}</span><span class="mb-when ${soon ? "soon" : ""}">${soon ? mmss(a.cpa_s) : `${a.dist.toFixed(1)} nm`}</span></button>`;
  }).join("") || '<p class="dim">No aircraft in range.</p>');
}

// ---------- logbook ----------
function budgetLine(fa) {
  const u = fa.unit || "lookups";
  const parts = [`${esc(fa.label)} ${u} used today: ${num(fa.used_today)}${fa.daily_limit != null ? ` of ${num(fa.daily_limit)} allowed` : ""}`];
  if (fa.period_budget != null) {
    parts.push(`${num(fa.period_used)} of ${num(fa.period_budget)} this billing period (${Math.round(fa.margin * 100)}% of ${num(fa.monthly_limit)} held back, resets ${esc(fa.resets)})`);
  }
  if (fa.reported) parts.push(`${esc(fa.label)} itself reports ${num(fa.reported["24h"])} ${u} in the last 24 hours and ${num(fa.reported["30d"])} in 30 days`);
  if (fa.problem) parts.push(`paused: ${esc(fa.problem)}`);
  else if (fa.period_budget != null && fa.period_used >= fa.period_budget) parts.push("budget used up: free routes until the period resets");
  else if (fa.daily_limit != null && fa.used_today >= fa.daily_limit) parts.push("today's share used: free routes until midnight");
  return parts.join(". ") + ".";
}

async function loadLog() {
  const L = await (await fetch("api/logbook")).json();
  const fa = state && state.live_routes;
  const max = Math.max(1, ...L.hours.map((h) => h.n)), byHour = Object.fromEntries(L.hours.map((h) => [h.hour, h.n]));
  let bars = "";
  for (let h = 0; h < 24; h++) bars += `<i class="${byHour[h] ? "" : "z"}" style="height:${((byHour[h] || 0) / max) * 100}%" title="${h}:00"></i>`;
  const axis = ["12a", "6a", "12p", "6p", ""].map((t) => `<span>${t}</span>`).join("");
  $("n-log").textContent = L.today || "";
  $("log").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Flyovers today</div><div class="v">${num(L.today)}</div></div>
      <div class="stat"><div class="label">Seats today</div><div class="v">≈ ${num(L.seats_today.seats)}</div></div>
      <div class="stat"><div class="label">Flyovers, all time</div><div class="v">${num(L.total)}</div></div>
      <div class="stat"><div class="label">Seats, all time</div><div class="v">≈ ${num(L.seats_total.seats)}</div></div>
      <div class="stat"><div class="label">Types collected</div><div class="v">${L.types.length}</div></div>
      <div class="stat"><div class="label">Airlines</div><div class="v">${L.airlines.length}</div></div>
    </div>
    <p class="stats-note">Seats are estimated from each flight's airline and aircraft type; cargo flights count as none.${
      L.seats_total.flights - L.seats_total.known ? ` ${num(L.seats_total.flights - L.seats_total.known)} flyover${L.seats_total.flights - L.seats_total.known === 1 ? "" : "s"} of unknown type left out.` : ""}</p>
    <h2>Today by hour</h2><div class="hours">${bars}</div><div class="hours-axis">${axis}</div>
    <h2>Type collection</h2><div id="log-coll"></div>
    <div class="cols"><div>${recordsHtml("Records today", L.records_today)}</div><div>${recordsHtml("Records all time", L.records_all)}</div></div>
    <h2 style="margin-top:.9rem">Recent flyovers</h2>
    ${L.recent.map((s) => `<div class="rec"><span><b>${esc(s.flight || s.callsign || s.reg || s.hex)}</b> <span class="dim">${esc(s.type || "")} ${s.origin ? esc(s.origin) + " → " + esc(s.dest) : ""}</span> ${badges(s.badges)}</span>
      <span class="dim">${new Date(s.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, ${num(s.alt_ft)} ft, ${s.min_dist_nm.toFixed(1)} nm from home</span></div>`).join("")}
    ${fa && fa.enabled ? `<h2 style="margin-top:1.4rem">Flight data usage</h2><div class="usage">${budgetLine(fa)}</div>` : ""}`;
  $("log-coll").replaceWith(collection(L.types));
}

// The type collection: a drawing of every type logged, with how often and since when. Its
// drawings are kept between the logbook's refreshes and rebuilt only when the list changes.
let coll = { key: null, el: null };
function collection(types) {
  const key = types.map((t) => `${t.type}:${t.n}:${t.model || ""}`).join(",");
  if (coll.key === key && coll.el) return coll.el;
  const el = document.createElement("div");
  el.className = "collection";
  const day = (ts) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
  };
  el.innerHTML = types.map((t) => {
    const info = typeInfo({ type: t.type, type_name: t.name, model: t.model });
    return `<figure class="coll${drawn(info) ? "" : " unknown"}"><div class="sil-box">${drawn(info) ? plate(info, { dim: false }) : `<code>${esc(t.type)}</code>`}</div>
      <figcaption><div><code>${esc(t.type)}</code> <span>${esc(shortType(t.name) || "")}</span></div>
      <div class="dim"><b>${num(t.n)}</b> ${t.n === 1 ? "sighting" : "sightings"}${t.first ? `, since ${day(t.first)}` : ""}</div></figcaption></figure>`;
  }).join("") || '<span class="dim">Nothing yet. The first flyover starts the collection.</span>';
  coll = { key, el };
  return el;
}

// ---------- scope: sky dome while something is overhead, radar otherwise ----------
function scopeMode() {
  if (emergencies().length) return "radar";      // where it is matters more than how high it looks
  const pref = store("scope") || "auto";
  return pref === "auto" ? (state && state.hero ? "sky" : "radar") : pref;
}
// Radar options: drawn as a chart or as an air traffic control screen, track lines on or off, and
// the range. The desktop's buttons set them for each screen; the kiosk, which has no buttons, takes
// them from the [kiosk] settings. The address overrides either (?radar=atc&tracks=off&range=30).
const qs = new URLSearchParams(location.search);
function radarPrefs() {
  const k = (KIOSK && state && state.kiosk) || {}, ranges = (state && state.ranges) || [15, 20, 30];
  const pick = (name, saved, ok) => [qs.get(name), saved].find(ok);
  const style = pick("radar", KIOSK ? k.radar : store("radarStyle"), (v) => v === "chart" || v === "atc") || "chart";
  const tracks = pick("tracks", KIOSK ? (k.tracks === false ? "off" : "on") : store("tracks"), (v) => v === "on" || v === "off") !== "off";
  const range = +(pick("range", KIOSK ? k.range_nm : store("range"), (v) => v != null && ranges.includes(+v)) || ranges[0]);
  return { style, tracks, range };
}
let scopeLabel = "";
function drawScopeNow(now = performance.now()) {
  if (!state || view !== "now") return;
  const mode = scopeMode(), pref = store("scope") || "auto", { style, tracks, range } = radarPrefs();
  const atc = mode === "radar" && style === "atc";
  const bm = state.basemap, credit = mode === "radar" && !atc && bm && bm.enabled ? bm.attribution : "";
  const label = [pref, mode, credit, style, tracks, range, state.ranges].join("|");
  if (label !== scopeLabel) {
    scopeLabel = label;
    document.querySelectorAll("#scope-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === pref));
    document.querySelectorAll("#style-seg button").forEach((b) => b.classList.toggle("on", b.dataset.style === style));
    $("btn-tracks").classList.toggle("on", tracks);
    $("btn-tracks").setAttribute("aria-pressed", String(tracks));
    $("range-seg").innerHTML = (state.ranges || []).map((r) => `<button data-range="${r}"${r === range ? ' class="on"' : ""}>${r}</button>`).join("") +
      `<span class="seg-unit">nm</span>`;
    $("scope").classList.toggle("atc", atc);
    $("scope").classList.toggle("sky", mode === "sky");     // the radar's options don't apply to the sky view
    $("scope-attrib").textContent = credit;
  }
  drawScope($("radar"), state, now, stateAtPerf, mode, { atc, tracks, range });
}

// Animate the scope at up to ~20 fps: plenty for gliding blips, light on a Raspberry Pi. On a phone
// the radar can be scrolled out of sight under the card, and then it rests.
let lastDraw = 0, scopeSeen = true;
new IntersectionObserver(([e]) => { scopeSeen = e.isIntersecting; }).observe($("scope"));
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !scopeSeen || now - lastDraw < 48) return;
  lastDraw = now;
  drawScopeNow(now);
}
requestAnimationFrame(frame);

// ---------- weather ----------
let wxData = null, wxAt = 0;
async function loadWeather(draw) {
  try {
    if (Date.now() - wxAt > 60000 || !wxData) { wxData = await (await fetch("api/weather")).json(); wxAt = Date.now(); }
    $("n-wx").textContent = (wxData && wxData.now && wxData.now.category) || "";
    if (draw && view === "wx" && state) renderWeatherTab($("wx-tab"), wxData, state);
  } catch (e) { /* keep what's shown */ }
}
let resizeTimer = null;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (view === "wx") loadWeather(true); }, 250); });
setInterval(() => { if (!document.hidden) loadWeather(view === "wx"); }, 60000);

// ---------- chrome ----------
function setView(v) {
  view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.toggle("active", e.id === "view-" + v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  if (v === "log") loadLog().catch(() => {});
  if (v === "wx") loadWeather(true);
  if (phone() === "stack") scrollTo(0, 0);        // each tab starts at its top
  render();
}
function renderToggles() {
  const on = soundOn();
  $("btn-sound").classList.toggle("on", on);
  $("snd-on").style.display = on ? "" : "none";
  $("snd-off").style.display = on ? "none" : "";
  $("snd-text").textContent = on ? "Sound on" : "Sound off";
  const n = store("night") || "auto";
  $("night-text").textContent = n === "auto" ? "Night auto" : n === "on" ? "Night on" : "Night off";
  $("btn-night").classList.toggle("on", sky.night);
}
function render() {
  if (!state) return;
  updateSky(state);
  renderToggles();
  paintTheme();
  const w = state.weather, f = state.flow;
  $("station").textContent = state.airport.icao || "";
  $("flow").hidden = !f;
  if (f) $("flow").innerHTML = `${esc(state.airport.iata)} landing ${esc(f.dir)}, runways ${esc(f.runways.replace(" / ", " and "))}`;
  $("wx").hidden = !w;
  if (w) $("wx").innerHTML = `${Math.round((w.temp_c * 9) / 5 + 32)}°F, wind ${w.wind_kt ?? 0} kt <b class="cat-${esc(w.category)}">${esc(w.category || "")}</b>`;
  $("link").hidden = state.status.ok || !state.status.source;
  const tfr = (state.tfrs || []).find((t) => t.active && !t.drones_only);
  $("tfr-chip").hidden = !tfr;
  if (tfr) $("tfr-chip").textContent = `Flight restriction ${tfr.dist_nm < 0.5 ? "overhead" : `${Math.round(tfr.dist_nm)} nm`}`;
  $("n-board").textContent = state.aircraft.filter((a) => !a.on_ground).length || "";
  const em = emergencies(), all = state.emergency || [];
  document.body.classList.toggle("emergency", em.length > 0);
  $("em-chip").hidden = !all.length;
  if (all.length) $("em-chip").textContent = `${all[0].emergency_code} ${all[0].emergency_title}${all.length > 1 ? ` +${all.length - 1}` : ""}`;
  const key = em.map(emKey).join(",");
  if (key !== emShown) {
    if (em.length && em.some((a) => !emShown.includes(emKey(a)))) { chime("alert"); if (view !== "now") setView("now"); }
    if (!em.length) { forgetHero(); forgetKiosk(); }
    emShown = key;
  }
  if (em.length) state.hero = em[0];            // the radar highlights it
  if (view === "now") {
    keepPlace(() => {
      if (em.length) renderEmergency($("hero"), state, em, !KIOSK);
      else (KIOSK ? renderKiosk : renderHero)($("hero"), state);
    });
    drawScopeNow(); if (!KIOSK) renderMiniBoard();
  }
  if (view === "board") $("board").innerHTML = boardHtml();
}
async function poll() {
  if (document.hidden) return;          // a hidden tab doesn't count as a screen being open
  try {
    // while the radar is on screen, the server fetches out to its range
    const range = state && view === "now" && scopeMode() === "radar" ? radarPrefs().range : 0;
    state = await (await fetch(`api/state?range=${range}`)).json();
    stateAt = state._at = Date.now();
    stateAtPerf = performance.now();
    if (mapFor !== state.airport.icao) { mapFor = state.airport.icao; loadMap(mapFor).then(() => { scopeLabel = ""; }); }
    const hero = state.hero && state.hero.hex;
    if (hero && hero !== lastHero) {
      chime(/RARE|MILITARY|EMERGENCY|HIJACK|RADIO/.test((state.hero.badges || []).join(" ")) ? "rare" : "arrival");
      // A new aircraft overhead takes the screen back, unless someone is using it.
      if (view !== "now" && Date.now() - lastTouch > 45000) setView("now");
    }
    lastHero = hero;
    render();
  } catch (e) { $("link").hidden = false; }
}
// A logo that doesn't exist (404) leaves the colour swatch showing in its place.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.classList.contains("logo") && !t.id) t.closest(".logo-tile").remove();
}, true);
document.addEventListener("click", (e) => { const b = e.target.closest(".mb-row"); if (b) pin(b.dataset.hex); });
const pin = (hex) => fetch("api/pin", { method: "POST", body: JSON.stringify({ hex }) }).then(poll);

document.addEventListener("pointerdown", () => { lastTouch = Date.now(); });
document.querySelector("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("board").addEventListener("click", (e) => { const r = e.target.closest("[data-hex]"); if (r) { pin(r.dataset.hex); setView("now"); } });
// a target past the tracking radius (on a longer-range radar) has no flight card to show
$("radar").addEventListener("click", (e) => {
  const g = e.target.closest("g[data-hex]");
  if (g && state && state.aircraft.some((a) => a.hex === g.dataset.hex)) {
    pin(g.dataset.hex);
    // on a phone the card is above the radar, out of sight: bring it up to show what was tapped
    if (phone() === "stack") $("hero").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
$("hero").addEventListener("click", (e) => {
  if (!state) return;
  if (e.target.closest("#em-hide")) { emergencies().forEach((a) => hidden.add(emKey(a))); render(); return; }
  if (emergencies().length) return;
  if (KIOSK) { if (!state.hero) { kioskNext(); render(); } return; }
  if (state.pinned) pin(null); else if (!state.hero) { nextSlide(); render(); }
});
$("scope-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store("scope", b.dataset.mode); scopeLabel = ""; } });
// a button wins over the same setting given in the address
$("style-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { qs.delete("radar"); store("radarStyle", b.dataset.style); scopeLabel = ""; } });
$("btn-tracks").addEventListener("click", () => { const on = radarPrefs().tracks; qs.delete("tracks"); store("tracks", on ? "off" : "on"); scopeLabel = ""; });
$("range-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { qs.delete("range"); store("range", b.dataset.range); scopeLabel = ""; poll(); } });
$("btn-sound").addEventListener("click", () => { setSound(!soundOn()); renderToggles(); });
$("btn-night").addEventListener("click", () => { const m = ["auto", "on", "off"]; store("night", m[(m.indexOf(store("night") || "auto") + 1) % 3]); render(); });

setInterval(poll, 2000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
setInterval(() => {
  if (!state || view !== "now") return;
  if (emergencies().length) { renderEmergency($("hero"), state, emergencies(), !KIOSK); return; }
  const elapsed = (Date.now() - stateAt) / 1000;
  if (KIOSK) tickKiosk(elapsed, state.hero ? null : state);
  else if (state.hero) tickHero(elapsed); else keepPlace(() => renderHero($("hero"), state));
}, 1000);
setInterval(() => { if (view === "log") loadLog().catch(() => {}); }, 30000);
// Local time, with coordinated universal time beside it as aviation writes it ("0324Z").
setInterval(() => {
  const d = new Date(), z = String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z";
  $("clock").innerHTML = `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>${z}</small>`;
}, 1000);
applyPhone();
poll().then(() => loadWeather(false));
$("em-chip").addEventListener("click", () => { hidden.clear(); emShown = ""; setView("now"); render(); });
$("tfr-chip").addEventListener("click", () => setView("wx"));
