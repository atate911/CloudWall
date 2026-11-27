// The wall: how the screens look. The wall panel is shown live, as it is now, and changes as its
// settings do (before the restart that makes them its own); quiet hours are an arc on a day's dial;
// map styles are chosen by looking at the house's own map in each. The layers drawn on the radar
// are switches with what each shows; the maps seldom changed and the downloads wait under shades.
import { el, esc, S, sky, setting, value, num } from "../core.js";
import { icon } from "../icons.js";
import { tileAt } from "../map.js";
import { head, pageTroubles } from "../parts.js";
import { pictures, segmented, toggle, slider, stepper, text, secret, shade, group, custom, select } from "../controls.js";

const VIEWS = {
  card: { label: "The flight card", art: `<svg viewBox="0 0 120 68"><rect class="a-scr" x="1" y="1" width="118" height="66" rx="5"/><path class="a-ink" d="M14 18h48M14 27h30"/><path class="a-dim" d="M14 44h80M14 52h64"/><path class="a-plane" d="M92 14l4 4-9 6 2 12-3 2-5-10-6 6 .6 4-2 2-2.6-5.4L65 33l2-2 4 .6 6-6-10-5 2-3 12 2z"/></svg>` },
  radar: { label: "Radar beside it", art: `<svg viewBox="0 0 120 68"><rect class="a-scr" x="1" y="1" width="118" height="66" rx="5"/><path class="a-ink" d="M10 16h34M10 24h22"/><path class="a-dim" d="M10 40h36M10 48h28"/><circle class="a-ring" cx="86" cy="34" r="26"/><circle class="a-ring" cx="86" cy="34" r="13"/><circle class="a-dot" cx="96" cy="24" r="2.4"/><circle class="a-dot" cx="74" cy="44" r="2.4"/><circle class="a-hot" cx="88" cy="31" r="3"/></svg>` },
  map: { label: "Map beside it", art: `<svg viewBox="0 0 120 68"><rect class="a-scr" x="1" y="1" width="118" height="66" rx="5"/><path class="a-ink" d="M10 16h34M10 24h22"/><path class="a-dim" d="M10 40h36M10 48h28"/><rect class="a-map" x="58" y="6" width="56" height="56" rx="3"/><path class="a-road" d="M58 40c14-6 22 4 56-12M78 6c2 20-6 34 4 56"/><circle class="a-hot" cx="88" cy="31" r="3"/></svg>` },
  sky: { label: "The sky beside it", art: `<svg viewBox="0 0 120 68"><rect class="a-scr" x="1" y="1" width="118" height="66" rx="5"/><path class="a-ink" d="M10 16h34M10 24h22"/><path class="a-dim" d="M10 40h36M10 48h28"/><path class="a-ring" d="M56 58a30 30 0 0 1 60 0z"/><path class="a-dim" d="M60 58q26-40 52 0"/><circle class="a-hot" cx="90" cy="34" r="3"/></svg>` },
};
const STYLES = [
  ["dark", "Dark streets", "dark", 11], ["light", "Light streets", "light", 11], ["satellite", "Satellite", "sat", 11], ["streets", "Streets", "streets", 11],
  ["osm", "OpenStreetMap", "osm", 11], ["sectional", "VFR sectional", "sectional", 10], ["terminal", "VFR terminal", "terminal", 11],
  ["ifr-low", "IFR low", "ifr-low", 9], ["ifr-high", "IFR high", "ifr-high", 8], ["off", "No map", null, 0],
];

function art(layer, z, home) {
  if (!layer || home?.lat == null) return `<span class="no-map">${icon("positions")}</span>`;
  return `<img src="${tileAt(layer, home.lat, home.lon, z)}" alt="" loading="lazy" decoding="async"><svg class="pic-rings" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="20"/></svg>`;
}

