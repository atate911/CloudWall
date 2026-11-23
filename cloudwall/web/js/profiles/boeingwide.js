// Boeing and McDonnell Douglas widebodies. Format: see ../profiles.js.
const F = {};

// ---------- fittings from the ACAPs (as in boeing.js) ----------
// The radome's joint with the fuselage: a seam across the nose s metres aft of the tip, as the
// ACAP's side view draws it, run between the nose's upper and lower outlines.
const noseAt = (pts, x) => {
  for (let i = 1; i < pts.length; i++) {
    const [a, za] = pts[i - 1], [b, zb] = pts[i];
    if (x >= a && x <= b) return za + ((zb - za) * (x - a)) / (b - a);
  }
  return null;
};
const radomeJoint = (s) => ({ sk, f, D }) => {
  const zt = noseAt([[0, f.nose.tip], ...f.nose.top], s / D), zb = noseAt([[0, f.nose.tip], ...f.nose.bot], s / D);
  if (zt != null && zb != null) sk.poly("hl", [[s, zt * D - 0.06], [s, zb * D + 0.06]], false);
};
// Probes on the right side at the stations the ACAP's sensor table gives: [kind, s aft of the nose,
// z above the keel] (the tables give heights from the entry door's sill). Their size is nominal:
// pitot a short tube pointing forward from its base, aoa a vane trailing aft, port a flush static port.
const probes = (list) => ({ sk }) => {
  for (const [kind, s, z] of list) {
    if (kind === "pitot") sk.poly("strut", [[s + 0.05, z - 0.03], [s - 0.17, z - 0.013], [s - 0.17, z + 0.013], [s + 0.05, z + 0.03]]);
    else if (kind === "aoa") sk.poly("strut", [[s - 0.03, z - 0.025], [s + 0.11, z - 0.012], [s + 0.12, z + 0.035], [s + 0.02, z + 0.03]]);
    else sk.ellipse("hl", s, z, 0.05, 0.05);
  }
};
// A blade antenna on the crown s metres aft of the nose (its size is nominal).
const crownAntenna = (s) => ({ sk, top }) => {
  const z = top(s);
  sk.poly("strut", [[s - 0.16, z - 0.03], [s + 0.04, z + 0.13], [s + 0.13, z + 0.13], [s + 0.17, z - 0.03]]);
};

// ---------- Boeing 747 ----------
// Reference: 747-400 ACAP D6-58326-1 Rev F, fig. 2.3.1 (747-400 side view) and fig. 2.2.1 (plan view
// for the wing and tailplane). D is the main fuselage height aft of the upper deck; the hump is part of
// the nose outline. The tail cone ends in a tall, blunt APU exhaust. Engines: PW4056 as drawn (inboard
// inlet 23.7 m, outboard 32.4 m from the nose); the outboard pair is drawn by its own function because
// it sits at a different distance ahead of the wing and height than the inboard pair.
function quadOutboard(spec) {
  return ({ sk, sec, fan, pylon }) => {
    const q = sec(spec.at), s0 = q.le - spec.fwd, zc = q.z - spec.drop, n = { ...spec.nac };
    if (n.pylon !== false) pylon(sk, q, s0, zc, n);
    fan(sk, s0, zc, n);
  };
}
const B744_NAC = { kind: "fan", len: 7.23, dia: 2.69, fx: 0.42, cx: 0.82, pyFront: 0.3, pyLead: 0.5, pyTe: 0.4, pyAft: 0.85 };
F.b744 = {
  kind: "quad", L0: 68.45, over: 2.22, D: 7.29, W: 6.5, fwd: 0.5, fair: 0.03, fairAft: 1.2,
  nose: {
    tip: 0.466,
    top: [[0.027, 0.535], [0.069, 0.572], [0.11, 0.605], [0.151, 0.63], [0.192, 0.656], [0.233, 0.679], [0.274, 0.701], [0.316, 0.723],
      [0.357, 0.743], [0.398, 0.765], [0.48, 0.805], [0.583, 0.867, "c"], [0.686, 0.949], [0.789, 1.018], [0.892, 1.048], [0.995, 1.073],
      [1.097, 1.085], [1.2, 1.097], [1.303, 1.107], [1.406, 1.115], [1.509, 1.119], [1.65, 1.122], [2.0, 1.123], [2.4, 1.123],
      [2.743, 1.12], [2.881, 1.119], [3.018, 1.115], [3.155, 1.11], [3.292, 1.1], [3.429, 1.088], [3.567, 1.075], [3.704, 1.06],
      [3.841, 1.043], [3.95, 1.02], [4.05, 1.006], [4.2, 1.0]],
    bot: [[0.027, 0.401], [0.123, 0.324], [0.219, 0.275], [0.316, 0.232], [0.412, 0.198], [0.508, 0.167], [0.604, 0.14], [0.7, 0.118],
      [0.796, 0.1], [0.892, 0.081], [0.988, 0.066], [1.084, 0.057], [1.18, 0.048], [1.276, 0.038], [1.372, 0.029], [1.468, 0.024],
      [1.564, 0.017], [1.66, 0.013], [1.756, 0.009], [1.852, 0.004], [2.0, 0]],
  },
  tail: {
    top: [[2.5, 1], [1.5, 1.003], [0.6, 1.012], [0.25, 1.022], [0.128, 1.026], [0.062, 1.015], [0.029, 0.982], [0.011, 0.938], [0, 0.86]],
    bot: [[3.75, 0], [3.5, 0.03], [3.354, 0.038], [3.217, 0.044], [3.08, 0.053], [2.942, 0.066], [2.805, 0.096], [2.668, 0.125],
      [2.531, 0.155], [2.394, 0.185], [2.257, 0.217], [2.119, 0.244], [1.982, 0.274], [1.845, 0.303], [1.708, 0.333], [1.571, 0.364],
      [1.433, 0.395], [1.296, 0.422], [1.159, 0.453], [1.022, 0.484], [0.885, 0.514], [0.748, 0.542], [0.61, 0.573], [0.473, 0.604],
      [0.336, 0.631], [0.199, 0.663], [0.106, 0.677], [0.04, 0.708], [0.007, 0.763], [0, 0.8]],
  },
  glass: [
    [[0.767, 0.947], [0.698, 0.947], [0.604, 0.86], [0.669, 0.873], [0.718, 0.872]],
    [[0.8, 0.948], [0.763, 0.948], [0.716, 0.873], [0.8, 0.864]],
    [[0.87, 0.946], [0.81, 0.946], [0.81, 0.862], [0.87, 0.857]],
  ],
  floor: 0.368, upper: 0.759,
  doors: [[9.55, 1.07], [13.37, 2.63, "C"], [15.27, 1.06, "U"], [18.81, 1.07], [9.62, 1.07, "D", "w"], [-27.75, 1.07],
    [-23.41, 2.64, "C"], [-19.79, 1.2, "C"], [-13.38, 1.07]],
  win: [{ z: 0.513, from: 2.34, to: -14.69, pitch: 0.508, w: 0.25, h: 0.36 },
    { z: 0.882, from: 9.76, to: 21.41, pitch: 0.508, w: 0.25, h: 0.36, upper: true }],
  wing: { le: 20.97, span: 64.44, cr: 14.68, kink: [0.319, 9.54], ct: 3.6, sweep: 41.5, dih: 5.5, z: 0.226, t: [0.13, 0.08] },
  tip: { h: 1.5, sweep: 58, top: 1.2, base: 0.9, blend: 0.3 },
  ftf: [0.22, 0.38, 0.52, 0.68, 0.82],
  eng: { ...B744_NAC, at: [0.291], fwd: 4.76, drop: 2.04 },
  overlays: [quadOutboard({ at: 0.613, fwd: 4.25, drop: 1.88, nac: B744_NAC })],
  fin: { le: 13.85, cr: 11.5, ct: 4.05, h: 10.04, sweep: 49.6, fillet: [1.3, 1.1] },
  stab: { le: 9.85, z: 0.78, span: 22.17, root: 2.0, cr: 8.3, ct: 2.5, sweep: 42.7, dih: 7.5 },
};

