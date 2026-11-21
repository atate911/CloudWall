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

// Borders and cities (maps/world.json, from Natural Earth), fetched the first time a route is drawn.
let world = null, worldLoading = null;
function loadWorld() {
  if (!worldLoading) {
    worldLoading = fetch("maps/world.json").then((res) => (res.ok ? res.json() : null)).catch(() => null).then((w) => {
      world = w || { country: [], state: [], cities: [] };
      return world;
    });
  }
  return worldLoading;
}

// The country and state lines in view, as SVG path data in world units. The view may run past the
// date line (x below 0 or above 256), so each line is drawn again a world to the left or right
// where that copy is the one in view.
function borderPaths(lines, vx, vy, vw, vh) {
  let out = "";
  for (const line of lines) {
    const pts = [];
    let lo = Infinity, hi = -Infinity, top = Infinity, bot = -Infinity, prev = null;
    for (let i = 0; i < line.length; i += 2) {
      let x = wx(line[i + 1]);
      if (prev !== null) x += 256 * Math.round((prev - x) / 256);   // lines crossing ±180 stay whole
      prev = x;
      const y = wy(line[i]);
      pts.push([x, y]);
      lo = Math.min(lo, x); hi = Math.max(hi, x); top = Math.min(top, y); bot = Math.max(bot, y);
    }
    if (bot < vy || top > vy + vh) continue;
    for (const shift of [-256, 0, 256]) {
      if (hi + shift < vx || lo + shift > vx + vw) continue;
      out += "M" + pts.map(([x, y]) => `${(x + shift).toFixed(2)},${y.toFixed(2)}`).join("L");
    }
  }
  return out;
}

// A few cities to find your way by: the biggest, the capitals and those the flight passes over
// count for most, none so near an airport that it says the same thing, and no two labels touching.
// Positions in screen px from the view's top left; `taken` holds boxes already in use (the airport
// codes) as [left, top, right, bottom].
function pickCities(cities, toPx, path, W, H, taken) {
  const MARGIN = 4, n = clamp(Math.round((W * H) / 22000), 2, 7);
  const scored = [];
  for (const [name, , lat, lon, pop, capital] of cities) {
    const [x, y] = toPx(lat, lon);
    if (x < MARGIN || x > W - MARGIN || y < 10 || y > H - 6) continue;
    let near = Infinity;
    for (let i = 0; i < path.length; i += 4) near = Math.min(near, Math.hypot(path[i][0] - x, path[i][1] - y));
    const ends = Math.min(Math.hypot(path[0][0] - x, path[0][1] - y), Math.hypot(path[path.length - 1][0] - x, path[path.length - 1][1] - y));
    if (ends < 26) continue;
    const score = Math.sqrt(pop) * (capital ? 1.5 : 1) * (near < 30 ? 2.2 : near < 80 ? 1.4 : 1);
    scored.push({ name, x, y, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const overlaps = (b) => taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1])
    || path.some(([x, y]) => x > b[0] - 3 && x < b[2] + 3 && y > b[1] - 3 && y < b[3] + 3);   // nor across the route
  for (const c of scored) {
    if (picked.length >= n) break;
    const w = c.name.length * 5.6 + 4, right = c.x + 6 + w < W - MARGIN;
    const box = right ? [c.x - 3, c.y - 8, c.x + 6 + w, c.y + 6] : [c.x - 6 - w, c.y - 8, c.x + 3, c.y + 6];
    if (overlaps(box)) continue;
    taken.push(box);
    picked.push({ ...c, right });
  }
  return picked;
}

// Draw the map for route r into box (an element with a size), on tile layer `layer` (the server's
// description of the "world" layer: {enabled, style, attribution}), or on plain paper without one.
// `here` is the local airport's code, marked in chart blue.
export function drawRouteMap(box, r, layer, here) {
  const W = box.clientWidth, H = box.clientHeight;
  box._rm = { r, layer, here, W, H, progress: box._rm ? box._rm.progress : null };
  if (!box._ro) {      // drawn again when the card changes size (or first gives it one)
    box._ro = new ResizeObserver(() => {
      const m = box._rm;
      if (m && (box.clientWidth !== m.W || box.clientHeight !== m.H)) drawRouteMap(box, m.r, m.layer, m.here);
    });
    box._ro.observe(box);
  }
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

  // borders and cities, once world.json is here (drawn again when it arrives)
  let ground = "";
  if (!world) loadWorld().then(() => { if (box.isConnected && box._rm && box._rm.r === r) drawRouteMap(box, r, layer, here); });
  else {
    const toPx = (lat, lon) => {
      let x = wx(lon);
      x += 256 * Math.round((cx - x) / 256);          // the copy of the city nearest the middle of the view
      return [(x - vx) * s, (wy(lat) - vy) * s];
    };
    const pathPx = full.map(([x, y]) => [(x - vx) * s, (y - vy) * s]);
    // the airport codes' boxes, so no city lands on them
    const codeBox = (x, y, other, code) => {
      const X = (x - vx) * s, Y = (y - vy) * s, w = code.length * 7.5 + 8;
      return x >= other ? [X - 5, Y - 8, X + 8 + w, Y + 8] : [X - 8 - w, Y - 8, X + 5, Y + 8];
    };
    const taken = [codeBox(ox, oy, dx, r.origin.iata || ""), codeBox(dx, dy, ox, r.dest.iata || "")];
    if (layer && layer.enabled) taken.push([W - layer.attribution.length * 4.3 - 12, H - 18, W, H]);   // the imagery credit
    const cities = pickCities(world.cities, toPx, pathPx, W, H, taken).map((c) => {
      const X = vx + c.x * px, Y = vy + c.y * px;
      return `<circle class="rm-city" cx="${X}" cy="${Y}" r="${1.8 * px}"/><text class="rm-place" x="${X + (c.right ? 5 : -5) * px}" y="${Y + 3.2 * px}" text-anchor="${c.right ? "start" : "end"}" font-size="${9.5 * px}" stroke-width="${2.6 * px}">${esc(c.name)}</text>`;
    }).join("");
    ground = `<path class="rm-state" d="${borderPaths(world.state, vx, vy, vw, vh)}"/>
      <path class="rm-border" d="${borderPaths(world.country, vx, vy, vw, vh)}"/>
      <g class="rm-cities">${cities}</g>`;
  }
  box.innerHTML = `<svg class="rm" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g class="rm-tiles ${layer ? layer.style : ""}">${tiles}</g>
      ${ground}
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
