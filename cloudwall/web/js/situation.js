// The traffic picture: what every aircraft in the area is doing, drawn the same way on every
// screen. The server marks each one arriving, departing, flying locally or passing over
// (situation.py), and puts the arrivals in landing order; this turns that into words that double as
// the key, a grouped list, the landing queue, the next aircraft over the house and what's worth a look.
//
// Two densities share it. Simple shows what someone in the house wants to know right now; Detailed
// adds what an enthusiast reads the situation from. Both use the same four colours and the same
// numbered landing order, so switching between them adds detail without anything to relearn.
import { esc, num, mmss, since, runwayList, offset, ident } from "./util.js";
import { iconFor } from "./icons.js";
import { map } from "./map.js";
import { boardFlight, shortType, heardGroups } from "./parts.js";
import { plate, typeInfo } from "./plate.js";
import { flap } from "./fx.js";

export const GROUPS = [["arr", "Arriving"], ["dep", "Departing"], ["loc", "Flying locally"], ["pass", "Passing over"]];
const RAD = Math.PI / 180;
const DIR8 = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const dir8 = (deg) => DIR8[Math.round((((deg || 0) % 360) + 360) % 360 / 45) % 8];
const SHORT8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const short8 = (deg) => SHORT8[Math.round((((deg || 0) % 360) + 360) % 360 / 45) % 8];
const FROM = { west: "east", east: "west", north: "south", south: "north" };     // landing west, arrivals come from the east
const NUMS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const n2w = (n) => NUMS[n] || String(n);
const ORD = ["", "next", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const article = (w) => (/^[aeiou]/i.test(w) && !/^(one|uni|use|eu)/i.test(w) ? "an" : "a");
const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join(""));
const plausible = (a) => (a.route && a.route.plausible ? a.route : null);
const city = (p) => (p && (p.city || p.name || p.iata)) || "";
export const flightName = (a) => boardFlight(ident(a));
// A countdown, as it stands when shown: "now" for the last few seconds.
export const until = (s) => (s < 12 ? "now" : mmss(s));
// A gap between landings in words: "35 seconds", "2½ minutes"
function gapWords(s) {
  if (s < 90) return `${Math.max(5, Math.round(s / 5) * 5)} seconds`;
  const h = Math.round(s / 30) / 2;
  return `${Math.floor(h)}${h % 1 ? "½" : ""} minute${h === 1 ? "" : "s"}`;
}
// How far apart the arrivals land: about the same, or the range when the gaps differ
function spacing(arr) {
  const gaps = arr.map((a) => a.gap_s).filter((g) => g != null);
  if (!gaps.length) return "";
  const lo = Math.min(...gaps), hi = Math.max(...gaps);
  if (hi - lo < 30 || gapWords(lo) === gapWords(hi)) return `about ${gapWords(gaps.reduce((s, g) => s + g, 0) / gaps.length)} apart`;
  // "2 to 3½ minutes apart", or "45 seconds to 2 minutes apart"
  const [l, h] = [gapWords(lo), gapWords(hi)], unit = (w) => w.replace(/^\S+ /, "");
  return `${unit(l).startsWith("minute") && unit(h).startsWith("minute") ? l.split(" ")[0] : l} to ${h} apart`;
}
// Due over the house soon enough to count down to: within ten minutes, and moving (not a drifting balloon)
export const overheadSoon = (a, state) => a.cpa_s > 0 && a.cpa_s < 600 && a.cpa_nm <= state.tracking.overhead_nm && (a.gs || 0) > 40;

// ---- the picture, worked out once for each answer from the server ----
const pictures = new WeakMap();
export function picture(state) {
  let p = pictures.get(state);
  if (p) return p;
  const air = state.aircraft.filter((a) => !a.on_ground);
  const groups = { arr: [], dep: [], loc: [], pass: [] };
  for (const a of air) (groups[a.activity] || groups.pass).push(a);
  groups.arr.sort((a, b) => (a.seq || 99) - (b.seq || 99));
  groups.dep.sort((a, b) => (b.alt || 0) - (a.alt || 0));
  groups.pass.sort((a, b) => a.dist - b.dist);
  // anything worth a look first among the local traffic, so the sentence names it
  groups.loc.sort((a, b) => !!b.notable - !!a.notable || a.dist - b.dist);
  const rwys = [...new Set(groups.arr.map((a) => a.rwy).filter(Boolean))].sort();
  p = { air, groups, rwys };
  pictures.set(state, p);
  return p;
}
// Which way the departures are heading, on average, in words (eight points, as the Board says it).
function depDir(list) {
  const v = list.reduce((s, a) => ({ x: s.x + Math.sin((a.track || 0) * RAD), y: s.y + Math.cos((a.track || 0) * RAD) }), { x: 0, y: 0 });
  return dir8(Math.atan2(v.x, v.y) / RAD);
}
const rwyWords = (p, state) => runwayList(p.rwys.join(" / ")) || state.airport.iata;
// "on 28L and 28R", or "at PDX" when the runways aren't known
const landOn = (p, state) => (p.rwys.length ? `on ${runwayList(p.rwys.join(" / "))}` : `at ${state.airport.iata}`);

