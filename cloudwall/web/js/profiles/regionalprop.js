// Regional and commuter turboprops of the 1950s to 1990s. Format: see ../profiles.js.
const F = {};

const lerp = (x, y, t) => x + (y - x) * t;
// A dorsal fin blending into the fin's leading edge: from the crown at s0 (from the tail end,
// metres, negative) up to the leading-edge point (s1, z1). Filled without a stroke first, then
// stroked along the outside only, so it merges with the fin and fuselage behind it.
const dorsal = (s0, s1, z1, bulge = 0.5) => ({ sk, at, top, f, L }) => {
  const a = at(s0), b = at(s1), za = top(a), m = (t, u) => [lerp(a, b, t), za + (z1 - za) * u];
  const te = L - f.fin.le + f.fin.cr - 0.25;
  const curve = [[a - 0.3, za - 0.01, "c"], m(0.3, 0.08 * bulge + 0.04), m(0.62, 0.22 + 0.2 * bulge), m(0.86, 0.55 + 0.1 * bulge), [b, z1, "c"]];
  sk.smooth("fin", [...curve, [b + 0.5, z1 - 0.2, "c"], [te, top(te) + 0.08, "c"], [te, top(te) - 0.4, "c"], [a - 0.3, za - 0.4, "c"]], true, ' style="stroke:none"');
  sk.smooth("fin", curve, false, ' style="fill:none"');
};
// A nacelle traced off the side view, in metres ([s, z, flag] from the nose tip and keel), with the
// spinner joint at s = sp. Drawn among the extras, so the wing (whose side view, with its dihedral,
// climbs across the nacelle) passes in front of it as it does on the drawings.
const nacelle = (outline, sp) => ({ sk }) => {
  sk.smooth("nac", outline);
  if (sp) {
    const zs = outline.filter(([s]) => Math.abs(s - sp) < 0.2).map(([, z]) => z);
    if (zs.length > 1) sk.poly("hl", [[sp, Math.max(...zs)], [sp, Math.min(...zs)]], false);
  }
};
// The propeller, drawn last: hub at (s, z), diameter d.
const propeller = (s, z, d, blades) => ({ sk, prop }) => prop(sk, s, z, d, blades);
// A straight dorsal fillet from the crown at s0 to the fin's leading edge at (s1, z1); s from the
// tail end (negative), drawn like dorsal() so it merges with the fin behind it.
const fillet = (s0, s1, z1) => ({ sk, at, top, f, L }) => {
  const a = at(s0), b = at(s1), te = L - f.fin.le + f.fin.cr - 0.25;
  const edge = [[a - 0.3, top(a - 0.3) - 0.01, "c"], [a, top(a) + 0.01, "cl"], [b, z1, "c"]];
  sk.smooth("fin", [...edge, [b + 0.5, z1 - 0.2, "c"], [te, top(te) + 0.08, "c"], [te, top(te) - 0.4, "c"], [a - 0.3, top(a - 0.3) - 0.4, "c"]], true, ' style="stroke:none"');
  sk.smooth("fin", edge, false, ' style="fill:none"');
};
// Parts traced off a type's drawing: [class, points]. Classes: strut (a filled outline: antennas),
// fin (a filled fin-coloured outline: strakes), door (an outline), hl (a panel line),
// dot ([s, z, rx, ry]: a small dark port).
// Cabin windows drawn over a nacelle that stands in front of them, the way the renderer draws a
// window row: stations s (metres), centre height z (in D), width and height (metres).
const windowsOver = (stations, z, w, h) => ({ sk, D }) => {
  const run = Math.abs(h - w);
  const d = stations.map((s) => {
    const [x, y] = sk.xy(s, z * D);
    return h >= w ? `M${x.toFixed(2)},${(y - run / 2).toFixed(2)}v${run.toFixed(2)}` : `M${(x - run / 2).toFixed(2)},${y.toFixed(2)}h${run.toFixed(2)}`;
  }).join("");
  sk.path("win", d, ` stroke-width="${Math.min(w, h)}"`);
};
const marks = (parts) => ({ sk }) => {
  for (const [cls, p] of parts) {
    if (cls === "dot") sk.ellipse("inlet", ...p);
    else if (cls === "strut") sk.poly("strut", p);
    else if (cls === "fin") sk.smooth("fin", p);
    else if (cls === "door") sk.smooth("door", p);
    else sk.poly("hl", p, false);
  }
};