// 747-100/-200: the same fuselage, wing and tail but the short original upper deck (the -300/-400 hump is
// 7.11 m longer; 747_123sp.pdf fig. 2.3.1 shows both), three upper-deck windows and no upper-deck door, no
// winglets (span 59.64 m), JT9D-7 nacelles.
// the upper-deck hump of the 747-400 outline, its flat top shortened (d > 0) or lengthened (d < 0) by d (D)
const hump = (top, d) => [...top.filter(([s]) => s <= 1.65), ...top.filter(([s]) => s >= 2.0).map(([s, z, fl]) => [s - d, z, fl]).filter(([s]) => s > 1.7)];
const B742_NAC = { ...B744_NAC, len: 7.0, dia: 2.5, fx: 0.48, cx: 0.85 };
F.b742 = {
  ...F.b744,
  nose: { ...F.b744.nose, top: hump(F.b744.nose.top, 0.975) },
  doors: F.b744.doors.filter((d) => d[2] !== "U"),
  win: [F.b744.win[0], { ...F.b744.win[1], from: 9.76, to: 10.8 }],
  wing: { ...F.b744.wing, span: 59.64, ct: 4.1 },
  tip: null,
  eng: { ...B742_NAC, at: [0.32], fwd: 4.76, drop: 1.98 },
  overlays: [quadOutboard({ at: 0.67, fwd: 4.25, drop: 1.82, nac: B742_NAC })],
};
// 747-8 (Intercontinental): 747-8 ACAP D6-58326-2 Rev E fig. 2.3.2 (low-resolution line art, 6.7% short in
// height, rescaled; it overlays the -400 outline well) for the stations:
// 5.6 m longer (4.1 m ahead of the wing, between doors 1 and 2, and 1.5 m behind it), the upper deck 4.1 m
// longer, a new wing with raked tips (span 68.4 m) and chevroned GEnx-2B nacelles.
const B748_NAC = { kind: "fan", len: 7.4, dia: 3.05, fx: 0.6, cx: 0.86, chev: true, pyFront: 0.3, pyLead: 0.5, pyTe: 0.4, pyAft: 0.85 };
F.b748 = {
  ...F.b744, over: 2.15, fwd: 0.728,
  nose: { ...F.b744.nose, top: hump(F.b744.nose.top, -0.562) },
  doors: [[9.55, 1.07], [13.37, 2.63, "C"], [15.27, 1.06, "U"], [22.96, 1.07], [9.62, 1.07, "D", "w"], [-27.75, 1.07],
    [-23.41, 2.64, "C"], [-19.79, 1.2, "C"], [-13.38, 1.07]],
  win: [F.b744.win[0], { ...F.b744.win[1], from: 9.76, to: 25.9 }],
  wing: { ...F.b744.wing, span: 68.4, ct: 2.6, rake: [0.885, 58, 0.35] },
  tip: null,
  eng: { ...B748_NAC, at: [0.291], fwd: 4.4, drop: 2.2 },
  overlays: [quadOutboard({ at: 0.613, fwd: 4.4, drop: 2.05, nac: B748_NAC })],
};