// ---- what kind of aircraft, where, in words ----
function milWho(a) {
  const o = `${a.owner || ""} ${a.owner_op || ""}`;
  return /army/i.test(o) ? "Army" : /air force|usaf|air national guard/i.test(o) ? "Air Force" : /navy|naval/i.test(o) ? "Navy"
    : /marine/i.test(o) ? "Marine" : /coast guard/i.test(o) ? "Coast Guard" : "Military";
}
// "Boeing CH-47 Chinook" -> "Chinook"; "Lockheed C-130J Hercules" -> "Hercules"; else the type as it is
function nickname(a) {
  const n = (a.type_name || "").replace(/^(Boeing|Lockheed( Martin)?|Sikorsky|Bell|Airbus|McDonnell Douglas|General Dynamics|Northrop( Grumman)?|Beechcraft|Textron)\s+/i, "");
  const m = /^[A-Z]{1,3}-?\d+[A-Z]*\s+(.+)$/.exec(n);
  return m ? m[1] : n || a.type || "aircraft";
}
// What it is, for a sentence: "helicopter", "hot-air balloon", "Cessna 172 Skyhawk", "Army Chinook"
export function kind(a) {
  if (a.military) return `${milWho(a)} ${nickname(a)}`;
  const o = `${a.owner || ""} ${a.operated_by || ""} ${a.callsign || ""}`;
  switch (a.icon) {
    case "heli": return /life ?flight|mercy|medic|ambulance|life ?line|air ?care|air ?med/i.test(o) ? "medical helicopter"
      : /police|sheriff|patrol/i.test(o) ? "police helicopter" : /news|\btv\b|broadcast/i.test(o) ? "news helicopter" : "helicopter";
    case "tandem": return "twin-rotor helicopter";
    case "balloon": return "hot-air balloon";
    case "glider": case "airship": case "ultralight": case "seaplane": case "drone": case "tiltrotor": return a.icon;
    case "gyro": return "gyrocopter";
    case "fighter": return "military jet";
  }
  const t = shortType(a.type_name);
  if (t && /^[A-Z]/.test(t) && t.length <= 22) return t;
  return a.icon === "bizjet" ? "private jet" : a.icon === "turboprop" ? "turboprop" : a.icon === "light" || a.icon === "twin" ? "small plane" : "aircraft";
}
const withArticle = (k) => `${article(k)} ${k}`;
// Where it is: over or near a town on the airport's map, or so far and which way from home
export function where(a, state, { town = false } = {}) {
  const places = (map && map.places) || [];
  let best = null;
  for (const p of places) {
    const o = offset({ lat: p.at[0], lon: p.at[1] }, a), d = Math.hypot(o.x, o.y);
    if (!best || d < best.d) best = { name: p.name, d };
  }
  if (best && best.d < 4) return `${best.d < 1.5 ? (a.alt != null && a.alt < 2500 ? "low over" : "over") : "near"} ${best.name}`;
  return town ? "" : `${a.dist.toFixed(a.dist < 10 ? 1 : 0)} nm ${dir8(a.brg)} of home`;
}
const trend = (a) => ((a.vrate || 0) > 300 ? "climbing" : (a.vrate || 0) < -300 ? "descending" : "level");
const arrow = (a) => ((a.vrate || 0) > 300 ? "↑" : (a.vrate || 0) < -300 ? "↓" : "");

