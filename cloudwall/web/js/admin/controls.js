// The controls settings are changed with, each chosen for what its setting holds: a switch for on
// and off, pictures for a map style, cards for a choice of behaviour, a stepper for a distance, a
// slider for a share. Every one is drawn in the board's "yours to set" blue, saves itself the
// moment it's changed, says in a sentence what the value now means, and has its full explanation
// one tap away. A setting saved but not yet in use is marked until CloudWall restarts.
import { $, el, esc, setting, save, num, on } from "./core.js";
import { icon } from "./icons.js";

let serial = 0;

/** The frame every control sits in: its name, its explanation, its sentence, its state. A page with
 *  a control of its own (a calendar, a dial) puts it in one with `custom`: body.render() draws it
 *  from the setting, body.node.commit(value) saves. */
export function custom(section, key, opt, body) { return frame(section, key, opt, body); }
function frame(section, key, opt, body) {
  const s = setting(section, key);
  if (!s) return el(`<div class="set missing">[${esc(section)}] ${esc(key)}?</div>`);
  const id = `set-${section}-${key}-${++serial}`;
  const node = el(`<div class="set ${opt.cls || ""}" data-setting="${esc(section)}.${esc(key)}">
    <div class="set-head">
      <span class="set-label" id="${id}">${opt.labelHtml || esc(opt.label || s.label)}</span>
      <button class="set-info" type="button" aria-expanded="false" aria-controls="${id}-help" title="What this is">${icon("info")}<span class="sr">About ${esc(opt.label || s.label)}</span></button>
      <span class="set-wait" title="Saved. CloudWall uses it once it restarts.">after a restart</span>
    </div>
    <div class="set-body"></div>
    <p class="set-says"></p>
    <p class="set-error" role="alert" hidden></p>
    <div class="set-help" id="${id}-help" hidden></div>
  </div>`);
  node.labelId = id;
  const help = $(".set-help", node), info = $(".set-info", node);
  info.onclick = () => {
    const open = help.hidden;
    help.hidden = !open; info.setAttribute("aria-expanded", String(open));
    if (open) fillHelp(node, section, key, opt);
  };
  node.refresh = () => {
    const now = setting(section, key);
    node.classList.toggle("waiting", !!now.waiting);
    const says = typeof opt.says === "function" ? opt.says(now.value, now) : opt.says;
    $(".set-says", node).innerHTML = says || "";
    $(".set-says", node).hidden = !says;
    if (!help.hidden) fillHelp(node, section, key, opt);
  };
  /** Save a new value: the control shows it at once, and goes back if the server refuses it. */
  node.commit = async (v) => {
    const err = $(".set-error", node);
    err.hidden = true;
    node.classList.add("saving");
    try {
      await save(section, key, v);
      node.classList.remove("saving");
      node.classList.add("saved");
      setTimeout(() => node.classList.remove("saved"), 1400);
      opt.saved?.(setting(section, key).value);
    } catch (e) {
      node.classList.remove("saving");
      if (e.message === "signed out") return;
      err.textContent = e.message.replace(/^./, (c) => c.toUpperCase());
      err.hidden = false;
    }
    body.render?.();
    node.refresh();
  };
  $(".set-body", node).append(body);
  body.node = node;
  body.render?.();
  node.refresh();
  return node;
}

function fillHelp(node, section, key, opt) {
  const s = setting(section, key);
  const def = s.secret || s.default === null || s.default === undefined ? null : show(s, s.default);
  const bits = [`<p>${esc(opt.help || s.help)}</p>`];
  if (s.range) bits.push(`<p class="dim">From ${esc(show(s, s.range[0]))} to ${esc(show(s, s.range[1]))}.</p>`);
  if (s.costs) bits.push(`<p class="costs">Changing it: ${esc(s.costs)}.</p>`);
  if (s.waiting && !s.secret) bits.push(`<p class="dim">CloudWall is running with ${esc(show(s, s.running))} until it restarts.</p>`);
  bits.push(`<p class="help-foot"><span>In the settings file: <code>[${esc(section)}] ${esc(key)}</code>${def !== null ? `, ${esc(def)} unless set` : ""}</span>${def !== null && s.changed ? `<button class="link" type="button" data-default>Use ${esc(def)}</button>` : ""}</p>`);
  const help = $(".set-help", node);
  help.innerHTML = bits.join("");
  const d = $("[data-default]", help);
  if (d) d.onclick = () => node.commit(s.default);
}