// 747 Dreamlifter (747-400 LCF): from published dimensions only (Wikipedia: length 71.68 m, height 21.54 m,
// fuselage width 8.38 m; lower confidence). The 747-400 nose and flight deck, then the enlarged cargo
// fuselage bulging up from just behind the cockpit and running flat to the swing tail, which carries the
// 747 fin about 2.1 m higher; the lower fuselage, wing, engines and winglets are the -400's.
F.blcf = {
  ...F.b744, fwd: 0,
  nose: {
    ...F.b744.nose,
    top: [...F.b744.nose.top.filter(([s]) => s <= 0.892), [1.0, 1.1], [1.15, 1.22], [1.35, 1.33], [1.6, 1.39], [1.9, 1.42], [2.3, 1.435], [2.6, 1.44]],
  },
  tail: {
    ...F.b744.tail,
    top: [[3.4, 1.44], [2.8, 1.42], [2.3, 1.38], [1.9, 1.33], [1.5, 1.27], [1.1, 1.19], [0.75, 1.11], [0.45, 1.04], [0.2, 0.97], [0.07, 0.92], [0, 0.86]],
  },
  doors: [[9.55, 1.07], [13.37, 2.63, "C"], [-23.41, 2.64, "C"], [-19.79, 1.2, "C"]],
  win: [],
  fin: { ...F.b744.fin, h: 12.17 },
};

// ---------- Boeing 767 ----------
// Reference: 767 ACAP D6-58328 Rev K, fig. 2.3.2 (767-300/-300ER ground clearances side view,
// to scale) and fig. 2.2.2 (plan view, for the wing and tailplane planforms). The drawing is
// about 3.7% taller than the published 5.41 m fuselage height, so heights were rescaled to it.
F.b763 = {
  kind: "wide", L0: 53.6, over: 1.34, D: 5.41, W: 5.03, fwd: 0.48, fair: 0,
  nose: {
    tip: 0.413,
    top: [[0.037, 0.48], [0.074, 0.52], [0.111, 0.55], [0.148, 0.58], [0.185, 0.603], [0.245, 0.632, "c"], [0.27, 0.665], [0.296, 0.70],
      [0.379, 0.775], [0.462, 0.818], [0.545, 0.855], [0.628, 0.888], [0.712, 0.916], [0.795, 0.938], [0.878, 0.96], [0.961, 0.976],
      [1.044, 0.989], [1.128, 0.997], [1.21, 1]],
    bot: [[0.037, 0.35], [0.12, 0.285], [0.203, 0.244], [0.287, 0.207], [0.37, 0.181], [0.453, 0.152], [0.536, 0.124], [0.619, 0.1],
      [0.702, 0.081], [0.786, 0.06], [0.869, 0.044], [0.952, 0.03], [1.035, 0.017], [1.118, 0.011], [1.2, 0.006], [1.3, 0]],
  },
  tail: {
    top: [[2.05, 1], [1.867, 0.996], [1.775, 0.99], [1.59, 0.974], [1.405, 0.955], [1.22, 0.935], [1.035, 0.913], [0.85, 0.889],
      [0.665, 0.861], [0.48, 0.834], [0.35, 0.81], [0.203, 0.776], [0.055, 0.74], [0, 0.71]],
    bot: [[2.7, 0], [2.57, 0.011], [2.44, 0.028], [2.31, 0.05], [2.18, 0.078], [2.05, 0.107], [1.92, 0.137], [1.79, 0.168], [1.66, 0.194],
      [1.53, 0.222], [1.4, 0.248], [1.275, 0.277], [1.146, 0.301], [1.017, 0.331], [0.887, 0.359], [0.758, 0.384], [0.628, 0.412],
      [0.499, 0.442], [0.37, 0.47], [0.24, 0.495], [0.111, 0.521], [0.04, 0.545], [0, 0.565]],
  },
  glass: [
    [[0.392, 0.706], [0.318, 0.72], [0.26, 0.618], [0.355, 0.608]],
    [[0.474, 0.711], [0.394, 0.702], [0.366, 0.608], [0.452, 0.575]],
    [[0.563, 0.708], [0.484, 0.713], [0.458, 0.575], [0.572, 0.6]],
  ],
  floor: 0.405,
  doors: [[5.62, 1.0], [12.33, 1.83, "C"], [16.6, 0.96], [3.1, 0.62, "E", "w"], [3.93, 0.62, "E", "w"], [-16.31, 1.84, "C"], [-13.04, 0.94, "C"], [-11.02, 0.98]],
  win: [{ z: 0.6, from: 6.6, to: -11.7, pitch: 0.508, w: 0.26, h: 0.38 }],
  wing: { le: 19.0, span: 47.57, cr: 10.3, kink: [0.305, 6.86], ct: 2.29, sweep: 34.5, dih: 5, z: 0.324, t: [0.15, 0.1] },
  ftf: [0.3, 0.48, 0.66, 0.82],
  eng: { kind: "fan", at: [0.254], fwd: 3.88, drop: 1.76, len: 6.6, dia: 2.54, fx: 0.495, cx: 0.935, pyFront: 0.25, pyLead: 0.5, pyTe: 0.7, pyAft: 1.3 },
  fin: { le: 9.52, cr: 7.07, ct: 2.56, h: 8.43, sweep: 44.35, fillet: [1.78, 1.95], round: 0.6 },
  stab: { le: 7.5, z: 0.623, span: 18.62, root: 1.0, cr: 6.07, ct: 1.75, sweep: 37.8, dih: 7 },
  // the radome joint 1.12 m aft of the nose (fig. 2.3.2), and the right-side sensors of fig. 2.7.2:
  // pitot-static probes 2.74 m aft of the nose, 0.30 m above and 0.15 m below the entry door's sill
  // (2.24 m above the keel), the angle-of-attack vane 2.51 m aft and 0.05 m below it, and the flush
  // static port 9.45 m aft and 1.52 m below it
  extras: [radomeJoint(1.12), probes([["pitot", 2.74, 2.54], ["pitot", 2.74, 2.09], ["aoa", 2.51, 2.19], ["port", 9.45, 0.72]])],
};

