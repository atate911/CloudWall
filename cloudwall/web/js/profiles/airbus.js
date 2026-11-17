// Airbus single-aisle family and A220. Format: see ../profiles.js.
const F = {};

// ---------- helpers drawn through the extras/overlays hooks (see silhouette.js) ----------
// The wing-to-body fairing's outline on the fuselage side: [metres aft of the wing-root leading
// edge, metres above the keel], so it follows the wing when a variant is stretched.
const seam = (pts) => (k) => {
  const w = k.f.wing, le = w.le + (k.L - (k.f.L0 || k.L)) * (k.f.fwd ?? 0.5);
  k.sk.smooth("hl", pts.map(([ds, z, fl]) => [le + ds, z, fl]));
};
// A passenger door of a given height (the renderer's own are 1.85 m tall), sill at floor level.
const hatch = (s, w, h) => (k) => {
  const z0 = (k.f.floor ?? 0.36) * k.D + 0.05, [x, y] = k.sk.xy(k.at(s) + w / 2, z0 + h);
  k.sk.out.push(`<rect class="door" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h}" rx="0.2"/>`);
};
// Flap-track fairings as the long canoes Airbus uses: [span fraction, depth below the chord line
// (m), front and aft end as fractions of the local chord].
const canoes = (list) => (k) => {
  for (const [e, d, u0, u1] of list) {
    const q = k.sec(e), P = (u) => q.le + u * q.c, m = (u0 + 1) / 2;
    k.sk.smooth("ftf", [[P(u0), k.lower(q, u0) + 0.02, "c"], [P(m), q.z - d * 0.8], [P(1.02), q.z - d],
      [P(u1), q.z - d * 0.5, "c"], [P(0.99), k.lower(q, 0.99) + 0.02, "c"], [P(m), k.lower(q, m) + 0.02]]);
  }
};
// Airbus wingtip fence: a forward-pointing arrowhead, the upper blade raked back to a point over
// the trailing edge, the lower one cut off square. Points as [fraction of the tip chord, metres
// from the tip chord line].
const fence = (k) => {
  const q = k.sec(1), P = (u, dz, fl) => [q.le + u * q.c, q.z + dz, fl];
  k.sk.smooth("wl", [P(0.2, 0, "c"), P(0.98, 0.51, "c"), P(1.09, 0.51, "c"), P(0.83, 0.1, "c"), P(0.83, -0.5, "c"),
    P(0.75, -0.5, "c"), P(0.52, -0.27), P(0.32, -0.07)]);
};

