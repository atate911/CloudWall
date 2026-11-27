// Finding the right place: one box at the top of the rail. Empty, it offers what people usually come
// to do; typed into, it finds any setting by its name, what it does or its name in the file, and
// any of those jobs; chosen, it opens the page, opens the shade the setting is under, and shows it.
import { el, esc, S } from "./core.js";
import { icon } from "./icons.js";
import { APART } from "./words.js";

// each section's settings are on its page (core/schema.py says which); a few live apart (words.js)
// what people come to do, said the way they'd say it
const TASKS = [
  ["Change what the wall panel shows", "look", "kiosk.view", "panel kiosk screen card radar layout"],
  ["Dim the wall panel at night", "look", "kiosk.quiet", "quiet hours sleep night dark clock"],
  ["Change the map under the radar", "look", "map.style", "map style satellite chart sectional dark light"],
  ["Make the tracking circle bigger or smaller", "places", "tracking.radius_nm", "radius range distance how far"],
  ["Change what counts as overhead", "places", "tracking.overhead_nm", "overhead flyover logged close"],
  ["Move the house", "places", "", "location position coordinates latitude longitude address"],
  ["Watch another place", "places", "", "cabin second place add location"],
  ["Connect your own receiver", "receiver", "", "antenna adsb pi tunnel dongle"],
  ["See the receiver's live map", "receiver", "", "tar1090 skyaware map flightaware"],
  ["Add or reorder position feeds", "positions", "source.urls", "feed adsb.fi adsb.lol airplanes.live source"],
  ["Combine your receiver with the public feeds", "positions", "source.merge", "merge combine"],
  ["Keep logging with no screen open", "positions", "tracking.when_idle", "idle pause log unwatched"],
  ["Connect Flightradar24 for exact routes", "routes", "flightradar24.api_key", "paid route key api credits fr24"],
  ["See how much of the allowance is left", "routes", "", "credits budget spend allowance month"],
  ["Make a private link for the wall", "access", "", "key password link share secret"],
  ["Change the owner's password", "access", "", "password sign in owner lock"],
  ["Back up now", "safekeeping", "", "backup copy save download restore"],
  ["Get alerts on your phone", "health", "health.notify_url", "ntfy notify alert phone push webhook"],
  ["See what went wrong lately", "health", "", "problems incidents history errors"],
  ["Review every setting", "settings", "", "all settings review list changed defaults file config"],
  ["See what's waiting for a restart", "settings", "", "pending restart saved changes waiting"],
  ["Read the log", "server", "", "log journal messages errors"],
  ["Restart CloudWall", "server", "", "restart reboot service"],
];

function entries() {
  const out = TASKS.map(([label, page, target, words]) => ({ label, page, target, words: `${label} ${words}`.toLowerCase(), kind: "task" }));
  for (const sec of S.settings?.sections || []) for (const s of sec.settings) {
    const id = `${sec.name}.${s.key}`;
    out.push({ label: s.label, sub: sec.label, page: APART[id] || sec.page || "server", target: id, kind: "setting",
               words: `${s.label} ${sec.label} ${s.help} ${sec.name} ${s.key}`.toLowerCase() });
  }
  return out;
}

const PAGES = { settings: "All settings", places: "The house", positions: "Position feeds", routes: "Route lookups", look: "The wall", receiver: "Your receiver", access: "Who can see it", safekeeping: "Safekeeping", health: "Problems and alerts", server: "This server" };

export function finder() {
  const box = el(`<div class="finder" role="search">
    <label class="finder-box">${icon("positions")}<input type="search" placeholder="Find a setting or a job" aria-label="Find a setting or a job" autocomplete="off" aria-controls="finder-list" aria-expanded="false"></label>
    <ul class="finder-list" id="finder-list" role="listbox" hidden></ul></div>`);
  const input = box.querySelector("input"), list = box.querySelector("ul");
  let hits = [], at = 0;
  const paint = () => {
    const q = input.value.toLowerCase().trim();
    const all = entries();
    if (!q) hits = all.filter((e) => e.kind === "task").slice(0, 8);
    else {
      const words = q.split(/\s+/);
      hits = all.map((e) => {
        let score = 0;
        for (const w of words) { if (!e.words.includes(w)) return null; score += e.label.toLowerCase().includes(w) ? 3 : 1; }
        return [score + (e.kind === "task" ? 1 : 0), e];
      }).filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, 9).map((x) => x[1]);
    }
    at = Math.min(at, Math.max(0, hits.length - 1));
    list.innerHTML = (q ? "" : `<li class="finder-head">What people come here to do</li>`) + (hits.map((e, i) => `<li role="option" data-i="${i}" aria-selected="${i === at}">
      ${icon(e.kind === "task" ? "check" : "info")}<span><b>${esc(e.label)}</b><small>${esc(e.sub ? `${e.sub}, on ${PAGES[e.page] || e.page}` : PAGES[e.page] || e.page)}</small></span></li>`).join("") || `<li class="finder-none">Nothing by that name. Every setting is listed on All settings.</li>`);
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  const choose = (e) => {
    if (!e) return;
    input.value = ""; list.hidden = true; input.blur();
    location.hash = e.target ? `#${e.page}/${e.target}` : `#${e.page}`;
  };
  input.onfocus = paint;
  input.oninput = () => { at = 0; paint(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(hits.length - 1, at + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[at]); }
    else if (e.key === "Escape") { list.hidden = true; input.blur(); }
  };
  list.onpointerdown = (e) => { const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); choose(hits[+li.dataset.i]); } };
  input.onblur = () => setTimeout(() => { list.hidden = true; input.setAttribute("aria-expanded", "false"); }, 120);
  // "/" anywhere goes to the box, as in most places with a search
  addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); } });
  return box;
}

/** After a page is drawn: show the setting the address names (#look/kiosk.quiet), opening its shade. */
export function reveal(target) {
  if (!target) return;
  let node = document.querySelector(`[data-setting="${CSS.escape(target)}"]`);
  if (!node) return;
  for (let d = node.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
  node.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  node.classList.add("found");
  setTimeout(() => node.classList.remove("found"), 2600);
  node.querySelector("input, button[role=switch], button[role=radio], button.txt-show, .set-body button")?.focus({ preventScroll: true });
}