// 767-200/-200ER: fig. 2.3.1 overlays the -300 outline at its own length; one pair of overwing exits, no L2
const B762_DOORS = [[5.62, 1.0], [12.33, 1.83, "C"], [3.89, 0.62, "E", "w"], [-16.31, 1.84, "C"], [-13.04, 0.94, "C"], [-11.02, 0.98]];
// 767-400ER: fig. 2.3.4 and 2.2.4. Longer tail cone, raked tips (span 51.92 m), L2 door ahead of the wing,
// a single overwing exit.
F.b764 = {
  ...F.b763, L0: 60.55, over: 0.82,
  doors: [[5.74, 1.0], [12.51, 1.84, "C"], [18.99, 0.97], [4.2, 0.58, "E", "w"], [-16.57, 1.84, "C"], [-13.25, 0.93, "C"], [-10.95, 0.98]],
  wing: { ...F.b763.wing, le: 22.15, span: 51.92, kink: [0.276, 6.86], ct: 1.74, rake: [0.882, 55, 0.25] },
  fin: { ...F.b763.fin, le: 9.71 },
  stab: { ...F.b763.stab, le: 7.7 },
};

// Most passenger 767-300ERs (United, Delta and many others) fly with the Aviation Partners blended
// winglet, 3.4 m tall and canted out (about 3 m of it shows from the side); B763 is drawn with it.
F.b763w = { ...F.b763, tip: { h: 2.9, sweep: 48, top: 0.6, base: 0.95, blend: 1.0 } };

// KC-46A Pegasus (767-2C): 767-200 fuselage (fig. 2.3.1 outline), no cabin windows, no winglets (span
// 48.1 m, Wikipedia); refuelling boom stowed under the tail cone and wing refuelling pods (WARPs). Its
// 767-300F main-deck cargo door is on the left side, so it does not show in this starboard view.
// Overall length 50.5 m (Wikipedia) includes the stowed boom, 3.3 m behind the tail cone.
function kc46Boom({ sk, L, D, top }) {
  const E = L;
  // boom pivot fairing under the aft fuselage, and the stowed boom with its ruddevators
  sk.smooth("pyl", [[E - 8.2, 0.28 * D], [E - 6.6, 0.18 * D], [E - 4.6, 0.33 * D], [E - 4.0, 0.5 * D, "c"], [E - 6.4, 0.42 * D]]);
  sk.poly("strut", [[E - 6.8, 1.42], [E + 3.35, 2.78], [E + 3.35, 3.02], [E - 6.8, 1.82]]);
  sk.poly("strut", [[E + 1.2, 2.4], [E + 3.6, 2.72], [E + 3.6, 2.98], [E + 1.2, 2.78]]);
  sk.poly("stab", [[E - 0.9, 2.2], [E + 0.6, 1.25], [E + 1.15, 1.25], [E + 0.9, 2.36]]);
}
function warp({ sk, sec, lower }) {
  const q = sec(0.8), s0 = q.le - 0.9, zc = lower(q, 0.3) - 0.75;
  sk.poly("pyl", [[s0 + 1.2, zc + 0.3], [q.le + 0.1 * q.c, lower(q, 0.1) + 0.05], [q.le + 0.6 * q.c, lower(q, 0.6) + 0.05], [s0 + 2.6, zc + 0.3]]);
  sk.smooth("nac", [[s0, zc, "c"], [s0 + 0.5, zc + 0.3], [s0 + 1.4, zc + 0.38], [s0 + 2.7, zc + 0.36], [s0 + 3.4, zc + 0.15, "c"], [s0 + 3.4, zc - 0.15, "c"],
    [s0 + 2.7, zc - 0.36], [s0 + 1.4, zc - 0.38], [s0 + 0.5, zc - 0.3]]);
  sk.ellipse("disc", s0 - 0.05, zc, 0.05, 0.42);
}
F.k46 = {
  ...F.b763, over: 3.34,
  doors: [[5.62, 1.0], [3.89, 0.62, "E", "w"], [-11.02, 0.98]],
  win: [],
  wing: { ...F.b763.wing, span: 48.1 },
  overlays: [kc46Boom, warp],
};

