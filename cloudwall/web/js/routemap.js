// The flight card's route map: real map tiles of the part of the world the flight crosses, with
// the great-circle path between its airports drawn over them, the part already flown solid and
// the rest dashed, and a dot where it is now. The tiles come from CloudWall's "world" layer
// (/tiles/world/z/x/y, zoom 0 to 6, cached on the server like the radar's map).
//
// Everything is drawn in Web Mercator "world units": the whole world is 256 units square at zoom
// 0, so a tile at zoom z is 256 / 2^z units across. The SVG's viewBox is in those units, which
// keeps tiles, path and markers lined up at any size.
import { clamp, esc } from "./util.js";

const RAD = Math.PI / 180, MAXZ = 6;
const wx = (lon) => ((lon + 180) / 360) * 256;
const wy = (lat) => {
  const l = clamp(lat, -85, 85) * RAD;
  return ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * 256;
};

// A point a fraction t of the way along the great circle from a to b ({lat, lon} each).
function greatCircle(a, b) {
  const v = (p) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const A = v(a), B = v(b);
  const d = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1));
  return (t) => {
    const s = Math.sin(d), ka = d < 1e-9 ? 1 - t : Math.sin((1 - t) * d) / s, kb = d < 1e-9 ? t : Math.sin(t * d) / s;
    const x = ka * A[0] + kb * B[0], y = ka * A[1] + kb * B[1], z = ka * A[2] + kb * B[2];
    return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
  };
}

// The path as world-unit points, with longitudes carried on past ±180 so that a flight across the
// Pacific stays one unbroken line instead of jumping to the other edge of the map.
function pathPoints(at, t0, t1, n) {
  const pts = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const p = at(t0 + ((t1 - t0) * i) / n);
    let lon = p.lon;
    if (prev !== null) lon += 360 * Math.round((prev - lon) / 360);
    prev = lon;
    pts.push([wx(lon), wy(p.lat)]);
  }
  return pts;
}

const d = (pts) => "M" + pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join("L");
const known = (p) => p && p.lat != null && p.lon != null;

// Can this route go on a map? Both airports need a position.
export const mappable = (r) => !!(r && known(r.origin) && known(r.dest));