// -- the wall panel, live ---------------------------------------------------------------------------
function preview() {
  const box = el(`<figure class="panel-preview"><div class="bezel"><div class="screen"><iframe title="The wall panel, as it is now" tabindex="-1" aria-hidden="true"></iframe></div></div>
    <figcaption><span class="live-dot"></span>The wall panel now, with the settings beside it<a class="out" href="kiosk" target="_blank" rel="noopener">Open it${icon("open")}</a></figcaption></figure>`);
  const frame = box.querySelector("iframe"), screen = box.querySelector(".screen");
  const fit = () => { const w = screen.clientWidth; frame.style.transform = `scale(${w / 1280})`; screen.style.height = `${w * 720 / 1280}px`; };
  new ResizeObserver(fit).observe(screen);
  let want = {}, timer = null;
  box.show = (over = {}) => {
    want = { ...want, ...over };
    const v = (k, d) => want[k] ?? value("kiosk", k) ?? d;
    const q = new URLSearchParams({ view: v("view", "card"), radar: v("radar", "chart"), tracks: v("tracks", true) ? "on" : "off", density: v("density", "simple") });
    if (+v("range_nm", 0)) q.set("range", v("range_nm", 0));
    const src = `kiosk?${q}`;
    clearTimeout(timer);
    timer = setTimeout(() => { if (frame.getAttribute("src") !== src) frame.setAttribute("src", src); }, 150);
  };
  return box;
}

/** Quiet hours as an arc on a day's dial: drag either end; the middle says it in words and turns it
 *  off and on. Snaps to quarter hours. Stored as "23:00-06:30", or empty for none. */
