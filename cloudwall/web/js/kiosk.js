// Kiosk mode: a glanceable board for a 7–13" screen across the room.
// Only a few things, very large: who's overhead, where it's going, how high and fast,
// and when it passes. When the sky is quiet, a slow rotation of large slides.
// Sizes are in vh so the same design reads the same on 1024×600 and 1920×1080 panels.
import { $, esc, num, mmss, ident, clamp } from "./util.js";
import { boardFlight, showLogo, localWords, heardGroups } from "./hero.js";
import { typeInfo } from "./data.js";
import { flap } from "./fx.js";
import { windRose, runwaysFromMap, skyWords, sunMoonLine, tfrAlt, tfrWhen } from "./weather.js";

const SLIDE_SECONDS = 12;
const CAT_NAME = { VFR: "Visual flight rules", MVFR: "Marginal VFR", IFR: "Instrument flight rules", LIFR: "Low IFR" };
const f = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));
let cur = { hex: null }, slide = 0, slideAt = Date.now(), shownKey = null;
let wx = null, wxAt = 0, log = null, logAt = 0;

async function refresh() {
  const now = Date.now();
  try {
    if (now - wxAt > 60000) { wxAt = now; wx = await (await fetch("api/weather")).json(); }
    if (now - logAt > 60000) { logAt = now; log = await (await fetch("api/logbook")).json(); }
  } catch (e) { /* keep what we had */ }
}

// ---------- a plane overhead ----------
function routeBlock(a, state) {
  const r = a.route, here = state.airport;
  if (a.route_pending && !r) return `<div class="k-note">Looking up route…</div>`;
  if (r && r.plausible) {
    return `<div class="k-route">
      <div class="k-apt ${r.origin.iata === here.iata ? "local" : ""}"><b>${esc(r.origin.iata)}</b><span>${esc(r.origin.city || "")}</span></div>
      <div class="k-arrow" aria-hidden="true"><svg viewBox="0 0 100 20" preserveAspectRatio="none"><line x1="2" y1="10" x2="92" y2="10"/><polygon points="98,10 88,4 88,16"/></svg></div>
      <div class="k-apt r ${r.dest.iata === here.iata ? "local" : ""}"><b>${esc(r.dest.iata)}</b><span>${esc(r.dest.city || "")}</span></div>
    </div>`;
  }
  if (a.local) return `<div class="k-note big">${esc(localWords(a, state))}</div>`;
  return `<div class="k-note big">${esc(a.type_name || a.type || "Unknown aircraft")}</div>`;
}

function planeHtml() {
  return `<div class="k-card k-plane">
    <div class="k-id"><div class="flaps k-flight" id="k-flight"></div>
      <div class="k-who"><div class="logo-tile" id="k-logo" hidden><img class="logo" id="k-logo-img" alt=""></div><span id="k-airline"></span></div></div>
    <div id="k-route"></div>
    <div class="k-read">
      <div><b id="k-alt"></b><span id="k-alt-l">feet</span></div>
      <div><b id="k-gs"></b><span>knots</span></div>
      <div><b id="k-when"></b><span id="k-when-l">overhead in</span></div>
    </div>
  </div>`;
}

function showPlane(el, a, state) {
  if (cur.hex !== a.hex) {
    cur = { hex: a.hex, routeKey: null };
    el.innerHTML = planeHtml();
    showLogo($("k-logo"), $("k-logo-img"), state, a.airline_iata, $("k-airline"));
  }
  flap($("k-flight"), boardFlight(ident(a)));
  const ga = ["piston", "heli"].includes(typeInfo(a).shape);
  $("k-airline").textContent = a.airline || (a.route && a.route.airline) || (a.private_owner ? "" : a.owner || "");
  const key = JSON.stringify([a.route && [a.route.origin.iata, a.route.dest.iata, a.route.plausible], a.local, a.route_pending, a.type_name]);
  if (key !== cur.routeKey) { cur.routeKey = key; $("k-route").innerHTML = routeBlock(a, state); }
  const v = a.vrate || 0;
  $("k-alt").innerHTML = `${a.on_ground ? "0" : num(a.alt)}${v > 300 ? '<i class="up">▲</i>' : v < -300 ? '<i class="down">▼</i>' : ""}`;
  $("k-gs").textContent = num(a.gs);
  updateWhen(a, 0);
  cur.a = a;
}

// across the room, "Wind 300° 6 kt" reads faster than the sentence on the Weather tab
function shortWind(w) {
  if (!w || !w.speed) return "Calm wind";
  return `Wind ${w.variable ? "variable" : String(w.dir).padStart(3, "0") + "°"} ${w.speed}${w.gust ? "G" + w.gust : ""} kt`;
}

function updateWhen(a, elapsed) {
  const left = a.cpa_s - elapsed;
  $("k-when").textContent = left > 5 ? mmss(left) : a.dist < 1.5 ? "Now" : "Passed";
  $("k-when-l").textContent = left > 5 ? "overhead in" : a.dist < 1.5 ? "look up" : "heading away";
}

// ---------- quiet sky ----------
function nextSlideHtml(n, state) {
  const r = n.route && n.route.plausible ? n.route : null;
  return `<div class="k-card k-slide">
    <div class="k-kicker">Next overhead</div>
    <div class="k-row"><div class="k-big">${esc(boardFlight(ident(n)))}</div><div class="k-count"><b id="k-next">${mmss(n.cpa_s)}</b><span>to go</span></div></div>
    <div class="k-mid">${r ? `${esc(r.origin.iata)} <i>to</i> ${esc(r.dest.iata)}` : esc(n.type_name || n.type || "")}</div>
    <div class="k-small">${esc([n.airline, r && n.type_name].filter(Boolean).join(", "))}</div>
  </div>`;
}