// ---- the situation: a headline, and a phrase for each group led by its icon ----
// Each phrase's icon is the key to the radar's colours, and its number the count, so the words and
// the key are one thing, said once. Detailed says each group in full ("3 coming in from the east to
// land on 28L and 28R, 1½ to 4½ minutes apart", "1 flying locally: an Army Chinook"); Simple says
// it short ("3 landing at PDX", "2 departing", "1 flying locally"), leaving the rest to the landing
// queue and to what's worth a look beside it. Aircraft heard with no position are left to "Worth a
// look" where that is shown beside the strip ("notes").
export function situation(state, { short = false, notes = short } = {}) {
  const p = picture(state), g = p.groups, n = p.air.length, R = state.tracking.radius_nm, out = [];
  const add = (cat, count, text) => out.push({ cat, n: count, text });
  if (g.arr.length) {
    const from = state.flow && FROM[state.flow.dir] ? ` from the ${FROM[state.flow.dir]}` : "";
    const gap = spacing(g.arr);
    add("arr", g.arr.length, short ? `landing at ${state.airport.iata}` : `coming in${from} to land ${landOn(p, state)}${gap ? `, ${gap}` : ""}`);
  }
  if (g.dep.length) add("dep", g.dep.length, short ? "departing" : `climbing out to the ${depDir(g.dep)}`);
  if (g.pass.length) {
    const high = g.pass.every((a) => (a.alt || 0) >= 18000) ? "high " : "";
    add("pass", g.pass.length, `passing ${high}over${!short && g.pass.length === 1 ? ` at ${num(g.pass[0].alt)} ft` : ""}`);
  }
  if (g.loc.length) {
    const by = new Map();
    for (const a of g.loc) by.set(kind(a), (by.get(kind(a)) || 0) + 1);
    const list = [...by].map(([k, c]) => (c > 1 ? `${n2w(c)} ${k.endsWith("s") ? k : k + "s"}` : withArticle(k)));
    add("loc", g.loc.length, short ? "flying locally" : `flying locally: ${words(list.length > 4 ? [...list.slice(0, 3), `${n2w(list.length - 3)} more`] : list)}`);
  }
  const hg = heardGroups(state.heard || []), heard = hg.reduce((s, h) => s + h.n, 0);
  if (heard && !(notes && notables(state).some((x) => x.heard))) {
    add("heard", heard, hg.length === 1 ? `${hg[0].type}${heard > 1 ? "s" : ""} heard${short ? "" : ", with no position"}`
      : short ? "military aircraft heard" : `heard, with no position: ${words(hg.map((h) => (h.n > 1 ? `${n2w(h.n)} ${h.type}s` : withArticle(h.type))))}`);
  }
  // an emergency leads, in the takeover's own words
  const em = (state.emergency || [])[0];
  const head = em ? `${flightName(em)} is squawking ${em.emergency_code}: ${String(em.emergency_title || "emergency").toLowerCase()}`
    : n === 0 ? `Nothing on the radar within ${R} nm` : n <= 4 ? `A quiet spell: ${n2w(n)} aircraft within ${R} nm` : `${n} aircraft within ${R} nm`;
  return { head, phrases: out };
}

// ---- the icons: each group's in its colour, and one for aircraft heard with no position ----
export function catIcon(cat, a = null, size = 16) {
  const kindOf = a ? a.icon : cat === "loc" ? "light" : "airliner", ic = iconFor(kindOf), k = (size * 0.44) / ic.r;
  const rot = a ? (ic.upright ? 0 : a.track || 0) : { arr: 299, dep: 119, pass: 165, loc: 60 }[cat] || 0;
  return `<svg class="ci c-${cat}" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true"><path d="${ic.d}" transform="rotate(${rot}) scale(${k.toFixed(3)})"/></svg>`;
}
const heardIcon = (size = 16) => `<svg class="ci heard" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true"><path d="${iconFor("fighter").d}" transform="scale(${((size * 0.44) / iconFor("fighter").r).toFixed(3)})"/></svg>`;
// The strip across the top: the headline, and the phrases under it (short, in Simple).
export function stripHtml(state, opts = {}) {
  const s = situation(state, opts);
  // the icon, the count and the first word keep together when a line wraps
  const ph = s.phrases.map((x) => { const [w, ...rest] = x.text.split(" ");
    return `<span class="ph"><span class="ph-k">${x.cat === "heard" ? heardIcon() : catIcon(x.cat)}<b>${x.n}</b> ${esc(w)}</span> ${esc(rest.join(" "))}</span>`; });
  return `<div class="sit"><h1>${esc(s.head)}</h1>${ph.length ? `<p class="pic${opts.short ? " short" : ""}">${ph.join(" ")}</p>` : ""}</div>`;
}

