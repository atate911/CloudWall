// Business jets. Format: see ../profiles.js.
const F = {};

// ---------- helpers drawn through the extras hook (see silhouette.js) ----------
// An intake opening (the Falcon 900's S-duct) drawn as a dark ellipse: s (< 0 from the tail end),
// centre z and half-height r in metres.
const intake = (s, z, r) => (k) => k.sk.ellipse("inlet", k.at(s) + r * 0.3, z, r * 0.4, r * 0.9);
// A door outline with its own size (the renderer's passenger door is airliner-sized): centre s
// (< 0 from the tail end), width w, sill z0 and height h in metres.
const hatch = (s, w, z0, h, r = 0.14) => (k) => {
  const [x, y] = k.sk.xy(k.at(s) + w / 2, z0 + h);
  k.sk.out.push(`<rect class="door" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h}" rx="${r}"/>`);
};
// A ventral fin (or other small surface) under the tail cone: [d, z, flag] points, d metres forward
// of the tail-cone end, z above the keel. Drawn after the fuselage.
const ventral = (pts) => (k) => k.sk.smooth("fin", pts.map(([d, z, fl]) => [k.L - d, z, fl ?? "c"]));
// A centre-engine exhaust (or APU outlet) at the tail-cone end: a short nozzle ring of radius r,
// centre z metres above the keel.
const nozzle = (z, r, len = 0.35) => (k) => {
  const s = k.L;
  k.sk.poly("core", [[s - len, z + r], [s + 0.02, z + r * 0.92], [s + 0.02, z - r * 0.92], [s - len, z - r]]);
  k.sk.ellipse("inlet", s + 0.02, z, 0.05, r * 0.85);
};

// Small parts traced off a type's drawing: [class, [[s, z, flag]...], closed?] in metres (s from the
// nose tip, z above the keel), drawn as smooth shapes (antennas, fairings, doors, seams).
const marks = (parts) => (k) => { for (const [cls, pts, closed = true] of parts) k.sk.smooth(cls, pts.map(([s, z, fl]) => [s, z, fl ?? "c"]), closed); };

// ---------- Dassault Falcon 2000 (F2TH) and Falcon 900 (F900) ----------
// No drawing reachable: Falcon 2000 proportions from the side-on photo of the Bulgarian Air Force Falcon 2000 (Commons)
F.f2th = {
  kind: "bizjet", L0: 18.3, over: 1.93, D: 2.33, W: 2.5, fwd: 0.5, fair: 0.04,
  nose: {
    tip: 0.21,
    top: [[0.05, 0.28], [0.26, 0.41], [0.52, 0.52], [0.78, 0.61, "c"], [0.9, 0.765], [1.03, 0.835], [1.21, 0.9], [1.42, 0.945],
      [1.64, 0.98], [2.06, 1]],
    bot: [[0.05, 0.17], [0.14, 0.14], [0.27, 0.095], [0.42, 0.077], [0.71, 0.03], [0.99, 0.009], [1.3, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.0, 0.985], [0.5, 0.95], [0.25, 0.9], [0, 0.77]],
    bot: [[3.2, 0], [2.05, 0.12], [1.61, 0.19], [1.16, 0.28], [0.72, 0.42], [0.27, 0.55], [0.05, 0.7], [0, 0.735]],
  },
  glass: [
    [[0.74, 0.62], [0.9, 0.74], [1.03, 0.78], [1.03, 0.62]],
    [[1.05, 0.79], [1.24, 0.79], [1.24, 0.63], [1.05, 0.63]],
    [[1.27, 0.79], [1.44, 0.79], [1.47, 0.75, ""], [1.47, 0.67, ""], [1.44, 0.63], [1.27, 0.63]],
  ],
  floor: 0.15,
  doors: [[4.6, 0.8]],
  win: [{ z: 0.59, from: 5.93, to: 9.86, pitch: 0.49, w: 0.23, h: 0.33 }],
  wing: { le: 7.65, root: 1.2, span: 21.38, cr: 4.2, ct: 1.25, sweep: 28, dih: 3, z: 0.1, t: [0.12, 0.09] },
  eng: { kind: "fan", aft: { s: 5.41, z: 0.73 }, len: 2.9, dia: 1.25, style: "long", fx: 0.88 },
  fin: { le: 3.23, cr: 2.5, ct: 1.5, h: 3.47, sweep: 31, fillet: [1.6, 0.6], cap: 0.1 },
  stab: { le: 3.0, fz: 0.17, span: 7.6, root: 0.3, cr: 1.9, ct: 0.9, sweep: 30, dih: 0 },
};

// Falcon 900/900EX/LX (F900): the Falcon 2000 nose and section on a cabin 2.1 m longer, three TFE731s
F.f900 = {
  ...F.f2th, L0: 18.25, over: 1.96,
  // the S-duct fairing is part of the outline: intake lip 6.9 m ahead of the tail end, 0.84 m above
  // the crown, running back over the centre engine to its nozzle
  tail: {
    top: [[3.1, 1], [2.99, 1.06, "c"], [2.96, 1.36, "c"], [2.7, 1.39], [2.0, 1.33], [1.2, 1.2], [0.6, 1.05], [0.2, 0.93], [0, 0.87]],
    bot: [[3.4, 0], [2.4, 0.11], [1.8, 0.19], [1.2, 0.29], [0.7, 0.38], [0.3, 0.45], [0, 0.48]],
  },
  doors: [[4.4, 0.8]],
  win: [{ z: 0.59, from: 5.4, to: 11.6, pitch: 0.52, w: 0.23, h: 0.33 }],
  wing: { le: 8.0, root: 1.2, span: 19.33, cr: 4.4, ct: 1.3, sweep: 29, dih: 3, z: 0.1, t: [0.12, 0.09] },
  eng: { kind: "fan", aft: { s: 5.05, z: 0.72 }, len: 2.75, dia: 1.06, style: "long", fx: 0.86 },
  extras: [intake(-6.9, 2.82, 0.3)],
  overlays: [nozzle(1.57, 0.4)],
  fin: { le: 3.1, cr: 2.75, ct: 1.5, h: 3.9, sweep: 33, cap: 0.1 },
  stab: { le: 3.0, fz: 0.3, span: 7.7, root: 0.3, cr: 1.9, ct: 0.9, sweep: 30, dih: 0 },
};

