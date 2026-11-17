// Boeing and McDonnell Douglas single-aisle airliners. Format: see ../profiles.js.
const F = {};

// ---------- helpers ----------

// Upper outline of the wing as seen from the side at station s (the union of its sections).
function wingTop(sec, upper, s) {
  let m = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = sec(i / 100), x = (s - p.le) / p.c;
    if (x >= 0 && x <= 1) m = Math.max(m, upper(p, x));
  }
  return m;
}

// Blended winglet (Aviation Partners, 737NG and 757): drawn as an overlay so that its leading
// edge can run into the wing's in a long curve. Offsets are metres from the tip section's
// leading edge (ds) and from its upper surface (dz): root = where the blend leaves the wing's
// leading edge, le = blend points, top = [leading, trailing edge] at the top, h = height,
// te = trailing-edge points down to the wing's trailing edge.
const blendedWinglet = (t) => ({ sk, sec, upper }) => {
  const q = sec(1), z = upper(q, 0.3), s0 = q.le, a = s0 + t.root, za = wingTop(sec, upper, a);
  const [tl, tt] = t.top, zt = z + t.h;
  const edge = [[a, za - 0.01, "c"], ...t.le.map(([ds, dz], i, l) => [s0 + ds, z + dz, i === l.length - 1 ? "l" : ""]),
    [s0 + tl - 0.06, zt - 0.14], [s0 + tl + 0.14, zt, "l"], [s0 + tt, zt, "c"],
    ...t.te.map(([ds, dz], i, l) => [s0 + ds, z + dz, i === l.length - 1 ? "c" : ""])];
  const end = edge[edge.length - 1];
  sk.smooth("wl", [...edge, [end[0] - 0.15, end[1] - 0.12, "c"], [a + 0.3, za - 0.1, "c"]], true, ' style="stroke:none"');
  sk.smooth("wl", edge, false, ' style="fill:none"');
};

// A door drawn to its own height (the renderer's doors have fixed heights per kind):
// [s (< 0 from the tail-cone end), width, sill height above the keel, height], all metres.
const plugDoor = (s, w, z0, h) => ({ sk, at }) => {
  const [x, y] = sk.xy(at(s) + w / 2, z0 + h);
  sk.out.push(`<rect class="door" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h}" rx="0.2"/>`);
};

// ---------- Boeing 737 NG and MAX ----------
// References: 737NG ACAP D6-58325-7 Rev C, fig. 2.2.5 (737-800) for the fuselage, nose, tail cone,
// wing and CFM56-7 nacelle; fig. 2.2.6 (737-800W) and table 2.3.3 for the blended winglet;
// 737 MAX ACAP D6-38A004 Rev K, figs. 2.2.1-2.2.4 (737-7/-8/-9/-10) for the fin and stabilizer,
// and its door-location table 2.7.1 for all door and exit stations (the NG shares the MAX cabin).
// The NG side view is not drawn to one scale: at the scale that fits its own dimensioned tail-cone
// station (38.02 m) and wheelbase it puts the stabilizer tip 0.3 m short of the 39.47 m overall
// length and the fin tip 7.8 m above the crown, where the NG's ground-clearance table (2.3.2:
// fuselage top 5.56 m, fin 12.62 m) and the MAX drawing both give 7.0 m. NG and MAX share the
// vertical tail, so both use the MAX drawing's fin and stabilizer at the same station. The NG tail
// cone ends 1.45 m ahead of the stabilizer tip, the MAX's reshaped cone 0.55 m.
const B737_NOSE = {
  tip: 0.377,
  top: [[0.1, 0.506], [0.2, 0.561], [0.3, 0.606], [0.4, 0.666], [0.5, 0.753], [0.6, 0.803], [0.7, 0.845], [0.8, 0.87],
    [0.9, 0.895], [1.0, 0.913], [1.1, 0.938], [1.2, 0.958], [1.3, 0.97], [1.4, 0.976], [1.6, 0.989], [1.8, 1]],
  bot: [[0.1, 0.277], [0.2, 0.202], [0.3, 0.16], [0.4, 0.122], [0.5, 0.092], [0.6, 0.06], [0.7, 0.035], [0.9, 0.012], [1.1, 0]],
};
const B737_GLASS = [
  [[0.326, 0.609], [0.417, 0.703], [0.505, 0.711], [0.456, 0.602]],
  [[0.505, 0.711], [0.583, 0.703], [0.568, 0.56], [0.456, 0.602]],
  [[0.583, 0.703], [0.695, 0.693], [0.76, 0.661], [0.568, 0.56]],
];
// fin root leading edge (on the crown) at 31.64 m from the nose on the -800 and -8
const B737_FIN = { cr: 5.45, ct: 1.56, h: 6.97, sweep: 40, fillet: [3.04, 1.3, "l"], cap: 0.1 };
// stabilizer root leading edge 34.35 m from the nose (34.52 m at the side of the tail cone in plan)
const B737_STAB = { z: 0.8, span: 14.35, root: 0.8, cr: 3.5, ct: 0.8, sweep: 34.5, dih: 7 };
// starboard doors, from the MAX door-location table: service door 1 at 4.67 m, forward cargo
// 8.53 m, overwing exits 1.81/2.78 m behind the wing root leading edge (16.71/17.68 m on the -800
// and -8), aft cargo 3.91 m ahead of service door 2.
const ngDoors = (exits, aft = -6.14, cargo = 8.53) => [[4.67, 0.86], [cargo, 1.24, "C"], ...exits.map((e) => [e, 0.51, "E", "w"]),
  [aft - 3.91, 1.24, "C"], [aft, 0.79]];