// ---------- Embraer EMB 120 Brasilia ----------
// Reference: Wikimedia Commons "Embraer EMB 120 Brasilia v1.0.png" (Julien Scavini; dimensioned
// side, top, front and section views), its side view scaled to the published length of 20.00 m
// (span 19.78 m, height 6.35 m: Wikipedia). The drawing sits nose-down on its gear: measured from
// the fuselage datum, 1.6 degrees off its ground line. Slim tube with a long tapered nose, low wing
// with marked dihedral, deep PW118 nacelles standing above the wing and running well past its
// trailing edge, big swept T-tail on a long dorsal, airstair door ahead of the propeller and a
// cargo door at the back on the left side.
F.e120 = {
  kind: "turboprop", L0: 18.84, over: 1.16, D: 2.24, W: 2.28, fwd: 0.5, fair: 0.04, fairFwd: 0.1, fairAft: 1.05, floor: 0.2,
  nose: {
    tip: 0.144,
    top: [[0.041, 0.205], [0.104, 0.244], [0.166, 0.284], [0.29, 0.353], [0.414, 0.412], [0.538, 0.47], [0.663, 0.508], [0.787, 0.557],
      [0.911, 0.595], [1.035, 0.633], [1.159, 0.712], [1.284, 0.802], [1.408, 0.871], [1.532, 0.95], [1.656, 0.978], [1.781, 0.995], [1.905, 1]],
    bot: [[0.041, 0.091], [0.104, 0.068], [0.166, 0.056], [0.29, 0.032], [0.414, 0.018], [0.538, 0.007], [0.787, 0]],
  },
  tail: {
    top: [[2.05, 1], [1.636, 0.98], [1.325, 0.951], [1.015, 0.911], [0.704, 0.861], [0.393, 0.811], [0.186, 0.774], [0, 0.727]],
    bot: [[2.671, 0], [2.05, 0.029], [1.739, 0.061], [1.429, 0.115], [1.118, 0.199], [0.807, 0.305], [0.497, 0.441], [0.29, 0.549], [0.145, 0.628], [0, 0.696]],
  },
  glass: [
    [[1.079, 0.631], [1.302, 0.623], [1.501, 0.827], [1.406, 0.848]],
    [[1.379, 0.623], [1.522, 0.805], [1.698, 0.788], [1.698, 0.577], [1.408, 0.585]],
  ],
  doors: [[4.58, 0.72, "D", undefined, 1.72, 0.39], [8.7, 0.42, "E", undefined, 0.58, 1.21], [14.49, 1.38, "C", undefined, 1.46, 0.34]],
  win: [{ z: 0.665, from: 5.32, to: 12.9, pitch: 0.839, w: 0.27, h: 0.33 }],
  wing: { le: 8.06, root: 1.14, span: 19.78, cr: 2.15, ct: 1.16, sweep: 3.3, dih: 5.9, z: 0.08, t: [0.18, 0.12] },
  fin: { le: 3.07, cr: 2.62, ct: 1.85, h: 2.52, sweep: 36.6, rudder: 0.8 },
  stab: { le: 1.2, z: "T", drop: -0.05, span: 6.9, root: 0.2, cr: 2.0, ct: 0.85, sweep: 24, dih: 0, bullet: [2.0, 0.12] },
  extras: [
    dorsal(-5.97, -2.36, 3.17, 0.5),
    ({ aerials }) => aerials([["blade", 10.8, 11.1, 0.24, 1], ["blade", 11.95, 12.1, 0.07, 1]]),
    nacelle([[5.37, 0.96, "c"], [5.6, 1.13], [5.79, 1.2], [5.97, 1.22, "c"], [6.39, 1.28], [7.08, 1.29], [7.78, 1.25], [8.24, 1.2], [8.57, 1.1],
      [9.4, 0.87], [10.09, 0.69], [10.79, 0.62], [11.57, 0.46], [12.22, 0.19, "c"], [11.57, 0.09], [10.79, 0.07], [10.0, 0.04], [9.26, -0.14],
      [8.47, -0.35], [7.69, -0.24], [6.85, 0.04], [6.3, 0.17], [5.97, 0.27, "c"], [5.79, 0.69], [5.6, 0.77]], 5.97),
    marks([
      ["fin", [[15.19, 0.455, "c"], [17.27, 0.906, "c"], [17.18, 0.77, "c"], [15.42, 0.379, "c"]]],
      ["hl", [[0.77, 0.83], [0.77, 0.05]]],
      ["dot", [2.22, 0.79, 0.07, 0.07]], ["dot", [2.27, 0.33, 0.07, 0.07]],
    ]),
  ],
  overlays: [propeller(5.79, 0.95, 2.82, 4)],
};

