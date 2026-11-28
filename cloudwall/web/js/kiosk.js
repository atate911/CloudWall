// Kiosk mode: the wall panel, a 7–13" screen read from across the room, made to sit in a room
// like a piece of furniture. One aircraft at a time, very large: the one over the house, its
// airline, its type, where it's going (its own side elevation riding the route line, at its place
// along the way), how high and fast it is, and when it passes. Under it how many aircraft are
// about. The card has the whole screen unless [kiosk] view puts the radar or the map beside it.
// When the sky is quiet, a slow rotation of large slides.
// Sizes are in vh, with nothing under 4vh but the map's credit, so the same design reads the same
// on 1024×600 and 1920×1080 panels and every word of it reads from the sofa.
import { $, esc, num, mmss, ident, since, degF } from "./util.js";
import { boardFlight, showLogo, localWords, heardGroups, shortType } from "./parts.js";
import { latest, refresh } from "./fresh.js";
import { flap } from "./fx.js";
import { medIcon, hospitalWords, arrival, situation, dir8, where, stripHtml, picture } from "./situation.js";
import { windRose, runwayHeadings, skyWords, sunMoonLine, tfrAlt, tfrWhen } from "./weather.js";
import { drawing } from "./silhouette.js";
import { typeInfo, kindPlate } from "./plate.js";
import { profileHtml, profileFrom } from "./profile.js";

const SLIDE_SECONDS = 12;
let cur = { hex: null }, slide = 0, slideAt = Date.now(), shownKey = null, radarSlide = false;

