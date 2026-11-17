// Light aircraft: pistons and single turboprops. Format: see ../profiles.js.
//
// These are drawn with `body` outlines (D = 1, so every point is in metres). The fin is part
// of the body outline: a light aircraft's tail cone is shallower than the renderer's built-in
// fin assumes, and the rudder of most of these hangs below the tail cone. Fixed gear, wheel
// spats, struts, rudder hinge lines and door outlines are drawn by the helpers below.
// A body outline does not stretch, so every family's L0 + over equals the data.js length of
// the types mapped to it.
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------
// Each family lists its small parts as data in `parts`; the two functions below draw them,
// so a stretched copy (see stretch()) only has to move numbers.
//   doors   closed [s, z, flag] loops drawn with the door stroke
//   lines   [s, z] polylines drawn as thin lines (rudder hinge, panel joints)
//   struts  [[s, z] bottom, [s, z] top, width at bottom, width at top]
//   gear    {leg: [[s, z] top, [s, z] bottom], w: [w0, w1], at: [s, z] axle, r, spat: {f, a, t, b}}
//           spat: reach ahead of / behind the axle, top above / bottom below it
//   draw    extra functions (kit) => void, drawn last

// A tapered leg or strut from [s0, z0] to [s1, z1], w0 / w1 wide (metres, along s).
const leg = (sk, [s0, z0], [s1, z1], w0 = 0.08, w1 = w0) =>
  sk.poly("strut", [[s0 - w0 / 2, z0], [s0 + w0 / 2, z0], [s1 + w1 / 2, z1], [s1 - w1 / 2, z1]]);

// A wheel with a teardrop spat (blunt in front, tapering aft) or a plain hub.
function wheel(sk, s, z, r, spat) {
  sk.ellipse("tire", s, z, r, r);
  if (!spat) { sk.ellipse("hub", s, z, r * 0.42, r * 0.42); return; }
  const { f, a, t, b } = spat;
  sk.smooth("pant", [[s - f, z + 0.02], [s - f * 0.72, z + t * 0.8], [s - f * 0.15, z + t], [s + a * 0.45, z + t * 0.82],
    [s + a, z + t * 0.12, "c"], [s + a * 0.5, z - b * 0.82], [s - f * 0.25, z - b], [s - f * 0.8, z - b * 0.62]]);
}

const EXTRAS = [(k) => {
  const p = k.f.parts || {};
  for (const d of p.doors || []) k.sk.smooth("door", d);
  for (const l of p.lines || []) k.sk.poly("hl", l, false);
}];
const OVERLAYS = [(k) => {
  const p = k.f.parts || {};
  for (const [a, b, w0, w1] of p.struts || []) leg(k.sk, a, b, w0, w1);
  for (const g of p.gear || []) {
    if (g.leg) leg(k.sk, g.leg[0], g.leg[1], ...(g.w || []));
    if (g.at) wheel(k.sk, g.at[0], g.at[1], g.r, g.spat);
  }
  for (const fn of p.draw || []) fn(k);
}];

// A rounded rectangle as a door outline: s0..s1, z0..z1, corner radius rr.
const rect = (s0, s1, z0, z1, rr = 0.06) => [[s0 + rr, z0, "l"], [s1 - rr, z0], [s1, z0 + rr, "l"], [s1, z1 - rr], [s1 - rr, z1, "l"],
  [s0 + rr, z1], [s0, z1 - rr, "l"], [s0, z0 + rr]];

// A copy of family f with a plug of length ds inserted at station at: every point aft of it
// moves back (fin and stab are measured from the tail end and follow by themselves).
function stretch(f, at, ds, more = {}) {
  const mv = (pt) => (pt[0] > at ? [pt[0] + ds, ...pt.slice(1)] : pt);
  const loop = (l) => l.map(mv);
  const p = f.parts || {};
  return {
    ...f, L0: f.L0 + ds, body: loop(f.body), glass: (f.glass || []).map(loop),
    wing: f.wing && { ...f.wing, le: f.wing.le > at ? f.wing.le + ds : f.wing.le },
    parts: {
      ...p, doors: (p.doors || []).map(loop), lines: (p.lines || []).map(loop),
      struts: (p.struts || []).map(([a, b, w0, w1]) => [mv(a), mv(b), w0, w1]),
      gear: (p.gear || []).map((g) => ({ ...g, leg: g.leg && g.leg.map(mv), at: g.at && mv(g.at) })),
    },
    ...more,
  };
}

// A copy of family f scaled uniformly by k (a drawing measured at one length, drawn at another).
function scale(f, k, more = {}) {
  const pt = (q) => [q[0] * k, q[1] * k, ...q.slice(2)];
  const loop = (l) => l.map(pt);
  const p = f.parts || {};
  const sc = (o, keys) => o && Object.fromEntries(Object.entries(o).map(([key, v]) => [key, keys.includes(key) ? v * k : v]));
  return {
    ...f, L0: f.L0 * k, over: (f.over || 0) * k, W: f.W * k, body: loop(f.body), glass: (f.glass || []).map(loop),
    wing: sc(f.wing, ["le", "root", "span", "cr", "ct", "z"]), stab: sc(f.stab, ["le", "z", "span", "root", "cr", "ct"]),
    eng: f.eng && { ...f.eng, nose: sc(f.eng.nose, ["s", "z", "d"]) },
    parts: {
      ...p, doors: (p.doors || []).map(loop), lines: (p.lines || []).map(loop),
      struts: (p.struts || []).map(([a, b, w0, w1]) => [pt(a), pt(b), w0, w1]),
      gear: (p.gear || []).map((g) => ({ ...g, leg: g.leg && g.leg.map(pt), at: g.at && pt(g.at), r: g.r * k })),
    },
    ...more,
  };
}