F.b737ng = {
  kind: "narrow", L0: 38.02, over: 1.45, D: 4.01, W: 3.76, fwd: 0.55, fair: 0.03,
  nose: B737_NOSE,
  tail: {
    top: [[1.52, 1], [0.61, 0.98], [0.3, 0.94], [0, 0.845]],
    bot: [[2.9, 0], [2.65, 0.03], [2.4, 0.057], [2.15, 0.09], [1.89, 0.132], [1.64, 0.182], [1.39, 0.237], [1.13, 0.3],
      [0.88, 0.369], [0.63, 0.446], [0.37, 0.526], [0.127, 0.621], [0, 0.678]],
  },
  glass: B737_GLASS,
  floor: 0.352,
  doors: ngDoors([1.81, 2.78]),
  win: [{ z: 0.62, from: 6.13, to: -8.14, pitch: 0.508, w: 0.25, h: 0.34 }],
  wing: { le: 14.9, root: 2.0, span: 34.32, cr: 7.3, kink: [0.26, 5.1], ct: 1.25, sweep: 29, dih: 5.5, z: 0.17, t: [0.15, 0.1] },
  ftf: [0.27, 0.45, 0.62],
  eng: { kind: "fan", at: [0.187], fwd: 3.07, drop: 0.44, len: 4.74, dia: 1.95, style: "flat", fx: 0.66, cx: 0.83, pylon: false },
  fin: { le: 38.02 - 31.64, ...B737_FIN },
  stab: { le: 38.02 - 34.35, ...B737_STAB },
};
// Blended winglet (737-700W/-800W/-900ERW), from fig. 2.2.6 and table 2.3.3: top 1.2 m above the
// crown (winglet tip 6.76 m, fuselage top 5.56 m above the ground), 2.44 m of blade above its blend.
F.b737ngw = {
  ...F.b737ng,
  overlays: [blendedWinglet({ root: -1.9, h: 3.0, top: [2.0, 2.6],
    le: [[-1.3, 0.08], [-0.32, 0.48], [0.93, 1.28]], te: [[1.73, 1.28], [1.35, 0.35], [1.25, -0.02]] })],
};
F.b737max = {
  ...F.b737ng, L0: 38.92, over: 0.55, fwd: 0.58,
  tail: {
    top: [[1.5, 1], [0.6, 0.985], [0.42, 0.945], [0, 0.868]],
    bot: [[2.85, 0], [2.47, 0.047], [2.22, 0.092], [1.98, 0.142], [1.73, 0.19], [1.48, 0.252], [0.98, 0.394], [0.73, 0.474], [0.48, 0.556], [0.23, 0.648], [0, 0.76]],
  },
  doors: ngDoors([1.81, 2.78], -7.08),
  win: [{ z: 0.62, from: 6.13, to: -9.07, pitch: 0.508, w: 0.25, h: 0.34 }],
  eng: { kind: "fan", at: [0.187], fwd: 3.45, drop: 0.42, len: 5.25, dia: 2.25, fx: 0.67, cx: 0.81, chev: true, pyFront: 0.45, pyTe: 0.6, pyAft: 0.9 },
  fin: { le: 38.92 - 31.64, ...B737_FIN },
  stab: { le: 38.92 - 34.35, ...B737_STAB },
  // split scimitar (fig. 2.2.2 and table 2.3.2): upper blade tip 0.6 m above the crown, 2.92 m tip to tip
  tip: { h: 2.44, sweep: 38, top: 0.4, base: 1.24, blend: 0.12, lo: 0.38, loSweep: 60, loTip: 0.65 },
};
// 737-900ER / 737-9 / 737-10 mid-cabin exit: 0.69 m wide, 1.24 m tall, sill 1.52 m above the keel
// (737-9 fig. 2.2.3), with one window; 7.8 m ahead of service door 2 on the -900ER and -9.
const midExitWin = (mid, from, to) => [{ z: 0.62, from, to: mid - 0.62, pitch: 0.508, w: 0.25, h: 0.34 },
  { z: 0.62, from: mid + 0.62, to, pitch: 0.508, w: 0.25, h: 0.34 }, { z: 0.62, from: mid, to: mid, w: 0.25, h: 0.34 }];

