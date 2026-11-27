// Radio: the VHF airband radio. Not active yet: its channels, how its sticks listen, and the plan of
// which channels each stick would hear at once are set up here, and every station with a stick
// given to the radio writes its receiver's config from them, ready for when it is. The picture is
// the whole airband with the channels on it and the slice each stick would hear.
import { el, esc, call, save, value, plural, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { head } from "../parts.js";
import { toggle, cards, group, line, shade } from "../controls.js";

const LO = 118.0, HI = 137.0;

/** The airband as a strip: each channel a tick, each stick's slice a band over it. */
function band(plan) {
  const W = 1000, H = 120, x = (mhz) => 8 + (mhz - LO) / (HI - LO) * (W - 16);
  const grid = [118, 120, 122, 124, 126, 128, 130, 132, 134, 136].map((m) => `<path class="rb-grid" d="M${x(m)} 22V${H - 22}"/><text class="rb-lab" x="${x(m)}" y="${H - 6}" text-anchor="${m === 118 ? "start" : "middle"}">${m}</text>`).join("");
  const slices = plan.slices.map((s, i) => `<rect class="rb-slice s${i % 3}" x="${x(s.lo / 1e6)}" y="26" width="${Math.max(3, x(s.hi / 1e6) - x(s.lo / 1e6))}" height="${H - 52}" rx="6"><title>${esc(s.station || "")} ${esc(s.serial || "")}: ${(s.lo / 1e6).toFixed(2)} to ${(s.hi / 1e6).toFixed(2)} MHz</title></rect>
    <text class="rb-slab" x="${x(s.lo / 1e6) + 6}" y="40">${esc(s.station || "stick")} ${i + 1}</text>`).join("");
  const heard = new Set(plan.slices.flatMap((s) => s.channels.map((c) => c.mhz)));
  const ticks = plan.channels.map((c) => `<path class="rb-ch ${heard.has(c.mhz) ? "heard" : ""} k-${esc(c.kind)}" d="M${x(+c.mhz)} 46V${H - 30}"><title>${esc(c.mhz)} ${esc(c.name)}</title></path>`).join("");
  return `<svg class="radio-band" viewBox="0 0 ${W} ${H}" role="img" aria-label="The airband, 118 to 137 MHz: ${plan.channels.length} channels, ${plan.slices.length} slices heard at once">
    <rect class="rb-air" x="8" y="22" width="${W - 16}" height="${H - 44}" rx="8"/>${grid}${slices}${ticks}</svg>`;
}

/** The channels, one a line, to add to and take from. */
function channelEditor(page) {
  const box = el(`<div class="chan-edit" data-setting="radio.channels"></div>`);
  const paint = () => {
    const list = value("radio", "channels") || [];
    box.innerHTML = `${list.length ? `<ol class="chan-list">${list.map((c, i) => {
        const [mhz, ...name] = String(c).trim().split(/\s+/);
        return `<li><b>${esc(mhz)}</b><span>${esc(name.join(" "))}</span><button class="icon-btn" data-rm="${i}" title="Take it away">${icon("x")}<span class="sr">Remove</span></button></li>`;
      }).join("")}</ol>` : `<p class="dim">No channels yet. Tower and approach first; 121.5 (guard) is added by itself.</p>`}
      <form class="chan-add"><input name="mhz" placeholder="118.700" inputmode="decimal" required pattern="1(1[89]|2[0-9]|3[0-6])\\.[0-9]{1,3}" aria-label="Frequency in MHz"><input name="name" placeholder="PDX Tower" aria-label="Its name"><button class="btn small">Add</button></form>
      <p class="set-error" role="alert" hidden></p>`;
  };
  const write = async (list) => {
    const err = box.querySelector(".set-error");
    try { await save("radio", "channels", list); page.redraw(); }
    catch (e) { if (e.message !== "signed out") { err.textContent = e.message; err.hidden = false; } }
  };
  box.onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) { const list = [...(value("radio", "channels") || [])]; list.splice(+b.dataset.rm, 1); write(list); } };
  box.onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    write([...(value("radio", "channels") || []), `${(+f.mhz.value).toFixed(3)} ${f.name.value.trim()}`.trim()]);
  };
  paint();
  return box;
}