// ---------- Bombardier Challenger 604/605/650 (CL60; also the default business jet) ----------
// The CL-600 airframe that the CRJ grew from: nose and flight deck measured on the CRJ900 APM, scaled to 20.85 m
F.cl60 = {
  kind: "bizjet", L0: 18.69, over: 2.16, D: 2.69, W: 2.69, fwd: 0.5, fair: 0.05,
  nose: {
    tip: 0.24,
    top: [[0.1, 0.36], [0.25, 0.45], [0.5, 0.585], [0.75, 0.735], [1.0, 0.88], [1.25, 0.96], [1.5, 0.995], [1.75, 1]],
    bot: [[0.1, 0.15], [0.3, 0.08], [0.55, 0.03], [0.9, 0.005], [1.2, 0]],
  },
  tail: {
    top: [[2.0, 1], [1.5, 0.99], [1.0, 0.95], [0.62, 0.87], [0.3, 0.79], [0, 0.7]],
    bot: [[2.3, 0], [1.67, 0.08], [1.21, 0.21], [0.75, 0.38], [0.29, 0.54], [0.07, 0.63], [0, 0.66]],
  },
  glass: [
    [[0.58, 0.61], [0.86, 0.79], [0.87, 0.6]],
    [[0.89, 0.79], [1.36, 0.785], [1.37, 0.6], [0.89, 0.6]],
  ],
  floor: 0.227,
  doors: [[4.89, 0.95]],
  win: [{ z: 0.643, from: 6.03, to: 10.5, pitch: 0.742, w: 0.26, h: 0.39 }],
  wing: { le: 8.8, root: 1.25, span: 19.61, cr: 5.0, ct: 1.25, sweep: 28, dih: 3, z: 0.08, t: [0.13, 0.1] },
  tip: { h: 1.1, sweep: 40, top: 0.3, base: 0.9 },
  eng: { kind: "fan", aft: { s: 7.44, z: 0.75 }, len: 3.8, dia: 1.34, style: "long", fx: 0.86, plug: 0.5 },
  fin: { le: 3.99, cr: 3.85, ct: 2.16, h: 2.5, sweep: 43.5, fillet: [1.0, 0.25] },
  stab: { le: 1.39, z: "T", span: 7.0, root: 0.25, cr: 1.9, ct: 0.9, sweep: 38, dih: 0, bullet: [2.6, 0.22] },
  // from the photo of Challenger 605 A7-CEB: the swept blades on the spine over the door and behind the
  // cabin, the two low domes between them, the door handle and the round fitting under the door
  extras: [({ sk, top }) => {
    const t = (s) => top(s) - 0.02;
    for (const [s, h] of [[5.08, 0.24], [10.2, 0.24]]) sk.poly("strut", [[s, t(s)], [s + 0.26, top(s) + h], [s + 0.36, top(s) + h + 0.02], [s + 0.2, t(s)]]);
    for (const a of [6.56, 8.0]) sk.smooth("hull", [[a, t(a), "c"], [a + 0.06, top(a) + 0.05, ""], [a + 0.24, top(a) + 0.05, ""], [a + 0.3, t(a + 0.3), "c"]]);
    sk.poly("door", [[4.4, 0.83], [4.73, 0.83]], false);
    sk.ellipse("hub", 7.22, 0.6, 0.05, 0.05);
  }],
};

// ---------- Bombardier Challenger 300/350 (CL30, CL35) ----------
// No drawing reachable: proportions from the side-on photo of N535FX (Commons), scaled to the 20.92 m overall length
F.cl30 = {
  kind: "bizjet", L0: 19.1, over: 1.82, D: 2.27, W: 2.4, fwd: 0.5, fair: 0.06,
  nose: {
    tip: 0.19,
    top: [[0.1, 0.29], [0.21, 0.34], [0.47, 0.47], [0.76, 0.66], [1.06, 0.84], [1.4, 0.95], [1.74, 0.99], [2.0, 1]],
    bot: [[0.13, 0.085], [0.25, 0.04], [0.38, 0.017], [0.55, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.5, 0.96], [0.8, 0.87], [0.3, 0.76], [0, 0.69]],
    bot: [[3.2, 0], [2.6, 0.06], [2.0, 0.15], [1.4, 0.27], [0.9, 0.39], [0.45, 0.5], [0.15, 0.58], [0, 0.62]],
  },
  glass: [
    [[0.76, 0.665], [0.93, 0.79], [1.06, 0.8], [0.95, 0.665]],
    [[1.08, 0.8], [1.4, 0.8], [1.4, 0.67], [1.08, 0.67]],
  ],
  frame: 0.04,
  floor: 0.04,
  doors: [[4.25, 0.74]],
  win: [{ z: 0.64, from: 5.65, to: 9.95, pitch: 0.854, w: 0.27, h: 0.38 }],
  wing: { le: 9.3, root: 1.2, span: 19.46, cr: 4.3, ct: 1.2, sweep: 29, dih: 3, z: 0.08, t: [0.13, 0.1] },
  tip: { h: 0.5, sweep: 45, top: 0.35, base: 0.85 },
  eng: { kind: "fan", aft: { s: 6.31, z: 0.81 }, len: 3.45, dia: 1.18, style: "long", fx: 0.88 },
  fin: { le: 2.95, cr: 2.85, ct: 2.3, h: 2.3, sweep: 36, fillet: [1.2, 0.2] },
  stab: { le: 1.12, z: "T", span: 7.6, root: 0.25, cr: 1.8, ct: 0.85, sweep: 33, dih: 0, bullet: [2.4, 0.2] },
  // from the same photo of N535FX: the two blade antennas on the spine and the swept blade under the belly
  extras: [({ sk, top, bottom }) => {
    const t = (s) => top(s) - 0.02, b = (s) => bottom(s) + 0.02;
    sk.poly("strut", [[5.809, t(5.81)], [6.108, 2.569], [6.258, 2.588], [6.164, t(6.16)]]);
    sk.poly("strut", [[11.301, t(11.3)], [11.339, 2.55], [11.507, 2.569], [11.544, t(11.54)]]);
    sk.poly("strut", [[4.67, b(4.67)], [4.875, -0.27], [5.044, -0.327], [4.913, b(4.91)]]);
    sk.poly("hl", [[3.624, 2.121], [4.595, 2.121]], false);
    sk.smooth("door", [[4.016, 0.57], [4.222, 0.57], [4.222, 0.365], [4.016, 0.365]].map((p) => [...p, "c"]));
    sk.poly("door", [[1.606, 0.757], [1.887, 1.056], [2.073, 1.093]], false);
    sk.poly("door", [[2.447, 1.317], [2.54, 1.429], [2.634, 1.448]], false);
    sk.smooth("door", [[1.775, 0.458, "c"], [2.148, 0.458, "c"], [2.148, 0.14, "c"], [1.775, 0.14, "c"]]);
    sk.smooth("door", [[2.54, 0.439, "c"], [2.895, 0.439, "c"], [2.895, 0.103, "c"], [2.54, 0.103, "c"]]);
    sk.ellipse("hub", 7.416, 0.365, 0.07, 0.07);
  }],
};

// ---------- Learjet 45/75 (LJ45, LJ75) ----------
// No drawing reachable: proportions from the side-on photo of N300JC (Commons), scaled to the 17.68 m overall length
F.lj45 = {
  kind: "bizjet", L0: 15.63, over: 2.05, D: 1.8, W: 1.8, fwd: 0.5, fair: 0.05,
  nose: {
    tip: 0.24,
    top: [[0.18, 0.4], [0.4, 0.51], [0.68, 0.58], [0.91, 0.66], [1.11, 0.71, "c"], [1.4, 0.88], [1.63, 0.96], [1.92, 1]],
    bot: [[0.07, 0.17], [0.24, 0.12], [0.48, 0.08], [0.76, 0.05], [1.1, 0.01], [1.3, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.2, 0.94], [0.5, 0.83], [0, 0.75]],
    bot: [[3.4, 0], [2.6, 0.1], [1.8, 0.27], [1.1, 0.44], [0.5, 0.58], [0, 0.66]],
  },
  glass: [
    [[1.11, 0.715], [1.37, 0.905], [1.63, 0.905], [1.6, 0.73]],
  ],
  frame: 0.035,
  // from the side-on photo of N300JC: the swept blade on the spine behind the wing
  extras: [hatch(3.62, 0.8, 0.3, 1.42), ({ sk, top, bottom }) => {
    sk.poly("strut", [[7.21, top(7.21) - 0.02], [7.36, top(7.36) + 0.24], [7.43, top(7.43) + 0.26], [7.33, top(7.33) - 0.02]]);
    sk.poly("strut", [[5.25, bottom(5.25) + 0.02], [5.38, bottom(5.38) - 0.26], [5.45, bottom(5.45) - 0.3], [5.37, bottom(5.37) + 0.02]]);
    sk.smooth("door", [[3.43, 0.7, "c"], [3.58, 0.7, "c"], [3.58, 0.64, "c"], [3.43, 0.64, "c"]]);
  }],
  overlays: [ventral([[2.3, 0.78], [1.1, 0.36], [0.6, 0.36], [0.45, 1.12], [1.4, 0.98]]), ({ sk }) => {
    // the bullet: from 0.375 m ahead of the fin tip's leading edge, 1.5 m long, on the tailplane 0.1 m
    // under the fin top
    const tipLE = 15.63 - 2.24 + 1.75 * Math.tan((45.6 * Math.PI) / 180), s0 = tipLE - 0.375, z = 1.8 + 1.75 - 0.1;
    sk.smooth("strut", [[s0 + 0.9, z + 0.15, "c"], [s0 + 0.95, z + 0.24], [s0 + 1.02, z + 0.24], [s0 + 1.05, z + 0.12, "c"]]);
    sk.ellipse("hub", s0 + 1.5, z + 0.04, 0.05, 0.05);
  }],
  win: [{ z: 0.76, from: 4.13, to: 7.98, pitch: 0.549, w: 0.3, h: 0.38 }],
  wing: { le: 6.1, root: 0.9, span: 14.58, cr: 3.0, ct: 1.1, sweep: 13, dih: 2.5, z: 0.06, t: [0.13, 0.1] },
  tip: { h: 0.95, sweep: 32, top: 0.35, base: 0.85 },
  eng: { kind: "fan", aft: { s: 6.83, z: 0.81 }, len: 2.9, dia: 0.97, style: "long", fx: 0.9 },
  fin: { le: 2.24, cr: 2.45, ct: 1.0, h: 1.75, sweep: 45.6, fillet: [0.8, 0.15] },
  stab: { le: 0.66, z: "T", span: 4.8, root: 0.2, cr: 1.4, ct: 0.6, sweep: 40, dih: 0, bullet: [1.5, 0.16] },
};

