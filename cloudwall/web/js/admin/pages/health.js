// Problems and alerts: what CloudWall's checks have found and what happened lately (a week, as bars
// from each problem's start to its end), how you hear about it (alerts to your phone, set up here
// step by step and tested from here), the whole machine's check, and the reference of every problem
// CloudWall knows, behind a shade.
import { el, esc, S, call, toast, value, button, runDoctor, problems, ago, when, lasted, plural, setting } from "../core.js";
import { icon } from "../icons.js";
import { timeline } from "../draw.js";
import { head, trouble, copyable } from "../parts.js";
import { secret, shade, group } from "../controls.js";

function topic() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return "cloudwall-" + [...a].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
}

function alerts(page) {
  const set = value("health", "notify_url")?.set;
  const box = el(`<div class="alerts ${set ? "on" : ""}"></div>`);
  if (set) {
    box.append(el(`<p class="alerts-state">${icon("bell")}<span><b>Alerts are on.</b> When something stops CloudWall working, and again when it's working, a message goes to your alert address.${setting("health", "notify_url").waiting ? " Saved just now: real alerts start once CloudWall restarts; a test works already." : ""}</span></p>`));
    const acts = el(`<div class="alerts-acts"></div>`);
    acts.append(button(`${icon("bell")} Send a test alert`, async () => toast((await call("alert-test", {})).said)));
    box.append(acts, secret("health", "notify_url", { label: "Alert address", setLabel: "Saved", replace: "Use another address", removeAsk: "Stop sending alerts?", saved: () => page.redraw() }));
    return box;
  }
  const t = topic();
  box.append(el(`<ol class="steps big">
    <li><b>Get the ntfy app</b> on your phone (free, for iPhone and Android), and in it subscribe to this topic. It's a private name: anyone who knows it could read your alerts, so keep it to yourself.<div class="slot-topic"></div></li>
    <li><b>Tell CloudWall to use it.</b><div class="slot-use"></div></li>
    <li><b>Send a test</b> to see it arrive. Real alerts start once CloudWall restarts.</li>
  </ol>`));
  box.querySelector(".slot-topic").append(copyable(t, { said: "The topic is copied: paste it into ntfy" }));
  box.querySelector(".slot-use").append(button(`Use ntfy.sh/${esc(t)}`, async () => {
    await call("settings", { section: "health", key: "notify_url", value: `https://ntfy.sh/${t}` });
    S.secretsSaved.add("health.notify_url");
    const { loadSettings } = await import("../core.js");
    await loadSettings();
    toast("Saved. Send a test now; real alerts start after a restart.");
    page.redraw();
  }));
  box.append(el(`<p class="dim small">Or any web address that takes a JSON message (a webhook of your own):</p>`), secret("health", "notify_url", { label: "Another alert address", add: "Use an address", saved: () => page.redraw() }));
  return box;
}

function machine() {
  const d = S.doctor;
  const box = el(`<div class="machine"></div>`);
  if (!d) {
    box.append(el(`<p class="dim">Not checked from here yet. The check reads the settings, the service, every feed, backups, the tunnel and Caddy, the way <code>cloudwall doctor</code> does at the machine.</p>`));
  } else {
    const byPart = {};
    for (const f of d.findings) (byPart[f.part] = byPart[f.part] || []).push(f);
    box.append(el(`<p class="dim small">Checked ${ago(d.checked)}.</p>`));
    box.append(el(`<ul class="checks">${Object.entries(byPart).map(([part, fs]) => {
      const worst = fs.some((f) => f.state === "fail") ? "fail" : fs.some((f) => f.state === "warn") ? "warn" : fs.every((f) => f.state === "off") ? "off" : "ok";
      return `<li class="${worst}"><span class="dot ${worst}"></span><b>${esc(part)}</b><span>${fs.map((f) => esc(f.summary)).join("; ")}</span></li>`;
    }).join("")}</ul>`));
  }
  box.append(button("Check the whole machine", runDoctor, d ? "small quiet" : "small"));
  return box;
}

