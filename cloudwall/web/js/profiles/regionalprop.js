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

export const families = F;
export const types = {
  E120: "e120", F27: "f27", F50: "f50",
};