// ---------- Hawker 800 (H25B) ----------
// No drawing reachable: proportions from the side-on photo of N75GR (Commons), scaled to the 15.60 m overall length
F.h25b = {
  kind: "bizjet", L0: 13.43, over: 2.17, D: 1.99, W: 1.99, fwd: 0.5, fair: 0.06,
  nose: {
    tip: 0.28,
    top: [[0.1, 0.36], [0.24, 0.43], [0.56, 0.56], [0.77, 0.68, "c"], [1.05, 0.85], [1.37, 0.97], [1.6, 1]],
    bot: [[0.08, 0.2], [0.32, 0.1], [0.64, 0.03], [0.95, 0]],
  },
  tail: {
    top: [[2.4, 1], [1.5, 0.93], [0.8, 0.8], [0.3, 0.64], [0, 0.52]],
    bot: [[2.6, 0], [1.6, 0.06], [1.1, 0.1], [0.7, 0.16], [0.3, 0.28], [0, 0.4]],
  },
  glass: [
    [[0.77, 0.66], [1.0, 0.84], [1.07, 0.85], [1.05, 0.66]],
    [[1.09, 0.86], [1.25, 0.88], [1.25, 0.67], [1.09, 0.67]],
    [[1.28, 0.885], [1.44, 0.885], [1.47, 0.84, ""], [1.47, 0.72, ""], [1.44, 0.67], [1.28, 0.67]],
  ],
  frame: 0.035,
  extras: [hatch(3.6, 0.72, 0.13, 1.39, 0.3)],
  win: [{ z: 0.65, from: 4.96, to: 7.83, pitch: 0.571, w: 0.21, h: 0.32 }],
  wing: { le: 5.7, root: 0.95, span: 15.66, cr: 3.0, ct: 1.1, sweep: 20, dih: 2, z: 0.05, t: [0.13, 0.1] },
  eng: { kind: "fan", aft: { s: 4.36, z: 0.43 }, len: 3.5, dia: 1.12, style: "long", fx: 0.85 },
  fin: { le: 2.43, cr: 2.3, ct: 1.3, h: 2.02, sweep: 55, fillet: [1.85, 0.18, "l"] },
  stab: { le: 0.56, fz: 0.55, span: 6.1, root: 0.25, cr: 1.6, ct: 0.75, sweep: 30, dih: 0 },
};

// ---------- Gulfstream G280 (G280) ----------
// No drawing reachable: built from Wikipedia and the side-on photo of N280GD (Commons): pointed nose, ten oval windows
F.g280 = {
  kind: "bizjet", L0: 18.6, over: 1.77, D: 2.38, W: 2.38, fwd: 0.5, fair: 0.06,
  nose: {
    tip: 0.2,
    top: [[0.1, 0.32], [0.31, 0.47], [0.5, 0.6], [0.67, 0.73], [0.85, 0.84], [1.04, 0.91], [1.25, 0.97], [1.45, 0.995], [1.6, 1]],
    bot: [[0.1, 0.12], [0.25, 0.06], [0.5, 0.02], [0.8, 0]],
  },
  tail: {
    top: [[2.6, 1], [1.5, 0.95], [0.8, 0.86], [0.3, 0.76], [0, 0.7]],
    bot: [[3.2, 0], [2.5, 0.07], [1.8, 0.18], [1.2, 0.3], [0.6, 0.45], [0.2, 0.56], [0, 0.6]],
  },
  glass: [
    [[0.68, 0.72], [0.93, 0.88], [1.2, 0.93], [1.2, 0.76]],
    [[1.25, 0.93], [1.6, 0.94], [1.62, 0.84, ""], [1.6, 0.76], [1.25, 0.76]],
  ],
  frame: 0.04,
  floor: 0.1,
  extras: [hatch(3.75, 0.85, 0.35, 1.75, 0.3)],
  win: [{ z: 0.68, from: 4.73, to: 10.9, pitch: 0.682, w: 0.28, h: 0.36 }],
  wing: { le: 8.3, root: 1.2, span: 19.2, cr: 4.4, ct: 1.2, sweep: 34, dih: 3, z: 0.07, t: [0.13, 0.1] },
  tip: { h: 1.2, sweep: 45, top: 0.35, base: 0.85, blend: 0.25 },
  eng: { kind: "fan", aft: { s: 6.04, z: 1.0 }, len: 3.7, dia: 1.2, style: "long", fx: 0.88 },
  fin: { le: 3.4, cr: 3.3, ct: 2.2, h: 2.9, sweep: 38, fillet: [1.2, 0.3] },
  stab: { le: 1.3, z: "T", span: 7.6, root: 0.25, cr: 1.9, ct: 0.9, sweep: 32, dih: 0, bullet: [2.4, 0.2] },
};

// ---------- Embraer Legacy 450/500, Praetor 500/600 (E545, E550) ----------
// No APM reachable: proportions from the side-on photo of Legacy 500 G-TULI (Commons), scaled to the 20.74 m overall length
F.e550 = {
  kind: "bizjet", L0: 16.79, over: 3.95, D: 2.3, W: 2.3, fwd: 0.6, fair: 0.07,
  nose: {
    tip: 0.29,
    top: [[0.1, 0.36], [0.25, 0.42], [0.43, 0.49], [0.67, 0.66], [1.0, 0.84], [1.41, 0.95], [1.7, 0.99], [1.9, 1]],
    bot: [[0.1, 0.22], [0.25, 0.18], [0.43, 0.14], [0.76, 0.04], [1.1, 0]],
  },
  tail: {
    top: [[2.6, 1], [1.6, 0.95], [0.8, 0.84], [0.3, 0.75], [0, 0.7]],
    bot: [[3.4, 0], [2.6, 0.07], [1.8, 0.18], [1.2, 0.3], [0.6, 0.45], [0.2, 0.56], [0, 0.6]],
  },
  glass: [
    [[1.03, 0.74], [1.2, 0.86], [1.45, 0.92], [1.45, 0.74]],
    [[1.5, 0.92], [1.86, 0.93], [1.9, 0.85, ""], [1.86, 0.74], [1.5, 0.74]],
  ],
  frame: 0.04,
  extras: [hatch(4.95, 0.82, 0.3, 1.75, 0.3)],
  win: [{ z: 0.7, from: 6.42, to: -5.85, pitch: 0.753, w: 0.31, h: 0.39 }],
  wing: { le: 8.3, root: 1.15, span: 20.25, cr: 4.2, ct: 1.2, sweep: 27, dih: 3, z: 0.07, t: [0.13, 0.1] },
  tip: { h: 0.9, sweep: 40, top: 0.35, base: 0.85, blend: 0.2 },
  eng: { kind: "fan", aft: { s: 4.24, z: 0.73 }, len: 3.4, dia: 1.2, style: "long", fx: 0.88 },
  fin: { le: 3.89, cr: 3.5, ct: 2.73, h: 2.72, sweep: 48, fillet: [1.0, 0.23], cap: 0.12 },
  stab: { le: 0.64, z: "T", drop: 0.15, span: 7.4, root: 0.25, cr: 2.4, ct: 0.9, sweep: 45, dih: 0 },
};

