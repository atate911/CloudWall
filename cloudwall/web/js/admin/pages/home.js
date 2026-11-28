// Home page: CloudWall as one diagram (sky, feeds, server, what it feeds), each part showing its
// state and linking to its page. Under it, what needs doing; nothing to set here.
import { el, esc, S, sky, problems, house, ownFeed, ago, lasted, num, plural, button, runDoctor, call, toast, loadOverview, value, onPage, TITLES } from "../core.js";
import { setup } from "../words.js";
import { icon } from "../icons.js";
import { scope, timeline } from "../draw.js";
import { head, trouble } from "../parts.js";

const NODES = ["sky", "receiver", "feeds", "routes", "core", "screens", "logbook", "alerts"];
const EDGES = [["sky", "receiver"], ["sky", "feeds"], ["receiver", "core"], ["feeds", "core"], ["routes", "core"],
               ["core", "screens"], ["core", "logbook"], ["core", "alerts"]];
const PARTS = { receiver: ["receiver", "tunnel"], feeds: ["feeds"], routes: ["routes"], core: ["service", "install", "server", "system", "settings", "files", "clock"],
                screens: ["display", "weather", "home", "access", "caddy"], logbook: ["storage", "cache", "backup"], alerts: [] };

function stateOf(id) {
  const mine = problems().filter((f) => (PARTS[id] || []).includes((f.part || "").replace(/^running: /, "")));
  return mine.some((f) => f.state === "fail") ? "fail" : mine.length ? "warn" : null;
}

/** Returns [state, value, line under it, page it opens]. */
function says(id) {
  const o = S.overview, p = house() || {}, rx = ownFeed(p);
  const others = Object.entries(p.feeds || {}).filter(([l]) => !/receiver/i.test(l));
  const wrong = stateOf(id);
  switch (id) {
    case "receiver":
      if (!rx && S.receiver?.reachable) return [wrong || "idle", "Answering", "but not one of the position feeds", "receiver"];
      if (!rx) return ["off", "Not connected", "Your own antenna, when there is one", "receiver"];
      return [wrong || (rx.down_since ? "fail" : "ok"), rx.down_since ? "Not answering" : plural(rx.count, "aircraft"),
        rx.down_since ? `since ${ago(rx.down_since)}` : rx.lag_s != null ? `${rx.lag_s.toFixed(1)} s behind the sky` : "answering", "receiver"];
    case "feeds": {
      if (!others.length) return [wrong || (p.status?.ok ? "ok" : "fail"), o.demo ? "Simulated" : p.status?.source || "–", o.demo ? "traffic made up for a demonstration" : "", "positions"];
      const up = others.filter(([, v]) => !v.down_since);
      return [wrong || (up.length ? "ok" : "fail"), `${up.length} of ${others.length} answering`, others.map(([, v]) => v.host).filter(Boolean).slice(0, 2).join(", "), "positions"];
    }
    case "routes": {
      const pr = o.provider;
      if (!pr) return ["off", "Free database", "add a paid key for exact routes", "routes"];
      return [wrong || (pr.problem ? "warn" : "ok"), `${num(pr.used_today)} ${pr.unit} today`, pr.daily_limit != null ? `of ${num(pr.daily_limit)} allowed, ${pr.label}` : pr.label, "routes"];
    }
    case "core":
      return [wrong || "ok", `Up ${lasted(Date.now() / 1000 - o.started)}`, `${o.under_systemd ? "as a service" : "started by hand"}, version ${o.version}`, "server"];
    case "screens": {
      const view = value("kiosk", "view");
      return [wrong || (p.watched ? "ok" : "idle"), p.watched ? "Being watched" : "No screen open", `the wall panel shows ${{ card: "the flight card", radar: "the radar", map: "the map", sky: "the sky" }[view] || view}`, "look"];
    }
    case "logbook": {
      const last = o.storage?.last_backup;
      return [wrong || (last ? "ok" : "warn"), plural(p.today || 0, "flyover"), `today; ${last ? `backed up ${ago(last)}` : "never backed up"}`, "safekeeping"];
    }
    case "alerts":
      return [o.alerts ? "ok" : "off", o.alerts ? "To your phone" : "Not set up", "when something stops working", "health"];
  }
  return ["off", "", "", "home"];
}

