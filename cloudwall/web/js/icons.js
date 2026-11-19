// The chart-style radar's aircraft: top-down outlines, nose up, in the radar's drawing units, one
// for each of a few kinds so the traffic reads at a glance, the way flight-tracking maps draw it.
// Light aircraft and turboprops have straight wings and a propeller's arc ahead of each engine;
// business and regional jets carry their engines on the tail; airliners and heavies under swept
// wings, a heavy's two or four of them bigger; a helicopter is its rotor over a pod and tail boom;
// a fighter a pointed nose and short trapezoid wings. Each is drawn at about its size, so a light
// aircraft is small beside an airliner and a heavy large.
//
// Every part is a polygon wound the same way (clockwise on screen), so they join into one filled
// shape; the stylesheet paints the halo under the fill, so the joins don't show.

const f = (n) => +n.toFixed(2);
const poly = (pts) => "M" + pts.map(([x, y]) => `${f(x)},${f(y)}`).join("L") + "Z";
// an outline from its right half: points from the nose (x 0) down the right side to the tail (x 0)
function outline(half) {
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return poly([...half, ...left]);
}
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
// a rectangle on the right and its mirror on the left
const pair = (x0, y0, x1, y1) => rect(x0, y0, x1, y1) + rect(-x1, y0, -x0, y1);
// an engine pod or nacelle on the right, its corners cut, and its mirror on the left
function pods(x0, y0, x1, y1) {
  const c = Math.min(x1 - x0, y1 - y0) * 0.32;
  const one = (a, b) => poly([[a + c, y0], [b - c, y0], [b, y0 + c], [b, y1 - c], [b - c, y1], [a + c, y1], [a, y1 - c], [a, y0 + c]]);
  return one(x0, x1) + one(-x1, -x0);
}
// a bar of length 2·len and width w through (cx, cy), turned a degrees
function bar(cx, cy, len, w, a) {
  const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
  return poly([[-len, -w / 2], [len, -w / 2], [len, w / 2], [-len, w / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
}
// scale an outline's points
const k = (pts, s) => pts.map(([x, y]) => [x * s, y * s]);

// ---- the outlines, at a size of 1 (an airliner about 9 units long) ----

// light aircraft (a Cessna, a Piper, an RV): a short body, a long straight wing, the tail plane,
// and the propeller's arc across the nose
const LIGHT = [[0, -3.0], [0.36, -2.92], [0.46, -2.3], [0.5, -1.55], [3.9, -1.5], [3.95, -0.6], [0.5, -0.55],
  [0.38, 0.6], [0.2, 2.05], [1.45, 2.1], [1.5, 2.75], [0.16, 2.8], [0, 2.95]];
const LIGHT_PROP = [-1.2, -3.2, 1.2, -2.94];

// turboprop (a King Air, a Dash 8, an ATR): a slim body, a straight wing with an engine on each
// side reaching ahead of it, each with its propeller's arc
const TURBOPROP = [[0, -4.0], [0.32, -3.85], [0.5, -3.3], [0.55, -0.95], [4.55, -0.8], [4.6, -0.2], [0.55, -0.05],
  [0.5, 1.2], [0.28, 3.25], [1.75, 3.35], [1.8, 3.95], [0.2, 4.0], [0, 4.25]];
const TP_NACELLE = [1.22, -2.1, 1.82, 0.55], TP_PROP = [0.62, -2.42, 2.42, -2.2];

// business jet, and at a larger size a regional jet (a Citation, a Gulfstream; a CRJ, an MD-80):
// a slim body, a swept wing set well back, the engines on the tail, and a T-tail swept back
const TAILJET = [[0, -4.5], [0.3, -4.05], [0.48, -3.3], [0.52, -0.55], [3.85, 1.35], [3.9, 1.8], [0.52, 0.95],
  [0.5, 2.0], [0.4, 3.45], [1.95, 4.2], [1.98, 4.6], [0.24, 4.45], [0, 4.75]];
const TJ_ENGINE = [0.5, 1.75, 1.18, 3.35];

// airliner (a 737, an A320, an E175): swept wing, an engine under each side
const AIRLINER = [[0, -4.5], [0.36, -4.2], [0.58, -3.6], [0.62, -1.0], [4.3, 1.4], [4.35, 1.85], [1.8, 1.05], [0.62, 0.9],
  [0.55, 2.7], [0.44, 3.05], [1.85, 4.05], [1.88, 4.45], [0.3, 4.15], [0.12, 4.6], [0, 4.7]];
const AL_ENGINE = [1.32, -1.15, 1.95, 0.25];

// heavy (a 777, a 787, an A330, an MD-11): longer and broader, the wing more swept, its two
// engines bigger; or four of them (a 747, an A380, a C-17)
const HEAVY = [[0, -4.6], [0.42, -4.3], [0.68, -3.65], [0.72, -1.2], [4.4, 1.55], [4.45, 2.0], [1.9, 1.15], [0.72, 1.0],
  [0.62, 2.8], [0.48, 3.2], [2.0, 4.15], [2.03, 4.55], [0.32, 4.25], [0.14, 4.7], [0, 4.8]];
const HV_ENGINE = [1.45, -1.35, 2.25, 0.35];
const QUAD_ENGINES = [[1.25, -1.25, 1.85, 0.05], [2.5, -0.35, 3.08, 0.85]];

// fighter (an F-15, an F-16): a pointed nose, intakes, short trapezoid wings and the tailplanes
const FIGHTER = [[0, -4.6], [0.28, -3.7], [0.5, -2.8], [0.8, -2.35], [0.88, -1.5], [3.55, 0.95], [3.55, 1.65],
  [0.98, 1.75], [0.98, 2.3], [2.3, 3.35], [2.3, 4.0], [0.88, 3.95], [0.62, 4.45], [0, 4.4]];

// helicopter: the main rotor's two blades across a pod, the tail boom, its tail plane and rotor
const HELI_POD = [[0, -2.0], [0.62, -1.85], [0.95, -1.2], [1.0, -0.2], [0.8, 0.75], [0.42, 1.35], [0.2, 1.5],
  [0.18, 3.35], [0.95, 3.4], [0.95, 3.75], [0.18, 3.8], [0.14, 4.2], [0, 4.25]];
const HELI_TAIL_ROTOR = [0.14, 3.75, 0.34, 4.75];

// Each kind: its outline's parts at scale s (sizes relative to the airliner's 1), how far ahead of
// the centre its nose is (where the one-minute line starts) and how far it reaches (so labels
// clear it), both at that scale.
const sc = (v, s) => v.map((n) => n * s);
function make(s, nose, reach, build) { return { d: build(s), nose: nose * s, r: reach * s }; }
export const ICONS = {
  light: make(0.82, 3.2, 4.0, (s) => outline(k(LIGHT, s)) + rect(...sc(LIGHT_PROP, s))),
  turboprop: make(0.84, 4.0, 4.6, (s) => outline(k(TURBOPROP, s)) + pods(...sc(TP_NACELLE, s)) + pair(...sc(TP_PROP, s))),
  bizjet: make(0.8, 4.5, 4.75, (s) => outline(k(TAILJET, s)) + pods(...sc(TJ_ENGINE, s))),
  regional: make(0.98, 4.5, 4.75, (s) => outline(k(TAILJET, s)) + pods(...sc(TJ_ENGINE, s))),
  airliner: make(1, 4.5, 4.7, (s) => outline(k(AIRLINER, s)) + pods(...sc(AL_ENGINE, s))),
  heavy: make(1.3, 4.6, 4.8, (s) => outline(k(HEAVY, s)) + pods(...sc(HV_ENGINE, s))),
  quad: make(1.34, 4.6, 4.8, (s) => outline(k(HEAVY, s)) + QUAD_ENGINES.map((e) => pods(...sc(e, s))).join("")),
  fighter: make(0.86, 4.6, 4.6, (s) => outline(k(FIGHTER, s))),
  heli: make(0.95, 2.0, 4.3, (s) => outline(k(HELI_POD, s)) + bar(0, -0.45 * s, 4.1 * s, 0.5 * s, 45) + bar(0, -0.45 * s, 4.1 * s, 0.5 * s, -45) +
    rect(...sc(HELI_TAIL_ROTOR, s))),
  // nothing says what it is: the radar's plain aircraft, as before
  plain: { d: "M0,-4 L1,-1 L4.2,1.2 L4.2,2 L1,1 L.8,3 L2,4 L2,4.6 L0,4 L-2,4.6 L-2,4 L-.8,3 L-1,1 L-4.2,2 L-4.2,1.2 L-1,-1 Z", nose: 4.2, r: 4.6 },
};
export const iconFor = (kind) => ICONS[kind] || ICONS.plain;
