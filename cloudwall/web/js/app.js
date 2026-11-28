"use strict";
import { $, esc, store, phone, api, runwayList, degF, since, dataAge, COUNT_STOP_S, logoFailed } from "./util.js";
import { updateSky } from "./sky.js";
import { drawScope, mapReach, flashCraft } from "./scope.js";
import { compass, startCompass, stopCompass, facing } from "./compass.js";
import { loadMap } from "./map.js";
import { renderHero, tickHero, nextSlide, forgetHero, heroResized, setPicture, setMedia } from "./hero.js";
import { renderEmergency } from "./emergency.js";
import { chime, soundOn, setSound } from "./fx.js";
import { renderWeatherTab } from "./weather.js";
import { renderKiosk, tickKiosk, kioskNext, forgetKiosk, kioskCaption } from "./kiosk.js";
import { paneDividers } from "./divider.js";
import { boardHtml, renderMiniBoard } from "./board.js";
import { loadLog } from "./logbook.js";
import { openAbout, aboutContext } from "./about.js";
import { renderPlace, placeMenu } from "./places.js";
import { refresh, latest } from "./fresh.js";
import { stripHtml, sideHtml, notesHtml, renderInto, tickCounts, picture, notables, keepFocus } from "./situation.js";
import { lineHtml, axisHtml, tickTimeline } from "./timeline.js";

// Kiosk mode (/kiosk, or ?mode=kiosk): the across-the-room display. Otherwise the desktop view.
const KIOSK = /\/kiosk\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("mode") === "kiosk";
document.documentElement.classList.add(KIOSK ? "kiosk" : "desk");
document.body.classList.add(KIOSK ? "kiosk" : "desk");

let state = null, stateAt = 0, stateAtPerf = 0, lastTouch = 0, lastOverhead = null, view = "now", mapFor = null;

// The flight this screen follows (this screen's alone, kept through a reload). The wall panel,
// which nobody stays beside, lets go by itself after KIOSK_PIN_S untouched.
const KIOSK_PIN_S = 90;
// a desktop wide for its height: Simple puts what's worth a look in a third column
const WIDE = matchMedia("(min-width: 1500px) and (min-aspect-ratio: 19/10)");
let myPin = null;
try { myPin = sessionStorage.getItem("cloudwall.pin"); } catch (e) { /* no storage: just this visit */ }
function pin(hex) {
  myPin = hex || null;
  try { if (myPin) sessionStorage.setItem("cloudwall.pin", myPin); else sessionStorage.removeItem("cloudwall.pin"); } catch (e) { /* as above */ }
  return poll();
}

// Phone layout, taken on by any screen that small. ?mode=phone forces it; ?mode=desktop keeps it off.
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

// Upright on a phone the radar sits under the card, so a card that changes height would move the
// radar. Browsers without scroll anchoring (Safari): when the card is mostly scrolled past, scroll by what it grew.
const anchors = CSS.supports("overflow-anchor", "auto");
function keepPlace(draw) {
  if (anchors || phone() !== "stack") return draw();
  const hero = $("hero"), h0 = hero.offsetHeight, above = hero.getBoundingClientRect().bottom < innerHeight / 2;
  draw();
  const d = hero.offsetHeight - h0;
  if (d && above) scrollBy(0, d);
}

// The browser's own bars take the chart's paper colour.
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

if (!KIOSK) paneDividers(() => { if (state && view === "now") renderMiniBoard(state); });
placeMenu(() => state);