// ---------- Fokker 50 ----------
// Reference: Wikimedia Commons "KLM Fokker 50.png" (Marcusroos; a side-on profile drawing, 3,311 px
// long), scaled to the published length of 25.25 m (span 29.00 m, height 8.32 m, propellers
// 3.66 m: Wikipedia). The profile draws the fuselage 3% too deep and the nacelles too high, so the
// heights are taken down to near side-on photos: the fuselage to the 2.7 m the I-SIXA photo below
// gives, and the nacelles to where it and "Fokker 50, KLM Cityhopper AN1236546.jpg" (PH-LXR) show
// them, hanging well down the fuselage side with the spinner at window height. The F27-500
// airframe: high wing on top of a round fuselage, nacelles slung under it running far past the
// trailing edge with the exhaust on their outer side, a broad fin on a long straight dorsal fillet,
// and a low tailplane with strong dihedral. Twice the F27's windows, smaller, and six-bladed
// propellers.
F.f50 = {
  kind: "turboprop", L0: 25.25, over: 0, D: 2.72, W: 2.7, fwd: 0.5, fair: 0, floor: 0.2,
  nose: {
    tip: 0.372,
    top: [[0.049, 0.41], [0.158, 0.465], [0.294, 0.519], [0.429, 0.565], [0.565, 0.606], [0.756, 0.652], [0.783, 0.742], [0.864, 0.824],
      [0.973, 0.883], [1.109, 0.932], [1.245, 0.965], [1.381, 0.984], [1.653, 0.995], [1.924, 1]],
    bot: [[0.049, 0.294], [0.158, 0.239], [0.294, 0.198], [0.565, 0.136], [0.837, 0.09], [1.109, 0.049], [1.381, 0.019], [1.653, 0.005], [1.924, 0]],
  },
  tail: {
    top: [[1.625, 1], [0.81, 1], [0.402, 0.99], [0.204, 0.927], [0.109, 0.769], [0.041, 0.66], [0, 0.606]],
    bot: [[3.419, 0], [2.93, 0.019], [2.713, 0.041], [2.259, 0.122], [1.807, 0.201], [1.354, 0.291], [0.9, 0.383], [0.266, 0.519], [0.041, 0.563], [0, 0.584]],
  },
  glass: [
    [[0.995, 0.647], [1.169, 0.644], [1.218, 0.777], [1.06, 0.777]],
    [[0.913, 0.66], [0.951, 0.66], [1.022, 0.777], [0.987, 0.777]],
    [[0.783, 0.663], [0.897, 0.663], [0.959, 0.78], [0.878, 0.78]],
  ],
  doors: [[4.59, 0.84, "D", undefined, 1.87, 0.33], [17.65, 0.69, "D", undefined, 1.26, 0.5]],
  win: [{ z: 0.49, from: 7.0, to: 15.35, pitch: 0.4633, w: 0.19, h: 0.3 }, { z: 0.49, from: 16.25, to: 16.7, pitch: 0.443, w: 0.19, h: 0.3 }],
  wing: { le: 9.8, root: 1.35, span: 29.0, cr: 3.2, ct: 1.4, sweep: 2, dih: 2.5, z: 1.07, t: [0.18, 0.13] },
  fin: { le: 4.67, cr: 4.1, ct: 1.72, h: 4.42, sweep: 22, rudder: 0.67 },
  stab: { le: 3.83, z: 0.937, span: 9.75, root: 1.0, cr: 2.16, ct: 0.955, sweep: 14.3, dih: 8.1 },
  extras: [fillet(-10.6, -4.22, 3.9)],
  overlays: [
    nacelle([[7.0, 1.9, "c"], [7.25, 2.12], [7.65, 2.28], [8.05, 2.36, "c"], [8.8, 2.5], [9.5, 2.56], [10.5, 2.57], [11.5, 2.5], [12.5, 2.3],
      [13.5, 2.08], [14.4, 1.85], [15.0, 1.6, "c"], [14.4, 1.32], [13.4, 1.04], [12.4, 1.06], [11.8, 1.08], [10.5, 1.1], [9.5, 1.12], [8.6, 1.2],
      [8.05, 1.3, "c"], [7.65, 1.55], [7.25, 1.68]], 8.05),
    marks([["dot", [10.8, 1.55, 0.27, 0.15]]]),
    propeller(7.55, 1.9, 3.66, 6),
  ],
};

