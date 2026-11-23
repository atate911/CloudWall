// The flight card's route map: real map tiles of the part of the world the flight crosses, with
// the great-circle path between its airports drawn over them, the part already flown solid and
// the rest dashed with an arrowhead at the destination, and the aircraft where it is now, pointing
// the way it's going. The states and countries it shows are named, with the cities a map of its
// scale would name, and a scale bar says how far across it is. The tiles come from CloudWall's "world" layer
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
      world = { country: [], state: [], cities: [], regions: [], ...(w || {}) };
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

const MINOR_K = 8;          // thousands of people: below this a place isn't named, unless the map has almost no names

// Text widths in px, for laying out the labels before they're drawn.
let ruler = null;
function textWidth(text, px) {
  if (!ruler) {
    ruler = document.createElement("canvas").getContext("2d");
    ruler.family = getComputedStyle(document.documentElement).getPropertyValue("--sans").trim() || "sans-serif";
  }
  ruler.font = `${px}px ${ruler.family}`;
  return ruler.measureText(text).width;
}

// The places named on the map. Which ones is decided by Natural Earth's rank (the map zoom it would
// label a place at), so the map names places of like importance for its scale: a town is named only
// where a map this close would name it, never beside a city left unnamed. Those along the route come
// first, spaced out along it like the stops on a line, then others either side of it to find your
// way by, spread along its length so that each stretch of the flight has a name near it. A place of
// a few thousand people (John Day, Oregon) means nothing to anyone not from there, however near the
// line it lies: such places are named only where the map would otherwise have next to no names (an
// ocean, the far north). None so near an airport that it says the same thing, none across the
// route, no two touching, each label on the side of its dot away from the route.
// Positions in screen px from the view's top left; `taken` holds boxes already in use (the airport
// codes) as [left, top, right, bottom]; z is the map's zoom, fs the labels' size.
function pickCities(cities, toPx, path, W, H, taken, z, fs) {
  const EDGE = 3, n = clamp(Math.round((W * H) / 15000), 3, 9), corridor = Math.max(24, 0.1 * Math.min(W, H)), reach = Math.max(60, 0.55 * Math.min(W, H));
  const along = [0];         // how far along the route each of its points is
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = along[along.length - 1], [ax, ay] = path[0], [bx, by] = path[path.length - 1];
  const cands = [];
  for (const [name, , lat, lon, pop, capital, rank = 50] of cities) {
    const r = rank / 10;
    if (r > z + 2) continue;                    // too small a place for this scale, even on the route
    const [x, y] = toPx(lat, lon);
    if (x < EDGE + 2 || x > W - EDGE - 2 || y < fs + 2 || y > H - fs * 0.7) continue;
    if (Math.min(Math.hypot(ax - x, ay - y), Math.hypot(bx - x, by - y)) < fs * 3.5) continue;   // the airport says it
    let near = Infinity, k = 0;
    for (let i = 0; i < path.length; i += 2) {
      const d = Math.hypot(path[i][0] - x, path[i][1] - y);
      if (d < near) { near = d; k = i; }
    }
    const on = near <= corridor;
    if (!on && (r > z + 1.5 || near > reach)) continue;      // away from the route, only what a map this size names (or nearly), and not far off in a corner
    // which side of the route it lies on, as the flight sees it (for spreading the names either side)
    const j = Math.min(k + 2, path.length - 1), i0 = Math.max(0, j - 4);
    const side = Math.sign((path[j][0] - path[i0][0]) * (y - path[k][1]) - (path[j][1] - path[i0][1]) * (x - path[k][0])) || 1;
    cands.push({ name, x, y, r, pop, on, at: along[k], side, minor: pop < MINOR_K && !capital, away: near < 4 ? 0 : x >= path[k][0] ? 1 : -1 });
  }
  // the route's own places count for more, by a step of zoom
  for (const c of cands) c.key = c.r - (c.on ? 1 : 0);
  cands.sort((a, b) => a.key - b.key || b.pop - a.pop);
  const hits = (b) => b[0] < EDGE || b[2] > W - EDGE || taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1])
    || path.some(([x, y]) => x > b[0] - 3 && x < b[2] + 3 && y > b[1] - 3 && y < b[3] + 3);   // nor across the route
  // beside its dot on the side away from the route, else the other side; a place on the route itself
  // may take a corner above or below its dot, clear of the line
  const place = (c) => {
    const w = textWidth(c.name, fs) + 2;
    for (const right of c.away < 0 ? [false, true] : [true, false]) {
      for (const dy of [0, -1, 1]) {
        const top = dy < 0 ? c.y - 3 - fs * 1.05 : dy > 0 ? c.y + 3 : c.y - fs * 0.85, bot = dy ? top + fs * 1.05 : c.y + fs * 0.55;
        const box = right ? [dy ? c.x + 2 : c.x - 3, top, c.x + 5 + w, bot] : [c.x - 5 - w, top, dy ? c.x - 2 : c.x + 3, bot];
        if (!hits(box)) return { box, right, base: dy < 0 ? bot - fs * 0.25 : dy > 0 ? bot - fs * 0.27 : c.y + fs * 0.34, dx: dy ? 3 : 5 };
      }
    }
    return null;
  };
  const picked = [], stops = [];
  const pick = (c) => {
    if (picked.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < fs * 4.5)) return false;
    const p = place(c);
    if (!p) return false;
    taken.push(p.box); picked.push({ ...c, ...p }); c.named = true;
    return true;
  };
  // the places that matter at this scale, most important first: along the route spaced out like the
  // stations on a line, and around it a few to find your way by; then smaller places along the route,
  // only where a long stretch has nothing bigger (an ocean, the far north, empty country), and not
  // beside an airport
  const gap = Math.max(fs * 5, L / (clamp(Math.round(L / (fs * 10)), 1, n) + 1)), aroundMax = Math.max(2, Math.ceil(n * 0.6));
  const beside = [];         // the places named off the route: how far along it, and on which side
  for (const c of cands) {
    if (picked.length >= n) break;
    if (c.minor) continue;
    if (c.on ? c.r > z + 1 || stops.some((at) => Math.abs(at - c.at) < gap)
      : beside.length >= aroundMax || c.r > z + 0.8 || beside.some((q) => q.side === c.side && Math.abs(q.at - c.at) < gap * 0.8)) continue;
    if (pick(c)) c.on ? stops.push(c.at) : beside.push(c);
  }
  for (const c of cands) {
    if (picked.length >= n) break;
    if (c.minor || !c.on || c.r <= z + 1 || [...stops, 0, L].some((at) => Math.abs(at - c.at) < gap * 1.25)) continue;
    if (pick(c)) stops.push(c.at);
  }
  // a map with next to nothing named (an ocean crossing) takes a couple of lesser places around it
  for (const c of cands) {
    if (picked.length >= 2) break;
    if (!c.on && !c.named) pick(c);
  }
  return picked;
}

