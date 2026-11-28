// The chart-style radar's aircraft: top-down outlines, nose up, in the radar's drawing units, one
// for each kind of traffic, each at about its size.
// Every part is a polygon wound clockwise on screen, so they join into one filled shape.

const f = (n) => +n.toFixed(2);
// a closed polygon, wound clockwise on screen (y runs down) whichever way its points were listed
function poly(pts) {
  const area = pts.reduce((a, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + x * y2 - x2 * y; }, 0);
  return "M" + (area < 0 ? [...pts].reverse() : pts).map(([x, y]) => `${f(x)},${f(y)}`).join("L") + "Z";
}
// an outline from its right half: points from the nose (x 0) down the right side to the tail (x 0)
function outline(half) {
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return poly([...half, ...left]);
}
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const mirror = (pts) => poly(pts) + poly(pts.map(([x, y]) => [-x, y]));
const pair = (x0, y0, x1, y1) => rect(x0, y0, x1, y1) + rect(-x1, y0, -x0, y1);
// a rectangle with its corners cut, on the right, and its mirror on the left
function pods(x0, y0, x1, y1) {
  const c = Math.min(x1 - x0, y1 - y0) * 0.32;
  return mirror([[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]]);
}
const rad = (a) => (a * Math.PI) / 180;
// a bar of length 2·len and width w through (cx, cy), turned a degrees
function bar(cx, cy, len, w, a) {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a));
  return poly([[-len, -w / 2], [len, -w / 2], [len, w / 2], [-len, w / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
}
// a rotor's blades from its hub at (cx, cy), n of them, the first pointing a degrees clockwise from ahead
function rotor(cx, cy, n, len, w, a) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const t = rad(a + (360 / n) * i), ux = Math.sin(t), uy = -Math.cos(t), px = -uy * (w / 2), py = ux * (w / 2);
    d += poly([[cx + px, cy + py], [cx + ux * len + px, cy + uy * len + py], [cx + ux * len - px, cy + uy * len - py], [cx - px, cy - py]]);
  }
  return d;
}
const circle = (cx, cy, r, n = 14) => poly([...Array(n)].map((_, i) => [cx + r * Math.sin(rad((360 / n) * i)), cy - r * Math.cos(rad((360 / n) * i))]));
const k = (pts, s) => pts.map(([x, y]) => [x * s, y * s]);
const sc = (v, s) => v.map((n) => n * s);

// ---- the outlines, at a size of 1 (an airliner about 9 units long) ----

const LIGHT = [[0, -3.0], [0.42, -2.92], [0.56, -2.4], [0.6, -1.7], [3.9, -1.65], [3.95, -0.45], [0.6, -0.4],
  [0.46, 0.7], [0.27, 2.0], [1.5, 2.02], [1.55, 2.85], [0.22, 2.9], [0, 3.0]];
const LIGHT_PROP = [-1.25, -3.42, 1.25, -2.97];

// seaplane: the light aircraft's shape with a float either side
const FLOAT = [[1.3, -3.4], [1.6, -2.8], [1.6, 0.8], [1.45, 1.1], [1.15, 1.1], [1.02, 0.8], [1.02, -2.8]];

// turboprop and, smaller, light twin
const TURBOPROP = [[0, -4.0], [0.38, -3.85], [0.6, -3.3], [0.64, -1.05], [4.55, -0.85], [4.6, -0.1], [0.64, 0.05],
  [0.56, 1.2], [0.32, 3.2], [1.8, 3.28], [1.85, 3.98], [0.24, 4.02], [0, 4.25]];
const TP_NACELLE = [1.12, -2.35, 1.9, 0.65], TP_PROP = [0.4, -2.78, 2.62, -2.36];

// business jet, and at a larger size a regional jet: engines on the tail
const TAILJET = [[0, -4.5], [0.3, -4.05], [0.48, -3.3], [0.52, -0.55], [3.85, 1.35], [3.9, 1.8], [0.52, 0.95],
  [0.5, 2.0], [0.4, 3.45], [1.95, 4.2], [1.98, 4.6], [0.24, 4.45], [0, 4.75]];
const TJ_ENGINE = [0.5, 1.75, 1.18, 3.35];

const AIRLINER = [[0, -4.5], [0.36, -4.2], [0.58, -3.6], [0.62, -1.0], [4.3, 1.4], [4.35, 1.85], [1.8, 1.05], [0.62, 0.9],
  [0.55, 2.7], [0.44, 3.05], [1.85, 4.05], [1.88, 4.45], [0.3, 4.15], [0.12, 4.6], [0, 4.7]];
