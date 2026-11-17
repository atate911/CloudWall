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

// ---------- Dassault Falcon 2000 (F2TH) and Falcon 900 (F900) ----------
// No drawing reachable: Falcon 2000 proportions from the side-on photo of the Bulgarian Air Force
// Falcon 2000 (Commons "Dassault Falcon 2000, Bulgaria - Air Force AN1929721.jpg"), scaled to the
// 20.23 m overall length (Wikipedia, Dassault Falcon 2000): fuselage 18.3 m, height 2.33 m, the
// Falcon nose with its kinked windscreen line and four flight-deck panes, eight windows, PW308
// nacelles, 21.38 m wing, swept fin with the tailplane low on it (cruciform), no T-tail.
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

// Falcon 900/900EX/LX (F900): the Falcon 2000 nose and section on a cabin 2.1 m longer, three
// TFE731s: two on the rear fuselage and a centre engine fed by an S-duct whose intake sits on top
// of the fuselage ahead of the fin, the fin mounted on the duct fairing, exhaust at the tail-cone
// end; 19.33 m wing with slats (Wikipedia, Dassault Falcon 900). Proportions from photos on
// Commons (Italian Air Force Falcon 900EX JP7191384, N100UP arp): no to-scale drawing reachable.
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
// The CL-600 airframe that the CRJ grew from: nose and flight deck measured on the CRJ900 APM
// (Bombardier CSP C-020, 00-02-02 fig. 5, levelled; ref/CRJ900.pdf p. 31), which keeps the
// Challenger's nose, on the 2.69 m section; length, cabin and tail from the side-on photo of
// Challenger 605 A7-CEB (Commons "Bombardier CL-600-2B16 Challenger 605, Qatar Executive
// JP6749742.jpg", 3.5 % yaw corrected), scaled to 20.85 m (Wikipedia, Bombardier Challenger 600
// series): seven windows at 0.74 m pitch, CF34-3B nacelles, 43-deg T-tail with a fin-top fairing,
// winglets.
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
};

// ---------- Bombardier Challenger 300/350 (CL30, CL35) ----------
// No drawing reachable: proportions from the side-on photo of N535FX (Commons "Bombardier
// Challenger 300 N535FX landing at San Diego International Airport, March 2023.jpg"), scaled to
// the 20.92 m overall length (Wikipedia, Bombardier Challenger 300): fuselage 19.1 m, height
// 2.27 m, six windows behind the door, HTF7000 nacelles high on the tail cone, 36-deg T-tail.
// The 350's longer span comes from canted winglets.
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
};

// ---------- Learjet 45/75 (LJ45, LJ75) ----------
// No drawing reachable: proportions from the side-on photo of N300JC (Commons "N300JC Learjet Inc
// 45 C-N 340 (5394534073).jpg"), scaled to the 17.68 m overall length (Wikipedia, Learjet 45):
// fuselage 15.63 m, height 1.8 m, small pointed nose, the cabin windows set high, TFE731 nacelles,
// 45-deg T-tail, the two ventral "delta fins" under the tail cone, winglets.
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
  extras: [hatch(3.62, 0.8, 0.3, 1.42)],
  overlays: [ventral([[2.3, 0.78], [1.1, 0.36], [0.6, 0.36], [0.45, 1.12], [1.4, 0.98]])],
  win: [{ z: 0.76, from: 4.13, to: 7.98, pitch: 0.549, w: 0.3, h: 0.38 }],
  wing: { le: 6.1, root: 0.9, span: 14.58, cr: 3.0, ct: 1.1, sweep: 13, dih: 2.5, z: 0.06, t: [0.13, 0.1] },
  tip: { h: 0.95, sweep: 32, top: 0.35, base: 0.85 },
  eng: { kind: "fan", aft: { s: 6.83, z: 0.81 }, len: 2.9, dia: 0.97, style: "long", fx: 0.9 },
  fin: { le: 2.24, cr: 2.45, ct: 1.0, h: 1.75, sweep: 45.6, fillet: [0.8, 0.15] },
  stab: { le: 0.66, z: "T", span: 4.8, root: 0.2, cr: 1.4, ct: 0.6, sweep: 40, dih: 0, bullet: [1.5, 0.16] },
};

