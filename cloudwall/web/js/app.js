"use strict";
import { $, esc, store, phone, api, runwayList, degF } from "./util.js";
import { updateSky, sky } from "./sky.js";
import { drawScope, mapReach } from "./scope.js";
import { loadMap } from "./map.js";
import { renderHero, tickHero, nextSlide, forgetHero } from "./hero.js";
import { renderEmergency } from "./emergency.js";
import { chime, soundOn, setSound } from "./fx.js";
import { renderWeatherTab } from "./weather.js";
import { renderKiosk, tickKiosk, kioskNext, forgetKiosk } from "./kiosk.js";
import { nearbyDivider } from "./divider.js";
import { boardHtml, renderMiniBoard } from "./board.js";
import { loadLog } from "./logbook.js";
import { renderPlace, placeMenu } from "./places.js";
import { refresh } from "./fresh.js";
import { stripHtml, sideHtml, notesHtml, renderInto, tickCounts, picture, notables } from "./situation.js";

// Kiosk mode (/kiosk, or ?mode=kiosk): the across-the-room display. Otherwise the desktop view.
const KIOSK = /\/kiosk\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("mode") === "kiosk";
document.documentElement.classList.add(KIOSK ? "kiosk" : "desk");
document.body.classList.add(KIOSK ? "kiosk" : "desk");

let state = null, stateAt = 0, stateAtPerf = 0, lastTouch = 0, lastOverhead = null, view = "now", mapFor = null;

// The flight this screen follows, picked by a tap on the board or the radar. It's this screen's alone:
// a phone following one flight leaves the wall panel showing what's overhead. Kept through a reload of
// the tab; released by tapping the card, or when the flight leaves the area. The wall panel, which
// nobody stays beside, lets go by itself after a minute and a half untouched.
const KIOSK_PIN_S = 90;
let myPin = null;
try { myPin = sessionStorage.getItem("cloudwall.pin"); } catch (e) { /* no storage: just this visit */ }
function pin(hex) {
  myPin = hex || null;
  try { if (myPin) sessionStorage.setItem("cloudwall.pin", myPin); else sessionStorage.removeItem("cloudwall.pin"); } catch (e) { /* as above */ }
  return poll();
}

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

if (!KIOSK) nearbyDivider(() => { if (state && view === "now") renderMiniBoard(state); });
placeMenu(() => state);

// ---------- scope: the radar, or the Map view (the flights on a plain satellite or street map) ----------
// The desktop's buttons choose for each screen; the kiosk takes [kiosk] view. An emergency always
// shows on the radar, where the controllers' codes and the restrictions are.
function scopePref() {
  const v = KIOSK ? state && state.kiosk && state.kiosk.view : store("scope");
  return v === "map" ? "map" : "radar";
}
const scopeMode = () => (emergencies().length ? "radar" : scopePref());
// the Map view's map: satellite imagery with roads and names over it, or a street map
const mapStyle = () => (store("mapStyle") === "streets" ? "streets" : "sat");
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
// How much a screen draws: "simple" (what's happening now: the next aircraft over the house, the
// landing queue, what's worth a look) or "detailed" (every aircraft labelled and grouped, the flight
// card, the side view). The desktop starts detailed, a phone and the wall panel simple; the switch
// sets it for each screen, a phone apart from a desktop. The kiosk takes [kiosk] density.
const densKey = () => (phone() ? "densityPhone" : "density");
function density() {
  const ok = (v) => v === "simple" || v === "detailed", k = (KIOSK && state && state.kiosk) || {};
  return [qs.get("density"), KIOSK ? k.density : store(densKey())].find(ok) || (KIOSK || phone() ? "simple" : "detailed");
}
const simple = () => density() === "simple";
// Simple shows the flight card's quiet-sky slides (the weather, the day so far) when there is nothing
// to say about the traffic: nothing overhead or on its way, nothing landing.
const quietSky = () => !!state && !state.hero && !state.next && !picture(state).groups.arr.length && !notables(state).some((n) => n.a);
const cardShown = () => !simple() || quietSky();
let scopeLabel = "";
function drawScopeNow(now = performance.now()) {
  if (!state || view !== "now") return;
  const mode = scopeMode(), pref = scopePref(), ms = mapStyle(), { style, tracks, range } = radarPrefs();
  const atc = mode === "radar" && style === "atc";
  const charts = state.charts || { map: state.basemap }, layers = charts.layers || {};
  const bm = mode === "map" ? layers[ms] : atc ? charts.atc : charts.map;
  const credit = bm && bm.enabled ? bm.attribution : "";
  const dens = density();
  const label = [pref, mode, ms, credit, style, tracks, range, state.ranges, dens].join("|");
  if (label !== scopeLabel) {
    scopeLabel = label;
    document.querySelectorAll("#scope-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === pref));
    document.querySelectorAll("#style-seg button").forEach((b) => b.classList.toggle("on", b.dataset.style === style));
    document.querySelectorAll("#mapstyle-seg button").forEach((b) => b.classList.toggle("on", b.dataset.map === ms));
    $("btn-tracks").classList.toggle("on", tracks);
    $("btn-tracks").setAttribute("aria-pressed", String(tracks));
    $("range-seg").innerHTML = (state.ranges || []).map((r) => `<button data-range="${r}"${r === range ? ' class="on"' : ""}>${r}</button>`).join("") +
      `<span class="seg-unit">nm</span>`;
    $("scope").classList.toggle("atc", atc);
    $("scope").classList.toggle("map", mode === "map");     // the radar's own options give way to the map's
    $("scope-attrib").textContent = credit;
  }
  drawScope($("radar"), state, now, stateAtPerf, mode, { atc, tracks, range, mapStyle: ms, simple: dens === "simple" });
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
async function loadWeather(draw) {
  const wx = await refresh("api/weather");                 // at most once a minute, shared with the weather slides
  $("n-wx").textContent = (wx && wx.now && wx.now.category) || "";
  if (draw && view === "wx" && state) renderWeatherTab($("wx-tab"), wx, state);
}
let resizeTimer = null;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (view === "wx") loadWeather(true); }, 250); });
setInterval(() => { if (!document.hidden) loadWeather(view === "wx"); }, 60000);

