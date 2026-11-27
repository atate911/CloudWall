// The left-hand panel: the flight card for the aircraft overhead, or a rotating idle display.
import { $, esc, num, mmss, ident, offset, clamp, tidyName, projected, azEl, POINTS, seatWords, phone, since, dataAge, runwayList, store } from "./util.js";
import { plate, kindPlate, renderLineup, drawn, typeInfo } from "./plate.js";
import { drawing } from "./silhouette.js";
import { flap, roll } from "./fx.js";
import { map, tileLayout, runwaysFor } from "./map.js";
import { weatherSlide } from "./weather.js";
import { showLogo, badges, boardFlight, localPlace, localWords, recordsHtml, heardGroups } from "./parts.js";
import { latest, refresh } from "./fresh.js";
import { mappable, drawRouteMap, moveRouteMap, routeScale, routeHeight } from "./routemap.js";
import { medIcon, hospitalLine, skyLook } from "./situation.js";

// Play the entrance animation once for freshly inserted content.
function enter(el) {
  el.classList.add("enter");
  clearTimeout(el._enterTimer);
  el._enterTimer = setTimeout(() => el.classList.remove("enter"), 500);
}

let cur = { hex: null, routeKey: null, cpa0: 0, photo: null };
let slide = 0, slideAt = Date.now(), slideShown = -1, refit = false;
const SLIDE_SECONDS = 14;

const SKELETON = `
  <div class="h-id">
  <div class="h-kicker"><span class="label" id="h-why"></span><span class="pin-chip" id="h-pin" hidden>Tap the card to go back to what's overhead</span><span class="est-chip" id="h-est" hidden></span>
    <div class="seg pic" id="h-pic" role="group" aria-label="The card's picture" hidden><button data-pic="map" title="The route on a map">Route</button><button data-pic="plate" title="The aircraft's drawing, and its photo">Aircraft</button></div></div>
  <div class="h-top">
    <div class="h-what">
      <div class="h-type" id="h-type"></div>
      <div class="h-who"><div class="flaps flight" id="h-flight"></div><span id="h-airline"></span><small id="h-sub"></small>
        <div class="tags"><div class="badges" id="h-badges"></div></div></div>
    </div>
    <div class="logo-tile" id="h-logo" hidden><img class="logo" id="h-logo-img" alt=""></div>
  </div>
  </div>
  <div class="h-route" id="h-route"></div>
  <div class="metrics">
    <div class="metric"><div class="label">Altitude</div><div class="v"><span id="h-alt"></span> <small>ft</small> <span id="h-arrow"></span></div><div class="s" id="h-vrate"></div></div>
    <div class="metric"><div class="label">Speed</div><div class="v"><span id="h-gs"></span> <small>kt</small></div><div class="s" id="h-mph"></div></div>
    <div class="metric"><div class="label">Distance</div><div class="v"><span id="h-dist"></span> <small>nm</small></div><div class="s" id="h-dist2"></div></div>
    <div class="metric"><div class="label">Heading</div><div class="v" id="h-hdg"></div><div class="s" id="h-phase"></div></div>
  </div>
  <div class="h-bottom">
    <div class="media" id="h-media"><div class="sil-box" id="h-sil"></div></div>
    <dl class="facts" id="h-facts"></dl>
  </div>`;

const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The flight is said once. Its radio callsign is shown under it only when it says something the
// flight number doesn't: BAW21K under BA 285, but not DAL178 under DL 178, nor QXE2162 under AS 2162
// (the same number, and its operator is named in words beside it).
const flightDigits = (s) => ((/(\d+[A-Z]*)$/.exec(String(s || "").replace(/\s/g, "")) || [])[1] || "").replace(/^0+/, "");
const saysMore = (callsign, id) => !!callsign && callsign !== id && !(flightDigits(callsign) && flightDigits(callsign) === flightDigits(id));

// The aircraft's type by name, the card's headline, as the way into the panel about it (about.js):
// there whether the card has room for the drawing, with its own button, or not. Plain words on the
// wall panel, read from across the room, and for an aircraft whose type has no code.
const aboutLink = (a, words) => (a.type && !document.body.classList.contains("kiosk")
  ? `<button class="about-link" data-about="${esc(a.type)}" title="About this type">${esc(words)}<i aria-hidden="true"> ›</i></button>` : esc(words));

// The two airports stand origin on the left, destination on the right, whichever way the flight is
// going on the map, so the line between them always fills left to right: "From" and "To" over them and
// an arrowhead on the line at the destination's end.
const aptHtml = (p, to, right, here) => `<div class="apt${right ? " r" : ""}${p.iata === here ? " local" : ""}"><small>${to ? "To" : "From"} ${esc(p.city || p.name || "")}</small>` +
  `<div class="flaps" id="${to ? "h-dest" : "h-orig"}"></div><div class="apt-when" id="${to ? "h-arr" : "h-dep"}"></div></div>`;