const NAMES = { receiver: "Receiver", feeds: "Public feeds", routes: "Routes", core: "CloudWall", screens: "Screens", logbook: "Logbook", alerts: "Alerts" };
const ICONS = { receiver: "receiver", feeds: "feeds", routes: "routes", core: "server", screens: "screens", logbook: "logbook", alerts: "bell" };

function node(id) {
  if (id === "sky") {
    return `<a class="node node-sky" href="#places" style="grid-area:sky" data-area="sky" title="The sky around the house now: the house, its tracking radius and the overhead circle">
      <span class="node-name">${icon("sky")} Live traffic</span><canvas class="node-scope" aria-hidden="true"></canvas><span class="node-sub sky-say">…</span></a>`;
  }
  const [st, val, sub, page] = says(id);
  return `<a class="node ${st}" href="#${page}" style="grid-area:${id}" data-area="${id}" data-node="${id}">
    <span class="node-name">${icon(ICONS[id])} ${esc(NAMES[id])}</span><b class="node-val">${esc(val)}</b><span class="node-sub">${esc(sub)}</span>
    <i class="node-lamp" aria-label="${{ ok: "working", warn: "worth a look", fail: "not working", off: "not set up", idle: "waiting" }[st] || ""}"></i></a>`;
}

/** The lines between the parts, measured from where the grid put them. */
function wire(map) {
  const svg = map.querySelector(".wires"), box = map.getBoundingClientRect();
  if (!box.width || getComputedStyle(svg).display === "none") return;
  const at = (id) => map.querySelector(`[data-area="${id}"]`).getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  const access = S.overview.private_link ? "Private link" : "Open to its network";
  svg.innerHTML = EDGES.map(([a, b]) => {
    const A = at(a), B = at(b), into = b === "core";
    const y = into ? A.top + A.height / 2 : B.top + B.height / 2;
    const y0 = Math.min(A.bottom - 18, Math.max(A.top + 18, y)) - box.top, y1 = Math.min(B.bottom - 18, Math.max(B.top + 18, y)) - box.top;
    const x0 = A.right - box.left, x1 = B.left - box.left, mid = (x0 + x1) / 2;
    const from = a === "sky" ? says(b)[0] : a === "core" ? says(b)[0] : says(a)[0];
    const cls = from === "fail" ? "broken" : from === "off" ? "unused" : from === "idle" ? "idle" : "flowing";
    return `<path class="wire ${cls}" d="M${x0} ${y0}C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}"/>` +
      (a === "core" && b === "screens" ? `<g class="gate" transform="translate(${mid} ${(y0 + y1) / 2})"><a href="#access"><rect x="-8" y="-9" width="16" height="18" rx="5"/><path d="M-3.5-1v-2.2a3.5 3.5 0 0 1 7 0V-1M-5-1h10v7h-10z"/><title>${access}: who can see the screens</title></a></g>` : "") +
      (a === "receiver" ? `<text class="wire-lab" x="${mid}" y="${(y0 + y1) / 2 - 7}" text-anchor="middle">${/18080/.test(JSON.stringify(value("source", "urls"))) ? "tunnel" : ""}</text>` : "");
  }).join("");
}

