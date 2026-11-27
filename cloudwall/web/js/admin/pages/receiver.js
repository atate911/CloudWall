// Your receiver: the antenna at home. First what it hears and how far (its reach as a shape around
// the house, the message rate, signal against noise), with the board's reading of those numbers in
// words ("the gain looks right"); then its own live map and Coverage3D, as pages of this board; then
// how it reaches this server. Without a receiver, the page is the way to connect one.
import { el, esc, S, call, num, plural, ago, house, ownFeed, value } from "../core.js";
import { icon } from "../icons.js";
import { gauge, signalMeter, polar } from "../draw.js";
import { head, pageTroubles, out, copyable } from "../parts.js";
import { text, toggle, shade } from "../controls.js";

let tab = "hearing";

/** What the numbers mean, in words, with what to do about them. [state, title, words] */
function readings(r) {
  const m = r.last15min || r.last1min || {}, out = [];
  if (m.strong_pct != null) {
    if (m.strong_pct > 10) out.push(["warn", "Too much gain", `${m.strong_pct}% of messages are near the receiver's limit (above −3 dBFS): nearby aircraft drown out far ones. Turn the gain down a step in the receiver's setup page${r.gain_db != null ? ` (it's at ${r.gain_db} dB now)` : ""}, until fewer than 5% are.`]);
    else if (m.strong_pct < 0.5 && m.noise != null && m.noise < -35) out.push(["tip", "Room for more gain", `Only ${m.strong_pct}% of messages are strong and the noise floor is low (${m.noise.toFixed(1)} dBFS): a step more gain may reach further.`]);
    else out.push(["ok", "The gain looks right", `${m.strong_pct}% of messages are strong (the aim is under 5%)${r.gain_db != null ? `, at ${r.gain_db} dB` : ""}.`]);
  }
  if (m.noise != null && m.noise > -20) out.push(["warn", "A noisy place", `The noise floor is ${m.noise.toFixed(1)} dBFS (about −30 is usual): something near the antenna or its cable is interfering, or the gain is very high.`]);
  if (m.messages_s != null && m.messages_s < 20 && (r.with_pos || 0) < 2) out.push(["warn", "Hardly hearing anything", `${m.messages_s} messages a second. Check the antenna's cable and connector, and that the dongle is plugged in (the receiver's setup page shows it).`]);
  if (r.ppm != null && Math.abs(r.ppm) > 50) out.push(["tip", "The dongle's clock is off", `It runs ${r.ppm} ppm from true. Most decoders cope; if reception is patchy, set the ppm correction in the receiver's setup page.`]);
  if (m.max_nm) out.push(["ok", `Hearing out to ${num(m.max_nm)} nm`, `The farthest position in the last 15 minutes. From a house, 150 to 250 nm is good; hills and buildings cut it in their direction (the shape on the left).`]);
  return out;
}

function hearing(r) {
  const m = r.last1min || {}, m15 = r.last15min || {};
  const at = r.receiver?.lat != null ? { lat: r.receiver.lat, lon: r.receiver.lon } : S.sky?.home;
  const total = (r.with_pos || 0) + (r.without_pos || 0);
  const types = Object.entries(r.by_type || {}).sort((a, b) => b[1] - a[1]);
  const typeName = { adsb_icao: "ADS-B", adsb_icao_nt: "ADS-B (other)", adsr_icao: "ADS-R", tisb_icao: "TIS-B", mlat: "MLAT", mode_s: "Mode S only", adsc: "ADS-C", other: "other", unknown: "unknown" };
  const words = readings(r);
  return el(`<div class="rx">
    <section class="glass rx-hero">
      <figure class="rx-reach">${polar({ outline: r.outline, at, radiusNm: value("tracking", "radius_nm"), maxNow: m.max_nm })}
        <figcaption><b>How far it hears</b> The shape is the farthest each direction has reached today; the dashed ring this minute's farthest; the small ring the wall's tracking radius.</figcaption></figure>
      <div class="rx-dials">
        <figure>${gauge({ value: m.messages_s, max: 2000, unit: "a second", label: "Messages a second", zones: [[0, 100, "low"], [100, 2000, "good"]], fmt: (v) => num(v) })}<figcaption>Messages heard${m15.messages_s != null ? `; ${num(m15.messages_s)} a second over 15 minutes` : ""}</figcaption></figure>
        <figure>${signalMeter({ signal: m.signal, noise: m.noise, peak: m.peak })}<figcaption>Signal against noise, dBFS</figcaption></figure>
        <div class="rx-planes">
          <b>${num(total)}</b><span>aircraft heard</span>
          <div class="split" role="img" aria-label="${num(r.with_pos)} with a position, ${num(r.without_pos)} without"><i style="flex-grow:${r.with_pos || 0}"></i><i style="flex-grow:${r.without_pos || 0}"></i></div>
          <span class="dim small">${num(r.with_pos)} with a position, ${num(r.without_pos)} without</span>
          ${types.length ? `<ul class="chips">${types.map(([k, v]) => `<li>${esc(typeName[k] || k)} <b>${num(v)}</b></li>`).join("")}</ul>` : ""}
        </div>
      </div>
    </section>
    <section class="rx-words">${words.map(([st, t, w]) => `<article class="word ${st}">${icon(st === "ok" ? "check" : st === "warn" ? "problems" : "info")}<div><b>${esc(t)}</b><p>${esc(w)}</p></div></article>`).join("")}</section>
  </div>`);
}

function framed(src, title) {
  return el(`<div class="rx-frame"><iframe src="${esc(src)}" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
    <a class="rx-pop" href="${esc(src)}" target="_blank" rel="noopener">${icon("open")} Open on its own</a></div>`);
}

function coverageSetup() {
  return el(`<div class="setup-steps">
    <h2>Set up Coverage3D</h2>
    <p>Coverage3D draws, in 3D, where your receiver can and can't hear: the shadows of hills and buildings, and how high an aircraft must be to be heard at each distance. It runs on the receiver and reaches this board through the same tunnel.</p>
    <ol class="steps big">
      <li><b>On the receiver</b>, install it:<div data-copy="sudo apt install -y python3-venv && cd ~/CloudWall/coverage3d && sudo ./install.sh"></div></li>
      <li><b>On the receiver</b>, let the tunnel carry it (the key line it prints goes to the next step):<div data-copy="sudo bash ~/CloudWall/deploy/feed-tunnel/pi-tunnel.sh keygen"></div></li>
      <li><b>On this server</b>, allow the second port, with the key line from the receiver:<div data-copy='sudo bash deploy/feed-tunnel/vps-tunnel.sh setup "ssh-ed25519 …" --coverage'></div></li>
      <li><b>On the receiver</b>, start the tunnel again with Coverage3D:<div data-copy="sudo bash ~/CloudWall/deploy/feed-tunnel/pi-tunnel.sh install YOUR-SERVER --coverage"></div></li>
    </ol>
    <p class="dim">Then this tab shows it. It answers here at <code>${esc(S.receiver?.coverage_url || "the port after the receiver's")}</code>.</p>
  </div>`);
}

function connectGuide(page) {
  const box = el(`<div class="setup-steps connect">
    <section class="glass path-hero">
      <div class="path">
        <div class="path-end">${icon("receiver")}<b>Your receiver</b><span>at home, behind your router</span></div>
        <div class="path-line"><span>outgoing SSH: nothing opened at home</span></div>
        <div class="path-end">${icon("server")}<b>This server</b><span>reads it at 127.0.0.1:18080</span></div>
      </div>
    </section>
    <h2>Connect your receiver</h2>
    <p>CloudWall can use an ADS-B receiver of your own (a Raspberry Pi running adsb.im, readsb or tar1090) alongside the public feeds: fresher positions, and aircraft the public feeds miss. The receiver dials out to this server, so nothing is opened on your home network.</p>
    <ol class="steps big">
      <li><b>On the receiver</b>, make its key:<div data-copy="sudo bash ~/CloudWall/deploy/feed-tunnel/pi-tunnel.sh keygen"></div></li>
      <li><b>On this server</b>, authorise that key (paste the line the receiver printed):<div data-copy='sudo bash deploy/feed-tunnel/vps-tunnel.sh setup "ssh-ed25519 …"'></div></li>
      <li><b>On the receiver</b>, connect, checking the fingerprint the server printed:<div data-copy="sudo bash ~/CloudWall/deploy/feed-tunnel/pi-tunnel.sh install YOUR-SERVER"></div></li>
      <li><b>Here</b>, tell CloudWall where it answers, and combine it with the public feeds:<div class="slot-url"></div><div class="slot-merge"></div></li>
    </ol>
    <p class="dim">The whole story, and what to do when a step fails: <code>deploy/feed-tunnel/README.md</code>.</p>
  </div>`);
  box.querySelector(".slot-url").append(text("receiver", "url", { label: "Its web server, from this machine", mono: true, empty: "Not set: worked out from the feeds", saved: () => setTimeout(() => page.redraw(), 300) }));
  box.querySelector(".slot-merge").append(toggle("source", "merge", { label: "Combine it with the public feeds", on: "Your receiver is asked every update alongside the public feeds, and the two combined.", off: "Only the first feed that answers is used." }));
  return box;
}

function copies(root) {
  root.querySelectorAll("[data-copy]").forEach((d) => d.replaceWith(copyable(d.dataset.copy)));
}

function shares(r) {
  const home = r.home_url;
  return el(`<section class="group">
    <header><h2>Its own pages, and where it shares</h2><p>At home, the receiver's own setup and maps; anywhere, the sites it feeds.</p></header>
    <div class="links">
      ${home ? out(home, "Its setup page <small>adsb.im, at home</small>") : `<span class="link-off">Its setup page <small>set its address at home, below</small></span>`}
      ${home ? out(`${home.replace(/\/$/, "")}:8080`, "SkyAware / tar1090 <small>at home</small>") : ""}
      ${out("https://flightaware.com/adsb/stats/user/", "FlightAware statistics <small>sign in to see your site</small>")}
      ${out("https://flightaware.com/adsb/piaware/claim", "Claim it on FlightAware <small>if it feeds as a guest</small>")}
      ${out("https://www.flightradar24.com/account/data-sharing", "Flightradar24 data sharing <small>your feeder and its account</small>")}
    </div>
  </section>`);
}

function reaches(r, page) {
  const g = el(`<section class="group">
    <header><h2>How it reaches this server</h2><p>${r.reachable ? `Answering at <code>${esc(r.url)}</code>${r.receiver?.version ? `, ${esc(r.receiver.version)}` : ""}.` : `Not answering at <code>${esc(r.url)}</code>: ${esc(r.error || "no answer")}. Is the tunnel up? On the receiver: <code>sudo bash pi-tunnel.sh status</code>`}</p></header>
  </section>`);
  g.append(shade("Addresses", () => {
    const u = value("receiver", "url"), h = value("receiver", "home_url");
    return [u ? "web server set" : "web server worked out from the feeds", h ? "address at home set" : "no address at home"].join("; ");
  }, [
    text("receiver", "url", { label: "Its web server, from this machine", mono: true, empty: "Worked out from the first feed", saved: () => page.redraw() }),
    text("receiver", "home_url", { label: "Its address at home", mono: true, empty: "Not set", saved: () => page.redraw() }),
    text("receiver", "coverage_url", { label: "Coverage3D, from this machine", mono: true, empty: "Beside the receiver's", saved: () => page.redraw() }),
  ], { cls: "inline" }));
  return g;
}

export default {
  id: "receiver", title: "Your receiver", icon: "receiver",
  live() {
    const rx = ownFeed();
    if (!rx) return S.receiver?.reachable ? "answering" : value("receiver", "url") ? "set up" : "not connected";
    return rx.down_since ? "not answering" : `${plural(rx.count, "aircraft")}, ${rx.lag_s != null ? rx.lag_s.toFixed(1) + " s behind" : "answering"}`;
  },
  async draw(page) {
    const r = S.receiver = await call("receiver");
    page.redraw = async () => { const fresh = el(`<div class="page page-receiver"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const rx = ownFeed(house());
    const status = !r.url ? "" : r.reachable ? `<span class="status ok">Answering</span>` : `<span class="status fail">Not answering</span>`;
    page.append(head("Your receiver", r.url ? "The antenna at home: what it hears, how far, and how it reaches this server." : "Your own antenna at home, alongside the public feeds.", status));
    const t = pageTroubles("receiver");
    if (t) page.append(t);
    if (!r.url) { const g = connectGuide(page); copies(g); page.append(g); return; }

    const tabs = el(`<div class="tabs" role="tablist">
      <button role="tab" data-tab="hearing">${icon("receiver")} What it hears</button>
      <button role="tab" data-tab="map">${icon("places")} Its live map</button>
      <button role="tab" data-tab="coverage">${icon("positions")} Coverage3D</button></div>`);
    const body = el(`<div class="tab-body"></div>`);
    const show = () => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
      body.replaceChildren();
      if (tab === "hearing") body.append(r.reachable ? hearing(r) : el(`<div class="empty"><h2>The receiver isn't answering</h2><p>${esc(r.error || "")}</p><p>CloudWall keeps using the public feeds meanwhile. ${rx?.down_since ? `It stopped ${ago(rx.down_since)}.` : ""}</p></div>`));
      if (tab === "map") body.append(r.reachable ? framed("receiver/", "The receiver's live map") : el(`<div class="empty"><p>The live map comes from the receiver itself, which isn't answering.</p></div>`));
      if (tab === "coverage") { if (r.coverage) body.append(framed("coverage/", "Coverage3D")); else { const c = coverageSetup(); copies(c); body.append(c); } }
    };
    tabs.onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; show(); } };
    show();
    page.append(tabs, body, reaches(r, page), shares(r));

    // the readings keep up while the page is open
    const timer = setInterval(async () => {
      if (!page.isConnected) return clearInterval(timer);
      if (document.hidden || tab !== "hearing") return;
      try { const fresh = await call("receiver"); S.receiver = fresh; if (fresh.reachable) body.replaceChildren(hearing(fresh)); } catch { /* next time */ }
    }, 10000);
  },
};