// Fokker F27 Friendship, drawn as the F27-500 (25.06 m, the length Wikipedia gives and the model
// most of the surviving fleet are): the same airframe 0.19 m shorter, half as many cabin windows,
// each a large oval, Dart nacelles whose jet pipe ends in a cone at the back rather than the
// Fokker 50's side exhaust, and four-bladed Dowty Rotol propellers of about 3.5 m (132 in in the UK
// CAA's data sheet). Checked against near side-on Commons photos of I-SIXA ("Six Cargo I-SIXA
// f27-500 Coventry 02-01-07") and OY-APA ("Maersk Air Fokker F-27-500 OY-APA.jpg").
F.f27 = {
  ...F.f50, L0: 25.06,
  win: [{ z: 0.5, from: 7.0, to: 16.3, pitch: 0.927, w: 0.32, h: 0.48 }],
  overlays: [
    nacelle([[7.19, 1.61, "c"], [7.45, 1.82], [7.8, 1.95], [8.1, 2.02, "c"], [8.8, 2.3], [9.5, 2.44], [10.5, 2.52], [11.5, 2.5], [12.5, 2.3],
      [13.4, 2.05], [14.15, 1.97], [14.7, 1.78], [15.05, 1.52, "c"], [14.6, 1.3], [14.15, 1.15], [13.4, 0.95], [12.4, 1.0], [11.8, 1.07],
      [10.5, 1.1], [9.5, 1.15], [8.6, 1.2], [8.1, 1.22, "c"], [7.8, 1.3], [7.45, 1.42]], 8.1),
    ({ sk }) => sk.smooth("core", [[13.6, 1.98, "c"], [14.4, 1.92], [15.05, 1.52, "c"], [14.4, 1.4], [13.6, 1.45, "c"]]),
    propeller(7.62, 1.61, 3.5, 4),
  ],
};