const AL_ENGINE = [1.32, -1.15, 1.95, 0.25];

// heavy: two bigger engines, or four (a 747, an A380, a C-17)
const HEAVY = [[0, -4.6], [0.42, -4.3], [0.68, -3.65], [0.72, -1.2], [4.4, 1.55], [4.45, 2.0], [1.9, 1.15], [0.72, 1.0],
  [0.62, 2.8], [0.48, 3.2], [2.0, 4.15], [2.03, 4.55], [0.32, 4.25], [0.14, 4.7], [0, 4.8]];
const HV_ENGINE = [1.45, -1.35, 2.25, 0.35];
const QUAD_ENGINES = [[1.2, -1.3, 1.86, 0.1], [2.6, -0.4, 3.28, 0.95]];

const FIGHTER = [[0, -4.6], [0.28, -3.7], [0.5, -2.8], [0.8, -2.35], [0.88, -1.5], [3.55, 0.95], [3.55, 1.65],
  [0.98, 1.75], [0.98, 2.3], [2.3, 3.35], [2.3, 4.0], [0.88, 3.95], [0.62, 4.45], [0, 4.4]];

const GLIDER = [[0, -2.95], [0.32, -2.8], [0.42, -2.25], [0.42, -1.25], [5.6, -0.95], [5.65, -0.38], [0.42, -0.2],
  [0.3, 1.0], [0.2, 2.45], [1.4, 2.5], [1.4, 3.0], [0, 3.05]];

const TILTROTOR = [[0, -4.2], [0.38, -3.95], [0.6, -3.3], [0.65, -0.95], [2.85, -0.9], [2.85, 0.0], [0.65, 0.05],
  [0.55, 2.7], [1.55, 2.85], [1.6, 3.4], [0.3, 3.45], [0, 3.6]];
const TR_FIN = [1.42, 2.35, 1.72, 3.75], TR_NACELLE = [2.72, -1.8, 3.24, 0.45], TR_HUB = [2.98, -1.8];

const HELI_POD = [[0, -2.0], [0.62, -1.85], [0.95, -1.2], [1.0, -0.2], [0.8, 0.75], [0.45, 1.35], [0.26, 1.5],
  [0.25, 3.3], [1.0, 3.33], [1.0, 3.8], [0.25, 3.82], [0.2, 4.2], [0, 4.25]];
const HELI_TAIL_ROTOR = [0.18, 3.65, 0.5, 4.8];

// tandem-rotor helicopter (a Chinook)
const TANDEM = [[0, -3.7], [0.6, -3.55], [0.85, -3.0], [0.88, 2.8], [0.74, 3.4], [0.36, 3.65], [0, 3.7]];

const GYRO_POD = [[0, -1.9], [0.58, -1.7], [0.8, -0.8], [0.74, 0.4], [0.42, 0.95], [0.22, 1.15], [0.2, 2.4],
  [0.95, 2.45], [0.95, 2.95], [0, 3.0]];

// ultralight (a weight-shift trike, a hang glider)
const TRIKE_WING = [[0, -1.35], [4.0, 0.75], [3.92, 1.4], [0, 1.15]];
const TRIKE_POD = [[0, 0.2], [0.44, 0.35], [0.44, 1.9], [0, 2.2]];
const TRIKE_PROP = [-1.2, 2.15, 1.2, 2.6];

// airship
const HULL = [...Array(13)].map((_, i) => { const t = rad(-90 + i * 15); return [1.9 * Math.cos(t), 4.3 * Math.sin(t)]; });
const AIRSHIP_FIN = [[1.5, 2.0], [2.2, 2.65], [2.2, 3.35], [1.15, 3.45]];

// balloon, from the side
const ENVELOPE = [...[...Array(14)].map((_, i) => { const t = rad(i * 10); return [3 * Math.sin(t), -1 - 3 * Math.cos(t)]; }),
  [2.3, 0.93], [1.45, 1.95], [0.85, 2.5], [0, 2.5]];
const BALLOON_LINE = [[0.62, 2.45], [0.84, 2.45], [0.6, 3.2], [0.42, 3.2]];