// ---------- scope: the radar, the Map view or the Sky view ----------
// The desktop's buttons choose; the kiosk takes [kiosk] view (or ?view=), where "card" leaves the
// scope off. An emergency always shows on the radar.
const kioskView = () => { const v = qs.get("view") || (state && state.kiosk && state.kiosk.view); return ["radar", "map", "sky"].includes(v) ? v : "card"; };
const cardOnly = () => KIOSK && kioskView() === "card";
function scopePref() {
  const v = KIOSK ? kioskView() : store("scope");
  return v === "map" || v === "sky" ? v : "radar";
}
const scopeMode = () => (emergencies().length ? "radar" : scopePref());
const mapStyle = () => (store("mapStyle") === "streets" ? "streets" : "sat");
// Radar options: the desktop's buttons set them; the kiosk takes them from the [kiosk] settings.
// The address overrides either (?radar=atc&tracks=off&range=30).
const qs = new URLSearchParams(location.search);
function radarPrefs() {
  const k = (KIOSK && state && state.kiosk) || {}, ranges = (state && state.ranges) || [15, 20, 30];
  const pick = (name, saved, ok) => [qs.get(name), saved].find(ok);
  const style = pick("radar", KIOSK ? k.radar : store("radarStyle"), (v) => v === "chart" || v === "atc") || "chart";
  const tracks = pick("tracks", KIOSK ? (k.tracks === false ? "off" : "on") : store("tracks"), (v) => v === "on" || v === "off") !== "off";
  const range = +(pick("range", KIOSK ? k.range_nm : store("range"), (v) => v != null && ranges.includes(+v)) || ranges[0]);
  return { style, tracks, range };
}
// "simple" or "detailed". The desktop starts detailed, a phone and the wall panel simple; stored
// per screen, a phone apart from a desktop. The kiosk takes [kiosk] density.
const densKey = () => (phone() ? "densityPhone" : "density");
function density() {
  const ok = (v) => v === "simple" || v === "detailed", k = (KIOSK && state && state.kiosk) || {};
  return [qs.get("density"), KIOSK ? k.density : store(densKey())].find(ok) || (KIOSK || phone() ? "simple" : "detailed");
}
const simple = () => density() === "simple";
// Simple shows the flight card's quiet-sky slides when there is nothing to say about the traffic.
const quietSky = () => !!state && !state.hero && !state.next && !picture(state).groups.arr.length && !notables(state).some((n) => n.a);
const cardShown = () => KIOSK || !simple() || quietSky();     // the wall panel always shows its card
let scopeLabel = "";
function drawScopeNow(now = performance.now()) {
  // the card alone draws no radar, except while the radar is the quiet sky's slide
  if (!state || view !== "now" || (cardOnly() && !document.body.classList.contains("radar-slide"))) return;
  const mode = scopeMode(), pref = scopePref(), ms = mapStyle(), { style, tracks, range } = radarPrefs();
  const atc = mode === "radar" && style === "atc";
  const charts = state.charts || { map: state.basemap }, layers = charts.layers || {};
  const bm = mode === "sky" ? null : mode === "map" ? layers[ms] : atc ? charts.atc : charts.map;      // the sky has no map
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
    $("scope").classList.toggle("sky", mode === "sky");     // the sky view has none: it is always the sky overhead
    $("scope-attrib").textContent = credit;
  }
  const heading = mode === "sky" && phone() ? facing() : null;
  drawScope($("radar"), state, now, stateAtPerf, mode, { atc, tracks, range, mapStyle: ms, simple: dens === "simple", wall: KIOSK, heading });
  compassStatus(mode);
}

function compassStatus(mode) {
  const btn = $("btn-compass"), on = compass.on && mode === "sky";
  if (btn.getAttribute("aria-pressed") !== String(on)) btn.setAttribute("aria-pressed", String(on));
  const waiting = on && facing() == null && Date.now() - compass.at > 2500;
  const text = compass.failed || (waiting ? "No reading from the compass yet: move the phone in a figure of eight" : "");
  if ($("compass-note").textContent !== text) $("compass-note").textContent = text;
}
$("btn-compass").addEventListener("click", async () => {
  if (compass.on) { stopCompass(); compass.failed = ""; store("skyCompass", "off"); return; }
  if (await startCompass()) store("skyCompass", "on");
  else setTimeout(() => { compass.failed = ""; }, 6000);      // say why, for a moment
});
// left on last time: back on by itself where the browser allows it without a tap (Android); iOS
// needs a tap. Called after applyPhone() at the end, once the page knows whether it is on a phone.
const resumeCompass = () => { if (phone() && store("skyCompass") === "on") startCompass().then((ok) => { if (!ok) compass.failed = ""; }); };

