// Fighters: the F-15 family (Oregon ANG 142nd Wing at PDX) and the Super Hornet family (Navy
// Growlers from Whidbey Island). Format: see ../profiles.js.
//
// These are drawn with `body` outlines (D = 1, so every point is in metres, z = 0 on the belly);
// canopy and windscreen are `glass` panes on the body's hump. Twin fins overlap side-on, so one
// `fin` is drawn (the Super Hornet's 20-degree canted fins at their projected height); the
// stabilators are the `stab`. Intakes, nozzles, LEX edges, conformal tanks, pods and stores are
// drawn by the helpers below. A body outline does not stretch: every family's L0 + over equals
// the types.csv length of its types (F15 19.43 m, F15E 19.45 m, F18S 18.31 m).
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------

// An external store seen side-on: a body of revolution from s0, len long, centred at height zc,
// d across. nose / tail: shares of the length taken by the nose ogive and the tail cone;
// tipF / tipA: diameter of the blunt front / back end as a share of d (0 = pointed or round).
// round: a hemispherical nose (tanks, pods) rather than a pointed one (missiles).
function store(sk, cls, s0, len, zc, d, { nose = 0.25, tail = 0.25, tipF = 0, tipA = 0.12, round = false } = {}) {
  const r = d / 2, s1 = s0 + len, a = s0 + nose * len, b = s1 - tail * len;
  const front = tipF ? [[s0, zc - r * tipF, "c"], [s0, zc + r * tipF, "c"]] : [[s0, zc, round ? "" : "c"]];
  return sk.smooth(cls, [
    ...front, [s0 + (a - s0) * (round ? 0.25 : 0.35), zc + r * (round ? 0.8 : 0.62)], [a, zc + r, "l"], [b, zc + r],
    [s1, zc + r * tipA, "c"], [s1, zc - r * tipA, "c"], [b, zc - r, "l"], [a, zc - r],
    [s0 + (a - s0) * (round ? 0.25 : 0.35), zc - r * (round ? 0.8 : 0.62)],
  ]);
}

// A pylon from height zTop down to the store top zBot, s0..s1 along the store, raked forward at the bottom.
const pylonAt = (sk, s0, s1, zTop, zBot) =>
  sk.poly("pyl", [[s0 + 0.25, zTop + 0.05], [s1, zTop + 0.05], [s1 - 0.25, zBot - 0.02], [s0, zBot - 0.02]]);

// A missile: slender body with a pointed nose, tail fins and (AIM-120, AIM-7) mid-body wings.
function missile(sk, s0, len, zc, d, { wings = 0, canards = false } = {}) {
  const s1 = s0 + len, fh = d * 1.25;
  store(sk, "nac", s0, len, zc, d, { nose: 0.12, tail: 0.02, tipA: 0.8 });
  const fin = (sa, sb, h) => sk.poly("wing", [[sa, zc], [sb - h * 0.2, zc + h], [sb, zc + h], [sb, zc]]);
  const finDown = (sa, sb, h) => sk.poly("wing", [[sa, zc], [sb - h * 0.2, zc - h], [sb, zc - h], [sb, zc]]);
  fin(s1 - len * 0.12, s1, fh); finDown(s1 - len * 0.12, s1, fh);
  if (wings) { fin(s0 + len * wings - 0.35, s0 + len * wings, fh * 0.9); finDown(s0 + len * wings - 0.35, s0 + len * wings, fh * 0.9); }
  if (canards) { fin(s0 + 0.35, s0 + 0.55, fh * 0.6); finDown(s0 + 0.35, s0 + 0.55, fh * 0.6); }
}

// A line in the outline's own stroke (an edge of the airframe rather than a faint panel line).
const edgeLine = (sk, pts) => sk.smooth("hull", pts, false, ' style="fill:none"');

// The wing section at a lateral station y (metres from the centreline): {le, c, z}.
const station = (k, y) => {
  const w = k.f.wing, e = (y - w.root) / (w.span / 2 - w.root);
  return k.sec(Math.max(0, Math.min(1, e)));
};