// ---------- Hawker 800 (H25B) ----------
// No drawing reachable: proportions from the side-on photo of N75GR (Commons "Hawker 800XPi N75GR at
// Scottsdale Airport, October 2023.jpg"), scaled to the 15.60 m overall length (Wikipedia, Hawker
// 800): fuselage 13.43 m, height 1.99 m, the long low dorsal fillet running forward from the swept
// fin, the tailplane on the fin about halfway up (just above the fuselage), TFE731 nacelles set low
// on the rear fuselage, the large forward door. (N75GR carries aftermarket winglets; not drawn.)
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
// No drawing reachable: built from Wikipedia (Gulfstream G280: 20.37 m, span 19.2 m, cabin 2.18 m
// wide) and the side-on photo of N280GD (Commons "IAI Gulfstream G280 - Gulfstrem Aerospace
// (18701234531).jpg", levelled by 5.1 deg): pointed nose, ten oval windows, HTF7250G nacelles set
// high (centre at the crown line), T-tail, canted winglets.
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
// No APM reachable: proportions from the side-on photo of Legacy 500 G-TULI (Commons "Embraer Legacy
// 500 (G-TULI) lands Bristol Airport 14May2019 arp.jpg", levelled by 6.3 deg), scaled to the
// 20.74 m overall length (Wikipedia, Embraer Legacy 450/500 and Praetor 500/600): fuselage 16.7 m,
// a long overhang of the 48-deg fin and the 45-deg T-tail beyond the tail cone, HTF7500E nacelles,
// seven windows. Drawn with the Praetors' winglets (most of the fleet). The Legacy 450/Praetor 500
// is the same airframe 1.05 m shorter (19.69 m), which the length table sets.
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
// No drawing reachable: proportions from the side-on photos of CJ3 OM-LBG and CJ2 G-EDCM (Commons
// "Cessna 525B Citation CJ3 AN1699978.jpg", "Cessna 525A Citation CJ2 AN1738217.jpg"), scaled to
// the 15.59 m overall length (Wikipedia, Cessna CitationJet/M2): fuselage 13.34 m, height 1.58 m,
// unswept wing, FJ44 nacelles, a 52-deg fin with the tailplane on top, its strong dihedral giving
// the 525 family's raised tips. The CJ2 is the same airframe 1.06 m shorter, one window fewer.
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
  extras: [hatch(3.95, 0.53, 0.25, 1.24, 0.2)],
  win: [{ z: 0.78, from: 3.93, to: -6.37, pitch: 0.507, w: 0.23, h: 0.28 }],
  wing: { le: 6.6, root: 0.8, span: 16.26, cr: 2.5, ct: 1.0, sweep: 3, dih: 4, z: 0.1, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 4.43, z: 0.85 }, len: 2.3, dia: 0.72, style: "long", fx: 0.88 },
  fin: { le: 2.26, cr: 1.6, ct: 1.28, h: 1.74, sweep: 52, fillet: [0.8, 0.12] },
  stab: { le: 0.07, z: "T", drop: 0.05, span: 6.0, root: 0.2, cr: 1.2, ct: 0.6, sweep: 31, dih: 8 },
};

// ---------- Cessna Citation Excel/XLS (C56X) and Sovereign (C680) ----------
// No drawing reachable: proportions from the side-on photos of XLS EC-K.. (Commons "Cessna 560XL
// Citation XLS.jpg", levelled by 4 deg) and Sovereign N94PC (Commons "N94PC Cessna 680 Citation
// Sovereign landing at Palm Springs, March 2023.jpg"), scaled to the overall lengths (Wikipedia:
// Excel 16.0 m, Sovereign 19.35 m). Both carry the Citation X section (1.84 m), a near-straight
// wing and the cruciform tail: the tailplane, with dihedral, on the fin just above the tail cone.
// The Sovereign is stretched (seven windows), with a bigger 16-deg wing, PW306C nacelles and a
// taller fin.
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
  extras: [hatch(4.8, 0.7, 0.3, 1.5, 0.2)],
  win: [{ z: 0.69, from: 5.59, to: 8.9, pitch: 0.81, w: 0.26, h: 0.34 }],
  wing: { le: 6.6, root: 0.95, span: 17.17, cr: 2.7, ct: 1.15, sweep: 8, dih: 4, z: 0.08, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 5.66, z: 0.77 }, len: 2.7, dia: 0.88, style: "long", fx: 0.88 },
  fin: { le: 1.77, cr: 1.7, ct: 1.2, h: 1.91, sweep: 36, fillet: [0.9, 0.12] },
  stab: { le: 1.64, fz: 0.1, span: 6.6, root: 0.25, cr: 1.4, ct: 0.75, sweep: 28, dih: 6 },
};
F.c680 = {
  ...F.c56x, L0: 18.36, over: 0.99,
  extras: [hatch(4.62, 0.75, 0.3, 1.5, 0.2)],
  win: [{ z: 0.7, from: 5.3, to: 10.05, pitch: 0.79, w: 0.26, h: 0.34 }],
  wing: { le: 7.9, root: 0.95, span: 22.04, cr: 3.2, ct: 1.15, sweep: 18, dih: 4, z: 0.08, t: [0.14, 0.11] },
  eng: { kind: "fan", aft: { s: 6.64, z: 0.72 }, len: 3.4, dia: 1.0, style: "long", fx: 0.88 },
  fin: { le: 3.32, cr: 3.0, ct: 1.37, h: 2.41, sweep: 45, fillet: [1.0, 0.12] },
  stab: { le: 2.36, fz: 0.1, span: 7.6, root: 0.25, cr: 1.6, ct: 0.8, sweep: 30, dih: 6 },
};