// ---------- a plane overhead ----------
// The aircraft's own side elevation, facing right as the route reads: null for a kind of aircraft
// with no drawing (a glider or balloon of a type not in the table).
function craft(a) {
  const info = typeInfo(a);
  if (!info.shape) return null;
  const d = drawing(info.type, info.shape, info.length, info.name);
  return d.svg ? { svg: d.svg, ar: d.w / d.h } : null;
}
// Where it is and which way it's going, for an aircraft with no route: "Over Vancouver, heading
// east" or "14 nm north of home, heading south"
function whereWords(a, state) {
  const w = a.dist != null ? where(a, state) : "", head = a.track != null && (a.gs || 0) > 15 ? `heading ${dir8(a.track)}` : "";
  const s = [w, head].filter(Boolean).join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
// Under the route, when the card has the whole screen: when it left, how far it has come and has to
// go, and when it gets in (the provider's time, or CloudWall's estimate, which says "about")
const clockAt = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function routeFoot(r) {
  const arrives = r.landed || r.eta || r.eta_est;
  const dist = r.flown_nm != null && r.left_nm != null ? `${num(r.flown_nm)} nm flown, ${num(r.left_nm)} to go`
    : r.left_nm != null ? `${num(r.left_nm)} nm to go` : "";
  return `<div class="k-foot"><span>${r.departed ? `Left ${esc(clockAt(r.departed))}` : ""}</span><span>${esc(dist)}</span>` +
    `<span>${arrives ? `${r.landed ? "Landed" : "Arrives"} ${!r.landed && !r.eta ? "about " : ""}${esc(clockAt(arrives))}` : ""}</span></div>`;
}
// How far along its route it is, 0 to 1, or null when the route doesn't say
function progressOf(r) {
  if (r.progress != null) return Math.max(0, Math.min(1, r.progress));
  return r.flown_nm != null && r.left_nm != null ? r.flown_nm / Math.max(1, r.flown_nm + r.left_nm) : null;
}
function routeBlock(a, state) {
  const r = a.route, here = state.airport, d = craft(a);
  // with no side elevation (a glider, a balloon), the aircraft's outline from the radar instead
  const drawn = (cls = "") => (d ? `<span class="k-craft ${cls}" style="--ar:${d.ar.toFixed(3)}">${d.svg}</span>`
    : cls ? `<span class="k-craft kind ${cls}" style="--ar:1">${kindPlate(a.icon || "light")}</span>` : "");
  if (a.route_pending && !r) return `<div class="k-alone">${drawn("big")}<div class="k-note">Looking up its route</div></div>`;
  if (r && r.plausible) {
    const p = progressOf(r);
    // the line flown so far is solid, the rest to go dotted, and the aircraft where it is between them
    return `<div class="k-route">
      <div class="k-apt ${r.origin.iata === here.iata ? "local" : ""}"><span>${esc(r.origin.city || "")}</span><b>${esc(r.origin.iata)}</b></div>
      <div class="k-line${p == null ? " nop" : ""}" style="--p:${(p ?? 0.5).toFixed(3)}" aria-hidden="true"><i class="k-flown"></i><i class="k-togo"></i>${drawn()}</div>
      <div class="k-apt r ${r.dest.iata === here.iata ? "local" : ""}"><span>${esc(r.dest.city || "")}</span><b>${esc(r.dest.iata)}</b></div>
      ${routeFoot(r)}
    </div>`;
  }
  if (a.medical) {         // a medical flight: the hospital it's going to, or has just left
    const what = a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance";
    const h = a.hospital, w = h ? hospitalWords(h, { short: true }) : what, soon = h && h.state !== "left" ? arrival(h, state) : "";
    return `<div class="k-alone">${drawn("big")}<div class="k-note k-med">${medIcon(40)}<span>${esc(w[0].toUpperCase() + w.slice(1))}${soon || h ? `<small>${esc(soon ? `There ${soon}` : h.name)}</small>` : ""}</span></div></div>`;
  }
  const said = a.local ? localWords(a, state) : whereWords(a, state);
  return `<div class="k-alone">${drawn("big")}${said ? `<div class="k-note">${esc(said)}</div>` : ""}</div>`;
}

// The aircraft in words, under its flight number: its type, as an enthusiast names it
const typeWords = (a) => shortType(a.type_name) || a.type || "Unknown aircraft";

function planeHtml() {
  return `<div class="k-card k-plane">
    <div class="k-head">
      <div class="k-id"><div class="flaps k-flight" id="k-flight"></div>
        <div class="k-who"><div class="logo-tile" id="k-logo" hidden><img class="logo" id="k-logo-img" alt=""></div><span id="k-airline"></span></div></div>
      <div class="k-type" id="k-type"></div>
      <figure class="photo k-photo" id="k-photo" hidden></figure>
    </div>
    <div id="k-route"></div>
    <div class="k-read">
      <div><b id="k-alt"></b><span id="k-alt-l">feet</span></div>
      <div><b id="k-gs"></b><span>knots</span></div>
      <div><b id="k-when"></b><span id="k-when-l">overhead in</span></div>
    </div>
  </div>`;
}

// A photo of this very airframe (planespotters.net), at the head of the card beside its flight
// number, once it has loaded, with its photographer's credit on it as their terms ask
function showPhoto(a) {
  const fig = $("k-photo");
  if (!fig || !a.photo || !a.photo_by || cur.photo === a.photo) return;
  cur.photo = a.photo;
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.alt = "";
  img.onload = () => {
    if (cur.photo !== a.photo || !fig.isConnected) return;
    fig.innerHTML = `<span class="credit">© ${esc(a.photo_by)} · planespotters.net</span>`;
    fig.prepend(img);
    fig.hidden = false;
  };
  img.src = a.photo;
}

function showPlane(el, a, state) {
  if (cur.hex !== a.hex) {
    cur = { hex: a.hex, routeKey: null, photo: null };
    el.innerHTML = planeHtml();
    showLogo($("k-logo"), $("k-logo-img"), state, a.airline_iata, $("k-airline"));
  }
  flap($("k-flight"), boardFlight(ident(a)));
  $("k-flight").style.setProperty("--n", boardFlight(ident(a)).length);
  $("k-airline").textContent = a.airline || (a.route && a.route.airline) || (a.private_owner ? "" : a.owner || "");
  $("k-type").textContent = typeWords(a);
  const h = a.hospital;
  const p = a.route && progressOf(a.route);
  const key = JSON.stringify([a.route && [a.route.origin.iata, a.route.dest.iata, a.route.plausible, p == null ? null : Math.round(p * 200),
    a.route.flown_nm, a.route.eta || a.route.eta_est, a.route.departed], a.local, a.route_pending, a.type_name, a.type, !!a.medical,
    h && [h.code, h.state, h.eta_s == null ? null : Math.round((h.eta_s - since(state)) / 60)],
    !(a.route && a.route.plausible) && !a.local && !a.medical ? whereWords(a, state) : null]);
  if (key !== cur.routeKey) { cur.routeKey = key; $("k-route").innerHTML = routeBlock(a, state); }
  showPhoto(a);
  const v = a.vrate || 0;
  $("k-alt").innerHTML = `${a.on_ground ? "0" : num(a.alt)}${v > 300 ? '<i class="up">▲</i>' : v < -300 ? '<i class="down">▼</i>' : ""}`;
  $("k-alt-l").textContent = a.on_ground ? "on the ground" : v > 300 ? "feet, climbing" : v < -300 ? "feet, descending" : "feet";
  $("k-gs").textContent = num(a.gs);
  updateWhen(a, since(state));
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
  $("k-when").classList.toggle("word", !(left > 5));   // a word in place of a time is set smaller, to fit
  // once it has gone by, where to look for it
  $("k-when-l").textContent = left > 5 ? "overhead in" : a.dist < 1.5 ? "look up" : a.dist != null ? `${num(a.dist)} nm ${dir8(a.brg)}` : "heading away";
}

// Over the radar: how many aircraft are about, and the ones heard with no position to show
export function kioskCaption(state) {
  const s = situation(state, { short: true, notes: 0 }), heard = s.phrases.find((x) => x.cat === "heard");
  return `<b>${esc(s.head)}</b>${heard ? `<span>${heard.n} ${esc(heard.text)}, no position</span>` : ""}`;
}

// ---------- quiet sky ----------
function nextSlideHtml(n, state) {
  const r = n.route && n.route.plausible ? n.route : null;
  return `<div class="k-card k-slide">
    <div class="k-kicker">Next overhead</div>
    <div class="k-row"><div class="k-big code">${esc(boardFlight(ident(n)))}</div><div class="k-count"><b id="k-next">${mmss(Math.max(0, n.cpa_s - since(state)))}</b><span>to go</span></div></div>
    <div class="k-mid">${r ? `${esc(r.origin.iata)} <i>to</i> ${esc(r.dest.iata)}` : esc(n.type_name || n.type || "")}</div>
    <div class="k-small">${esc([n.airline, r && n.type_name].filter(Boolean).join(", "))}</div>
  </div>`;
}

function weatherSlideHtml(W, state) {
  const n = W.now;
  return `<div class="k-card k-slide k-wx">
    <div class="k-wx-text">
      <div class="k-kicker">Weather at ${esc(state.airport.iata)}</div>
      <div class="k-cat"><i class="sw big cat-${esc(n.category)}"></i><b>${esc(n.category)}</b></div>
      <div class="k-mid">${degF(n.temp_c)}</div>
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

// The radar among the quiet-sky slides, when the card has the screen to itself: the page shows the
// radar beside this card (body.radar-slide), which says in words what is on it, each phrase led by
// its colour on the radar
function radarSlideHtml(state) {
  return `<div class="k-card k-slide k-onradar"><div class="k-kicker">On the radar</div>${stripHtml(state, { short: true, notes: 0 })}</div>`;
}
const onRadar = (on) => document.body.classList.toggle("radar-slide", on);

// The side view along the runways among the quiet-sky slides, while anything is landing or taking
// off: the desktop's drawing, its lettering enlarged with the panel's height to read from the room.
// A tap on an aircraft in it brings up its card (app.js).
function sideSlideHtml(state) {
  const from = profileFrom(state);
  return `<div class="k-card k-slide k-side"><div class="k-kicker">Side view along the runways${from ? `, from the ${esc(from)}` : ""}</div><div class="prof-box" id="k-side"></div></div>`;
}
function drawSide(state) {
  const box = $("k-side"), r = box && box.getBoundingClientRect();
  if (!r || r.width < 50 || r.height < 50) return;
  const z = Math.max(1, Math.min(innerHeight / 300, r.height / 135));
  box.innerHTML = profileHtml(state, Math.round(r.width / z), Math.round(r.height / z));
}
const sideWorth = (state) => { const g = picture(state).groups; return g.arr.length + g.dep.length > 0; };

function quietHtml(state) {
  const n = state.aircraft.filter((a) => !a.on_ground).length;
  return `<div class="k-card k-slide">
    <div class="k-big quiet">Quiet skies</div>
    <div class="k-small">${n ? `${n} aircraft nearby, none heading this way` : "Nothing nearby right now"}</div>
  </div>`;
}

function showIdle(el, state) {
  if (cur.hex !== null) { cur = { hex: null }; slide = 0; slideAt = Date.now(); shownKey = null; }
  refresh("api/weather"); refresh("api/logbook");                  // each at most once a minute
  const wx = latest("api/weather"), log = latest("api/logbook");
  const slides = [state.next ? "next" : "quiet"];
  if ((state.heard || []).length) slides.unshift("military");
  if (radarSlide && picture(state).air.length) slides.splice(1, 0, "radar");      // something to see on it
  if (sideWorth(state)) slides.splice(radarSlide && picture(state).air.length ? 2 : 1, 0, "side");
  if ((state.tfrs || []).some((t) => t.active && !t.drones_only)) slides.push("airspace");
  if (wx && wx.now) slides.push("weather");
  if (log && log.today > 0) slides.push("today");
  if (Date.now() - slideAt > SLIDE_SECONDS * 1000) { slide++; slideAt = Date.now(); }
  slide %= slides.length;
  const kind = slides[slide], words = kind === "radar" ? radarSlideHtml(state) : kind === "quiet" ? quietHtml(state) : "";
  const key = kind + (kind === "next" ? state.next.hex : words);         // the radar's and the quiet sky's words redrawn as they change
  onRadar(kind === "radar");
  if (key === shownKey) {
    if (kind === "next" && $("k-next")) $("k-next").textContent = mmss(Math.max(0, state.next.cpa_s - since(state)));
    if (kind === "side") drawSide(state);          // the aircraft move along it
    return;
  }
  const again = shownKey && shownKey.startsWith("radar") && kind === "radar";     // the same slide, its words updated
  shownKey = key;
  if (kind === "radar") { el.innerHTML = words; if (again) return; }
  else if (kind === "next") el.innerHTML = nextSlideHtml(state.next, state);
  else if (kind === "quiet") el.innerHTML = words;
  else if (kind === "today") el.innerHTML = todaySlideHtml(log, state);
  else if (kind === "military") el.innerHTML = militaryHtml(state);
  else if (kind === "airspace") el.innerHTML = airspaceHtml(state);
  else if (kind === "side") { el.innerHTML = sideSlideHtml(state); drawSide(state); }
  else {
    el.innerHTML = weatherSlideHtml(wx, state);
    // drawn at a fixed size and scaled to its box, so its lettering grows with it
    $("k-rose").innerHTML = windRose(250, wx.now.wind, runwayHeadings(state));
  }
  el.firstElementChild.classList.add("k-enter");
}

// The card: the plane or the slides, in "k-body". Something else drawn in the card (the emergency)
// is replaced by it again.
function body(el) {
  let b = el.querySelector(":scope > .k-body");
  if (!b) {
    el.innerHTML = `<div class="k-body"></div>`;
    b = el.firstElementChild;
    forgetKiosk();
  }
  return b;
}
// radar: whether the radar can be one of the quiet-sky slides (the card has the screen to itself)
export function renderKiosk(el, state, { radar = false } = {}) {
  radarSlide = radar;
  if (state.hero) { onRadar(false); showPlane(body(el), state.hero, state); }
  else { cur.a = null; showIdle(body(el), state); }
}
export function tickKiosk(elapsed, state) {
  if (cur.a && $("k-when")) updateWhen(cur.a, elapsed);
  else if (state) showIdle(body($("hero")), state);
}
export function kioskNext() { slide++; slideAt = Date.now(); shownKey = null; }

// Something else drew in the card (the emergency takeover): rebuild from scratch next time.
export function forgetKiosk() { cur = { hex: undefined }; shownKey = null; onRadar(false); }