// ---------- Cessna Citation CJ2/CJ3 (C25A, C25B) ----------
// No drawing reachable: proportions from side-on photos of a CJ3 and a CJ2 (Commons), scaled to the 15.59 m overall length
F.c25b = {
  kind: "bizjet", L0: 13.34, over: 2.25, D: 1.58, W: 1.6, fwd: 0.6, fair: 0.06,
  nose: {
    tip: 0.25,
    top: [[0.1, 0.32], [0.28, 0.4], [0.6, 0.52], [1.0, 0.65], [1.36, 0.77, "c"], [1.72, 0.92], [2.12, 0.99], [2.4, 1]],
    bot: [[0.08, 0.17], [0.2, 0.14], [0.6, 0.06], [1.0, 0.015], [1.3, 0]],
  },
  tail: {
    top: [[2.0, 1], [1.0, 0.95], [0.4, 0.88], [0, 0.8]],
    bot: [[2.2, 0], [1.55, 0.11], [1.05, 0.27], [0.55, 0.42], [0.2, 0.56], [0, 0.66]],
  },
  glass: [
    [[1.36, 0.69], [1.6, 0.84], [1.72, 0.9], [1.72, 0.69]],
    [[1.76, 0.92], [2.04, 0.94], [2.04, 0.69], [1.76, 0.69]],
  ],
  frame: 0.03,
  // from the side-on photo of CJ3 OM-LBG: the swept blade antenna and three low domes on the spine, the probe under the nose
  extras: [hatch(3.95, 0.53, 0.25, 1.24, 0.2), ({ sk, top, bottom }) => {
    const t = (s) => top(s) - 0.02, b = (s) => bottom(s) + 0.02;
    sk.poly("strut", [[6.141, t(6.14)], [6.314, 1.78], [6.44, 1.82], [6.343, t(6.34)]]);
    for (const a of [3.3, 3.527, 6.595]) {
      sk.smooth("hull", [[a, t(a), "c"], [a + 0.037, top(a) + 0.065, ""], [a + 0.138, top(a) + 0.065, ""], [a + 0.17, t(a + 0.17), "c"]]);
    }
    sk.poly("strut", [[0.679, 0.164], [0.782, 0.014], [0.858, 0.003], [0.806, 0.153]]);
    sk.poly("strut", [[2.537, b(2.54)], [2.551, -0.063], [2.627, -0.062], [2.625, b(2.63)]]);
    sk.smooth("hull", [[3.535, b(3.54), "c"], [3.586, -0.074, ""], [3.839, -0.071, ""], [3.876, b(3.88), "c"]]);
    sk.poly("strut", [[10.779, b(10.78)], [10.806, bottom(10.8) - 0.1], [10.882, bottom(10.88) - 0.1], [10.88, b(10.88)]]);
  }],
  win: [{ z: 0.78, from: 3.93, to: -6.37, pitch: 0.507, w: 0.23, h: 0.28 }],
  wing: { le: 6.6, root: 0.8, span: 16.26, cr: 2.5, ct: 1.0, sweep: 3, dih: 4, z: 0.1, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 4.43, z: 0.85 }, len: 2.3, dia: 0.72, style: "long", fx: 0.88 },
  fin: { le: 2.26, cr: 1.6, ct: 1.28, h: 1.74, sweep: 52, fillet: [0.8, 0.12] },
  stab: { le: 0.07, z: "T", drop: 0.05, span: 6.0, root: 0.2, cr: 1.2, ct: 0.6, sweep: 31, dih: 8 },
};

// ---------- Cessna Citation Excel/XLS (C56X) and Sovereign (C680) ----------
// No drawing reachable: proportions from the side-on photos of XLS EC-K.. (Commons) and Sovereign N94PC (Commons)
F.c56x = {
  kind: "bizjet", L0: 15.3, over: 0.7, D: 1.84, W: 1.84, fwd: 0.5, fair: 0.06,
  nose: {
    tip: 0.23,
    top: [[0.06, 0.31], [0.16, 0.39], [0.45, 0.54], [0.81, 0.68], [1.09, 0.82], [1.38, 0.93], [1.65, 0.98], [1.9, 1]],
    bot: [[0.09, 0.11], [0.25, 0.07], [0.45, 0.04], [0.8, 0]],
  },
  tail: {
    top: [[2.4, 1], [1.4, 0.93], [0.7, 0.8], [0.25, 0.68], [0, 0.6]],
    bot: [[2.9, 0], [2.2, 0.08], [1.6, 0.17], [1.0, 0.27], [0.5, 0.35], [0.15, 0.4], [0, 0.42]],
  },
  glass: [
    [[1.06, 0.66], [1.3, 0.84], [1.55, 0.87], [1.55, 0.66]],
    [[1.6, 0.875], [1.88, 0.88], [1.88, 0.66], [1.6, 0.66]],
  ],
  frame: 0.035,
  // from the side-on photo of XLS EC-K..: the small whip, two low domes and the swept blade on the spine
  extras: [hatch(4.8, 0.7, 0.3, 1.5, 0.2), ({ sk, top, bottom }) => {
    const t = (s) => top(s) - 0.02, b = (s) => bottom(s) + 0.02;
    sk.poly("strut", [[5.407, t(5.41)], [5.439, 1.896], [5.478, 1.899], [5.473, t(5.47)]]);
    for (const [a, w] of [[6.093, 0.2], [6.661, 0.25]]) {
      sk.smooth("hull", [[a, t(a), "c"], [a + w * 0.25, top(a) + 0.045, ""], [a + w * 0.75, top(a) + 0.045, ""], [a + w, t(a + w), "c"]]);
    }
    sk.poly("strut", [[7.519, t(7.52)], [7.699, 1.98], [7.816, 2.003], [7.689, t(7.69)]]);
    sk.smooth("door", [[4.805, 0.96, "c"], [5.08, 0.983, "c"], [5.097, 0.786, "c"], [4.822, 0.763, "c"]]);
    sk.poly("strut", [[2.444, b(2.44)], [2.627, -0.106], [2.857, -0.179], [2.785, -0.106], [2.549, b(2.55)]]);
    sk.ellipse("hub", 5.825, bottom(5.825) - 0.03, 0.12, 0.04);
    const v = [[13.26, 0], [14.61, 0], [14.64, -0.33], [13.81, -0.3]].map(([s, dz]) => [s, bottom(s) + 0.03 + dz, "c"]);
    sk.smooth("fin", v);
  }],
  overlays: [({ sk }) => {
    // the fin tip: leading edge at 15.3 - 1.77 + 1.91 tan 36 deg, chord 1.2, 1.91 m over the crown
    const le = 15.3 - 1.77 + 1.91 * Math.tan((36 * Math.PI) / 180), zt = 1.84 + 1.91;
    sk.ellipse("hub", le + 0.42 * 1.2, zt + 0.03, 0.05, 0.04);
    sk.poly("hl", [[le + 0.21 * 1.2, zt], [le + 0.21 * 1.2, zt - 0.17], [le + 0.6 * 1.2, zt - 0.17]], false);
    sk.smooth("door", [[15.22, 3.31, "c"], [15.384, 3.402, "c"], [15.613, 3.342, "c"], [15.397, 3.245, "c"]]);
  }],
  win: [{ z: 0.69, from: 5.59, to: 8.9, pitch: 0.81, w: 0.26, h: 0.34 }],
  wing: { le: 6.6, root: 0.95, span: 17.17, cr: 2.7, ct: 1.15, sweep: 8, dih: 4, z: 0.08, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 5.66, z: 0.77 }, len: 2.7, dia: 0.88, style: "long", fx: 0.88 },
  fin: { le: 1.77, cr: 1.7, ct: 1.2, h: 1.91, sweep: 36, fillet: [0.9, 0.12] },
  stab: { le: 1.64, fz: 0.1, span: 6.6, root: 0.25, cr: 1.4, ct: 0.75, sweep: 28, dih: 6 },
};
F.c680 = {
  ...F.c56x, L0: 18.36, over: 0.99,
  // from the side-on photo of Sovereign N94PC: the swept blade on the spine, two swept blades under
  // the belly, the door handle, the round fitting low on the side and the beacon on the fin tip
  extras: [hatch(4.62, 0.75, 0.3, 1.5, 0.2), ({ sk, top, bottom }) => {
    sk.poly("strut", [[7.45, top(7.45) - 0.02], [7.71, top(7.71) + 0.22], [7.81, top(7.81) + 0.23], [7.66, top(7.66) - 0.02]]);
    for (const s of [4.23, 7.42]) sk.poly("strut", [[s, bottom(s) + 0.02], [s + 0.12, bottom(s + 0.12) - 0.22], [s + 0.23, bottom(s + 0.23) - 0.25], [s + 0.16, bottom(s + 0.16) + 0.02]]);
    sk.poly("door", [[4.61, 0.84], [4.61, 0.53]], false);
    sk.ellipse("hub", 5.92, 0.27, 0.05, 0.05);
  }],
  overlays: [({ sk }) => {
    const le = 18.36 - 3.32 + 2.41, zt = 1.84 + 2.41;   // fin tip leading edge (45 deg: tan = 1) and height
    sk.ellipse("hub", le + 0.25 * 1.37, zt + 0.03, 0.06, 0.04);
  }],
  win: [{ z: 0.7, from: 5.3, to: 10.05, pitch: 0.79, w: 0.26, h: 0.34 }],
  wing: { le: 7.9, root: 0.95, span: 22.04, cr: 3.2, ct: 1.15, sweep: 18, dih: 4, z: 0.08, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 6.64, z: 0.72 }, len: 3.4, dia: 1.0, style: "long", fx: 0.88 },
  fin: { le: 3.32, cr: 3.0, ct: 1.37, h: 2.41, sweep: 45, fillet: [1.0, 0.12] },
  stab: { le: 2.36, fz: 0.1, span: 7.6, root: 0.25, cr: 1.6, ct: 0.8, sweep: 30, dih: 6 },
};

