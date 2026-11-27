// This server: CloudWall itself. How long it has run and how (a service that starts itself again,
// or started by hand), its version, the restart; then the log, live; then every setting as the file
// has it, for when you know exactly what you're after; then what to type at the machine.
import { el, esc, S, call, toast, restart, lasted, when, plural, button } from "../core.js";
import { icon } from "../icons.js";
import { head, pageTroubles, copyable } from "../parts.js";
import { any, shade, group } from "../controls.js";

let level = "warning";

function log() {
  const box = el(`<div class="log-wrap">
    <div class="seg small log-level" role="radiogroup">${[["warning", "Warnings and errors"], ["", "Everything"], ["error", "Errors only"]].map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${v === level}">${l}</button>`).join("")}</div>
    <div class="log" role="log" aria-live="polite"></div></div>`);
  const out = box.querySelector(".log");
  const load = async () => {
    try {
      const got = await call(`log?level=${level}`);
      out.innerHTML = got.lines.map((l) => `<div class="${esc(l.level)}"><time>${new Date(l.t * 1000).toLocaleTimeString()}</time><span class="who">${esc(l.name.replace(/^cloudwall\.?/, "") || "cloudwall")}</span>${esc(l.text)}</div>`).join("") || `<div class="dim">Nothing at this level lately: all quiet.</div>`;
      out.scrollTop = out.scrollHeight;
    } catch { /* next time */ }
  };
  box.querySelector(".log-level").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; level = b.dataset.v; box.querySelectorAll(".log-level button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); load(); };
  load();
  const t = setInterval(() => { if (!box.isConnected) clearInterval(t); else if (!document.hidden) load(); }, 5000);
  return box;
}

function everything() {
  const box = el(`<div class="every"><input type="search" class="find" placeholder="Find a setting by its name, its section or what it does" aria-label="Find a setting"><div class="every-list"></div></div>`);
  const list = box.querySelector(".every-list");
  for (const sec of S.settings.sections) {
    const g = el(`<section class="every-sec" data-text="${esc((sec.name + " " + sec.label + " " + sec.about).toLowerCase())}"><h3>${esc(sec.label)} <code>[${esc(sec.name)}]</code></h3><p class="dim small">${esc(sec.about)}</p><div class="every-items"></div></section>`);
    for (const s of sec.settings) {
      const c = any(sec.name, s.key);
      c.dataset.text = `${sec.name} ${s.key} ${s.label} ${s.help}`.toLowerCase();
      g.querySelector(".every-items").append(c);
    }
    list.append(g);
  }
  box.querySelector("input").oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    list.querySelectorAll(".every-sec").forEach((g) => {
      let any = false;
      g.querySelectorAll(".set").forEach((c) => { const hit = !q || c.dataset.text.includes(q) || g.dataset.text.includes(q); c.hidden = !hit; any ||= hit; });
      g.hidden = !any;
    });
  };
  return box;
}

export default {
  id: "server", title: "This server", icon: "server",
  live() { return S.overview ? `up ${lasted(Date.now() / 1000 - S.overview.started)}` : ""; },
  async draw(page) {
    const o = S.overview;
    page.append(head("This server", "CloudWall itself: how it runs, its log, and every setting as the file has it."));
    const t = pageTroubles("server");
    if (t) page.append(t);

    const sys = o.installs.find((i) => i.kind === "system");
    const hero = el(`<section class="glass server-hero">
      <div class="srv-up">${icon("server", "big-ico")}<div><span class="fact-label">Running for</span><b class="fact-huge">${lasted(Date.now() / 1000 - o.started)}</b><span class="fact-sub">since ${when(o.started)}</span></div></div>
      <ul class="srv-facts">
        <li><b>Version</b><span>CloudWall ${esc(o.version)}</span></li>
        <li><b>How it runs</b><span>${o.under_systemd ? "As a service: it starts again by itself after a crash or a reboot" : "Started by hand: it won't come back by itself after a reboot"}</span></li>
        <li><b>Root helper</b><span>${o.helper ? "Installed: repairs that need root can be made from this board" : "Not installed: repairs that need root are done at the machine (sudo cloudwall install sets it up)"}</span></li>
        <li><b>Set up here</b><span>${o.installs.map((i) => `${i.kind === "system" ? "the system service" : `${esc(i.user)}'s own service`}${i.active === false ? " (not running)" : ""}`).join("; ") || "not as a service"}${sys ? "" : ""}</span></li>
        ${o.demo ? `<li><b>Traffic</b><span>Simulated, for a demonstration</span></li>` : ""}
      </ul>
      <div class="srv-act"></div>
    </section>`);
    hero.querySelector(".srv-act").append(button(`${icon("restart")} Restart CloudWall`, restart, o.under_systemd ? "" : "quiet"));
    if (!o.under_systemd) hero.querySelector(".srv-act").append(el(`<span class="dim small">Started by hand: stop it and start it again at the machine.</span>`));
    page.append(hero);

    page.append(group("The log", "What CloudWall has said lately, newest at the bottom. The full log is at the machine: <code>journalctl -u cloudwall</code>.", [log()]));

    const probs = o.settings_problems || [];
    const fileBits = [el(`<div class="file-line">${o.settings_file ? copyable(o.settings_file).outerHTML : `<p class="dim">None: CloudWall is running on its built-in defaults.</p>`}</div>`)];
    if (probs.length) fileBits.push(el(`<ul class="left-out">${probs.map((p) => `<li>${icon("problems")}<span>${esc(p)}</span></li>`).join("")}</ul>`));
    page.append(group("The settings file", probs.length ? `${plural(probs.length, "setting")} in it couldn't be used and ${probs.length === 1 ? "was" : "were"} left out: the default stands in until it's put right.` : "Every page of this board writes to it. It can be edited by hand too: CloudWall reads it when it starts.", fileBits));
    page.querySelectorAll(".file-line .icon-btn").forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(o.settings_file); toast("Copied"); } catch { toast("Select it and copy it by hand", true); } });

    page.append(shade("Every setting", () => `${S.settings.sections.reduce((n, s) => n + s.settings.length, 0)} settings in ${S.settings.sections.length} sections, each with its explanation`, [everything()]));

    page.append(group("At the machine", "For what a browser can't do.", [el(`<dl class="cmds">
      <dt>Check everything, and put right what it can with you</dt><dd data-copy="sudo cloudwall doctor --fix"></dd>
      <dt>Update to the latest version (backs up first)</dt><dd data-copy="sudo python3 -m cloudwall upgrade"></dd>
      <dt>Go back to the version before</dt><dd data-copy="sudo cloudwall rollback"></dd>
      <dt>A report to share, with keys and places masked</dt><dd data-copy="cloudwall report"></dd>
      <dt>Set the owner's password</dt><dd data-copy="sudo cloudwall owner"></dd></dl>`)]));
    page.querySelectorAll("[data-copy]").forEach((d) => d.append(copyable(d.dataset.copy)));
  },
};
