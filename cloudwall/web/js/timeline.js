// The next few minutes on one line of time: who comes over the house, who lands and when, and a
// medical helicopter reaching its hospital. Simple says the next three in words with a countdown
// each ("0:25 AS 2162 over the house"); Detailed draws them along a ten-minute axis that moves
// every second, each event a mark (its colour, its landing number, the medical cross) and a label.
// The countdowns tick with the rest of the page (tickCounts); the axis moves with tickTimeline.
import { esc, since } from "./util.js";
import { catIcon, medIcon, flightName, overheadSoon, picture } from "./situation.js";

const SPAN_S = 600;              // the axis: now to ten minutes ahead
const AHEAD_S = 900;             // the line: anything in the next fifteen

// What happens next, soonest first: {t (seconds from the state's time), kind, a, text}
// name: how each aircraft is called (the wall panel's Simple says "Alaska 2162", as the Map view does)
export function events(state, name = flightName) {
  const out = [], here = state.airport.iata, t0 = since(state);
  for (const a of picture(state).air) {
    const who = name(a);
    if (overheadSoon(a, state)) out.push({ t: a.cpa_s, kind: "over", a, text: `${who} over the house`, short: `${who} overhead` });
    if (a.activity === "arr" && a.seq && a.lands_s != null) out.push({ t: a.lands_s, kind: "land", a, text: `${who} lands at ${here}`, short: `${who} lands` });
    const h = a.hospital;
    if (h && h.state !== "left" && h.eta_s != null) out.push({ t: h.eta_s, kind: "hosp", a, text: `${who} at ${h.short}` });
  }
  return out.filter((e) => e.t - t0 > -5 && e.t - t0 < AHEAD_S).sort((x, y) => x.t - y.t);
}

const mark = (e) => (e.kind === "land" ? `<span class="seq">${e.a.seq}</span>` : e.kind === "hosp" ? medIcon(15) : catIcon(e.a.activity || "pass", e.a, 15));

// Simple: "Next  0:25 AS 2162 over the house · 1:40 AS 2162 lands at PDX · 4:10 LIFE3 at Portland Adventist"
// skip: an aircraft whose own pass over the house is already said elsewhere (the wall panel's card);
// short: each event in its fewest words ("AS 67 overhead", "AS 2162 lands"), for the wall panel
export function lineHtml(state, max = 3, { skip = null, short = false, name = flightName } = {}) {
  const ev = events(state, name).filter((e) => !(skip && e.kind === "over" && e.a.hex === skip)).slice(0, max), t0 = since(state);
  if (!ev.length) return "";
  return `<div class="tl line"><span class="tl-k">Next</span>${ev.map((e) =>
    `<span class="tl-e" data-hex="${esc(e.a.hex)}">${mark(e)}<b data-until="${e.t}">${until(e.t - t0)}</b> ${esc(short ? e.short || e.text : e.text)}</span>`).join("")}</div>`;
}

// Detailed: the ten-minute axis
export function axisHtml(state) {
  const t0 = since(state), ev = events(state).filter((e) => e.t - t0 <= SPAN_S);
  // nothing due: a quiet line, not an empty ruler across the screen
  if (!ev.length) return `<div class="tl quiet">Nothing due over the house or landing in the next ten minutes</div>`;
  const ticks = [0, 2, 4, 6, 8, 10].map((m) => `<span class="tl-tick${m ? (m === 10 ? " end" : "") : " start"}" style="left:${m * 10}%">${m ? (m === 10 ? "10 min" : m) : "now"}</span>`).join("");
  // each mark drawn where it stands, so a redraw doesn't slide it in from the start
  const at = (e) => (Math.max(0, Math.min(1, (e.t - t0) / SPAN_S)) * 100).toFixed(2);
  return `<div class="tl axis" aria-label="The next ten minutes"><div class="tl-track">${ticks}${ev.map((e) =>
    `<span class="tl-ev k-${e.kind}" style="left:${at(e)}%" data-at="${e.t}" data-hex="${esc(e.a.hex)}" title="${esc(e.text)}"><i class="tl-mk">${mark(e)}</i><span class="tl-lb">${esc(e.short || e.text)}</span></span>`).join("")}` +
    `</div></div>`;
}

const until = (s) => (s < 12 ? "now" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

// Move the axis's marks to where they stand now, and lay out their labels in two rows so none
// overlaps another: a label that would run off the end turns to sit left of its mark; one with no
// room in either row is hidden, still measured (its mark keeps the title).
export function tickTimeline(root, state) {
  for (const track of root.querySelectorAll(".tl.axis .tl-track")) {
    const w = track.clientWidth, t0 = since(state), ends = [-1e9, -1e9];
    if (!w) continue;
    for (const ev of track.querySelectorAll(".tl-ev")) {
      const x = Math.max(0, Math.min(1, (+ev.dataset.at - t0) / SPAN_S)) * w;
      ev.style.left = `${x.toFixed(1)}px`;
      const lb = ev.querySelector(".tl-lb"), lw = lb.offsetWidth + 6;
      const flip = x + lw > w, x0 = flip ? x - lw : x, x1 = flip ? x : x + lw;
      const lane = ends[0] < x0 ? 0 : ends[1] < x0 ? 1 : -1;
      ev.classList.toggle("flip", flip);
      ev.classList.toggle("lane1", lane === 1);
      ev.classList.toggle("nolabel", lane < 0);
      if (lane >= 0) ends[lane] = x1;
    }
  }
}
