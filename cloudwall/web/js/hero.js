// The left-hand panel: the flight card for the aircraft overhead, or a rotating idle display.
import { $, esc, num, mmss, ident, offset, clamp, tidyName, projected, azEl, POINTS, seatWords, phone, since, runwayList } from "./util.js";
import { plate, kindPlate, renderLineup, drawn, typeInfo } from "./plate.js";
import { flap, roll } from "./fx.js";
import { map, tileLayout } from "./map.js";
import { weatherSlide } from "./weather.js";
import { showLogo, badges, boardFlight, localPlace, localWords, recordsHtml, heardGroups } from "./parts.js";
import { latest, refresh } from "./fresh.js";
import { mappable, drawRouteMap, moveRouteMap } from "./routemap.js";
import { medIcon, hospitalLine } from "./situation.js";

// Play the entrance animation once for freshly inserted content.
function enter(el) {
  el.classList.add("enter");
  clearTimeout(el._enterTimer);
  el._enterTimer = setTimeout(() => el.classList.remove("enter"), 500);
}

let cur = { hex: null, routeKey: null, cpa0: 0, photo: null };
let slide = 0, slideAt = Date.now(), slideShown = -1;
const SLIDE_SECONDS = 14;

const SKELETON = `
  <div class="h-top">
    <div class="flaps flight" id="h-flight"></div>
    <div class="airline"><div class="logo-tile" id="h-logo" hidden><img class="logo" id="h-logo-img" alt=""></div><span id="h-airline"></span><small id="h-sub"></small></div>
  </div>
  <div class="tags"><div class="badges" id="h-badges"></div><div class="pin-chip" id="h-pin" hidden>Pinned: tap the card to release</div></div>
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

function routeHtml(a, state) {
  const r = a.route, ap = localPlace(a, state);
  if (a.route_pending && !r) {
    const prov = (state.live_routes && state.live_routes.label) || "the flight data service";
    return `<div class="noroute pending">Looking up route…<small>Asking ${esc(prov)} where this flight is going</small></div>`;
  }
  if (a.medical && (!r || !r.plausible)) {
    // a medical flight: the hospital it's going to, or has just left, when that's known
    return `<div class="noroute med">${medIcon(22)}<span>${esc(a.hospital ? hospitalLine(a.hospital, state) : `${a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance"}, no flight plan filed`)}` +
      `<small>${esc([a.hospital ? (a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance") : "", a.type_name || a.type || ""].filter(Boolean).join(", "))}</small></span></div>`;
  }
  if (a.local === "local") {
    return `<div class="noroute">${esc(localWords(a, state))}<small>${esc(a.type_name || a.type || "Light aircraft")}, low over the field: training or sightseeing, most likely</small></div>`;
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
    // the headline above already says who flies it, so say something new here
    const what = a.squawk === "1200" ? "Flying visually, no flight plan (squawk 1200)" : a.callsign && a.callsign !== a.reg ? "No published route for this flight" : "No flight plan on file";
    return `<div class="noroute">${esc(a.type_name || a.type || "Unknown aircraft")}<small>${esc(what)}</small></div>`;
  }
  const iata = state.airport.iata;
  if (worldLayer(state) && mappable(r)) {
    // the route on a real map: the airports either side of the distance and flight time, the map below
    return `<div class="route mapped ${r.plausible ? "" : "unsure"}">
    <div class="apt ${r.origin.iata === iata ? "local" : ""}"><small>${esc(r.origin.city || r.origin.name || "")}</small><div class="flaps" id="h-orig"></div><div class="apt-when" id="h-dep"></div></div>
    <div class="arc-note"><div id="h-note"></div><div class="arc-time" id="h-dur"></div></div>
    <div class="apt r ${r.dest.iata === iata ? "local" : ""}"><small>${esc(r.dest.city || r.dest.name || "")}</small><div class="flaps" id="h-dest"></div><div class="apt-when" id="h-arr"></div></div>
    <div class="rmap" id="h-map"></div>
  </div>`;
  }
  return `<div class="route ${r.plausible ? "" : "unsure"}">
    <div class="apt ${r.origin.iata === iata ? "local" : ""}"><small>${esc(r.origin.city || r.origin.name || "")}</small><div class="flaps" id="h-orig"></div><div class="apt-when" id="h-dep"></div></div>
    <div><svg class="arc" viewBox="0 0 200 40">
      <path d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--rule)" stroke-width="1"/>
      <path id="h-arc" d="M4,34 Q100,-22 196,34" fill="none" stroke="var(--magenta)" stroke-width="1.4" stroke-linecap="round" pathLength="1"/>
      <circle id="h-arc-dot" r="2.4" fill="var(--magenta)"/></svg>
      <div class="arc-note"><div id="h-note"></div><div class="arc-time" id="h-dur"></div></div></div>
    <div class="apt r ${r.dest.iata === iata ? "local" : ""}"><small>${esc(r.dest.city || r.dest.name || "")}</small><div class="flaps" id="h-dest"></div><div class="apt-when" id="h-arr"></div></div>
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
  flap($("h-flight"), boardFlight(id));
  const ga = info.shape === "piston" || info.shape === "heli" || /^N\d/.test(a.callsign || "");
  // the server's airline agrees with the logo and the flight number (a partner's flight under the airline you'd book)
  $("h-airline").textContent = a.airline || (r && r.airline) || (a.owner && a.owner !== "Private" ? tidyName(a.owner) : ga ? "General aviation" : "");
  $("h-sub").innerHTML = [a.operated_by ? `Operated by ${a.operated_by}` : null, a.callsign !== id ? a.callsign : null].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
  const bh = badges(a.medical ? ["MEDICAL", ...(a.badges || []).filter((b) => b !== "MEDICAL")] : a.badges);
  if ($("h-badges").innerHTML !== bh) $("h-badges").innerHTML = bh;
  $("h-pin").hidden = !state.pinned;

  const inferred = a.local_inferred && a.local !== "local" && (!r || !r.plausible);
  const h = a.hospital, med = a.medical ? `med:${h ? [h.code, h.state, h.eta_s == null ? "" : Math.round((h.eta_s - since(state)) / 60)].join(":") : ""}|` : "";
  const key = med + (a.route_pending && !r ? "pending|" : "") + (inferred ? "inferred:" + a.local + "|" : "") + (r ? [r.flight, r.origin.iata, r.dest.iata, r.plausible].join("|") : "none:" + (a.type_name || a.type || ""));
  if (key !== cur.routeKey) {
    cur.routeKey = key;
    $("h-route").innerHTML = routeHtml(a, state);
    if (inferred) {
      const here = localPlace(a, state).iata;
      flap($(a.local === "arriving" ? "h-dest" : "h-orig"), here);
    } else if (r) { flap($("h-orig"), r.origin.iata || "???"); flap($("h-dest"), r.dest.iata || "???"); }
    if ($("h-map")) drawRouteMap($("h-map"), r, worldLayer(state), state.airport.iata);
  }
  if (r && !inferred) {
    // no progress figure (far airport's position unknown): show the route without a position
    const known = r.progress != null;
    if ($("h-map")) moveRouteMap($("h-map"), known ? r.progress : null);
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
  $("h-dist2").textContent = `${(a.dist * 1.15078).toFixed(1)} mi ${a.compass}`;
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
      m.querySelectorAll(".photo").forEach((p) => p.remove());
      fig.prepend(img);
      m.prepend(fig);
      m.classList.add("has-photo");
    };
    img.src = a.photo;
  }
  cur.a = a;
  cur.state = state;
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
  const type = a.type_name || a.type;
  if (type && (r || a.local_inferred || a.route_pending)) rows.push(["Aircraft", type]);
  if (a.contrail) rows.push(["Contrail", a.contrail === "persistent" ? "Likely, long-lasting" : "Likely, short-lived"]);
  const seats = seatWords(a.seats);
  if (seats) rows.push(["Seats", seats]);
  if (a.reg) rows.push(["Registration", a.age != null ? `${a.reg}, built ${a.year}` : a.reg]);
  const modes = autopilotWords(a.modes);
  if (modes) rows.push(["Autopilot", modes]);
  const html = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
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

// The heatmap is square: beside its caption, as tall as the card allows; on an upright phone, under
// the caption and as wide as the card.
function heatSize(canvas) {
  const box = canvas.parentElement;
  return Math.floor(phone() === "stack" ? Math.min(box.clientWidth, 300) : Math.min(box.clientHeight * 0.94, box.clientWidth * 0.56));
}

// Load the map tiles for the heatmap, then draw (and draw again once they arrive).
function drawHeat(canvas, state, heat) {
  const bm = state.basemap;
  if (!bm || !bm.enabled) return paintHeat(canvas, state, heat, null);
  const R = heat.radius_nm, px = heatSize(canvas) * (window.devicePixelRatio || 1);
  const tiles = tileLayout(state.home, R, px / (2 * R), state.charts && state.charts.map).tiles.map((t) => ({ ...t, img: new Image() }));
  let pending = tiles.length;
  const done = () => { if (--pending === 0 && canvas.isConnected) paintHeat(canvas, state, heat, tiles); };
  for (const t of tiles) { t.img.onload = t.img.onerror = done; t.img.src = t.url; }
  paintHeat(canvas, state, heat, tiles);
}

function paintHeat(canvas, state, heat, tiles) {
  // a square that fits beside the caption, sized here because CSS can't keep a canvas square in a flex row
  const css = heatSize(canvas);
  canvas.style.width = canvas.style.height = css + "px";
  const size = css * (window.devicePixelRatio || 1);
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d"), n = heat.grid, cell = size / n, R = heat.radius_nm, k = size / (2 * R);
  const XY = (lat, lon) => { const o = offset(state.home, { lat, lon }); return [size / 2 + o.x * k, size / 2 - o.y * k]; };
  // colours come from the stylesheet, so the heatmap follows the day and night charts
  const theme = getComputedStyle(document.body), v = (n) => theme.getPropertyValue(n).trim();
  const night = document.body.classList.contains("night");
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, 7); g.clip();
  g.fillStyle = v("--disc"); g.fillRect(0, 0, size, size);
  const bm = state.basemap;
  if (bm && bm.enabled && tiles) {
    // the same faint map as the radar, so the busy corridors line up with real places
    g.globalAlpha = bm.opacity * 0.8;
    const darkMap = ["dark", "carto-dark"].includes(bm.style), lightMap = ["light", "carto-light"].includes(bm.style);
    g.filter = night ? (lightMap ? "invert(1) contrast(1.1) brightness(.8)" : darkMap ? "brightness(1.6)" : "saturate(.4) brightness(.6)")
      : (darkMap ? "invert(1) hue-rotate(180deg) contrast(.9) brightness(1.05)" : lightMap ? "contrast(1.05)" : "saturate(.4) brightness(1.1)");
    for (const t of tiles) if (t.img.complete && t.img.naturalWidth) g.drawImage(t.img, size / 2 + t.x0 * k, size / 2 - t.y0 * k, (t.x1 - t.x0) * k + 0.5, (t.y0 - t.y1) * k + 0.5);
    g.globalAlpha = 1; g.filter = "none";
  } else if (map) {
    g.strokeStyle = v("--water"); g.lineCap = g.lineJoin = "round";
    for (const w of map.water || []) { g.lineWidth = Math.max(2, w.width_nm * k); g.beginPath(); w.line.forEach(([la, lo], i) => { const [x, y] = XY(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  }
  // Log scale, so the handful of busy corridors stand out from the many one-off tracks:
  // rare cells are a faint chart blue, the busiest chart magenta.
  const max = Math.max(2, ...heat.cells.map((c) => c[2])), lmax = Math.log1p(max);
  const lo = rgb(v("--blue")), hi = rgb(v("--magenta"));
  g.globalCompositeOperation = night ? "lighter" : "multiply";
  const cellsSorted = [...heat.cells].sort((a, b) => a[2] - b[2]);
  for (const [x, y, c] of cellsSorted) {
    const t = Math.log1p(c) / lmax, mixT = Math.min(1, Math.max(0, (t - 0.35) / 0.55));
    const [r, gg, bb] = lo.map((ch, i) => Math.round(ch + (hi[i] - ch) * mixT));
    const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell, rad = cell * (0.9 + 0.6 * t);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(${r},${gg},${bb},${(0.12 + 0.55 * t ** 2).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${gg},${bb},0)`);
    g.fillStyle = grad; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  g.globalCompositeOperation = "source-over";
  g.restore();
  g.strokeStyle = v("--rule"); g.lineWidth = Math.max(1, size / 500); g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, 7); g.stroke();
  g.fillStyle = v("--ink"); g.beginPath(); g.arc(size / 2, size / 2, Math.max(3, size / 110), 0, 7); g.fill();
  const [ax, ay] = XY(state.airport.lat, state.airport.lon);
  g.font = `${Math.round(size / 30)}px "B612 Mono", monospace`; g.fillStyle = v("--ink-2"); g.textAlign = "center"; g.fillText(state.airport.iata, ax, ay + size / 24);
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
  const changed = slideShown !== slide;
  if (changed) { el.className = "panel idle-card"; enter(el); }
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
    el.innerHTML = `<div class="idle heat"><div><h1>Today’s traffic</h1>
      <div class="heat-text">Every aircraft tracked within ${H.radius_nm} nm since midnight, laid on top of each other.
      The bright bands are the routes used again and again: the ${esc(state.airport.iata)} arrival and departure paths. Faint lines are one-off flights.</div>
      <div class="heat-legend"><span>one-off</span><i></i><span>busy</span></div>
      <div class="dim heat-key">The dot in the middle is home.</div></div><canvas id="heat"></canvas></div>${dots}`;
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