// ---------- Airbus A320 family ----------
const A320_NOSE = {
  tip: 0.324,
  top: [[0.012, 0.362], [0.03, 0.395], [0.06, 0.435], [0.097, 0.471], [0.145, 0.502], [0.193, 0.531], [0.242, 0.558],
    [0.29, 0.58], [0.336, 0.589, "cl"], [0.449, 0.705], [0.483, 0.746], [0.531, 0.785], [0.58, 0.812], [0.628, 0.833],
    [0.725, 0.87], [0.821, 0.903], [0.918, 0.93], [1.063, 0.964], [1.159, 0.978], [1.256, 0.986], [1.353, 0.995], [1.45, 1]],
  bot: [[0.011, 0.29], [0.03, 0.242], [0.052, 0.217], [0.072, 0.193], [0.097, 0.171], [0.145, 0.145], [0.193, 0.123],
    [0.242, 0.109], [0.29, 0.092], [0.386, 0.065], [0.483, 0.043], [0.58, 0.027], [0.676, 0.014], [0.773, 0.005], [0.87, 0]],
};
const A320_TAIL = {
  top: [[1.83, 1], [1.47, 0.986], [1.1, 0.957], [0.742, 0.943], [0.621, 0.937], [0.5, 0.928], [0.379, 0.913], [0.138, 0.878], [0.065, 0.865], [0, 0.848]],
  bot: [[3.28, 0], [3.16, 0.003], [3.04, 0.014], [2.8, 0.031], [2.55, 0.065], [2.31, 0.101], [2.07, 0.157], [1.83, 0.205], [1.59, 0.258],
    [1.35, 0.314], [1.1, 0.377], [0.862, 0.442], [0.621, 0.512], [0.379, 0.577], [0.258, 0.616], [0.138, 0.655], [0, 0.705]],
};
// flight deck: windscreen, sliding window and fixed aft window over one straight sill line
const A320_GLASS = [
  [[0.336, 0.589], [0.449, 0.705], [0.54, 0.705], [0.464, 0.584]],
  [[0.464, 0.584], [0.54, 0.705], [0.65, 0.705], [0.65, 0.577]],
  [[0.65, 0.705], [0.764, 0.705], [0.797, 0.676], [0.797, 0.572], [0.65, 0.577]],
];
// flap-track fairings 4.87, 8.30 and 11.91 m from the centreline (AC plan view)
const A320_FTF = [[0.199, 0.58, 0.65, 1.27], [0.436, 0.42, 0.3, 1.28], [0.684, 0.44, 0.3, 1.35]];
// belly fairing outline (A320 fig. 2-2-0-991-004 side view)
const A320_FAIRING = [[7.5, 0], [8.0, 0.12], [8.5, 0.27], [8.9, 0.56], [8.8, 0.74], [8.5, 0.9], [8.0, 1.1], [7.0, 1.31],
  [4.5, 1.6], [2.0, 1.75], [0, 1.81], [-1.0, 1.75], [-1.5, 1.68], [-2.0, 1.5], [-2.3, 1.12], [-2.37, 0.9], [-2.3, 0.7],
  [-2.0, 0.32], [-1.5, 0.12], [-1.0, 0, "c"]];
// nacelles, placed against the wing section at the engine (5.75 m from the centreline).
// CFM56-5B: short fan cowl, exposed core cowl and plug, as drawn in the AC side views; inlet lip
// 11.6 m from the nose (side and plan views, and a planform photo; the AC's own "11.19 m" label
// disagrees with all three). IAE V2500-A5: long-duct nacelle to one mixed-flow nozzle with a
// small tail cone, its low point 0.18 m higher (AC 2-3-0: 1.24 / 1.42 m above ground, jacked),
// inlet 0.07 m further forward (AC plan-view labels); length from photos (about 2.4 diameters).
// PW1100G-JM: 2.5 m diameter, inlet 0.3 m further forward than the CFM56 and low point 0.11 m
// lower (AC neo figures and 2-3-0 table; Spirit A320neo planform photo).
const CFM56 = { kind: "fan", at: [0.26], fwd: 3.37, drop: 1.72, len: 4.7, dia: 2.18, fx: 0.68, cx: 0.94, pyTe: 0.62 };
const V2500 = { kind: "fan", at: [0.26], fwd: 3.44, drop: 1.59, len: 5.0, dia: 2.08, style: "long", fx: 0.88, pyTe: 0.62 };
const PW1100G = { kind: "fan", at: [0.26], fwd: 3.67, drop: 1.69, len: 4.95, dia: 2.5, fx: 0.71, cx: 0.88, pyFront: 0.25, pyTe: 0.62 };
// sharklet (AC fig. 2-2-0-991-009): 2.43 m tall, blended into the tip, raked tip chord 0.5 m
const SHARKLET = { h: 2.38, sweep: 32, top: 0.3, base: 0.41, blend: 0.9 };
const WIN = { z: 0.662, pitch: 0.533, w: 0.23, h: 0.33 };
const row = (from, to, pitch = WIN.pitch) => ({ ...WIN, from, to, pitch });