/** A value said as a person would: 0.15 of a share is 15%, true is on, an empty value is "not set". */
export function show(s, v) {
  if (v === "" || v === null || v === undefined) return "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (s.unit === "share") return `${Math.round(v * 100)}%`;
  if (typeof v === "number" && s.unit) return `${num(v, 2)} ${s.unit}`;
  return String(v);
}

// -- the controls ---------------------------------------------------------------------------------

/** On and off. `on`/`off`: what each means, said under it. */
export function toggle(section, key, opt = {}) {
  const b = el(`<button class="switch" type="button" role="switch"><span class="knob"></span></button>`);
  b.render = () => { const v = !!setting(section, key).value; b.setAttribute("aria-checked", String(v)); };
  b.onclick = () => { const v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); opt.preview?.(v); b.node.commit(v); };
  const node = frame(section, key, { ...opt, cls: `is-toggle ${opt.cls || ""}`, says: opt.says || ((v) => (v ? opt.on : opt.off) || "") }, b);
  b.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A few short choices side by side. options: [[value, label]] */
export function segmented(section, key, opt = {}) {
  const s = setting(section, key);
  const options = opt.options || (s?.choices || []).map((c) => [c, c[0].toUpperCase() + c.slice(1)]);
  const wrap = el(`<div class="seg" role="radiogroup">${options.map(([v, label]) =>
    `<button type="button" role="radio" data-v="${esc(JSON.stringify(v))}">${label}</button>`).join("")}</div>`);
  wrap.render = () => {
    const cur = JSON.stringify(setting(section, key).value);
    wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === cur)));
  };
  wrap.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    const v = JSON.parse(b.dataset.v);
    wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    opt.preview?.(v);
    wrap.node.commit(v);
  };
  const node = frame(section, key, opt, wrap);
  wrap.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A choice of behaviour, each option a card saying what it does. options: [{value, title, body, icon}] */
export function cards(section, key, opt = {}) {
  const wrap = el(`<div class="cards" role="radiogroup">${opt.options.map((o) =>
    `<button type="button" role="radio" class="card-opt" data-v="${esc(JSON.stringify(o.value))}">
      ${o.icon ? icon(o.icon) : ""}<b>${esc(o.title)}</b><span>${esc(o.body)}</span></button>`).join("")}</div>`);
  wrap.render = () => {
    const cur = JSON.stringify(setting(section, key).value);
    wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === cur)));
  };
  wrap.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    const v = JSON.parse(b.dataset.v);
    opt.preview?.(v);
    wrap.node.commit(v);
  };
  const node = frame(section, key, { ...opt, cls: `is-cards ${opt.cls || ""}` }, wrap);
  wrap.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A choice made by looking: map styles, the wall panel's layouts. options: [{value, label, art}] where
 *  art is HTML (an <img> of the house's own map in that style, or a drawing). */
export function pictures(section, key, opt = {}) {
  const wrap = el(`<div class="pics" role="radiogroup">${opt.options.map((o) =>
    `<button type="button" role="radio" class="pic" data-v="${esc(JSON.stringify(o.value))}">
      <span class="pic-art">${o.art || ""}</span><span class="pic-label">${esc(o.label)}</span></button>`).join("")}</div>`);
  wrap.querySelectorAll("img").forEach((img) => { img.onerror = () => img.closest(".pic-art").classList.add("no-tile"); });
  wrap.render = () => {
    const cur = JSON.stringify(setting(section, key).value);
    wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === cur)));
  };
  wrap.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    const v = JSON.parse(b.dataset.v);
    opt.preview?.(v);
    wrap.node.commit(v);
  };
  const node = frame(section, key, { ...opt, cls: `is-pics ${opt.cls || ""}` }, wrap);
  wrap.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A share or strength, by sliding. `scale` turns the stored value into what's shown (0.45 → 45). */