// ---------- Cessna 172 ----------
// Reference: Cessna 172G Skyhawk "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_172G_Skyhawk_3-view_line_drawing.png, from the Wikipedia article Cessna 172),
// side view measured and scaled to the 172S overall length 8.28 m (data.js 8.3). The 172G
// (1966) already has the swept fin with dorsal fin and the Omni-Vision rear window; the
// later Skyhawks differ in details below display size. z = 0 is the belly at the firewall.
F.c172 = {
  kind: "piston", L0: 8.3, over: 0, D: 1, W: 1.0,
  body: [
    [0, 0.625, "c"], [0.1, 0.672], [0.2, 0.708], [0.33, 0.742], [0.39, 0.755], [0.43, 0.772], [0.5, 0.8], [0.6, 0.83],
    [0.8, 0.885], [1.0, 0.92], [1.2, 0.955], [1.4, 0.985], [1.52, 1.0, "c"],
    [1.62, 1.1], [1.75, 1.215], [1.88, 1.3], [1.98, 1.33], [2.1, 1.3, "l"], [3.65, 1.3],
    [3.76, 1.29], [3.95, 1.235], [4.1, 1.185], [4.2, 1.15], [4.33, 1.11, "l"], [5.45, 1.11, "l"],
    [6.55, 1.33, "cl"], [7.5, 2.465], [7.6, 2.505], [7.9, 2.515], [8.27, 2.5, "cl"],
    [7.875, 0.95], [7.83, 0.885, "l"], [7.33, 0.76, "cl"],
    [4.0, 0.215], [3.6, 0.165], [3.0, 0.07], [2.6, 0.035], [2.2, 0.01], [1.6, 0], [1.2, 0], [1.0, 0.015], [0.9, 0.035],
    [0.8, 0.065], [0.7, 0.125], [0.6, 0.225], [0.5, 0.355], [0.44, 0.44], [0.4, 0.48], [0.37, 0.495], [0.3, 0.51],
    [0.2, 0.545], [0.1, 0.58],
  ],
  // windscreen side, door window, rear side window, Omni-Vision rear window
  glass: [
    [[1.56, 1.0], [1.66, 1.12, ""], [1.8, 1.24, ""], [1.97, 1.31], [2.14, 1.27], [2.14, 0.86]],
    [[2.25, 0.88], [2.25, 1.2], [3.03, 1.2], [3.03, 0.88]],
    [[3.13, 0.89], [3.13, 1.19], [3.55, 1.19, ""], [3.8, 1.11, ""], [3.88, 1.0], [3.6, 0.92, ""]],
    [[3.74, 1.31], [4.32, 1.1], [4.04, 0.98]],
  ],
  frame: 0.04,
  wing: { le: 2.02, root: 0.55, span: 11.0, cr: 1.645, kink: [0.4, 1.645], ct: 1.1, sweep: 1, dih: 1.73, z: 1.36, t: [0.13, 0.12] },
  eng: { kind: "none", nose: { s: 0.37, z: 0.625, d: 1.93, blades: 2 } },
  stab: { le: 1.75, z: 1.04, span: 3.45, root: 0.25, cr: 1.22, ct: 0.8, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    doors: [rect(2.2, 3.08, 0.2, 1.22, 0.07)],
    lines: [[[7.33, 0.76], [7.33, 1.1], [7.92, 2.31], [7.79, 2.39], [7.75, 2.5]]],
    struts: [[[2.05, 0.08], [2.2, 1.27], 0.12, 0.1]],
    gear: [
      { leg: [[2.95, 0.06], [2.9, -0.2]], w: [0.1, 0.07], at: [2.89, -0.22], r: 0.2, spat: { f: 0.48, a: 0.65, t: 0.24, b: 0.12 } },
      { leg: [[1.27, 0.01], [1.24, -0.39]], w: [0.07, 0.06], at: [1.24, -0.39], r: 0.175, spat: { f: 0.4, a: 0.5, t: 0.19, b: 0.13 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 150 / 152 ----------
// Reference: Cessna 150F "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_150F_3-view_line_drawing.png, Wikipedia article Cessna 150), side view drawn
// with the bullet spinner (23 ft 9 in), scaled to 7.3 m (data.js; 152 7.34 m, 150M 7.29 m).
// The 1966 150F introduced the swept fin; the Omni-Vision rear window came in 1964.
F.c150 = {
  kind: "piston", L0: 7.3, over: 0, D: 1, W: 0.95,
  body: [
    [0, 0.555, "c"], [0.1, 0.582], [0.2, 0.612], [0.3, 0.643], [0.41, 0.675], [0.45, 0.698], [0.5, 0.712], [0.6, 0.732],
    [0.8, 0.765], [1.0, 0.79], [1.2, 0.808], [1.3, 0.825, "c"], [1.4, 0.905], [1.5, 0.99], [1.6, 1.075], [1.7, 1.135],
    [1.85, 1.085, "l"], [3.15, 1.075], [3.22, 1.05, "l"], [3.65, 0.83, "l"], [5.15, 0.83, "l"],
    [5.92, 1.07, "cl"], [6.62, 1.92], [6.7, 1.955], [7.1, 1.962], [7.29, 1.935, "c"], [7.24, 1.84, "l"],
    [6.8, 0.62], [6.74, 0.57], [6.6, 0.53, "l"], [6.4, 0.5, "c"],
    [6.0, 0.428], [5.0, 0.305], [4.0, 0.185], [3.0, 0.065], [2.4, 0.02], [2.0, 0.003], [1.2, 0], [0.9, 0.004], [0.8, 0.012],
    [0.7, 0.05], [0.6, 0.115], [0.55, 0.172], [0.5, 0.255], [0.46, 0.33], [0.44, 0.39], [0.41, 0.432], [0.3, 0.465],
    [0.2, 0.495], [0.1, 0.527],
  ],
  glass: [
    [[1.33, 0.83], [1.66, 1.1], [1.8, 1.04], [1.65, 0.72]],
    [[1.98, 0.66], [1.98, 1.01], [2.62, 1.01], [2.62, 0.66]],
    [[3.63, 0.83], [3.16, 1.07], [2.9, 1.02], [3.11, 0.72]],
  ],
  frame: 0.035,
  wing: { le: 1.69, root: 0.5, span: 10.17, cr: 1.63, kink: [0.42, 1.63], ct: 1.12, sweep: 1, dih: 1, z: 1.155, t: [0.13, 0.12] },
  eng: { kind: "none", nose: { s: 0.41, z: 0.555, d: 1.75, blades: 2 } },
  stab: { le: 1.53, z: 0.725, span: 3.05, root: 0.22, cr: 1.15, ct: 0.8, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    doors: [rect(1.95, 2.67, 0.27, 1.05, 0.07)],
    lines: [[[6.39, 0.5], [6.39, 0.8], [6.9, 1.74], [6.76, 1.85], [6.71, 1.95]]],
    struts: [[[1.79, 0.19], [1.93, 1.07], 0.11, 0.1]],
    gear: [
      { leg: [[2.56, 0.03], [2.47, -0.3]], w: [0.09, 0.06], at: [2.46, -0.34], r: 0.18, spat: { f: 0.46, a: 0.62, t: 0.22, b: 0.11 } },
      { leg: [[1.05, 0.0], [1.0, -0.4]], w: [0.07, 0.06], at: [1.0, -0.41], r: 0.15, spat: { f: 0.38, a: 0.46, t: 0.17, b: 0.11 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 182 Skylane ----------
// Reference: Cessna 182M Skylane "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_182M_Skylane_3-view_line_drawing.png, Wikipedia article Cessna 182 Skylane),
// side view scaled from the 182M's 28 ft 0.5 in to the 182T's 8.84 m (data.js 8.8). Larger
// and deeper than the 172, with the dorsal fin blending into the fin and a taller fin.
F.c182 = {
  kind: "piston", L0: 8.8, over: 0, D: 1, W: 1.07,
  body: [
    [0, 0.675, "c"], [0.1, 0.735], [0.2, 0.785], [0.3, 0.825], [0.36, 0.84], [0.42, 0.87], [0.5, 0.905], [0.6, 0.94],
    [0.8, 0.99], [1.0, 1.03], [1.2, 1.06], [1.45, 1.085, "c"], [1.6, 1.24], [1.7, 1.31], [1.8, 1.365], [1.9, 1.415],
    [2.0, 1.45], [2.12, 1.37, "l"], [3.75, 1.37], [3.86, 1.36, "l"], [4.55, 1.17, "l"], [5.6, 1.17],
    [6.0, 1.29], [6.5, 1.43], [6.8, 1.525], [7.0, 1.63], [7.2, 1.79], [7.4, 2.01, "l"], [7.94, 2.665], [8.05, 2.71],
    [8.6, 2.715], [8.77, 2.675, "cl"], [8.08, 1.16], [8.07, 1.08], [8.02, 1.0], [7.95, 0.94], [7.8, 0.87],
    [7.5, 0.79], [7.0, 0.71], [6.0, 0.55], [5.0, 0.4], [4.0, 0.24], [3.5, 0.165], [3.0, 0.1], [2.5, 0.06], [2.0, 0.045],
    [1.5, 0.045], [1.2, 0.05], [1.0, 0.085], [0.9, 0.105], [0.8, 0.135], [0.7, 0.175], [0.6, 0.235], [0.55, 0.32],
    [0.5, 0.43], [0.45, 0.5], [0.4, 0.535], [0.36, 0.545], [0.3, 0.555], [0.2, 0.585], [0.1, 0.62],
  ],
  glass: [
    [[1.5, 1.08], [1.72, 1.31, ""], [1.95, 1.44], [2.08, 1.36], [2.05, 0.93]],
    [[2.3, 0.93], [2.3, 1.26], [3.1, 1.26], [3.1, 0.93]],
    [[3.2, 0.93], [3.2, 1.25], [3.52, 1.25, ""], [3.86, 1.17, ""], [4.02, 1.07], [3.6, 0.95, ""]],
    [[3.84, 1.38], [4.52, 1.19], [4.3, 1.14], [3.9, 1.25]],
  ],
  frame: 0.04,
  wing: { le: 2.03, root: 0.58, span: 11.0, cr: 1.66, kink: [0.4, 1.66], ct: 1.12, sweep: 1, dih: 1.73, z: 1.44, t: [0.13, 0.12] },
  eng: { kind: "none", nose: { s: 0.33, z: 0.675, d: 2.03, blades: 2 } },
  stab: { le: 2.06, z: 1.065, span: 3.56, root: 0.25, cr: 1.3, ct: 0.88, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    doors: [rect(2.2, 3.15, 0.2, 1.3, 0.07)],
    lines: [[[7.5, 1.17], [8.33, 2.58], [8.17, 2.59], [8.16, 2.71]]],
    struts: [[[2.13, 0.18], [2.28, 1.38], 0.13, 0.11]],
    gear: [
      { leg: [[3.0, 0.1], [3.0, -0.2]], w: [0.1, 0.07], at: [3.01, -0.24], r: 0.19, spat: { f: 0.52, a: 0.62, t: 0.29, b: 0.1 } },
      { leg: [[1.27, 0.05], [1.22, -0.42]], w: [0.08, 0.06], at: [1.22, -0.44], r: 0.16, spat: { f: 0.37, a: 0.5, t: 0.28, b: 0.08 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 206 Stationair ----------
// Reference: Cessna TU206A Super Skywagon "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_TU206A_Super_Skywagon_3-view_line_drawing.png, Wikipedia article Cessna 206),
// a right-side view showing the double cargo doors aft of the wing; scaled from 27 ft 9 in to
// the T206H's 8.61 m (data.js 8.6). Long nose, no rear window, the big double door.
F.c206 = {
  kind: "piston", L0: 8.6, over: 0, D: 1, W: 1.1,
  body: [
    [0, 0.67, "c"], [0.1, 0.72], [0.2, 0.765], [0.3, 0.8], [0.37, 0.815], [0.42, 0.825], [0.5, 0.85], [0.7, 0.885],
    [1.0, 0.94], [1.3, 0.985], [1.55, 1.025, "c"], [1.7, 1.16], [1.8, 1.23], [1.9, 1.29], [2.0, 1.34], [2.1, 1.37],
    [2.2, 1.31, "l"], [3.7, 1.31], [3.82, 1.335], [4.0, 1.32], [4.3, 1.28], [4.6, 1.22], [4.8, 1.17], [4.95, 1.115],
    [5.05, 1.1, "l"], [5.55, 1.1], [5.7, 1.14], [6.0, 1.22], [6.5, 1.38], [6.8, 1.48], [7.0, 1.59], [7.2, 1.76],
    [7.4, 1.99, "l"], [7.95, 2.6], [8.05, 2.645], [8.4, 2.645], [8.6, 2.6, "cl"], [8.03, 1.17], [8.04, 1.1],
    [7.98, 0.99], [7.88, 0.87], [7.7, 0.79], [7.0, 0.64], [6.0, 0.46], [5.0, 0.29], [4.3, 0.15], [3.9, 0.08],
    [3.5, 0.03], [3.0, -0.01], [2.0, -0.02], [1.4, -0.02], [1.0, -0.01], [0.8, 0], [0.7, 0.02], [0.6, 0.08],
    [0.55, 0.17], [0.5, 0.3], [0.46, 0.4], [0.42, 0.465], [0.37, 0.48], [0.3, 0.505], [0.2, 0.535], [0.1, 0.575],
  ],
  glass: [
    [[1.6, 1.0], [1.8, 1.2, ""], [2.05, 1.355], [2.16, 1.3], [2.12, 0.84]],
    [[2.32, 0.83], [2.32, 1.17], [3.07, 1.17], [3.07, 0.83]],
    [[3.18, 0.83], [3.18, 1.16], [3.7, 1.16], [3.7, 0.83]],
    [[3.81, 0.84], [3.81, 1.16], [4.12, 1.16], [4.24, 1.04], [4.24, 0.84]],
    [[4.38, 1.22], [4.82, 1.13], [4.72, 1.0], [4.4, 1.06]],
  ],
  frame: 0.04,
  wing: { le: 2.07, root: 0.58, span: 11.0, cr: 1.66, kink: [0.4, 1.66], ct: 1.12, sweep: 1, dih: 1.73, z: 1.35, t: [0.13, 0.12] },
  eng: { kind: "none", nose: { s: 0.28, z: 0.67, d: 2.0, blades: 3 } },
  stab: { le: 1.95, z: 0.98, span: 3.66, root: 0.25, cr: 1.25, ct: 0.88, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    doors: [rect(3.13, 3.74, 0.11, 1.22, 0.07), rect(3.76, 4.31, 0.14, 1.22, 0.07)],
    lines: [[[7.53, 1.17], [8.27, 2.5], [8.1, 2.5], [8.1, 2.64]]],
    struts: [[[2.12, 0.12], [2.29, 1.3], 0.13, 0.11]],
    gear: [
      { leg: [[3.05, 0.0], [3.02, -0.3]], w: [0.1, 0.07], at: [3.02, -0.38], r: 0.2, spat: { f: 0.64, a: 0.5, t: 0.3, b: 0.06 } },
      { leg: [[1.32, 0.0], [1.25, -0.45]], w: [0.08, 0.06], at: [1.25, -0.48], r: 0.16, spat: { f: 0.38, a: 0.35, t: 0.25, b: 0.05 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 208 Caravan ----------
// Reference: "Caravan three views" (Wikimedia Commons, File:Caravan_three_views.png, Wikipedia
// article Cessna 208 Caravan): the 208 side view (11.46 m, data.js 11.5) for the airframe and
// the 208B Super Cargomaster view for the belly cargo pod most Caravans carry (FedEx feeders).
// Long PT6A cowl, high strut-braced wing, fixed gear on a fuselage sponson, airstair door aft.
// The pod is part of the outline; a line marks where it meets the belly.
F.c208 = {
  kind: "turboprop", L0: 11.5, over: 0, D: 1, W: 1.6,
  body: [
    [0, 0.82, "c"], [0.1, 0.9], [0.25, 0.98], [0.42, 1.04], [0.55, 1.09], [0.75, 1.16], [1.0, 1.22], [1.25, 1.27],
    [1.5, 1.3], [1.75, 1.33], [2.0, 1.35], [2.32, 1.365, "c"], [2.5, 1.5], [2.75, 1.645], [3.0, 1.745], [3.25, 1.815],
    [3.5, 1.86], [3.75, 1.885], [4.0, 1.9, "l"], [5.6, 1.86], [6.0, 1.82], [7.0, 1.81], [7.5, 1.77], [7.9, 1.75],
    [8.25, 1.82, "l"], [9.75, 2.23], [10.0, 2.32, "c"], [10.78, 3.78], [10.86, 3.81], [11.4, 3.81], [11.47, 3.77, "c"],
    [11.44, 3.0], [11.38, 2.0], [11.38, 1.5], [11.3, 1.25], [11.1, 1.08], [10.75, 0.96], [10.0, 0.81], [9.0, 0.6],
    [8.0, 0.42], [7.5, 0.33], [7.25, 0.27],
    // cargo pod
    [6.9, 0.06], [6.4, -0.15], [5.9, -0.25], [5.5, -0.27, "l"], [2.7, -0.27], [2.25, -0.2], [1.95, -0.06], [1.85, 0.05],
    [1.25, 0.07], [1.0, 0.17], [0.75, 0.35], [0.55, 0.5], [0.42, 0.6], [0.25, 0.665], [0.1, 0.735],
  ],
  glass: [
    [[2.36, 1.38], [2.75, 1.64, ""], [3.3, 1.82, ""], [3.42, 1.7], [3.05, 1.24], [2.45, 1.25]],
    [[3.3, 1.08], [3.3, 1.42], [3.6, 1.42], [3.85, 1.12]],
    [[4.16, 1.04], [4.16, 1.4], [4.66, 1.4], [4.66, 1.04]],
    [[4.88, 1.04], [4.88, 1.4], [5.6, 1.4], [5.6, 1.04]],
    [[5.7, 1.04], [5.7, 1.4], [6.24, 1.4], [6.24, 1.04]],
    [[6.3, 1.04], [6.3, 1.4], [6.85, 1.4], [6.85, 1.04]],
    [[6.96, 1.04], [6.96, 1.4], [7.46, 1.4], [7.46, 1.04]],
  ],
  frame: 0.04,
  wing: { le: 3.88, root: 0.8, span: 15.88, cr: 2.02, kink: [0.36, 2.02], ct: 1.25, sweep: 1, dih: 1.5, z: 1.9, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.47, z: 0.82, d: 2.5, blades: 3 } },
  stab: { le: 1.5, z: 1.5, span: 6.25, root: 0.4, cr: 1.35, ct: 0.9, sweep: 6, dih: 0, thick: 0.1 },
  parts: {
    doors: [
      [[2.98, 0.42, "c"], [3.95, 0.42, "c"], [3.95, 1.5, "c"], [3.4, 1.52, "c"], [2.98, 0.95, "c"]],
      rect(5.65, 6.92, 0.38, 1.62, 0.08), [[5.65, 1.0], [6.92, 1.0]],
      rect(2.8, 3.6, -0.22, 0.02, 0.06), rect(3.8, 4.55, -0.22, 0.02, 0.06), rect(5.15, 5.95, -0.22, 0.02, 0.06),
    ],
    lines: [[[1.85, 0.07], [7.25, 0.18]], [[10.62, 1.05], [11.0, 3.3], [10.88, 3.32], [10.88, 3.8]]],
    struts: [[[4.05, 0.3], [3.98, 1.86], 0.15, 0.13]],
    gear: [
      { leg: [[4.78, 0.2], [4.72, -0.42]], w: [0.14, 0.09], at: [4.72, -0.45], r: 0.26 },
      { leg: [[1.33, 0.1], [1.28, -0.46]], w: [0.09, 0.07], at: [1.28, -0.48], r: 0.2 },
    ],
    draw: [(k) => {
      // main-gear sponson on the fuselage side, and the exhaust stack
      k.sk.smooth("pant", [[4.3, 0.28], [4.6, 0.4], [5.1, 0.38], [5.35, 0.25, "c"], [4.9, 0.12], [4.45, 0.15]]);
      k.sk.ellipse("inlet", 1.6, 0.95, 0.13, 0.1);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Piper PA-28 Cherokee / Warrior / Archer / Dakota ----------
// Reference: Piper PA-28-181 Cherokee Archer II 3-view (Wikimedia Commons,
// File:Piper_PA-28-181_Cherokee_Archer_II_3-view_line_drawing.png, Wikipedia article Piper
// PA-28 Cherokee), side view 23 ft 9.6 in, scaled to 7.3 m (data.js P28A). Low tapered
// "Warrior" wing with 7 degrees of dihedral (the tip rides well up the side view), long sloping
// windscreen, curved dorsal fillet, all-moving stabilator low on the tail cone, one door on the
// right over the wing, fixed gear with spats. P28B (Dakota / Turbo Dakota, 7.54 m) has the
// longer cowl of the O-540: the same airframe with 0.2 m added ahead of the firewall.
F.pa28 = {
  kind: "piston", L0: 7.3, over: 0, D: 1, W: 1.1,
  body: [
    [0, 0.48, "c"], [0.1, 0.57], [0.2, 0.635], [0.33, 0.69], [0.4, 0.705], [0.6, 0.73], [0.8, 0.75], [1.0, 0.77],
    [1.2, 0.79], [1.43, 0.805, "c"], [1.6, 0.93], [1.75, 1.03], [1.9, 1.12], [2.05, 1.2], [2.2, 1.24], [2.5, 1.27],
    [2.8, 1.255], [3.2, 1.21], [3.6, 1.16], [4.0, 1.11], [4.4, 1.065], [4.7, 1.045], [5.0, 1.05], [5.4, 1.07],
    [5.7, 1.11], [5.9, 1.18], [6.1, 1.3], [6.3, 1.5], [6.5, 1.76], [6.65, 1.94], [6.76, 2.03], [6.9, 2.095],
    [7.1, 2.105], [7.31, 2.1, "c"], [7.3, 1.97], [7.0, 0.79, "c"], [7.0, 0.6], [6.95, 0.48], [6.88, 0.41], [6.7, 0.36],
    [6.5, 0.325], [6.0, 0.245], [5.5, 0.175], [5.0, 0.11], [4.5, 0.045], [4.0, 0.0], [3.5, -0.025], [2.0, -0.03],
    [1.2, -0.03], [1.0, -0.015], [0.8, 0.04], [0.65, 0.11], [0.5, 0.2], [0.4, 0.27], [0.33, 0.305], [0.2, 0.355],
    [0.1, 0.41],
  ],
  glass: [
    [[1.47, 0.81], [1.75, 1.02, ""], [2.06, 1.21], [1.84, 0.7]],
    [[2.0, 0.71], [2.15, 1.08], [2.73, 1.09], [2.73, 0.71]],
    [[2.87, 0.68], [2.87, 1.06], [3.42, 1.07], [3.42, 0.68]],
    [[3.53, 0.69], [3.53, 0.99], [3.98, 0.96], [4.0, 0.71]],
  ],
  frame: 0.035,
  wing: { le: 1.82, root: 0.6, span: 10.67, cr: 1.75, kink: [0.42, 1.55], ct: 1.07, sweep: 5, dih: 7, z: 0.06, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.33, z: 0.48, d: 1.93, blades: 2 } },
  stab: { le: 0.82, z: 0.61, span: 3.92, root: 0.25, cr: 0.78, ct: 0.76, sweep: 0, dih: 0, thick: 0.1 },
  parts: {
    doors: [[[1.86, 0.62, "c"], [2.13, 1.13, "c"], [2.78, 1.13, "c"], [2.78, 0.62, "c"]]],
    lines: [[[6.66, 0.4], [6.66, 0.8], [6.98, 2.0]]],
    gear: [
      { leg: [[2.9, -0.03], [2.95, -0.3]], w: [0.14, 0.1], at: [2.98, -0.38], r: 0.21, spat: { f: 0.36, a: 0.5, t: 0.26, b: 0.1 } },
      { leg: [[0.98, -0.02], [1.0, -0.48]], w: [0.08, 0.07], at: [1.0, -0.52], r: 0.19, spat: { f: 0.32, a: 0.42, t: 0.24, b: 0.1 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.pa28b = stretch(F.pa28, 0.9, 0.2);

// ---------- Piper PA-46 Malibu / Mirage / M350, Meridian / M500 / M600 ----------
// Reference: Piper PA-46-310P Malibu 3-view (Wikimedia Commons,
// File:Piper_PA-46-310P_Malibu_3-view_line_drawing.png, Wikipedia article Piper PA-46), side
// view 28.4 ft (8.66 m) measured, drawn scaled to the M350's 8.81 m (data.js 8.8). Pressurised
// cabin with small separate windows, the triangular pilot's window behind the windscreen,
// straight-topped fuselage running into a big curved fin fillet, the rear airstair door (on the
// left side; shown), low wing, retractable gear (drawn retracted). P46T (Meridian, M500, M600)
// adds a longer PT6A cowl (9.0 m) with exhaust stacks and a four-blade propeller.
const PA46 = {
  kind: "piston", L0: 8.66, over: 0, D: 1, W: 1.3,
  body: [
    [0, 0.475, "c"], [0.1, 0.53], [0.2, 0.57], [0.35, 0.605], [0.43, 0.635], [0.5, 0.655], [0.8, 0.71], [1.0, 0.74],
    [1.4, 0.795], [1.8, 0.83], [2.22, 0.855, "c"], [2.4, 0.96], [2.6, 1.1], [2.8, 1.21], [2.95, 1.265], [3.1, 1.29],
    [3.5, 1.29, "l"], [6.6, 1.3], [6.75, 1.34], [6.88, 1.43], [7.0, 1.54, "l"], [7.95, 2.58], [8.03, 2.62], [8.6, 2.62],
    [8.65, 2.59, "cl"], [7.9, 1.0, "c"], [8.05, 0.9], [8.3, 0.79, "c"], [8.0, 0.69], [7.5, 0.56], [6.85, 0.37],
    [6.0, 0.13], [5.5, 0.03], [5.0, -0.02], [4.0, -0.03], [2.0, -0.03], [1.2, -0.02], [1.0, 0], [0.8, 0.04], [0.6, 0.13],
    [0.5, 0.22], [0.45, 0.28], [0.42, 0.32], [0.35, 0.345], [0.2, 0.38], [0.1, 0.42],
  ],
  glass: [
    [[2.83, 1.18], [2.28, 0.87], [2.62, 0.73]],
    [[2.76, 0.73], [3.0, 1.1], [3.46, 1.07], [3.46, 0.73]],
    [[3.71, 0.72], [3.71, 1.06], [4.16, 1.06], [4.16, 0.72]],
    [[4.37, 0.73], [4.37, 1.05], [4.82, 1.05], [4.82, 0.73]],
    [[5.08, 0.75], [5.08, 1.0], [5.47, 1.0], [5.47, 0.75]],
  ],
  frame: 0.035,
  wing: { le: 2.73, root: 0.65, span: 13.11, cr: 1.57, ct: 0.9, sweep: 1.8, dih: 4.5, z: 0.05, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.38, z: 0.475, d: 2.03, blades: 3 } },
  stab: { le: 1.38, z: 0.79, span: 4.42, root: 0.25, cr: 0.9, ct: 0.6, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    doors: [rect(4.26, 4.96, 0.0, 1.14, 0.07), [[4.26, 0.56], [4.96, 0.56]]],
    lines: [[[7.42, 1.0], [8.27, 2.47]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.pa46 = scale(PA46, 8.8 / 8.66);
F.p46t = stretch(F.pa46, 1.0, 0.2, {
  kind: "turboprop", eng: { kind: "none", nose: { s: 0.39, z: 0.483, d: 2.06, blades: 4 } },
});
F.p46t.parts = { ...F.p46t.parts, draw: [(k) => k.sk.ellipse("inlet", 1.05, 0.5, 0.11, 0.08)] };

// ---------- Beechcraft A36 / G36 Bonanza ----------
// Reference: Beechcraft A36 Bonanza 3-view (Wikimedia Commons,
// File:Beechcraft_A36_Bonanza_3-view_line_drawing.png, Wikipedia article Beechcraft Bonanza),
// side view 26 ft 8 in measured; the 1984-on A36 and G36 are 27 ft 6 in (data.js 8.4), the
// extra length drawn in the cowl. The straight conventional fin of the 33/36 (not the V-tail
// 35), right-side front door and double "club" doors aft, low wing with 6.5 degrees dihedral,
// retractable gear (drawn retracted).
const BE36 = {
  kind: "piston", L0: 8.13, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.625, "c"], [0.1, 0.675], [0.2, 0.72], [0.3, 0.755], [0.42, 0.785], [0.5, 0.8], [0.7, 0.835], [1.0, 0.88],
    [1.3, 0.93], [1.5, 0.975, "c"], [1.7, 1.08], [1.9, 1.19], [2.1, 1.29], [2.3, 1.385], [2.6, 1.425], [3.0, 1.43],
    [3.5, 1.4], [4.0, 1.35], [4.5, 1.3], [5.0, 1.25], [5.2, 1.24, "l"], [6.4, 1.24], [6.55, 1.27], [6.68, 1.35],
    [6.8, 1.48], [7.0, 1.8, "l"], [7.42, 2.44], [7.5, 2.47], [8.0, 2.49], [8.09, 2.45, "cl"], [7.85, 0.95],
    [7.86, 0.8], [7.82, 0.71], [7.7, 0.66], [7.5, 0.625], [7.0, 0.535], [6.5, 0.45], [6.0, 0.365], [5.5, 0.285],
    [5.0, 0.205], [4.5, 0.125], [4.0, 0.065], [3.5, 0.015], [3.0, -0.01], [2.0, -0.03], [1.0, -0.02], [0.75, -0.01],
    [0.62, 0.03], [0.55, 0.12], [0.5, 0.28], [0.45, 0.42], [0.42, 0.465], [0.3, 0.5], [0.2, 0.535], [0.1, 0.575],
  ],
  glass: [
    [[1.56, 0.98], [1.9, 1.18, ""], [2.27, 1.37], [1.94, 0.9]],
    [[2.03, 0.85], [2.3, 1.33], [2.9, 1.34], [2.91, 0.85]],
    [[2.98, 0.86], [2.98, 1.34], [3.53, 1.33], [3.53, 0.86]],
    [[3.64, 0.88], [3.64, 1.2], [4.12, 1.2], [4.12, 0.88]],
    [[4.26, 0.9], [4.26, 1.15], [4.7, 1.13], [4.7, 0.9]],
  ],
  frame: 0.035,
  wing: { le: 1.95, root: 0.6, span: 10.21, cr: 2.1, ct: 1.1, sweep: 6, dih: 6.5, z: 0.12, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.38, z: 0.625, d: 2.03, blades: 3 } },
  stab: { le: 1.38, z: 0.93, span: 3.71, root: 0.25, cr: 1.1, ct: 0.75, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    doors: [[[1.97, 0.45, "c"], [1.97, 0.88, "c"], [2.29, 1.38, "c"], [2.95, 1.38, "c"], [2.95, 0.45, "c"]],
      rect(3.61, 4.19, 0.25, 1.3, 0.06), rect(4.21, 4.79, 0.25, 1.3, 0.06)],
    lines: [[[7.42, 1.05], [7.78, 2.22], [7.52, 2.27], [7.52, 2.42]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.be36 = stretch(BE36, 1.2, 0.27);

// ---------- Beechcraft Baron 58 ----------
// Reference: Beechcraft D55 Baron 3-view (Wikimedia Commons,
// File:Beechcraft_D55_Baron_3-view_line_drawing.png, Wikipedia article Beechcraft Baron),
// side view 28.98 ft (8.83 m) measured. The Baron 58 (9.09 m, data.js 9.1) is the 55 with the
// cabin lengthened 10 in by moving the windscreen, panel and front seats forward, and the
// double "club" doors aft on the right: drawn as the 55 with a 0.26 m plug ahead of the wing
// and the 58's window and door layout. Pointed baggage nose, wing-mounted IO-550 nacelles
// with three-blade props, straight swept fin, retractable gear (drawn retracted).
const BE55 = {
  kind: "piston", L0: 8.83, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.5, "c"], [0.1, 0.56], [0.2, 0.6], [0.3, 0.64], [0.5, 0.7], [0.7, 0.76], [1.0, 0.83], [1.3, 0.88], [1.6, 0.92],
    [2.0, 0.97], [2.17, 1.0, "c"], [2.3, 1.12], [2.45, 1.25], [2.6, 1.35], [2.75, 1.4], [3.0, 1.43], [3.3, 1.43],
    [3.6, 1.4], [4.0, 1.37], [4.5, 1.32], [4.7, 1.3, "l"], [6.5, 1.28], [6.65, 1.29], [6.8, 1.33], [6.9, 1.4],
    [7.0, 1.47, "l"], [7.9, 2.49], [7.98, 2.55], [8.8, 2.57], [8.83, 2.55, "cl"], [8.34, 0.98], [8.36, 0.88],
    [8.3, 0.76], [8.2, 0.68], [8.0, 0.57], [7.5, 0.46], [7.0, 0.38], [6.0, 0.23], [5.0, 0.07], [4.5, -0.01],
    [4.0, -0.06], [3.5, -0.08], [2.0, -0.09], [1.5, -0.06], [1.3, -0.04], [1.0, 0], [0.8, 0.03], [0.5, 0.09],
    [0.3, 0.15], [0.2, 0.19], [0.1, 0.26], [0.04, 0.36],
  ],
  frame: 0.035,
  wing: { le: 2.42, root: 0.6, span: 11.53, cr: 2.13, ct: 0.88, sweep: 4.2, dih: 6, z: 0.08, t: [0.15, 0.12] },
  eng: { kind: "prop", at: [0.19], fwd: 1.6, drop: -0.28, len: 2.7, dia: 0.54, prop: 1.98, blades: 3, spinner: 0.13, tailZ: 0.3 },
  stab: { le: 1.98, z: 0.86, span: 4.86, root: 0.25, cr: 1.2, ct: 0.78, sweep: 8, dih: 0, thick: 0.1 },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.be58 = stretch(BE55, 2.8, 0.26, {
  glass: [
    [[2.2, 1.0], [2.5, 1.24, ""], [2.76, 1.38], [2.3, 0.91]],
    [[2.62, 0.81], [2.62, 1.05], [2.77, 1.31], [3.62, 1.31], [3.62, 0.81]],
    [[3.69, 0.8], [3.69, 1.29], [4.25, 1.29], [4.25, 0.8]],
    [[4.42, 0.82], [4.42, 1.22], [4.88, 1.2], [4.88, 0.82]],
    [[5.02, 0.84], [5.02, 1.18], [5.44, 1.15], [5.44, 0.86]],
  ],
  parts: {
    doors: [[[2.27, 0.55, "c"], [2.27, 0.9, "c"], [2.7, 1.35, "c"], [3.66, 1.37, "c"], [3.66, 0.55, "c"]],
      rect(4.33, 4.94, 0.2, 1.3, 0.06), rect(4.96, 5.56, 0.24, 1.29, 0.06)],
    lines: [[[7.96, 0.97], [8.46, 2.42], [8.31, 2.47], [8.31, 2.55]]],
  },
});
// the plug is between windscreen and wing: the wing (and its nacelles) moves back with the tail
F.be58.wing = { ...F.be58.wing, le: BE55.wing.le + 0.26 };

// ---------- Mooney M20 ----------
// Reference: Mooney M20G Statesman 3-view (Wikimedia Commons,
// File:Mooney_M20G_Statesman_3-view_line_drawing.png, Wikipedia article Mooney M20), side
// view 24 ft (7.32 m) measured; the M20J (data.js M20P 7.5) has 0.2 m more cowl and spinner.
// The Mooney signature: the fin's leading edge stands straight up while the rudder's
// trailing edge and hinge lean aft at the bottom, so the tail looks swept forward. Low wing,
// short cabin with three side windows, door on the right, retractable gear (drawn retracted).
const M20 = {
  kind: "piston", L0: 7.32, over: 0, D: 1, W: 1.1,
  body: [
    [0, 0.78, "c"], [0.1, 0.84], [0.2, 0.88], [0.3, 0.91], [0.45, 0.94], [0.5, 0.955], [0.8, 0.97], [1.6, 0.965, "c"],
    [1.7, 1.06], [1.8, 1.15], [1.9, 1.21], [2.0, 1.255], [2.1, 1.285], [2.3, 1.29], [2.6, 1.28], [3.0, 1.24, "l"],
    [5.0, 0.915, "l"], [6.04, 0.92, "c"], [6.13, 1.95], [6.2, 1.975], [6.66, 1.975], [6.71, 1.96, "cl"], [7.3, 0.46],
    [7.31, 0.36], [7.25, 0.26], [7.1, 0.19], [6.5, 0.12], [6.0, 0.08], [5.5, 0.04], [5.0, 0.02], [4.5, -0.02],
    [4.0, -0.04], [3.5, -0.07], [3.0, -0.08], [2.6, -0.08], [2.2, -0.05], [1.8, -0.01], [1.5, 0.03], [1.2, 0.07],
    [0.9, 0.12], [0.7, 0.16], [0.6, 0.18], [0.53, 0.25], [0.48, 0.42], [0.45, 0.62], [0.3, 0.66], [0.2, 0.69],
    [0.1, 0.725],
  ],
  glass: [
    [[1.62, 0.97], [1.9, 1.2], [1.98, 1.18], [1.8, 0.84]],
    [[1.92, 0.82], [2.02, 1.14], [2.49, 1.15], [2.49, 0.81]],
    [[2.57, 0.82], [2.57, 1.14], [2.95, 1.13], [2.95, 0.82]],
    [[3.03, 0.83], [3.03, 1.12], [3.4, 1.08], [3.4, 0.84]],
  ],
  frame: 0.035,
  wing: { le: 1.86, root: 0.55, span: 10.67, cr: 2.14, ct: 1.05, sweep: 1.5, dih: 5.5, z: 0.04, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.43, z: 0.78, d: 1.88, blades: 2 } },
  stab: { le: 1.37, z: 0.65, span: 3.58, root: 0.2, cr: 1.0, ct: 0.7, sweep: 4, dih: 0, thick: 0.1 },
  parts: {
    doors: [[[1.84, 0.5, "c"], [1.84, 0.82, "c"], [1.97, 1.2, "c"], [2.53, 1.22, "c"], [2.53, 0.5, "c"]]],
    lines: [[[6.4, 1.93], [7.08, 0.2]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.m20 = stretch(M20, 0.9, 0.2);

// ---------- Boeing-Stearman Model 75 (PT-17 / N2S Kaydet) ----------
// Reference: U.S. Navy N2S-3 general arrangement diagram (Wikimedia Commons,
// File:Boeing_N2S-3_3-view_line_drawing.png, Wikipedia article Boeing-Stearman Model 75),
// side view 25 ft (data.js 7.6) drawn level. Biplane: the lower wing is the renderer's wing,
// the upper wing (staggered 0.69 m forward, 3 degrees incidence), cabane and N interplane
// struts are drawn last; uncowled radial engine with exposed cylinder heads; tandem open
// cockpits; rounded fin and rudder with braced tailplane; tailwheel undercarriage.
F.st75 = {
  kind: "piston", L0: 7.6, over: 0, D: 1, W: 0.85,
  body: [
    [0.03, 0.47, "c"], [0.08, 0.53], [0.15, 0.56], [0.27, 0.57, "c"], [0.3, 0.93, "c"], [0.45, 0.97], [0.6, 0.95],
    [0.72, 0.88], [1.15, 0.97], [2.6, 0.98, "l"], [3.0, 0.97], [3.6, 0.94], [4.0, 0.9], [4.4, 0.875], [4.8, 0.85],
    [5.2, 0.825], [5.6, 0.8], [6.04, 0.785, "c"], [6.59, 1.6], [6.88, 1.73], [7.16, 1.58], [7.39, 1.26], [7.52, 0.89],
    [7.56, 0.57], [7.53, 0.39], [7.39, 0.25], [7.16, 0.16], [7.0, 0.12], [6.5, 0.07], [6.0, 0.02], [5.6, -0.02],
    [5.2, -0.06], [4.8, -0.1], [4.4, -0.13], [4.0, -0.15], [3.6, -0.19], [3.2, -0.2], [2.4, -0.19], [2.0, -0.17],
    [1.6, -0.16], [1.15, -0.16], [0.72, -0.05], [0.55, -0.06], [0.3, -0.04, "c"], [0.27, 0.38, "c"], [0.15, 0.39],
    [0.08, 0.41],
  ],
  // the two windscreens
  glass: [[[2.7, 0.97], [2.83, 1.13], [2.95, 1.1], [2.97, 0.97]], [[3.5, 0.94], [3.62, 1.1], [3.74, 1.07], [3.76, 0.93]]],
  frame: 0.02,
  wing: { le: 1.84, root: 0.42, span: 9.5, cr: 1.52, ct: 1.52, sweep: 0, dih: 1.5, z: 0.06, t: [0.12, 0.12], inc: 4 },
  eng: { kind: "none", nose: { s: 0.1, z: 0.47, d: 2.45, blades: 2 } },
  stab: { le: 1.8, z: 0.62, span: 3.81, root: 0.2, cr: 1.24, ct: 1.0, sweep: 3, dih: 0, thick: 0.08 },
  parts: {
    lines: [[[6.72, 0.5], [6.72, 1.19], [6.39, 1.19], [6.39, 1.42]], [[2.98, 0.86], [3.48, 0.84]], [[3.78, 0.83], [4.3, 0.81]]],
    struts: [
      // tailplane bracing
      [[6.42, 0.21], [6.57, 0.6], 0.04, 0.04], [[6.42, 0.21], [6.2, 0.6], 0.04, 0.04],
      [[6.41, 0.66], [6.45, 1.16], 0.04, 0.04], [[6.2, 0.66], [6.25, 1.1], 0.04, 0.04],
    ],
    gear: [
      { leg: [[1.85, -0.18], [1.48, -0.9]], w: [0.06, 0.05] },
      { leg: [[1.3, -0.15], [1.45, -0.95]], w: [0.11, 0.08], at: [1.45, -0.95], r: 0.31 },
      { leg: [[6.92, 0.12], [6.87, -0.02]], w: [0.06, 0.05], at: [6.86, -0.02], r: 0.1 },
    ],
    draw: [(k) => {
      const { sk } = k;
      // exposed cylinder heads of the radial, around the crankcase
      for (const z of [0.82, 0.6, 0.12, -0.05]) sk.smooth("core", [[0.31, z], [0.31, z + 0.13], [0.5, z + 0.13, "c"], [0.5, z, "c"]]);
      sk.smooth("plug", [[0.06, 0.47], [0.12, 0.55], [0.28, 0.55, "c"], [0.28, 0.39, "c"], [0.12, 0.39]]);
      // cabane and N interplane struts, then the upper wing
      for (const [a, b, w] of [[[1.3, 0.96], [1.3, 1.48], 0.05], [[1.75, 0.97], [1.6, 1.48], 0.05],
        [[2.0, 0.17], [1.37, 1.44], 0.07], [[2.8, 0.11], [2.17, 1.39], 0.07], [[2.14, 1.37], [2.0, 0.17], 0.05]]) leg(sk, a, b, w);
      k.surface(sk, "wing", { le: 1.15, root: 0, span: 9.8, cr: 1.52, ct: 1.52, sweep: 0, dih: 0, z: 1.54, t: [0.12, 0.12], inc: 3 });
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

F._raw_be36 = BE36; // TEMP
F._raw_m20 = M20; // TEMP
F._raw_be55 = BE55; // TEMP
export const families = F;
export const types = {
  C172: "c172", C152: "c150", C150: "c150", C182: "c182", C206: "c206", C208: "c208",
  P28A: "pa28", P28B: "pa28b", PA46: "pa46", P46T: "p46t",
  BE36: "be36", BE58: "be58", M20P: "m20", ST75: "st75", ZZB36: "_raw_be36", ZZB55: "_raw_be55", ZZM20: "_raw_m20", // TEMP
};