// The scope is drawn at ~20 fps for two seconds after anything changes (a new report easing in, a
// touch, the phone turning the sky) and at 5 fps otherwise: a blip gliding between reports moves
// under 2 px a second, and every draw has the whole radar rastered again (half a core, measured).
// It rests while scrolled out of sight.
let lastDraw = 0, scopeSeen = true, livelyUntil = 0;
const lively = () => { livelyUntil = performance.now() + 2000; };
new IntersectionObserver((es) => { scopeSeen = es[es.length - 1].isIntersecting; }).observe($("scope"));
for (const what of ["pointerdown", "pointermove", "wheel"]) $("scope").addEventListener(what, lively, { passive: true });
function frame(now) {
  requestAnimationFrame(frame);
  const turning = compass.on && scopeMode() === "sky";
  if (document.hidden || !scopeSeen || now - lastDraw < (turning || now < livelyUntil ? 48 : 200)) return;
  lastDraw = now;
  drawScopeNow(now);
}
requestAnimationFrame(frame);

// ---------- weather ----------
async function loadWeather(draw, now = false) {
  const wx = await refresh("api/weather", now ? 0 : undefined);     // at most once a minute, shared with the weather slides
  if (draw && view === "wx" && state) renderWeatherTab($("wx-tab"), wx, state);
}
// The header's weather comes with each answer, the tab's and slides' is fetched apart: a new
// report in the one fetches the other again at once, so they agree.
let wxSeen = null;
function followWeather(w) {
  const raw = (w && w.raw) || null;
  if (raw === wxSeen) return;
  wxSeen = raw;                               // (asked once for each new report, whatever comes back)
  const have = latest("api/weather");
  if (raw && raw !== (have && have.now && have.now.raw)) loadWeather(view === "wx", true);
}
let resizeTimer = null;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (view === "wx") loadWeather(true); }, 250); });
// The Overhead view's panels changed size: what is drawn to their size is drawn again once it
// settles. Desktop only: on a phone the panels take their contents' height, and redrawing would change it.
const panelSizes = new Map();
let panelTimer = null, cardMoved = false;
const panelsResized = new ResizeObserver((entries) => {
  if (KIOSK || phone()) return;
  let moved = false;
  for (const e of entries) {
    const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height), was = panelSizes.get(e.target);
    panelSizes.set(e.target, [w, h]);
    if (was && (was[0] !== w || was[1] !== h)) { moved = true; if (e.target.id === "hero" || e.target.id === "side") cardMoved = true; }
  }
  if (!moved) return;
  clearTimeout(panelTimer);
  panelTimer = setTimeout(() => {
    if (!state || view !== "now") return;
    if (cardMoved) heroResized();
    cardMoved = false;
    scopeLabel = "";                                 // the radar's labels placed afresh for its new size
    render();
  }, 150);
});
["hero", "side", "scope", "mini-board"].forEach((id) => panelsResized.observe($(id)));
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
// /api/health: a major problem is a banner on every screen; a subtle one (what's shown looks right
// but isn't: a frozen feed, a deaf receiver) is a chip.
function showHealth(h) {
  const t = $("trouble"), off = $("looks-off");
  t.hidden = !h.major;
  document.body.classList.toggle("in-trouble", !!h.major);
  if (h.major) t.innerHTML = `<b>CloudWall has a problem: ${esc(h.major_title || "see the server")}.</b> <span>${esc(h.major)}</span> <small>On the server, \`cloudwall doctor\` says what to do.</small>`;
  off.hidden = !h.subtle || !!h.major;
  if (h.subtle) {
    off.textContent = `Check: ${h.subtle}`;
    off.title = "What the screens show looks right but may not be. On the server, `cloudwall doctor` says why and what to do.";
  }
}