// ---------- Saab 340 ----------
// Reference: Wikimedia Commons "Saab 340B-Plus, Japan Airlines - JAL (Japan Air Commuter - JAC)
// AN1620908.jpg" (JA001C, a near side-on photo, taxiing), scaled to the published length of
// 19.73 m from the nose to the fin tip (span 21.44 m, height 6.97 m, propellers 3.35 m:
// Wikipedia), checked against "Regional Express Saab 340 VH-ORX Adelaide 2024 (01).jpg". A
// round, short fuselage with a blunt nose, low wing with marked dihedral, deep CT7 nacelles over
// the wing with the intake under the spinner, a big swept fin on a long dorsal, and a low
// tailplane with strong dihedral; the airstair door ahead of the propellers, an overwing exit
// and the cargo door at the back on the left.
F.sf34 = {
  kind: "turboprop", L0: 19.54, over: 0.19, D: 2.37, W: 2.31, fwd: 0.5, fair: 0.04, fairFwd: 0.1, fairAft: 1.05, floor: 0.2,
  nose: {
    tip: 0.216,
    top: [[0.071, 0.303], [0.224, 0.477], [0.373, 0.626], [0.531, 0.726], [0.747, 0.842], [0.996, 0.937], [1.203, 0.983], [1.41, 1]],
    bot: [[0.071, 0.137], [0.224, 0.079], [0.373, 0.046], [0.531, 0.029], [0.83, 0.008], [1.161, 0]],
  },
  tail: {
    top: [[3.02, 1], [2.107, 0.966], [1.278, 0.908], [0.697, 0.859], [0.357, 0.842], [0.191, 0.801], [0.033, 0.668], [0, 0.606]],
    bot: [[3.02, 0], [2.588, 0.021], [1.95, 0.047], [1.311, 0.162], [0.672, 0.353], [0.191, 0.527], [0.033, 0.593], [0, 0.6]],
  },
  glass: [
    [[0.577, 0.63], [0.685, 0.792], [0.992, 0.806], [0.838, 0.63]],
    [[0.9, 0.63], [1.054, 0.806], [1.253, 0.806], [1.3, 0.615]],
  ],
  doors: [[4.69, 0.78, "D", undefined, 1.73, 0.42], [9.22, 0.54, "E", undefined, 0.62, 1.24], [14.45, 1.34, "C", undefined, 1.32, 0.44]],
  win: [{ z: 0.636, from: 5.59, to: 12.9, pitch: 0.608, w: 0.27, h: 0.36 }],
  wing: { le: 8.3, root: 1.15, span: 21.44, cr: 2.6, ct: 1.0, sweep: 3, dih: 7, z: 0.1, t: [0.16, 0.12] },
  fin: { le: 3.72, cr: 2.87, ct: 1.06, h: 3.44, sweep: 39.6, rudder: 0.7 },
  stab: { le: 3.03, z: 0.75, span: 9.24, root: 0.6, cr: 1.9, ct: 0.9, sweep: 28, dih: 11 },
  extras: [dorsal(-7.65, -2.8, 3.48, 0.4)],
  overlays: [
    nacelle([[5.91, 0.95, "c"], [6.1, 1.15], [6.35, 1.28], [6.59, 1.34, "c"], [7.2, 1.42], [8.2, 1.42], [9.2, 1.3], [10.2, 0.95], [10.9, 0.45, "c"],
      [10.2, 0.1], [9.2, -0.1], [8.0, -0.17], [7.1, -0.12], [6.7, 0.1], [6.62, 0.44, "c"], [6.35, 0.64], [6.1, 0.75]], 6.59),
    propeller(6.39, 0.95, 3.35, 4),
  ],
};

