// About a type: the panel a tap on an aircraft's drawing (on the flight card) or on a type in the
// Logbook's collection opens. Its write-up and facts come from the server (/api/type, from the
// files in cloudwall/data/types/), and so does what the logbook knows of the type and of the
// airframe tapped; this file lays them out and words what is worked out from them.
import { $, esc, num, seatWords, api } from "./util.js";
import { plate, kindPlate, drawn, typeInfo } from "./plate.js";

// The FAA's wake categories (JO 7110.126), as a controller would say them
const WAKE = { A: "super", B: "upper heavy", C: "lower heavy", D: "non-pairwise heavy", E: "the 757's own",
  F: "upper large", G: "lower large", H: "upper small", I: "lower small" };
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n) => (n <= 10 ? WORDS[n] : num(n));
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
// "3 March", or "March 2025" for another year
function day(ts) {
  const d = new Date(ts * 1000);
  return d.getFullYear() === new Date().getFullYear()
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Where this airframe's build year falls in its type's deliveries: "built in 2004, in the last year
// of production". A year outside the run by more than one (the feed's year is sometimes wrong, or
// the type code covers another model) says only the year.
export function builtLine(year, production, reg) {
  if (!year) return "";
  const who = `${reg ? `This one, ${reg},` : "This one"} was built in ${year}`;
  const [first, last] = production || [];
  if (!first || year < first - 1 || (last && year > last + 1)) return `${who}.`;
  if (last && year >= last && last - first >= 3) return `${who}, in the last year of production.`;
  const into = year - first;
  if (into <= 0) return `${who}, among the first delivered.`;
  return `${who}, ${count(into)} year${into === 1 ? "" : "s"} into ${last ? `a production run that ended in ${last}` : "a production run that is still going"}.`;
}

// This airframe over the house, from the logbook (the pass it is on now may not be logged yet)
const firstTime = (af, now) => !af.n || (af.n === 1 && now - af.first < 3600);
export function airframeLine(af, now = Date.now() / 1000) {
  if (!af) return "";
  if (firstTime(af, now)) return "Its first time over the house.";
  return af.n === 1 ? `Logged over the house once before, on ${day(af.first)}.` : `Logged over the house ${count(af.n)} times, first on ${day(af.first)}.`;
}

// The type over the house: how often, how it ranks, who flies it here
export function typeLines(seen) {
  if (!seen || !seen.n) return ["Not logged over the house before."];
  if (seen.n === 1) return [`Logged over the house once, on ${day(seen.first)}.`];
  const out = [`Logged ${count(seen.n)} times over the house since ${day(seen.first)}` +
    (seen.rank === 1 ? ", the most common type here." : seen.rank <= 10 ? `, the ${ordinal(seen.rank)} most common type here.` : ".")];
  // who flies it here, once there are enough to say
  const top = (seen.airlines || [])[0], share = top ? top.n / seen.n : 0, name = (a) => a.name || a.icao;
  const who = seen.n < 5 ? "" : share === 1 ? `All flown here by ${name(top)}` : share >= 0.5 ? `Flown here mostly by ${name(top)} (${Math.round(share * 100)}%)`
    : seen.airlines.length > 1 ? `Flown here by ${seen.airlines.slice(0, 2).map(name).join(" and ")}, among others` : "";
  const frames = seen.airframes > 1 ? `${count(seen.airframes)} airframes in all` : "";
  if (who || frames) out.push([who, frames].filter(Boolean).join(", ") + ".");
  return out;
}

// What the logbook says: of this airframe (when the panel was opened for one) and of its type
export function hereLines(d, now = Date.now() / 1000) {
  const af = d.airframe, seen = d.seen || {};
  // the first of its type, on its first visit: one line says both
  if (af && firstTime(af, now) && (seen.n || 0) <= 1) return ["Its first time over the house, and the first of its type."];
  return [airframeLine(af, now), ...typeLines(seen)].filter(Boolean);
}

const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

// The facts strip: the entry's own, then seats (this airline's layout when the airframe is known,
// else the type's usual) and the wake category
function factRows(d, ctx) {
  const rows = d.facts.slice(), s = ctx.seats && ctx.seats.basis !== "cargo" ? ctx.seats : d.seats;
  if (ctx.seats && ctx.seats.basis === "cargo") rows.push(["Seats", "Cargo, no passengers"]);
  else if (s) rows.push(["Seats", seatWords(s) + (s === ctx.seats && s.basis === "airline" && ctx.airline ? ` in ${possessive(ctx.airline)} layout` : "")]);
  if (d.cwt) rows.push(["Wake category", `${d.cwt}, ${WAKE[d.cwt] || ""}`.replace(/, $/, "")]);
  return rows;
}

function drawingHtml(d, ctx) {
  const info = typeInfo({ ...d, model: ctx.model, type_name: d.name || ctx.name });
  if (drawn(info)) return plate(info, { share: 0.92 });
  return d.icon ? kindPlate(d.icon) : "";
}

function body(d, ctx) {
  const name = d.name || ctx.name || d.type;
  const lines = [builtLine(ctx.year, d.production, ctx.reg), ...hereLines(d)].filter(Boolean);
  const rows = factRows(d, ctx);
  return `
    <div class="ab-head"><span class="label">${esc(d.type)}${d.family && d.family !== name ? ` · ${esc(d.family)} family` : ""}</span>
      <button class="ab-close" id="ab-close" aria-label="Close">×</button></div>
    <h2 class="ab-name" id="ab-title">${esc(name)}</h2>
    <div class="ab-draw sil-box">${drawingHtml(d, ctx)}</div>
    ${d.text.length ? `<div class="ab-text">${d.text.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
    ${rows.length ? `<dl class="facts ab-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    <div class="ab-here">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
}

let asked = 0;
// Open the panel for a type. ctx, what the opener knows of the aircraft tapped: hex, reg, year,
// seats, airline, name, model (all optional: a type in the logbook has only its name).
export async function openAbout(type, ctx = {}) {
  const dlg = $("about"), n = ++asked;
  if (!dlg || !type) return;
  dlg.innerHTML = `<div class="ab-in"><div class="ab-head"><span class="label">${esc(type)}</span>
    <button class="ab-close" id="ab-close" aria-label="Close">×</button></div>
    <h2 class="ab-name" id="ab-title">${esc(ctx.name || type)}</h2><p class="dim">Looking it up…</p></div>`;
  if (!dlg.open) dlg.showModal();
  let d = null;
  try {
    const r = await api(`api/type?type=${encodeURIComponent(type)}${ctx.hex ? `&hex=${encodeURIComponent(ctx.hex)}` : ""}`);
    if (r.ok) d = await r.json();
  } catch (e) { /* the server isn't answering: say so below */ }
  if (n !== asked || !dlg.open) return;                  // closed, or another type opened meanwhile
  dlg.querySelector(".ab-in").innerHTML = d ? body(d, ctx)
    : `<div class="ab-head"><span class="label">${esc(type)}</span><button class="ab-close" id="ab-close" aria-label="Close">×</button></div>
       <h2 class="ab-name" id="ab-title">${esc(ctx.name || type)}</h2><p class="dim">CloudWall isn't answering. Try again in a moment.</p>`;
  dlg.querySelector(".ab-in").scrollTop = 0;
}

// What the flight card's aircraft record says of the airframe, for the panel
export const aboutContext = (a) => ({ hex: a.hex, reg: a.reg, year: a.year, seats: a.seats, airline: a.airline,
  name: a.type_name, model: a.model });

// Closed by its button, a tap on the dimmed page around it, or Escape (the browser's own)
const dlg = $("about");
if (dlg) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("#ab-close")) dlg.close();
  });
  dlg.addEventListener("close", () => { asked++; });
}