// Parts at scale s (airliner = 1). Measured from the drawing: nose (where the one-minute line
// starts) and r (reach, so labels clear it). upright: drawn the same way up whatever the heading.
function make(s, build, upright = false) {
  const d = build(s), pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const r = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
  const nose = upright ? r : Math.max(...pts.filter(([x]) => Math.abs(x) < 0.9 * s).map(([, y]) => -y));
  return { d, nose: f(nose), r: f(r), upright };
}
export const ICONS = {
  light: make(0.9, (s) => outline(k(LIGHT, s)) + rect(...sc(LIGHT_PROP, s))),
  twin: make(0.76, (s) => outline(k(TURBOPROP, s)) + pods(...sc(TP_NACELLE, s)) + pair(...sc(TP_PROP, s))),
  turboprop: make(0.86, (s) => outline(k(TURBOPROP, s)) + pods(...sc(TP_NACELLE, s)) + pair(...sc(TP_PROP, s))),
  bizjet: make(0.8, (s) => outline(k(TAILJET, s)) + pods(...sc(TJ_ENGINE, s))),
  regional: make(0.98, (s) => outline(k(TAILJET, s)) + pods(...sc(TJ_ENGINE, s))),
  airliner: make(1, (s) => outline(k(AIRLINER, s)) + pods(...sc(AL_ENGINE, s))),
  heavy: make(1.3, (s) => outline(k(HEAVY, s)) + pods(...sc(HV_ENGINE, s))),
  quad: make(1.34, (s) => outline(k(HEAVY, s)) + QUAD_ENGINES.map((e) => pods(...sc(e, s))).join("")),
  fighter: make(0.86, (s) => outline(k(FIGHTER, s))),
  seaplane: make(0.92, (s) => outline(k(LIGHT, s)) + rect(...sc(LIGHT_PROP, s)) + mirror(k(FLOAT, s))),
  glider: make(0.8, (s) => outline(k(GLIDER, s))),
  tiltrotor: make(0.95, (s) => outline(k(TILTROTOR, s)) + pods(...sc(TR_FIN, s)) + pods(...sc(TR_NACELLE, s)) +
    rotor(TR_HUB[0] * s, TR_HUB[1] * s, 3, 2.3 * s, 0.58 * s, 0) + rotor(-TR_HUB[0] * s, TR_HUB[1] * s, 3, 2.3 * s, 0.58 * s, 0)),
  heli: make(0.95, (s) => outline(k(HELI_POD, s)) + bar(0, -0.45 * s, 4.1 * s, 0.64 * s, 45) + bar(0, -0.45 * s, 4.1 * s, 0.64 * s, -45) +
    rect(...sc(HELI_TAIL_ROTOR, s))),
  tandem: make(1.0, (s) => outline(k(TANDEM, s)) + rotor(0, -2.6 * s, 3, 3.5 * s, 0.62 * s, 0) + rotor(0, 2.5 * s, 3, 3.5 * s, 0.62 * s, 60)),
  gyro: make(0.95, (s) => outline(k(GYRO_POD, s)) + bar(0, -0.35 * s, 4.6 * s, 0.62 * s, 45) + rect(...sc([-1.15, 1.0, 1.15, 1.42], s))),
  ultralight: make(0.95, (s) => outline(k(TRIKE_WING, s)) + outline(k(TRIKE_POD, s)) + rect(...sc(TRIKE_PROP, s))),
  drone: make(0.8, (s) => bar(0, 0, 2.9 * s, 0.62 * s, 45) + bar(0, 0, 2.9 * s, 0.62 * s, -45) + rect(...sc([-0.8, -0.8, 0.8, 0.8], s)) +
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, y]) => circle(2.05 * x * s, 2.05 * y * s, 1.05 * s)).join("")),
  airship: make(1.05, (s) => outline(k(HULL, s)) + mirror(k(AIRSHIP_FIN, s))),
  balloon: make(0.9, (s) => outline(k(ENVELOPE, s)) + mirror(k(BALLOON_LINE, s)) + rect(...sc([-0.6, 3.15, 0.6, 4.0], s)), true),
  plain: { d: "M0,-4 L1,-1 L4.2,1.2 L4.2,2 L1,1 L.8,3 L2,4 L2,4.6 L0,4 L-2,4.6 L-2,4 L-.8,3 L-1,1 L-4.2,2 L-4.2,1.2 L-1,-1 Z", nose: 4.2, r: 4.6, upright: false },
};
export const iconFor = (kind) => ICONS[kind] || ICONS.plain;
