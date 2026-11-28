// Feeds page: where aircraft positions come from. The feeds in the order they're tried, which one
// is answering now, and an editor that adds from a short list of free feeds (not typed).
import { el, esc, S, house, ownFeed, value, save, ago, plural, num, toast, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { head, pageTroubles } from "../parts.js";
import { toggle, cards, stepper, group, advanced } from "../controls.js";

const PRESETS = [
  { name: "Your receiver, through the tunnel", url: "http://127.0.0.1:18080/data/aircraft.json", own: true },
  { name: "adsb.fi", url: "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius}" },
  { name: "adsb.lol", url: "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}" },
  { name: "airplanes.live", url: "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}" },
];
const hostOf = (u) => { try { return new URL(u.replace(/[{}]/g, "")).hostname; } catch { return u; } };
const isOwn = (u) => /\/data\/aircraft\.json$/.test(u) || /^https?:\/\/(127\.|localhost|192\.168\.|10\.)/.test(u);
const nameOf = (u) => PRESETS.find((p) => p.url === u)?.name.replace(/, through the tunnel$/, "") || (isOwn(u) ? "Your receiver" : hostOf(u));

/** A feed's state now: answering, standing by, or down. */
function stateOf(u, i, merge) {
  const p = house() || {}, feeds = p.feeds || {}, rx = ownFeed(p);
  const pub = feeds["the public feed"] || feeds["the position feed"];
  if (merge && i === 0) return rx ? (rx.down_since ? ["fail", `not answering since ${ago(rx.down_since)}`] : ["ok", `${plural(rx.count, "aircraft")}, ${rx.lag_s != null ? rx.lag_s.toFixed(1) + " s behind" : "answering"}`]) : ["idle", "waiting for a restart"];
  if (!pub) return ["idle", ""];
  if (pub.host === hostOf(u)) return pub.down_since ? ["fail", `not answering: ${pub.error || ""}`] : ["ok", `answering now, ${plural(pub.count, "aircraft")}`];
  return ["idle", "standing by: used if the one before it stops"];
}

function chain(urls, merge) {
  const p = house() || {};
  if (!urls.length || S.overview.demo && !Object.keys(p.feeds || {}).length) {
    return el(`<section class="glass chain demo"><div class="chain-feeds"><div class="feed ok"><span class="feed-n">${icon("feeds")}</span><b>Simulated traffic</b><span>a demonstration: made-up aircraft flying real patterns</span></div></div>
      <div class="chain-out"><b>${plural(p.aircraft || 0, "aircraft")}</b><span>on the wall now</span></div></section>`);
  }
  const rows = urls.map((u, i) => {
    const [st, words] = stateOf(u, i, merge);
    return `<div class="feed ${st} ${merge && i < 2 ? "joined" : ""}"><span class="feed-n">${i + 1}</span><b>${esc(nameOf(u))}</b><span>${esc(words)}</span></div>`;
  }).join("");
  return el(`<section class="glass chain ${merge ? "merged" : "failover"}">
    <div class="chain-feeds">${rows}</div>
    <div class="chain-join"><span>${merge ? "combined" : "first that answers"}</span></div>
    <div class="chain-out"><b>${plural(p.aircraft || 0, "aircraft")}</b><span>${p.status?.ok ? `on the wall, updated ${ago(p.status.updated)}` : "nothing arriving"}</span></div>
  </section>`);
}

function editor(page) {
  const box = el(`<div class="feeds-edit" data-setting="source.urls"></div>`);
  const paint = () => {
    const urls = value("source", "urls") || [], merge = value("source", "merge");
    box.innerHTML = `<ol class="feed-list">${urls.map((u, i) => {
      const [st] = stateOf(u, i, merge);
      return `<li class="${st}"><span class="dot ${st}"></span><span class="feed-who"><b>${esc(nameOf(u))}</b><code title="${esc(u)}">${esc(u)}</code></span>
        <span class="feed-acts"><button class="icon-btn" data-up="${i}" ${i ? "" : "disabled"} title="Try it earlier">${icon("up")}<span class="sr">Earlier</span></button>
        <button class="icon-btn" data-down="${i}" ${i < urls.length - 1 ? "" : "disabled"} title="Try it later">${icon("down")}<span class="sr">Later</span></button>
        <button class="icon-btn" data-rm="${i}" ${urls.length > 1 ? "" : "disabled"} title="Take it away">${icon("x")}<span class="sr">Remove</span></button></span></li>`;
    }).join("")}</ol>
    <div class="feed-add"><span class="dim">Add</span>${PRESETS.filter((p) => !urls.includes(p.url)).map((p) => `<button class="chip" data-add="${esc(p.url)}">${icon("plus")}${esc(p.name)}</button>`).join("")}
      <button class="chip" data-other>${icon("plus")}Another address</button></div>
    <form class="feed-other" hidden><input placeholder="https://… with {lat}, {lon} and {radius}" spellcheck="false" required><button class="btn small">Add</button></form>
    <p class="set-error" role="alert" hidden></p>`;
  };
  const write = async (urls) => {
    const err = box.querySelector(".set-error");
    try { await save("source", "urls", urls); err.hidden = true; toast("Feeds saved. They're used once CloudWall restarts."); page.repaint(); }
    catch (e) { if (e.message !== "signed out") { err.textContent = e.message; err.hidden = false; } }
  };
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const urls = [...(value("source", "urls") || [])];
    if (b.dataset.up) { const i = +b.dataset.up; [urls[i - 1], urls[i]] = [urls[i], urls[i - 1]]; write(urls); }
    else if (b.dataset.down) { const i = +b.dataset.down; [urls[i + 1], urls[i]] = [urls[i], urls[i + 1]]; write(urls); }
    else if (b.dataset.rm) { urls.splice(+b.dataset.rm, 1); write(urls); }
    else if (b.dataset.add) { const own = isOwn(b.dataset.add); write(own ? [b.dataset.add, ...urls] : [...urls, b.dataset.add]); }
    else if ("other" in b.dataset) { const f = box.querySelector(".feed-other"); f.hidden = false; f.querySelector("input").focus(); }
  };
  box.onsubmit = (e) => { e.preventDefault(); const v = box.querySelector(".feed-other input").value.trim(); if (v) write([...(value("source", "urls") || []), v]); };
  box.render = paint;
  paint();
  return box;
}