// ---- Detailed: every aircraft, grouped by what it is doing ----
function rowHtml(a, state, heroHex, multi) {
  const r = plausible(a), v = a.vrate || 0, arr = v > 300 ? '<i class="up">▲</i>' : v < -300 ? '<i class="down">▼</i>' : "";
  const ty = a.type ? `<span class="ty">${esc(a.type)}</span>` : "";
  let lead, detail, right;
  if (a.activity === "arr" && a.seq) {
    lead = `<span class="seq">${a.seq}</span>`;
    detail = `${multi && a.rwy ? `<b class="rwy">${esc(a.rwy)}</b>` : ""}${r ? `from ${esc(r.origin.iata || city(r.origin))}` : "landing"}${ty}`;
    right = `<span class="alt">${num(a.alt)}${arr}</span>` +
      `<span class="when"><b data-until="${a.lands_s}">${until(a.lands_s - since(state))}</b><small>${a.gap_s != null ? `+${mmss(a.gap_s)}` : "next"}</small></span>`;
  } else if (a.activity === "dep") {
    lead = catIcon("dep", a);
    detail = `${r ? `to ${esc(r.dest.iata || city(r.dest))}` : "just took off"}${ty}`;
    right = `<span class="alt">${num(a.alt)}${arr}</span><span class="when"><b>${a.dist.toFixed(1)}</b><small>nm ${esc(a.compass)}</small></span>`;
  } else {
    const soon = overheadSoon(a, state);
    lead = catIcon(a.activity || "pass", a);
    detail = a.activity === "loc" ? esc(cap(kind(a))) : `${r ? `${esc(r.origin.iata || city(r.origin))}–${esc(r.dest.iata || city(r.dest))}` : "en route"}${ty}`;
    right = `<span class="alt">${num(a.alt)}${arr}</span>` +
      (soon ? `<span class="when soon"><b data-oh="${a.cpa_s}">${mmss(Math.max(0, a.cpa_s - since(state)))}</b><small>overhead</small></span>`
        : `<span class="when"><b>${a.dist.toFixed(1)}</b><small>nm ${esc(a.compass)}</small></span>`);
  }
  return `<button class="tr${a.hex === heroHex ? " sel" : ""}" data-hex="${esc(a.hex)}"><span class="lead">${lead}</span><span class="fl">${esc(flightName(a))}</span><span class="det">${detail}</span>${right}</button>`;
}
export function listHtml(state) {
  const p = picture(state), g = p.groups, heroHex = state.hero && state.hero.hex, here = state.airport.iata;
  const head = (k, label, note) => `<div class="gh"><span class="gl">${catIcon(k)}${label}<b>${g[k].length}</b></span><span class="gn">${esc(note)}</span></div>`;
  const rows = (k) => g[k].map((a) => rowHtml(a, state, heroHex, p.rwys.length > 1)).join("");
  let s = "";
  if (g.arr.length) s += head("arr", `Arriving ${esc(here)}`, `${rwyWords(p, state)}, in landing order`) + rows("arr");
  if (g.dep.length) s += head("dep", `Departing ${esc(here)}`, `climbing out ${depDir(g.dep)}`) + rows("dep");
  if (g.pass.length) s += head("pass", "Passing over", "en route") + rows("pass");
  if (g.loc.length) s += head("loc", "Flying locally", "no published route") + rows("loc");
  for (const h of heardGroups(state.heard || [])) {
    s += `<div class="gh heard"><span class="gl">${heardIcon()}Heard, no position<b>${h.n}</b></span><span class="gn">${esc(h.type)}${h.n > 1 ? "s" : ""}${h.alts.length ? `, around ${num(h.alts[0])} ft` : ""}</span></div>`;
  }
  return `<div class="tlist">${s || `<p class="t-empty">No aircraft in the air within ${state.tracking.radius_nm} nm.</p>`}</div>`;
}