export function slider(section, key, opt = {}) {
  const scale = opt.scale || 1, fmt = opt.format || ((v) => `${num(v, 2)}`);
  const wrap = el(`<div class="slide"><input type="range" min="${opt.min}" max="${opt.max}" step="${opt.step || 1}"><output></output></div>`);
  const input = wrap.querySelector("input"), out = wrap.querySelector("output");
  const paint = () => { out.textContent = fmt(+input.value); wrap.style.setProperty("--at", `${(input.value - opt.min) / (opt.max - opt.min) * 100}%`); };
  wrap.render = () => { input.value = (+setting(section, key).value || 0) * scale; paint(); };
  input.oninput = () => { paint(); opt.preview?.(+input.value / scale); };
  input.onchange = () => wrap.node.commit(+(+input.value / scale).toFixed(4));
  const node = frame(section, key, { ...opt, cls: `is-slide ${opt.cls || ""}` }, wrap);
  input.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A number with its unit, nudged up and down or typed. `presets`: values one tap away. */
export function stepper(section, key, opt = {}) {
  const s = setting(section, key);
  const unit = opt.unit ?? s?.unit ?? "", step = opt.step || 1;
  const wrap = el(`<div class="step">
    <button type="button" class="step-btn" data-d="-1" aria-label="Less">${icon("minus")}</button>
    <label class="step-val"><input inputmode="decimal" autocomplete="off"><span class="step-unit">${esc(opt.unitLabel || unit)}</span></label>
    <button type="button" class="step-btn" data-d="1" aria-label="More">${icon("plus")}</button>
    ${opt.presets ? `<span class="step-presets">${opt.presets.map(([v, l]) => `<button type="button" class="chip" data-p="${v}">${esc(l ?? v)}</button>`).join("")}</span>` : ""}
  </div>`);
  const input = wrap.querySelector("input");
  let timer = null;
  const clamp = (v) => Math.min(opt.max ?? Infinity, Math.max(opt.min ?? -Infinity, v));
  const shown = (v) => opt.format ? opt.format(v) : String(+(+v).toFixed(3));
  const later = (v) => { clearTimeout(timer); opt.preview?.(v); timer = setTimeout(() => wrap.node.commit(v), 650); };
  wrap.render = () => {
    const v = setting(section, key).value;
    if (document.activeElement !== input) input.value = shown(v);
    input.size = Math.max(2, input.value.length);
    wrap.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("on", +b.dataset.p === +v));
  };
  wrap.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const cur = parseFloat(input.value) || 0;
    const v = b.dataset.p !== undefined ? +b.dataset.p : clamp(+(Math.round((cur + step * +b.dataset.d) / step) * step).toFixed(4));
    input.value = shown(v); input.size = Math.max(2, input.value.length);
    wrap.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", +x.dataset.p === v));
    later(v);
  };
  input.oninput = () => { input.size = Math.max(2, input.value.length); };
  input.onchange = () => {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) { wrap.render(); return; }
    later(clamp(v));
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const v = clamp(+((parseFloat(input.value) || 0) + step * (e.key === "ArrowUp" ? 1 : -1)).toFixed(4));
      input.value = shown(v); later(v);
    }
    if (e.key === "Enter") input.blur();
  };
  const node = frame(section, key, { ...opt, cls: `is-step ${opt.cls || ""}` }, wrap);
  input.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** Words or an address: shown as itself, in blue, edited in place. */