// ---------- chrome ----------
function setView(v) {
  view = v;
  document.querySelectorAll(".view").forEach((e) => e.classList.toggle("active", e.id === "view-" + v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  if (v === "log") loadLog(state).catch(() => {});
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
// The traffic picture around the radar: the strip across the top, and in Simple the side panel
// (the next aircraft over the house, the landing queue, what's worth a look) in place of the card.
// A phone splits the side around the radar and keeps the full list behind a button.
let allOpen = false;
function renderPicture(dens) {
  const easy = dens === "simple", ph = phone();
  if (!KIOSK) renderInto($("strip"), stripHtml(state, { text: !(ph && easy) }) + (ph ? densSeg(dens) : ""));
  if (easy && KIOSK) { renderInto($("side"), `<section class="k-sit">${stripHtml(state, { text: false })}</section>` + sideHtml(state, { queue: 3, notes: 2 })); fitSide($("side")); }
  else if (easy && ph === "side") renderInto($("side"), sideHtml(state, { compact: true }));      // sideways: all in one column beside the radar
  else if (easy && ph) { renderInto($("side"), sideHtml(state, { compact: true, notes: 0 })); renderInto($("notes"), notesHtml(state)); }
  else if (easy) renderInto($("side"), sideHtml(state));
  const n = picture(state).air.length;
  $("show-all").innerHTML = `${allOpen ? "Hide the list" : `Show all ${n} aircraft, grouped`}<span aria-hidden="true">${allOpen ? "⌃" : "⌄"}</span>`;
  $("show-all").setAttribute("aria-expanded", String(allOpen));
  $("view-now").classList.toggle("all-open", allOpen);
}
// The wall panel's side column has a fixed height: what's worth a look gives way, a whole row at a
// time, when the rest leaves no room for it.
function fitSide(el) {
  let rows;
  while (el.scrollHeight > el.clientHeight + 1 && (rows = el.querySelectorAll(".ss-note .n-row")).length) rows[rows.length - 1].remove();
  const note = el.querySelector(".ss-note");
  if (note && !note.querySelector(".n-row")) note.remove();
}
const densSeg = (dens) => `<div class="seg dens mini" role="group" aria-label="How much to show">${["simple", "detailed"].map((d) =>
  `<button data-dens="${d}" class="${d === dens ? "on" : ""}" aria-pressed="${d === dens}">${d === "simple" ? "Simple" : "Detailed"}</button>`).join("")}</div>`;
function render() {
  if (!state) return;
  updateSky(state);
  renderToggles();
  const dens = density();
  document.body.classList.toggle("d-simple", dens === "simple");
  document.body.classList.toggle("d-detailed", dens !== "simple");
  document.body.classList.toggle("sky-quiet", quietSky());
  document.querySelectorAll("#dens-seg button").forEach((b) => { b.classList.toggle("on", b.dataset.dens === dens); b.setAttribute("aria-pressed", String(b.dataset.dens === dens)); });
  paintTheme();
  const w = state.weather, f = state.flow;
  renderPlace(state, KIOSK);
  $("flow").hidden = !f;
  if (f) $("flow").innerHTML = `${esc(state.airport.iata)} landing ${esc(f.dir)}, runways ${esc(runwayList(f.runways))}`;
  $("wx").hidden = !w;
  if (w) $("wx").innerHTML = `${w.temp_c == null ? "" : `${degF(w.temp_c)}, `}wind ${w.wind_kt ?? 0} kt <b class="cat-${esc(w.category)}">${esc(w.category || "")}</b>`;
  $("link").hidden = state.status.ok || !state.status.source;
  $("restart").hidden = !state.restart;
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
      else if (cardShown()) (KIOSK ? renderKiosk : renderHero)($("hero"), state);
      renderPicture(dens);
    });
    drawScopeNow(); if (!KIOSK) renderMiniBoard(state);
  }
  if (view === "board") $("board").innerHTML = boardHtml(state);
}
// When CloudWall itself stops answering (the server is down, the network gone), the last positions
// are shown for a minute, as the server does with a silent feed, and then cleared: a flight card
// and radar that can't be trusted are worse than an empty sky marked offline.
const STALE_S = 60;
let lastAnswer = Date.now();
function dropStale() {
  if (!state || document.hidden || Date.now() - lastAnswer < STALE_S * 1000) return;
  if (!state.status.ok && !state.aircraft.length && !state.hero) return;      // already cleared
  state = { ...state, aircraft: [], beyond: [], hero: null, next: null, pinned: null, overhead: null, emergency: [],
    status: { ...state.status, ok: false, source: state.status.source || "CloudWall" } };
  render();
}