// ---------- McDonnell Douglas / Boeing F-15 Eagle ----------
// Reference: Wikimedia Commons "McDonnell Douglas F-15 Eagle 3-view.svg", scaled to the overall length 19.43 m
const F15_BODY = [
  [0, 0.47, "c"], [0.25, 0.6], [0.5, 0.72], [1.0, 0.9], [1.5, 1.05], [2.0, 1.17], [2.5, 1.27], [3.0, 1.36], [3.3, 1.42],
  // windscreen and the high bubble canopy, then the long spine sloping down to the engine bay
  [3.6, 1.62], [4.0, 1.83], [4.5, 2.01], [5.0, 2.13], [5.6, 2.2], [6.2, 2.2], [6.8, 2.14], [7.4, 2.03], [7.9, 1.94],
  [8.6, 1.85], [9.6, 1.74], [10.6, 1.6], [11.4, 1.47], [12.1, 1.36], [12.7, 1.31, "l"], [15.6, 1.31],
  // tail boom over the nozzles, ending under the stabilator pivot
  [15.95, 1.4], [16.6, 1.4], [17.6, 1.29], [18.45, 1.22], [18.66, 1.12], [18.72, 0.9, "c"], [18.62, 0.64, "c"],
  // nozzle exit, then the flat belly forward to the radome
  [18.58, 0.62, "c"], [18.58, 0.1, "c"], [18.0, 0.03], [17.0, 0.0, "l"], [6.5, 0.0],
  [5.0, 0.03], [4.0, 0.04], [3.0, 0.06], [2.5, 0.07], [2.0, 0.1], [1.5, 0.15], [1.0, 0.22], [0.5, 0.33], [0.25, 0.4],
];
const F15_WINDSCREEN = [[3.33, 1.43], [3.75, 1.71], [4.22, 1.92], [4.22, 1.47]];
// the F-15C's one-piece bubble; the two-seaters have a frame between the cockpits
const F15_CANOPY_1 = [[4.32, 1.48], [4.32, 1.96], [5.0, 2.15], [6.0, 2.22], [7.0, 2.11], [7.85, 1.93], [7.2, 1.68], [6.0, 1.55]];
const F15_CANOPY_2 = [
  [[4.32, 1.48], [4.32, 1.96], [5.0, 2.15], [5.72, 2.21], [5.72, 1.53]],
  [[5.84, 1.54], [5.84, 2.22], [6.6, 2.18], [7.3, 2.06], [7.85, 1.93], [7.2, 1.68]],
];

// intake (face under the canopy, boundary-layer gap seen dark), shoulder line running back to the
// wing glove, radome joint, the dorsal speed brake and the engine nozzles
const f15Details = ({ sk, top }) => {
  // the big rectangular intake trunk, its own panel from the raked face back to the wing glove:
  // the F-15's most recognisable feature side-on
  sk.poly("nac", [[5.0, 1.24], [7.0, 1.27], [9.9, 1.22], [9.9, 0.02], [5.12, 0.03]]);
  sk.poly("inlet", [[4.84, 1.29], [5.0, 1.24], [5.12, 0.05], [4.98, 0.03]]);
  edgeLine(sk, [[4.84, 1.29, "c"], [5.0, 1.24, "c"], [5.12, 0.04, "c"]]);
  edgeLine(sk, [[4.84, 1.29, "c"], [7.0, 1.27], [9.9, 1.22, "c"]]);
  sk.poly("hl", [[2.62, 1.26], [2.66, 0.1]], false);
  const sb = [];
  for (let s = 8.0; s <= 10.6 + 1e-6; s += 0.4) sb.push([s, top(s) - 0.05]);
  sk.poly("hl", [[8.0, top(8.0)], ...sb, [10.6, top(10.6)]], false);
  sk.poly("core", [[17.55, 0.6], [18.58, 0.62], [18.58, 0.1], [17.55, 0.04]]);
  sk.poly("hl", [[17.95, 0.61], [17.95, 0.07]], false);
  sk.poly("hl", [[18.3, 0.62], [18.3, 0.09]], false);
};
// the long antenna pod along the fin tip, reaching ahead of the leading edge
const f15FinPod = ({ sk, f, L }) => {
  const t = f.fin, zt = 1 + t.h;
  store(sk, "fin", L - t.le + 1.55, 1.55, zt + 0.06, 0.15, { nose: 0.15, tail: 0.1, tipA: 0.6 });
};
// 600-gal centreline tank on its pylon
const f15CentreTank = ({ sk }) => {
  pylonAt(sk, 9.6, 10.9, 0.0, -0.36);
  store(sk, "nac", 7.3, 6.0, -0.76, 0.8, { nose: 0.3, tail: 0.3, tipA: 0.08 });
};
// AIM-120s semi-recessed on the near-side fuselage stations (lower corners of the intake trunk)
const f15FuselageAams = ({ sk }) => {
  missile(sk, 7.85, 3.66, -0.06, 0.18, { wings: 0.4 });
  missile(sk, 11.75, 3.66, -0.06, 0.18, { wings: 0.4 });
};