// ---------- Cessna Citation Latitude (C68A) and Longitude (C700) ----------
// No drawing reachable: proportions from the side-on photos of Latitude N563QS (Commons) and Longitude N807QS (Commons)
F.c68a = {
  kind: "bizjet", L0: 18.08, over: 0.89, D: 2.23, W: 2.23, fwd: 0.5, fair: 0.06,
  nose: {
    tip: 0.22,
    top: [[0.08, 0.29], [0.23, 0.36], [0.6, 0.55], [0.89, 0.72], [1.18, 0.87], [1.47, 0.97], [1.85, 1]],
    bot: [[0.09, 0.12], [0.38, 0.05], [0.74, 0.01], [0.9, 0]],
  },
  tail: {
    top: [[2.4, 1], [1.4, 0.95], [0.7, 0.86], [0.25, 0.76], [0, 0.7]],
    bot: [[3.2, 0], [2.4, 0.09], [1.7, 0.2], [1.1, 0.33], [0.6, 0.45], [0.2, 0.56], [0, 0.62]],
  },
  glass: [
    [[0.89, 0.6], [1.0, 0.72], [1.15, 0.8], [1.15, 0.6]],
    [[1.19, 0.81], [1.43, 0.82], [1.43, 0.61], [1.19, 0.61]],
  ],
  frame: 0.04,
  // from the side-on photo of Latitude N563QS: the two swept blades and two domes on the spine
  extras: [hatch(4.59, 0.81, 0.24, 1.7, 0.25), ({ sk, top, bottom }) => {
    const t = (s) => top(s) - 0.02, b = (s) => bottom(s) + 0.02;
    const blade = (s0, s1, s2, s3, h) => sk.poly("strut", [[s0, t(s0)], [s1, top(s1) + h * 0.95], [s2, top(s2) + h], [s3, t(s3)]]);
    blade(7.455, 7.713, 7.827, 7.667, 0.3);
    blade(11.243, 11.404, 11.518, 11.438, 0.18);
    for (const [a, w, h] of [[8.967, 0.536, 0.1], [12.17, 0.42, 0.07]]) {
      sk.smooth("hull", [[a, t(a), "c"], [a + w * 0.18, top(a) + h, ""], [a + w * 0.82, top(a) + h, ""], [a + w, t(a + w), "c"]]);
    }
    const under = (s0, s1, s2, s3, dz) => sk.poly("strut", [[s0, b(s0)], [s1, bottom(s1) - dz * 0.85], [s2, bottom(s2) - dz], [s3, b(s3)]]);
    under(6.549, 6.729, 6.876, 6.744, 0.29);
    under(7.605, 7.623, 7.818, 7.817, 0.18);
    under(11.426, 11.639, 11.802, 11.637, 0.25);
    under(12.449, 12.564, 12.889, 12.823, 0.15);
    sk.ellipse("hub", 6.463, 0.332, 0.05, 0.05);
    for (const s of [14.33, 14.38, 14.43]) sk.poly("hl", [[s, top(s) - 0.1], [s, top(s) - 0.02]], false);
    sk.smooth("fin", [[13.74, b(13.74)], [15.85, b(15.85)], [16.09, bottom(16.09) - 0.41], [15.92, bottom(15.92) - 0.52], [13.91, bottom(13.91) - 0.29]]
      .map((p) => [...p, "c"]));
  }],
  overlays: [({ sk }) => sk.smooth("door", [[17.433, 4.744, "c"], [17.758, 4.746, "c"], [17.759, 4.632, "c"], [17.434, 4.63, "c"]])],
  win: [{ z: 0.62, from: 5.61, to: 8.2, pitch: 0.635, w: 0.29, h: 0.39 }],
  wing: { le: 7.8, root: 1.1, span: 22.05, cr: 3.3, ct: 1.15, sweep: 18, dih: 4, z: 0.07, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 7.23, z: 0.58 }, len: 3.7, dia: 1.07, style: "long", fx: 0.88 },
  fin: { le: 3.53, cr: 3.4, ct: 1.5, h: 2.92, sweep: 44, fillet: [0.8, 0.2] },
  stab: { le: 2.44, fz: 0.18, span: 7.4, root: 0.25, cr: 1.7, ct: 0.8, sweep: 30, dih: 3 },
};
F.c700 = {
  ...F.c68a, L0: 18.9, over: 3.4,
  tail: {
    top: [[2.4, 1], [1.4, 0.96], [0.7, 0.88], [0.25, 0.78], [0, 0.72]],
    bot: [[3.3, 0], [2.4, 0.09], [1.7, 0.2], [1.1, 0.33], [0.6, 0.45], [0.2, 0.56], [0, 0.62]],
  },
  // from the photo of Longitude N807QS (soft, from below): the swept blade on the spine and the swept
  // blade under the belly ahead of the wing
  extras: [hatch(4.86, 0.78, 0.24, 1.7, 0.25), ({ sk, top, bottom }) => {
    sk.poly("strut", [[7.93, top(7.93) - 0.02], [8.16, top(8.16) + 0.23], [8.27, top(8.27) + 0.25], [8.13, top(8.13) - 0.02]]);
    sk.poly("strut", [[6.64, bottom(6.64) + 0.02], [6.86, bottom(6.86) - 0.28], [6.98, bottom(6.98) - 0.31], [6.82, bottom(6.82) + 0.02]]);
  }], overlays: [],
  win: [{ z: 0.62, from: 6.1, to: 10.6, pitch: 0.635, w: 0.29, h: 0.39 }],
  wing: { le: 9.1, root: 1.1, span: 21.01, cr: 4.2, ct: 1.15, sweep: 29, dih: 4, z: 0.07, t: [0.13, 0.1] },
  tip: { h: 1.0, sweep: 40, top: 0.3, base: 0.85, blend: 0.2 },
  eng: { kind: "fan", aft: { s: 4.9, z: 0.86 }, len: 3.6, dia: 1.2, style: "long", fx: 0.88 },
  fin: { le: 3.1, cr: 3.0, ct: 2.7, h: 2.6, sweep: 48, fillet: [1.0, 0.2] },
  stab: { le: 0.5, z: "T", drop: 0.1, span: 8.5, root: 0.25, cr: 2.0, ct: 0.8, sweep: 38, dih: 2, bullet: [2.2, 0.18] },
};