// ---------- Boeing 777 ----------
// Reference: 777-200LR/-300ER/F ACAP D6-58329-2 Rev G, fig. 2.3.2 (777-300ER side view) and fig. 2.2.2
// (plan view for the wing and tailplane planforms). Fuselage 6.20 m round; tail cone ends in the flat-ended
// "blade" APU exhaust (tail-cone end 73.08 m from the nose in fig. 2.2.2). Raked tips; GE90-115B.
F.b77w = {
  kind: "wide", L0: 72.89, over: 0.97, D: 6.2, W: 6.2, fwd: 0.5, fair: 0.06, fairAft: 1.3,
  nose: {
    tip: 0.405,
    top: [[0.032, 0.473], [0.073, 0.51], [0.113, 0.54], [0.153, 0.563], [0.168, 0.572, "c"], [0.194, 0.594], [0.234, 0.631], [0.274, 0.665],
      [0.315, 0.698], [0.355, 0.726], [0.419, 0.76], [0.516, 0.802], [0.613, 0.835], [0.71, 0.865], [0.806, 0.892], [0.903, 0.911],
      [1.0, 0.934], [1.097, 0.948], [1.194, 0.963], [1.29, 0.979], [1.387, 0.99], [1.484, 0.997], [1.58, 1]],
    bot: [[0.032, 0.332], [0.129, 0.261], [0.226, 0.219], [0.323, 0.185], [0.419, 0.155], [0.516, 0.126], [0.613, 0.103], [0.71, 0.079],
      [0.806, 0.061], [0.903, 0.045], [1.0, 0.031], [1.097, 0.019], [1.194, 0.011], [1.29, 0.005], [1.4, 0]],
  },
  tail: {
    top: [[2.24, 1], [2.079, 0.987], [1.918, 0.985], [1.756, 0.977], [1.595, 0.968], [1.434, 0.952], [1.273, 0.932], [1.111, 0.913],
      [0.95, 0.895], [0.789, 0.875], [0.627, 0.856], [0.466, 0.837], [0.305, 0.817], [0, 0.797]],
    bot: [[3.0, 0], [2.8, 0.023], [2.67, 0.039], [2.54, 0.056], [2.41, 0.073], [2.28, 0.09], [2.15, 0.115], [2.02, 0.144], [1.89, 0.174],
      [1.76, 0.2], [1.63, 0.231], [1.5, 0.261], [1.37, 0.287], [1.24, 0.318], [1.11, 0.344], [0.98, 0.374], [0.85, 0.405], [0.72, 0.431],
      [0.59, 0.461], [0.46, 0.492], [0.33, 0.518], [0.2, 0.548], [0.08, 0.579], [0, 0.59]],
  },
  glass: [
    [[0.338, 0.664], [0.278, 0.661], [0.218, 0.586], [0.296, 0.579]],
    [[0.413, 0.664], [0.336, 0.664], [0.305, 0.575], [0.389, 0.555]],
    [[0.494, 0.661], [0.419, 0.661], [0.416, 0.56], [0.488, 0.565]],
  ],
  floor: 0.395,
  doors: [[6.79, 1.07], [11.9, 2.8, "C"], [17.15, 1.07], [5.86, 1.07, "D", "w"], [-26.53, 1.07], [-21.46, 1.83, "C"], [-16.42, 0.95, "C"], [-13.22, 1.07]],
  win: [{ z: 0.569, from: 8.165, to: -14.57, pitch: 0.562, w: 0.27, h: 0.4 }],
  wing: { le: 27.04, span: 64.8, cr: 13.07, kink: [0.2, 9.08], ct: 1.52, sweep: 34.3, dih: 5, z: 0.387, t: [0.14, 0.1], rake: [0.952, 60, 0.3] },
  ftf: [0.25, 0.42, 0.58, 0.73, 0.86],
  eng: { kind: "fan", at: [0.222], fwd: 5.89, drop: 2.6, len: 7.8, dia: 3.66, fx: 0.667, cx: 0.846, pyFront: 0.35, pyLead: 0.6, pyTe: 0.6, pyAft: 1.05 },
  fin: { le: 11.81, cr: 7.99, ct: 2.55, h: 9.77, sweep: 44.4, fillet: [1.78, 0.95], round: 1.0 },
  stab: { le: 9.14, z: 0.64, span: 21.53, root: 1.3, cr: 6.5, ct: 2.1, sweep: 39, dih: 7.2 },
  // the radome joint about 1.1 m aft of the nose, as fig. 2.3.2 draws it
  extras: [radomeJoint(1.1)],
};

