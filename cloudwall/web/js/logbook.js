// The Logbook tab: the totals, the day by hour, the type collection, records and recent flyovers,
// and what the paid route provider has been used for.
import { $, esc, num } from "./util.js";
import { badges, recordsHtml, shortType } from "./parts.js";
import { plate, drawn, typeInfo } from "./plate.js";
import { refresh } from "./fresh.js";

function budgetLine(fa) {
  const u = fa.unit || "lookups";
  const parts = [`${esc(fa.label)} ${u} used today: ${num(fa.used_today)}${fa.daily_limit != null ? ` of ${num(fa.daily_limit)} allowed` : ""}`];
  if (fa.period_budget != null) {
    parts.push(`${num(fa.period_used)} of ${num(fa.period_budget)} this billing period (${Math.round(fa.margin * 100)}% of ${num(fa.monthly_limit)} held back, resets ${esc(fa.resets)})`);
  }
  if (fa.reported) parts.push(`${esc(fa.label)} itself reports ${num(fa.reported["24h"])} ${u} in the last 24 hours and ${num(fa.reported["30d"])} in 30 days`);
  if (fa.problem) parts.push(`paused: ${esc(fa.problem)}`);
  else if (fa.period_budget != null && fa.period_used >= fa.period_budget) parts.push("budget used up: free routes until the period resets");
  else if (fa.daily_limit != null && fa.used_today >= fa.daily_limit) parts.push("today's share used: free routes until midnight");
  return parts.join(". ") + ".";
}

// Fetch the logbook afresh and draw the tab.
export async function loadLog(state) {
  const L = await refresh("api/logbook", 0);
  if (!L) return;
  const fa = state && state.live_routes;
  const max = Math.max(1, ...L.hours.map((h) => h.n)), byHour = Object.fromEntries(L.hours.map((h) => [h.hour, h.n]));
  let bars = "";
  for (let h = 0; h < 24; h++) bars += `<i class="${byHour[h] ? "" : "z"}" style="height:${((byHour[h] || 0) / max) * 100}%" title="${h}:00"></i>`;
  const axis = ["12a", "6a", "12p", "6p", ""].map((t) => `<span>${t}</span>`).join("");
  $("n-log").textContent = L.today || "";
  $("log").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Flyovers today</div><div class="v">${num(L.today)}</div></div>
      <div class="stat"><div class="label">Seats today</div><div class="v">≈ ${num(L.seats_today.seats)}</div></div>
      <div class="stat"><div class="label">Flyovers, all time</div><div class="v">${num(L.total)}</div></div>
      <div class="stat"><div class="label">Seats, all time</div><div class="v">≈ ${num(L.seats_total.seats)}</div></div>
      <div class="stat"><div class="label">Types collected</div><div class="v">${L.types.length}</div></div>
      <div class="stat"><div class="label">Airlines</div><div class="v">${L.airlines.length}</div></div>
    </div>
    <p class="stats-note">Seats are estimated from each flight's airline and aircraft type; cargo flights count as none.${
      L.seats_total.flights - L.seats_total.known ? ` ${num(L.seats_total.flights - L.seats_total.known)} flyover${L.seats_total.flights - L.seats_total.known === 1 ? "" : "s"} of unknown type left out.` : ""}</p>
    <h2>Today by hour</h2><div class="hours">${bars}</div><div class="hours-axis">${axis}</div>
    <h2>Type collection</h2><div id="log-coll"></div>
    <div class="cols"><div>${recordsHtml("Records today", L.records_today)}</div><div>${recordsHtml("Records all time", L.records_all)}</div></div>
    <h2 style="margin-top:.9rem">Recent flyovers</h2>
    ${L.recent.map((s) => `<div class="rec"><span><b>${esc(s.flight || s.callsign || s.reg || s.hex)}</b> <span class="dim">${esc(s.type || "")} ${s.origin ? esc(s.origin) + " → " + esc(s.dest) : ""}</span> ${badges(s.badges)}</span>
      <span class="dim">${new Date(s.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, ${num(s.alt_ft)} ft, ${s.min_dist_nm.toFixed(1)} nm from home</span></div>`).join("")}
    ${fa && fa.enabled ? `<h2 style="margin-top:1.4rem">Flight data usage</h2><div class="usage">${budgetLine(fa)}</div>` : ""}`;
  $("log-coll").replaceWith(collection(L.types));
}

// The type collection: a drawing of every type logged, with how often and since when. Its
// drawings are kept between the logbook's refreshes and rebuilt only when the list changes.
let coll = { key: null, el: null };
function collection(types) {
  const key = types.map((t) => `${t.type}:${t.n}:${t.model || ""}`).join(",");
  if (coll.key === key && coll.el) return coll.el;
  const el = document.createElement("div");
  el.className = "collection";
  const day = (ts) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
  };
  el.innerHTML = types.map((t) => {
    const info = typeInfo(t);
    return `<figure class="coll${drawn(info) ? "" : " unknown"}"><div class="sil-box">${drawn(info) ? plate(info, { dim: false }) : `<code>${esc(t.type)}</code>`}</div>
      <figcaption><div><code>${esc(t.type)}</code> <span>${esc(shortType(t.name) || "")}</span></div>
      <div class="dim"><b>${num(t.n)}</b> ${t.n === 1 ? "sighting" : "sightings"}${t.first ? `, since ${day(t.first)}` : ""}</div></figcaption></figure>`;
  }).join("") || '<span class="dim">Nothing yet. The first flyover starts the collection.</span>';
  coll = { key, el };
  return el;
}