// Draw the map for route r into box (an element with a size), on tile layer `layer` (the server's
// description of the "world" layer: {enabled, style, attribution}), or on plain paper without one.
// `here` is the local airport's code, marked in chart blue.
export function drawRouteMap(box, r, layer, here) {
  const W = box.clientWidth, H = box.clientHeight;
  box._rm = { r, layer, here, W, H, progress: box._rm ? box._rm.progress : null };
  if (!W || !H) return;
  const at = greatCircle(r.origin, r.dest), full = pathPoints(at, 0, 1, 128);
  // fit the whole path, with room around it for the airport labels
  const xs = full.map((p) => p[0]), ys = full.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = Math.max(x1 - x0, 0.4), bh = Math.max(y1 - y0, 0.4);
  // px per world unit: fit with a margin, no closer than the tiles allow (zoom 6, a little enlarged),
  // and never so far out that the map runs off the top or bottom of the world
  let s = Math.min(W / (bw * 1.45), H / (bh * 1.6), 2 ** MAXZ * 1.7);
  s = Math.max(s, H / 256);
  // and not so far out that the continents repeat across a wide, short box, where the path still fits
  if (s < W / 256 && bh * (W / 256) <= H * 0.9) s = W / 256;
  const vw = W / s, vh = H / s;
  const cx = (x0 + x1) / 2, cy = clamp((y0 + y1) / 2, vh / 2, 256 - vh / 2);
  const vx = cx - vw / 2, vy = cy - vh / 2, px = 1 / s;

  // the tiles under the view, at the zoom that gives about one tile pixel per screen pixel
  let tiles = "";
  if (layer && layer.enabled) {
    const dpr = window.devicePixelRatio || 1;
    const z = clamp(Math.ceil(Math.log2(s * dpr) - 0.25), 0, MAXZ), n = 2 ** z, ts = 256 / n, ov = 0.6 * px;
    for (let tx = Math.floor(vx / ts); tx <= Math.floor((vx + vw) / ts); tx++) {
      for (let ty = Math.max(0, Math.floor(vy / ts)); ty <= Math.min(n - 1, Math.floor((vy + vh) / ts)); ty++) {
        const wrapped = ((tx % n) + n) % n;     // past the date line, the same tiles again
        tiles += `<image href="tiles/world/${z}/${wrapped}/${ty}" x="${tx * ts}" y="${ty * ts}" width="${ts + ov}" height="${ts + ov}" preserveAspectRatio="none"/>`;
      }
    }
  }
  const [ox, oy] = full[0], [dx, dy] = full[full.length - 1];
  // labels go on the outside of each end of the line, away from the path
  const label = (x, y, other, code, cls) => {
    const right = x >= other;
    return `<text class="rm-code ${cls}" x="${x + (right ? 7 : -7) * px}" y="${y + 3.5 * px}" text-anchor="${right ? "start" : "end"}" font-size="${11 * px}" stroke-width="${3 * px}">${esc(code)}</text>`;
  };
  const cls = (p) => (p.iata && p.iata === here ? "local" : "");
  box.innerHTML = `<svg class="rm" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g class="rm-tiles ${layer ? layer.style : ""}">${tiles}</g>
      <path class="rm-halo" d="${d(full)}"/>
      <path class="rm-todo" d="${d(full)}"/>
      <path class="rm-done" d=""/>
      <circle class="rm-apt ${cls(r.origin)}" cx="${ox}" cy="${oy}" r="${3.2 * px}" stroke-width="${1.4 * px}"/>
      <circle class="rm-apt ${cls(r.dest)}" cx="${dx}" cy="${dy}" r="${3.2 * px}" stroke-width="${1.4 * px}"/>
      ${label(ox, oy, dx, r.origin.iata || "", cls(r.origin))}${label(dx, dy, ox, r.dest.iata || "", cls(r.dest))}
      <circle class="rm-ring" r="${9 * px}" stroke-width="${1.2 * px}"/>
      <circle class="rm-craft" r="${4 * px}" stroke-width="${1.5 * px}"/>
    </svg>${layer && layer.enabled ? `<div class="rm-credit">${esc(layer.attribution)}</div>` : ""}`;
  box._rm.at = at;
  moveRouteMap(box, box._rm.progress);
  if (!box._ro) {      // drawn again when the card changes size
    box._ro = new ResizeObserver(() => {
      const m = box._rm;
      if (m && (box.clientWidth !== m.W || box.clientHeight !== m.H)) drawRouteMap(box, m.r, m.layer, m.here);
    });
    box._ro.observe(box);
  }
}

// Move the aircraft to `progress` (0 at the origin, 1 at the destination; null when not known,
// which leaves the whole route dashed with no aircraft on it).
export function moveRouteMap(box, progress) {
  const m = box._rm;
  if (!m) return;
  m.progress = progress;
  const svg = box.querySelector("svg.rm");
  if (!svg || !m.at) return;
  const done = svg.querySelector(".rm-done"), craft = svg.querySelector(".rm-craft"), ring = svg.querySelector(".rm-ring");
  if (progress == null) {
    done.setAttribute("d", "");
    craft.style.display = ring.style.display = "none";
    return;
  }
  const p = clamp(progress, 0, 1);
  // the flown part, unwrapped the same way as the whole path so the two stay on top of each other
  const pts = pathPoints(m.at, 0, p, Math.max(2, Math.round(128 * p)));
  done.setAttribute("d", d(pts));
  const [x, y] = pts[pts.length - 1];
  for (const c of [craft, ring]) { c.style.display = ""; c.setAttribute("cx", x); c.setAttribute("cy", y); }
}
