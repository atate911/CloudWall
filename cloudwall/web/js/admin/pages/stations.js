// Stations: the machines with antennas (a Pi with the ADS-B stick, another with the VHF sticks, or one
// with both), each joined to this wall and reporting every minute. For each, how its machine is,
// what each of its sticks is for (a choice the station takes at its next report), its name; and
// how to bring another one on.
import { el, esc, S, call, toast, ago, when, plural, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { head, pageTroubles, trouble } from "../parts.js";
import { group, line, advanced } from "../controls.js";
import { machineRows, commandRows, joinSteps, JOBS } from "../stationview.js";

const SILENT_S = 300;

function sticks(st, page) {
  const f = st.facts || {}, jobs = st.desired?.jobs || {};
  const found = f.sdr || [];
  if (!found.length) return line("Sticks", `<span class="line-val"><span class="dot"></span> None found on this machine</span>`);
  const box = el(`<div class="stick-list">${found.map((s) => {
    const key = s.serial || s.id, job = jobs[key] || "spare", done = st.applied?.jobs?.[key] === job;
    return `<div class="stick"><span class="stick-who"><b>${esc(s.name || s.id)}</b><code>${s.serial ? `serial ${esc(s.serial)}` : "no serial number: set one with rtl_eeprom to tell sticks apart"}</code></span>
      <div class="seg small" role="radiogroup" aria-label="What this stick is for" data-key="${esc(key)}">${JOBS.map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${v === job}">${l}</button>`).join("")}</div>
      <span class="stick-state dim small">${done ? "in use" : "taken at its next report"}</span></div>`;
  }).join("")}</div>`);
  box.onclick = async (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    const seg = b.closest(".seg");
    try {
      await call(`stations/${st.id}`, { jobs: { [seg.dataset.key]: b.dataset.v } });
      toast(`${st.name}: that stick is for ${JOBS.find(([v]) => v === b.dataset.v)[1]} now. It takes it at its next report.`);
      page.redraw();
    } catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  return line("Sticks", box);
}

function nameRow(st, page) {
  const form = el(`<form class="txt-edit inline-name"><input value="${esc(st.name)}" maxlength="40" aria-label="The station's name"><button class="btn small">Rename</button></form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await call(`stations/${st.id}`, { name: form.querySelector("input").value }); toast("Renamed"); page.redraw(); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  return line("Name", form);
}

function stationGroup(st, now, page) {
  const silent = !st.seen || now - st.seen > SILENT_S;
  const f = st.facts;
  const rows = [];
  for (const fd of (st.findings || []).filter((x) => x.state === "warn" || x.state === "fail")) rows.push(trouble(fd));
  if (silent) rows.push(line("Reporting", `<span class="line-val"><span class="dot fail"></span> ${st.seen ? `Silent for ${Math.round((now - st.seen) / 60)} min` : "Hasn't reported yet"}</span>
    <span class="dim small">On it: <code>systemctl status cloudwall-station</code>, and <code>cloudwall station --check</code>.</span>`));
  if (f) rows.push(...machineRows(f));
  rows.push(sticks(st, page));
  const radio = st.applied?.radio;
  if (radio) rows.push(line("Radio", `<span class="line-val">${esc(radio.state)}</span>${radio.heard != null ? `<span class="dim small">${plural(radio.heard, "channel")} heard at once, ${radio.scanned} scanned; its receiver's config: <code>${esc(radio.config)}</code></span>` : ""}`));
  const rm = el(`<button class="btn small quiet danger" type="button">Take it off this wall</button>`);
  rm.onclick = async () => {
    if (!confirm(`Take ${st.name} off this wall? It stops being shown and its reports are refused. (On it, \`sudo cloudwall station leave\` stops it reporting.)`)) return;
    try { toast((await call(`stations/${st.id}`, {}, "DELETE")).said); page.redraw(); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  rows.push(advanced(() => `commands, its name; joined ${when(st.joined)}`, [
    ...commandRows(f),
    nameRow(st, page),
    line("Joined", `${when(st.joined)}${st.address ? `; reports from ${esc(st.address)}` : ""}`),
    line("Remove", rm),
  ]));
  return group(st.name, silent ? `<span class="status fail">silent</span>` : `<span class="status ok">reported ${ago(st.seen)}</span>`, rows, { cls: "station" });
}

function addGroup() {
  const slot = el(`<div class="join-slot"></div>`);
  const make = el(`<button class="btn" type="button">${icon("plus")} Make a join code</button>`);
  make.onclick = async () => {
    try {
      const got = await call("stations/code", {});
      slot.replaceChildren(el(`<p class="join-code">Code <b>${esc(got.code)}</b> <span class="dim small">works once, until ${new Date(got.until * 1000).toLocaleTimeString([], { timeStyle: "short" })}</span></p>`), joinSteps(got.code));
    } catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  slot.append(joinSteps(null));
  return group("Add a station", "A Pi (or any Linux machine) with antennas", [
    line("Join code", make),
    slot,
  ]);
}

export default {
  id: "stations", get title() { return TITLES.stations; }, icon: "stations",
  async draw(page) {
    page.redraw = async () => { const fresh = el(`<div class="page page-stations"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const got = await call("stations");
    page.append(head(TITLES.stations, "The machines with antennas: how each is, what each of its sticks is for, and adding another.",
      got.stations.length ? `<span class="status ${got.stations.some((s) => !s.seen || got.now - s.seen > SILENT_S) ? "fail" : "ok"}">${plural(got.stations.length, "station")}</span>` : ""));
    const t = pageTroubles("stations");
    if (t) page.append(t);
    if (!got.taken) {
      page.append(el(`<div class="empty"><p>This CloudWall runs without a logbook folder (a demonstration), so it doesn't keep stations.</p></div>`));
      return;
    }
    if (!got.stations.length) {
      page.append(el(`<section class="glass choose-hero"><div class="choose-now">${icon("stations", "big-ico")}<div><b>No stations yet</b>
        <p>A station is CloudWall on a machine with antennas: a Raspberry Pi with the ADS-B stick, another with VHF sticks for the radio, or one with both. Joined to this wall, it reports how it is every minute (power, temperature, clock, SD card, sticks, decoder, feeders), its problems reach Overview and your alerts, and what each of its sticks is for is set here.</p></div></div></section>`));
    }
    for (const st of got.stations) page.append(stationGroup(st, got.now, page));
    page.append(addGroup());
    // the reports keep coming: the page keeps up while it's open
    const timer = setInterval(() => { if (!page.isConnected) return clearInterval(timer); if (!document.hidden && !page.querySelector(":focus")) page.redraw(); }, 60000);
  },
};
