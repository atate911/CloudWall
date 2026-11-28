// Coverage3D page: UI state, data loading, wiring between the API, the map and the plots.
import { $, esc, getJSON, store, haversineNm, bearingDeg, fmtDist, fmtBrg, fmtAlt, fmtTime, altColor, rgbCss, rgbHex, GROUND_COLOR, ALT_STOPS, RSSI_STOPS, UNIT_NM, clamp } from "./util.js";
import { MapView, BASEMAPS } from "./mapview.js";
import { drawVertical, drawPolar } from "./plots.js";

const KEY = "c3d.settings.v2", CAM = "c3d.camera.v1";
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const DEFAULTS = {
  basemap: "liberty", opacity: 0.6, exag: 5, style: "cake", smooth: true, units: "nm", range: "7d", cFrom: "", cTo: "", compare: false,
  aFrom: iso(new Date(today - 14 * 864e5)), aTo: iso(new Date(today - 7 * 864e5)), bFrom: iso(new Date(today - 7 * 864e5)), bTo: iso(today),
  stat: "p95", srcAdsb: true, srcMlat: false, srcUat: false, sector: 0, bandFt: 0,
  terrain: true, rings: true, minorRings: true, bearings: true, shadeBands: false, airports: true, peaks: true,
  fill: true, walls: false, outlines: true, footprint: false, horizon: false, readsbOutline: false,
  points: false, colorBy: "alt", live: true, liveLabels: true, bandLo: 0, bandHi: 99, hidden: [], polarBand: "all", panel: true, tab: "layers",
};
const S = { settings: { ...DEFAULTS, ...(store(KEY) || {}) } };
const st = {                       // everything the map needs
  settings: S.settings, station: null, cov: null, covB: null, points: null, live: [], outline: null, ref: null, maxR: 200, covKey: 0, visKey: "",
  isVisible: (b) => isVisible(b),
};
let cfg, mv, vert = null, camSaved = store(CAM);

function isVisible(b) {
  const s = S.settings;
  if (b.ground) return true;
  return b.index >= s.bandLo && b.index <= s.bandHi && !s.hidden.includes(b.index);
}
const save = () => store(KEY, S.settings);
const banner = (msg) => { const b = $("banner"); b.textContent = msg; b.hidden = !msg; if (msg) setTimeout(() => (b.hidden = true), 8000); };