// ---------- Embraer Phenom 100 (E50P) and 300 (E55P) ----------
// Phenom 300: the side view on the dimensions page of Embraer's Phenom 300E brochure, scaled to 15.64 m: fuselage 14.21 m
F.e55p = {
  kind: "bizjet", L0: 14.21, over: 1.43, D: 1.74, W: 1.6, fwd: 0.5, fair: 0.2, fairAft: 1.5,
  nose: {
    tip: 0.08,
    top: [[0.1, 0.2], [0.52, 0.4], [0.86, 0.535], [1.16, 0.7], [1.52, 0.9], [1.86, 0.98], [2.1, 1]],
    bot: [[0.08, 0.02], [0.25, 0.005], [0.5, 0]],
  },
  tail: {
    top: [[3.0, 1], [1.5, 0.95], [0.5, 0.88], [0, 0.83]],
    bot: [[2.6, 0], [1.64, 0.13], [0.97, 0.3], [0.3, 0.5], [0, 0.6]],
  },
  glass: [
    [[1.12, 0.6], [1.4, 0.84], [1.5, 0.85], [1.5, 0.6]],
    [[1.54, 0.86], [1.85, 0.86], [1.87, 0.78, ""], [1.85, 0.62], [1.54, 0.62]],
  ],
  frame: 0.035,
  // from the brochure's side view: the two blade antennas and two low fairings on the spine
  extras: [hatch(4.38, 0.67, 0.29, 1.3, 0.15), marks([
    ["strut", [[4.286, 1.712], [4.371, 1.936], [4.626, 1.953], [4.626, 1.919], [4.439, 1.712]]],
    ["strut", [[8.12, 1.723], [8.188, 1.987], [8.264, 2.013], [8.247, 1.927], [8.23, 1.723]]],
    ["hull", [[5.368, 1.72], [5.419, 1.766, ""], [5.581, 1.766, ""], [5.632, 1.72]]],
    ["hull", [[6.109, 1.72], [6.177, 1.783, ""], [6.33, 1.783, ""], [6.399, 1.72]]],
    ["strut", [[3.417, 0.01], [3.519, -0.05], [3.638, -0.221], [3.808, -0.238], [3.808, -0.272], [3.604, -0.272], [3.468, -0.084]]],
    ["strut", [[2.394, 0.02], [2.394, -0.06], [2.462, -0.06], [2.462, 0.02]]],
    ["strut", [[2.675, 0.02], [2.675, -0.06], [2.743, -0.06], [2.743, 0.02]]],
    ["strut", [[2.999, 0.02], [2.999, -0.06], [3.067, -0.06], [3.067, 0.02]]],
    ["hl", [[2.275, 0.479], [2.488, 0.479]], false],
    ["strut", [[11.783, 0.4], [11.8, 0.258], [11.885, 0.249], [11.885, 0.4]]],
    ["inlet", [[13.121, 2.958], [13.317, 2.958], [13.334, 2.899], [13.138, 2.899]]],
  ])],
  overlays: [ventral([[0.7, 1.0], [0.5, 0.74], [0.22, 0.74], [0.17, 1.05]])],
  win: [{ z: 0.7, from: 5.12, to: 7.2, pitch: 0.69, w: 0.3, h: 0.36 }, { z: 0.7, from: 8.25, to: 8.25, w: 0.3, h: 0.36 }],
  wing: { le: 6.1, root: 0.85, span: 15.91, cr: 2.7, ct: 1.0, sweep: 26, dih: 4, z: 0.04, t: [0.13, 0.1] },
  tip: { h: 1.0, sweep: 45, top: 0.3, base: 0.85, blend: 0.2 },
  eng: { kind: "fan", aft: { s: 5.14, z: 0.82 }, len: 2.75, dia: 0.88, style: "long", fx: 0.88 },
  fin: { le: 2.84, cr: 2.72, ct: 1.6, h: 2.1, sweep: 37.5, fillet: [1.2, 0.25] },
  stab: { le: 1.1, z: "T", drop: 0.06, span: 6.0, root: 0.2, cr: 1.5, ct: 0.75, sweep: 30, dih: 0, bullet: [1.9, 0.18] },
};
F.e50p = {
  ...F.e55p, L0: 11.68, over: 1.14, D: 1.73,
  nose: {
    tip: 0.17,
    top: [[0.1, 0.27], [0.4, 0.41], [0.72, 0.54], [1.1, 0.7], [1.42, 0.87], [1.86, 0.99], [2.1, 1]],
    bot: [[0.1, 0.08], [0.3, 0.03], [0.6, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.4, 0.95], [0.5, 0.87], [0, 0.8]],
    bot: [[2.4, 0], [1.6, 0.13], [0.97, 0.3], [0.3, 0.5], [0, 0.6]],
  },
  glass: [
    [[1.1, 0.67], [1.32, 0.82], [1.42, 0.83], [1.42, 0.67]],
    [[1.46, 0.86], [1.86, 0.86], [1.88, 0.78, ""], [1.86, 0.67], [1.46, 0.67]],
  ],
  extras: [hatch(3.83, 0.66, 0.29, 1.3, 0.15)],
  overlays: [],
  win: [{ z: 0.72, from: 4.5, to: 5.7, pitch: 0.58, w: 0.33, h: 0.35 }],
  wing: { le: 5.1, root: 0.85, span: 12.3, cr: 2.2, ct: 1.0, sweep: 6, dih: 4, z: 0.04, t: [0.14, 0.11] },
  tip: null,
  eng: { kind: "fan", aft: { s: 4.47, z: 0.73 }, len: 2.2, dia: 0.68, style: "long", fx: 0.88 },
  fin: { le: 2.15, cr: 2.1, ct: 1.3, h: 1.62, sweep: 44, fillet: [1.0, 0.2] },
  stab: { le: 0.61, z: "T", drop: 0.06, span: 5.2, root: 0.2, cr: 1.2, ct: 0.65, sweep: 25, dih: 0, bullet: [1.5, 0.15] },
};