// The states, provinces and countries named on the map: each where one of its name points (points
// well inside it, from world.json) is in view with room for the name, clear of the route, the
// airport codes and the names already set, and as near the middle of the view as that allows. Those
// the route itself crosses or passes nearest come first (Greenland on the way from Amsterdam, before
// a country off in a corner of the map). Countries are named from far out, states
// and provinces once the map is close enough to tell them apart (Natural Earth's own zooms for each).
function pickRegions(regions, toPx, path, W, H, taken, z, fs) {
  const n = clamp(Math.round((W * H) / 26000), 2, 6), out = [];
  const cands = [];
  for (const [name, kind, min, pts, iso] of regions) {
    if (z < (kind ? Math.max(min / 10 - 0.9, 2.6) : min / 10 - 1.2)) continue;      // too far out to name it
    const size = kind ? fs * 0.92 : fs * 1.08, text = name.toUpperCase();
    const w = textWidth(text, size) + text.length * size * 0.14 + 6, h = size * 1.1;
    let best = null, cross = Infinity;      // cross: how near the route comes to the region (to any of its points)
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = toPx(pts[i], pts[i + 1]);
      if (x > -W && x < 2 * W && y > -H && y < 2 * H) for (let k = 0; k < path.length; k += 2) cross = Math.min(cross, Math.hypot(path[k][0] - x, path[k][1] - y));
      if (x < w / 2 + 4 || x > W - w / 2 - 4 || y < h + 2 || y > H - h - 2) continue;
      const box = [x - w / 2 - 5, y - h * 0.8 - 4, x + w / 2 + 5, y + h * 0.45 + 4];      // with a little air round it
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      let near = Infinity;
      for (let k = 0; k < path.length; k += 2) near = Math.min(near, Math.hypot(path[k][0] - x, Math.max(0, Math.abs(path[k][1] - y) - h)));
      if (path.some(([px, py]) => px > box[0] - 4 && px < box[2] + 4 && py > box[1] - 3 && py < box[3] + 3)) continue;      // nor across the route
      const mid = Math.hypot(x - W / 2, y - H / 2) / Math.hypot(W, H);
      if (!best || near * 0.02 + mid < best.key) best = { name: text, kind, iso, x, y, size, box, near, key: near * 0.02 + mid };
    }
    if (best) cands.push({ ...best, cross });
  }
  // states before countries (a map that names Oregon and Idaho needn't say they are in the United
  // States), and of each those the route crosses or passes nearest first
  cands.sort((a, b) => b.kind - a.kind || a.cross - b.cross || a.near - b.near);
  for (const c of cands) {
    if (out.length >= n) break;
    if (!c.kind && out.some((o) => o.kind && o.iso === c.iso)) continue;
    if (taken.some((t) => c.box[0] < t[2] && c.box[2] > t[0] && c.box[1] < t[3] && c.box[3] > t[1])) continue;
    taken.push(c.box);
    out.push(c);
  }
  return out;
}