F.f15c = {
  kind: "fighter", L0: 18.72, over: 0.71, D: 1, W: 3.9, fair: 0,
  body: F15_BODY,
  glass: [F15_WINDSCREEN, F15_CANOPY_1],
  frame: 0.05,
  wing: { le: 9.45, root: 1.94, span: 13.05, cr: 5.75, ct: 1.65, sweep: 45, dih: -1, z: 0.97, t: [0.065, 0.035] },
  fin: { le: 2.87, cr: 2.75, ct: 0.8, h: 3.12, sweep: 39, rudder: 0.72 },
  stab: { le: 3.12, z: 0.72, span: 8.61, root: 2.1, cr: 3.2, ct: 1.45, sweep: 47, dih: 0, thick: 0.05 },
  extras: [f15Details, f15FinPod],
  overlays: [f15CentreTank, f15FuselageAams],
};
// F-15D: the two-seat trainer, outwardly a C with a second cockpit under the same canopy
F.f15d = { ...F.f15c, glass: [F15_WINDSCREEN, ...F15_CANOPY_2] };

// F-15E Strike Eagle: two seats, conformal fuel tanks; wing tanks are left off so the conformal tanks read
const f15Cft = ({ shaded, sk }) => {
  shaded([[6.0, 0.42], [6.35, 0.76], [7.3, 0.87], [12.0, 0.88], [14.4, 0.74], [15.35, 0.42, "c"],
    [14.6, 0.02], [12.0, -0.14], [8.0, -0.14], [6.5, -0.02]]);
  for (const s of [8.1, 9.9, 11.7]) sk.poly("pyl", [[s, -0.1], [s + 0.55, -0.1], [s + 0.5, -0.24], [s + 0.05, -0.24]]);
};
const f15eStores = ({ sk }) => {
  // AN/AAQ-13 navigation pod under the intake
  sk.poly("pyl", [[6.0, 0.0], [6.9, 0.0], [6.8, -0.14], [6.15, -0.14]]);
  store(sk, "nac", 5.0, 2.5, -0.33, 0.38, { nose: 0.1, tail: 0.15, tipF: 0.75, tipA: 0.5 });
};
F.f15e = {
  ...F.f15c, L0: 18.72, over: 0.73,
  glass: [F15_WINDSCREEN, ...F15_CANOPY_2],
  extras: [f15Details, f15FinPod, f15Cft],
  overlays: [f15eStores],
};

// F-15EX Eagle II: the Strike Eagle airframe without CFTs, two seats, and the EPAWSS tail-boom fairings
const epawss = ({ shaded }) => {
  shaded([[18.2, 1.2], [18.9, 1.13], [19.32, 1.05, "c"], [19.36, 0.8, "c"], [18.9, 0.72], [18.2, 0.74]]);
};
F.f15ex = {
  ...F.f15c,
  glass: [F15_WINDSCREEN, ...F15_CANOPY_2],
  overlays: [epawss, f15CentreTank, f15FuselageAams],
};