// ---------- Cessna Citation Latitude (C68A) and Longitude (C700) ----------
// No drawing reachable: proportions from the side-on photos of Latitude N563QS (Commons "Cessna
// Citation Latitude N563QS departing Scottsdale Airport, October 2023.jpg") and Longitude N807QS
// (Commons "Cessna Citation Longitude N807QS.jpg"), scaled to the overall lengths (Wikipedia: 18.97 m
// and 22.30 m). Both have the wide 2.23 m section with its flat-sided cabin and the same nose. The
// Latitude keeps the Sovereign's 16-deg wing and carries its tailplane low on the fin (cruciform,
// as the photos show, not a T-tail); the Longitude has a longer cabin, the new 27-29-deg wing with
// winglets, HTF7700L nacelles set high, and a true T-tail far aft.
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
  extras: [hatch(4.59, 0.81, 0.24, 1.7, 0.25)],
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
  extras: [hatch(4.86, 0.78, 0.24, 1.7, 0.25)],
  win: [{ z: 0.62, from: 6.1, to: 10.6, pitch: 0.635, w: 0.29, h: 0.39 }],
  wing: { le: 9.1, root: 1.1, span: 21.01, cr: 4.2, ct: 1.15, sweep: 29, dih: 4, z: 0.07, t: [0.13, 0.1] },
  tip: { h: 1.0, sweep: 40, top: 0.3, base: 0.85, blend: 0.2 },
  eng: { kind: "fan", aft: { s: 4.9, z: 0.86 }, len: 3.6, dia: 1.2, style: "long", fx: 0.88 },
  fin: { le: 3.1, cr: 3.0, ct: 2.7, h: 2.6, sweep: 48, fillet: [1.0, 0.2] },
  stab: { le: 0.5, z: "T", drop: 0.1, span: 8.5, root: 0.25, cr: 2.0, ct: 0.8, sweep: 38, dih: 2, bullet: [2.2, 0.18] },
};