// A round length for the map's scale bar, 40 to 110 px long at pxPerNm: [nm, px].
function scaleBar(pxPerNm) {
  let best = [1, pxPerNm];
  for (const nm of [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) {
    if (nm * pxPerNm <= 110) best = [nm, nm * pxPerNm];
  }
  return best;
}

// How the map frames route r in a box W x H px: the path in world units and the scale (px per world
// unit). Room is left around the path for the airport codes beside its ends and enough of the
// country around each of them to show where it lies (its coast, its neighbours, the next city), and the map comes no closer than the tiles allow (zoom 6, a little enlarged)
// and goes no farther out than the whole world's height.
const PAD_X = (W) => Math.max(52, 0.15 * W), PAD_Y = (H) => Math.max(26, 0.16 * H);
function frame(r, W, H) {
  const at = greatCircle(r.origin, r.dest), full = pathPoints(at, 0, 1, 128);
  const xs = full.map((p) => p[0]), ys = full.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = Math.max(x1 - x0, 0.4), bh = Math.max(y1 - y0, 0.4);
  const padX = PAD_X(W), padY = PAD_Y(H);
  let s = Math.min(Math.max(W - 2 * padX, W * 0.3) / bw, Math.max(H - 2 * padY, H * 0.3) / bh, 2 ** MAXZ * 1.7);
  s = Math.max(s, H / 256);
  // and not so far out that the continents repeat across a wide, short box, where the path still fits
  if (s < W / 256 && bh * (W / 256) <= H * 0.9) s = W / 256;
  return { at, full, x0, x1, y0, y1, s };
}

// How large route r is drawn in a box W x H (px per world unit): the flight card tries its places
// for the map and keeps the one that shows the route biggest.
export const routeScale = (r, W, H) => (W > 0 && H > 0 && mappable(r) ? frame(r, W, H).s : 0);

// How tall a map W px wide wants to be for route r: as tall as the route is drawn when it fits the
// width, with frame's room above and below (a phone's map is as tall as its route needs).
export function routeHeight(r, W) {
  if (!(W > 0) || !mappable(r)) return 0;
  const f = frame(r, W, 1e6), s = Math.min((W - 2 * PAD_X(W)) / Math.max(f.x1 - f.x0, 0.4), 2 ** MAXZ * 1.7);
  const h = Math.max(f.y1 - f.y0, 0.4) * s;
  return Math.max(h + 52, h / 0.68);
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
  const { at, full, x0, x1, y0, y1, s } = frame(r, W, H);
  // the labels a little larger on a larger map, so they keep their weight against it
  const fs = clamp(Math.min(W, H) / 36, 9.5, 12), cfs = fs * 1.18;
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
    return `<text class="rm-code ${cls}" x="${x + (right ? 7 : -7) * px}" y="${y + cfs * 0.33 * px}" text-anchor="${right ? "start" : "end"}" font-size="${cfs * px}" stroke-width="${3 * px}">${esc(code)}</text>`;
  };
  const cls = (p) => (p.iata && p.iata === here ? "local" : "");

  // how far across the map is: a bar of a round number of nautical miles, measured at its middle
  const midLat = Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / 256))) / RAD;
  const [barNm, barPx] = scaleBar((s * (256 / 360)) / 60 / Math.cos(midLat * RAD));
  // which way it's going: an arrowhead on the line, its tip just short of the destination
  const [qx, qy] = full[full.length - 4], al = Math.hypot(dx - qx, dy - qy) || 1, ux = (dx - qx) / al, uy = (dy - qy) / al;
  const tipX = dx - ux * 6 * px, tipY = dy - uy * 6 * px, backX = tipX - ux * 10 * px, backY = tipY - uy * 10 * px;
  const arrow = `M${tipX},${tipY}L${backX - uy * 4.6 * px},${backY + ux * 4.6 * px}L${backX + uy * 4.6 * px},${backY - ux * 4.6 * px}Z`;

  // borders, names and cities, once world.json is here (drawn again when it arrives)
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
      const X = (x - vx) * s, Y = (y - vy) * s, w = code.length * cfs * 0.68 + 8, h = cfs * 0.75, m = fs * 0.8;   // and room round it
      return x >= other ? [X - 5 - m, Y - h - m, X + 8 + w + m, Y + h + m] : [X - 8 - w - m, Y - h - m, X + 5 + m, Y + h + m];
    };
    const taken = [codeBox(ox, oy, dx, r.origin.iata || ""), codeBox(dx, dy, ox, r.dest.iata || "")];
    if (layer && layer.enabled) taken.push([W - layer.attribution.length * 4.3 - 12, H - 18, W, H]);   // the imagery credit
    taken.push([0, H - 30, barPx + 78, H]);                                                             // the scale bar, and its miles beside it
    // the cities first, which are where they are; then the states and countries, their names wide
    // and faint, wherever within each there is room left
    const cityList = pickCities(world.cities, toPx, pathPx, W, H, taken, Math.log2(s), fs);
    for (const c of cityList) taken.push([c.x - 6, c.y - 6, c.x + 6, c.y + 6]);      // their dots too: no state's name across one
    const regions = pickRegions(world.regions || [], toPx, pathPx, W, H, taken, Math.log2(s), fs).map((g) =>
      `<text class="rm-region${g.kind ? "" : " country"}" x="${vx + g.x * px}" y="${vy + g.y * px}" text-anchor="middle" font-size="${g.size * px}" letter-spacing="${g.size * 0.14 * px}" stroke-width="${2.4 * px}">${esc(g.name)}</text>`).join("");
    const cities = cityList.map((c) => {
      const X = vx + c.x * px, Y = vy + c.y * px;
      return `<circle class="rm-city" cx="${X}" cy="${Y}" r="${fs * 0.19 * px}"/><text class="rm-place" x="${X + (c.right ? c.dx : -c.dx) * px}" y="${vy + c.base * px}" text-anchor="${c.right ? "start" : "end"}" font-size="${fs * px}" stroke-width="${2.6 * px}">${esc(c.name)}</text>`;
    }).join("");
    ground = `<path class="rm-state" d="${borderPaths(world.state, vx, vy, vw, vh)}"/>
      <path class="rm-border" d="${borderPaths(world.country, vx, vy, vw, vh)}"/>
      <g class="rm-regions">${regions}</g>
      <g class="rm-cities">${cities}</g>`;
  }
  box.innerHTML = `<svg class="rm" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g class="rm-tiles ${layer ? layer.style : ""}">${tiles}</g>
      ${ground}
      <path class="rm-halo" d="${d(full)}"/>
      <path class="rm-todo" d="${d(full)}"/>
      <path class="rm-done" d=""/>
      <path class="rm-arrow" d="${arrow}"/>
      <circle class="rm-apt from ${cls(r.origin)}" cx="${ox}" cy="${oy}" r="${3.4 * px}" stroke-width="${1.6 * px}"/>
      <circle class="rm-apt to ${cls(r.dest)}" cx="${dx}" cy="${dy}" r="${3.4 * px}" stroke-width="${1.4 * px}"/>
      ${label(ox, oy, dx, r.origin.iata || "", cls(r.origin))}${label(dx, dy, ox, r.dest.iata || "", cls(r.dest))}
      <circle class="rm-ring" r="${10 * px}" stroke-width="${1.2 * px}"/>
      <g class="rm-craft"><path class="edge" d="M0,-8.5L5.6,6L0,3.2L-5.6,6Z" transform="translate(0 0.5) scale(1.42)"/><path class="body" d="M0,-8.5L5.6,6L0,3.2L-5.6,6Z"/></g>
    </svg><div class="rm-scale" style="width:${barPx.toFixed(1)}px">${barNm.toLocaleString("en-US")} nm<i>${Math.round(barNm * 1.15078).toLocaleString("en-US")} mi</i></div>${layer && layer.enabled ? `<div class="rm-credit">${esc(layer.attribution)}</div>` : ""}`;
  box._rm.at = at;
  box._rm.px = px;
  moveRouteMap(box, box._rm.progress);
}

// Move the aircraft to `progress` (0 at the origin, 1 at the destination; null when not known,
// which leaves the whole route dashed with no aircraft on it), turned to point along the route.
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
  const [[ax, ay], , [bx, by]] = pathPoints(m.at, Math.max(0, p - 0.01), Math.min(1, p + 0.01), 2);      // the route's direction here
  craft.style.display = ring.style.display = "";
  craft.setAttribute("transform", `translate(${x} ${y}) rotate(${(Math.atan2(bx - ax, ay - by) / RAD).toFixed(1)}) scale(${m.px})`);
  ring.setAttribute("cx", x); ring.setAttribute("cy", y);
}