// References: Airbus "A320 Aircraft Characteristics - Airport and Maintenance Planning" (AC, Jul
// 2026): fig. 2-2-0-991-004 (A320-200, wingtip fence, side, plan and front views), -009 (A320neo),
// 2-3-0 ground clearances (heights at jacked attitude), 2-7-0-991-003 door locations; A318/A319/A321
// AC documents fig. 2-2-0-991-001/-002/-005/-010/-012 and 2-7-0 door locations for the variants.
// Measured on the A320-200 side view. All four share the nose, tail cone, fin (taller on the A318),
// tailplane and wing; plugs ahead of and behind the wing set each length (wheelbases 10.25 /
// 11.04 / 12.64 / 16.90 m give the share ahead of the wing).
F.a320 = {
  kind: "narrow", L0: 37.57, over: 0, D: 4.14, W: 3.95, fwd: 0.5, fair: 0.025, fairAft: 1.33,
  nose: A320_NOSE, tail: A320_TAIL, glass: A320_GLASS, frame: 0.06,
  floor: 0.39,
  doors: [[5.04, 0.81], [8.16, 1.82, "C"], [1.43, 0.51, "E", "w"], [2.28, 0.51, "E", "w"], [-14.88, 1.82, "C"], [-8.04, 0.81]],
  win: [row(6.19, -9.92)],
  wing: { le: 13.0, span: 33.0, cr: 5.7, kink: [0.308, 3.33], ct: 1.5, sweep: 27.6, dih: 5.1, z: 0.314, t: [0.15, 0.108] },
  eng: V2500,
  fin: { le: 7.73, cr: 5.44, ct: 1.76, h: 5.82, sweep: 41.3, fillet: [1.55, 0.95] },
  stab: { le: 5.39, z: 0.703, span: 12.45, root: 1.1, cr: 3.4, ct: 1.24, sweep: 34, dih: 6.5 },
  extras: [seam(A320_FAIRING)],
  overlays: [canoes(A320_FTF), fence],
};
// A320neo: PW1100G (Spirit's fleet outnumbers Frontier's partly LEAP-1A one) and sharklets
F.a20n = { ...F.a320, eng: PW1100G, tip: SHARKLET, overlays: [canoes(A320_FTF)] };

// A319: 1.60 m shorter ahead of the wing and 2.13 m behind; one pair of overwing exits (the aft
// one; the forward pair is optional). CFM56-5B, as on most US A319s (American, Delta, Allegiant).
const A319 = {
  fwd: 0.43, eng: CFM56,
  doors: [[5.04, 0.81], [8.16, 1.82, "C"], [2.28, 0.51, "E", "w"], [-13.28, 1.82, "C"], [-8.03, 0.81]],
};
// A318: a further 0.79 m shorter ahead of the wing, 1.6 m behind it; fin 0.75 m taller (an
// extension above the rudder). CFM56-5B.
const A318 = {
  fwd: 0.39, eng: CFM56, fairAft: 1.2,
  doors: [[5.04, 0.81], [7.89, 1.82, "C"], [2.27, 0.51, "E", "w"], [-12.47, 1.82, "C"], [-8.03, 0.81]],
  fin: { ...F.a320.fin, h: 6.57, ct: 1.5, rudder: 0 },
  extras: [seam(A320_FAIRING), (k) => {
    // rudder hinge line, stopping where the fin-tip extension starts, then across to the trailing edge
    const t = k.f.fin, s0 = k.L - t.le, sw = k.tan(t.sweep), zt = k.D + t.h, zx = zt - 0.78;
    const tipLE = s0 + (zt - k.top(s0)) * sw, a = s0 + t.cr * 0.7, za = k.top(a), te = s0 + t.cr, zte = k.top(te) - 0.4;
    const at = (s1, z1, s2, z2) => s1 + (s2 - s1) * (zx - z1) / (z2 - z1);
    k.sk.poly("hl", [[a, za], [at(a, za, tipLE + t.ct * 0.7, zt), zx], [at(te, zte, tipLE + t.ct, zt), zx]], false);
  }],
};
// A321: 4.27 m plug ahead of the wing, 2.67 m behind; four door pairs, doors 2 and 3 the smaller
// 0.76 x 1.52 m type (drawn here, the renderer's doors are 1.85 m tall). IAE V2500 (American,
// JetBlue, Spirit) and sharklets, as most US A321ceos were delivered.
const A321 = {
  fwd: 0.614, eng: V2500, tip: SHARKLET, overlays: [canoes(A320_FTF)],
  doors: [[5.02, 0.81], [8.16, 1.82, "C"], [-14.89, 1.82, "C"], [-7.93, 0.81]],
  win: [row(6.23, 12.7), row(14.74, 17.95), row(18.73, 19.53, 0.79), row(20.18, 23.4), row(26.07, -9.96)],
  extras: [seam(A320_FAIRING), hatch(13.84, 0.76, 1.52), hatch(-19.72, 0.76, 1.52)],
};
// A321neo ACF (Airbus Cabin Flex, nearly all US A321neos): door 1, two pairs of overwing exits,
// a 0.76 x 1.52 m door 3 behind the wing, door 4. PW1100G (Delta, United, JetBlue, Spirit).
const A21N = {
  fwd: 0.614, eng: PW1100G, tip: SHARKLET, overlays: [canoes(A320_FTF)],
  doors: [[5.04, 0.81], [8.56, 1.82, "C"], [1.43, 0.51, "E", "w"], [2.28, 0.51, "E", "w"], [-14.49, 1.82, "C"], [-8.04, 0.81]],
  win: [row(6.2, 25.6), row(28.14, -9.96)],
  extras: [seam(A320_FAIRING), hatch(-17.69, 0.76, 1.52)],
};