function renderToggles() {
  const on = soundOn(), night = store("night") || "auto";
  for (const b of $("settings-menu").querySelectorAll("button")) {
    const set = b.dataset.sound ? (b.dataset.sound === "on") === on : b.dataset.night === night;
    b.classList.toggle("on", set);
    b.setAttribute("aria-pressed", String(set));
  }
}
function showSettings(open) {
  $("settings-menu").hidden = !open;
  $("btn-settings").setAttribute("aria-expanded", String(open));
}
// The strip across the top, and in Simple the side panel in place of the card. A phone splits the
// side around the radar and keeps the full list behind a button.
let allOpen = false;
function renderPicture(dens) {
  const easy = dens === "simple", ph = phone();
  if (KIOSK) {
    // the wall panel: what's next after the aircraft on its card, and the caption over the radar
    renderInto($("next-line"), lineHtml(state, 2, { skip: state.hero && state.hero.hex, short: true }));
    renderInto($("k-cap"), kioskCaption(state));
    return;
  }
  renderInto($("strip"), stripHtml(state, { short: easy, after: easy ? lineHtml(state) : axisHtml(state) }) + (ph ? densSeg(dens) : "")); tickTimeline($("strip"), state);
  if (easy && ph === "side") renderInto($("side"), sideHtml(state, { compact: true }));      // sideways: all in one column beside the radar
  else if (easy && ph) { renderInto($("side"), sideHtml(state, { compact: true, notes: 0 })); renderInto($("notes"), notesHtml(state)); }
  else if (easy && WIDE.matches) { renderInto($("side"), sideHtml(state, { notes: 0 })); renderInto($("notes"), notesHtml(state)); }   // a wide screen: worth a look on the radar's far side
  else if (easy) { renderInto($("side"), sideHtml(state)); renderInto($("notes"), ""); }
  const n = picture(state).air.length;
  $("show-all").innerHTML = `${allOpen ? "Hide the list" : `Show all ${n} aircraft, grouped`}<span aria-hidden="true">${allOpen ? "⌃" : "⌄"}</span>`;
  $("show-all").setAttribute("aria-expanded", String(allOpen));
  $("view-now").classList.toggle("all-open", allOpen);
}
const densSeg = (dens) => `<div class="seg dens mini" role="group" aria-label="How much to show">${["simple", "detailed"].map((d) =>
  `<button data-dens="${d}" class="${d === dens ? "on" : ""}" aria-pressed="${d === dens}">${d === "simple" ? "Simple" : "Detailed"}</button>`).join("")}</div>`;
function render() {
  if (!state) return;
  lively();
  updateSky(state);
  renderToggles();
  const dens = density();
  document.body.classList.toggle("d-simple", dens === "simple");
  document.body.classList.toggle("d-detailed", dens !== "simple");
  document.body.classList.toggle("sky-quiet", quietSky());
  document.body.classList.toggle("card-only", cardOnly());
  document.querySelectorAll("#dens-seg button").forEach((b) => { b.classList.toggle("on", b.dataset.dens === dens); b.setAttribute("aria-pressed", String(b.dataset.dens === dens)); });
  paintTheme();
  const w = state.weather, f = state.flow;
  renderPlace(state, KIOSK);
  $("flow").hidden = !f;
  if (f) $("flow").innerHTML = `${esc(state.airport.iata)} landing ${esc(f.dir)}, runways ${esc(runwayList(f.runways))}`;
  $("wx").hidden = !w;
  if (w) {
    const wind = !w.wind_kt ? "calm" : `wind ${w.wind_kt}${w.gust_kt ? `G${w.gust_kt}` : ""} kt`;
    $("wx").innerHTML = `${w.temp_c == null ? "" : `${degF(w.temp_c)}, `}${wind} <b class="cat-${esc(w.category)}">${esc(w.category || "")}</b>`;
    $("wx").classList.toggle("old", !!w.stale);
    $("wx").title = w.stale ? "The airport's last report is hours old: no newer one has come" : "";
  }
  $("n-wx").textContent = (w && !w.stale && w.category) || "";
  followWeather(w);
  $("link").hidden = state.status.ok || !state.status.source;
  $("restart").hidden = !state.restart;
  showHealth(state.health || {});
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
      else if (KIOSK) renderKiosk($("hero"), state, { radar: cardOnly() });
      else if (cardShown()) renderHero($("hero"), state);
      renderPicture(dens);
    });
    drawScopeNow(); if (!KIOSK) renderMiniBoard(state);
  }
  if (view === "board") keepFocus($("board"), () => { $("board").innerHTML = boardHtml(state); });
  noticeNew();
  applyFresh();
  markStale();
  if (KIOSK) hush();
}