let pollSeq = 0, shownSeq = 0;
async function poll() {
  if (document.hidden) return;          // a hidden tab doesn't count as a screen being open
  const seq = ++pollSeq, asked = myPin;
  try {
    // while the radar or the map is on screen, the server fetches out to its range, and the
    // flight this screen follows, if any
    // (the ATC style's square and the Map view's rectangle reach further, into their corners)
    const shown = state && view === "now" ? scopeMode() : null, prefs = radarPrefs();
    const far = shown === "radar" && prefs.style === "atc" ? "&square=1" : shown === "map" ? `&reach=${mapReach().toFixed(2)}` : "";
    const s = await (await api(`api/state?range=${shown ? prefs.range : 0}${far}` +
      (asked ? `&pin=${encodeURIComponent(asked)}` : ""))).json();
    // answers can cross: keep the newest, and drop one asked for a flight no longer followed
    if (seq < shownSeq || asked !== myPin) return;
    shownSeq = seq;
    state = s;
    lastAnswer = Date.now();
    // Positions are as old as the server's last update from the feed, not as new as this answer
    // (the feed is read every 5 s, this is asked every 2). Time is counted from when they were
    // reported, so aircraft glide on from where they are instead of stepping back each time the
    // same update is fetched again, and the countdowns don't jump.
    const age = state.status && state.status.updated ? Math.min(STALE_S, Math.max(0, state.now - state.status.updated)) * 1000 : 0;
    stateAt = state._at = Date.now() - age;
    stateAtPerf = performance.now() - age;
    if (asked && state.pinned !== asked) pin(null);   // it left the area: back to what's overhead
    if (mapFor !== state.airport.icao) { mapFor = state.airport.icao; loadMap(mapFor).then(() => { scopeLabel = ""; }); }
    // the chime is for an aircraft coming overhead, whichever flight this screen follows, and not for a tap
    const over = state.overhead;
    if (over && over !== lastOverhead) {
      const a = state.aircraft.find((x) => x.hex === over);
      chime(/RARE|MILITARY|EMERGENCY|HIJACK|RADIO/.test(((a && a.badges) || []).join(" ")) ? "rare" : "arrival");
      // A new aircraft overhead takes the screen back, unless someone is using it.
      if (view !== "now" && Date.now() - lastTouch > 45000) setView("now");
    }
    lastOverhead = over;
    render();
  } catch (e) { if (seq >= shownSeq) $("link").hidden = false; }
}
// A logo that doesn't exist (404) leaves the colour swatch showing in its place.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.classList.contains("logo") && !t.id) t.closest(".logo-tile").remove();
}, true);
// a flight in a list, the landing queue or "worth a look": follow it on this screen
document.addEventListener("click", (e) => {
  const b = e.target.closest(".mb-row, .tr[data-hex], .q-row[data-hex], .n-row[data-hex]");
  if (b && !b.closest("#board")) { pin(b.dataset.hex); return; }
  const d = e.target.closest("button[data-dens]");
  if (d) {      // Simple or Detailed, for this screen; a button wins over the address
    qs.delete("density"); store(densKey(), d.dataset.dens);
    forgetHero(); forgetKiosk(); scopeLabel = ""; allOpen = false;
    render();
  }
});
// the next aircraft over the house, in Simple: a tap on the one this screen follows lets it go
$("side").addEventListener("click", (e) => { if (state && state.pinned && e.target.closest("[data-let]")) pin(null); });
$("show-all").addEventListener("click", () => { allOpen = !allOpen; render(); });

