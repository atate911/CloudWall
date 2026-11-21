// The Board: everything airborne in range as a departure board, grouped by what each aircraft is
// doing (arriving in landing order, departing, passing over, flying locally) with what happens
// next for each; a two-line version of it for a phone; and the grouped traffic list beside the radar.
import { $, esc, num, mmss, ident, altText, phone, since } from "./util.js";
import { boardFlight, shortType, heardGroups } from "./parts.js";
import { picture, stripHtml, listHtml, catIcon, kind, where, dir8, until, flightName, overheadSoon, keepFocus, medIcon, hospitalShort } from "./situation.js";
import { profileHtml } from "./profile.js";

const plausible = (a) => (a.route && a.route.plausible ? a.route : null);
const city = (p) => (p && (p.city || p.name || p.iata)) || "";
const arrowOf = (a) => ((a.vrate || 0) > 300 ? ' <span class="up">▲</span>' : (a.vrate || 0) < -300 ? ' <span class="down">▼</span>' : "");
// What happens next for an aircraft: its landing (and who it follows), its climb out, its pass over the house.
function nextHtml(a, state, arr) {
  const t = since(state), soon = overheadSoon(a, state);
  const overIn = `<b data-oh="${a.cpa_s}">${mmss(Math.max(0, a.cpa_s - t))}</b>`;
  if (a.activity === "arr" && a.seq) {
    const ahead = arr[a.seq - 2];
    return `<span class="bs"><span class="bs1"><span class="seq">${a.seq}</span>${esc(a.rwy || "")}, lands in <b data-until="${a.lands_s}">${until(a.lands_s - t)}</b></span>` +
      `<small>${ahead ? `${mmss(a.gap_s)} behind ${esc(flightName(ahead))}` : "next to land"}${soon ? `; over the house in ${mmss(Math.max(0, a.cpa_s - t))}` : ""}</small></span>`;
  }
  const h = a.hospital;
  if (h && h.state === "left") return `<span class="bs"><span class="bs1">Just lifted off from ${esc(h.short)}</span><small>${esc(h.name)}${h.city ? `, ${esc(h.city)}` : ""}</small></span>`;
  if (h && h.eta_s != null) {          // a medical helicopter: when it gets to the hospital, counting down
    return `<span class="bs"><span class="bs1">${h.state === "landing" ? "Landing at" : "At"} ${esc(h.short)} in <b data-until="${h.eta_s}">${until(h.eta_s - t)}</b></span>` +
      `<small>${esc(h.name)}${soon ? `; over the house in ${mmss(Math.max(0, a.cpa_s - t))}` : ""}</small></span>`;
  }
  if (a.activity === "dep") return `<span class="bs"><span class="bs1">Climbing out ${esc(dir8(a.track))}</span><small>${a.dist.toFixed(1)} nm ${esc(dir8(a.brg))} of home${soon ? `; over the house in ${mmss(Math.max(0, a.cpa_s - t))}` : ""}</small></span>`;
  if (soon) return `<span class="bs"><span class="bs1">Over the house in ${overIn}</span><small>${a.cpa_nm.toFixed(1)} nm from it at the closest</small></span>`;
  return `<span class="bs"><span class="bs1">Heading ${esc(dir8(a.track))}</span><small>${a.dist.toFixed(1)} nm ${esc(dir8(a.brg))} of home</small></span>`;
}
function routeHtml(a, state) {
  const r = plausible(a);
  if (a.activity === "loc") {
    const w = a.hospital ? hospitalShort(a.hospital) : where(a, state, { town: true });
    return `${a.medical ? medIcon(14) : ""}${esc(kind(a)[0].toUpperCase() + kind(a).slice(1))}${w ? `<small>${esc(w[0].toUpperCase() + w.slice(1))}</small>` : ""}`;
  }
  if (r) return `${a.medical ? medIcon(14) : ""}<b>${esc(r.origin.iata)}</b> <span class="b-to">to</span> <b>${esc(r.dest.iata)}</b><small>${esc(city(r.origin))} to ${esc(city(r.dest))}</small>`;
  return `<span class="dim">${a.activity === "arr" ? `Landing at ${esc(state.airport.iata)}` : a.activity === "dep" ? `Just took off from ${esc(state.airport.iata)}` : "—"}</span>`;
}