export default {
  id: "positions", get title() { return TITLES.positions; }, icon: "feeds",
  async draw(page) {
    page.append(head(TITLES.positions, "Where aircraft positions come from: the feeds in the order they're tried, and how often they're asked."));
    const t = pageTroubles("positions");
    if (t) page.append(t);
    let hero = chain(value("source", "urls") || [], value("source", "merge"));
    page.append(hero);
    const ed = editor(page);
    page.repaint = () => { const fresh = chain(value("source", "urls") || [], value("source", "merge")); hero.replaceWith(fresh); hero = fresh; ed.render(); };

    const urls = value("source", "urls") || [];
    page.append(group("Sources", "Tried in order; the next takes over when one stops answering", [
      ed,
      urls.some(isOwn) ? toggle("source", "merge", { label: "Combine your receiver with the public feeds", on: "Your receiver and the first public feed that answers are both asked every update and combined; your receiver's position wins where both see an aircraft.", off: "Only the first feed that answers is used.", saved: () => page.repaint() }) : null,
    ]));

    page.append(group("Polling", "", [
      stepper("tracking", "poll_seconds", { label: "Ask the feeds every", min: 1, max: 60, presets: [[3], [5], [10]], says: (v) => `About ${num(86400 / v)} requests a day to each feed while a screen is open.` }),
      cards("tracking", "when_idle", { label: "With no screen open", options: [
        { value: "log", title: "Keep the logbook", body: "Asks the free feed every 15 s, so every flyover is still logged. No paid lookups or weather.", icon: "logbook" },
        { value: "pause", title: "Pause", body: "Asks nothing until a screen opens. Flyovers meanwhile aren't logged.", icon: "moon" },
      ] }),
      advanced(() => `a screen counts as closed after ${value("tracking", "idle_after_seconds")} s`, [
        stepper("tracking", "idle_after_seconds", { label: "No screen open after", min: 15, max: 3600, step: 15, says: (v) => `A screen that hasn't asked for ${v} s counts as closed.` }),
      ]),
    ]));
  },
};