function known() {
  const cat = Object.entries(S.catalogue?.troubles || {});
  const box = el(`<div class="known"><input type="search" class="find" placeholder="Find a problem: receiver, disk, clock, tunnel…" aria-label="Find a problem"><div class="known-list">${cat.map(([code, t]) =>
    `<details data-text="${esc((code + " " + t.title + " " + t.means).toLowerCase())}"><summary><span class="dot ${t.major ? "fail" : "warn"}"></span>${esc(t.title)}${t.subtle ? ` <span class="tag subtle">looks right, isn't</span>` : ""}</summary>
      <p>${esc(t.means)}</p>${t.causes.length ? `<p class="dim">Usually because ${esc(t.causes.join("; or "))}.</p>` : ""}
      <ol class="steps">${t.steps.map((s) => `<li>${esc(s).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`).join("")}</ol><p class="dim small"><code>${esc(code)}</code>${t.repair ? `; CloudWall can ${esc(S.catalogue.repairs?.[t.repair]?.does || "repair it")}` : ""}</p></details>`).join("")}</div></div>`);
  box.querySelector("input").oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    box.querySelectorAll("details").forEach((d) => { d.hidden = q && !d.dataset.text.includes(q); });
  };
  return box;
}

export default {
  id: "health", title: "Problems and alerts", icon: "problems",
  live() {
    const n = problems().length, week = (S.overview?.incidents || []).filter((i) => Date.now() / 1000 - i.started < 7 * 86400).length;
    return n ? `${n} open now` : week ? `${plural(week, "problem")} this week` : "none this week";
  },
  async draw(page) {
    page.redraw = async () => { const fresh = el(`<div class="page page-health"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const inc = (await call("incidents")).incidents;
    const open = problems();
    page.append(head("Problems and alerts", "What CloudWall's checks of itself have found, what happened lately, and how you hear about it.",
      `<span class="status ${open.some((f) => f.state === "fail") ? "fail" : open.length ? "warn" : "ok"}">${open.length ? plural(open.length, "open problem") : "Nothing open"}</span>`));

    const week = inc.filter((i) => Date.now() / 1000 - (i.ended || Date.now() / 1000) < 7 * 86400);
    page.append(el(`<section class="glass week-hero"><h2>The last seven days</h2>${timeline(inc, 7)}
      <p class="dim small">${week.length ? `${plural(week.length, "problem")}; ${plural(week.filter((i) => i.major).length, "major one")}. Each bar runs from when it started to when it ended; an open one reaches the right-hand edge.` : "Nothing went wrong this week."}</p></section>`));

    if (open.length) {
      const box = el(`<section class="needs"><h2>Open now</h2></section>`);
      open.forEach((f) => box.append(trouble(f, { open: open.length === 1 })));
      page.append(box);
    }

    page.append(group("Alerts on your phone", "Hear about a problem that stops CloudWall working when it starts and when it ends, wherever you are.", [alerts(page)]));
    page.append(group("The whole machine", "Beyond what the running server watches: the install, its files and its neighbours.", [machine()]));
    page.append(shade("Everything that happened", () => `${plural(inc.length, "problem")} recorded${inc[0] ? `, the latest ${ago(inc[0].started)}` : ""}`, [
      el(`<ul class="history">${inc.map((i) => `<li class="${i.ended ? "over" : i.state}"><span class="dot ${i.ended ? "off" : i.state}"></span><span class="h-what">${esc(i.summary)}</span><span class="h-when">${when(i.started)}</span><span class="h-long">${i.ended ? lasted(i.ended - i.started) : "open"}</span></li>`).join("") || `<li class="dim">Nothing yet.</li>`}</ul>`),
    ]));
    page.append(shade(`Every problem CloudWall knows`, () => `${Object.keys(S.catalogue?.troubles || {}).length} problems, with what each means and what to do`, [known()]));
  },
};