// ---------- CASA/IPTN CN-235 ----------
// Reference: Wikimedia Commons "EADS CASA CN-235.svg" (Sorruno; side and plan views), the side view
// scaled to the published length of 21.40 m (span 25.81 m, height 8.18 m: Wikipedia) and the wing
// and tailplane planforms taken off its plan view. A wide, deep fuselage under a high wing, the
// nacelles riding level with the crown and running back over it, the main wheels in a long sponson
// on the lower fuselage side, a passenger door at the back ahead of the upswept tail with its
// loading ramp, a ventral strake, and a tall swept fin on a long straight dorsal. The drawing shows
// the four-bladed Hamilton Standard 14RF propellers smaller than they are: they are drawn here at
// 3.35 m, the diameter Jane's gives the 14RF on the Saab 340.
const cnSponson = ({ shaded }) => shaded([[5.91, 0.16, "c"], [6.51, 0.57], [7.44, 0.92], [8.59, 1.08], [9.65, 1.06], [10.46, 0.92],
  [11.04, 0.63], [11.35, 0.4, "c"], [11.16, 0.11], [10.69, -0.22], [9.42, -0.3], [7.68, -0.26], [6.51, -0.13], [6.05, 0.05]]);
F.cn35 = {
  kind: "turboprop", L0: 21.39, over: 0, D: 2.56, W: 2.87, fwd: 0.5, fair: 0, floor: 0.25,
  nose: {
    tip: 0.269,
    top: [[0.036, 0.382], [0.1, 0.469], [0.227, 0.577], [0.413, 0.659], [0.54, 0.782], [0.726, 0.909], [0.853, 0.954], [1.039, 0.995], [1.166, 1]],
    bot: [[0.039, 0.187], [0.163, 0.11], [0.381, 0.047], [0.694, 0.015], [1.166, 0]],
  },
  tail: {
    top: [[3.996, 1], [3.488, 1.017], [2.635, 1.049], [1.728, 1.085], [0.821, 1.122], [0.204, 1.14], [0.05, 1.131], [0, 1.104]],
    bot: [[4.268, 0], [3.549, 0.053], [2.704, 0.391], [2.078, 0.641], [1.515, 0.8], [1.14, 0.877], [0.827, 0.94], [0.201, 1.049], [0, 1.094]],
  },
  glass: [
    [[0.461, 0.657], [0.602, 0.813], [0.689, 0.813], [0.58, 0.65]],
    [[0.596, 0.619], [0.712, 0.813], [0.821, 0.813], [0.758, 0.604]],
    [[0.783, 0.604], [0.868, 0.813], [0.921, 0.813], [0.984, 0.704], [0.971, 0.625]],
  ],
  doors: [[4.69, 0.42, "D", undefined, 0.74, 1.03], [11.8, 0.79, "D", undefined, 1.62, 0.56]],
  win: [{ z: 0.557, from: 4.13, to: 4.13, w: 0.27, h: 0.32 }, { z: 0.557, from: 5.47, to: 5.47, w: 0.27, h: 0.32 },
    { z: 0.557, from: 6.3, to: 10.95, pitch: 0.514, w: 0.27, h: 0.32 }],
  wing: { le: 8.21, root: 1.45, span: 25.81, cr: 2.48, ct: 1.26, sweep: 5.3, dih: 3, z: 1.18, t: [0.18, 0.12] },
  fin: { le: 3.89, cr: 3.36, ct: 1.46, h: 4.97, sweep: 27, rudder: 0.7, round: 0.25 },
  stab: { le: 3.72, z: 1.049, span: 10.8, root: 0.4, cr: 3.13, ct: 1.4, sweep: 19, dih: 0 },
  extras: [
    fillet(-7.56, -3.0, 4.57), cnSponson,
    marks([
      ["fin", [[17.55, 2.04, "c"], [17.71, 1.76, "c"], [19.19, 1.96, "c"], [19.43, 2.44, "c"]]],
      ["hl", [[12.5, 0.15], [12.54, 0.4], [15.51, 1.48], [15.6, 1.35]]],
    ]),
  ],
  overlays: [
    nacelle([[5.47, 2.58, "c"], [5.7, 2.78], [5.95, 2.9], [6.19, 2.92, "c"], [7.1, 3.01], [8.84, 3.03], [10.46, 2.85], [12.46, 2.6, "c"],
      [11.62, 2.26], [10.46, 1.97], [7.79, 1.97], [6.19, 1.97], [6.14, 2.0, "c"], [5.95, 2.31], [5.7, 2.43]], 6.19),
    propeller(5.95, 2.58, 3.35, 4),
  ],
};