export default {
  id: "home", get title() { return TITLES.home; }, icon: "home",
  async draw(page) {
    const list = problems();
    const major = list.find((f) => f.major && f.state === "fail");
    const p = house() || {};
    const title = major ? "Not working" : list.length ? plural(list.length, "open problem") : "Everything is working";
    const line = major ? esc(major.summary)
      : `${p.status?.ok ? `${plural(p.aircraft, "aircraft")} in range, from ${esc(p.status.source || "the feeds")} ${ago(p.status.updated)}` : "No positions arriving"}. CloudWall checks itself every 30 seconds.`;
    page.append(head(title, line));

    const map = el(`<section class="system" aria-label="Every part of CloudWall">${NODES.map(node).join("")}<svg class="wires" aria-hidden="true"></svg></section>`);
    page.append(map);
    const canvas = map.querySelector(".node-scope"), say = map.querySelector(".sky-say");
    const update = async () => {
      const st = await sky();
      if (!st) { say.textContent = "The board's data isn't answering"; return; }
      const n = (st.aircraft || []).filter((a) => !a.on_ground && a.dist <= st.tracking.radius_nm).length;
      say.textContent = `${plural(n, "aircraft")} within ${num(st.tracking.radius_nm, 1)} nm` + (st.hero ? `, ${st.hero.callsign || st.hero.hex} overhead` : "");
      const said = page.querySelector(".setup-said");
      if (said && !said.dataset.sky) { said.dataset.sky = "1"; said.innerHTML = `<header><h2>Setup</h2><a href="#settings">All settings</a></header>${setup()}`; }
    };
    update();
    // ask the receiver itself when it's set up but isn't feeding positions (slow, so not awaited)
    if (!ownFeed() && value("receiver", "url") && !S.receiver) call("receiver").then((r) => { S.receiver = r; this.tick(); }).catch(() => {});
    const t = setInterval(() => { if (!canvas.isConnected) clearInterval(t); else if (!document.hidden) update(); }, 5000);
    requestAnimationFrame(() => { scope(canvas, () => S.sky); wire(map); });
    new ResizeObserver(() => wire(map)).observe(map);
    this.tick = () => {
      if (!map.isConnected) return;
      for (const id of NODES.slice(1)) map.querySelector(`[data-node="${id}"]`)?.replaceWith(el(node(id)));
      wire(map);
    };

    if (list.length) {
      const needs = el(`<section class="needs"><h2>Open problems</h2></section>`);
      list.forEach((f) => needs.append(trouble(f)));
      page.append(needs);
    }

    const said = el(`<section class="setup-said"><header><h2>Setup</h2><a href="#settings">All settings</a></header>${setup()}</section>`);
    page.append(said);
    onPage("settings", () => { if (said.isConnected) said.innerHTML = `<header><h2>Setup</h2><a href="#settings">All settings</a></header>${setup()}`; });

    const lower = el(`<section class="home-lower">
      <div class="panel week"><h2>Last 7 days</h2><div class="week-chart"></div><p class="dim small">Each bar is a problem, from when it started to when it ended. <a href="#health">Health</a></p></div>
      <div class="panel doings"><h2>Actions</h2><div class="doings-list"></div></div></section>`);
    lower.querySelector(".week-chart").innerHTML = timeline(S.overview.incidents || [], 7);
    const doings = lower.querySelector(".doings-list");
    const last = S.overview.storage?.last_backup;
    doings.append(
      doing("logbook", "Back up now", last ? `Last backed up ${ago(last)}` : "Never backed up yet", button("Back up", async () => { const got = await call("backups", {}); toast(got.said); await loadOverview(); this.tick(); }, "small")),
      doing("problems", "Check the whole machine", "The settings, the service, every feed, backups, the tunnel and Caddy", button("Check", runDoctor, "small quiet")),
      doing("screens", "Open the wall", "The board as viewers see it", el(`<a class="btn small quiet" href="./" target="_blank" rel="noopener">Open${icon("open")}</a>`)),
      doing("look", "Open the wall panel", "The kiosk screen, as set on Display", el(`<a class="btn small quiet" href="kiosk" target="_blank" rel="noopener">Open${icon("open")}</a>`)),
    );
    page.append(lower);
  },
};

function doing(ico, title, sub, action) {
  const d = el(`<div class="doing">${icon(ico)}<div><b>${esc(title)}</b><span>${esc(sub)}</span></div></div>`);
  d.append(action);
  return d;
}
