// All settings: for reviewing. The setup said in a paragraph first (a sentence that reads wrong is
// the place to click); then every setting, one line each, grouped by the page it belongs to: its
// value in words, its default beside it when you've set your own, whether it waits for a restart.
// A line opens to change the setting there, with its explanation; "see it on its page" goes to the
// picture it's part of. Filters narrow it to what you've set, what waits, and the lines in the
// settings file that do nothing (with a fix for each).
import { el, esc, S, setting, call, toast, loadSettings, plural, on, sky, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { head } from "../parts.js";
import { any } from "../controls.js";
import { say, setup, APART } from "../words.js";

const ICONS = { receiver: "receiver", radio: "radio", places: "places", positions: "feeds", routes: "routes", look: "look", access: "access", safekeeping: "safekeeping", health: "problems" };
const PAGE_NAMES = Object.fromEntries(Object.entries(ICONS).map(([p, i]) => [p, [TITLES[p], i]]));
let filter = "all";

/** Every setting, as [page, [setting...]] in the board's order. */
function byPage() {
  const out = {};
  for (const sec of S.settings.sections) for (const s of sec.settings) {
    const id = `${sec.name}.${s.key}`, page = APART[id] || sec.page;
    (out[page] = out[page] || []).push(setting(sec.name, s.key));
  }
  return Object.keys(PAGE_NAMES).filter((p) => out[p]).map((p) => [p, out[p]]);
}

function rowHtml(st) {
  const id = `${st.section}.${st.key}`, mine = st.changed && !st.secret && st.default !== null && st.default !== undefined;
  const plainDefault = st.default === "" || (Array.isArray(st.default) && !st.default.length);
  return `<li class="row ${mine ? "mine" : ""} ${st.waiting ? "waiting" : ""}" data-row="${esc(id)}" data-text="${esc(`${st.label} ${st.sectionLabel} ${st.help} ${id} ${say(st)}`.toLowerCase())}">
    <button type="button" class="row-main" aria-expanded="false">
      <span class="row-label">${esc(st.label)}<code class="row-key">[${esc(st.section)}] ${esc(st.key)}</code></span>
      <span class="row-val">${esc(say(st))}</span>
      <span class="row-flags">${mine && !plainDefault ? `<span class="row-def" title="You've set your own">default ${esc(say(st, st.default))}</span>` : mine ? `<span class="row-def">set by you</span>` : ""}${st.waiting ? `<span class="flag wait" title="CloudWall is running with ${esc(say(st, st.running))} until it restarts">after a restart</span>` : ""}</span>
      ${icon("down", "row-chev")}
    </button>
    <div class="row-edit" hidden></div></li>`;
}

/** The settings file's lines that do nothing, and the ones CloudWall couldn't use, each with its fix. */
function strays(page) {
  const list = S.settings.strays || [], out = S.settings.left_out || [];
  if (!list.length && !out.length) return null;
  const box = el(`<section class="strays"><header>${icon("problems")}<div><h2>${plural(list.length + out.length, "line")} in the settings file ${list.length + out.length === 1 ? "does" : "do"} nothing</h2>
    <p>CloudWall goes on without ${list.length + out.length === 1 ? "it" : "them"}, using the defaults; ${list.length + out.length === 1 ? "it was" : "they were"} most likely meant to change something.</p></div></header>
    <ul>${list.map((x, i) => `<li><code>[${esc(x.section)}] ${esc(x.key)} = ${esc(JSON.stringify(x.value))}</code>
      <span>${x.belongs ? `belongs under <b>[${esc(x.belongs)}]</b>, which is set to ${esc(say(setting(x.belongs, x.key) || { section: x.belongs, key: x.key }, setting(x.belongs, x.key)?.value))}` : "isn't a setting CloudWall knows: it may be left from an older version"}</span>
      <span class="stray-acts">${x.belongs ? `<button class="btn small" data-i="${i}" data-act="move">Move it to [${esc(x.belongs)}]</button>` : ""}<button class="btn small quiet" data-i="${i}" data-act="remove">Take it out</button></span></li>`).join("")}
    ${out.map((t) => { const m = /^\[(\w+)\] (\w+)/.exec(t); return `<li><code>${esc(t.replace(/: left out.*/, ""))}</code><span>left out: ${esc(t.replace(/.*: left out, /, ""))}</span>${m ? `<span class="stray-acts"><a class="btn small quiet" href="#settings/${esc(m[1])}.${esc(m[2])}">Set it again</a></span>` : ""}</li>`; }).join("")}</ul></section>`);
  box.onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const x = list[+b.dataset.i];
    b.disabled = true;
    try {
      const got = await call("tidy", { section: x.section, key: x.key, action: b.dataset.act });
      toast(got.said);
      await loadSettings();
      page.redraw();
    } catch (err) { if (err.message !== "signed out") toast(err.message, true); b.disabled = false; }
  };
  return box;
}

/** A page's settings under their sections' names (Flightradar24 and FlightAware both have an API key). */
function sections(items) {
  const by = [];
  for (const st of items) {
    let g = by.find((x) => x[0] === st.sectionLabel);
    if (!g) by.push(g = [st.sectionLabel, []]);
    g[1].push(st);
  }
  return by.map(([label, list]) => `<div class="review-sec">${by.length > 1 ? `<h3>${esc(label)}</h3>` : ""}<ul>${list.map(rowHtml).join("")}</ul></div>`).join("");
}