// 777-200/-200ER/-300 ACAP D6-58329 Rev E fig. 2.2.1 (777-200): the same fuselage, the original wing
// (60.93 m, plain tips) and the smaller GE90-94B/PW4090/Trent 800 nacelles; four door pairs.
const B772_DOORS = [[6.79, 1.07], [11.9, 2.8, "C"], [17.15, 1.07], [5.86, 1.07, "D", "w"], [-21.46, 1.83, "C"], [-16.42, 0.95, "C"], [-13.22, 1.07]];
F.b772 = {
  ...F.b77w, doors: B772_DOORS,
  wing: { ...F.b77w.wing, span: 60.93, ct: 2.3, rake: null },
  eng: { ...F.b77w.eng, len: 7.5, dia: 3.55, drop: 2.58 },
};

// 777-9: 777X ACAP D6-86073 Rev G, fig. 2-2 (side view, levelled; drawn with the tips folded) and
// fig. 2-1 (plan, tips extended: span 71.76 m); door stations from table 2-3. Same nose and blade tail
// cone, 2.9 m longer, taller fin, bigger tailplane, the new composite wing (drawn with its folding tips
// extended, as in flight) and the much larger GE9X.
F.b779 = {
  ...F.b77w, L0: 75.0, over: 1.73,
  doors: [[6.76, 1.07], [11.81, 2.69, "C"], [23.47, 1.07], [-32.28, 1.07], [-24.94, 0.86], [-21.48, 1.78, "C"], [-16.4, 0.91, "C"], [-13.2, 1.07]],
  win: [{ z: 0.583, from: 8.4, to: -14.52, pitch: 0.56, w: 0.29, h: 0.46 }],
  wing: { le: 27.1, span: 71.76, cr: 14.0, kink: [0.287, 8.57], ct: 1.8, sweep: 32.7, dih: 5, z: 0.4, t: [0.13, 0.1], rake: [0.912, 52, 0.33] },
  ftf: [0.27, 0.42, 0.57, 0.71, 0.84],
  eng: { kind: "fan", at: [0.23], fwd: 5.88, drop: 2.44, len: 9.65, dia: 4.4, fx: 0.69, cx: 0.865, pyFront: 0.35, pyLead: 0.6, pyTe: 0.55, pyAft: 1.0 },
  fin: { le: 12.3, cr: 8.55, ct: 2.78, h: 10.4, sweep: 44.7, fillet: [1.5, 1.3], round: 1.0 },
  stab: { le: 9.6, z: 0.645, span: 24.56, root: 1.3, cr: 7.0, ct: 2.35, sweep: 38.9, dih: 6.9 },
};

// ---------- Boeing 787 ----------
// Reference: 787 ACAP D6-58333 Rev Q, fig. 2.3.2 (787-9 side view; scanned line art, dimension lines
// removed), fig. 2.2.2 (plan view: wing, raked tip, tailplane) and the door-location table 2.7.1, which
// also places the -8 and -10 doors. Smooth nose with no eyebrow windows: a big windscreen pane and a
// side window swept back at its rear; tall cabin windows; raked tips; chevroned GEnx/Trent 1000.
// The ACAP shows the wing on the ground (tip about 5.5 m above the keel); in flight it bends up a lot
// more, so "bend" adds a moderate 1.5 m of tip rise.
F.b787 = {
  kind: "wide", L0: 61.88, over: 0.93, D: 5.945, W: 5.77, fwd: 0.5, fair: 0.03, fairAft: 1.2,
  nose: {
    tip: 0.287,
    top: [[0.017, 0.347], [0.05, 0.397], [0.084, 0.429], [0.118, 0.463], [0.151, 0.496], [0.185, 0.528], [0.219, 0.557], [0.252, 0.584],
      [0.286, 0.611], [0.32, 0.639], [0.404, 0.71], [0.505, 0.777], [0.606, 0.826], [0.706, 0.86], [0.807, 0.892], [0.908, 0.913],
      [1.009, 0.935], [1.11, 0.952], [1.211, 0.969], [1.312, 0.982], [1.413, 0.993], [1.55, 1]],
    bot: [[0.017, 0.237], [0.101, 0.177], [0.185, 0.138], [0.269, 0.111], [0.353, 0.094], [0.437, 0.077], [0.521, 0.061], [0.606, 0.05],
      [0.69, 0.039], [0.774, 0.03], [0.858, 0.021], [0.942, 0.014], [1.026, 0.01], [1.11, 0.007], [1.2, 0.004], [1.36, 0]],
  },
  tail: {
    top: [[2.671, 1], [2.503, 0.996], [2.335, 0.991], [2.167, 0.986], [1.998, 0.976], [1.83, 0.968], [1.662, 0.952], [1.494, 0.935],
      [1.326, 0.92], [1.157, 0.898], [0.989, 0.87], [0.821, 0.843], [0.653, 0.815], [0.484, 0.781], [0.316, 0.743], [0.148, 0.705], [0, 0.671]],
    bot: [[2.84, 0], [2.671, 0.007], [2.503, 0.024], [2.335, 0.045], [2.167, 0.072], [1.998, 0.099], [1.83, 0.133], [1.662, 0.16],
      [1.494, 0.193], [1.326, 0.232], [1.157, 0.271], [0.989, 0.31], [0.821, 0.353], [0.653, 0.397], [0.484, 0.447], [0.316, 0.491],
      [0.148, 0.545], [0, 0.584]],
  },
  glass: [
    [[0.468, 0.688], [0.37, 0.69], [0.237, 0.567], [0.356, 0.564]],
    [[0.586, 0.618, ""], [0.556, 0.686, ""], [0.478, 0.687], [0.373, 0.567], [0.52, 0.551, ""]],
  ],
  frame: 0.05,
  floor: 0.429,
  doors: [[6.3, 1.07], [11.0, 2.75, "C"], [-3.39, 1.07, "D", "w"], [13.68, 1.07, "D", "w"], [-18.57, 2.75, "C"], [-12.22, 1.07]],
  win: [{ z: 0.628, from: 8.28, to: -13.93, pitch: 0.606, w: 0.28, h: 0.48 }],
  wing: { le: 21.75, span: 60.12, cr: 11.87, kink: [0.317, 6.6], ct: 1.54, sweep: 34.7, dih: 6.5, z: 0.37, t: [0.13, 0.09], rake: [0.869, 52, 0.35], bend: 1.5 },
  ftf: [0.3, 0.46, 0.62, 0.77],
  eng: { kind: "fan", at: [0.258], fwd: 5.81, drop: 2.17, len: 7.8, dia: 3.8, fx: 0.71, cx: 0.92, chev: true, pyFront: 0.4, pyLead: 0.5, pyTe: 0.55, pyAft: 1.0 },
  fin: { le: 11.03, cr: 7.21, ct: 2.37, h: 8.51, sweep: 44.7, fillet: [1.25, 1.25], round: 1.3 },
  stab: { le: 8.1, z: 0.62, span: 19.81, root: 1.3, cr: 5.68, ct: 1.6, sweep: 40.3, dih: 7 },
  // the terminal wireless LAN unit's antenna on the crown centreline, 7.1 m aft of the nose on the
  // -8, -9 and -10 (ground servicing tables 5.4.2-5.4.6)
  extras: [crownAntenna(7.1)],
};
// 787-10: 5.48 m longer than the -9, 3.05 m of it ahead of the wing; aft cargo door moves with the wing
F.b78x = { ...F.b787, fwd: 0.556, doors: [[6.3, 1.07], [11.0, 2.75, "C"], [-3.39, 1.07, "D", "w"], [13.68, 1.07, "D", "w"], [21.56, 2.75, "C", "w"], [-12.22, 1.07]] };