// ---------- Airbus A220 (Bombardier CSeries) ----------
// References: Airbus "A220-100 / A220-300 Aircraft Characteristics" BD500-3AB48-13800-00:
// A220-100 fig. 1 general aircraft dimensions sheet 2 (side view; measured), sheet 1 / the
// A220-300 sheet 2 (plan view, the same drawing: wing, nacelle 2.45 m wide, tailplane), fig. 11
// door distances from the nose, table 11 door sizes, A220-300 table 7 ground clearances. The
// drawings show no cabin windows: those (0.54 m pitch, first 6.5 m from the nose, last 9.9 m from
// the tail) come from a side-on photo (Wikimedia Commons, Delta A220-300 N333DU, Boston 2025).
// Shown from the right: service doors 1R/2R (0.8 x 1.5 m) and the cargo doors. A clean-sheet
// pointed nose with a two-pane side view of the flight deck, a deep belly fairing, PW1500G.
const A220_NOSE = {
  tip: 0.285,
  top: [[0.015, 0.325], [0.06, 0.379], [0.108, 0.427], [0.163, 0.467], [0.217, 0.505], [0.271, 0.546], [0.325, 0.579],
    [0.379, 0.614], [0.434, 0.654], [0.488, 0.69], [0.542, 0.725], [0.596, 0.757], [0.65, 0.79], [0.705, 0.82], [0.759, 0.841],
    [0.813, 0.863], [0.867, 0.879], [0.921, 0.898], [0.976, 0.912], [1.03, 0.923], [1.084, 0.936], [1.192, 0.958],
    [1.301, 0.977], [1.409, 0.986], [1.518, 0.994], [1.626, 1]],
  bot: [[0.015, 0.244], [0.038, 0.217], [0.108, 0.164], [0.163, 0.14], [0.217, 0.121], [0.271, 0.104], [0.325, 0.091],
    [0.379, 0.077], [0.434, 0.066], [0.488, 0.056], [0.542, 0.047], [0.596, 0.042], [0.65, 0.034], [0.705, 0.031],
    [0.813, 0.019], [0.921, 0.011], [1.084, 0]],
};
const A220_FAIRING = [[8.15, 0], [8.65, 0.065], [9.05, 0.2], [9.2, 0.32], [9.17, 0.42], [8.91, 0.6], [8.49, 0.8], [7.9, 1.0],
  [7.0, 1.2], [5.0, 1.5], [2.15, 1.68], [0.15, 1.68], [-0.35, 1.64], [-0.85, 1.57], [-1.35, 1.48], [-2.35, 1.2], [-2.82, 1.0],
  [-3.12, 0.8], [-3.33, 0.6], [-3.37, 0.4], [-3.25, 0.26], [-3.05, 0.155], [-2.65, 0, "c"]];
