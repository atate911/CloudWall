// The house on a map, with what its distances mean drawn where they reach: the tracking radius and
// the overhead circle as rings around it, each with a handle to drag it bigger or smaller, the
// airport where it is, and the aircraft in range now. The map is CloudWall's own tiles (/tiles/...,
// fetched and cached by the server, only around places it watches); without them, a plain chart.
import { el, esc, num } from "./core.js";
import { distBrg } from "./draw.js";

const TILE = 256;
const world = (lat, lon, z) => {
  const s = TILE * 2 ** z, φ = lat * Math.PI / 180;
  return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * s];
};
const unworld = (x, y, z) => {
  const s = TILE * 2 ** z, lon = x / s * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / s;
  return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
};

/**
 * opt: { lat, lon, layer, rings: [{ id, nm, cls, label, min, max, step, onDrag(nm), onDrop(nm) }],
 *        airport: {lat, lon, icao}, fit (nm to fit across the narrower side), onPick(lat, lon) }
 * Returns the element; .update(opt) redraws with new values; .aircraft(list) draws traffic.
 */
export function houseMap(opt) {
  const box = el(`<div class="hmap" role="application" aria-label="The house on a map">
    <div class="hmap-tiles"></div><svg class="hmap-over"></svg><div class="hmap-credit"></div></div>`);
  const tiles = box.querySelector(".hmap-tiles"), over = box.querySelector("svg");
  let o = { ...opt }, traffic = [], view = null, dragging = null, picking = false;

  function layout() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return null;
    const fitNm = o.fit || Math.max(...o.rings.map((r) => r.nm)) * 2.5;
    const mpp = fitNm * 1852 / Math.min(w, h);                       // metres per pixel wanted
    const zf = Math.log2(156543.034 * Math.cos(o.lat * Math.PI / 180) / mpp);
    const z = Math.max(6, Math.min(16, Math.floor(zf))), scale = 2 ** (Math.min(17, zf) - z);
    const [cx, cy] = world(o.lat, o.lon, z);
    return { w, h, z, scale, cx, cy, ppn: 1852 / (156543.034 * Math.cos(o.lat * Math.PI / 180) / 2 ** (z + Math.log2(scale))) };
  }
  const project = (lat, lon) => { const [x, y] = world(lat, lon, view.z); return [view.w / 2 + (x - view.cx) * view.scale, view.h / 2 + (y - view.cy) * view.scale]; };

  function drawTiles() {
    const { w, h, z, scale, cx, cy } = view, ts = TILE * scale;
    const x0 = Math.floor((cx - w / 2 / scale) / TILE), x1 = Math.floor((cx + w / 2 / scale) / TILE);
    const y0 = Math.floor((cy - h / 2 / scale) / TILE), y1 = Math.floor((cy + h / 2 / scale) / TILE);
    const want = new Set();
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      const key = `${z}/${tx}/${ty}`;
      want.add(key);
      let img = tiles.querySelector(`[data-k="${key}"]`);
      if (!img) {
        img = new Image();
        img.dataset.k = key; img.alt = ""; img.decoding = "async"; img.draggable = false;
        img.onerror = () => { img.remove(); box.classList.add("no-tiles"); };
        img.onload = () => img.classList.add("in");
        img.src = `tiles/${o.layer}/${key}`;
        tiles.append(img);
      }
      Object.assign(img.style, { left: `${w / 2 + (tx * TILE - cx) * scale}px`, top: `${h / 2 + (ty * TILE - cy) * scale}px`, width: `${ts + .5}px`, height: `${ts + .5}px` });
    }
    tiles.querySelectorAll("img").forEach((img) => { if (!want.has(img.dataset.k)) img.remove(); });
  }

  function drawOver() {
    const { w, h, ppn } = view, [hx, hy] = [w / 2, h / 2];
    const ap = o.airport && o.airport.lat != null ? project(o.airport.lat, o.airport.lon) : null;
    over.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const rings = o.rings.map((r) => {
      const rp = r.nm * ppn, ang = (r.handleAt ?? 125) * Math.PI / 180, hxp = hx + Math.sin(ang) * rp, hyp = hy - Math.cos(ang) * rp;
      // the label on the handle's outer side, unless that runs off the map
      const right = Math.sin(ang) >= 0 ? hxp + 130 < w : hxp - 130 < 0;
      return `<g class="ring ${r.cls}" data-ring="${r.id}">
        <circle class="ring-line" cx="${hx}" cy="${hy}" r="${rp}"/>
        <circle class="ring-hit" cx="${hx}" cy="${hy}" r="${rp}"/>
        <g class="ring-handle" transform="translate(${hxp} ${hyp})" tabindex="0" role="slider" aria-label="${esc(r.label)}" aria-valuenow="${r.nm}" aria-valuemin="${r.min}" aria-valuemax="${r.max}" aria-valuetext="${num(r.nm, 1)} nautical miles">
          <circle r="13" class="hdl-halo"/><circle r="7.5" class="hdl"/>
          <text class="ring-tag" x="${right ? 16 : -16}" y="4" text-anchor="${right ? "start" : "end"}">${esc(r.label)} ${num(r.nm, 1)} nm</text>
        </g></g>`;
    }).join("");
    const planes = traffic.filter((a) => !a.on_ground && a.lat != null).map((a) => {
      const [x, y] = project(a.lat, a.lon);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) return "";
      return `<g class="ac ${a.hero ? "hero" : ""}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.track || 0})"><path d="M0 -6 4.5 5 0 2.5 -4.5 5z"/></g>`;
    }).join("");
    over.innerHTML = `${ap ? `<g class="apt" transform="translate(${ap[0]} ${ap[1]})"><rect x="-5" y="-5" width="10" height="10" rx="2"/><text y="-10" text-anchor="middle">${esc(o.airport.icao || "")}</text></g>` : ""}
      ${rings}${planes}
      <g class="house" transform="translate(${hx} ${hy})"><circle r="16" class="house-halo"/><path d="M-6.5 1.5 0-5l6.5 6.5V7h-13z" class="house-mark"/></g>`;
  }

  function draw() {
    view = layout();
    if (!view) return;
    drawTiles(); drawOver();
    box.querySelector(".hmap-credit").textContent = o.credit || "";
  }

  // dragging a ring's handle (or its line) sets its distance; snapped to its step
  over.addEventListener("pointerdown", (e) => {
    if (picking) return;
    const g = e.target.closest("[data-ring]");
    if (!g) return;
    const ring = o.rings.find((r) => r.id === g.dataset.ring);
    if (!ring?.onDrop) return;
    e.preventDefault();
    dragging = ring; box.classList.add("dragging");
    over.setPointerCapture(e.pointerId);
  });
  over.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = over.getBoundingClientRect(), dx = e.clientX - r.left - view.w / 2, dy = e.clientY - r.top - view.h / 2;
    const step = dragging.step || 0.5;
    const nm = Math.min(dragging.max, Math.max(dragging.min, Math.round(Math.hypot(dx, dy) / view.ppn / step) * step));
    dragging.handleAt = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    if (nm !== dragging.nm) { dragging.nm = nm; dragging.onDrag?.(nm); }
    drawOver();
  });
  const drop = () => { if (!dragging) return; const r = dragging; dragging = null; box.classList.remove("dragging"); r.onDrop(r.nm); };
  over.addEventListener("pointerup", drop);
  over.addEventListener("pointercancel", drop);
  // the keyboard: a focused handle moves by its step with the arrow keys
  over.addEventListener("keydown", (e) => {
    const g = e.target.closest("[data-ring]");
    if (!g) return;
    const ring = o.rings.find((r) => r.id === g.dataset.ring), d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!ring?.onDrop || !d) return;
    e.preventDefault();
    ring.nm = Math.min(ring.max, Math.max(ring.min, +(ring.nm + d * (ring.step || 0.5)).toFixed(2)));
    ring.onDrag?.(ring.nm); drawOver();
    over.querySelector(`[data-ring="${ring.id}"] .ring-handle`)?.focus();
    clearTimeout(ring.kbTimer); ring.kbTimer = setTimeout(() => ring.onDrop(ring.nm), 700);
  });
  // picking a new place for the house: a click on the map
  box.addEventListener("click", (e) => {
    if (!picking) return;
    const r = box.getBoundingClientRect();
    const x = view.cx + (e.clientX - r.left - view.w / 2) / view.scale, y = view.cy + (e.clientY - r.top - view.h / 2) / view.scale;
    const [lat, lon] = unworld(x, y, view.z);
    picking = false; box.classList.remove("picking");
    o.onPick?.(+lat.toFixed(4), +lon.toFixed(4));
  });

  new ResizeObserver(() => draw()).observe(box);
  box.update = (next) => { o = { ...o, ...next, rings: next.rings || o.rings }; draw(); };
  box.ring = (id) => o.rings.find((r) => r.id === id);
  box.setRing = (id, nm) => { const r = box.ring(id); if (r && !dragging) { r.nm = nm; if (view) drawOver(); } };
  box.aircraft = (list) => { traffic = list || []; if (view) drawOver(); };
  box.pick = (on = true) => { picking = on; box.classList.toggle("picking", on); };
  box.distanceTo = (lat, lon) => distBrg({ lat: o.lat, lon: o.lon }, { lat, lon })[0];
  return box;
}

/** The tile around a place in a given layer at a given zoom, for a style's picture. */
export function tileAt(layer, lat, lon, z) {
  const [x, y] = world(lat, lon, z);
  return `tiles/${layer}/${z}/${Math.floor(x / TILE)}/${Math.floor(y / TILE)}`;
}