// ---------- McDonnell Douglas MD-11, DC-10, KC-10 ----------
// Reference: MD-11 ACAP (MD11.pdf, scanned) fig. 2.2 general dimensions, side view rotated and cleaned of
// dimension lines; plan view for the wing (root LE 24.2 m, engine inlet 23.1 m) and tailplane (span 18.0 m).
// The centre engine runs through the fin root: the fin stands on the engine nacelle (fin.base). MD-11:
// winglets with a small lower blade, the small tailplane, longer fuselage and tail cone than the DC-10.
// The centre engine's nozzle and exhaust cone reach behind the tail cone; the renderer fairs a tail
// engine down to the fuselage over its whole length, so the nacelle stops at the tail-cone end and the
// rest is drawn here.
function tailNozzle(noz, tip) {
  return ({ sk, f, L, D }) => {
    const e = f.tailEng, R = e.dia / 2, zc = D + e.z;
    sk.smooth("nac", [[L - 0.3, zc + 0.66 * R, "c"], [L + noz, zc + 0.56 * R, "c"], [L + noz, zc - 0.56 * R, "c"], [L - 0.3, zc - 0.66 * R, "c"]]);
    sk.poly("plug", [[L + noz, zc + 0.4 * R], [L + tip, zc + 0.04 * R], [L + tip, zc - 0.04 * R], [L + noz, zc - 0.4 * R]]);
  };
}
F.md11 = {
  kind: "wide", L0: 58.4, over: 3.2, D: 6.06, W: 6.02, fwd: 0.54, fair: 0.02, fairAft: 1.3,
  nose: {
    tip: 0.465,
    top: [[0.017, 0.526], [0.058, 0.574], [0.099, 0.606], [0.14, 0.629], [0.182, 0.653], [0.223, 0.688], [0.264, 0.724], [0.305, 0.761],
      [0.347, 0.785], [0.429, 0.833], [0.545, 0.875], [0.66, 0.904], [0.776, 0.929], [0.891, 0.947], [1.007, 0.961], [1.122, 0.976],
      [1.238, 0.987], [1.353, 0.995], [1.469, 1]],
    bot: [[0.017, 0.401], [0.116, 0.322], [0.215, 0.287], [0.314, 0.257], [0.413, 0.226], [0.512, 0.203], [0.611, 0.178], [0.71, 0.16],
      [0.809, 0.137], [0.908, 0.119], [1.007, 0.107], [1.106, 0.096], [1.205, 0.083], [1.304, 0.071], [1.403, 0.062], [1.502, 0.054],
      [1.65, 0.045], [1.815, 0.035], [1.98, 0.024], [2.145, 0.016], [2.31, 0.009], [2.475, 0.004], [2.7, 0]],
  },
  tail: {
    top: [[2.7, 1], [2.376, 0.99], [2.046, 0.97], [1.716, 0.955], [1.386, 0.937], [1.056, 0.916], [0.726, 0.898], [0.561, 0.889],
      [0.396, 0.886], [0.231, 0.884], [0.066, 0.88], [0, 0.875]],
    bot: [[2.75, 0], [2.64, 0.005], [2.44, 0.01], [2.244, 0.023], [2.046, 0.041], [1.848, 0.071], [1.65, 0.118], [1.452, 0.166],
      [1.254, 0.219], [1.056, 0.28], [0.858, 0.34], [0.66, 0.394], [0.462, 0.453], [0.264, 0.508], [0.066, 0.567], [0, 0.58]],
  },
  glass: [
    [[0.32, 0.765], [0.168, 0.646], [0.327, 0.638]],
    [[0.471, 0.752], [0.369, 0.752], [0.331, 0.643], [0.438, 0.591]],
    [[0.598, 0.752], [0.474, 0.752], [0.444, 0.588], [0.604, 0.581]],
  ],
  floor: 0.437,
  doors: [[5.24, 1.07], [10.6, 2.6, "C"], [14.66, 1.07], [4.29, 1.07, "D", "w"], [-15.6, 1.8, "C"], [-11.44, 1.07]],
  win: [{ z: 0.596, from: 6.5, to: -13.28, pitch: 0.508, w: 0.25, h: 0.38 }],
  wing: { le: 24.2, span: 50.4, cr: 9.9, kink: [0.272, 6.5], ct: 2.3, sweep: 39, dih: 4.5, z: 0.2, t: [0.13, 0.1] },
  tip: { h: 2.0, sweep: 45, top: 0.7, base: 0.9, lo: 0.7, loSweep: 30, loTip: 0.3 },
  ftf: [0.28, 0.45, 0.62, 0.78],
  eng: { kind: "fan", at: [0.242], fwd: 5.71, drop: 1.4, len: 7.5, dia: 3.0, fx: 0.49, cx: 0.83, pyFront: 0.3, pyLead: 0.5, pyTe: 0.55, pyAft: 0.95 },
  tailEng: { s: 11.4, z: 1.59, len: 11.4, dia: 3.27, style: "long", fx: 1, plug: 0.4 },
  overlays: [tailNozzle(1.5, 3.2)],
  fin: { le: 8.0, base: 3.23, cr: 6.6, ct: 3.3, h: 9.63, sweep: 44, round: 0.4 },
  stab: { le: 7.95, z: 0.63, span: 18.0, root: 1.0, cr: 5.5, ct: 1.7, sweep: 40.8, dih: 8 },
};
// DC-10-30 (DC10.pdf fig. 2.2 dimensions; drawn over a dense grid, so mostly from the MD-11 outline and the
// published dimensions: lower confidence). Fuselage 51.97 m to the tail cone, 5.7 m shorter than the MD-11,
// plain wingtips (span 50.39 m), the bigger tailplane (span 21.69 m), CF6-50 engines.
F.dc10 = {
  ...F.md11, L0: 51.97, over: 3.53,
  doors: [[5.24, 1.07], [10.6, 2.6, "C"], [12.2, 1.07], [4.29, 1.07, "D", "w"], [-14.4, 1.8, "C"], [-11.0, 1.07]],
  win: [{ z: 0.596, from: 6.5, to: -12.8, pitch: 0.508, w: 0.25, h: 0.38 }],
  wing: { ...F.md11.wing, span: 50.39, ct: 2.5 },
  tip: null,
  stab: { le: 8.6, z: 0.63, span: 21.69, root: 1.0, cr: 6.6, ct: 2.0, sweep: 40, dih: 8 },
  tailEng: { s: 11.6, z: 1.59, len: 11.6, dia: 3.2, style: "long", fx: 1, plug: 0.4 },
  overlays: [tailNozzle(1.3, 3.0)],
};
// KC-10A Extender: a DC-10-30 freighter airframe with the main-deck cargo door on the left (not seen
// from this side), no cabin windows, the boom operator's fairing under the tail and the stowed boom.
function kc10Boom({ sk, L, D }) {
  const E = L;
  sk.smooth("pyl", [[E - 9.6, 0.36 * D], [E - 7.6, 0.25 * D], [E - 4.0, 0.39 * D], [E - 3.2, 0.5 * D, "c"], [E - 7.0, 0.5 * D]]);
  sk.poly("strut", [[E - 7.4, 1.5], [E + 1.6, 2.7], [E + 1.6, 2.98], [E - 7.4, 1.9]]);
  sk.poly("stab", [[E - 1.6, 2.1], [E - 0.2, 1.2], [E + 0.3, 1.2], [E + 0.15, 2.3]]);
}
F.kc10 = { ...F.dc10, doors: [[5.24, 1.07], [10.6, 2.6, "C"], [-14.4, 1.8, "C"]], win: [], overlays: [tailNozzle(1.3, 3.0), kc10Boom] };

export const families = F;
export const types = {
  B741: "b742", B742: "b742", B744: "b744", B748: "b748", BLCF: "blcf", MD11: "md11", DC10: "dc10", KC10: "kc10", B762: ["b763", { doors: B762_DOORS }], B763: "b763w", K46: "k46", B772: "b772", B77L: ["b77w", { doors: B772_DOORS }], B77W: "b77w", B779: "b779", B788: "b787", B789: "b787", B78X: "b78x", B773: ["b77w", { wing: { ...F.b772.wing }, eng: F.b772.eng }], B764: "b764",
};