// ---------- Pilatus PC-24 (PC24) ----------
// No drawing reachable: proportions from the side-on photo of D-CFBL (Commons), scaled to the 16.85 m overall length
F.pc24 = {
  kind: "bizjet", L0: 15.2, over: 1.65, D: 1.98, W: 1.98, fwd: 0.5, fair: 0.08,
  nose: {
    tip: 0.2,
    top: [[0.1, 0.33], [0.33, 0.46], [0.71, 0.61], [1.02, 0.7, "c"], [1.17, 0.8], [1.4, 0.89], [1.7, 0.98], [2.0, 1]],
    bot: [[0.1, 0.08], [0.25, 0.03], [0.45, 0.005], [0.6, 0]],
  },
  tail: {
    top: [[2.6, 1], [1.5, 0.95], [0.6, 0.86], [0, 0.76]],
    bot: [[3.0, 0], [2.0, 0.12], [1.2, 0.24], [0.5, 0.3], [0, 0.34]],
  },
  glass: [
    [[1.06, 0.69], [1.22, 0.86], [1.28, 0.88], [1.28, 0.69]],
    [[1.31, 0.9], [1.77, 0.93], [1.77, 0.7], [1.31, 0.7]],
  ],
  frame: 0.035,
  extras: [hatch(4.0, 0.62, 0.32, 1.35, 0.15), hatch(9.85, 1.25, 0.3, 1.35, 0.15)],
  win: [{ z: 0.69, from: 5.0, to: 8.9, pitch: 0.71, w: 0.27, h: 0.36 }],
  wing: { le: 6.3, root: 1.0, span: 17.0, cr: 2.6, ct: 1.1, sweep: 10, dih: 4, z: 0.06, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 4.6, z: 0.74 }, len: 2.7, dia: 0.95, style: "long", fx: 0.88 },
  fin: { le: 2.53, cr: 2.8, ct: 1.49, h: 2.14, sweep: 42, fillet: [1.0, 0.18] },
  stab: { le: 0.8, z: "T", drop: 0.1, span: 6.4, root: 0.2, cr: 1.5, ct: 0.75, sweep: 30, dih: 0, bullet: [2.1, 0.17] },
};

// ---------- Cirrus Vision SF50 (SF50) ----------
// No drawing reachable: outline traced from the side-on photo of N299CV (Commons), scaled to the 9.42 m overall length
F.sf50 = {
  kind: "bizjet", L0: 9.32, over: 0.1, D: 1, W: 1.7, fair: 0,
  body: [[0, 0.56, "c"], [0.12, 0.82], [0.43, 0.97], [0.84, 1.07], [1.35, 1.27], [1.86, 1.6], [2.37, 1.76], [2.88, 1.82],
    [3.9, 1.79], [4.72, 1.66], [5.94, 1.43], [6.97, 1.23], [7.68, 1.08], [8.5, 0.96], [9.32, 0.87, "c"], [9.32, 0.56, "c"],
    [8.7, 0.48], [7.99, 0.4], [6.97, 0.23], [5.94, 0.05], [4.92, 0], [3.9, 0.02], [2.88, 0.1], [1.86, 0.2], [0.84, 0.31],
    [0.22, 0.42], [0.04, 0.5]],
  glass: [[[1.45, 1.05, "c"], [1.81, 1.48], [2.47, 1.57], [2.52, 1.1, "c"]]],
  frame: 0.04,
  win: [{ z: 1.26, from: 2.95, to: 4.26, pitch: 0.655, w: 0.45, h: 0.38 }],
  overlays: [ventral([[1.0, 0.47], [0.3, 0.3], [0.02, 0.33], [0.02, 0.7]])],
  wing: { le: 3.2, root: 0.85, span: 11.8, cr: 1.9, ct: 0.85, sweep: 3, dih: 5, z: 0.25, t: [0.15, 0.12] },
  tailEng: { s: 4.45, z: 0.74, len: 2.3, dia: 0.5, style: "long", fx: 0.85 },
  stab: { le: 1.64, z: 0.92, span: 3.96, root: 0.3, cr: 1.3, ct: 0.6, sweep: 35, dih: 45, thick: 0.1 },
};

// ---------- Bombardier Global Express / 5000 / 6000 / 6500 (GLEX, GL5T) and Global 7500 (GL7T) ----------
// Global 7500: Commons "Bombardier Global 7500-8000 three views.png" side view (33.88 m overall), prepped with refprep
const GLOBAL_NOSE = {
  tip: 0.25,
  top: [[0.1, 0.36], [0.25, 0.46], [0.5, 0.6], [0.75, 0.752], [1.0, 0.891], [1.25, 0.975], [1.5, 1]],
  bot: [[0.1, 0.16], [0.3, 0.086], [0.5, 0.04], [0.75, 0.015], [1.1, 0]],
};
const GLOBAL_TAIL = {
  top: [[4.0, 1], [3.0, 0.975], [2.0, 0.9], [0.9, 0.8], [0.43, 0.75], [0.1, 0.7], [0, 0.65]],
  bot: [[2.75, 0], [2.5, 0.033], [2.0, 0.113], [1.5, 0.213], [1.0, 0.312], [0.5, 0.412], [0.25, 0.465], [0.09, 0.53], [0, 0.6]],
};
const GLOBAL_GLASS = [
  [[0.585, 0.618], [0.851, 0.793], [0.964, 0.793], [0.836, 0.618]],
  [[0.873, 0.618], [1.036, 0.785], [1.229, 0.785], [1.178, 0.618]],
];
F.glex = {
  kind: "bizjet", L0: 26.26, over: 4.04, D: 2.75, W: 2.75, fwd: 0.5, fair: 0.22, fairAft: 1.55,
  nose: GLOBAL_NOSE, tail: GLOBAL_TAIL, glass: GLOBAL_GLASS, frame: 0.04,
  floor: 0.135,
  doors: [[4.75, 0.92]],
  win: [{ z: 0.64, from: 6.12, to: -10.85, pitch: 0.771, w: 0.29, h: 0.4 }],
  wing: { le: 10.2, root: 1.35, span: 28.65, cr: 6.4, kink: [0.28, 3.9], ct: 1.15, sweep: 36, dih: 3.5, z: 0.06, t: [0.13, 0.1] },
  tip: { h: 1.3, sweep: 52, top: 0.4, base: 0.85, blend: 0.4 },
  ftf: [0.3, 0.55],
  eng: { kind: "fan", aft: { s: 7.64, z: 0.69 }, len: 5.0, dia: 1.6, style: "long", fx: 0.86 },
  fin: { le: 5.4, cr: 4.38, ct: 3.1, h: 3.3, sweep: 46, fillet: [1.3, 0.87], cap: 0.3 },
  stab: { le: 1.74, z: "T", drop: 0.4, span: 10.4, root: 0.3, cr: 2.8, ct: 0.45, sweep: 47, dih: -5 },
};
F.gl7t = {
  ...F.glex, L0: 29.84,
  win: [{ z: 0.625, from: 6.1, to: 18.1, pitch: 0.915, w: 0.36, h: 0.51 }],
  wing: { le: 11.2, root: 1.35, span: 31.7, cr: 7.0, kink: [0.28, 4.1], ct: 1.2, sweep: 37, dih: 3.5, z: 0.06, t: [0.13, 0.1] },
  tip: { h: 1.25, sweep: 50, top: 0.4, base: 0.85, blend: 0.4 },
  eng: { kind: "fan", aft: { s: 7.84, z: 0.69 }, len: 5.4, dia: 1.75, style: "long", fx: 0.84 },
};