// ---------- Boeing 737 Classic (-300/-400/-500) ----------
// Reference: 737 ACAP D6-58325-6 Rev E, figs. 2.2.5 (737-400) and 2.2.6 (737-500); table 2.3.2.
// Same nose and cross-section as the NG (the NG overlay fits the -400's fuselage), but a smaller
// wing (28.88 m span, unswept inboard trailing edge), the CFM56-3 with its flattened bottom slung
// well ahead of the wing, a fin 0.9 m shorter than the NG's (same leading/trailing-edge angles:
// the NG's is an extension) on a fillet that starts further forward, a smaller stabilizer with
// broad tips, and the two eyebrow windows above the side windows. Tail cone ends 1.17 m ahead of
// the stabilizer tip (dimensioned 35.23 / 36.40 m on the -400).
const clDoors = (exits, cargo = 8.6) => [[4.67, 0.86], [cargo, 1.24, "C"], ...exits.map((e) => [e, 0.51, "E", "w"]),
  [-10.12, 1.24, "C"], [-6.21, 0.79]];
F.b737cl = {
  ...F.b737ng, L0: 35.23, over: 1.17, fwd: 0.594,
  glass: [...B737_GLASS,
    [[0.505, 0.676], [0.53, 0.738], [0.6, 0.765], [0.598, 0.69]],
    [[0.63, 0.705], [0.638, 0.79], [0.72, 0.818], [0.715, 0.728]]],
  doors: clDoors([1.28, 2.36]),
  win: [{ z: 0.59, from: 5.99, to: -7.88, pitch: 0.508, w: 0.25, h: 0.34 }],
  wing: { le: 14.09, root: 1.89, span: 28.88, cr: 6.1, kink: [0.29, 4.13], ct: 1.6, sweep: 29.1, dih: 6, z: 0.157, t: [0.15, 0.1] },
  ftf: [0.3, 0.5, 0.68],
  eng: { kind: "fan", at: [0.234], fwd: 3.53, drop: 0.73, len: 4.95, dia: 2.1, style: "flat", fx: 0.636, cx: 0.81, pylon: false },
  fin: { le: 6.29, cr: 5.36, ct: 1.46, h: 6.17, sweep: 40.4, fillet: [2.66, 1.41, "l"], cap: 0.1 },
  stab: { le: 4.62, z: 0.78, span: 12.7, root: 0.8, cr: 3.88, ct: 2.1, sweep: 32.5, dih: 7 },
};