// Positions more than 20 s old: aircraft fade, countdowns stop, and a note says how old they are.
function markStale() {
  const age = dataAge(state), old = age > COUNT_STOP_S && (state.aircraft.length > 0 || !!state.hero);
  const words = `Not updating: positions ${Math.round(age)} s old`;
  document.body.classList.toggle("stale", old);
  // the header's offline chip says it (the wall panel, without chips, has its own note)
  if (KIOSK) { $("stale-note").hidden = !old; if (old) $("stale-note").textContent = words; }
  else if (old) { $("link").hidden = false; $("link").textContent = words; }
  // (shown too while CloudWall itself isn't answering, whatever its last answer said of the feed)
  else { $("link").textContent = "Flight data offline"; $("link").hidden = !pollFailed && (state.status.ok || !state.status.source); }
  return old;
}

// The wall panel's quiet hours ([kiosk] quiet, "23:00-06:30"): only a dim clock and what's next.
// It wakes while something is overhead or due within a minute, for an emergency, and for WAKE_S
// when something new is worth a look or the panel is tapped.
const WAKE_S = 120;
let wokeAt = 0;
function quietNow(d = new Date()) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(qs.get("quiet") || (state && state.kiosk && state.kiosk.quiet) || "");
  if (!m) return false;
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4], t = d.getHours() * 60 + d.getMinutes();
  return a <= b ? t >= a && t < b : t >= a || t < b;
}
function hush() {
  let on = !!state && quietNow() && !emergencies().length && Date.now() - wokeAt > WAKE_S * 1000;
  if (on) {
    const R = state.tracking.overhead_nm, t = since(state);
    on = !picture(state).air.some((a) => a.dist <= R || (a.cpa_s - t > 0 && a.cpa_s - t < 60 && a.cpa_nm <= R));
  }
  document.body.classList.toggle("hush", on);
}
function wake() { wokeAt = Date.now(); hush(); }

// Something new worth a look, or a new aircraft next over the house: its radar icon and rows glow
// once. The rows are redrawn every update, so each redraw picks the glow up where it had got to.
// At most once in ten minutes per aircraft; nothing glows for what was there when the page opened.
const FRESH_MS = 3000, REFLASH_MS = 10 * 60 * 1000;
const fresh = new Map(), flashedAt = new Map();
let seenNotable = null, lastNext = null;
function noticeNew() {
  const now = Date.now(), next = (state.hero || state.next || {}).hex || null;
  const notable = new Set(picture(state).air.filter((a) => a.notable && a.notable !== "emergency").map((a) => a.hex));
  for (const [hex, at] of flashedAt) if (now - at >= REFLASH_MS) flashedAt.delete(hex);     // (or it grows for weeks)
  if (seenNotable) {
    const flash = (hex) => {
      if (now - (flashedAt.get(hex) || 0) < REFLASH_MS) return;
      flashedAt.set(hex, now); fresh.set(hex, now); flashCraft(hex);
    };
    for (const hex of notable) if (!seenNotable.has(hex)) { flash(hex); if (KIOSK) wokeAt = now; }     // and the wall panel wakes
    if (next && next !== lastNext) flash(next);
  }
  seenNotable = notable; lastNext = next;
}
// Pointing at an aircraft in one view rings it in the others. The lists and the side view are
// redrawn with every answer, so the mark is put back after each.
let pointed = null;
function applyPointed() {
  for (const e of document.querySelectorAll(":is(main, header) .pointed")) if (e.dataset.hex !== pointed) e.classList.remove("pointed");
  if (pointed) for (const e of document.querySelectorAll(`:is(main, header) [data-hex="${CSS.escape(pointed)}"]`)) e.classList.add("pointed");
}
function point(hex) { if (hex !== pointed) { pointed = hex; applyPointed(); } }
if (!KIOSK) {
  document.addEventListener("pointerover", (e) => { if (e.pointerType !== "touch") point(e.target.closest?.(":is(main, header) [data-hex]")?.dataset.hex || null); });
  document.documentElement.addEventListener("pointerleave", () => point(null));
}
function applyFresh() {
  applyPointed();
  const now = Date.now();
  for (const e of document.querySelectorAll(":is(main, header) .fresh[data-hex]:not(.craft)")) {
    if (!fresh.has(e.dataset.hex)) { e.classList.remove("fresh"); e.style.animationDelay = ""; }
  }
  for (const [hex, t0] of fresh) {
    const gone = now - t0;
    if (gone > FRESH_MS) { fresh.delete(hex); continue; }
    for (const e of document.querySelectorAll(`main [data-hex="${CSS.escape(hex)}"]:not(.craft), header [data-hex="${CSS.escape(hex)}"]`)) {
      if (e.classList.contains("fresh")) continue;
      e.style.animationDelay = `-${gone}ms`;
      e.classList.add("fresh");
    }
  }
}
// When CloudWall itself stops answering, the last positions are shown for a minute (as the server
// does with a silent feed) and then cleared.
const STALE_S = 60;
let lastAnswer = Date.now();
let pollFailed = false;       // the last request for the state got no answer
function dropStale() {
  if (!state || document.hidden || Date.now() - lastAnswer < STALE_S * 1000) return;
  if (!state.status.ok && !state.aircraft.length && !state.hero) return;      // already cleared
  state = { ...state, aircraft: [], beyond: [], hero: null, next: null, pinned: null, overhead: null, emergency: [],
    status: { ...state.status, ok: false, source: state.status.source || "CloudWall" } };
  stateAtPerf += 0.001;         // a new picture, as far as the radar's drawn-once layer goes
  lastSaid = null;
  render();
}