// ---------- Embraer Phenom 100 (E50P) and 300 (E55P) ----------
// Phenom 300: the side view on the dimensions page of Embraer's Phenom 300E brochure
// (embraer.com, phenom-300e-electronic.pdf p. 22; 15.6 m overall, 5.1 m high), scaled to 15.64 m:
// fuselage 14.21 m, height 1.74 m, low drooped nose, deep belly fairing, five windows behind the
// door, PW535E nacelles high on the tail cone, the 26-deg wing with upswept winglets, a 37-deg fin
// with a long dorsal fillet, T-tail, small ventral fin. Phenom 100: the side view on the
// dimensions page of the Phenom 100EX brochure (phenom-100ex-brochure-final.pdf p. 21; 12.82 m):
// the same section 2.5 m shorter, three windows, an almost straight wing without winglets, a
// more swept fin, smaller PW617F nacelles.
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
  extras: [hatch(4.38, 0.67, 0.29, 1.3, 0.15)],
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
// No drawing reachable: proportions from the side-on photo of D-CFBL (Commons "D-CFBL Platoon PC24
// EGCC.jpg"), scaled to the 16.85 m overall length (Wikipedia, Pilatus PC-24): fuselage 15.2 m,
// height 1.98 m, blunt nose, seven windows, FJ44-4A nacelles at mid-height on the rear fuselage,
// near-straight wing, 42-deg fin with a T-tail. Drawn from the left: the airstair door behind the
// flight deck and the big 1.25 x 1.35 m cargo door at the rear of the cabin, ahead of the engine.
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
// No drawing reachable: outline traced from the side-on photo of N299CV (Commons "Cirrus Vision
// SF50 N299CV FDK MD1.jpg"), scaled to the 9.42 m overall length (Wikipedia, Cirrus Vision SF50).
// Teardrop fuselage with no constant section (drawn as a closed body outline in metres), wraparound
// windscreen, three large oval windows growing towards the front, the single FJ33 on a pylon on top
// of the rear fuselage, the V-tail (drawn as a tailplane with 45-deg dihedral, no fin) and the
// small ventral fin; 11.8 m straight wing.
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
// Global 7500: Commons "Bombardier Global 7500-8000 three views.png" side view (33.88 m overall),
// prepped with refprep: fuselage 29.84 m, height 2.75 m, 14 large windows at 0.915 m pitch, two
// flight-deck panes in a band, a fin swept 41 deg whose chord grows towards the top, a highly
// swept T-tail with a fin-top fairing, GE Passport nacelles, canted swept winglets.
// Global Express/6000/6500: the same nose and section; 30.30 m overall (Wikipedia, Bombardier
// Global Express), 13 smaller windows at 0.77 m pitch (photo OE-IGS, Commons
// 2010-07-08_BD700_Tyrolean_OE-IGS_EDDF_03.jpg, levelled), BR710 nacelles, smaller wing (28.65 m).
// Global 5000: the same airframe 0.81 m shorter (data.js length), so one window fewer.
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
// G550: Commons "Gulfstream G500 3-view line drawing.svg" (the GV-SP airframe of 2003, identical to
// the G550 outside), side view prepped with refprep at the 29.39 m overall length: fuselage 26.15 m,
// height 2.39 m, long pointed radome, two-pane flight-deck band with a slanted divider, the large
// oval cabin windows (0.72 m wide, 0.53 m tall) at 1.23 m pitch, BR710 nacelles high on the tail
// cone, 43.5-deg fin with a fin-top fairing over the T-tail, swept winglets.
// G450: the GIV-SP airframe of Commons "Gulfstream IV-SP 3-view line drawing.png" (26.92 m) with the
// G450's 27.23 m (Wikipedia, Gulfstream IV): shorter cabin (six windows behind the door like the
// G550), smaller wing (23.72 m), Tay 611 nacelles, lower fin.
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

// G450 photo (Commons VH-MBP/TC-KHB G450 set; TC-KHB side-on, scaled by the G550 window pitch):
// door at 5.36 m, six windows 6.93-13.10 m, tail cone end 24.0 m; Tay nacelle 15.55 m.
F.glf4 = {
  ...F.glf5, L0: 24.0, over: 3.23,
  doors: [[5.36, 0.94]],
  win: [{ z: 0.56, from: 6.93, to: 13.1, pitch: 1.233, w: 0.7, h: 0.5 }],
  wing: { le: 10.0, root: 1.2, span: 23.72, cr: 5.6, kink: [0.25, 3.6], ct: 1.3, sweep: 31, dih: 1.5, z: 0.05, t: [0.13, 0.1] },
  tip: { h: 1.5, sweep: 48, top: 0.45, base: 0.85, blend: 0.3 },
  eng: { kind: "fan", aft: { s: 8.45, z: 0.8 }, len: 5.0, dia: 1.5, style: "long", fx: 0.88 },
  fin: { le: 4.5, cr: 4.4, ct: 2.8, h: 3.1, sweep: 43.5, fillet: [1.0, 0.5], cap: 0.12, rudder: 0.75 },
  stab: { le: 1.5, z: "T", drop: 0.33, span: 9.75, root: 0.3, cr: 2.6, ct: 1.25, sweep: 35, dih: 0, bullet: [2.3, 0.24] },
};
// G650: no to-scale drawing reachable; built on the G550 with Wikipedia (Gulfstream G650) dimensions:
// 30.41 m overall, span 30.36 m, cabin 2.49 m wide, so a fuller section; blunter nose with the
// four-pane windscreen, larger oval windows (photos G-ULFS, N520GA on Commons), the new 36-deg wing
// with blended winglets, BR725 nacelles, taller fin.
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
  C25A: ["c25b", { win: [{ z: 0.78, from: 3.93, to: 6.5, pitch: 0.507, w: 0.23, h: 0.28 }], wing: { le: 6.4, root: 0.8, span: 15.19, cr: 2.45, ct: 1.0, sweep: 3, dih: 4, z: 0.1, t: [0.14, 0.11] } }],
  C25B: "c25b",
  SF50: "sf50", E50P: "e50p", E55P: "e55p", PC24: "pc24",
  C56X: "c56x", C680: "c680", C68A: "c68a", C700: "c700",
  LJ45: "lj45", LJ75: ["lj45", { tip: { h: 1.1, sweep: 35, top: 0.35, base: 0.85, blend: 0.2 } }],
};