// ---------- Boeing F/A-18E/F Super Hornet and EA-18G Growler ----------
// Reference: Commons "EA18-1.jpg", cross-checked with the US Navy 3-view "F18 schem 01.gif" and Wikipedia
const SH_NOSE = [[0, 0.72, "c"], [0.25, 0.9], [0.5, 1.0], [0.75, 1.08], [1.0, 1.15], [1.5, 1.31], [2.0, 1.44], [2.5, 1.57], [3.0, 1.67], [3.3, 1.73]];
const SH_AFT = [
  [9.5, 2.01], [10.5, 1.95], [11.5, 1.88], [12.75, 1.8], [13.5, 1.69], [14.5, 1.56], [15.5, 1.51], [16.4, 1.49], [16.9, 1.42], [17.32, 1.33, "c"],
  // nozzle exit, belly, the caret intake's raked face, forward fuselage
  [17.32, 0.6, "c"], [16.9, 0.55], [16.4, 0.47], [16.0, 0.33], [15.6, 0.21], [15.0, 0.17], [14.0, 0.14], [13.0, 0.08], [12.0, 0.04],
  [11.0, 0.01], [10.5, 0.03], [10.0, 0.08], [9.37, 0.18, "c"], [9.04, 0.46, "c"], [8.5, 0.47, "l"], [2.0, 0.45],
  [1.5, 0.46], [1.0, 0.49], [0.75, 0.52], [0.5, 0.56], [0.25, 0.62],
];
// two-seat canopy (F, G): long, its top nearly level over both cockpits
const SH_BODY_2 = [...SH_NOSE, [3.6, 1.88], [4.0, 2.06], [4.5, 2.27], [5.0, 2.44], [5.5, 2.53], [6.0, 2.56], [6.5, 2.53],
  [7.0, 2.46], [7.5, 2.36], [8.0, 2.23], [8.3, 2.13], [8.8, 2.06], ...SH_AFT];
// single-seat canopy (E): shorter and lower, a dorsal spine behind it
const SH_BODY_1 = [...SH_NOSE, [3.6, 1.88], [4.0, 2.06], [4.5, 2.24], [5.0, 2.36], [5.5, 2.41], [6.0, 2.4], [6.5, 2.32],
  [7.0, 2.2], [7.3, 2.13], [7.8, 2.1], [8.8, 2.06], ...SH_AFT];
const SH_WINDSCREEN = [[3.32, 1.75], [3.7, 1.93], [4.24, 2.18], [4.3, 1.77]];
const SH_CANOPY_1 = [[4.42, 1.78], [4.42, 2.22], [5.0, 2.36], [5.8, 2.41], [6.5, 2.33], [7.15, 2.15], [6.6, 2.0]];
const SH_CANOPY_2 = [
  [[4.42, 1.78], [4.42, 2.25], [5.0, 2.45], [5.8, 2.56], [5.82, 1.9]],
  [[5.96, 1.92], [5.96, 2.57], [6.8, 2.52], [7.6, 2.33], [8.1, 2.15], [7.7, 2.14]],
];