export default {
  id: "settings", get title() { return TITLES.settings; }, icon: "list",
  async draw(page) {
    if (!S.sky) await sky();             // (the airport's name, for the setup in words)
    page.redraw = async () => { const fresh = el(`<div class="page page-settings"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const groups = byPage(), all = groups.flatMap(([, l]) => l);
    const mine = all.filter((st) => st.changed && !st.secret && st.default !== null && st.default !== undefined), wait = all.filter((st) => st.waiting);
    const odd = (S.settings.strays || []).length + (S.settings.left_out || []).length;
    page.append(head(TITLES.settings, `Every setting with its value, its default where you've changed it, and what's waiting for a restart. ${S.settings.file ? `File: <code>${esc(S.settings.file)}</code>` : "Nothing saved yet: these are the defaults."}`));

    page.append(el(`<section class="setup-said"><h2>Setup</h2>${setup()}<p class="dim small">Underlined values open their setting.</p></section>`));
    const st = strays(page);
    if (st) page.append(st);

    const bar = el(`<div class="review-bar">
      <label class="find-wrap">${icon("positions")}<input type="search" class="find" placeholder="Find a setting" aria-label="Find a setting"></label>
      <div class="seg" role="radiogroup" aria-label="Show">
        ${[["all", `All ${all.length}`], ["mine", `Set by you ${mine.length}`], ["wait", `Waiting ${wait.length}`]].map(([v, l]) => `<button type="button" role="radio" data-f="${v}" aria-checked="${v === filter}">${l}</button>`).join("")}
      </div></div>`);
    page.append(bar);
    const list = el(`<div class="review">${groups.map(([p, items]) => `<section class="review-page" data-page="${p}">
        <header><h2>${icon(PAGE_NAMES[p][1])} ${esc(PAGE_NAMES[p][0])}</h2><a href="#${p}">Open the page</a></header>
        ${sections(items)}</section>`).join("")}
      <p class="review-none dim" hidden></p></div>`);
    page.append(list);

    const apply = () => {
      const q = bar.querySelector("input").value.toLowerCase().trim();
      let shown = 0;
      list.querySelectorAll(".review-page").forEach((g) => {
        let any = 0;
        g.querySelectorAll(".review-sec").forEach((sec) => {
          let here = 0;
          sec.querySelectorAll(".row").forEach((r) => {
            const hit = (!q || r.dataset.text.includes(q)) && (filter === "all" || (filter === "mine" && r.classList.contains("mine")) || (filter === "wait" && r.classList.contains("waiting")));
            r.hidden = !hit; here += hit ? 1 : 0;
          });
          sec.hidden = !here; any += here;
        });
        g.hidden = !any; shown += any;
      });
      list.querySelector(".review-none").hidden = !!shown;
      list.querySelector(".review-none").textContent = filter === "mine" && !q ? "Every setting is at its default." : filter === "wait" && !q ? "Nothing is waiting for a restart: CloudWall is running with every setting as saved." : "No setting by that name.";
    };
    bar.querySelector("input").oninput = apply;
    bar.querySelector(".seg").onclick = (e) => {
      const b = e.target.closest("[data-f]");
      if (!b) return;
      filter = b.dataset.f;
      bar.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      apply();
    };
    // a line opens to change its setting there, its explanation open; one at a time
    list.onclick = (e) => {
      const btn = e.target.closest(".row-main");
      if (!btn) return;
      const row = btn.closest(".row"), edit = row.querySelector(".row-edit"), open = edit.hidden;
      list.querySelectorAll(".row-edit:not([hidden])").forEach((x) => { x.hidden = true; x.previousElementSibling.setAttribute("aria-expanded", "false"); x.closest(".row").classList.remove("open"); });
      if (!open) return;
      const [section, key] = row.dataset.row.split(".");
      if (!edit.firstChild) {
        const c = any(section, key, { cls: "in-row" });
        c.classList.add("helping");
        const p = APART[row.dataset.row] || setting(section, key).page;
        edit.append(c, el(`<a class="row-go" href="#${p}/${row.dataset.row}">See it on ${esc(PAGE_NAMES[p]?.[0] || p)}</a>`));
      }
      edit.hidden = false; btn.setAttribute("aria-expanded", "true"); row.classList.add("open");
    };
    apply();

    // when a setting is saved (here or by Undo), its line says so
    const repaint = () => {
      if (!list.isConnected) return;
      list.querySelectorAll(".row").forEach((r) => {
        const [section, key] = r.dataset.row.split("."), now = setting(section, key);
        const fresh = el(rowHtml(now));
        r.querySelector(".row-val").textContent = fresh.querySelector(".row-val").textContent;
        r.querySelector(".row-flags").innerHTML = fresh.querySelector(".row-flags").innerHTML;
        r.className = fresh.className + (r.classList.contains("open") ? " open" : "");
      });
      const said = page.querySelector(".setup-said");
      if (said) said.innerHTML = `<h2>Setup</h2>${setup()}<p class="dim small">Underlined values open their setting.</p>`;
    };
    on("settings", repaint);

    // #settings/<section>.<key> (from a "set it again" link): that line, open
    const target = (location.hash.split("/")[1] || "");
    if (target) requestAnimationFrame(() => list.querySelector(`[data-row="${CSS.escape(target)}"] .row-main`)?.click());
  },
};