// A wing-to-body fairing that shows on the side of the fuselage above the wing root: outline
// [ds from the wing root leading edge, z] in metres, front-bottom round the top to the aft-bottom
// where it runs into the keel. Drawn on the fuselage, under the wing.
const rootFairing = (pts) => ({ sk, f, L }) => {
  const le = f.wing.le + (L - f.L0) * (f.fwd ?? 0.5), P = pts.map(([ds, z]) => [le + ds, z]);
  const [s0, z0] = P[0], [s1, z1] = P[P.length - 1];
  sk.smooth("hull", [...P, [s1 - 1.5, Math.min(z1, 0) + 0.02], [s0 + 1.0, Math.min(z0, 0) + 0.02]], true, ' style="stroke:none"');
  sk.smooth("hull", P, false, ' style="fill:none"');
};

// ---------- Boeing 757 ----------
// Reference: 757 ACAP D6-58327 Rev H, figs. 2.2.1 (757-200, overwing-exit cabin) and 2.2.2 (757-300),
// door-location table 2.7.1. The drooping nose with its short, deep windshield, the deep belly
// fairing that runs 8 m behind the wing, the tall fin with a broad tip on a long curved fillet,
// stabilizer roots low on the tail cone, and the big RB211-535 long-duct nacelles hung far ahead
// of the wing (the PW2000 is similar in size). The side view's fuselage measures 4.17 m between
// line centres against a quoted 4.01 m; D = 4.1 splits the difference. Fin tip TE = overall length.
// Most 757-200s in service carry Aviation Partners blended winglets: the B752 drawing has them,
// scaled from the 737NG winglet measured above (no Boeing figure shows the 757's; lower confidence).
const b757Doors = (exits) => [[4.78, 0.76], [10.95, 1.4, "C"], [13.99, 0.84], ...exits.map((e) => [e, 0.52, "E", "w"]),
  [-15.19, 1.4, "C"], [-8.74, 0.76]];