export default {
  id: "radio", get title() { return TITLES.radio; }, icon: "radio",
  async draw(page) {
    page.redraw = async () => { const fresh = el(`<div class="page page-radio"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const plan = await call("radio/plan");
    page.append(head(TITLES.radio, "The VHF airband radio: not active yet. Its channels and sticks are set up here, ready for when it is.",
      `<span class="status warn">not active yet</span>`));

    page.append(el(`<section class="glass radio-hero">
      <div class="radio-top">${icon("radio", "big-ico")}<div><b>${plan.sticks.length ? plural(plan.sticks.length, "stick") + " given to the radio" : "No stick given to the radio"}</b>
        <p>${plan.sticks.length ? `On ${[...new Set(plan.sticks.map((s) => s.station))].map(esc).join(", ")}. ` : "On the Stations page, set a stick's job to VHF radio. "}${plan.channels.length ? `${plural(plan.channels.length, "channel")}; ${plan.mode === "scan" ? "one stick scans them" : "each stick hears the 2 MHz slice with the most of them, all at once"}.` : "No channels set yet."}</p></div></div>
      ${band(plan)}
      <div class="radio-key"><span class="k heard">Heard at once</span><span class="k other">Scanned or not heard</span></div>
    </section>`));

    page.append(group("Listening", "Each station writes its receiver's config from these", [
      toggle("radio", "enabled", { label: "Listen", on: "Set to listen: the radio isn't run by this version yet, so nothing is heard until it is.", off: "Off." }),
      cards("radio", "mode", { label: "How the sticks listen", options: [
        { value: "parked", title: "Parked", body: "Each stick hears the 2 MHz slice holding most of the channels, every one of them at once. Nothing said there is missed.", icon: "radio" },
        { value: "scan", title: "Scan", body: "One stick hops through every channel, one at a time: it hears more of them, but misses the start of calls.", icon: "positions" },
      ], saved: () => page.redraw() }),
    ]));

    page.append(group("Channels", "Frequency in MHz, then its name", [channelEditor(page)]));

    const rows = plan.slices.map((s, i) => line(`Stick ${i + 1}`, `<span class="line-val">${esc(s.station || "")}${s.serial ? ` <code>${esc(s.serial)}</code>` : ""}: ${(s.lo / 1e6).toFixed(2)} to ${(s.hi / 1e6).toFixed(2)} MHz</span>
      <span class="dim small">${s.channels.map((c) => `${esc(c.mhz)} ${esc(c.name)}`).join("; ") || "no channels in its slice"}</span>`));
    if (plan.scanner) rows.push(line("Scanning", `<span class="line-val">${esc(plan.scanner.station || "")} <code>${esc(plan.scanner.serial || "")}</code></span><span class="dim small">${plan.scan.map((c) => `${esc(c.mhz)} ${esc(c.name)}`).join("; ")}</span>`));
    else if (plan.scan.length) rows.push(line("Not heard", `<span class="dim small">${plan.scan.map((c) => `${esc(c.mhz)} ${esc(c.name)}`).join("; ")}: no stick left to scan them</span>`));
    if (!plan.sticks.length) rows.push(line("Sticks", `<span class="line-val"><span class="dot"></span> None given to the radio</span><a class="btn small" href="#stations">Give one on the Stations page</a>`));
    page.append(group("Sticks", "Which channels each would hear", rows));

    page.append(shade("What's next", () => "running the radio, a log of calls, who's talking", [
      line("Next", `<span class="dim">Running the radio on the stations (RTLSDR-Airband, from the config each writes), a log of calls, then who's talking: the callsign matched to an aircraft on the radar. <code>cloudwall/radio/README.md</code> sets it out.</span>`),
    ]));
  },
};
