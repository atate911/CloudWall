// Pieces the pages are built from: heading, problem card, reading (a measured value), small helpers.
import { el, esc, md, S, call, toast, button, runDoctor, waitFor, lasted, loadOverview, emit, problemsOf } from "./core.js";
import { icon } from "./icons.js";

export function head(title, sentence, aside = "") {
  return el(`<header class="page-head"><div><h1>${esc(title)}</h1><p>${sentence}</p></div>${aside ? `<div class="page-aside">${aside}</div>` : ""}</header>`);
}

/** A problem card, with a fix button where CloudWall can fix it itself. */
export function trouble(f, opt = {}) {
  const cat = S.catalogue?.troubles?.[f.code];
  const steps = f.steps?.length ? f.steps : f.fix ? [f.fix] : [];
  const stopped = f.state === "fail";
  const node = el(`<article class="trouble ${stopped ? "fail" : "warn"} ${f.major ? "major" : ""}">
    <div class="trouble-mark" aria-hidden="true"></div>
    <div class="trouble-main">
      <div class="trouble-top"><span class="trouble-kind">${stopped ? (f.major ? "Stopped working" : "Not working") : "Worth a look"}</span>
        <span class="trouble-since">${f.since ? `for ${lasted(Date.now() / 1000 - f.since)}` : "just found"}</span>
        ${f.subtle ? `<span class="trouble-subtle" title="The screens look normal, but what they show isn't right">Looks right, isn't</span>` : ""}</div>
      <h3>${esc(f.summary)}</h3>
      ${f.detail ? `<p>${esc(f.detail)}</p>` : ""}
      ${steps.length || f.causes?.length ? `<details class="trouble-how" ${opt.open ? "open" : ""}><summary>What to do</summary>
        ${f.causes?.length ? `<p class="dim">Usually because ${esc(f.causes.join("; or "))}.</p>` : ""}
        ${steps.length ? `<ol class="steps">${steps.map((s) => `<li>${md(s)}</li>`).join("")}</ol>` : ""}</details>` : ""}
      <div class="trouble-acts"></div>
    </div></article>`);
  const acts = node.querySelector(".trouble-acts");
  if (f.repair && !f.auto) {
    const does = (S.catalogue?.repairs?.[f.repair]?.does || "repair it").replace(/^./, (c) => c.toUpperCase());
    acts.append(button(does, async () => {
      const got = await call("repair", { name: f.repair });
      if (got.request) return waitFor(got.request);
      toast(got.said); await loadOverview(); emit("page");
    }));
  } else if (f.repair && f.auto) {
    acts.append(el(`<span class="dim small">${icon("restart")} CloudWall repairs this by itself</span>`));
  }
  for (const a of cat?.asks || []) acts.append(ask(f, a));
  acts.append(button("Check again", runDoctor, "quiet"));
  return node;
}

/** A question a problem needs answered before CloudWall can fix it (a time zone, a yes). */
function ask(f, a) {
  const form = el(`<form class="ask"><label>${esc(a.question)}${a.kind === "yes" ? "" : `<input type="${a.kind === "secret" ? "password" : "text"}" placeholder="${esc(a.example || "")}" autocomplete="off" required>`}</label><button class="btn">${a.kind === "yes" ? "Yes, do it" : "Use this"}</button></form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = form.querySelector("button"); b.disabled = true;
    try {
      const got = await call("fix", { code: f.code, name: a.name, value: a.kind === "yes" ? "yes" : form.querySelector("input").value, summary: f.summary });
      if (got.request) return waitFor(got.request);
      toast(got.said); await loadOverview(); emit("page");
    } catch (err) { if (err.message !== "signed out") toast(err.message, true); } finally { b.disabled = false; }
  };
  return form;
}

export function pageTroubles(page) {
  const list = problemsOf(page);
  if (!list.length) return null;
  const box = el(`<section class="troubles" aria-label="Problems here"></section>`);
  list.forEach((f) => box.append(trouble(f)));
  return box;
}

export function reading(value, label, opt = {}) {
  return `<div class="reading ${opt.cls || ""}" ${opt.title ? `title="${esc(opt.title)}"` : ""}><b>${value}</b>${opt.unit ? `<small>${esc(opt.unit)}</small>` : ""}<span>${label}</span></div>`;
}

/** A link out, in a new tab. `label` is HTML. */
export const out = (href, label, cls = "") => `<a class="out ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}${icon("open")}</a>`;

export function copyable(textValue, opt = {}) {
  const node = el(`<div class="copy ${opt.cls || ""}"><code>${esc(textValue)}</code><button type="button" class="icon-btn" title="Copy">${icon("copy")}<span class="sr">Copy</span></button></div>`);
  node.querySelector("button").onclick = async () => {
    try { await navigator.clipboard.writeText(textValue); toast(opt.said || "Copied"); }
    catch { toast("Couldn't copy here: select it and copy it by hand", true); }
  };
  return node;
}
