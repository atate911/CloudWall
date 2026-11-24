// Twin turboprop business aircraft: the Cheyennes, Conquests, MU-2 and Turbo Commanders.
// Format: see ../profiles.js.
const F = {};
const lerp = (x, y, t) => x + (y - x) * t;

// A door drawn to its real height (the renderer's door kinds assume airliner proportions).
const door = (s, w, z0, h, r = 0.12) => ({ sk, at }) => {
  const a = at(s) - w / 2, b = at(s) + w / 2;
  sk.smooth("door", [[a + r, z0, "l"], [b - r, z0], [b, z0 + r, "l"], [b, z0 + h - r], [b - r, z0 + h, "l"], [a + r, z0 + h], [a, z0 + h - r, "l"], [a, z0 + r]]);
};
// The engines drawn as an overlay, with the near tip tank drawn after them, in front: the family's
// eng spec at the span fractions nac (eng.at is left empty so the renderer doesn't draw them too).
const engines = ({ sk, sec, f, propNacelle }) => {
  for (const eta of f.nac) {
    const q = sec(eta);
    propNacelle(sk, q.le - f.eng.fwd, q.z - f.eng.drop, f.eng, q);
  }
};
// PT6A exhaust stack: a short stub out of the nacelle side, turned aft, behind the propeller.
const stacks = (s, z, l = 0.42, h = 0.2) => ({ sk, sec, f }) => {
  for (const eta of f.nac || f.eng.at) {
    const q = sec(eta), s0 = q.le - f.eng.fwd + s, zc = q.z - f.eng.drop + z;
    sk.smooth("core", [[s0, zc + h / 2, "c"], [s0 + l * 0.7, zc + h * 0.55], [s0 + l, zc + h * 0.1, "c"], [s0 + l * 0.75, zc - h * 0.45], [s0, zc - h / 2, "c"]]);
    sk.ellipse("inlet", s0 + l * 0.93, zc - h * 0.05, 0.04, h * 0.42);
  }
};
// TPE331 exhaust: a round pipe out of the back of the nacelle (or its side, ahead of the wing).
const pipe = (s, z, r = 0.09) => ({ sk, sec, f }) => {
  for (const eta of f.nac || f.eng.at) {
    const q = sec(eta), s0 = q.le - f.eng.fwd + s, zc = q.z - f.eng.drop + z;
    sk.ellipse("inlet", s0, zc, r * 0.55, r);
  }
};
// Wingtip tank: a spindle at the wing tip, nose fwd ahead of the tip leading edge.
const tipTank = (len, dia, fwd, dz = 0) => ({ sk, sec }) => {
  const q = sec(1), s0 = q.le - fwd, zc = q.z + dz, r = dia / 2, S = (u) => s0 + u * len;
  sk.smooth("nac", [[S(0), zc, "c"], [S(0.06), zc + r * 0.72], [S(0.3), zc + r], [S(0.68), zc + r * 0.86], [S(1), zc + r * 0.12, "c"],
    [S(1), zc - r * 0.12, "c"], [S(0.68), zc - r * 0.86], [S(0.3), zc - r], [S(0.06), zc - r * 0.72]]);
};
// A dorsal fin blending into the fin's leading edge: from the crown at s0 (from the tail end,
// metres, negative) up to the point on the leading edge at height z1. Filled without a stroke first,
// then stroked along the outside only, so it merges with the fin and fuselage behind it.
const dorsal = (s0, z1, bulge = 0.5) => ({ sk, at, top, f, L, tan }) => {
  const r = L - f.fin.le, b = r + (z1 - top(r)) * tan(f.fin.sweep);
  const a = at(s0), za = top(a), m = (t, u) => [lerp(a, b, t), za + (z1 - za) * u];
  const te = L - f.fin.le + f.fin.cr - 0.25;
  const curve = [[a - 0.3, za - 0.01, "c"], m(0.3, 0.08 * bulge + 0.04), m(0.62, 0.22 + 0.2 * bulge), m(0.86, 0.55 + 0.1 * bulge), [b, z1, "c"]];
  sk.smooth("fin", [...curve, [b + 0.5, z1 - 0.2, "c"], [te, top(te) + 0.08, "c"], [te, top(te) - 0.4, "c"], [a - 0.3, za - 0.4, "c"]], true, ' style="stroke:none"');
  sk.smooth("fin", curve, false, ' style="fill:none"');
};