export function boardHtml(state) {
  if (phone()) return `<div class="strip board-strip">${stripHtml(state, { short: true })}</div>` + phoneBoardHtml(state);
  const p = picture(state), g = p.groups, heroHex = state.hero && state.hero.hex, here = esc(state.airport.iata);
  const row = (a) => `<tr data-hex="${esc(a.hex)}" class="${a.hex === heroHex ? "sel" : ""}">
      <td class="b-k">${catIcon(a.activity || "pass", a, 22)}</td>
      <td class="lg">${state.logos && a.airline_iata ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc(a.airline || "")}"></span>` : ""}</td>
      <td class="fl">${esc(flightName(a))}<small>${esc(a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || a.owner || "")}</small></td>
      <td class="rt">${routeHtml(a, state)}</td>
      <td class="ty">${esc(a.type || "")}<small>${esc(shortType(a.type_name))}</small></td>
      <td class="num">${altText(a)} <small class="u">ft</small>${arrowOf(a)}</td>
      <td class="num">${num(a.gs)} <small class="u">kt</small></td>
      <td class="b-st">${nextHtml(a, state, g.arr)}</td></tr>`;
  const sec = (k, title, note) => (g[k].length ? `<tbody class="g-${k}"><tr class="gsec"><th colspan="8"><span class="gl">${catIcon(k, null, 18)}${title}<b>${g[k].length}</b></span><span class="gn">${esc(note)}</span></th></tr>${g[k].map(row).join("")}</tbody>` : "");
  const rw = p.rwys.length ? `landing on ${p.rwys.join(" and ")}` : "landing";
  // military aircraft heard with no position: their altitude and speed, under one heading
  const hd = state.heard || [], groups = heardGroups(hd);
  const heard = hd.length ? `<tbody class="heard"><tr class="gsec heard"><th colspan="8"><span class="gl">Heard, no position<b>${hd.length}</b></span>` +
    `<span class="gn">${esc(groups.map((h) => h.name).join(", "))}; ${hd.length > 1 ? "their transponders send" : "its transponder sends"} altitude only</span></th></tr>` +
    hd.map((a) => `<tr><td class="b-k"></td><td class="lg"></td><td class="fl">${esc(a.callsign || a.reg || a.hex.toUpperCase())}<small>${esc(a.owner_op || "Military")}</small></td>
      <td class="rt"><span class="dim">No position sent</span></td><td class="ty">${esc(a.type || "")}<small>${esc(shortType(a.desc))}</small></td>
      <td class="num">${a.alt == null ? "–" : num(a.alt)} <small class="u">ft</small></td><td class="num">${a.gs == null ? "–" : num(a.gs)} <small class="u">kt</small></td>
      <td class="b-st"><span class="bs"><span class="bs1">Heard within about ${Math.max(a.rough_nm, 10)} nm</span></span></td></tr>`).join("") + `</tbody>` : "";
  return `<div class="strip board-strip">${stripHtml(state)}</div>
    <table class="board grouped"><thead><tr><th></th><th></th><th>Flight</th><th>Route</th><th>Aircraft</th><th class="num">Altitude</th><th class="num">Speed</th><th>What happens next</th></tr></thead>
    ${sec("arr", `Arriving ${here}`, `${rw}, in landing order`)}${sec("dep", `Departing ${here}`, "climbing out")}
    ${sec("pass", "Passing over", "en route, not landing here")}${sec("loc", "Flying locally", "no published route, or to and from a small field")}
    ${p.air.length ? "" : `<tbody><tr><td colspan="8" class="empty">No airborne traffic within ${state.tracking.radius_nm} nm.</td></tr></tbody>`}${heard}</table>
    <div class="board-foot">Tap a flight to show it on the radar and the flight card.</div>`;
}

// On a phone each group's flights are two lines each, everything the table says in a thumb's width:
//   (3) AS 512   SFO to PDX              1:58      (landing in, overhead in, or how far away)
//   [Alaska logo] B739      12,300 ft ▼ 280 kt
function phoneBoardHtml(state) {
  const p = picture(state), heroHex = state.hero && state.hero.hex, t = since(state), R = state.tracking;
  const row = (a) => {
    const r = plausible(a), soon = overheadSoon(a, state);
    const name = a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || shortType(a.type_name) || "";
    const logo = state.logos && a.airline_iata && name ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc(name)}"></span>` : "";
    const when = a.activity === "arr" && a.seq ? `<b data-until="${a.lands_s}">${until(a.lands_s - t)}</b><small> lands</small>`
      : soon ? `<b data-oh="${a.cpa_s}">${mmss(Math.max(0, a.cpa_s - t))}</b><small> over</small>` : `${a.dist.toFixed(1)}<small> nm<span class="pb-cmp"> ${esc(a.compass)}</span></small>`;
    return `<button class="pb-row${a.hex === heroHex ? " hero" : ""}" data-hex="${esc(a.hex)}">
      <span class="pb-k">${a.activity === "arr" && a.seq ? `<span class="seq">${a.seq}</span>` : catIcon(a.activity || "pass", a, 18)}</span>
      <span class="pb-id">${esc(boardFlight(ident(a)))}</span>
      <span class="pb-rt">${a.medical ? medIcon(13) : ""}${r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}` : `<span class="dim">${esc(a.activity === "loc" ? (a.hospital ? `${kind(a)[0].toUpperCase() + kind(a).slice(1)}, ${hospitalShort(a.hospital)}` : kind(a)[0].toUpperCase() + kind(a).slice(1)) : a.activity === "arr" ? "Landing" : a.activity === "dep" ? "Just took off" : "")}</span>`}</span>
      <span class="pb-when${soon || a.seq ? " soon" : ""}">${when}</span>
      <span class="pb-l2"><span class="pb-sub">${logo}${name ? `<span class="pb-name">${esc(name)}</span>` : ""}${a.type ? `<span class="pb-type">${esc(a.type)}</span>` : ""}</span>
      <span class="pb-data">${altText(a)}<small> ft</small>${arrowOf(a)}<span class="pb-gs">${num(a.gs)}<small> kt</small></span></span></span></button>`;
  };
  const sec = (k, title) => (p.groups[k].length ? `<h2 class="pb-h">${catIcon(k, null, 16)}${title} <b>${p.groups[k].length}</b></h2><div class="pboard">${p.groups[k].map(row).join("")}</div>` : "");
  const heard = (state.heard || []).map((a) => `<div class="pb-row heard">
      <span class="pb-k"></span><span class="pb-id">${esc(a.callsign || a.reg || a.hex.toUpperCase())}</span>
      <span class="pb-rt"><span class="dim">No position</span></span><span class="pb-when"><small>~${Math.max(a.rough_nm, 10)} nm</small></span>
      <span class="pb-l2"><span class="pb-sub"><span class="pb-name">${esc(a.owner_op || "Military")}</span>${a.type ? `<span class="pb-type">${esc(a.type)}</span>` : ""}</span>
      <span class="pb-data">${a.alt == null ? "–" : num(a.alt)}<small> ft</small><span class="pb-gs">${a.gs == null ? "–" : num(a.gs)}<small> kt</small></span></span></span></div>`).join("");
  return `${sec("arr", `Arriving ${esc(state.airport.iata)}`)}${sec("dep", `Departing ${esc(state.airport.iata)}`)}${sec("pass", "Passing over")}${sec("loc", "Flying locally")}
    ${p.air.length ? "" : `<p class="empty">No airborne traffic within ${R.radius_nm} nm.</p>`}
    ${heard ? `<h2>Heard, no position</h2><div class="pboard">${heard}</div>` : ""}
    <div class="board-foot">Tap a flight to show it on the flight card.</div>`;
}

// Beside the radar, in Detailed: every aircraft grouped by what it is doing, and under the list the
// side view along the runways. A phone shows the list alone, under the radar.
export function renderMiniBoard(state) {
  const box = $("mini-board");
  if (!box || getComputedStyle(box).display === "none") return;
  if (phone()) { keepFocus(box, () => { box.innerHTML = listHtml(state); }); return; }
  let list = box.querySelector(".mb-list"), prof = box.querySelector(".mb-prof");
  if (!list) {
    box.innerHTML = `<div class="mb-list"></div><div class="mb-prof"><div class="sheet-title">Side view along the runways</div><div class="prof-box"></div></div>`;
    list = box.querySelector(".mb-list"); prof = box.querySelector(".mb-prof");
  }
  const top = list.scrollTop;
  keepFocus(list, () => { list.innerHTML = listHtml(state); });
  list.scrollTop = top;
  if (!list._more) { list._more = () => list.classList.toggle("more", list.scrollTop + list.clientHeight < list.scrollHeight - 4); list.addEventListener("scroll", list._more, { passive: true }); }
  list._more();
  const pb = prof.querySelector(".prof-box"), r = pb.getBoundingClientRect();
  pb.innerHTML = r.width > 50 && r.height > 50 ? profileHtml(state, Math.round(r.width), Math.round(r.height)) : "";
}
