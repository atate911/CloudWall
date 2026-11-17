"use strict";
import { $, esc, num, mmss, ident, altText, store } from "./util.js";
import { updateSky, sky } from "./sky.js";
import { drawScope, loadMap } from "./scope.js";
import { renderHero, tickHero, nextSlide, badges, recordsHtml } from "./hero.js";
import { chime, soundOn, setSound } from "./fx.js";

let state = null, stateAt = 0, lastTouch = 0, lastHero = null, view = "now", mapFor = null;

// ---------- board ----------
function boardHtml() {
  const rows = state.aircraft.filter((a) => !a.on_ground).map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0;
    return `<tr data-hex="${esc(a.hex)}" class="${state.hero && a.hex === state.hero.hex ? "hero" : ""}">
      <td class="fl">${esc(ident(a))}</td>
      <td>${r ? `${esc(r.origin.iata)} → ${esc(r.dest.iata)}` : '<span class="dim">—</span>'}</td>
      <td>${esc(a.type || "")}</td>
      <td class="num">${altText(a)} ${v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : "&nbsp;"}</td>
      <td class="num">${num(a.gs)}</td>
      <td class="num">${a.dist.toFixed(1)} ${a.compass}</td>
      <td class="num">${a.cpa_s > 0 && a.cpa_nm <= state.tracking.overhead_nm ? mmss(a.cpa_s) : '<span class="dim">—</span>'}</td></tr>`;
  });
  return `<table><thead><tr><th>Flight</th><th>Route</th><th>Type</th><th class="num">Alt ft</th><th class="num">Kt</th><th class="num">From home</th><th class="num">Overhead in</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="7" class="dim">No airborne traffic in range.</td></tr>'}</tbody></table>`;
}

// ---------- logbook ----------
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
    <div class="cols"><div>${recordsHtml("Records today", L.records_today)}</div><div>${recordsHtml("Records all time", L.records_all)}</div></div>
    ${fa && fa.enabled ? `<div class="dim" style="margin-top:.9rem">${esc(fa.label)} lookups today: ${fa.used_today} of ${fa.daily_limit}${fa.problem ? ` — paused: ${esc(fa.problem)}` : fa.used_today >= fa.daily_limit ? " — limit reached, using free routes until midnight" : ""}</div>` : ""}
    <h2 style="margin-top:.9rem">Recent flyovers</h2>
    ${L.recent.map((s) => `<div class="rec"><span><b>${esc(s.flight || s.callsign || s.reg || s.hex)}</b> <span class="dim">${esc(s.type || "")} ${s.origin ? esc(s.origin) + " → " + esc(s.dest) : ""}</span> ${badges(s.badges)}</span>
      <span class="dim">${new Date(s.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${num(s.alt_ft)} ft · ${s.min_dist_nm.toFixed(1)} nm</span></div>`).join("")}`;
}

// ---------- scope: sky dome while something is overhead, radar otherwise ----------
const SCOPE_MODES = ["auto", "sky", "radar"];
function scopeMode() {
  const pref = store("scope") || "auto";
  return pref === "auto" ? (state && state.hero ? "sky" : "radar") : pref;
}
function drawScopeNow() {
  if (!state || view !== "now") return;
  const mode = scopeMode(), pref = store("scope") || "auto";
  $("scope-mode").textContent = pref === "auto" ? `Auto · ${mode === "sky" ? "sky view" : "radar"}` : mode === "sky" ? "Sky view" : "Radar";
  $("scope-caption").textContent = mode === "sky" ? "Centre is straight up · rim is the horizon" : `${state.tracking.radius_nm} nm around home`;
  $("scope").dataset.mode = mode;
  drawScope($("radar"), state, (Date.now() - stateAt) / 1000, mode);
}

// ---------- chrome ----------
function setView(v) {
  view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.toggle("active", e.id === "view-" + v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  if (v === "log") loadLog().catch(() => {});
  render();
}
function renderToggles() {
  $("btn-sound").textContent = soundOn() ? "Sound on" : "Sound off";
  $("btn-sound").classList.toggle("on", soundOn());
  const n = store("night") || "auto";
  $("btn-night").textContent = "Night " + n;
  $("btn-night").classList.toggle("on", sky.night);
}
function render() {
  if (!state) return;
  updateSky(state);
  renderToggles();
  const w = state.weather, f = state.flow;
  $("flow").hidden = !f;
  if (f) $("flow").innerHTML = `${esc(state.airport.iata)} <b>${esc(f.label)}</b> ${esc(f.runways)}`;
  $("wx").hidden = !w;
  if (w) $("wx").innerHTML = `<b class="cat-${esc(w.category)}">${esc(w.category || "WX")}</b> ${w.wind_kt ?? 0} kt · ${Math.round((w.temp_c * 9) / 5 + 32)}°F`;
  $("link").hidden = state.status.ok || !state.status.source;
  $("n-board").textContent = state.aircraft.filter((a) => !a.on_ground).length || "";
  if (view === "now") { renderHero($("hero"), state); drawScopeNow(); }
  if (view === "board") $("board").innerHTML = boardHtml();
}
async function poll() {
  try {
    state = await (await fetch("api/state")).json();
    stateAt = Date.now();
    if (mapFor !== state.airport.icao) { mapFor = state.airport.icao; loadMap(mapFor).then(drawScopeNow); }
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
const pin = (hex) => fetch("api/pin", { method: "POST", body: JSON.stringify({ hex }) }).then(poll);

document.addEventListener("pointerdown", () => { lastTouch = Date.now(); });
document.querySelector("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("board").addEventListener("click", (e) => { const r = e.target.closest("tr[data-hex]"); if (r) { pin(r.dataset.hex); setView("now"); } });
$("radar").addEventListener("click", (e) => { const g = e.target.closest("g[data-hex]"); if (g) pin(g.dataset.hex); });
$("hero").addEventListener("click", () => { if (!state) return; if (state.pinned) pin(null); else if (!state.hero) { nextSlide(); render(); } });
$("scope-mode").addEventListener("click", () => { store("scope", SCOPE_MODES[(SCOPE_MODES.indexOf(store("scope") || "auto") + 1) % 3]); drawScopeNow(); });
$("btn-sound").addEventListener("click", () => { setSound(!soundOn()); renderToggles(); });
$("btn-night").addEventListener("click", () => { const m = ["auto", "on", "off"]; store("night", m[(m.indexOf(store("night") || "auto") + 1) % 3]); render(); });

setInterval(poll, 2000);
setInterval(() => { drawScopeNow(); if (state && state.hero) tickHero((Date.now() - stateAt) / 1000); else if (state && view === "now") renderHero($("hero"), state); }, 1000);
setInterval(() => { if (view === "log") loadLog().catch(() => {}); }, 30000);
setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 1000);
poll();