// LEX edge from the windscreen to the wing root, the caret intake under it, the nozzle
const shDetails = ({ sk }) => {
  sk.poly("wing", [[3.3, 1.58], [6.0, 1.45], [9.4, 1.2], [9.7, 1.13], [6.0, 1.39], [3.6, 1.52]]);
  sk.poly("inlet", [[8.12, 1.13], [8.4, 1.13], [9.42, 0.19], [9.22, 0.21]]);
  edgeLine(sk, [[8.4, 1.13, "c"], [9.42, 0.19, "c"]]);
  sk.poly("hl", [[8.4, 1.13], [9.7, 1.12]], false);
  sk.poly("core", [[16.45, 1.49], [17.32, 1.33], [17.32, 0.6], [16.45, 0.47]]);
  sk.poly("hl", [[16.9, 1.42], [16.9, 0.55]], false);
};
// AIM-9X on the wingtip launcher
const shTipAim9 = (k) => {
  const q = k.sec(1);
  k.sk.poly("pyl", [[q.le + 0.25, q.z], [q.le + q.c * 0.9, q.z], [q.le + q.c * 0.9, q.z - 0.07], [q.le + 0.1, q.z - 0.07]]);
  missile(k.sk, q.le - 1.15, 3.02, q.z - 0.14, 0.13, { canards: true });
};
// 480-gal tank on the near inboard wing pylon
const shTank = (k) => {
  const { sk } = k, q = station(k, 3.0), zw = k.lower(q, 0.4);
  pylonAt(sk, q.le + 0.5, q.le + 2.2, zw, zw - 0.45);
  store(sk, "nac", q.le - 1.2, 5.0, zw - 0.45 - 0.38, 0.76, { nose: 0.32, tail: 0.32, round: true, tipA: 0.1 });
};
// EA-18G: wingtip pods and a jamming pod under the near wing; the usual tanks are left off (they merge with the pod)
const ga218 = (k) => {
  const q = k.sec(1);
  store(k.sk, "nac", q.le - 1.0, 3.7, q.z - 0.02, 0.32, { nose: 0.2, tail: 0.2, round: true, tipA: 0.3 });
};
const gaAlq99 = (k) => {
  const { sk } = k, q = station(k, 4.1), zw = k.lower(q, 0.4);
  pylonAt(sk, q.le + 0.4, q.le + 1.9, zw, zw - 0.45);
  const s0 = q.le - 1.75, zc = zw - 0.45 - 0.3;
  store(sk, "nac", s0, 4.6, zc, 0.6, { nose: 0.14, tail: 0.3, tipF: 0.55, tipA: 0.25 });
  k.prop(sk, s0 - 0.12, zc, 0.62, 2);
  sk.ellipse("plug", s0 - 0.05, zc, 0.06, 0.09);
};

F.fa18e = {
  kind: "fighter", L0: 17.32, over: 0.99, D: 1, W: 3.8, fair: 0,
  body: SH_BODY_1,
  glass: [SH_WINDSCREEN, SH_CANOPY_1],
  frame: 0.05,
  wing: { le: 9.2, root: 1.9, span: 12.7, cr: 4.25, ct: 2.05, sweep: 27, dih: -2, z: 1.12, t: [0.05, 0.035] },
  fin: { le: 4.57, cr: 2.82, ct: 1.07, h: 2.97, sweep: 46, rudder: 0.72 },
  stab: { le: 2.42, z: 0.97, span: 6.9, root: 1.0, cr: 3.0, ct: 1.6, sweep: 35, dih: -2, thick: 0.05 },
  extras: [shDetails],
  overlays: [shTank, shTipAim9],
};
F.fa18f = { ...F.fa18e, body: SH_BODY_2, glass: [SH_WINDSCREEN, ...SH_CANOPY_2] };
F.ea18g = { ...F.fa18f, overlays: [gaAlq99, ga218] };

export const families = F;

// Variants that share an ICAO code are told apart by the model name (hex database text such as
// "Boeing F-15EX Eagle II" or "MCDONNELL DOUGLAS F-15D"), falling back to the type seen most here.
const isEX = (n) => /F-?15\s*EX\b|\bEAGLE\s+II\b/i.test(n || "");
export const types = {
  F15: (n) => (isEX(n) ? "f15ex" : /F-?15\s*[BD]\b/i.test(n || "") ? "f15d" : "f15c"),
  F15E: (n) => (isEX(n) ? "f15ex" : "f15e"),
  F18S: (n) => {
    const s = n || "";
    if (/EA-?18|GROWLER/i.test(s)) return "ea18g";
    if (/\bF(\/?A)?-?18\s*F\b/i.test(s)) return "fa18f";
    if (/\bF(\/?A)?-?18\s*E\b|SUPER\s+HORNET/i.test(s)) return "fa18e";
    return "ea18g";
  },
};