// ---------- Grumman Gulfstream I (G-159) ----------
// Reference: Wikimedia Commons "Grumman G-159 Gulfstream I AN1488671.jpg" (N748AA taxiing, a near
// side-on photo), scaled to the published length of 19.43 m, nose to rudder (span 23.92 m,
// height 6.93 m: Wikipedia); the airstair door placed from "Bally's Park Place Casino Hotel Grumman
// G-159 Gulfstream I N31CN.jpg". Wikimedia's small three-view ("Grumman Gulfstream I drawing.jpg")
// is too rough to measure from. Low wing, long Dart nacelles reaching well ahead of it with
// four-bladed Rotol propellers, a row of big oval cabin windows, a deep stand-up cabin under a
// smooth crown with a small flight-deck hump, a rounded swept fin and a low tailplane.
F.g159 = {
  kind: "turboprop", L0: 19.0, over: 0.43, D: 2.47, W: 2.4, fwd: 0.5, fair: 0.04, fairFwd: 0.1, fairAft: 1.05, floor: 0.2,
  nose: {
    tip: 0.346,
    top: [[0.065, 0.419], [0.125, 0.47], [0.313, 0.566], [0.472, 0.627], [0.627, 0.704], [0.781, 0.842], [0.939, 0.971], [1.099, 1.021],
      [1.253, 1.038], [1.628, 1.002], [1.953, 1]],
    bot: [[0.065, 0.266], [0.313, 0.159], [0.627, 0.063], [0.939, 0.022], [1.253, 0.01], [1.628, 0]],
  },
  tail: {
    top: [[3.218, 1], [2.16, 0.981], [1.183, 0.924], [0.532, 0.826], [0.207, 0.72], [0, 0.614]],
    bot: [[3.462, 0], [2.974, 0.005], [2.404, 0.037], [1.997, 0.085], [1.59, 0.134], [1.183, 0.208], [0.858, 0.281], [0.532, 0.378], [0.288, 0.427],
      [0.044, 0.525], [0, 0.566]],
  },
  glass: [
    [[1.127, 0.698], [1.314, 0.698], [1.314, 0.877], [1.127, 0.877]],
    [[0.939, 0.737], [1.08, 0.737], [1.111, 0.867], [0.986, 0.867]],
    [[0.659, 0.72], [0.908, 0.73], [0.977, 0.886], [0.814, 0.886]],
  ],
  doors: [[3.4, 0.7, "D", undefined, 1.85, 0.4]],
  wing: { le: 8.0, root: 1.2, span: 23.92, cr: 3.3, ct: 1.3, sweep: 3, dih: 6, z: 0.12, t: [0.17, 0.12] },
  fin: { le: 3.26, cr: 3.11, ct: 1.35, h: 3.33, sweep: 37, rudder: 0.7, round: 0.4 },
  stab: { le: 1.85, z: 0.63, span: 8.0, root: 0.5, cr: 2.0, ct: 1.0, sweep: 20, dih: 3 },
  extras: [dorsal(-5.33, -2.97, 2.86, 0.3)],
  overlays: [
    nacelle([[5.14, 1.12, "c"], [5.4, 1.33], [5.63, 1.46], [6.11, 1.62, "c"], [7.04, 1.66], [9.29, 1.62], [10.91, 1.66], [12.06, 1.58], [12.86, 1.32, "c"],
      [12.46, 1.04], [12.06, 0.87], [10.91, 0.37], [9.29, 0.11], [8.04, 0.13], [6.95, 0.47], [6.11, 0.66, "c"], [5.63, 0.79], [5.4, 0.92]], 6.11),
    windowsOver([7.22, 8.42, 9.62, 10.82], 0.595, 0.44, 0.32),
    propeller(5.72, 1.12, 3.3, 4),
  ],
};