F.b757 = {
  kind: "narrow", L0: 46.95, over: 0.37, D: 4.1, W: 3.76, fwd: 0.572, fair: 0.063, fairAft: 1.94,
  nose: {
    tip: 0.277,
    top: [[0.05, 0.37], [0.1, 0.4], [0.2, 0.467], [0.3, 0.567], [0.4, 0.67], [0.5, 0.747], [0.6, 0.808], [0.7, 0.853],
      [0.8, 0.888], [0.9, 0.913], [1.0, 0.929], [1.2, 0.956], [1.4, 0.979], [1.6, 0.992], [1.8, 1]],
    bot: [[0.05, 0.163], [0.1, 0.137], [0.15, 0.12], [0.2, 0.106], [0.3, 0.079], [0.4, 0.056], [0.5, 0.039], [0.6, 0.027],
      [0.7, 0.017], [0.8, 0.012], [1.0, 0.011], [1.15, 0.006], [1.25, 0]],
  },
  tail: {
    top: [[2.06, 1], [1.7, 0.969], [1.21, 0.933], [0.68, 0.891], [0.35, 0.85], [0, 0.783]],
    bot: [[3.08, 0], [3.0, 0.008], [2.92, 0.02], [2.67, 0.048], [2.43, 0.077], [2.18, 0.113], [1.94, 0.149], [1.7, 0.192], [1.45, 0.24],
      [1.21, 0.293], [0.96, 0.351], [0.72, 0.411], [0.48, 0.48], [0.23, 0.559], [0.11, 0.61], [0, 0.643]],
  },
  glass: [
    [[0.494, 0.645], [0.379, 0.633], [0.278, 0.513], [0.427, 0.516]],
    [[0.599, 0.638], [0.508, 0.645], [0.437, 0.516], [0.572, 0.5]],
    [[0.721, 0.638], [0.602, 0.635], [0.582, 0.5], [0.734, 0.533]],
  ],
  floor: 0.376,
  doors: b757Doors([2.46, 3.29]),
  win: [{ z: 0.623, from: 6.24, to: -11.85, pitch: 0.517, w: 0.3, h: 0.37 }, { z: 0.623, from: -6.72, to: -6.72, w: 0.3, h: 0.37 }],
  wing: { le: 18.14, root: 1.88, span: 38.05, cr: 8.24, kink: [0.333, 5.18], ct: 1.85, sweep: 28.2, dih: 6, z: 0.17, t: [0.15, 0.1] },
  ftf: [0.25, 0.42, 0.6, 0.76],
  eng: { kind: "fan", at: [0.268], fwd: 3.86, drop: 1.22, len: 5.15, dia: 2.56, style: "long", fx: 0.825 },
  fin: { le: 9.2, cr: 6.29, ct: 2.43, h: 7.22, sweep: 43.8, fillet: [1.75, 1.8] },
  stab: { le: 6.55, z: 0.625, span: 15.21, root: 1.68, cr: 4.26, ct: 1.75, sweep: 36.3, dih: 7 },
  // the fairing's side, from 3.2 m ahead of the wing root to 12 m behind it, 1.9 m up the fuselage
  extras: [rootFairing([[-2.6, 0.1], [-3.19, 0.62], [-2.64, 1.2], [-1.74, 1.6], [-0.64, 1.87], [1.86, 1.95], [5.86, 1.9],
    [9.06, 1.76], [10.26, 1.6], [11.26, 1.25], [12.01, 0.72], [11.86, 0.38], [10.66, 0.03]])],
};
F.b757w = {
  ...F.b757,
  overlays: [blendedWinglet({ root: -2.4, h: 3.0, top: [2.5, 3.25],
    le: [[-1.6, 0.08], [-0.4, 0.5], [1.15, 1.3]], te: [[2.4, 1.3], [1.95, 0.35], [1.85, -0.02]] })],
};