document.addEventListener("pointerdown", () => { lastTouch = Date.now(); });
document.querySelector("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("board").addEventListener("click", (e) => { const r = e.target.closest("[data-hex]"); if (r) { pin(r.dataset.hex); setView("now"); } });
// a target past the tracking radius (on a longer-range radar) has no flight card to show
$("radar").addEventListener("click", (e) => {
  const g = e.target.closest("g[data-hex]");
  if (g && state && state.aircraft.some((a) => a.hex === g.dataset.hex)) {
    pin(g.dataset.hex);
    // on a phone the card is above the radar, out of sight: bring it up to show what was tapped
    if (phone() === "stack") $(simple() ? "side" : "hero").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
$("hero").addEventListener("click", (e) => {
  if (!state) return;
  if (e.target.closest("#em-hide")) { emergencies().forEach((a) => hidden.add(emKey(a))); render(); return; }
  if (emergencies().length) return;
  if (KIOSK) { if (myPin) pin(null); else if (!state.hero) { kioskNext(); render(); } return; }
  if (state.pinned) pin(null); else if (!state.hero) { nextSlide(); render(); }
});
$("scope-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store("scope", b.dataset.mode); scopeLabel = ""; } });
// a button wins over the same setting given in the address
$("mapstyle-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store("mapStyle", b.dataset.map); scopeLabel = ""; } });
$("style-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { qs.delete("radar"); store("radarStyle", b.dataset.style); scopeLabel = ""; } });
$("btn-tracks").addEventListener("click", () => { const on = radarPrefs().tracks; qs.delete("tracks"); store("tracks", on ? "off" : "on"); scopeLabel = ""; });
$("range-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { qs.delete("range"); store("range", b.dataset.range); scopeLabel = ""; poll(); } });
$("btn-sound").addEventListener("click", () => { setSound(!soundOn()); renderToggles(); });
$("btn-night").addEventListener("click", () => { const m = ["auto", "on", "off"]; store("night", m[(m.indexOf(store("night") || "auto") + 1) % 3]); render(); });

setInterval(poll, 2000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastAnswer = Date.now(); poll(); } });
setInterval(() => {
  if (KIOSK && myPin && Date.now() - lastTouch > KIOSK_PIN_S * 1000) pin(null);
  dropStale();
  if (!state || view !== "now") return;
  tickCounts($("view-now"), state);
  if (emergencies().length) { renderEmergency($("hero"), state, emergencies(), !KIOSK); return; }
  if (!cardShown()) return;
  const elapsed = (Date.now() - stateAt) / 1000;
  if (KIOSK) tickKiosk(elapsed, state.hero ? null : state);
  else if (state.hero) tickHero(elapsed); else keepPlace(() => renderHero($("hero"), state));
}, 1000);
setInterval(() => { if (state && view === "board" && !document.hidden) tickCounts($("board"), state); }, 1000);
setInterval(() => { if (view === "log") loadLog(state).catch(() => {}); }, 30000);
// Local time, with coordinated universal time beside it as aviation writes it ("0324Z").
setInterval(() => {
  const d = new Date(), z = String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z";
  $("clock").innerHTML = `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>${z}</small>`;
}, 1000);
applyPhone();
poll().then(() => loadWeather(false));
$("em-chip").addEventListener("click", () => { hidden.clear(); emShown = ""; setView("now"); render(); });
$("tfr-chip").addEventListener("click", () => setView("wx"));