function weatherSlideHtml(W, state) {
  const n = W.now;
  return `<div class="k-card k-slide k-wx">
    <div class="k-wx-text">
      <div class="k-kicker">Weather at ${esc(state.airport.iata)}</div>
      <div class="k-cat"><i class="sw big cat-${n.category}"></i><b>${n.category}</b></div>
      <div class="k-mid">${f(n.temp_c)}°F</div>
      <div class="k-small">${esc(skyWords(n))}<br>${esc(shortWind(n.wind))}</div>
      <div class="k-small k-dim">${sunMoonLine(state.home, true)}</div>
    </div>
    <div class="k-rose" id="k-rose"></div>
  </div>`;
}

function todaySlideHtml(L, state) {
  const busiest = (L.hours || []).reduce((b, h) => (h.n > (b ? b.n : 0) ? h : b), null);
  const hour = busiest ? new Date(2000, 0, 1, busiest.hour).toLocaleTimeString([], { hour: "numeric" }) : null;
  return `<div class="k-card k-slide">
    <div class="k-kicker">Today over the house</div>
    <div class="k-row start"><div class="k-big">${num(L.today)}</div><div class="k-mid">flyover${L.today === 1 ? "" : "s"}</div></div>
    <div class="k-small">${[L.seats_today && L.seats_today.seats ? `About ${num(L.seats_today.seats)} seats flew over` : null,
      busiest ? `Busiest hour ${hour}, ${busiest.n} aircraft` : null, `${L.types.length} aircraft types seen so far`].filter(Boolean).join("<br>")}</div>
  </div>`;
}

function militaryHtml(state) {
  const g = heardGroups(state.heard);
  const n = g.reduce((t, x) => t + x.n, 0), alts = state.heard.map((a) => a.alt).filter((x) => x != null);
  return `<div class="k-card k-slide">
    <div class="k-kicker">Heard nearby, position unknown</div>
    <div class="k-big quiet">${n > 1 ? `${n} × ` : ""}${esc(g.length === 1 ? g[0].type : "military jets")}</div>
    <div class="k-small">${esc(g.map((x) => x.name).join(", "))}${alts.length ? `<br>around ${num(Math.min(...alts))} ft` : ""}<br><span class="k-dim">Their transponders send no position, so they can't be placed on the map</span></div>
  </div>`;
}

function airspaceHtml(state) {
  const t = state.tfrs.find((x) => x.active && !x.drones_only);
  return `<div class="k-card k-slide">
    <div class="k-kicker">Flight restriction ${t.dist_nm < 0.5 ? "over the house" : `${t.dist_nm} nm away`}</div>
    <div class="k-mid">${esc(t.name || "Restricted airspace")}</div>
    <div class="k-small">${esc(t.kind)}<br>${esc(tfrAlt(t))}<br>${esc(tfrWhen(t))}</div>
  </div>`;
}

function quietHtml(state) {
  const n = state.aircraft.filter((a) => !a.on_ground).length;
  return `<div class="k-card k-slide">
    <div class="k-big quiet">Quiet skies</div>
    <div class="k-small">${n ? `${n} aircraft nearby, none heading this way` : "Nothing nearby right now"}</div>
  </div>`;
}

function showIdle(el, state) {
  if (cur.hex !== null) { cur = { hex: null }; slide = 0; slideAt = Date.now(); shownKey = null; }
  refresh();
  const slides = [state.next ? "next" : "quiet"];
  if ((state.heard || []).length) slides.unshift("military");
  if ((state.tfrs || []).some((t) => t.active && !t.drones_only)) slides.push("airspace");
  if (wx && wx.now) slides.push("weather");
  if (log && log.today > 0) slides.push("today");
  if (Date.now() - slideAt > SLIDE_SECONDS * 1000) { slide++; slideAt = Date.now(); }
  slide %= slides.length;
  const kind = slides[slide], key = kind + (kind === "next" ? state.next.hex : "");
  if (key === shownKey) {
    if (kind === "next" && $("k-next")) $("k-next").textContent = mmss(Math.max(0, state.next.cpa_s - (Date.now() - state._at) / 1000));
    return;
  }
  shownKey = key;
  if (kind === "next") el.innerHTML = nextSlideHtml(state.next, state);
  else if (kind === "quiet") el.innerHTML = quietHtml(state);
  else if (kind === "today") el.innerHTML = todaySlideHtml(log, state);
  else if (kind === "military") el.innerHTML = militaryHtml(state);
  else if (kind === "airspace") el.innerHTML = airspaceHtml(state);
  else {
    el.innerHTML = weatherSlideHtml(wx, state);
    const box = $("k-rose"), size = Math.floor(Math.min(box.clientWidth, box.clientHeight));
    box.innerHTML = windRose(size, wx.now.wind, runwaysFromMap(state.home));
  }
  el.firstElementChild.classList.add("k-enter");
}

export function renderKiosk(el, state) {
  if (state.hero) showPlane(el, state.hero, state);
  else { cur.a = null; showIdle(el, state); }
}
export function tickKiosk(elapsed, state) {
  if (cur.a && $("k-when")) updateWhen(cur.a, elapsed);
  else if (state) showIdle($("hero"), state);
}
export function kioskNext() { slide++; slideAt = Date.now(); shownKey = null; }

// Something else drew in the card (the emergency takeover): rebuild from scratch next time.
export function forgetKiosk() { cur = { hex: undefined }; shownKey = null; }