// ---- API
function rangeQuery(prefix = "") {
  const s = S.settings, q = new URLSearchParams();
  const day = (v, end) => Math.floor(new Date(v + (end ? "T23:59:59" : "T00:00:00")).getTime() / 1000);
  if (s.range === "custom" && s.cFrom && s.cTo) { q.set("from", day(s.cFrom)); q.set("to", day(s.cTo, true)); }
  else if (s.range !== "all" && s.range !== "custom") q.set("last", { "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000 }[s.range]);
  return q;
}
function commonQuery(q) {
  const s = S.settings, src = [s.srcAdsb && "adsb", s.srcMlat && "mlat", s.srcUat && "uat"].filter(Boolean);
  q.set("source", src.join(",") || "adsb"); q.set("stat", s.stat);
  if (s.sector) q.set("sector", s.sector);
  if (s.bandFt) q.set("bands", s.bandFt);
  return q;
}
let seq = { cov: 0, pts: 0 };
async function loadCoverage() {
  const my = ++seq.cov, s = S.settings;
  try {
    let a, b = null;
    if (s.compare) {
      const day = (v, end) => Math.floor(new Date(v + (end ? "T23:59:59" : "T00:00:00")).getTime() / 1000);
      const q = commonQuery(new URLSearchParams({ a_from: day(s.aFrom), a_to: day(s.aTo, true), b_from: day(s.bFrom), b_to: day(s.bTo, true) }));
      const r = await getJSON("api/compare?" + q); a = r.a; b = r.b;
    } else a = await getJSON("api/coverage?" + commonQuery(rangeQuery()));
    if (my !== seq.cov) return;
    st.cov = a; st.covB = b; st.covKey++;
    st.maxR = clamp(Math.ceil(Math.max(200, a.summary.max_nm, b?.summary.max_nm || 0) / 50) * 50, 200, 400);
    renderBands(); renderStats(); drawPlots(); pushMap(true);
  } catch (e) { banner("Coverage: " + e.message); }
}
async function loadPoints() {
  if (!S.settings.points) { st.points = null; return pushMap(); }
  const my = ++seq.pts;
  try {
    let q = rangeQuery();
    if (S.settings.compare) { const day = (v, e) => Math.floor(new Date(v + (e ? "T23:59:59" : "T00:00:00")).getTime() / 1000); q = new URLSearchParams({ from: day(S.settings.aFrom), to: day(S.settings.aTo, true) }); }
    q.set("limit", 100000);
    q.set("source", commonQuery(new URLSearchParams()).get("source"));
    const p = await getJSON("api/points?" + q);
    if (my === seq.pts) { st.points = p; pushMap(); }
  } catch (e) { banner("Points: " + e.message); }
}
async function loadVertical() {
  try { vert = await getJSON("api/vertical?" + commonQuery(rangeQuery())); drawPlots(); } catch (e) { /* plot stays empty */ }
}
async function loadStats() {
  try {
    const d = await getJSON("api/stats?" + commonQuery(rangeQuery()));
    S.stats = d; renderStats();
  } catch (e) { /* ignore */ }
}
async function loadLive() {
  try {
    const d = await getJSON("api/live");
    st.live = d.aircraft; setStatus(d.up.every(Boolean) ? "ok" : "bad", d.up.every(Boolean) ? "feed OK" : "readsb feed unavailable");
    if (S.settings.live) pushMap();
  } catch (e) { setStatus("bad", "cannot reach the Pi"); }
}
async function loadOutline() {
  if (!S.settings.readsbOutline) { st.outline = null; return pushMap(); }
  try { const o = await getJSON("api/outline"); st.outline = o?.actualRange?.last24h?.points || null; pushMap(); } catch (e) { /* none */ }
}
function setStatus(cls, title) { const e = $("status"); e.className = cls; e.title = title; }
const refreshAll = () => { loadCoverage(); loadPoints(); loadVertical(); loadStats(); loadOutline(); };

// ---- map glue
function pushMap(statics = false) {
  st.visKey = [S.settings.bandLo, S.settings.bandHi, S.settings.hidden.join(".")].join("|");
  st.settings = S.settings;
  mv?.update({ ...st }, statics);
  renderLegend();
}
function nearestPlace(lat, lon) {
  let best = null, bd = 1e9;
  for (const p of [...(st.ref?.places || []), ...(st.ref?.airports || []).map((a) => ({ name: `${a.name} (${a.code})`, lat: a.lat, lon: a.lon })), ...(st.ref?.peaks || [])]) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { name: best.name, nm: bd } : null;
}
function readout(ll) {
  const s = st.station, d = haversineNm(s.lat, s.lon, ll.lat, ll.lng), b = bearingDeg(s.lat, s.lon, ll.lat, ll.lng), n = nearestPlace(ll.lat, ll.lng);
  $("readout").textContent = `${Math.round(d)} nm · ${Math.round(d * UNIT_NM.mi)} mi · ${Math.round(d * UNIT_NM.km)} km, bearing ${fmtBrg(b)}` + (n ? `, near ${n.name} (${Math.round(n.nm)} nm)` : "");
}
function showInfo(html, x, y) {
  const i = $("info");
  i.innerHTML = `<button class="x" aria-label="close">×</button>` + html;
  i.hidden = false;
  i.style.left = clamp(x + 12, 4, innerWidth - 300) + "px"; i.style.top = clamp(y + 12, 50, innerHeight - 180) + "px";
  i.querySelector(".x").onclick = () => (i.hidden = true);
}
async function onClick(info) {
  const s = st.station, x = info.x ?? 100, y = info.y ?? 100;
  if (info.kind === "band") {
    const [lon, lat] = info.coordinate, b = info.object.band, brg = bearingDeg(s.lat, s.lon, lat, lon), sec = Math.floor(brg / st.cov.sector_deg);
    const sc = b.sectors.find((q) => q.s === sec), u = S.settings.units;
    const head = `<b class="t">${b.lo_ft.toLocaleString()}–${b.hi_ft.toLocaleString()} ft</b>`;
    if (!sc) return showInfo(head + `Bearing ${fmtBrg(brg)}: no coverage recorded in this sector.`, x, y);
    showInfo(`${head}Bearing ${sc.brg0}°–${sc.brg1}°<br>${st.cov.stat === "max" ? "Max" : "95th pct"} range: <b>${fmtDist(sc.dist_nm, u)}</b> (p95 ${sc.p95_nm} nm, max ${sc.max_nm} nm)<br>${sc.count.toLocaleString()} points · median ${sc.rssi_med ?? "–"} dBFS · weakest ${sc.rssi_min ?? "–"} dBFS<br>${fmtTime(sc.first)} → ${fmtTime(sc.last)}`, x, y);
  } else if (info.kind === "point") {
    const P = st.points, i = info.object;
    let name = ""; try { name = (await getJSON("api/aircraft?hex=" + P.hex[i])).callsign || ""; } catch (e) { /* none */ }
    showInfo(`<b class="t">${esc(name || P.hex[i])}</b>${esc(P.hex[i])}<br>${fmtTime(P.t[i])}<br>${fmtAlt(P.alt[i])} · ${fmtDist(P.dist[i], S.settings.units)}<br>RSSI ${P.rssi[i] ?? "–"} dBFS`, x, y);
  } else if (info.kind === "live") {
    const a = info.object;
    showInfo(`<b class="t">${esc(a.flight || a.hex)}</b>${esc(a.hex)} ${esc(a.t || "")}<br>${fmtAlt(a.alt_geom ?? a.alt_baro)} · ${a.gs ? Math.round(a.gs) + " kt" : ""}<br>${a.r_dst != null ? fmtDist(a.r_dst, S.settings.units) + " · " : ""}RSSI ${a.rssi ?? "–"} dBFS`, x, y);
  }
}

// ---- panels
function renderLegend() {
  const s = S.settings, g = (stops) => `linear-gradient(90deg,${stops.map((c) => rgbCss(c)).join(",")})`;
  let h = `<b>Altitude</b><div class="bar" style="background:${g(ALT_STOPS)}"></div><div class="ticks"><span>0</span><span>15k</span><span>30k</span><span>45k ft</span></div>`;
  h += `<div class="ln"><i style="border-color:${rgbCss(GROUND_COLOR)}"></i> ground (footprint only)</div>`;
  if (s.points && s.colorBy === "rssi") h += `<b style="display:block;margin-top:6px">Signal</b><div class="bar" style="background:${g(RSSI_STOPS)}"></div><div class="ticks"><span>-33</span><span>-18</span><span>-3 dBFS</span></div>`;
  if (st.covB) h += `<div class="ln"><i style="border-color:currentColor"></i> A: ${s.aFrom} – ${s.aTo}</div><div class="ln"><i style="border-color:currentColor;border-top-style:dashed"></i> B: ${s.bFrom} – ${s.bTo}</div>`;
  $("legend").innerHTML = h;
}
function renderBands() {
  const cov = st.cov, nb = cov.n_bands, s = S.settings;
  for (const id of ["bandLo", "bandHi"]) $(id).max = nb - 1;
  // shown tiers are stored as indexes: reset them when the tier height changes
  if (s.bandsOf && s.bandsOf !== cov.band_ft) { s.bandLo = 0; s.bandHi = nb - 1; s.hidden = []; }
  s.bandsOf = cov.band_ft;
  s.bandLo = clamp(s.bandLo, 0, nb - 1); s.bandHi = clamp(s.bandHi, 0, nb - 1);
  $("bandLo").value = s.bandLo; $("bandHi").value = s.bandHi;
  const bf = cov.band_ft;
  $("band-out").textContent = `${(s.bandLo * bf).toLocaleString()}–${((s.bandHi + 1) * bf).toLocaleString()} ft`;
  const have = new Map(cov.bands.map((b) => [b.index, b]));
  let html = "";
  for (let i = nb - 1; i >= -1; i--) {
    const b = have.get(i); if (i < 0 && !b) continue;
    const c = i < 0 ? GROUND_COLOR : altColor(i * bf + bf / 2), lbl = i < 0 ? "ground" : `${((i * bf) / 1000).toFixed(bf % 1000 ? 1 : 0)}–${(((i + 1) * bf) / 1000).toFixed(bf % 1000 ? 1 : 0)}k`;
    html += `<label style="${b ? "" : "opacity:.45"}"><input type="checkbox" data-band="${i}" ${i < 0 || !s.hidden.includes(i) ? "checked" : ""} ${i < 0 ? "disabled" : ""}><i style="background:${rgbHex(c)}"></i>${lbl}</label>`;
  }
  $("bandlist").innerHTML = html;
  const sel = $("polarBand"), prev = s.polarBand;
  sel.innerHTML = `<option value="all">All bands (best)</option>` + [...have.values()].filter((b) => !b.ground).map((b) => `<option value="${b.index}">${b.lo_ft.toLocaleString()}–${b.hi_ft.toLocaleString()} ft</option>`).join("") + (have.has(-1) ? `<option value="-1">Ground</option>` : "");
  sel.value = [...sel.options].some((o) => o.value === String(prev)) ? prev : "all";
}
function renderStats() {
  const cov = st.cov, d = S.stats, u = S.settings.units; if (!cov) return;
  const f = (nm) => fmtDist(nm, u);
  let h = `<dl><dt>Points in range</dt><dd>${(d?.range.points ?? cov.summary.points).toLocaleString()}</dd><dt>Aircraft seen</dt><dd>${d?.range.aircraft?.toLocaleString() ?? "–"}</dd>`
    + `<dt>Maximum range</dt><dd>${f(cov.summary.max_nm)}</dd>`
    + `<dt>Best bearing</dt><dd>${cov.summary.best_sector == null ? "–" : `${fmtBrg(cov.summary.best_sector + cov.sector_deg / 2)} (${f(cov.summary.best_nm)})`}</dd>`
    + `<dt>Worst bearing</dt><dd>${cov.summary.worst_sector == null ? "–" : `${fmtBrg(cov.summary.worst_sector + cov.sector_deg / 2)} (${f(cov.summary.worst_nm)})`}</dd></dl>`;
  const rx = d?.receiver;
  if (rx && !rx.error) h += `<dl><dt>Message rate</dt><dd>${rx.msg_per_s?.toFixed(0)} /s</dd><dt>Signal / noise</dt><dd>${rx.signal_dbfs?.toFixed?.(1)} / ${rx.noise_dbfs?.toFixed?.(1)} dBFS</dd><dt>Strong signals</dt><dd>${rx.strong_pct == null ? "–" : rx.strong_pct.toFixed(1) + " %"}</dd><dt>Gain</dt><dd>${rx.gain_db ?? "–"} dB</dd><dt>Decoder max (1 min)</dt><dd>${rx.max_distance_nm == null ? "–" : f(rx.max_distance_nm)}</dd></dl>`;
  else if (rx) h += `<p class="hint">Receiver stats unavailable: ${esc(rx.error)}</p>`;
  h += `<table><tr><th>Band</th><th>${cov.stat === "max" ? "max" : "p95"}</th><th>max</th><th>n</th></tr>`;
  for (const b of [...cov.bands].reverse()) {
    const m = Math.max(...b.sectors.map((s) => s.dist_nm)), mx = Math.max(...b.sectors.map((s) => s.max_nm)), n = b.sectors.reduce((a, s) => a + s.count, 0);
    h += `<tr><td>${b.ground ? "ground" : `${b.lo_ft / 1000}–${b.hi_ft / 1000}k`}</td><td>${f(m)}</td><td>${f(mx)}</td><td>${n.toLocaleString()}</td></tr>`;
  }
  h += `</table>`;
  if (d?.recorder) h += `<p class="hint">Recorder: ${d.total_points_db.toLocaleString()} points stored, ${d.recorder.buffered} buffered. Rejected: ${Object.entries(d.recorder.rejects).filter(([k]) => !k.startsWith("reject_duplicate")).map(([k, v]) => `${k.replace("reject_", "")} ${v}`).join(", ") || "none"}.</p>`;
  $("stats").innerHTML = h;
}
function drawPlots() {
  if (S.settings.tab !== "insights" || !st.cov) return;
  drawVertical($("plot-vert"), vert, S.settings.units);
  const bi = $("polarBand").value || "all";
  drawPolar($("plot-polar"), st.cov, st.covB, bi, S.settings.units, bi === "all" ? [11, 100, 214] : bi === "-1" ? GROUND_COLOR : altColor(+bi * st.cov.band_ft + st.cov.band_ft / 2));
}

// ---- UI wiring
function bindCheck(id, after) {
  const el = $(id); el.checked = !!S.settings[id];
  el.onchange = () => { S.settings[id] = el.checked; save(); after ? after() : pushMap(true); };
}
function bindSeg(id, after) {
  const el = $(id), set = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(S.settings[id]) === b.dataset.v));
  el.onclick = (e) => { const v = e.target.dataset?.v; if (v == null) return; S.settings[id] = isNaN(+v) ? v : +v; save(); set(); after(); };
  set();
}
function bindSel(id, after, num = false) {
  const el = $(id); el.value = S.settings[id];
  el.onchange = () => { S.settings[id] = num ? +el.value : el.value; save(); after(); };
}
function bindDate(id, after) { const el = $(id); el.value = S.settings[id] || ""; el.onchange = () => { S.settings[id] = el.value; save(); after(); }; }

