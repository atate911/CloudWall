// An aircraft squawking 7700, 7600 or 7500 takes over the screen: red background, big code,
// who it is, where it is. On the desktop it can be hidden for that flight; the kiosk shows it
// until the code is cleared.
import { esc, num, mmss, ident } from "./util.js";
import { boardFlight, localWords } from "./hero.js";

export function renderEmergency(el, state, list, canHide) {
  const a = list[0], r = a.route && a.route.plausible ? a.route : null;
  const since = Math.max(0, Date.now() / 1000 - (a.emergency_since || state.now));
  const v = a.vrate || 0, trend = v > 300 ? "climbing" : v < -300 ? "descending" : "level";
  const who = [a.airline, a.type_name || a.type].filter(Boolean).join(", ");
  const where = r ? `${r.origin.iata} to ${r.dest.iata}` : a.local ? localWords(a, state) : "";
  const others = list.slice(1).map((o) => `${ident(o)} (${o.emergency_code})`).join(", ");
  el.className = "panel em-card";
  el.innerHTML = `
    <div class="em-top"><span class="em-code">Squawk <b>${esc(a.emergency_code)}</b></span><span class="em-since">for ${mmss(since)}</span></div>
    <h1 class="em-title">${esc(a.emergency_title)}</h1>
    <p class="em-meaning">${esc(a.emergency_meaning)}</p>
    <div class="em-id"><b>${esc(boardFlight(ident(a)))}</b><span>${esc(who)}</span></div>
    ${where ? `<div class="em-where">${esc(where)}</div>` : ""}
    <div class="em-read">
      <div><b>${a.alt == null ? "–" : num(a.alt)}</b><span>feet, ${trend}</span></div>
      <div><b>${a.gs == null ? "–" : num(a.gs)}</b><span>knots</span></div>
      <div><b>${a.dist.toFixed(1)}</b><span>nm ${esc(a.compass || "")} of home</span></div>
    </div>
    ${others ? `<p class="em-more">Also squawking: ${esc(others)}</p>` : ""}
    ${canHide ? `<button class="em-hide" id="em-hide">Hide for this flight</button>` : ""}`;
}