export function text(section, key, opt = {}) {
  const wrap = el(`<div class="txt">
    <button type="button" class="txt-show"></button>
    <form class="txt-edit" hidden><input spellcheck="false" autocomplete="off"><button class="btn small">Save</button><button type="button" class="btn small quiet" data-cancel>Cancel</button></form>
  </div>`);
  const showB = wrap.querySelector(".txt-show"), form = wrap.querySelector("form"), input = form.querySelector("input");
  const s0 = setting(section, key);
  input.placeholder = opt.placeholder || s0?.example || "";
  if (opt.mono) wrap.classList.add("mono");
  wrap.render = () => {
    const v = setting(section, key).value;
    showB.innerHTML = v ? esc(opt.format ? opt.format(v) : v) : `<span class="unset">${esc(opt.empty || "Not set")}</span>`;
    showB.title = "Change it";
  };
  const edit = (on) => { form.hidden = !on; showB.hidden = on; if (on) { input.value = setting(section, key).value ?? ""; input.focus(); input.select(); } };
  showB.onclick = () => edit(true);
  form.querySelector("[data-cancel]").onclick = () => edit(false);
  input.onkeydown = (e) => { if (e.key === "Escape") edit(false); };
  form.onsubmit = async (e) => { e.preventDefault(); edit(false); await wrap.node.commit(input.value.trim()); };
  const node = frame(section, key, { ...opt, cls: `is-text ${opt.cls || ""}` }, wrap);
  input.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A key or a private address: never shown back, only whether one is saved. */
export function secret(section, key, opt = {}) {
  const wrap = el(`<div class="sec">
    <span class="sec-state"></span>
    <span class="sec-acts"></span>
    <form class="txt-edit" hidden><input type="password" autocomplete="new-password" spellcheck="false"><button class="btn small">Save</button><button type="button" class="btn small quiet" data-cancel>Cancel</button></form>
  </div>`);
  const stateEl = wrap.querySelector(".sec-state"), acts = wrap.querySelector(".sec-acts"), form = wrap.querySelector("form"), input = form.querySelector("input");
  input.placeholder = opt.placeholder || setting(section, key)?.example || "";
  const edit = (on) => { form.hidden = !on; acts.hidden = on; if (on) { input.value = ""; input.focus(); } };
  wrap.render = () => {
    const set = !!setting(section, key).value?.set;
    stateEl.innerHTML = set ? `<span class="dot ok"></span>${esc(opt.setLabel || "Saved")}` : `<span class="dot"></span>${esc(opt.unsetLabel || "Not set")}`;
    acts.innerHTML = "";
    const add = el(`<button type="button" class="btn small ${set ? "quiet" : ""}">${esc(set ? (opt.replace || "Replace") : (opt.add || "Add"))}</button>`);
    add.onclick = () => edit(true);
    acts.append(add);
    if (set && opt.removable !== false) {
      const rm = el(`<button type="button" class="btn small quiet">Remove</button>`);
      rm.onclick = () => { if (confirm(opt.removeAsk || "Remove it?")) wrap.node.commit(""); };
      acts.append(rm);
    }
  };
  form.querySelector("[data-cancel]").onclick = () => edit(false);
  form.onsubmit = async (e) => { e.preventDefault(); if (!input.value.trim()) return; edit(false); await wrap.node.commit(input.value.trim()); };
  const node = frame(section, key, { ...opt, cls: `is-secret ${opt.cls || ""}` }, wrap);
  input.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** Whatever control suits a setting's kind, for the list of every setting. */
export function any(section, key, opt = {}) {
  const s = setting(section, key);
  if (!s) return el(`<div></div>`);
  if (s.secret) return secret(section, key, opt);
  if (s.kind === "bool") return toggle(section, key, opt);
  if (s.kind === "choice") return s.choices.length <= 4 ? segmented(section, key, opt) : select(section, key, opt);
  if (s.kind === "number") return stepper(section, key, { step: s.unit === "share" ? 0.05 : 1, min: s.range?.[0], max: s.range?.[1], ...opt });
  if (s.kind === "list") return listText(section, key, opt);
  return text(section, key, opt);
}

/** Many choices, as a menu. */
export function select(section, key, opt = {}) {
  const s = setting(section, key);
  const sel = el(`<select class="pick">${(opt.options || s.choices.map((c) => [c, c])).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`);
  sel.render = () => { sel.value = setting(section, key).value; };
  sel.onchange = () => { opt.preview?.(sel.value); sel.node.commit(sel.value); };
  const node = frame(section, key, opt, sel);
  sel.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** A list, one to a line. */
function listText(section, key, opt = {}) {
  const wrap = el(`<form class="lst"><textarea rows="3" spellcheck="false"></textarea><button class="btn small">Save</button></form>`);
  const ta = wrap.querySelector("textarea");
  wrap.render = () => { ta.value = (setting(section, key).value || []).join("\n"); };
  wrap.onsubmit = (e) => { e.preventDefault(); wrap.node.commit(ta.value); };
  const node = frame(section, key, opt, wrap);
  ta.setAttribute("aria-labelledby", node.labelId);
  return node;
}

/** The rarely-needed settings, behind a shade whose cover says how they stand, so it seldom needs opening. */
export function shade(title, summary, children, opt = {}) {
  const d = el(`<details class="shade ${opt.cls || ""}"><summary><span class="shade-title">${esc(title)}</span><span class="shade-sum"></span>${icon("down", "shade-chev")}</summary><div class="shade-body"></div></details>`);
  const sum = d.querySelector(".shade-sum");
  const paint = () => { sum.textContent = typeof summary === "function" ? summary() : summary; };
  paint();
  d.querySelector(".shade-body").append(...children.filter(Boolean));
  d.refreshSummary = paint;
  return d;
}

/** A group of related settings under one heading, with a line on what they're for. */
export function group(title, about, children, opt = {}) {
  const g = el(`<section class="group ${opt.cls || ""}">${title ? `<header><h2>${esc(title)}</h2>${about ? `<p>${about}</p>` : ""}</header>` : ""}<div class="group-body"></div></section>`);
  g.querySelector(".group-body").append(...children.filter(Boolean));
  return g;
}

// Whenever the settings are read again (a save, a restart), every control on the page and every
// shade's cover shows them as they now are: two controls of one setting (the map's ring and the
// stepper beside it) never disagree.
on("settings", () => {
  document.querySelectorAll(".set").forEach((n) => { if (n.refresh && !n.classList.contains("saving")) { n.querySelector(".set-body > *")?.render?.(); n.refresh(); } });
  document.querySelectorAll(".shade").forEach((d) => d.refreshSummary?.());
});