// ---------- Gulfstream IV/G450 (GLF4) and V/G550 (GLF5) ----------
// G550: Commons "Gulfstream G500 3-view line drawing.svg", side view prepped with refprep at the 29.39 m overall length
F.glf5 = {
  kind: "bizjet", L0: 26.15, over: 3.24, D: 2.39, W: 2.39, fwd: 0.4, fair: 0.1, fairAft: 1.5,
  nose: {
    tip: 0.26,
    top: [[0.1, 0.354], [0.3, 0.464], [0.5, 0.567], [0.7, 0.652, "c"], [0.9, 0.788], [1.0, 0.85], [1.1, 0.92], [1.2, 0.965],
      [1.35, 0.995], [1.5, 1]],
    bot: [[0.1, 0.183], [0.2, 0.149], [0.3, 0.115], [0.4, 0.081], [0.5, 0.056], [0.6, 0.039], [0.7, 0.022], [0.85, 0.008], [1.0, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.32, 0.92], [0.4, 0.8], [0, 0.72]],
    bot: [[3.0, 0], [2.75, 0.01], [2.5, 0.047], [2.0, 0.141], [1.5, 0.243], [1.0, 0.354], [0.5, 0.464], [0.25, 0.53], [0.08, 0.6], [0, 0.65]],
  },
  glass: [
    [[0.711, 0.665], [0.987, 0.87], [1.197, 0.87], [0.962, 0.665]],
    [[1.007, 0.665], [1.225, 0.87], [1.339, 0.87], [1.339, 0.665]],
  ],
  frame: 0.04,
  floor: 0.134,
  doors: [[5.47, 0.94]],
  win: [{ z: 0.571, from: 7.585, to: 13.75, pitch: 1.233, w: 0.7, h: 0.5 }],
  wing: { le: 10.9, root: 1.2, span: 28.5, cr: 5.9, kink: [0.25, 3.9], ct: 1.4, sweep: 31, dih: 1.5, z: 0.05, t: [0.13, 0.1] },
  tip: { h: 1.73, sweep: 48, top: 0.45, base: 0.85, blend: 0.3 },
  ftf: [0.3, 0.55],
  eng: { kind: "fan", aft: { s: 8.28, z: 0.82 }, len: 5.6, dia: 1.63, style: "long", fx: 0.9 },
  fin: { le: 4.65, cr: 4.5, ct: 2.86, h: 3.41, sweep: 43.5, fillet: [1.0, 0.5], cap: 0.12, rudder: 0.75 },
  stab: { le: 1.55, z: "T", drop: 0.35, span: 10.4, root: 0.3, cr: 2.7, ct: 1.3, sweep: 35.5, dih: 0, bullet: [2.4, 0.25] },
};

// G450 photo (Commons): door at 5.36 m, six windows 6.93-13.10 m, tail cone end 24.0 m
const G4_FITTINGS = ({ sk, top, bottom }) => {
  sk.smooth("hl", [[1.345, 1.4], [1.324, 1.01], [1.303, 0.622], [1.198, 0.311]], false);
  const t = top(5.7), b = bottom(8.0);
  sk.poly("strut", [[5.506, t - 0.02], [5.926, t + 0.39], [6.074, t + 0.39], [5.821, t - 0.02]]);
  sk.poly("strut", [[7.818, b + 0.02], [8.028, b - 0.43], [8.196, b - 0.43], [8.091, b + 0.02]]);
  const lo = (s, dz) => [s, bottom(s) + dz];
  sk.smooth("hl", [lo(19.12, 0.02), lo(19.27, 0.2), lo(19.8, 0.29), lo(20.53, 0.33), lo(20.91, 0.24), lo(20.97, 0.05)], false);
};
F.glf4 = {
  ...F.glf5, L0: 24.0, over: 3.23,
  extras: [G4_FITTINGS, nozzle(1.63, 0.1, 0.25)],
  doors: [[5.36, 0.94]],
  win: [{ z: 0.56, from: 6.93, to: 13.1, pitch: 1.233, w: 0.7, h: 0.5 }],
  wing: { le: 10.0, root: 1.2, span: 23.72, cr: 5.6, kink: [0.25, 3.6], ct: 1.3, sweep: 31, dih: 1.5, z: 0.05, t: [0.13, 0.1] },
  tip: { h: 1.5, sweep: 48, top: 0.45, base: 0.85, blend: 0.3 },
  eng: { kind: "fan", aft: { s: 8.45, z: 0.8 }, len: 5.0, dia: 1.5, style: "long", fx: 0.88 },
  fin: { le: 4.5, cr: 4.4, ct: 2.8, h: 3.1, sweep: 43.5, fillet: [1.0, 0.5], cap: 0.12, rudder: 0.75 },
  stab: { le: 1.5, z: "T", drop: 0.33, span: 9.75, root: 0.3, cr: 2.6, ct: 1.25, sweep: 35, dih: 0, bullet: [2.3, 0.24] },
};
// G650: no to-scale drawing reachable; built on the G550 with Wikipedia (Gulfstream G650) dimensions: 30.41 m overall
F.glf6 = {
  ...F.glf5, L0: 27.1, over: 3.31, D: 2.62, W: 2.72,
  nose: {
    tip: 0.3,
    top: [[0.1, 0.4], [0.3, 0.51], [0.55, 0.62], [0.72, 0.69, "c"], [0.9, 0.81], [1.05, 0.89], [1.2, 0.95], [1.4, 0.99], [1.6, 1]],
    bot: [[0.1, 0.2], [0.3, 0.12], [0.5, 0.065], [0.7, 0.03], [0.9, 0.01], [1.1, 0]],
  },
  glass: [
    [[0.74, 0.68], [0.95, 0.85], [1.13, 0.86], [0.97, 0.68]],
    [[1.0, 0.68], [1.17, 0.86], [1.36, 0.86], [1.36, 0.68]],
  ],
  doors: [[5.55, 0.97]],
  win: [{ z: 0.56, from: 7.25, to: 16.0, pitch: 1.09, w: 0.74, h: 0.54 }],
  wing: { le: 11.5, root: 1.3, span: 30.36, cr: 6.3, kink: [0.25, 4.0], ct: 1.3, sweep: 36, dih: 2, z: 0.05, t: [0.13, 0.1] },
  tip: { h: 1.6, sweep: 58, top: 0.45, base: 0.9, blend: 0.7 },
  eng: { kind: "fan", aft: { s: 8.5, z: 0.8 }, len: 5.6, dia: 1.72, style: "long", fx: 0.88 },
  fin: { le: 4.9, cr: 4.7, ct: 2.9, h: 3.6, sweep: 45, fillet: [1.2, 0.55], cap: 0.12, rudder: 0.75 },
  stab: { le: 1.6, z: "T", drop: 0.35, span: 10.9, root: 0.3, cr: 2.8, ct: 1.3, sweep: 37, dih: 0, bullet: [2.5, 0.26] },
};

export const families = F;
export const types = {
  F2TH: "f2th", F900: "f900",
  CL30: "cl30", CL35: ["cl30", { tip: { h: 1.25, sweep: 40, top: 0.3, base: 0.85 } }], CL60: "cl60",
  GLF4: "glf4", GLF5: "glf5", GLF6: "glf6",
  GLEX: "glex", GL5T: "glex", GL7T: "gl7t",
  H25B: "h25b", G280: "g280",
  E545: "e550", E550: "e550",
  C25A: ["c25b", { extras: [hatch(3.95, 0.53, 0.25, 1.24, 0.2)], win: [{ z: 0.78, from: 3.93, to: 6.5, pitch: 0.507, w: 0.23, h: 0.28 }], wing: { le: 6.4, root: 0.8, span: 15.19, cr: 2.45, ct: 1.0, sweep: 3, dih: 4, z: 0.1, t: [0.14, 0.11] } }],
  C25B: "c25b",
  SF50: "sf50", E50P: "e50p", E55P: "e55p", PC24: "pc24",
  C56X: "c56x", C680: "c680", C68A: "c68a", C700: "c700",
  LJ45: "lj45", LJ75: ["lj45", { tip: { h: 1.1, sweep: 35, top: 0.35, base: 0.85, blend: 0.2 } }],
};