// ---------- Boeing 717 (MD-95) ----------
// Reference: 717 ACAP D6-58330 Rev B, fig. 2.2 (717-200), side and plan views. DC-9 nose with
// the eyebrow window above the side windows, BR715s on stubs either side of the tail cone,
// the broad-topped, steeply swept fin with the stabilizer and its bullet fairing on top.
// Overall 37.8 m to the stabilizer tip; tail cone ends at 34.3 m (34.4 m in the drawing).
F.b712 = {
  kind: "narrow", L0: 34.4, over: 3.4, D: 3.58, W: 3.34, fwd: 0.5, fair: 0.02,
  nose: {
    tip: 0.282,
    top: [[0.056, 0.394], [0.112, 0.441], [0.168, 0.478], [0.223, 0.506], [0.279, 0.534], [0.335, 0.561], [0.391, 0.584],
      [0.447, 0.609], [0.503, 0.634], [0.559, 0.662], [0.615, 0.715], [0.67, 0.768], [0.726, 0.816], [0.782, 0.844],
      [0.838, 0.872], [0.894, 0.894], [0.95, 0.911], [1.006, 0.927], [1.117, 0.955], [1.229, 0.975], [1.341, 0.989], [1.453, 0.997], [1.564, 1]],
    bot: [[0.056, 0.179], [0.112, 0.145], [0.168, 0.12], [0.223, 0.101], [0.279, 0.081], [0.335, 0.067], [0.391, 0.056],
      [0.447, 0.045], [0.503, 0.036], [0.559, 0.028], [0.782, 0.006], [1.0, 0]],
  },
  tail: {
    top: [[1.8, 1], [1.2, 0.97], [0.6, 0.89], [0.28, 0.82], [0, 0.765]],
    bot: [[2.77, 0], [2.63, 0.014], [2.35, 0.036], [2.07, 0.073], [1.79, 0.115], [1.51, 0.187], [1.24, 0.26], [0.955, 0.346],
      [0.68, 0.419], [0.4, 0.466], [0.12, 0.514], [0, 0.548]],
  },
  glass: [
    [[0.742, 0.755], [0.646, 0.755], [0.597, 0.664], [0.694, 0.664]],
    [[0.855, 0.755], [0.77, 0.755], [0.713, 0.661], [0.815, 0.605]],
    [[0.992, 0.745], [0.879, 0.755], [0.838, 0.61], [0.995, 0.664]],
    [[0.895, 0.847], [0.844, 0.847], [0.794, 0.777], [0.823, 0.771]],
  ],
  floor: 0.341,
  doors: [[4.37, 0.86], [10.2, 1.35, "C"], [1.42, 0.44, "E", "w"], [2.44, 0.44, "E", "w"], [-9.74, 0.91, "C"]],
  win: [{ z: 0.634, from: 6.39, to: -10.66, pitch: 0.478, w: 0.24, h: 0.28 }],
  wing: { le: 16.0, root: 1.7, span: 28.4, cr: 4.97, ct: 1.3, sweep: 27.6, dih: 3, z: 0.126, t: [0.13, 0.1] },
  ftf: [0.3, 0.5, 0.7],
  eng: { kind: "fan", aft: { s: 10.52, z: 0.503 }, len: 5.83, dia: 2.05, style: "long", fx: 0.96 },
  extras: [rootFairing([[-1.0, 0.25], [-1.85, 0.62], [-1.6, 0.97], [-0.9, 1.14], [1.0, 1.2], [4.0, 1.2]])],
  fin: { le: 5.32, cr: 4.05, ct: 3.42, h: 4.03, sweep: 47.4, fillet: [1.5, 1.0] },
  stab: { le: 1.62, z: "T", drop: 0.95, span: 11.24, root: 0.3, cr: 4.0, ct: 1.24, sweep: 33.3, dih: -2, bullet: [3.4, 0.55] },
};

export const families = F;
export const types = {
  // fwd: share of each stretch ahead of the wing, from the ACAP engine-inlet stations
  // -600/-700: one pair of overwing exits, 2.92 m behind the wing root (figs. 2.2.1, 2.2.3); the
  // -600's forward cargo door is 1.4 m further forward
  B734: "b737cl",
  B735: ["b737cl", { doors: clDoors([2.36], 7.58) }],
  B736: ["b737ng", { fwd: 0.547, doors: ngDoors([2.92], -6.14, 7.13) }],
  B737: ["b737ngw", { fwd: 0.511, doors: ngDoors([2.92]) }],
  B738: "b737ngw",
  B739: ["b737ngw", { fwd: 0.586, win: midExitWin(-13.94, 6.13, -8.14), extras: [plugDoor(-13.94, 0.69, 1.52, 1.24)] }],
  B37M: ["b737max", { fwd: 0.57 }],
  B38M: "b737max",
  B39M: ["b737max", { fwd: 0.579, win: midExitWin(-14.95, 6.13, -9.07), extras: [plugDoor(-14.95, 0.69, 1.52, 1.24)] }],
  B712: "b712",
  B752: "b757w",
  // 757-300: also a smaller door 3 behind the wing (36.0 m; drawn panel 0.8 x 1.5 m)
  B753: ["b757", { doors: b757Doors([2.46, 3.29]), extras: [...F.b757.extras, plugDoor(-18.05, 0.8, 1.6, 1.45)],
    win: [{ z: 0.623, from: 6.24, to: -18.6, pitch: 0.517, w: 0.3, h: 0.37 }, { z: 0.623, from: -16.33, to: -11.85, pitch: 0.517, w: 0.3, h: 0.37 },
      { z: 0.623, from: -6.72, to: -6.72, w: 0.3, h: 0.37 }] }],
  B3XM: ["b737max", { fwd: 0.6, win: midExitWin(-15.19, 6.13, -9.07), extras: [plugDoor(-15.19, 0.69, 1.52, 1.24)] }],
};
