// About a type: the panel a tap on an aircraft's drawing or on a Logbook type opens (data from /api/type).
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

const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${count(n)} times`);

// A year outside the production run by more than one (the feed's year is sometimes wrong) says only the year.
export function builtLine(year, production) {
  if (!year) return "";
  const who = `It was built in ${year}`;
  const [first, last] = production || [];
  if (!first || year < first - 1 || (last && year > last + 1)) return `${who}.`;
  if (last && year >= last && last - first >= 3) return `${who}, in the last year the type was made.`;
  const into = year - first;
  if (into <= 0) return `${who}, among the first of the type delivered.`;
  return `${who}, ${count(into)} year${into === 1 ? "" : "s"} into the type's production run, which ${last ? `ended in ${last}` : "is still going"}.`;
}

// the pass it is on now may not be logged yet
const firstTime = (af, now) => !af.n || (af.n === 1 && now - af.first < 3600);
export function airframeLine(af, now = Date.now() / 1000) {
  if (!af) return "";
  if (firstTime(af, now)) return "This is its first time over the house.";
  return af.n === 1 ? `It has come over the house once before, on ${day(af.first)}.` : `It has been logged over the house ${times(af.n)}, first on ${day(af.first)}.`;
}

export function typeLines(seen) {
  if (!seen || !seen.n) return ["None has been logged over the house before."];
  if (seen.n === 1) return [`One has been logged over the house, on ${day(seen.first)}.`];
  const frames = seen.airframes > 1 ? `, by ${count(seen.airframes)} different aircraft` : seen.airframes === 1 ? ", the same aircraft each time" : "";
  const rank = seen.rank === 1 ? ": the most common type here" : seen.rank <= 10 ? `: the ${ordinal(seen.rank)} most common type here` : "";
  const out = [`Logged over the house ${times(seen.n)} since ${day(seen.first)}${frames}${rank}.`];
  // a share of the times logged, not of the aircraft
  const top = (seen.airlines || [])[0], share = top ? top.n / seen.n : 0, name = (a) => a.name || a.icao;
  const who = seen.n < 5 ? "" : share === 1 ? `${name(top)} flew every one of those flights.` : share >= 0.5 ? `${name(top)} flew ${Math.round(share * 100)}% of those flights.`
    : seen.airlines.length > 1 ? `${seen.airlines.slice(0, 2).map(name).join(" and ")} flew the most of those flights.` : "";
  if (who) out.push(who);
  return out;
}

export function hereGroups(d, ctx = {}, now = Date.now() / 1000) {
  const af = d.airframe, seen = d.seen || {};
  const one = `This aircraft${ctx.reg ? `, ${ctx.reg}` : ""}`, built = builtLine(ctx.year, d.production);
  // the first of its type, on its first visit: one line says both
  if (af && firstTime(af, now) && (seen.n || 0) <= 1) {
    return [{ head: one, lines: [built, "This is its first time over the house, and it is the first of its type logged here."].filter(Boolean) }];
  }
  const own = [built, airframeLine(af, now)].filter(Boolean);
  return [...(own.length ? [{ head: one, lines: own }] : []), { head: own.length ? "The type as a whole" : "Over the house", lines: typeLines(seen) }];
}

const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

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
  const here = hereGroups(d, ctx).map((g) => `<h3 class="label">${esc(g.head)}</h3>${g.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`).join("");
  const rows = factRows(d, ctx);
  return `
    <div class="ab-head"><span class="label"><code class="ab-code">${esc(d.type)}</code>${d.family && d.family !== name ? ` · ${esc(d.family.replace(/ family$/i, ""))} family` : ""}</span>
      <button class="ab-close" id="ab-close" aria-label="Close">×</button></div>
    <h2 class="ab-name" id="ab-title">${esc(name)}</h2>
    <div class="ab-draw sil-box">${drawingHtml(d, ctx)}</div>
    ${d.text.length ? `<div class="ab-text">${d.text.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
    ${rows.length ? `<dl class="facts ab-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    <div class="ab-here">${here}</div>`;
}

let asked = 0;
// ctx: what the opener knows of the aircraft tapped (hex, reg, year, seats, airline, name, model; all optional).
export async function openAbout(type, ctx = {}) {
  const dlg = $("about"), n = ++asked;
  if (!dlg || !type) return;
  dlg.innerHTML = `<div class="ab-in"><div class="ab-head"><span class="label"><code class="ab-code">${esc(type)}</code></span>
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
    : `<div class="ab-head"><span class="label"><code class="ab-code">${esc(type)}</code></span><button class="ab-close" id="ab-close" aria-label="Close">×</button></div>
       <h2 class="ab-name" id="ab-title">${esc(ctx.name || type)}</h2><p class="dim">CloudWall isn't answering. Try again in a moment.</p>`;
  dlg.querySelector(".ab-in").scrollTop = 0;
}

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