// ---- Simple: the next aircraft over the house, the landing queue, and what's worth a look ----
// What the subject is doing, in words: "Boeing 737-990ER from San Francisco, landing third at PDX"
function doing(a, state) {
  const r = plausible(a), here = state.airport.iata, what = a.military ? kind(a) : shortType(a.type_name) || cap(kind(a));
  if (a.activity === "arr") return `${what}${r ? ` from ${city(r.origin)}` : ""}, landing ${a.seq ? ORD[a.seq] || `#${a.seq}` : ""} at ${here}`.replace("  ", " ");
  if (a.activity === "dep") return `${what}${r ? ` to ${city(r.dest)}, climbing out` : `, just took off from ${here}`}`;
  if (a.activity === "loc") {      // the distance is in the figures beside: only a town here
    const w = where(a, state, { town: true });
    return a.local_field && a.local ? `${what}, ${a.local === "arriving" ? "landing at" : a.local === "departing" ? "just took off from" : "flying around"} ${a.local_field.name}` : `${cap(kind(a))}${w ? `, ${w}` : ""}`;
  }
  return `${what}${r ? `, ${city(r.origin)} to ${city(r.dest)}` : ", passing over"}`;
}
function overHtml(state, { compact = false } = {}) {
  const a = state.hero || state.next, t = since(state);
  if (!a) {
    const p = picture(state), near = p.air[0];
    return `<section class="ss-over quiet"><div class="label">Over the house</div><p class="so-what">Nothing is heading over the house right now.</p>` +
      (near ? `<p class="so-sub">The nearest is ${esc(flightName(near))}, ${esc(withArticle(kind(near)))} ${esc(where(near, state))}.</p>` : `<p class="so-sub">${state.today ? `${num(state.today)} flyover${state.today === 1 ? "" : "s"} so far today.` : "The sky is quiet."}</p>`) + `</section>`;
  }
  // coming over the house: a countdown; else where it is, and whether it is overhead or has passed
  const coming = a.cpa_s > 0 && a.cpa_nm <= state.tracking.overhead_nm && a.cpa_s - t > 5;
  const label = state.pinned ? "Selected" : coming ? "Over the house next" : a.dist < 1 ? "Overhead now" : a.cpa_s - t <= 5 ? "Just passed" : "Nearest now";
  const first = coming ? `<div><b data-oh="${a.cpa_s}">${mmss(Math.max(0, a.cpa_s - t))}</b><span>overhead in</span></div>`
    : `<div><b>${a.dist.toFixed(1)}<small> nm</small></b><span>${a.dist < 0.3 ? "right overhead" : `to the ${dir8(a.brg)}`}</span></div>`;
  return `<section class="ss-over${compact ? " compact" : ""}"><div class="so-head"><span class="label">${label}</span>${state.pinned ? '<button class="so-let" data-let>Back to overhead</button>' : ""}</div>
    <div class="so-id"><div class="flaps so-flight" data-hex="${esc(a.hex)}" data-flight="${esc(flightName(a))}"></div>${state.logos && a.airline_iata ? `<span class="logo-tile"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc(a.airline || "")}"></span>` : ""}</div>
    <p class="so-what">${esc(doing(a, state))}</p>
    <div class="so-row">${compact || !a.known ? "" : `<div class="so-plate sil-box">${plate(typeInfo(a), { share: 0.98, dim: false })}</div>`}
      <div class="so-nums">${first}<div><b>${a.alt == null ? "–" : num(a.alt)}<small> ft</small></b><span>${trend(a)}</span></div></div></div></section>`;
}
export function queueHtml(state, max = 4) {
  const p = picture(state), arr = p.groups.arr.filter((a) => a.seq), t = since(state);
  const heroHex = (state.hero || state.next || {}).hex;        // the one over the house, in the card above
  if (!arr.length) return "";
  return `<section class="ss-queue"><div class="label">Landing next ${esc(landOn(p, state))}</div>
    ${arr.slice(0, max).map((a) => `<button class="q-row${a.hex === heroHex ? " sel" : ""}" data-hex="${esc(a.hex)}"><span class="seq">${a.seq}</span><b class="q-fl">${esc(flightName(a))}</b>` +
      `<span class="q-from">${plausible(a) ? `from ${esc(city(a.route.origin))}` : esc(cap(kind(a)))}</span><b class="q-t" data-until="${a.lands_s}">${until(a.lands_s - t)}</b></button>`).join("")}
    ${arr.length > max ? `<div class="q-more">and ${n2w(arr.length - max)} more behind them</div>` : ""}</section>`;
}
// Worth a look: what's out of the ordinary right now, at most three: military, a rare type, a
// balloon or glider, and military jets heard with no position. Emergencies have the whole screen.
export function notables(state) {
  const order = { military: 0, rare: 1, unusual: 2 }, out = [];
  const list = picture(state).air.filter((a) => a.notable && a.notable !== "emergency").sort((a, b) => order[a.notable] - order[b.notable] || a.dist - b.dist);
  for (const a of list) {
    const k = kind(a), heading = `${a.icon === "balloon" ? "drifting" : "heading"} ${dir8(a.track)}`;
    if (a.notable === "military") out.push({ a, text: `${k}, ${where(a, state)}`, sub: `${a.type_name || a.type || ""}, ${num(a.alt)} ft, ${heading}` });
    else if (a.notable === "rare") out.push({ a, text: `A rare ${shortType(a.type_name) || a.type}, ${where(a, state)}`, sub: `${flightName(a)}${a.airline ? ` (${a.airline})` : ""}, ${num(a.alt)} ft, ${heading}` });
    else out.push({ a, text: `${cap(withArticle(k))} ${where(a, state)}`, sub: `${num(a.alt)} ft, ${heading}` });
  }
  for (const h of heardGroups(state.heard || [])) {
    const jet = /^(F|A|B|E|KC|C)-\d/.test(h.type), many = h.n > 1;
    const who = jet ? (many ? "Military jets" : "A military jet") : "Military aircraft";
    out.push({ heard: true, text: `${many ? cap(n2w(h.n)) : cap(article(h.type))} ${h.type}${many ? "s" : ""} heard nearby`,
      sub: `${who}${h.alts.length ? ` around ${num(h.alts[0])} ft` : ""}; ${many ? "they send" : "it sends"} no position, so listen for ${many ? "them" : "it"}` });
  }
  return out.slice(0, 3);
}
export function notesHtml(state, max = 3) {
  const n = notables(state).slice(0, max);
  if (!n.length) return "";
  return `<section class="ss-note"><div class="label">Worth a look</div>${n.map((x) => `<${x.a ? `button data-hex="${esc(x.a.hex)}"` : "div"} class="n-row">` +
    `${x.heard ? heardIcon(18) : catIcon(x.a.activity || "pass", x.a, 18)}<span><b>${esc(x.text)}</b><small>${esc(x.sub)}</small></span></${x.a ? "button" : "div"}>`).join("")}</section>`;
}
// The simple side: everything at once (the desktop, the wall panel), or split around the radar (a phone).
export function sideHtml(state, { compact = false, queue = 4, notes = 3 } = {}) {
  return overHtml(state, { compact }) + queueHtml(state, queue) + (notes ? notesHtml(state, notes) : "");
}

// Redraw part of the page without losing the keyboard's place: a flight's row (or a button) that
// had the focus has it again afterwards, when it is still there.
export function keepFocus(el, draw) {
  const f = document.activeElement, mine = f && f !== el && el.contains(f);
  const key = mine && ["hex", "dens", "let", "range"].find((k) => k in f.dataset);
  draw();
  if (!key) return;
  const sel = `${f.tagName.toLowerCase()}${f.classList[0] ? "." + f.classList[0] : ""}[data-${key}="${CSS.escape(f.dataset[key])}"]`;
  const again = el.querySelector(sel);
  if (again && again !== document.activeElement) again.focus({ preventScroll: true });
}
// Put HTML in place only when it changed, keeping the flight's flap display (and any animation it
// is in the middle of) when the flight is the same; a new flight flips in.
export function renderInto(el, html) {
  if (el._html === html) return;
  el._html = html;
  const old = el.querySelector(".so-flight");
  keepFocus(el, () => { el.innerHTML = html; });
  const ph = el.querySelector(".so-flight");
  if (!ph) return;
  if (old && old.dataset.hex === ph.dataset.hex && old.dataset.text === ph.dataset.flight) ph.replaceWith(old);
  else flap(ph, ph.dataset.flight, !!old);
}
// The countdowns, between answers from the server: each element keeps the seconds it was drawn with.
export function tickCounts(root, state) {
  const t = since(state);
  for (const e of root.querySelectorAll("[data-until]")) e.textContent = until(+e.dataset.until - t);
  for (const e of root.querySelectorAll("[data-oh]")) e.textContent = mmss(Math.max(0, +e.dataset.oh - t));
}