function routeHtml(a, state) {
  const r = a.route, ap = localPlace(a, state);
  if (a.route_pending && !r) {
    const prov = (state.live_routes && state.live_routes.label) || "the flight data service";
    return `<div class="noroute pending">Looking up route…<small>Asking ${esc(prov)} where this flight is going</small></div>`;
  }
  if (a.medical && (!r || !r.plausible)) {
    // a medical flight: the hospital it's going to, or has just left, when that's known
    return `<div class="noroute med">${medIcon(22)}<span>${esc(a.hospital ? hospitalLine(a.hospital, state) : `${a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance"}, no flight plan filed`)}` +
      `${a.hospital ? `<small>${a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance"}</small>` : ""}</span></div>`;
  }
  if (a.local === "local") {
    return `<div class="noroute">${esc(localWords(a, state))}<small>Low over the field: training or sightseeing, most likely</small></div>`;
  }
  if (a.local_inferred && (!r || !r.plausible)) {
    // the route database is wrong or silent, but the aircraft is clearly landing or leaving here
    const arriving = a.local === "arriving";
    const why = r ? `Its listed route (${esc(r.origin.iata)} to ${esc(r.dest.iata)}) is out of date` : "No route on file for this flight";
    return `<div class="route inferred">
      ${arriving ? `<div class="apt unknown"><span>Origin not known</span></div>` : `<div class="apt local"><small>${esc(ap.city || ap.iata)}</small><div class="flaps" id="h-orig"></div></div>`}
      <div><svg class="arc" viewBox="0 0 200 40"><path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--rule)" stroke-width="1" stroke-dasharray="2 3"/></svg>
        <div class="arc-note">${esc(localWords(a, state))}<br><span class="why">${a.local_field ? "Light aircraft, low over the field" : why}</span></div></div>
      ${arriving ? `<div class="apt r local"><small>${esc(ap.city || ap.iata)}</small><div class="flaps" id="h-dest"></div></div>` : `<div class="apt r unknown"><span>Destination not known</span></div>`}
    </div>`;
  }
  if (!r) {
    // the headline above already says what it is and who flies it, so say something new here
    const [what, more] = a.squawk === "1200" ? ["Flying visually", "No flight plan: squawk 1200, the code for visual flight"]
      : a.callsign && a.callsign !== a.reg ? ["No published route", "Nothing on file for this flight"] : ["No flight plan on file", ""];
    return `<div class="noroute quiet">${esc(what)}${more ? `<small>${esc(more)}</small>` : ""}</div>`;
  }
  const iata = state.airport.iata;
  const left = aptHtml(r.origin, false, false, iata), right = aptHtml(r.dest, true, true, iata);
  const cls = r.plausible ? "" : " unsure";
  // the aircraft itself rides the line between them, in small: its own side elevation, facing the way
  // it's going (an aircraft of no shape to draw, a balloon, keeps the dot)
  const info = typeInfo(a), dr = info.shape ? drawing(info.type, info.shape, info.length, info.name) : null;
  const rider = dr && dr.svg ? `<span class="rider" style="--ar:${(dr.w / dr.h).toFixed(3)}">${dr.svg}</span>` : "";
  if (worldLayer(state) && mappable(r)) {
    // the route on a real map: the airports either side of the distance and flight time, the map below
    return `<div class="route mapped${cls}">
    ${left}
    <div class="prog${rider ? " ridden" : ""}" id="h-prog" aria-hidden="true"><i></i>${rider || "<b></b>"}</div>
    <div class="arc-note"><div id="h-note"></div><div class="arc-time" id="h-dur"></div></div>
    ${right}
    <div class="rmap" id="h-map"></div>
  </div>`;
  }
  // with no map: an arc from the origin on the left to the destination on the right
  return `<div class="route${cls}">
    ${left}
    <div><svg class="arc" viewBox="0 0 200 40">
      <path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--rule)" stroke-width="1"/>
      <path id="h-arc" d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--magenta)" stroke-width="1.4" stroke-linecap="round" pathLength="1"/>
      <path class="arc-head" d="M196,34 L188.4,33.1 L191.5,27.9 Z"/>
      <circle id="h-arc-dot" r="2.4" fill="var(--magenta)"/></svg>
      <div class="arc-note"><div id="h-note"></div><div class="arc-time" id="h-dur"></div></div></div>
    ${right}
  </div>`;
}

// When it left and when it gets in, under each airport, and the flight time between them. A paid
// route provider gives the takeoff time (and FlightAware the arrival); otherwise the arrival is
// CloudWall's own estimate from distance and speed, and says so. Shown for a believable route only.
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min} min`);
function routeTimes(r) {
  if (!r) return { dep: "", arr: "", dur: "" };
  const when = (label, t, about) => (t ? `<span class="label">${label}</span><b>${about ? "<i>about</i> " : ""}${esc(clock(t))}</b>` : "");
  const arrives = r.landed || r.eta || r.eta_est, est = !r.landed && !r.eta;
  const min = r.departed && arrives ? Math.round((arrives - r.departed) / 60) : 0;
  return {
    dep: when("Departed", r.departed),
    arr: when(r.landed ? "Landed" : "Arrives", arrives, est),
    dur: min > 0 ? `Flight time ${est ? "about " : ""}${hm(min)}` : "",
  };
}

// The server's whole-world map layer for the route, if it has one switched on ([map] route).
const worldLayer = (state) => {
  const w = state.charts && state.charts.layers && state.charts.layers.world;
  return w && w.enabled ? w : null;
};

function routeNote(r) {
  if (!r.plausible) return "Listed route doesn't match where it's flying";
  if (r.flown_nm != null) return `${num(r.flown_nm)} nm flown, ${num(r.left_nm)} nm to go`;
  if (r.left_nm != null) return `${num(r.left_nm)} nm to go`;
  return "";
}

function showHero(el, a, state) {
  const fresh = cur.hex !== a.hex;
  if (fresh) {
    el.innerHTML = SKELETON;
    el.className = "panel hero-card";
    enter(el);
    cur = { hex: a.hex, routeKey: null, cpa0: 0, photo: null };
    slideShown = -1;
    showLogo($("h-logo"), $("h-logo-img"), state, a.airline_iata, $("h-airline"));
  }
  const r = a.route;
  const id = ident(a), info = typeInfo(a);
  // what it is, in the card's biggest letters, and a tap on it opens the panel about the type; the
  // flight stands beside the airline's logo. An aircraft of no known type is headed by its flight.
  // (a flight number is spaced as the departure boards space it; a registration or a callsign stands as it is)
  const called = a.flight_no ? boardFlight(id) : id;
  const type = a.type_name || a.type || "", head = $("h-type"), headed = `${a.type || ""}|${type || called}`;
  if (head.dataset.is !== headed) {
    head.dataset.is = headed;
    head.innerHTML = type ? aboutLink(a, type) : esc(called);
  }
  $("h-flight").hidden = !type;
  flap($("h-flight"), type ? called : "");
  const ga = info.shape === "piston" || info.shape === "heli" || /^N\d/.test(a.callsign || "");
  // the server's airline agrees with the logo and the flight number (a partner's flight under the airline you'd book)
  $("h-airline").textContent = a.airline || (r && r.airline) || (a.owner && a.owner !== "Private" ? tidyName(a.owner) : ga ? "General aviation" : "");
  $("h-sub").innerHTML = [a.operated_by ? `Operated by ${a.operated_by}` : null, saysMore(a.callsign, id) ? a.callsign : null].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
  const bh = badges(a.medical ? ["MEDICAL", ...(a.badges || []).filter((b) => b !== "MEDICAL")] : a.badges);
  if ($("h-badges").innerHTML !== bh) $("h-badges").innerHTML = bh;
  $("h-pin").hidden = !state.pinned;
  // why this flight, as the Simple panel says it
  const t0 = since(state), coming = a.cpa_s > 0 && a.cpa_nm <= state.tracking.overhead_nm && a.cpa_s - t0 > 5;
  $("h-why").textContent = state.pinned ? "Selected" : coming ? "Over the house next" : a.dist < 1 ? "Overhead now" : a.cpa_s - t0 <= 5 ? "Just passed" : "Nearest now";
  // a followed flight the feed has left out for a moment: its position is CloudWall's estimate
  // (by the server's clock, plus the time since it answered: this screen's clock may not agree with it)
  const est = a.coasting ? Math.round((state.status.updated || state.now) - a.coasting + dataAge(state)) : null;
  $("h-est").hidden = est == null;
  if (est != null) $("h-est").textContent = `Position estimated: last report ${Math.max(1, est)} s ago`;

  const inferred = a.local_inferred && a.local !== "local" && (!r || !r.plausible);
  const h = a.hospital, med = a.medical ? `med:${h ? [h.code, h.state, h.eta_s == null ? "" : Math.round((h.eta_s - since(state)) / 60)].join(":") : ""}|` : "";
  const key = med + (a.route_pending && !r ? "pending|" : "") + (inferred ? "inferred:" + a.local + "|" : "") + (r ? [r.flight, r.origin.iata, r.dest.iata, r.plausible].join("|") : "none:" + (a.type_name || a.type || ""));
  let drawMap = false;
  if (key !== cur.routeKey) {
    cur.routeKey = key;
    el.querySelector(".h-bottom > .rmap")?.remove();    // the last route's map, if it stood beside the facts
    $("h-route").innerHTML = routeHtml(a, state);
    el.classList.toggle("mapped", !!$("h-map"));
    if (inferred) {
      const here = localPlace(a, state).iata;
      flap($(a.local === "arriving" ? "h-dest" : "h-orig"), here);
    } else if (r) { flap($("h-orig"), r.origin.iata || "???"); flap($("h-dest"), r.dest.iata || "???"); }
    drawMap = !!$("h-map");     // once the card is filled in and the map has its place (below)
  }
  if (r && !inferred) {
    // no progress figure (far airport's position unknown): show the route without a position
    const known = r.progress != null;
    if ($("h-map") && !drawMap) moveRouteMap($("h-map"), known ? r.progress : null);
    if ($("h-prog")) {        // how far along: the line between the codes, flown in magenta
      $("h-prog").classList.toggle("unknown", !known);
      $("h-prog").style.setProperty("--p", `${(clamp(r.progress ?? 0, 0, 1) * 100).toFixed(1)}%`);
    }
    if ($("h-arc")) {
      $("h-arc").style.display = $("h-arc-dot").style.display = known ? "" : "none";
      const p = clamp(r.progress ?? 0.5, 0.03, 0.97);
      $("h-arc").setAttribute("stroke-dasharray", `${p} 1`);
      $("h-arc-dot").setAttribute("cx", (1 - p) ** 2 * 4 + 2 * (1 - p) * p * 100 + p * p * 196);
      $("h-arc-dot").setAttribute("cy", (1 - p) ** 2 * 34 + 2 * (1 - p) * p * -22 + p * p * 34);
    }
    $("h-note").textContent = routeNote(r);
    const t = routeTimes(r.plausible ? r : null);
    for (const [id, html] of [["h-dep", t.dep], ["h-arr", t.arr], ["h-dur", t.dur]]) {
      const e = $(id);
      if (e && e._html !== html) e.innerHTML = e._html = html;
    }
  }

  const v = a.vrate || 0;
  roll($("h-alt"), a.on_ground ? 0 : a.alt);
  $("h-arrow").innerHTML = v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : "";
  // where the autopilot is taking it: the selected altitude, when it differs from where it is now
  const onApproach = (a.modes || []).includes("approach") || a.local === "arriving";
  const tgt = a.target_alt != null && a.alt != null && a.target_alt >= 1000 && !onApproach && Math.abs(a.target_alt - a.alt) > 300
    && (v > 300 ? a.target_alt > a.alt : v < -300 ? a.target_alt < a.alt : true) ? a.target_alt : null;
  const rate = Math.abs(v) > 100 ? `${v > 0 ? "+" : "−"}${num(Math.abs(v))} ft/min` : "level";
  $("h-vrate").textContent = tgt != null ? `${rate}, heading for ${num(Math.round(tgt / 100) * 100)} ft` : rate;
  roll($("h-gs"), a.gs);
  $("h-mph").textContent = num((a.gs || 0) * 1.15078) + " mph";
  roll($("h-dist"), a.dist, (x) => x.toFixed(1));
  // how high up to look, beside how far away
  const look = skyLook(a, state);
  $("h-dist2").textContent = `${(a.dist * 1.15078).toFixed(1)} mi ${a.compass}${look ? `, ${Math.round(look.el)}° up` : ""}`;
  $("h-hdg").textContent = a.track == null ? "–" : String(Math.round(a.track)).padStart(3, "0") + "°";
  $("h-phase").textContent = a.local ? localWords(a, state)
    : a.track == null ? "" : `Toward the ${POINTS[Math.round(a.track / 22.5) % 16]}`;

  const sil = $("h-sil");
  // the type plate: the side elevation with its length, under the photo once one arrives
  const isNew = (a.badges || []).includes("NEW TYPE");
  const silKey = `${info.type}|${info.shape}|${info.length}|${info.name}|${isNew}|${a.icon}`;
  if (sil && sil.dataset.shape !== silKey) {
    sil.dataset.shape = silKey;
    sil.innerHTML = plate(info, { note: isNew ? "New to your collection" : "" }) || kindPlate(a.icon);
    // the type designator in the sheet's corner, for types drawn from their own measurements
    if (drawn(info)) sil.dataset.code = info.type; else delete sil.dataset.code;
    // a button in the drawing's corner opens the panel about its type (about.js), for any aircraft whose
    // type is known: a button, not the whole drawing, which fills the card when there's no route to show,
    // and a tap on the card lets a followed flight go. Not on the wall panel, read from across the room.
    if (a.type && !document.body.classList.contains("kiosk")) {
      sil.insertAdjacentHTML("beforeend", `<button class="about-btn" data-about="${esc(a.type)}" aria-label="About the ${esc(info.name || a.type)}">About this type ›</button>`);
    }
  }
  renderFacts(a, state, since(state));

  if (a.photo && a.photo_by && cur.photo !== a.photo) {
    // a photo of this very airframe takes the top of the frame once it has loaded; the type plate stays below
    cur.photo = a.photo;
    const fig = document.createElement("figure");
    fig.className = "photo";
    fig.innerHTML = credit(a.photo_link, a.photo_by);
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.alt = "";
    img.onload = () => {
      const m = $("h-media");
      if (cur.photo !== a.photo || !m) return;
      m.querySelectorAll(".photo, .media-seg").forEach((p) => p.remove());
      fig.prepend(img);
      m.prepend(fig);
      m.classList.add("has-photo");
      // a switch in the frame's corner: the photo or the drawing, one at a time, as last set on this screen
      m.insertAdjacentHTML("beforeend", `<div class="seg media-seg" role="group" aria-label="Photo or drawing">` +
        `<button data-media="photo" title="The photo of this aircraft">Photo</button><button data-media="plate" title="The type's drawing, to scale">Drawing</button></div>`);
      showMedia(m);
    };
    img.src = a.photo;
  }
  cur.a = a;
  cur.state = state;
  el.classList.toggle("mapped", !!$("h-map"));
  fitCard(el);
  if (drawMap) {
    drawRouteMap($("h-map"), r, worldLayer(state), state.airport.iata);
    moveRouteMap($("h-map"), r.progress ?? null);
  }
  // fitted again when the card changes size, and when its words do within it (the page's fonts
  // arriving, a line of the facts wrapping), which change the room left for the pictures
  if (!el._fit) el._fit = new ResizeObserver(() => { if (el.classList.contains("hero-card")) fitCard(el); });
  if (fresh) {
    el._fit.disconnect();
    for (const part of [el, el.querySelector(".h-id"), el.querySelector(".metrics"), $("h-facts")]) if (part) el._fit.observe(part);
  }
}

// The desktop card is as tall as its row. One picture takes the room the words leave: the route map,
// or, with no map, the aircraft's drawing (or photo) across the card. The map has three places, and
// takes the one that shows the route biggest, keeping the drawing when that costs the route little:
//   across: under the airports, the drawing beside the facts below it (a card with the height for it);
//   wide:   under the airports, taking the drawing's room too, the facts in a row under it (a route
//           running east and west on a card too short for a strip of map to show much);
//   beside: beside the facts, in the drawing's place, the drawing over the facts (a route running
//           north and south, which a wide strip would show as a short line in its middle).
// When the row is too short for everything, things give way in turn, never running into each other:
// the spacing tightens, then the map goes (the drawing takes the stage) or, beside the facts, the
// drawing goes first; last, the facts stand alone in a row.
// A card with room for only one of the two shows the map, and a switch in its corner (Route, Aircraft)
// puts the drawing in the map's place: as it was last set on this screen, for every flight after.
const FITS = ["fit-tight", "fit-nomap", "fit-noplate"];
const STEPS = { across: FITS, wide: ["fit-tight", "fit-nomap"], beside: ["fit-tight", "fit-noplate", "fit-nomap"] };
const picture = () => (store("card") === "plate" ? "plate" : "map");
function fitCard(el, again = false) {
  if (!el.classList.contains("hero-card")) return;
  const map = $("h-map"), r = cur.a && cur.a.route, sw = $("h-pic");
  const over = () => el.scrollHeight > el.clientHeight + 1;
  if (sw) sw.hidden = true;
  el.classList.remove("pic-plate");
  if (phone()) {
    // a phone's card scrolls: its map as tall as the route needs, within reason, a north-south route
    // in a taller map than an east-west one
    placeMap(el, map, "across");
    el.classList.remove(...FITS);
    if (map && map.clientWidth) map.style.height = `${Math.round(clamp(routeHeight(r, map.clientWidth), 176, Math.min(420, innerHeight * 0.55)))}px`;
    return;
  }
  if (map) map.style.height = "";
  const fit = (how) => {
    placeMap(el, map, how);
    el.classList.remove(...FITS);
    if (how === "wide") el.classList.add("fit-noplate");
    for (const f of STEPS[how]) {
      if (!over()) break;
      if (f === "fit-nomap" && !map) continue;
      el.classList.add(f);
    }
    return map && !el.classList.contains("fit-nomap") ? routeScale(r, map.clientWidth, map.clientHeight) : 0;
  };
  if (!map) { fit("across"); return; }
  // decided again only when the route, the card's size or the room its words take changes (a line
  // more, a photo, the page's fonts arriving), so it doesn't flip back and forth from one update to
  // the next or start the map's animation over
  const words = [".h-id", ".metrics"].map((q) => el.querySelector(q)?.offsetHeight).join(",");
  const key = `${cur.routeKey}|${el.clientWidth}x${el.clientHeight}|${words}|${$("h-facts").childElementCount}|${!!el.querySelector(".media.has-photo")}`;
  if (el._mapKey !== key) {
    el._mapKey = key;
    const s = { across: fit("across"), beside: fit("beside"), wide: fit("wide") }, best = Math.max(s.across, s.beside, s.wide);
    el._mapAt = ["across", "beside", "wide"].find((how) => s[how] >= best * 0.85);
    el._mapBest = best;
  }
  // The card's parts can go on settling after the place was chosen (the page's rows finding their
  // heights, a line of the facts arriving) without any of the measures above changing: if the map
  // has ended up much smaller than its place promised, choose again
  if (fit(el._mapAt) < el._mapBest * 0.85 - 1e-6 && !again) { el._mapKey = null; fitCard(el, true); return; }
  // the map alone, the drawing left out for want of room: the switch, and the drawing if it's set to
  if (!sw || !el.classList.contains("fit-noplate") || el.classList.contains("fit-nomap") || document.body.classList.contains("kiosk")) return;
  sw.hidden = false;
  if (picture() === "plate") {
    if (el._mapAt === "beside") el.classList.add("pic-plate");      // beside the facts, in the map's place
    else {                                                           // across the card, as when there's no map
      placeMap(el, map, "across");
      el.classList.remove(...FITS);
      el.classList.add("fit-nomap");
      if (over()) el.classList.add("fit-tight");
      if (over()) { fit(el._mapAt); sw.hidden = true; }      // no room for the drawing either: the map stays, with nothing to switch to
    }
  }
  for (const b of sw.children) {
    const on = !sw.hidden && b.dataset.pic === picture();
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

// The page's fonts arrive after the card is first drawn and change the height of its lines, those
// between the airports among them, which nothing else here measures: the card is fitted afresh.
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener("loadingdone", () => {
    const el = $("hero");
    if (el && el.classList.contains("hero-card")) { el._mapKey = null; fitCard(el); }
  });
}

// The switch in the photo's corner: the airframe's photo, or the type's drawing in its place.
const mediaPick = () => (store("media") === "plate" ? "plate" : "photo");
function showMedia(m) {
  const pick = mediaPick();
  m.classList.toggle("show-plate", pick === "plate");
  m.querySelectorAll("[data-media]").forEach((b) => b.classList.toggle("on", b.dataset.media === pick));
}
export function setMedia(which) {
  store("media", which === "plate" ? "plate" : "photo");
  const m = $("h-media");
  if (m) showMedia(m);
}

// The switch in the card's corner: the route map, or the aircraft's drawing in its place.
export function setPicture(which) {
  store("card", which === "plate" ? "plate" : "map");
  const el = $("hero");
  if (el) fitCard(el);
}

// Put the route map in its place: at the foot of the route (across, wide) or beside the facts.
function placeMap(el, map, how) {
  const bottom = el.querySelector(".h-bottom"), route = el.querySelector(".route.mapped");
  el.classList.toggle("map-beside", !!map && how === "beside");
  el.classList.toggle("map-wide", !!map && how === "wide");
  if (!map || !bottom || !route) return;
  const home = how === "beside" ? bottom : route;
  if (map.parentElement !== home) home === bottom ? bottom.prepend(map) : route.append(map);
}

// A photo's credit: its photographer and a link to its page on planespotters.net, in the
// photo's bottom right corner on its edge, as their terms ask
const credit = (link, by) => `<a class="credit" href="${esc(link)}" target="_blank" rel="noopener noreferrer">© ${esc(by)} · planespotters.net</a>`;

// "autopilot, approach" -> "On, flying the approach". Modes as the aircraft reports them.
function autopilotWords(modes) {
  if (!modes || !modes.length) return null;
  const m = new Set(modes), on = m.has("autopilot");
  const doing = m.has("approach") ? "flying the approach" : m.has("tcas") ? "avoiding traffic"
    : m.has("lnav") || m.has("vnav") ? "following its flight plan" : m.has("althold") ? "holding altitude" : null;
  if (!on && !doing) return null;
  return `${on ? "On" : "Off"}${doing ? `, ${doing}` : ""}`;
}

// The short list beside the photo: times, aircraft, and when it passes the house.
function renderFacts(a, state, elapsed = 0) {
  // departure and arrival times sit under the airports; a light aircraft landing here with no
  // route on file has no airports to put its landing time under, so it goes here
  const r = a.route && a.route.plausible ? a.route : null, rows = [];
  if (!r && a.landing_est) rows.push(["Lands", `about ${clock(a.landing_est)}`]);
  const left = a.cpa_s - elapsed;
  // a drifting balloon or a glider circling has no time worth counting down to (as the lists say)
  const slow = (a.gs || 0) <= 40 || left > 1800;
  rows.push(["Overhead", left > 5 ? (slow ? `not for a while; ${a.cpa_nm.toFixed(1)} nm away at the closest` : `in ${mmss(left)}, ${a.cpa_nm.toFixed(1)} nm away`)
    : a.dist < 1.5 ? "now" : "passed, heading away"]);
  if (a.contrail) rows.push(["Contrail", a.contrail === "persistent" ? "Likely, long-lasting" : "Likely, short-lived"]);
  const seats = seatWords(a.seats);
  if (seats) rows.push(["Seats", seats]);
  // an aircraft the card calls by its registration (no flight number or callsign) has it there already
  if (a.reg && a.reg !== ident(a)) rows.push(["Registration", a.age != null ? `${a.reg}, built ${a.year}` : a.reg]);
  else if (a.reg && a.age != null) rows.push(["Built", String(a.year)]);
  const modes = autopilotWords(a.modes);
  if (modes) rows.push(["Autopilot", modes]);
  const html = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  const dl = $("h-facts");
  if (dl && dl._html !== html) dl.innerHTML = dl._html = html;
}

// Called every second between data updates, to keep the overhead countdown moving.
export function tickHero(elapsed) {
  if (cur.a && cur.state) renderFacts(cur.a, cur.state, elapsed);
}


// ---------- idle: rotate through a few quiet-sky displays ----------
// ---- quiet sky: the next aircraft heading this way, or a calm summary ----
const COVER_WORDS = { FEW: "A few clouds", SCT: "Scattered clouds", BKN: "Broken clouds", OVC: "Overcast", OVX: "Sky obscured", VV: "Sky obscured" };
function weatherWords(w) {
  if (!w) return "";
  const parts = [], layers = (w.clouds || []).filter((c) => c.base != null);
  const deck = layers.find((c) => ["BKN", "OVC", "OVX", "VV"].includes(c.cover)) || layers[0];
  if (deck) parts.push(`${COVER_WORDS[deck.cover] || deck.cover} at ${num(deck.base)} ft`);
  else if (["CLR", "SKC", "CAVOK", "NCD"].includes(w.cover)) parts.push("Clear skies");
  if (w.visibility != null) parts.push(`visibility ${w.visibility} mi`);
  if (!w.wind_kt) parts.push("calm wind");
  else parts.push(`wind ${w.wind_dir === "VRB" ? "variable" : "from the " + POINTS[Math.round(w.wind_dir / 22.5) % 16]} at ${w.wind_kt}${w.gust_kt ? `, gusting ${w.gust_kt}` : ""} kt`);
  if (w.temp_c != null) parts.push(`${Math.round((w.temp_c * 9) / 5 + 32)}°F`);
  return parts.join(", ");
}

function todayLine(state) {
  const bits = [`<b>${state.today}</b> flyover${state.today === 1 ? "" : "s"} logged today${state.seats_today ? `, about <b>${num(state.seats_today)}</b> seats` : ""}`];
  if (state.flow) bits.push(`${esc(state.airport.iata)} landing <b>${esc(state.flow.dir)}</b> on runways ${esc(runwayList(state.flow.runways))}`);
  return bits.join('<span class="sep"></span>');
}

// Where the aircraft will be when it's closest to the house.
function passText(state, n) {
  const t = Math.max(0, n.cpa_s), at = projected(n, t), alt = Math.max(0, (n.alt || 0) + ((n.vrate || 0) * t) / 60);
  const p = azEl(state.home, at, alt);
  const where = p.dist < 0.3 ? "straight overhead" : `${p.dist.toFixed(1)} nm to the ${POINTS[Math.round(p.az / 22.5) % 16]}, about ${Math.round(p.el)}° up`;
  const v = n.vrate || 0, doing = v > 300 ? "climbing" : v < -300 ? "descending" : "level";
  return `Passes ${where}, at ${num(Math.round(alt / 100) * 100)} ft and ${doing}`;
}

const NEXT_SKELETON = `
  <div class="label">Next overhead</div>
  <div class="nu-row">
    <div class="nu-id"><div class="flaps nu-flight" id="nu-flight"></div><div class="nu-line"><div class="logo-tile small" id="nu-logo" hidden><img class="logo" id="nu-logo-img" alt=""></div><div class="nu-sub" id="nu-sub"></div></div></div>
    <div class="countdown big" id="nu-countdown"><svg viewBox="0 0 40 40"><circle class="c-track" cx="20" cy="20" r="17"/><circle class="c-fill" id="nu-ring" cx="20" cy="20" r="17" pathLength="100" transform="rotate(-90 20 20)"/></svg><b id="nu-count"></b></div>
  </div>
  <div class="nu-route" id="nu-route"></div>
  <div class="nu-plate sil-box" id="nu-plate"></div>
  <div class="nu-look" id="nu-look"></div>
  <div class="nu-foot"><div class="today" id="nu-today"></div><div class="wx" id="nu-wx"></div><div class="raw" id="nu-raw"></div></div>`;

let nextCpa0 = 0;
function fillNext(state, n) {
  flap($("nu-flight"), ident(n));
  const r = n.route && n.route.plausible ? n.route : null;
  // with a logo showing, the airline's name would only repeat it
  const logoShown = !$("nu-logo").hidden;
  $("nu-sub").textContent = [logoShown ? null : (r && r.airline) || n.airline, n.type_name || n.type].filter(Boolean).join(", ") || "Unknown aircraft";
  const routeHtml = r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}<small>${esc(r.origin.city || "")} to ${esc(r.dest.city || "")}</small>` : "";
  if ($("nu-route").innerHTML !== routeHtml) $("nu-route").innerHTML = routeHtml;
  const info = typeInfo(n), pk = `${info.type}|${info.length}|${info.name}`, pl = $("nu-plate");
  if (pl.dataset.key !== pk) {
    pl.dataset.key = pk;
    pl.innerHTML = drawn(info) ? plate(info) : "";
    pl.hidden = !drawn(info);
  }
  $("nu-look").textContent = passText(state, n);
  const left = n.cpa_s - since(state);
  nextCpa0 = Math.max(nextCpa0, n.cpa_s, 60);
  $("nu-ring").setAttribute("stroke-dasharray", `${clamp((left / nextCpa0) * 100, 0, 100)} 100`);
  $("nu-count").textContent = left > 2 ? mmss(left) : "NOW";
}