function quietDial() {
  const R = 74, C = 100, toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const xy = (m, r = R) => { const a = m / 1440 * 2 * Math.PI; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
  const wrap = el(`<div class="dial"><svg viewBox="0 0 200 200" role="group" aria-label="Quiet hours on a 24-hour dial"></svg><div class="dial-say"></div></div>`);
  const svg = wrap.querySelector("svg"), say = wrap.querySelector(".dial-say");
  let range = null, last = [23 * 60, 6 * 60 + 30], drag = null;
  const parse = (v) => { const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(v || ""); return m ? [toMin(m[1]), toMin(m[2])] : null; };
  const paint = () => {
    const ticks = Array.from({ length: 24 }, (_, h) => { const [x0, y0] = xy(h * 60, R + 12), [x1, y1] = xy(h * 60, R + (h % 6 ? 16 : 20)); return `<path class="d-tick ${h % 6 ? "" : "major"}" d="M${x0} ${y0}L${x1} ${y1}"/>`; }).join("");
    const labels = [[0, "midnight"], [360, "6"], [720, "noon"], [1080, "18"]].map(([m, t]) => { const [x, y] = xy(m, R + 30); return `<text class="d-lab" x="${x}" y="${y + 3}" text-anchor="middle">${t}</text>`; }).join("");
    let arc = "";
    if (range) {
      const [a, b] = range, len = (b - a + 1440) % 1440 || 1440, [x0, y0] = xy(a), [x1, y1] = xy(b);
      arc = `<path class="d-arc" d="M${x0} ${y0}A${R} ${R} 0 ${len > 720 ? 1 : 0} 1 ${x1} ${y1}"/>
        <g class="d-hdl" data-end="0" transform="translate(${x0} ${y0})" tabindex="0" role="slider" aria-label="Quiet from" aria-valuetext="${fmt(a)}"><circle r="11"/><path d="M-3.5 0h7" /></g>
        <g class="d-hdl" data-end="1" transform="translate(${x1} ${y1})" tabindex="0" role="slider" aria-label="Quiet until" aria-valuetext="${fmt(b)}"><circle r="11"/><path d="M-3.5 0h7"/></g>`;
    }
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes(), [nx, ny] = xy(nm, R - 14);
    svg.innerHTML = `<circle class="d-face" cx="${C}" cy="${C}" r="${R}"/>${ticks}${labels}${arc}<path class="d-now" d="M${C} ${C}L${nx} ${ny}"/><circle class="d-hub" cx="${C}" cy="${C}" r="3"/>`;
    if (range) {
      const len = ((range[1] - range[0] + 1440) % 1440) / 60;
      say.innerHTML = `<b>${fmt(range[0])} to ${fmt(range[1])}</b><span>${num(len, 1)} hours dim</span><button type="button" class="link">Never go quiet</button>`;
      say.querySelector("button").onclick = () => { last = range; range = null; paint(); wrap.node.commit(""); };
    } else {
      say.innerHTML = `<b>Always awake</b><span>no quiet hours</span><button type="button" class="link">Go quiet at night</button>`;
      say.querySelector("button").onclick = () => { range = last; paint(); wrap.node.commit(`${fmt(range[0])}-${fmt(range[1])}`); };
    }
  };
  const minuteAt = (e) => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 200 - C, y = (e.clientY - r.top) / r.height * 200 - C;
    return Math.round(((Math.atan2(x, -y) / (2 * Math.PI) * 1440 + 1440) % 1440) / 15) * 15 % 1440; };
  svg.addEventListener("pointerdown", (e) => { const h = e.target.closest(".d-hdl"); if (!h) return; drag = +h.dataset.end; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener("pointermove", (e) => { if (drag === null) return; range[drag] = minuteAt(e); paint(); });
  const drop = () => { if (drag === null) return; drag = null; wrap.node.commit(`${fmt(range[0])}-${fmt(range[1])}`); };
  svg.addEventListener("pointerup", drop); svg.addEventListener("pointercancel", drop);
  svg.addEventListener("keydown", (e) => {
    const h = e.target.closest(".d-hdl"), d = { ArrowUp: 15, ArrowRight: 15, ArrowDown: -15, ArrowLeft: -15 }[e.key];
    if (!h || !d) return;
    e.preventDefault(); const end = +h.dataset.end; range[end] = (range[end] + d + 1440) % 1440; paint();
    svg.querySelector(`[data-end="${end}"]`)?.focus();
    clearTimeout(wrap.kb); wrap.kb = setTimeout(() => wrap.node.commit(`${fmt(range[0])}-${fmt(range[1])}`), 700);
  });
  wrap.render = () => { range = parse(setting("kiosk", "quiet").value); if (range) last = range; paint(); };
  return custom("kiosk", "quiet", { label: "Quiet hours", cls: "is-dial", says: (v) => v ? "Only a dim clock and what's next, waking for anything coming over, an emergency or a tap." : "" }, wrap);
}

export default {
  id: "look", title: "The wall", icon: "look",
  live() {
    const v = value("kiosk", "view"), st = value("map", "style");
    return v ? `${STYLES.find((s) => s[0] === st)?.[1] || st} map; panel: ${VIEWS[v]?.label.toLowerCase() || v}` : "";
  },
  async draw(page) {
    const home = (S.sky || await sky())?.home;
    page.append(head("The wall", "How the screens look: the wall panel, the map under the radar, and what's drawn on it."));
    const t = pageTroubles("look");
    if (t) page.append(t);

    // the wall panel: the picture and its settings side by side
    const pv = preview();
    const panel = el(`<section class="panel-hero"><div class="panel-left"></div><div class="panel-right"></div></section>`);
    panel.querySelector(".panel-left").append(pv, quietDial());
    const places = (S.overview.places || []).map((p, i) => [i ? p.name : "", i ? p.name : `${p.name} (the house)`]);
    panel.querySelector(".panel-right").append(...[
      pictures("kiosk", "view", { label: "What the wall panel shows", options: Object.entries(VIEWS).map(([v, o]) => ({ value: v, label: o.label, art: o.art })), cls: "views", preview: (v) => pv.show({ view: v }),
        says: (v) => v === "card" ? "The aircraft overhead fills the screen; between aircraft, what's next." : "The flight card on one side; on the other, " + { radar: "the radar.", map: "the map.", sky: "the sky as you'd look up at it." }[v] }),
      segmented("kiosk", "radar", { label: "Radar drawn as", options: [["chart", "A chart"], ["atc", "An ATC screen"]], preview: (v) => pv.show({ radar: v }) }),
      segmented("kiosk", "range_nm", { label: "Radar reaches", options: [[0, `${num(value("tracking", "radius_nm"), 1)} nm`], [20, "20 nm"], [30, "30 nm"]], preview: (v) => pv.show({ range_nm: v }), says: (v) => +v ? "" : "The tracking radius, set on The house." }),
      segmented("kiosk", "density", { label: "Labels", options: [["simple", "What matters"], ["detailed", "Every aircraft"]], preview: (v) => pv.show({ density: v }) }),
      toggle("kiosk", "tracks", { label: "Tracks", on: "The selected aircraft's track, and where each will be in a minute.", off: "Aircraft only, no lines.", preview: (v) => pv.show({ tracks: v }) }),
      places.length > 1 ? select("kiosk", "place", { label: "Which place", options: places }) : null,
    ].filter(Boolean));
    page.append(panel);
    pv.show();

    // the map under the radar, chosen by looking at it
    const opacityShow = (v) => page.querySelector(".styles")?.style.setProperty("--map-strength", v);
    page.append(group("The map under the radar", "On every screen's chart-style radar. Each picture is your own area in that style.", [
      pictures("map", "style", { label: "Map", cls: "styles", options: STYLES.map(([v, label, layer, z]) => ({ value: v, label, art: art(layer, z, home) })),
        says: (v) => ["sectional", "terminal", "ifr-low", "ifr-high"].includes(v) ? "An FAA chart: the airspace, airways and airports as pilots see them." : v === "off" ? "The radar alone, rings and aircraft." : "" }),
      slider("map", "opacity", { label: "How strongly it shows", min: 10, max: 100, step: 5, scale: 100, format: (v) => `${v}%`, preview: opacityShow, says: (v) => v < 0.35 ? "Faint: the aircraft stand out." : v > 0.7 ? "Strong: the map competes with the aircraft." : "" }),
    ]));
    opacityShow(value("map", "opacity"));

    // what's drawn on the radar: switches, three across
    page.append(group("Drawn on the radar too", "Free data, fetched only while a screen is open.", [
      el(`<div class="switch-row"></div>`),
    ]));
    page.querySelector(".switch-row").append(
      toggle("extras", "military", { label: "Military nearby", labelHtml: `${icon("military")} Military nearby`, on: "Military jets that send their height but no position, listed beside the radar.", off: "" }),
      toggle("extras", "tfr", { label: "Flight restrictions", labelHtml: `${icon("tfr")} Flight restrictions`, on: "The FAA's temporary flight restrictions, on the radar and the weather.", off: "" }),
      toggle("extras", "contrails", { label: "Contrail forecast", labelHtml: `${icon("contrail")} Contrail forecast`, on: "Whether aircraft overhead will leave trails, from the upper air's cold and damp.", off: "" }),
      toggle("logos", "enabled", { label: "Airline logos", labelHtml: `${icon("logo")} Airline logos`, on: "On the flight card, downloaded once per airline.", off: "" }),
    );

    page.append(shade("The other maps", () => `the route over ${STYLES.find((s) => s[0] === value("map", "route"))?.[1].toLowerCase() || value("map", "route")}; ${value("map", "atc") && value("map", "atc") !== "off" ? `the ATC radar over the ${STYLES.find((s) => s[0] === value("map", "atc"))?.[1] || value("map", "atc")} chart` : "nothing under the ATC radar"}`, [
      pictures("map", "route", { label: "Behind the flight card's route", cls: "styles small", options: STYLES.filter(([v]) => ["satellite", "light", "dark", "streets", "osm", "off"].includes(v)).map(([v, label, layer]) => ({ value: v, label, art: art(layer, 5, home) })) }),
      pictures("map", "atc", { label: "Under the ATC-style radar", cls: "styles small", options: STYLES.filter(([v]) => ["off", "ifr-low", "ifr-high", "sectional", "terminal"].includes(v)).map(([v, label, layer, z]) => ({ value: v, label: v === "off" ? "Nothing (as a controller's)" : label, art: art(layer, z, home) })) }),
    ]));
    page.append(shade("Distances and sources", () => `military within ${value("extras", "military_radius_nm")} nm; restrictions within ${value("extras", "tfr_radius_nm")} nm${value("map", "url")?.set ? "; own tile service" : ""}`, [
      stepper("extras", "military_radius_nm", { label: "Military within", step: 5, min: 5, max: 250 }),
      stepper("extras", "tfr_radius_nm", { label: "Restrictions within", step: 5, min: 5, max: 250 }),
      text("extras", "military_url", { label: "Military feed", mono: true }),
      text("logos", "url", { label: "Logo source", mono: true }),
      secret("map", "url", { label: "Another tile service", unsetLabel: "None: the maps above", add: "Use one", placeholder: "https://…/{z}/{x}/{y}.png" }),
      text("map", "attribution", { label: "Its credit", empty: "None" }),
    ]));
  },
};