let pollSeq = 0, shownSeq = 0, serverStarted = null, lastSaid = null;
async function poll() {
  if (document.hidden) return;          // a hidden tab doesn't count as a screen being open
  const seq = ++pollSeq, asked = myPin;
  try {
    // while the radar or the map is on screen, the server fetches out to its range (the ATC style's
    // square and the Map view's rectangle reach further, into their corners)
    const shown = state && view === "now" ? scopeMode() : null, prefs = radarPrefs();
    const far = shown === "radar" && prefs.style === "atc" ? "&square=1" : shown === "map" ? `&reach=${mapReach().toFixed(2)}` : "";
    // (the sky view asks for no more than the tracking radius)
    const text = await (await api(`api/state?range=${shown && shown !== "sky" ? prefs.range : 0}${far}` +
      (asked ? `&pin=${encodeURIComponent(asked)}` : ""))).text();
    // answers can cross: keep the newest, and drop one asked for a flight no longer followed
    if (seq < shownSeq || asked !== myPin) return;
    // The feed is read every 5 s and this is asked every 2: most answers say what the last one said
    // (but for the time). Then nothing is drawn again: only that the server answered is noted.
    const said = text.replace(/"now": ?[\d.]+/, "");
    if (said === lastSaid && state && !pollFailed && !document.body.classList.contains("stale")) { shownSeq = seq; lastAnswer = Date.now(); return; }
    const s = JSON.parse(text);
    lastSaid = said;
    // a server restarted since this page loaded may have a newer page: reload, on a wall panel at
    // once, elsewhere once nobody has touched the page for a while
    if (serverStarted == null) serverStarted = s.started;
    else if (s.started && s.started !== serverStarted && (KIOSK || Date.now() - lastTouch > 120000)) { location.reload(); return; }
    shownSeq = seq;
    state = s;
    lastAnswer = Date.now();
    pollFailed = false;
    // Positions are as old as the server's last feed update, not as new as this answer (the feed is
    // read every 5 s, this is asked every 2): time is counted from when they were reported, so
    // aircraft don't step back each time the same update is fetched again.
    const age = state.status && state.status.updated ? Math.min(STALE_S, Math.max(0, state.now - state.status.updated)) * 1000 : 0;
    stateAt = state._at = Date.now() - age;
    stateAtPerf = performance.now() - age;
    if (asked && state.pinned !== asked) pin(null);   // it left the area: back to what's overhead
    if (mapFor !== state.airport.icao) { mapFor = state.airport.icao; loadMap(mapFor).then(() => { scopeLabel = ""; }); }
    // the chime is for an aircraft coming overhead, whichever flight this screen follows
    const over = state.overhead;
    if (over && over !== lastOverhead) {
      const a = state.aircraft.find((x) => x.hex === over);
      chime(/RARE|MILITARY|EMERGENCY|HIJACK|RADIO/.test(((a && a.badges) || []).join(" ")) ? "rare" : "arrival");
      // A new aircraft overhead takes the screen back, unless someone is using it.
      if (view !== "now" && Date.now() - lastTouch > 45000) setView("now");
    }
    lastOverhead = over;
    render();
  } catch (e) { if (seq >= shownSeq) { pollFailed = true; if (state) markStale(); else $("link").hidden = false; } }
}
// A logo that doesn't exist (404) leaves the colour swatch showing in its place.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.classList.contains("logo") && !t.id) {
    logoFailed(decodeURIComponent((t.getAttribute("src") || "").split("/").pop().split("?")[0]));
    t.closest(".logo-tile").remove();
  }
}, true);
// a tap on the hushed wall panel wakes it, and does nothing else (capture, before the handlers below)
document.addEventListener("click", (e) => { if (document.body.classList.contains("hush")) { e.stopImmediatePropagation(); e.preventDefault(); wake(); } }, true);
document.addEventListener("click", (e) => {
  const b = e.target.closest(".tr[data-hex], .q-row[data-hex], .n-row[data-hex], .pf-craft[data-hex]");
  if (b && !b.closest("#board")) { pin(b.dataset.hex); return; }
  const d = e.target.closest("button[data-dens]");
  if (d) {      // Simple or Detailed, for this screen; a button wins over the address
    qs.delete("density"); store(densKey(), d.dataset.dens);
    forgetHero(); forgetKiosk(); scopeLabel = ""; allOpen = false;
    render();
  }
});
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
  // an aircraft in the wall panel's side view: a tap selects it (the click handler above)
  if (!state || e.target.closest(".q-row, .pf-craft")) return;
  const pic = e.target.closest("[data-pic]");
  if (pic) { setPicture(pic.dataset.pic); return; }
  const med = e.target.closest("[data-media]");
  if (med) { setMedia(med.dataset.media); return; }
  const ab = !KIOSK && state.hero && e.target.closest("[data-about]");
  if (ab) { openAbout(ab.dataset.about, aboutContext(state.hero)); return; }
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
$("btn-settings").addEventListener("click", () => showSettings($("settings-menu").hidden));
$("settings-menu").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.sound) { setSound(b.dataset.sound === "on"); renderToggles(); }
  if (b && b.dataset.night) { store("night", b.dataset.night); render(); }
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".settings")) showSettings(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("settings-menu").hidden) { showSettings(false); $("btn-settings").focus(); }
});