function quietFoot(state) {
  const w = state.weather;
  return `<div class="today">${todayLine(state)}</div><div class="wx">${esc(weatherWords(w))}</div>${w && w.raw ? `<div class="raw">${esc(w.raw)}</div>` : ""}`;
}

function quietSlide(el, state, dots, changed) {
  const n = state.next;
  const key = n ? "next:" + n.hex : "quiet";
  if (changed || el._key !== key) {
    el._key = key;
    if (n) {
      nextCpa0 = 0;
      el.innerHTML = `<div class="idle next-up">${NEXT_SKELETON}</div>${dots}`;
      showLogo($("nu-logo"), $("nu-logo-img"), state, n.airline_iata);
      if (!changed) enter(el);
    } else el.innerHTML = `<div class="idle quiet"></div>${dots}`;
  }
  if (n) {
    fillNext(state, n);
    $("nu-today").innerHTML = todayLine(state);
    $("nu-wx").textContent = weatherWords(state.weather);
    $("nu-raw").textContent = (state.weather && state.weather.raw) || "";
    return;
  }
  const airborne = state.aircraft.filter((a) => !a.on_ground).length;
  const html = `<h1>Quiet skies</h1>
    <div class="next">${airborne ? `${airborne} aircraft within ${state.tracking.radius_nm} nm, none heading this way yet.` : `No aircraft within ${state.tracking.radius_nm} nm right now.`}</div>
    <div class="nu-foot">${quietFoot(state)}</div>`;
  const box = el.querySelector(".idle.quiet");
  if (box._html !== html) box.innerHTML = box._html = html;
}
function lastSlide(s) {
  const when = new Date(s.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `<div class="dim">Last flyover, ${when}</div><h1>${esc(s.flight || s.callsign || s.reg || s.hex)}</h1>
    <div class="next">${esc([s.airline, s.type_name || s.type].filter(Boolean).join(", "))}</div>
    <div>${s.origin ? `${esc(s.origin)} to ${esc(s.dest)}, ` : ""}${num(s.alt_ft)} ft, ${s.min_dist_nm.toFixed(1)} nm from home</div>
    <div class="badges">${badges(s.badges)}</div>`;
}

// ---- today's traffic: every position since midnight, as a heatmap over the map around home ----
// The colour ramp from a cell flown through once to the busiest corridor: transparent, then a cool
// violet, magenta, amber and (by night) a pale gold at the hottest, so the eye goes straight to the
// routes used again and again. Each stop is [t, colour, opacity]. By day the ramp is a shade deeper,
// so it holds up on the pale chart.
const HEAT_RAMP = {
  night: [[0, "#4b3aa8", 0], [0.06, "#5a46c0", 0.2], [0.25, "#7a3cb0", 0.5], [0.5, "#d0407e", 0.86], [0.78, "#f6853a", 0.97], [1, "#ffe7a3", 1]],
  day: [[0, "#5b67c4", 0], [0.06, "#5b67c4", 0.2], [0.25, "#6a3fae", 0.5], [0.5, "#b8306e", 0.84], [0.78, "#e2582a", 0.95], [1, "#f2a531", 1]],
};
const hex3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rampCache = {};
function heatLut(night) {
  const k = night ? "night" : "day";
  if (rampCache[k]) return rampCache[k];
  const stops = HEAT_RAMP[k], lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 1;
    while (j < stops.length - 1 && t > stops[j][0]) j++;
    const [t0, c0, a0] = stops[j - 1], [t1, c1, a1] = stops[j], f = clamp((t - t0) / (t1 - t0), 0, 1);
    const A = hex3(c0), B = hex3(c1);
    for (let c = 0; c < 3; c++) lut[i * 4 + c] = A[c] + (B[c] - A[c]) * f;
    lut[i * 4 + 3] = 255 * (a0 + (a1 - a0) * f);
  }
  return (rampCache[k] = lut);
}
// the legend's bar, from the same ramp
const heatLegend = (night) => `linear-gradient(90deg, ${HEAT_RAMP[night ? "night" : "day"].slice(1)
  .map(([t, c, a]) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent) ${Math.round(t * 100)}%`).join(", ")})`;

// The density field: how many times aircraft crossed each square, softened by a fraction of a square
// (no more: the squares are an eighth of a mile, and the lines should stay sharp), on a log scale (a
// handful of busy corridors carry most of the day's passes), and scaled so the busiest corridor (not
// its single busiest square) reaches the top of the ramp.
function heatField(heat) {
  const n = heat.grid, raw = new Float32Array(n * n);
  for (const [x, y, c] of heat.cells) if (x >= 0 && y >= 0 && x < n && y < n) raw[y * n + x] = c;
  const sigma = 0.5, R = 2, w = [];
  for (let i = -R; i <= R; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b), tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let i = -R; i <= R; i++) { const xx = x + i; if (xx >= 0 && xx < n) v += raw[y * n + xx] * w[i + R]; }
    tmp[y * n + x] = v / sum;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let i = -R; i <= R; i++) { const yy = y + i; if (yy >= 0 && yy < n) v += tmp[yy * n + x] * w[i + R]; }
    out[y * n + x] = Math.log1p(v / sum);
  }
  const lit = [...out].filter((v) => v > 0.02).sort((a, b) => a - b);
  const top = Math.max(Math.log1p(8), lit.length ? lit[Math.floor(lit.length * 0.995)] : 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / top) ** 1.1;
  return out;
}

// The field coloured, on a canvas a few times the grid's size, sampled smoothly between cells.
function heatImage(heat, night) {
  const n = heat.grid, f = heatField(heat), up = Math.max(2, Math.ceil(720 / n)), m = n * up, lut = heatLut(night);
  const c = document.createElement("canvas");
  c.width = c.height = m;
  const img = c.getContext("2d").createImageData(m, m), d = img.data;
  for (let py = 0; py < m; py++) {
    const gy = clamp((py + 0.5) / up - 0.5, 0, n - 1), y0 = Math.floor(gy), y1 = Math.min(n - 1, y0 + 1), fy = gy - y0;
    for (let px = 0; px < m; px++) {
      const gx = clamp((px + 0.5) / up - 0.5, 0, n - 1), x0 = Math.floor(gx), x1 = Math.min(n - 1, x0 + 1), fx = gx - x0;
      const v = (f[y0 * n + x0] * (1 - fx) + f[y0 * n + x1] * fx) * (1 - fy) + (f[y1 * n + x0] * (1 - fx) + f[y1 * n + x1] * fx) * fy;
      const i = Math.round(v * 255) * 4, o = (py * m + px) * 4;
      d[o] = lut[i]; d[o + 1] = lut[i + 1]; d[o + 2] = lut[i + 2]; d[o + 3] = lut[i + 3];
    }
  }
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

// The heatmap is square, as large as its half of the card allows: beside the caption on a wide
// card, under it on a tall one (and on an upright phone). Sized here because CSS can't keep a
// canvas square in a flex layout.
function heatSize(canvas) {
  const box = canvas.closest(".idle.heat"), fig = canvas.parentElement;
  box.classList.toggle("stack", phone() === "stack" || box.clientWidth < box.clientHeight * 1.2);
  let w = fig.clientWidth, h = fig.clientHeight;
  if (h < 160) { h = Math.min(w, 340); fig.style.minHeight = h + "px"; }     // a card that grows to fit (a phone's): a square of the width
  return Math.max(120, Math.floor(Math.min(w, h)));
}

// Load the map tiles for the heatmap, then draw (and draw again once they arrive).
function drawHeat(canvas, state, heat) {
  const night = document.body.classList.contains("night");
  canvas._heat = heatImage(heat, night);
  canvas._night = night;
  const legend = canvas.closest(".idle.heat").querySelector(".heat-legend i");
  if (legend) legend.style.background = heatLegend(night);
  const bm = state.basemap, names = state.charts && state.charts.layers && state.charts.layers.places;
  if (!bm || !bm.enabled) return paintHeat(canvas, state, heat, null);
  const R = heat.radius_nm, px = heatSize(canvas) * (window.devicePixelRatio || 1);
  // (the names a zoom closer than the map, so their lettering comes out smaller)
  const load = (layer, sharp = 1) => tileLayout(state.home, R, (sharp * px) / (2 * R), layer).tiles.map((t) => ({ ...t, img: new Image() }));
  // the map, and the names of the towns and roads over the traffic, so the lines are somewhere
  const tiles = load(state.charts && state.charts.map), labels = names && names.enabled ? load(names, 1.8) : [];
  let pending = tiles.length + labels.length;
  const done = () => { if (--pending === 0 && canvas.isConnected) paintHeat(canvas, state, heat, tiles, labels); };
  for (const t of [...tiles, ...labels]) { t.img.onload = t.img.onerror = done; t.img.src = t.url; }
  paintHeat(canvas, state, heat, tiles, labels);
}

function paintHeat(canvas, state, heat, tiles, labels = []) {
  const css = heatSize(canvas), dpr = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = css + "px";
  const size = Math.round(css * dpr);
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d"), R = heat.radius_nm, mid = size / 2, rad = mid - 1, k = rad / R;
  const XY = (lat, lon) => { const o = offset(state.home, { lat, lon }); return [mid + o.x * k, mid - o.y * k]; };
  // colours come from the stylesheet, so the heatmap follows the day and night charts
  const theme = getComputedStyle(document.body), v = (n) => theme.getPropertyValue(n).trim();
  const night = canvas._night, u = css / 300;          // u: one unit of line or lettering at the 300 px design size
  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(mid, mid, rad, 0, 7); g.clip();
  g.fillStyle = v("--disc"); g.fillRect(0, 0, size, size);
  const bm = state.basemap;
  if (bm && bm.enabled && tiles) {
    // the map in greys only, quiet under the colour, so the corridors line up with real places
    const darkMap = ["dark", "carto-dark"].includes(bm.style);
    g.globalAlpha = night ? 0.7 : 0.6;
    g.filter = night ? (darkMap ? "grayscale(1) brightness(1.15) contrast(.95)" : "invert(1) grayscale(1) brightness(.55) contrast(1.1)")
      : (darkMap ? "invert(1) grayscale(1) contrast(.6) brightness(1.25)" : "grayscale(1) contrast(.7) brightness(1.1)");
    const s = rad / R;
    for (const t of tiles) if (t.img.complete && t.img.naturalWidth) g.drawImage(t.img, mid + t.x0 * s, mid - t.y0 * s, (t.x1 - t.x0) * s + 0.5, (t.y0 - t.y1) * s + 0.5);
    g.globalAlpha = 1; g.filter = "none";
  } else if (map) {
    g.strokeStyle = v("--water"); g.lineCap = g.lineJoin = "round";
    for (const w of map.water || []) { g.lineWidth = Math.max(2, w.width_nm * k); g.beginPath(); w.line.forEach(([la, lo], i) => { const [x, y] = XY(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  }
  // the traffic: by night a soft glow under it first, so the busy corridors seem to give off light
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  const img = canvas._heat, ext = 2 * rad;          // the grid spans the radius each way
  if (night) {
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.3; g.filter = `blur(${(3 * u * dpr).toFixed(1)}px)`;
    g.drawImage(img, mid - ext / 2, mid - ext / 2, ext, ext);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none";
  }
  g.drawImage(img, mid - ext / 2, mid - ext / 2, ext, ext);
  // the place names, over the traffic: light lettering by night, dark by day
  if (labels.length) {
    const s = rad / R;
    g.globalAlpha = night ? 0.62 : 0.6;
    g.filter = night ? "grayscale(1) brightness(.95)" : "grayscale(1) invert(1) brightness(1.1)";
    for (const t of labels) if (t.img.complete && t.img.naturalWidth) g.drawImage(t.img, mid + t.x0 * s, mid - t.y0 * s, (t.x1 - t.x0) * s + 0.5, (t.y0 - t.y1) * s + 0.5);
    g.globalAlpha = 1; g.filter = "none";
  }
  // a soft edge, the map falling away into the disc
  const fade = g.createRadialGradient(mid, mid, rad * 0.88, mid, mid, rad);
  const disc = /^#[0-9a-f]{6}$/i.test(v("--disc")) ? hex3(v("--disc")).join(",") : "128,128,128";    // faded from the disc's own colour, not from black
  fade.addColorStop(0, `rgba(${disc},0)`);
  fade.addColorStop(1, `rgba(${disc},1)`);
  g.fillStyle = fade; g.fillRect(0, 0, size, size);
  // range rings, faint, with their distance at the upper right
  const step = R <= 20 ? 5 : 10, ink = v("--ink"), font = (px, w = 400) => `${w} ${Math.round(px * u * dpr)}px "B612 Mono", monospace`;
  g.strokeStyle = `color-mix(in srgb, ${ink} ${night ? 22 : 26}%, transparent)`;
  g.lineWidth = Math.max(1, 0.8 * u * dpr); g.setLineDash([2 * u * dpr, 3 * u * dpr]);
  g.font = font(8.5); g.fillStyle = v("--slate"); g.textAlign = "left";
  for (let r = step; r < R - 0.01; r += step) {
    g.beginPath(); g.arc(mid, mid, r * k, 0, 7); g.stroke();
    const d = r * k * Math.SQRT1_2;
    g.fillText(`${r} nm`, mid + d + 3 * u * dpr, mid - d - 3 * u * dpr);
  }
  g.setLineDash([]);
  // the airport's runways, and its code beside them
  const rws = runwaysFor(state);
  g.strokeStyle = ink; g.lineCap = "round"; g.lineWidth = Math.max(1.5, 2.2 * u * dpr);
  for (const r of rws) {
    const [a, b] = r.ends.map(([la, lo]) => XY(la, lo));
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  g.restore();
  const [ax, ay] = XY(state.airport.lat, state.airport.lon), lab = (text, x, y, align, weight = 700, px = 10) => {
    g.font = font(px, weight); g.textAlign = align; g.lineJoin = "round";
    g.lineWidth = 3 * u * dpr; g.strokeStyle = `color-mix(in srgb, ${v("--disc")} 85%, transparent)`; g.strokeText(text, x, y);
    g.fillStyle = ink; g.fillText(text, x, y);
  };
  if (Math.hypot(ax - mid, ay - mid) < rad * 0.92) lab(state.airport.iata, ax, ay + 17 * u * dpr, "center");
  // home: a ring and a dot, named
  g.lineWidth = Math.max(1, 1.4 * u * dpr); g.strokeStyle = ink; g.fillStyle = ink;
  g.beginPath(); g.arc(mid, mid, 5 * u * dpr, 0, 7); g.stroke();
  g.beginPath(); g.arc(mid, mid, 1.8 * u * dpr, 0, 7); g.fill();
  lab("Home", mid + 9 * u * dpr, mid + 3.5 * u * dpr, "left", 400, 9);
  // the rim, and north
  g.strokeStyle = v("--rule"); g.lineWidth = Math.max(1, dpr); g.beginPath(); g.arc(mid, mid, rad, 0, 7); g.stroke();
  lab("N", mid, 14 * u * dpr, "center", 700, 9);
}

function showIdle(el, state) {
  if (cur.hex !== null) { cur = { hex: null }; slide = 0; slideAt = Date.now(); slideShown = -1; }   // a flight just left
  for (const what of ["api/logbook", "api/heat", "api/weather"]) refresh(what);     // each at most once a minute
  const L = latest("api/logbook"), H = latest("api/heat"), W = latest("api/weather");
  const slides = ["quiet"];
  if ((state.heard || []).length) slides.unshift("military");
  if ((state.tfrs || []).some((t) => t.active && !t.drones_only)) slides.push("airspace");
  if (W && W.now) slides.push("weather");
  if (H && H.cells.length > 8) slides.push("heat");
  const fleet = fleetToday(L);
  if (fleet.length >= 2) slides.push("fleet");
  if (L && L.today > 0) slides.push("records");
  if (L && L.recent.length) slides.push("last");
  if (Date.now() - slideAt > SLIDE_SECONDS * 1000) { slide++; slideAt = Date.now(); }
  slide %= slides.length;
  const kind = slides[slide], dots = slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<i class="${i === slide ? "on" : ""}"></i>`).join("")}</div>` : "";
  const changed = slideShown !== slide, resized = refit;
  refit = false;
  if (changed && !resized) { el.className = "panel idle-card"; enter(el); }
  if (kind === "quiet") {
    quietSlide(el, state, dots, changed);
    slideShown = slide;
    return;
  }
  if (!changed) return;                             // other slides are drawn once
  slideShown = slide;
  el._key = null;
  if (kind === "military") {
    el.innerHTML = `<div class="idle">${militaryHtml(state.heard, state.airport.city)}</div>${dots}`;
  } else if (kind === "airspace") {
    el.innerHTML = `<div class="idle">${airspaceHtml(state)}</div>${dots}`;
  } else if (kind === "weather") {
    el.innerHTML = `<div class="wx-slot"></div>${dots}`;
    weatherSlide(el.querySelector(".wx-slot"), W, state);
  } else if (kind === "heat") {
    el.innerHTML = `<div class="idle heat"><div class="heat-copy"><div class="dim">Since midnight, within ${H.radius_nm} nm</div><h1>Today’s traffic</h1>
      ${H.aircraft ? `<div class="heat-count"><b>${num(H.aircraft)}</b> aircraft</div>` : ""}
      <div class="heat-text">Each one’s path drawn over the others. The bright lines are the routes flown again and again:
      the ${esc(state.airport.iata)} arrival and departure paths. The faint threads are one-off flights.</div>
      <div class="heat-legend"><span>1 flight</span><i></i><span>all day</span></div></div>
      <div class="heat-fig"><canvas id="heat" role="img" aria-label="Map of today's traffic around home"></canvas></div></div>${dots}`;
    drawHeat($("heat"), state, H);
  } else if (kind === "fleet") {
    el.innerHTML = `<div class="idle fleet"><div class="fleet-head"><h1>Today’s fleet</h1>
      <div class="dim">${fleet.length} types seen since midnight, side by side at their true relative size</div></div>
      <div class="fleet-box" id="fleet-box"></div></div>${dots}`;
    renderLineup($("fleet-box"), fleet);
  } else if (kind === "records") {
    el.innerHTML = `<div class="idle"><h1>Today’s records</h1><div class="dim">${L.today} flyovers so far, ${L.types.length} aircraft types seen since CloudWall started</div>${recordsHtml("", L.records_today)}</div>${dots}`;
  } else {
    const s = L.recent[0];
    const info = typeInfo(s);
    // only credited photos: older entries hold uncredited ones that may show another airframe
    const pic = s.photo && s.photo_by ? `<figure class="photo"><img src="${esc(s.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">${credit(s.photo_link, s.photo_by)}</figure>`
      : drawn(info) ? `<div class="last-plate sil-box">${plate(info)}</div>` : "";
    el.innerHTML = `<div class="idle last">${pic}<div>${lastSlide(s)}</div></div>${dots}`;
  }
}

// Types seen today that have a drawing, most frequent first (at most 36), for the lineup.
function fleetToday(L) {
  return ((L && L.types_today) || []).map((t) => ({ info: typeInfo(t), n: t.n }))
    .filter((t) => drawn(t.info)).slice(0, 36);
}

export function nextSlide() { slide++; slideAt = Date.now(); }
// Something else drew in the card (the emergency takeover): rebuild from scratch next time.
export function forgetHero() { cur = { hex: undefined }; }
// The card changed size (a divider dragged, the window): the quiet-sky slide on it, drawn once to
// its size (the heatmap, the fleet, the weather), is drawn again at the next render, in place. The
// flight card fits itself (fitCard) and its route map redraws itself.
export function heroResized() { if (slideShown >= 0) { slideShown = -1; refit = true; } }

function militaryHtml(heard, city) {
  const groups = heardGroups(heard);
  const lines = groups.map((g) => `<div class="mil-row"><b>${g.n > 1 ? `${g.n} × ` : ""}${esc(g.name)}</b><span>${g.alts.length ? `around ${num(Math.min(...g.alts))}${g.alts.length > 1 && Math.max(...g.alts) - Math.min(...g.alts) > 400 ? `–${num(Math.max(...g.alts))}` : ""} ft` : "altitude unknown"}</span></div>`).join("");
  return `<div class="dim">Heard nearby, position unknown</div><h1>Military jets up</h1>${lines}
    <p class="dim">Their transponders send altitude but no position, so receivers near ${esc(city || "here")} can hear them without placing them on the map. Look and listen: they're usually within a few dozen miles.</p>`;
}

export function airspaceHtml(state) {
  const t = state.tfrs.find((x) => x.active && !x.drones_only);
  const when = t.end ? `until ${new Date(t.end * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "until further notice";
  const alt = t.floor && t.ceiling ? `${t.floor.text === "the surface" ? "From the surface" : `From ${t.floor.text}`} to ${t.ceiling.text}` : "";
  return `<div class="dim">Flight restriction ${t.dist_nm < 0.5 ? "over the house" : `${t.dist_nm} nm away`}</div><h1>${esc(t.name || "Restricted airspace")}</h1>
    <div class="next">${esc(t.kind)}</div><div>${esc([alt, when].filter(Boolean).join(", "))}.</div>
    <p class="dim">Shown as the hatched area on the radar. Source: FAA notice ${esc(t.id)}.</p>`;
}
export function renderHero(el, state) {
  if (state.hero) showHero(el, state.hero, state);
  else { cur.a = null; showIdle(el, state); }
}