// ---------- Piper PA-31T Cheyenne I and II ----------
// Published dimensions (Wikipedia, from Jane's 1976-77): length 10.57 m (34 ft 8 in), span 13.01 m
// over the tip tanks, height 3.89 m; propellers 2.36 m (7 ft 9 in), three blades. Stations of the
// windshield, the two cabin windows, the airstair door, nacelles, tip tanks and fin measured off the
// near side-on Commons photo "Piper PA-31T1 Cheyenne I Ursella, LUX Luxembourg (Findel), Luxembourg
// PP1267311070.jpg" (HB-LQP), scaled by the overall length; door and window row checked against
// "Piper PA-31T Cheyenne photo Don Ramey Logan.jpg". The Pressurized Navajo's fuselage with a long
// pointed nose, low wing with long PT6A nacelles and tip tanks, swept fin over a low tailplane with
// dihedral. The Cheyenne I and II share the airframe; the I has 500 shp PT6A-11s for the II's 620 shp.
F.pa31t = {
  kind: "turboprop", L0: 10.06, over: 0.51, D: 1.55, W: 1.35, fwd: 0.6, fair: 0,
  nose: {
    tip: 0.3,
    top: [[0.12, 0.43], [0.4, 0.51], [0.8, 0.57], [1.2, 0.62], [1.6, 0.68], [1.9, 0.84], [2.2, 0.95], [2.5, 0.995], [2.8, 1]],
    bot: [[0.1, 0.2], [0.3, 0.1], [0.6, 0.04], [0.95, 0.01], [1.3, 0]],
  },
  tail: {
    top: [[2.2, 1], [1.6, 0.94], [0.9, 0.82], [0, 0.66]],
    bot: [[2.9, 0], [2.2, 0.12], [1.5, 0.26], [0.8, 0.4], [0, 0.52]],
  },
  glass: [
    [[1.63, 0.69], [2.1, 0.9], [2.28, 0.92], [2.28, 0.7]],
    [[2.38, 0.66], [2.38, 0.88], [2.74, 0.88], [2.74, 0.66]],
  ],
  win: [{ z: 0.7, from: 5.02, to: 5.92, pitch: 0.9, w: 0.46, h: 0.4 }],
  wing: { le: 4.3, root: 0.68, span: 13.01, cr: 2.1, ct: 1.15, sweep: 1, dih: 6, z: 0.1, t: [0.15, 0.12] },
  nac: [0.27], eng: { kind: "prop", at: [], fwd: 1.65, drop: -0.12, len: 4.2, dia: 0.85, spinner: 0.07, tailZ: -0.6, belly: 1.0, prop: 2.36, blades: 3 },
  fin: { le: 2.0, cr: 1.9, ct: 0.85, h: 1.45, sweep: 42, rudder: 0.62 },
  stab: { le: 1.7, z: 0.6, span: 5.6, root: 0.2, cr: 1.2, ct: 0.75, sweep: 8, dih: 10 },
  extras: [dorsal(-3.2, 1.75, 0.6), door(6.9, 0.64, 0.22, 1.2)],
  overlays: [engines, stacks(1.0, 0.18), tipTank(2.5, 0.42, 0.45)],
};

// ---------- Piper PA-42 Cheyenne III, IIIA and 400 ----------
// Published dimensions (Wikipedia): length 13.23 m (43 ft 5 in), span 14.53 m (47 ft 8 in), height
// 4.50 m, or 5.18 m for the 400, whose tail was enlarged; the 400's Dowty propellers are 2.69 m
// (106 in) with four blades. Fuselage depth, nose, windshield, nacelles, tip tanks and the T-tail
// measured off the side-on Commons photo "Piper PA-42-720 Cheyenne IIIA, Alitalia Flying School
// AN0989651.jpg" (I-TREQ), scaled by the overall length; the five cabin windows and the 400's tail
// off "Piper PA-42-1000 Cheyenne 400LS Private, LUX Luxembourg (Findel), Luxembourg PP1238521046.jpg"
// (D-IUCN). A Cheyenne II stretched by about a metre, with a T-tail on a long dorsal fin.
F.pa42 = {
  kind: "turboprop", L0: 12.57, over: 0.66, D: 1.7, W: 1.4, fwd: 0.6, fair: 0,
  nose: {
    tip: 0.28,
    top: [[0.2, 0.42], [0.6, 0.5], [1.0, 0.56], [1.4, 0.62], [1.82, 0.68], [2.1, 0.83], [2.4, 0.94], [2.7, 0.99], [3.0, 1]],
    bot: [[0.12, 0.2], [0.35, 0.1], [0.7, 0.04], [1.1, 0.01], [1.5, 0]],
  },
  tail: {
    top: [[1.8, 1], [1.2, 0.95], [0.6, 0.87], [0, 0.8]],
    bot: [[2.7, 0], [2.0, 0.14], [1.3, 0.31], [0.6, 0.48], [0, 0.6]],
  },
  glass: [
    [[1.85, 0.69], [2.3, 0.9], [2.4, 0.92], [2.4, 0.7]],
    [[2.4, 0.66], [2.4, 0.88], [2.72, 0.88], [2.72, 0.66]],
  ],
  win: [{ z: 0.76, from: 5.09, to: 8.85, pitch: 0.93, w: 0.5, h: 0.38 }],
  wing: { le: 4.7, root: 0.7, span: 14.53, cr: 2.25, ct: 1.2, sweep: 1, dih: 6, z: 0.1, t: [0.15, 0.12] },
  nac: [0.24], eng: { kind: "prop", at: [], fwd: 2.0, drop: -0.14, len: 4.4, dia: 0.95, spinner: 0.07, tailZ: -0.6, belly: 1.0, prop: 2.36, blades: 3 },
  fin: { le: 1.82, cr: 1.95, ct: 1.0, h: 2.0, sweep: 33, rudder: 0.62 },
  stab: { le: 1.5, z: "T", drop: 0.05, span: 6.6, root: 0.1, cr: 1.3, ct: 0.75, sweep: 14, dih: 0, bullet: [0.9, 0.12] },
  extras: [dorsal(-4.4, 2.2, 0.5), door(9.55, 0.64, 0.24, 1.25)],
  overlays: [engines, stacks(1.05, 0.2), tipTank(3.0, 0.45, 0.6)],
};
// The 400: TPE331-14s with rear exhausts and four-blade propellers, and the taller tail.
F.pa42k = {
  ...F.pa42,
  eng: { ...F.pa42.eng, prop: 2.69, blades: 4 },
  fin: { ...F.pa42.fin, h: 2.6, cr: 2.05 },
  extras: [dorsal(-4.4, 2.2, 0.5), door(9.55, 0.64, 0.24, 1.25)],
  overlays: [engines, pipe(4.3, 0.0, 0.12), tipTank(3.0, 0.45, 0.6)],
};

export const families = F;
export const types = {
  PAY1: "pa31t", PAY2: "pa31t", PA31T: "pa31t", PAY3: "pa42", PA42: "pa42", PAY4: "pa42k",
};