async function init() {
  cfg = await getJSON("api/config");
  st.station = cfg.station;
  if (cfg.demo) $("demo-badge").hidden = false;
  st.ref = await getJSON("api/reference").catch(() => null);
  const s = S.settings;
  if (!s.sector) s.sector = cfg.coverage.sector_deg;
  if (!s.bandFt) s.bandFt = cfg.coverage.band_ft;
  if (!store(KEY)) s.stat = cfg.coverage.stat;

  // basemap list (offline only when the Pi serves a tile tree)
  const sel = $("basemap");
  for (const [id, b] of Object.entries(BASEMAPS)) if (!b.offline || cfg.offline_tiles) sel.add(new Option(b.label, id));
  if (!BASEMAPS[s.basemap]) s.basemap = "liberty";
  sel.value = s.basemap;
  sel.onchange = async () => { s.basemap = sel.value; save(); const cam = mv.camera(); await mv.create(s.basemap, cam, st.station); pushMap(true); };

  for (const id of ["terrain", "fill", "smooth", "walls", "outlines", "footprint", "horizon", "live", "liveLabels", "rings", "minorRings", "bearings", "shadeBands", "airports", "peaks"]) bindCheck(id);
  bindCheck("readsbOutline", () => { loadOutline(); pushMap(); });
  bindCheck("points", () => { loadPoints(); pushMap(); });
  for (const id of ["srcAdsb", "srcMlat", "srcUat"]) bindCheck(id, refreshAll);
  bindCheck("compare", () => { $("compare-box").hidden = !s.compare; refreshAll(); });
  $("compare-box").hidden = !s.compare;
  bindSeg("exag", () => pushMap()); bindSeg("style", () => pushMap(true)); bindSeg("units", () => { pushMap(true); renderStats(); drawPlots(); }); bindSeg("stat", refreshAll);
  bindSel("colorBy", () => pushMap());
  bindSel("range", () => { $("custom").hidden = s.range !== "custom"; refreshAll(); });
  $("custom").hidden = s.range !== "custom";
  for (const id of ["cFrom", "cTo", "aFrom", "aTo", "bFrom", "bTo"]) bindDate(id, refreshAll);
  bindSel("sector", refreshAll, true); bindSel("bandFt", refreshAll, true);
  bindSel("polarBand", drawPlots);
  const op = $("opacity"); op.value = Math.round(s.opacity * 100); $("opacity-out").textContent = op.value + " %";
  op.oninput = () => { s.opacity = op.value / 100; $("opacity-out").textContent = op.value + " %"; save(); pushMap(); };
  for (const id of ["bandLo", "bandHi"]) $(id).oninput = () => {
    s.bandLo = +$("bandLo").value; s.bandHi = +$("bandHi").value;
    if (id === "bandLo" && s.bandLo > s.bandHi) s.bandHi = s.bandLo; if (id === "bandHi" && s.bandHi < s.bandLo) s.bandLo = s.bandHi;
    save(); renderBands(); pushMap(true);
  };
  $("bandlist").onchange = (e) => {
    const i = +e.target.dataset.band, h = new Set(s.hidden);
    e.target.checked ? h.delete(i) : h.add(i);
    s.hidden = [...h]; save(); pushMap(true);
  };

  const tab = (t) => { s.tab = t; save(); document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== t)); drawPlots(); };
  $("tabs").onclick = (e) => e.target.dataset.tab && tab(e.target.dataset.tab);
  tab(s.tab);
  const panel = () => { $("panel").classList.toggle("hidden", !s.panel); $("btn-panel").setAttribute("aria-expanded", s.panel); };
  if (innerWidth < 760 && store(KEY)?.panel === undefined) s.panel = false;
  panel();
  $("btn-panel").onclick = () => { s.panel = !s.panel; save(); panel(); setTimeout(drawPlots, 50); };
  $("btn-2d").onclick = () => mv.view2D(); $("btn-3d").onclick = () => mv.view3D();
  $("btn-reset").onclick = () => mv.reset(st.station);
  $("btn-orbit").onclick = () => $("btn-orbit").classList.toggle("on", !!mv.toggleOrbit());
  addEventListener("resize", drawPlots);

  await waitLibs();
  mv = new MapView("map", { onHover: readout, onMapClick: (e) => { if (!e.defaultPrevented) { readout(e.lngLat); } }, onClick,
    onCamera: (c) => store(CAM, c), onError: banner });
  await mv.create(s.basemap, camSaved, st.station);
  if (!camSaved) mv.reset(st.station);
  pushMap(true);
  refreshAll(); loadLive();
  setInterval(loadLive, 2000);
  setInterval(() => { loadCoverage(); loadPoints(); loadVertical(); loadOutline(); }, 60000);
  setInterval(loadStats, 10000);
  window.__c3d = { S, st, mv: () => mv };        // handy in the browser console
}
function waitLibs() {
  return new Promise((res, rej) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.maplibregl) { clearInterval(t); res(); }
      else if (++n > 200) { clearInterval(t); banner("Could not load MapLibre from the CDN (is the Pi online?)"); rej(new Error("maplibre missing")); }
    }, 50);
  });
}
init().catch((e) => { console.error(e); banner(e.message); });