setInterval(poll, 2000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastAnswer = Date.now(); poll(); } });
setInterval(() => {
  if (KIOSK && myPin && Date.now() - lastTouch > KIOSK_PIN_S * 1000) pin(null);
  dropStale();
  if (!state) return;
  if (markStale()) return;          // old data: the countdowns stop with it
  if (view !== "now") return;
  tickCounts($("view-now"), state);
  if (KIOSK) { tickCounts($("next-line"), state); hush(); } else tickTimeline($("strip"), state);
  if (emergencies().length) { renderEmergency($("hero"), state, emergencies(), !KIOSK); return; }
  if (!cardShown()) return;
  const elapsed = (Date.now() - stateAt) / 1000;
  if (KIOSK) tickKiosk(elapsed, state.hero ? null : state);
  else if (state.hero) tickHero(elapsed); else keepPlace(() => renderHero($("hero"), state));
}, 1000);
setInterval(() => { if (state && view === "board" && !document.hidden) tickCounts($("board"), state); }, 1000);
setInterval(() => { if (view === "log" && !document.hidden) loadLog(state).catch(() => {}); }, 30000);
// Local time, with UTC beside it ("0324Z").
setInterval(() => {
  const d = new Date(), z = String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z";
  $("clock").innerHTML = `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>${z}</small>`;
}, 1000);
applyPhone();
resumeCompass();
poll().then(() => loadWeather(false));
$("em-chip").addEventListener("click", () => { hidden.clear(); emShown = ""; setView("now"); render(); });
$("tfr-chip").addEventListener("click", () => setView("wx"));
