// The Board: a departure-board list of everything airborne in range, a two-line version of it for
// a phone, and the short Nearby list beside the radar.
import { $, esc, num, mmss, ident, altText, phone, since } from "./util.js";
import { boardFlight, shortType } from "./parts.js";

// Time until an aircraft is overhead, as the flight card counts it: from when its position was reported.
const overheadIn = (state, a) => mmss(Math.max(0, a.cpa_s - since(state)));
export function boardHtml(state) {
  const R = state.tracking, heroHex = state.hero && state.hero.hex;
  const air = state.aircraft.filter((a) => !a.on_ground).sort((a, b) => {
    // inbound to the house first, soonest first; then everything else by distance
    const ia = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm, ib = b.cpa_s > 0 && b.cpa_nm <= R.overhead_nm;
    return ia !== ib ? ib - ia : ia ? a.cpa_s - b.cpa_s : a.dist - b.dist;
  });
  if (phone()) return phoneBoardHtml(state, air, heroHex, R);
  const rows = air.map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0, c = a.colors;
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    return `<tr data-hex="${esc(a.hex)}" class="${a.hex === heroHex ? "hero" : ""}">
      <td class="lg">${state.logos && a.airline_iata ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc((r && r.airline) || a.airline || "")}"></span>` : ""}<i class="sw" style="background:${c ? esc(c[0]) : "var(--rule)"}"></i></td>
      <td class="fl">${esc(ident(a))}<small>${esc((r && r.airline) || a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || a.type_name || "")}</small></td>
      <td class="rt">${r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}<small>${esc(r.origin.city || "")} to ${esc(r.dest.city || "")}</small>` : '<span class="dim">—</span>'}</td>
      <td class="ty">${esc(a.type || "")}<small>${esc(shortType(a.type_name))}</small></td>
      <td class="num">${altText(a)} <small class="u">ft</small><span class="vs">${v > 300 ? '<span class="up">▲</span>' : v < -300 ? '<span class="down">▼</span>' : ""}</span></td>
      <td class="num">${num(a.gs)} <small class="u">kt</small></td>
      <td class="num">${a.dist.toFixed(1)} <small class="u">nm</small><span class="cmp">${a.compass}</span></td>
      <td class="num ${soon ? "soon" : ""}">${soon ? overheadIn(state, a) : '<span class="dim">—</span>'}</td></tr>`;
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
function phoneBoardHtml(state, air, heroHex, R) {
  const vs = (v) => (v > 300 ? ' <span class="up">▲</span>' : v < -300 ? ' <span class="down">▼</span>' : "");
  const row = (a) => {
    const r = a.route && a.route.plausible ? a.route : null, c = a.colors;
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    const name = (r && r.airline) || a.airline || (a.reg && a.reg !== ident(a) ? a.reg : "") || shortType(a.type_name) || "";
    // the logo stands for the airline's name; if it fails to load, the name shows instead
    const logo = state.logos && a.airline_iata && name ? `<span class="logo-tile tiny"><img class="logo" src="logos/${esc(a.airline_iata)}" alt="${esc(name)}"></span>` : "";
    return `<button class="pb-row${a.hex === heroHex ? " hero" : ""}" data-hex="${esc(a.hex)}">
      <i class="sw" style="background:${c ? esc(c[0]) : "var(--rule)"}"></i>
      <span class="pb-id">${esc(boardFlight(ident(a)))}</span>
      <span class="pb-rt">${r ? `${esc(r.origin.iata)} <span class="dim">to</span> ${esc(r.dest.iata)}` : a.local ? `<span class="dim">${esc(a.local === "arriving" ? "Landing" : a.local === "departing" ? "Departing" : "Local")}</span>` : '<span class="dim">—</span>'}</span>
      <span class="pb-when${soon ? " soon" : ""}">${soon ? overheadIn(state, a) : `${a.dist.toFixed(1)}<small> nm<span class="pb-cmp"> ${esc(a.compass)}</span></small>`}</span>
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

// The compact list beside the radar on wide screens.
export function renderMiniBoard(state) {
  const box = $("mini-board");
  if (!box || getComputedStyle(box).display === "none") return;
  const R = state.tracking, heroHex = state.hero && state.hero.hex;
  const air = state.aircraft.filter((a) => !a.on_ground).sort((a, b) => a.dist - b.dist).slice(0, 14);
  box.innerHTML = `<h2>Nearby</h2>` + (air.map((a) => {
    const r = a.route && a.route.plausible ? a.route : null, v = a.vrate || 0;
    const soon = a.cpa_s > 0 && a.cpa_nm <= R.overhead_nm;
    return `<button class="mb-row ${a.hex === heroHex ? "hero" : ""}" data-hex="${esc(a.hex)}">
      <span class="mb-id">${esc(ident(a))}</span><span class="mb-rt">${r ? `${esc(r.origin.iata)}–${esc(r.dest.iata)}` : esc(a.type || "")}</span>
      <span class="mb-alt">${altText(a)}${v > 300 ? " ▲" : v < -300 ? " ▼" : ""}</span><span class="mb-when ${soon ? "soon" : ""}">${soon ? overheadIn(state, a) : `${a.dist.toFixed(1)} nm`}</span></button>`;
  }).join("") || '<p class="dim">No aircraft in range.</p>');
}
