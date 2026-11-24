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

export const families = F;
export const types = {
  E120: "e120",
};