F.a220 = {
  kind: "narrow", L0: 34.97, over: 0, D: 3.7, W: 3.51, fwd: 0.594, fair: 0.122, fairAft: 1.49,
  nose: A220_NOSE,
  tail: {
    top: [[2.431, 1], [2.16, 0.993], [1.889, 0.985], [1.618, 0.977], [1.347, 0.969], [1.076, 0.958], [0.805, 0.942],
      [0.669, 0.934], [0.534, 0.923], [0.398, 0.907], [0.263, 0.893], [0.127, 0.871], [0, 0.862]],
    bot: [[3.252, 0], [3.108, 0.008], [2.973, 0.022], [2.837, 0.038], [2.702, 0.06], [2.566, 0.081], [2.431, 0.108],
      [2.295, 0.13], [2.16, 0.16], [2.024, 0.187], [1.889, 0.214], [1.618, 0.274], [1.347, 0.336], [1.076, 0.396],
      [0.805, 0.461], [0.534, 0.526], [0.263, 0.596], [0.127, 0.637], [0, 0.659]],
  },
  // windscreen along the nose line, then the large side window with its rounded aft edge
  glass: [
    [[0.333, 0.575], [0.55, 0.732], [0.653, 0.74], [0.542, 0.623], [0.493, 0.604]],
    [[0.58, 0.618], [0.696, 0.737], [0.797, 0.737, ""], [0.84, 0.675, ""], [0.827, 0.593, ""], [0.71, 0.58, ""]],
  ],
  frame: 0.05, floor: 0.38,
  doors: [[7.05, 1.1, "C"], [1.56, 0.59, "E", "w"], [-13.3, 1.1, "C"]],
  win: [{ z: 0.675, from: 6.5, to: -9.94, pitch: 0.54, w: 0.3, h: 0.41 }],
  wing: { le: 11.85, root: 1.75, span: 32.2, cr: 6.0, kink: [0.313, 3.56], ct: 1.65, sweep: 28.7, dih: 5.9, z: 0.308, t: [0.14, 0.1] },
  tip: { h: 1.26, sweep: 47, top: 0.44, base: 0.57, blend: 0.25 },
  eng: { kind: "fan", at: [0.258], fwd: 3.83, drop: 1.5, len: 4.71, dia: 2.43, fx: 0.74, cx: 0.91, pyFront: 0.3, pyTe: 0.55 },
  fin: { le: 7.85, cr: 4.95, ct: 1.79, h: 5.92, sweep: 41, fillet: [1.8, 1.0], rudder: 0.67 },
  stab: { le: 5.47, z: 0.716, span: 12.3, root: 1.25, cr: 3.0, ct: 1.35, sweep: 36, dih: 6.8 },
  extras: [seam(A220_FAIRING), hatch(4.7, 0.8, 1.5), hatch(-8.87, 0.8, 1.5)],
  overlays: [canoes([[0.213, 0.36, 0.55, 1.22], [0.408, 0.33, 0.45, 1.22], [0.61, 0.3, 0.4, 1.25]])],
};

export const families = F;
export const types = {
  A318: ["a320", A318], A319: ["a320", A319], A320: "a320", A321: ["a320", A321],
  A19N: ["a20n", { ...A319, eng: PW1100G }], A20N: "a20n", A21N: ["a20n", A21N],
  // A220-300: 2.21 m plug ahead of the wing, 1.51 m behind (wheelbase 13.1 -> 15.3 m)
  BCS1: "a220", BCS3: "a220",
};