// ---------- Embraer EMB 110 Bandeirante ----------
// Reference: Wikimedia Commons "G-OFLT Embraer EMB110 Bandeirante Flightline CVT 03-93
// (46900426885).jpg" (a near side-on photo of an EMB 110P1), scaled to the published length of
// 15.10 m to the tailplane tips (span 15.33 m, propellers 2.36 m: Wikipedia). A slim unpressurised
// tube with square windows, a long tapering nose, low wing, slim PT6A nacelles slung well ahead of
// it, a swept fin whose rudder overhangs the blunt tail cone, and a swept tailplane reaching
// further back still.
F.e110 = {
  kind: "turboprop", L0: 14.04, over: 1.06, D: 2.05, W: 1.7, fwd: 0.5, fair: 0, floor: 0.2,
  nose: {
    tip: 0.316,
    top: [[0.063, 0.368], [0.149, 0.454], [0.379, 0.539], [0.666, 0.625], [0.807, 0.68], [0.952, 0.796], [1.067, 0.881], [1.238, 0.952],
      [1.379, 0.996], [1.766, 1]],
    bot: [[0.063, 0.223], [0.234, 0.19], [0.465, 0.167], [0.837, 0.138], [1.208, 0.093], [1.58, 0.045], [1.952, 0.015], [2.324, 0]],
  },
  tail: {
    top: [[1.551, 1], [1.156, 0.978], [0.807, 0.937], [0.435, 0.863], [0.175, 0.751], [0, 0.621]],
    bot: [[2.294, 0], [1.922, 0.045], [1.551, 0.156], [1.179, 0.223], [0.807, 0.286], [0.435, 0.342], [0, 0.41]],
  },
  glass: [
    [[0.892, 0.61], [1.223, 0.61], [1.272, 0.796], [1.093, 0.825]],
    [[0.807, 0.64], [0.881, 0.625], [1.067, 0.825], [1.023, 0.825]],
  ],
  doors: [[8.84, 0.69, "E", undefined, 1.01, 0.66]],
  win: [{ z: 0.584, from: 3.27, to: 9.75, pitch: 0.806, w: 0.36, h: 0.34 }],
  wing: { le: 4.4, root: 0.85, span: 15.33, cr: 2.3, ct: 1.3, sweep: 2, dih: 7, z: 0.08, t: [0.17, 0.12] },
  fin: { le: 1.95, cr: 1.94, ct: 1.27, h: 1.9, sweep: 35.4, rudder: 0.68 },
  stab: { le: 2.2, z: 0.584, span: 6.6, root: 0.5, cr: 1.7, ct: 0.9, sweep: 38, dih: 0 },
  extras: [marks([["fin", [[13.42, 0.63, "c"], [13.34, 0.24, "c"], [10.86, 0.09, "c"], [11.62, 0.46]]]])],
  overlays: [
    nacelle([[2.48, 0.65, "c"], [2.56, 0.74], [2.71, 0.82, "c"], [3.24, 0.89], [4.0, 0.93], [5.0, 0.87], [5.8, 0.62, "c"], [4.88, 0.16], [4.0, 0.13],
      [3.0, 0.21], [2.71, 0.43, "c"], [2.56, 0.54]], 2.71),
    marks([["dot", [3.18, 0.58, 0.09, 0.06]]]),
    propeller(2.62, 0.65, 2.36, 3),
  ],
};

export const families = F;
export const types = {
  CN35: "cn35", E110: "e110", E120: "e120", F27: "f27", F50: "f50", G159: "g159", SF34: "sf34",
};
