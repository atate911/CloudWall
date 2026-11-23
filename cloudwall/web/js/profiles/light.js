// Light aircraft: pistons and single turboprops. Format: see ../profiles.js.
//
// These are drawn with `body` outlines (D = 1, so every point is in metres). The fin is part
// of the body outline: a light aircraft's tail cone is shallower than the renderer's built-in
// fin assumes, and the rudder of most of these hangs below the tail cone. Fixed gear, wheel
// spats, struts, rudder hinge lines and door outlines are drawn by the helpers below.
// A body outline does not stretch, so every family's L0 + over equals the types.csv length of
// the types mapped to it.
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------
// Each family lists its small parts as data in `parts`; the two functions below draw them,
// so a stretched copy (see stretch()) only has to move numbers.
//   doors   closed [s, z, flag] loops drawn with the door stroke
//   lines   [s, z] polylines drawn as thin lines (rudder hinge, panel joints)
//   struts  [[s, z] bottom, [s, z] top, width at bottom, width at top]
//   gear    {leg: [[s, z] top, [s, z] bottom], w: [w0, w1], at: [s, z] axle, r, spat: {f, a, t, b}}
//           spat: reach ahead of / behind the axle, top above / bottom below it; or {pts}: its traced outline;
//           shapes: [class, pts, closed?] traced parts of that gear (leg fairings, springs, forks), drawn
//           before its wheel, so they go with the gear when a variant swaps it
//   shapes, marks  [class, [[s, z, flag]...], closed?] smooth parts drawn last, over the wing and glass
//           (fairings, inlets, fittings, frames)
//   dots    [class, s, z, rx, ry] small round parts drawn last (beacons, fuel caps)
//   draw    extra functions (kit) => void, drawn last (fixed coordinates: prefer shapes, marks and dots,
//           which stretch() and scale() carry)

// A tapered leg or strut from [s0, z0] to [s1, z1], w0 / w1 wide (metres, along s).
const leg = (sk, [s0, z0], [s1, z1], w0 = 0.08, w1 = w0) =>
  sk.poly("strut", [[s0 - w0 / 2, z0], [s0 + w0 / 2, z0], [s1 + w1 / 2, z1], [s1 - w1 / 2, z1]]);

// A wheel with a teardrop spat (blunt in front, tapering aft) or a plain hub.
function wheel(sk, s, z, r, spat) {
  sk.ellipse("tire", s, z, r, r);
  if (!spat) { sk.ellipse("hub", s, z, r * 0.42, r * 0.42); return; }
  if (spat.pts) { sk.smooth("pant", spat.pts); return; }   // an outline traced off the type's drawing
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
    for (const [cls, pts, closed = true] of g.shapes || []) k.sk.smooth(cls, pts, closed);
    if (g.at) wheel(k.sk, g.at[0], g.at[1], g.r, g.spat);
  }
  for (const [cls, pts, closed = true] of p.shapes || []) k.sk.smooth(cls, pts, closed);
  for (const [cls, pts, closed = true] of p.marks || []) k.sk.smooth(cls, pts, closed);
  for (const [cls, s, z, rx, ry = rx] of p.dots || []) k.sk.ellipse(cls, s, z, rx, ry);
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
    wingSide: f.wingSide && f.wingSide.map(([c, pts, cl]) => [c, loop(pts), cl]),
    parts: {
      ...p, doors: (p.doors || []).map(loop), lines: (p.lines || []).map(loop),
      shapes: (p.shapes || []).map(([cls, pts, closed]) => [cls, loop(pts), closed]),
      marks: (p.marks || []).map(([c, pts, cl]) => [c, loop(pts), cl]),
      dots: (p.dots || []).map(([c, s, z, rx, ry]) => [c, ...mv([s, z]), rx, ry]),
      struts: (p.struts || []).map(([a, b, w0, w1]) => [mv(a), mv(b), w0, w1]),
      gear: (p.gear || []).map((g) => ({ ...g, leg: g.leg && g.leg.map(mv), at: g.at && mv(g.at), spat: g.spat && g.spat.pts ? { pts: loop(g.spat.pts) } : g.spat,
        shapes: g.shapes && g.shapes.map(([c, pts, cl]) => [c, loop(pts), cl]) })),
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
    wingSide: f.wingSide && f.wingSide.map(([c, pts, cl]) => [c, loop(pts), cl]),
    parts: {
      ...p, doors: (p.doors || []).map(loop), lines: (p.lines || []).map(loop),
      shapes: (p.shapes || []).map(([cls, pts, closed]) => [cls, loop(pts), closed]),
      marks: (p.marks || []).map(([c, pts, cl]) => [c, loop(pts), cl]),
      dots: (p.dots || []).map(([c, s, z, rx, ry = rx]) => [c, s * k, z * k, rx * k, ry * k]),
      struts: (p.struts || []).map(([a, b, w0, w1]) => [pt(a), pt(b), w0, w1]),
      gear: (p.gear || []).map((g) => ({ ...g, leg: g.leg && g.leg.map(pt), at: g.at && pt(g.at), r: g.r * k, spat: g.spat && g.spat.pts ? { pts: loop(g.spat.pts) } : g.spat,
        shapes: g.shapes && g.shapes.map(([c, pts, cl]) => [c, loop(pts), cl]) })),
    },
    ...more,
  };
}

// ---------- Cessna 172 ----------
// Reference: Cessna 172G Skyhawk "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_172G_Skyhawk_3-view_line_drawing.png, from the Wikipedia article Cessna 172),
// side view measured and scaled to the 172S overall length 8.28 m (types.csv 8.3). The 172G
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
  // the wing as the 3-view draws it: the outline over the cabin (the tip's upper surface and leading
  // edge, the trailing edge running down the dihedral to the root), the tip's lower surface, and the
  // fairing box over the root trailing edge
  wingSide: [
    ["wing", [[2.034, 1.296, "c"], [2.024, 1.311], [2.021, 1.347], [2.04, 1.373], [2.047, 1.406], [2.112, 1.474], [2.154, 1.52], [2.2, 1.549],
      [2.356, 1.575], [2.531, 1.585], [2.808, 1.585], [2.938, 1.578], [3.156, 1.559], [3.273, 1.542, "l"], [3.68, 1.354, "cl"], [3.686, 1.296, "cl"]]],
    ["hl", [[3.163, 1.533], [3.065, 1.51], [3.016, 1.497], [2.941, 1.497], [2.821, 1.477], [2.662, 1.464], [2.587, 1.448], [2.349, 1.445],
      [2.287, 1.448], [2.193, 1.468]], false],
    ["hl", [[3.208, 1.296, "c"], [3.208, 1.344], [3.224, 1.364, "l"], [3.673, 1.354]], false],
  ],
  eng: { kind: "none", nose: { s: 0.37, z: 0.625, d: 1.93, blades: 2 } },
  stab: { le: 1.75, z: 1.04, span: 3.45, root: 0.25, cr: 1.22, ct: 0.8, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    // cabin door with its handle and lock, baggage door with its handle, cowling access door
    doors: [rect(2.2, 3.08, 0.2, 1.22, 0.07), rect(2.215, 2.345, 0.774, 0.808, 0.017), rect(2.915, 3.013, 0.752, 0.81, 0.02),
      [[3.774, 0.889, "l"], [4.116, 0.889], [4.165, 0.84, "l"], [4.165, 0.332], [4.116, 0.288, "l"], [3.774, 0.259], [3.725, 0.303, "l"], [3.725, 0.84]],
      rect(4.05, 4.118, 0.488, 0.518, 0.015)],
    // rudder hinge; the nose cap, cowl split and the cowling's aft seam; dorsal fin to fin joint
    lines: [[[7.33, 0.76], [7.33, 1.1], [7.92, 2.31], [7.79, 2.39], [7.75, 2.5]],
      [[0.539, 0.801], [0.563, 0.635], [0.588, 0.391], [0.612, 0.205]], [[0.563, 0.63], [1.446, 0.63]],
      [[1.446, 0.976], [1.446, 0.508], [1.412, 0.41], [1.368, 0.293], [1.363, 0.069]], [[6.585, 1.328], [6.634, 1.123]],
      // the cabin roof's edge under the wing, the frame over the rear window, the windscreen's lower frame
      [[2.056, 1.285], [2.147, 1.269], [2.206, 1.276], [2.268, 1.269], [2.287, 1.246], [2.336, 1.243], [2.727, 1.246], [2.743, 1.256],
        [3.198, 1.282], [3.582, 1.276], [3.683, 1.266]],
      [[3.693, 1.302], [3.745, 1.298], [3.895, 1.259], [4.067, 1.201], [4.165, 1.155]],
      [[1.676, 0.889], [1.744, 0.862], [1.835, 0.843], [1.949, 0.833], [2.05, 0.833]]],
    struts: [[[2.05, 0.08], [2.2, 1.27], 0.12, 0.1]],
    gear: [
      // the wheel fairings as the 3-view draws them: pointed in front, the tail higher and rounded
      { leg: [[2.95, 0.06], [2.9, -0.2]], w: [0.1, 0.07], at: [2.89, -0.22], r: 0.2, spat: { pts: [[2.418, -0.181, "c"], [2.447, -0.136],
        [2.515, -0.087], [2.574, -0.052], [2.701, -0.005], [2.837, 0.024], [2.993, 0.026], [3.208, 0.01], [3.364, -0.025], [3.491, -0.052],
        [3.517, -0.084], [3.497, -0.136], [3.296, -0.224], [3.189, -0.255], [2.896, -0.267], [2.701, -0.273], [2.525, -0.238], [2.447, -0.201]] } },
      { leg: [[1.27, 0.01], [1.24, -0.39]], w: [0.07, 0.06], at: [1.24, -0.39], r: 0.175, spat: { pts: [[0.846, -0.341, "c"], [0.866, -0.312],
        [1.051, -0.214], [1.129, -0.185], [1.334, -0.185], [1.549, -0.244], [1.725, -0.312], [1.739, -0.346], [1.656, -0.419], [1.549, -0.449],
        [1.373, -0.462], [1.08, -0.449], [0.944, -0.415], [0.866, -0.366]] } },
    ],
    // as the 3-view draws them: the cowl's inlet lip and the small hook on the lower cowl, the access
    // door (its top edge is the cowl line), the strut-foot fairing, the step on the main leg, the nose
    // leg's torque link, the fuel filler on the wing, the optional fin-tip beacon, the tail tie-down ring
    draw: [({ sk }) => {
      sk.smooth("hl", [[0.436, 0.703], [0.485, 0.635], [0.5, 0.576], [0.475, 0.527], [0.431, 0.498]], false);
      sk.smooth("hl", [[0.768, 0.171], [0.802, 0.205], [0.841, 0.186], [0.846, 0.137], [0.807, 0.113]], false);
      sk.smooth("door", [[1.051, 0.937, "l"], [1.051, 0.732], [1.08, 0.703, "l"], [1.305, 0.703], [1.334, 0.732, "l"], [1.334, 0.962]], false);
      sk.ellipse("pant", 2.071, 0.093, 0.171, 0.063);
      sk.smooth("strut", [[2.847, 0.039, "c"], [2.867, 0.152, "cl"], [3.032, 0.152, "c"], [3.003, 0.039, "cl"]]);
      sk.poly("strut", [[1.198, -0.029], [1.315, -0.029], [1.363, -0.087], [1.403, -0.117], [1.393, -0.175], [1.285, -0.195], [1.198, -0.185], [1.188, -0.097]]);
      sk.ellipse("inlet", 2.408, 1.523, 0.022, 0.02);
      sk.poly("hl", [[2.164, 1.35], [2.291, 1.341], [2.307, 1.334]], false);   // the strut's top fitting
      sk.ellipse("hub", 7.717, 2.489, 0.049, 0.063);
      sk.ellipse("tire", 7.278, 0.713, 0.035, 0.035);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 150 / 152 ----------
// Reference: Cessna 150F "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_150F_3-view_line_drawing.png, Wikipedia article Cessna 150), side view drawn
// with the bullet spinner (23 ft 9 in), scaled to 7.3 m (types.csv; 152 7.34 m, 150M 7.29 m).
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
  // the wing as the 3-view draws it: the outline over the cabin (the tip's upper surface and leading
  // edge, the trailing edge running down to the root), the tip's lower surface, a line inside the
  // trailing edge, and the fairing over the root trailing edge
  wingSide: [
    ["wing", [[1.682, 1.085, "c"], [1.679, 1.156], [1.685, 1.189], [1.703, 1.207], [1.736, 1.246], [1.77, 1.264], [1.784, 1.279], [1.817, 1.303],
      [1.874, 1.321], [1.983, 1.334], [2.257, 1.346], [2.438, 1.343], [2.561, 1.334], [2.793, 1.303], [2.968, 1.265], [3.04, 1.237],
      [3.127, 1.208], [3.239, 1.152], [3.284, 1.132, "cl"], [3.295, 1.08, "cl"]]],
    ["hl", [[2.94, 1.274], [2.854, 1.28], [2.832, 1.262], [2.796, 1.249], [2.757, 1.253], [2.583, 1.228], [2.414, 1.216], [2.1, 1.21], [1.941, 1.225]], false],
    ["hl", [[2.829, 1.226], [2.935, 1.183]], false],
    ["hl", [[2.766, 1.114], [3.007, 1.129]], false],
    ["hl", [[2.995, 1.156], [3.016, 1.135], [3.04, 1.132], [3.064, 1.105], [3.134, 1.105], [3.152, 1.09], [3.175, 1.09]], false],
    ["hl", [[3.071, 1.132], [3.239, 1.145], [3.257, 1.132], [3.284, 1.132]], false],
  ],
  eng: { kind: "none", nose: { s: 0.41, z: 0.555, d: 1.75, blades: 2 } },
  stab: { le: 1.53, z: 0.725, span: 3.05, root: 0.22, cr: 1.15, ct: 0.8, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    // cabin door with its handle
    doors: [rect(1.95, 2.67, 0.27, 1.05, 0.07), rect(2.391, 2.464, 0.585, 0.616, 0.015)],
    // rudder hinge; the nose cap, cowl split and the cowling's aft seam; dorsal fin to fin joint; the
    // fin cap's joint; the cabin roof's edge under the wing; the frame over the rear window; the strut's
    // top fitting
    lines: [[[6.39, 0.5], [6.39, 0.8], [6.9, 1.74], [6.76, 1.85], [6.71, 1.95]],
      [[0.544, 0.719], [0.55, 0.568], [0.55, 0.188], [0.546, 0.152]], [[0.553, 0.525], [0.969, 0.469], [1.038, 0.46], [1.201, 0.444]],
      [[1.206, 0.8], [1.21, 0.0]], [[5.913, 1.052], [5.922, 0.83]],
      [[6.608, 1.872], [6.615, 1.865], [6.802, 1.865], [7.055, 1.866], [7.244, 1.86]],
      [[1.736, 1.113], [1.802, 1.09], [1.865, 1.095], [1.962, 1.09], [1.983, 1.065], [2.38, 1.063], [2.579, 1.072], [2.682, 1.077],
        [2.827, 1.081], [3.037, 1.099]],
      [[2.669, 1.029], [2.845, 1.041], [2.886, 1.039], [2.938, 1.054], [3.098, 1.069], [3.137, 1.078]],
      [[1.736, 1.201], [1.772, 1.183], [1.799, 1.185]], [[1.851, 1.246], [1.908, 1.231]]],
    struts: [[[1.79, 0.19], [1.93, 1.07], 0.11, 0.1]],
    gear: [
      // the wheel fairings as the 3-view draws them: pointed in front, the tail higher and rounded
      { leg: [[2.56, 0.03], [2.47, -0.3]], w: [0.09, 0.06], at: [2.46, -0.34], r: 0.18, spat: { pts: [[1.999, -0.227, "c"], [2.038, -0.181],
        [2.116, -0.132], [2.234, -0.088], [2.357, -0.058], [2.493, -0.048], [2.649, -0.061], [2.827, -0.091], [3.065, -0.148], [3.078, -0.176, "c"],
        [3.038, -0.226], [2.918, -0.287], [2.794, -0.328], [2.523, -0.344], [2.264, -0.344], [2.15, -0.335], [2.05, -0.284]] } },
      { leg: [[1.05, 0.0], [1.0, -0.4]], w: [0.07, 0.06], at: [1.0, -0.41], r: 0.15, spat: { pts: [[0.562, -0.39, "c"], [0.698, -0.3], [0.761, -0.275],
        [0.813, -0.257], [0.951, -0.236], [1.011, -0.242], [1.122, -0.257], [1.246, -0.288], [1.339, -0.317], [1.403, -0.338], [1.439, -0.362],
        [1.43, -0.394], [1.378, -0.426], [1.292, -0.462], [1.231, -0.483], [1.114, -0.507], [0.954, -0.516], [0.818, -0.501], [0.743, -0.501],
        [0.659, -0.465], [0.58, -0.42]] } },
    ],
    // as the 3-view draws them: the small loop on the lower cowl, the fuel filler on the wing, the step on
    // the main leg, the nose leg's torque link, the optional fin-tip beacon
    draw: [({ sk }) => {
      sk.ellipse("hl", 0.779, 0.044, 0.036, 0.023);
      sk.ellipse("hl", 2.106, 1.289, 0.036, 0.027);
      sk.smooth("strut", [[2.487, -0.046, "c"], [2.523, 0.06], [2.541, 0.078, "c"], [2.637, 0.081, "c"], [2.643, 0.033], [2.604, -0.037, "c"]]);
      sk.poly("strut", [[0.975, -0.04], [1.047, -0.031], [1.047, -0.064], [1.089, -0.094], [1.113, -0.128], [1.098, -0.155], [1.038, -0.173],
        [1.005, -0.209], [0.972, -0.212], [0.957, -0.188], [0.957, -0.155], [0.969, -0.101], [0.962, -0.053]]);
      sk.ellipse("hub", 6.705, 1.976, 0.045, 0.059);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 182 Skylane ----------
// Reference: Cessna 182M Skylane "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_182M_Skylane_3-view_line_drawing.png, Wikipedia article Cessna 182 Skylane),
// side view scaled from the 182M's 28 ft 0.5 in to the 182T's 8.84 m (types.csv 8.8). Larger
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
  // the wing as the 3-view draws it: the outline over the cabin (the tip's upper surface and leading
  // edge, the trailing edge running down to the root), the tip's lower surface and the step in its
  // upper line, a line inside the trailing edge, and the fairing box over the root trailing edge
  wingSide: [
    ["wing", [[2.039, 1.37, "c"], [2.034, 1.427], [2.044, 1.451], [2.136, 1.547], [2.205, 1.611], [2.241, 1.625], [2.353, 1.647], [2.464, 1.655],
      [2.718, 1.657], [3.12, 1.63], [3.163, 1.606], [3.314, 1.61], [3.37, 1.59, "l"], [3.746, 1.412, "cl"], [3.755, 1.37, "cl"]]],
    ["hl", [[2.206, 1.551], [2.287, 1.53], [2.4, 1.521], [2.566, 1.522], [3.018, 1.563], [3.113, 1.578]], false],
    ["hl", [[2.982, 1.602], [3.148, 1.603]], false],
    ["hl", [[3.103, 1.528], [3.227, 1.469]], false],
    ["hl", [[3.264, 1.37, "c"], [3.264, 1.403], [3.315, 1.415, "l"], [3.746, 1.412]], false],
  ],
  eng: { kind: "none", nose: { s: 0.33, z: 0.675, d: 2.03, blades: 2 } },
  stab: { le: 2.06, z: 1.065, span: 3.56, root: 0.25, cr: 1.3, ct: 0.88, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    // cabin door with its handle and lock, the baggage door, the cowling's round-topped access door
    doors: [rect(2.2, 3.15, 0.2, 1.3, 0.07), rect(2.297, 2.394, 0.796, 0.843, 0.02), rect(2.977, 3.068, 0.783, 0.809, 0.013),
      [[3.932, 0.905, "l"], [4.25, 0.907], [4.309, 0.851, "l"], [4.313, 0.414], [4.264, 0.345, "l"], [3.975, 0.309], [3.899, 0.361, "l"], [3.885, 0.848]],
      [[1.17, 0.737, "c"], [1.166, 0.811], [1.18, 0.853], [1.227, 0.878], [1.275, 0.854], [1.286, 0.812], [1.286, 0.743, "c"]]],
    // rudder hinge; the nose cap, cowl split and the cowling's aft seam; the access door's latch and the
    // three chevrons on the lower cowl; the cabin roof's edge under the wing and the frames round the
    // rear windows
    lines: [[[7.5, 1.17], [8.33, 2.58], [8.17, 2.59], [8.16, 2.71]],
      [[0.594, 0.889], [0.605, 0.751], [0.628, 0.532], [0.651, 0.232], [0.647, 0.204]], [[0.62, 0.677], [1.4, 0.678]],
      [[1.408, 1.052], [1.41, 0.763], [1.403, 0.678], [1.411, 0.045]], [[1.227, 0.848], [1.228, 0.801]],
      [[1.172, 0.303], [1.148, 0.273], [1.173, 0.242]], [[1.241, 0.303], [1.217, 0.273], [1.242, 0.243]], [[1.31, 0.303], [1.286, 0.274], [1.31, 0.243]],
      [[2.374, 1.305], [3.037, 1.309], [3.09, 1.327], [3.206, 1.324], [3.273, 1.342], [3.319, 1.336], [3.75, 1.342], [3.778, 1.37], [4.008, 1.326], [4.138, 1.291]],
      [[3.838, 1.286], [3.86, 1.268], [4.026, 1.223], [4.238, 1.154]], [[4.198, 1.274], [4.446, 1.198]]],
    struts: [[[2.13, 0.18], [2.28, 1.38], 0.13, 0.11]],
    gear: [
      // the wheel fairings as the 3-view draws them: pointed in front, the tail higher and rounded
      { leg: [[3.0, 0.1], [3.0, -0.2]], w: [0.1, 0.07], at: [3.01, -0.24], r: 0.19, spat: { pts: [[2.568, -0.155, "c"], [2.643, -0.041], [2.787, 0.03],
        [2.924, 0.059], [3.147, 0.057], [3.246, 0.058], [3.514, 0.041], [3.588, 0.0], [3.631, -0.053, "c"], [3.515, -0.139], [3.392, -0.192],
        [3.219, -0.236], [2.965, -0.264], [2.764, -0.256], [2.619, -0.218]] } },
      { leg: [[1.27, 0.05], [1.22, -0.42]], w: [0.08, 0.06], at: [1.22, -0.44], r: 0.16, spat: { pts: [[0.859, -0.393, "c"], [0.922, -0.324],
        [1.028, -0.259], [1.158, -0.206], [1.242, -0.191], [1.316, -0.197], [1.483, -0.22], [1.642, -0.248], [1.687, -0.277], [1.724, -0.319],
        [1.727, -0.354, "c"], [1.646, -0.422], [1.508, -0.458], [1.273, -0.486], [1.026, -0.482], [0.909, -0.437]] } },
    ],
    // as the 3-view draws them: the baggage door's handle, the step on the strut and the strut-foot
    // fairing, the step on the main leg, the nose leg's torque link, the optional fin-tip beacon and the
    // tail tie-down ring
    draw: [({ sk }) => {
      sk.ellipse("tire", 4.231, 0.618, 0.016, 0.016);
      sk.poly("strut", [[2.231, 0.399], [2.284, 0.399], [2.284, 0.341], [2.231, 0.341]]);
      sk.ellipse("pant", 2.153, 0.123, 0.143, 0.047);
      sk.smooth("strut", [[2.942, 0.07, "c"], [2.945, 0.147], [2.963, 0.17, "c"], [3.026, 0.171, "c"], [3.048, 0.15], [3.048, 0.07, "c"]]);
      sk.poly("strut", [[1.273, -0.043], [1.362, -0.032], [1.408, -0.067], [1.45, -0.109], [1.461, -0.144], [1.295, -0.149], [1.267, -0.12], [1.267, -0.067]]);
      sk.ellipse("hub", 8.099, 2.76, 0.037, 0.045);
      sk.ellipse("tire", 7.512, 0.76, 0.032, 0.032);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 206 Stationair ----------
// Reference: Cessna TU206A Super Skywagon "Principal Dimensions" 3-view (Wikimedia Commons,
// File:Cessna_TU206A_Super_Skywagon_3-view_line_drawing.png, Wikipedia article Cessna 206),
// a right-side view showing the double cargo doors aft of the wing; scaled from 27 ft 9 in to
// the T206H's 8.61 m (types.csv 8.6). Long nose, no rear window, the big double door.
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
  // the wing as the 3-view draws it: the outline over the cabin (the root fairing's front and the
  // leading edge, the tip's upper surface, the trailing edge running down to the root), the tip's lower
  // surface, and the fairing box over the root trailing edge
  wingSide: [
    ["wing", [[1.872, 1.31, "c"], [1.983, 1.349], [2.035, 1.364], [2.119, 1.462], [2.161, 1.536], [2.232, 1.582], [2.29, 1.597], [2.435, 1.611],
      [2.564, 1.611], [2.793, 1.599], [3.323, 1.538], [3.408, 1.51], [3.475, 1.478, "l"], [3.705, 1.369, "cl"], [3.721, 1.31, "cl"]]],
    ["hl", [[3.352, 1.481], [3.085, 1.466], [3.036, 1.463], [2.516, 1.467], [2.369, 1.488], [2.231, 1.526]], false],
    ["hl", [[3.222, 1.31, "c"], [3.222, 1.407], [3.321, 1.422], [3.521, 1.426], [3.595, 1.423], [3.647, 1.398]], false],
  ],
  eng: { kind: "none", nose: { s: 0.28, z: 0.67, d: 2.0, blades: 3 } },
  stab: { le: 1.95, z: 0.98, span: 3.66, root: 0.25, cr: 1.25, ct: 0.88, sweep: 9, dih: 0, thick: 0.09 },
  parts: {
    // the double cargo doors and their hinge plates; the cowling's access door
    doors: [rect(3.13, 3.74, 0.11, 1.22, 0.07), rect(3.76, 4.31, 0.14, 1.22, 0.07),
      rect(4.239, 4.345, 0.85, 0.899, 0.012), rect(4.238, 4.365, 0.404, 0.457, 0.012), rect(3.128, 3.186, 0.792, 0.85, 0.01),
      [[1.546, 0.673], [1.557, 0.683], [1.596, 0.691], [1.645, 0.68], [1.652, 0.673], [1.659, 0.607], [1.649, 0.582], [1.621, 0.564],
        [1.578, 0.561], [1.547, 0.575], [1.544, 0.582], [1.543, 0.666]]],
    // rudder hinge; the nose cap's seams, the cowl split and the cowling's aft seam; the three chevrons on
    // the lower cowl; the cabin roof's edge under the wing; the cargo door's handle stem and its lower latch
    lines: [[[7.53, 1.17], [8.27, 2.5], [8.1, 2.5], [8.1, 2.64]],
      [[0.534, 0.862], [0.549, 0.792], [0.574, 0.725], [0.659, 0.409], [0.673, 0.388], [0.706, 0.258], [0.71, 0.192]],
      [[0.544, 0.188], [0.71, 0.192]], [[0.47, 0.377], [0.523, 0.209], [0.534, 0.198], [0.562, 0.117]],
      [[0.677, 0.388], [0.719, 0.399], [0.954, 0.417], [1.091, 0.439], [1.189, 0.45], [1.277, 0.454], [1.411, 0.472]],
      [[1.538, 1.021], [1.539, 0.901], [1.522, 0.827], [1.508, 0.796], [1.452, 0.574], [1.418, 0.476]],
      [[1.201, 0.187], [1.187, 0.169], [1.187, 0.145], [1.198, 0.127]], [[1.272, 0.163], [1.265, 0.138], [1.275, 0.11]],
      [[1.349, 0.145], [1.342, 0.138], [1.342, 0.11], [1.353, 0.093]],
      [[2.359, 1.263], [2.401, 1.267], [2.521, 1.257], [2.858, 1.258], [2.984, 1.273], [3.198, 1.281], [3.237, 1.295], [3.265, 1.284],
        [3.363, 1.285], [3.693, 1.304]],
      [[3.192, 0.311], [3.207, 0.188], [3.214, 0.178]], [[3.414, 0.147], [3.421, 0.112], [3.418, 0.042], [3.425, 0.017]]],
    struts: [[[2.12, 0.12], [2.29, 1.3], 0.13, 0.11]],
    gear: [
      // the wheel fairings as the 3-view draws them
      { leg: [[3.05, 0.0], [3.02, -0.3]], w: [0.1, 0.07], at: [3.02, -0.38], r: 0.2, spat: { pts: [[2.458, -0.227, "c"], [2.505, -0.141], [2.611, -0.111],
        [2.73, -0.095], [2.839, -0.059], [2.987, -0.038], [3.113, -0.037], [3.327, -0.05], [3.488, -0.078], [3.636, -0.115], [3.647, -0.143, "c"],
        [3.605, -0.214], [3.531, -0.249], [3.426, -0.295], [3.3, -0.321], [3.065, -0.325], [2.826, -0.337], [2.756, -0.316], [2.64, -0.264], [2.538, -0.238]] } },
      { leg: [[1.32, 0.0], [1.25, -0.45]], w: [0.08, 0.06], at: [1.25, -0.48], r: 0.16, spat: { pts: [[0.858, -0.366, "c"], [0.933, -0.295],
        [1.041, -0.246], [1.245, -0.199], [1.326, -0.201], [1.4, -0.23], [1.544, -0.268], [1.727, -0.341], [1.737, -0.365, "c"], [1.674, -0.423],
        [1.548, -0.465], [1.39, -0.487], [1.19, -0.473], [1.021, -0.468], [0.916, -0.434]] } },
    ],
    // as the 3-view draws them: the cowl flap under the cowling, the fuel filler on the wing, the strut's
    // top fitting and its foot fairing, the cargo door's handle, the step on the main leg, the nose leg's
    // torque link, the optional fin-tip beacon and the tail tie-down ring
    draw: [({ sk }) => {
      sk.smooth("hl", [[1.118, 0.025, "c"], [1.111, 0.035], [1.11, 0.07], [1.128, 0.085, "c"], [1.275, 0.047], [1.381, 0.033], [1.395, 0.023], [1.392, -0.002]], false);
      sk.ellipse("hl", 2.62, 1.517, 0.037, 0.021);
      sk.smooth("hl", [[2.404, 1.337], [2.387, 1.358], [2.32, 1.372], [2.257, 1.378], [2.19, 1.375]], false);
      sk.smooth("pant", [[1.97, 0.078], [1.996, 0.113], [2.051, 0.131], [2.199, 0.106], [2.255, 0.132], [2.286, 0.117], [2.339, 0.08], [2.315, 0.041],
        [2.196, 0.001], [2.08, -0.003], [2.031, 0.011]]);
      sk.smooth("strut", [[3.09, 0.332], [3.09, 0.349], [3.104, 0.36], [3.188, 0.364], [3.269, 0.357], [3.276, 0.347], [3.273, 0.329], [3.269, 0.326],
        [3.195, 0.315], [3.101, 0.321]]);
      sk.smooth("strut", [[2.979, -0.03, "c"], [2.979, 0.04], [2.989, 0.057, "c"], [3.098, 0.058, "c"], [3.105, 0.051], [3.105, 0.02], [3.092, -0.03, "c"]]);
      sk.poly("strut", [[1.269, -0.027], [1.336, -0.037], [1.388, -0.055], [1.459, -0.139], [1.445, -0.15], [1.301, -0.153], [1.273, -0.132], [1.276, -0.069]]);
      sk.ellipse("hub", 7.982, 2.67, 0.032, 0.035);
      sk.ellipse("tire", 7.366, 0.7, 0.027, 0.027);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cessna 208 Caravan ----------
// Reference: "Caravan three views" (Wikimedia Commons, File:Caravan_three_views.png, Wikipedia
// article Cessna 208 Caravan): the 208 side view (11.46 m, types.csv 11.5) for the airframe and
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
  // the wing as the 208's side view draws it: the lens over the roof, its root reaching down the cabin
  // side to the window tops, with the tip's lower surface, a trailing-edge line and the fuel cap inside
  wingSide: [
    ["wing", [[3.946, 1.739, "c"], [4.122, 2.014], [4.372, 2.063], [4.998, 2.037], [5.223, 1.986], [5.397, 1.811], [5.522, 1.635, "c"],
      [5.472, 1.523, "l"], [4.246, 1.501], [4.046, 1.564]]],
    ["hl", [[4.122, 1.939], [4.622, 1.913], [5.072, 1.911]], false],
    ["hl", [[4.872, 1.912], [5.046, 1.486]], false],
    ["inlet", [[4.385, 1.976, "c"], [4.422, 2.026, "c"], [4.46, 1.976, "c"]]],
  ],
  eng: { kind: "none", nose: { s: 0.47, z: 0.82, d: 2.5, blades: 3 } },
  stab: { le: 1.5, z: 1.5, span: 6.25, root: 0.4, cr: 1.35, ct: 0.9, sweep: 6, dih: 0, thick: 0.1 },
  parts: {
    doors: [
      [[2.98, 0.42, "c"], [3.95, 0.42, "c"], [3.95, 1.5, "c"], [3.4, 1.52, "c"], [2.98, 0.95, "c"]],
      rect(5.65, 6.92, 0.38, 1.62, 0.08), [[5.65, 1.0], [6.92, 1.0]],
      rect(2.8, 3.6, -0.22, 0.02, 0.06), rect(3.8, 4.55, -0.22, 0.02, 0.06), rect(5.15, 5.95, -0.22, 0.02, 0.06),
      // from the 208 side view: the fairing ahead of the wing root, over the windscreen
      [[3.421, 1.816, "l"], [3.871, 1.815], [3.896, 1.764, "l"], [3.896, 1.739], [3.871, 1.714, "l"], [3.421, 1.716], [3.396, 1.766, "l"], [3.396, 1.791]],
    ],
    lines: [[[1.85, 0.07], [7.25, 0.18]], [[10.62, 1.05], [11.0, 3.3], [10.88, 3.32], [10.88, 3.8]]],
    struts: [[[4.05, 0.3], [3.98, 1.86], 0.15, 0.13]],
    // from the 208 side view: the strut's top and foot fittings, the two hinges on the crew door's front edge
    shapes: [
      ["pant", [[3.871, 1.589], [3.996, 1.639], [4.321, 1.601], [4.371, 1.538], [4.246, 1.501], [3.971, 1.514]]],
      ["pant", [[3.968, 0.438], [4.168, 0.525], [4.368, 0.437], [4.168, 0.35]]],
      ["door", [[2.88, 1.016], [2.98, 1.054], [3.08, 1.016], [2.98, 0.979]]],
      ["door", [[2.88, 0.491], [2.98, 0.528], [3.08, 0.49], [2.98, 0.453]]],
    ],
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
// 208B Grand Caravan (most Caravans flying, the FedEx feeders among them): 1.17 m longer, the
// plug behind the last cabin window, with one more window (Wikipedia, Cessna 208 Caravan).
F.c208b = stretch(F.c208, 7.5, 1.17);
F.c208b.glass = [...F.c208b.glass, [[7.57, 1.04], [7.57, 1.4], [8.07, 1.4], [8.07, 1.04]]];

// ---------- Piper PA-28 Cherokee / Warrior / Archer / Dakota ----------
// Reference: Piper PA-28-181 Cherokee Archer II 3-view (Wikimedia Commons,
// File:Piper_PA-28-181_Cherokee_Archer_II_3-view_line_drawing.png, Wikipedia article Piper
// PA-28 Cherokee), side view 23 ft 9.6 in, scaled to 7.3 m (types.csv P28A). Low tapered
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
  // the wing as the 3-view draws it: the tip aerofoil high on the dihedral, its leading and trailing
  // edges running down to the root, the root aerofoil with its forward fillet; inside, the tip's lower
  // surface, the root's upper line along the fuselage side and the end of the flap
  wingSide: [
    ["wing", [[1.802, 0.107, "c"], [1.947, 0.141], [2.085, 0.162, "l"], [2.085, 0.307, "l"], [2.321, 0.665], [2.445, 0.72], [2.721, 0.74],
      [2.997, 0.712], [3.204, 0.664], [3.39, 0.608, "cl"], [3.652, 0.291, "cl"], [3.665, -0.02, "cl"], [2.306, -0.039], [2.03, -0.011], [1.857, 0.024]]],
    ["hl", [[2.321, 0.665], [2.41, 0.596], [2.721, 0.547], [2.997, 0.554], [3.238, 0.581], [3.39, 0.608]], false],
    ["hl", [[2.085, 0.307], [2.444, 0.244], [2.996, 0.236], [3.341, 0.27], [3.652, 0.291]], false],
    ["hl", [[2.085, 0.134], [2.582, 0.044], [2.996, 0.029], [3.341, 0.056]], false],
    ["hl", [[3.224, 0.56, "c"], [3.341, 0.284, "c"], [3.355, -0.02]], false],
  ],
  parts: {
    doors: [[[1.86, 0.62, "c"], [2.13, 1.13, "c"], [2.78, 1.13, "c"], [2.78, 0.62, "c"]]],
    // stabilator pivot and rudder hinge; from the 3-view: the cowl's top seam, split line and aft seam,
    // the fin-tip cap
    lines: [[[6.66, 0.4], [6.66, 0.8], [6.98, 2.0]],
      [[0.361, 0.682], [0.809, 0.723]], [[0.388, 0.406], [1.368, 0.377]], [[1.396, 0.791], [1.347, 0.377], [1.319, -0.051]],
      [[6.705, 2.039], [7.229, 1.983]]],
    // the cowl's inlet lip, traced from the 3-view
    draw: [({ sk }) => sk.smooth("hl", [[0.34, 0.64], [0.388, 0.585], [0.416, 0.489], [0.388, 0.413], [0.346, 0.378]], false)],
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
// view 28.4 ft (8.66 m) measured, drawn scaled to the M350's 8.81 m (types.csv 8.8). Pressurised
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
  // the wing as the 3-view draws it: the tip aerofoil, the leading edge running down the dihedral, the
  // trailing edge to the root, with the tip's lower surface and the flap's edge and end inside
  wingSide: [
    ["wing", [[2.931, 0.516], [2.973, 0.566], [3.056, 0.591], [3.346, 0.591], [3.596, 0.567], [3.845, 0.534, "cl"], [4.211, 0.044, "c"],
      [4.011, 0.011], [3.679, -0.048], [3.347, -0.073, "l"], [3.015, -0.057], [2.816, -0.007], [2.741, 0.059], [2.766, 0.159, "l"]]],
    ["hl", [[2.931, 0.516], [3.014, 0.475], [3.347, 0.467], [3.679, 0.492], [3.845, 0.534]], false],
    ["hl", [[3.679, 0.492, "c"], [3.853, 0.193, "c"], [4.011, -0.014]], false],
    ["hl", [[3.853, 0.193], [4.053, 0.218]], false],
  ],
  parts: {
    // cabin door with its split; from the 3-view, the forward baggage door with its handle
    doors: [rect(4.26, 4.96, 0.0, 1.14, 0.07), [[4.26, 0.56], [4.96, 0.56]],
      [[1.611, 0.739, "l"], [2.026, 0.739], [2.076, 0.69, "l"], [2.076, 0.158], [2.027, 0.108, "l"], [1.611, 0.108], [1.562, 0.158, "l"], [1.561, 0.689]]],
    // rudder hinge; from the 3-view: the cowl's nose-ring seam, the baggage door handle, the rudder's top
    // and foot
    lines: [[[7.42, 1.0], [8.27, 2.47]], [[0.581, 0.655], [0.582, 0.156]], [[1.852, 0.216], [1.836, 0.158]],
      [[7.928, 2.506], [8.26, 2.49]], [[7.44, 1.061], [7.465, 1.011], [7.913, 0.995]]],
    // from the 3-view: the D-shaped inlet in the nose ring, the box it draws under the nose, the loop
    // under the tail cone
    shapes: [
      ["inlet", [[0.481, 0.588, "cl"], [0.54, 0.588], [0.581, 0.505], [0.565, 0.439], [0.49, 0.422, "cl"]]],
      ["pant", [[1.03, -0.02, "cl"], [1.03, -0.225], [1.055, -0.242, "l"], [2.069, -0.24], [2.093, -0.216, "l"], [2.093, -0.02, "cl"]]],
      ["hl", [[7.582, 0.638], [7.706, 0.555], [7.814, 0.538], [7.872, 0.596]], false],
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.pa46 = scale(PA46, 8.8 / 8.66);
F.p46t = stretch(F.pa46, 1.0, 0.2, {
  kind: "turboprop", eng: { kind: "none", nose: { s: 0.39, z: 0.483, d: 2.06, blades: 4 } },
});
// the box under the nose is from the piston 310P's 3-view, so the turbine keeps only the other parts
F.p46t.parts = { ...F.p46t.parts, shapes: F.p46t.parts.shapes.filter(([cls]) => cls !== "pant"),
  draw: [(k) => k.sk.ellipse("inlet", 1.05, 0.5, 0.11, 0.08)] };

// ---------- Beechcraft A36 / G36 Bonanza ----------
// Reference: Beechcraft A36 Bonanza 3-view (Wikimedia Commons,
// File:Beechcraft_A36_Bonanza_3-view_line_drawing.png, Wikipedia article Beechcraft Bonanza),
// side view 26 ft 8 in measured; the 1984-on A36 and G36 are 27 ft 6 in (types.csv 8.4), the
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
  // the wing as the 3-view draws it: the pointed root fillet curving up into the root fairing, the
  // flap's trailing edge at the root; the flap hinge and its cross line, the fillet's leading-edge panel
  wingSide: [
    ["wing", [[1.897, 0.227, "c"], [2.038, 0.319], [2.127, 0.354], [2.186, 0.363], [2.239, 0.415], [2.257, 0.484], [2.274, 0.518], [2.321, 0.604],
      [2.38, 0.662], [2.428, 0.685], [2.535, 0.712], [2.734, 0.718], [3.038, 0.702], [3.217, 0.679], [3.315, 0.659], [3.405, 0.651],
      [3.434, 0.631, "l"], [4.042, 0.172], [4.083, 0.136, "c"], [4.095, 0.1], [3.902, 0.076], [3.724, 0.065], [3.36, 0.043], [3.011, 0.041],
      [2.639, 0.04], [2.517, 0.047], [2.278, 0.078], [2.193, 0.093], [2.079, 0.126], [1.927, 0.183]]],
    ["hl", [[3.243, 0.635, "l"], [3.746, 0.065]], false],
    ["hl", [[3.394, 0.438], [3.505, 0.44], [3.672, 0.448]], false],
    ["hl", [[1.918, 0.217], [2.086, 0.228], [2.122, 0.246], [2.145, 0.266], [2.175, 0.321], [2.186, 0.363]], false],
  ],
  eng: { kind: "none", nose: { s: 0.38, z: 0.625, d: 2.03, blades: 3 } },
  stab: { le: 1.38, z: 0.93, span: 3.71, root: 0.25, cr: 1.1, ct: 0.75, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    // front door; the cowling's louvred outlet; (the aft "club" doors are on the far side: dashed in the 3-view)
    doors: [[[1.97, 0.45, "c"], [1.97, 0.88, "c"], [2.29, 1.38, "c"], [2.95, 1.38, "c"], [2.95, 0.45, "c"]],
      rect(3.61, 4.19, 0.25, 1.3, 0.06), rect(4.21, 4.79, 0.25, 1.3, 0.06),
      [[0.637, 0.468, "c"], [1.046, 0.474, "c"], [1.049, 0.244, "c"], [0.64, 0.238, "c"]]],
    // rudder hinge; the nose bowl seam, the upper cowl panel and its aft seam, the outlet's louvres; the
    // dorsal fin's joint with the fuselage top and the panel at its foot
    lines: [[[7.42, 1.05], [7.78, 2.22], [7.52, 2.27], [7.52, 2.42]],
      [[0.508, 0.807], [0.523, 0.688], [0.533, 0.56], [0.545, 0.305], [0.562, 0.067]],
      [[0.55, 0.552], [0.789, 0.555], [1.483, 0.587], [1.473, 0.97]],
      [[0.766, 0.381], [0.753, 0.351], [0.758, 0.321]], [[0.813, 0.381], [0.8, 0.351], [0.805, 0.321]],
      [[0.859, 0.382], [0.847, 0.352], [0.852, 0.322]], [[0.906, 0.383], [0.894, 0.353], [0.899, 0.323]],
      [[5.42, 1.24], [5.889, 1.2], [6.401, 1.155], [6.913, 1.1], [7.42, 1.05]],
      [[6.103, 1.168], [6.102, 1.223], [6.442, 1.235], [6.452, 1.177]]],
    // as the 3-view draws them: the storm window in the front side window, the fixed step behind the
    // wing; the fuel filler on the wing root, the beacon on the fin tip
    marks: [["pant", [[2.101, 1.069, "c"], [2.365, 1.073, "c"], [2.368, 0.911, "c"], [2.104, 0.907, "c"]]],
      ["glass", [[2.136, 1.035, "c"], [2.332, 1.038, "c"], [2.333, 0.945, "c"], [2.137, 0.942, "c"]]],
      ["strut", [[4.262, 0.105, "c"], [4.339, 0.106, "c"], [4.342, -0.099, "c"], [4.265, -0.1, "c"]]],
      ["strut", [[4.121, -0.102, "c"], [4.308, -0.074], [4.504, -0.105, "c"], [4.411, -0.157], [4.309, -0.167], [4.198, -0.16]]]],
    dots: [["inlet", 2.717, 0.648, 0.05, 0.025], ["hub", 7.471, 2.504, 0.05, 0.05]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.be36 = stretch(BE36, 1.2, 0.27);

// ---------- Beechcraft Baron 58 ----------
// Reference: Beechcraft D55 Baron 3-view (Wikimedia Commons,
// File:Beechcraft_D55_Baron_3-view_line_drawing.png, Wikipedia article Beechcraft Baron),
// side view 28.98 ft (8.83 m) measured. The Baron 58 (9.09 m, types.csv 9.1) is the 55 with the
// cabin lengthened 10 in by moving the windscreen, panel and front seats forward, and the
// double "club" doors aft on the right: drawn as the 55 with a 0.26 m plug ahead of the wing
// and the 58's window and door layout. Pointed baggage nose, wing-mounted IO-550 nacelles
// with three-blade props, straight swept fin, retractable gear (drawn retracted).
// From the D55 3-view, drawn over the renderer's nacelle: the cowl's front ring, upper cowl panel
// (a double seam) and its aft seam, the cowl split, the oil-cooler bump on top, the cowl outlet's
// lip and the exhaust stack below it.
const BE55_NACELLE = [
  ["hl", [[1.242, 0.708], [1.241, 0.333]], false], ["hl", [[1.317, 0.698], [1.316, 0.352]], false],
  ["hl", [[1.336, 0.698], [2.36, 0.693]], false], ["hl", [[1.336, 0.67], [2.36, 0.665]], false],
  ["hl", [[2.36, 0.693], [2.36, 0.553]], false], ["hl", [[1.335, 0.428], [2.13, 0.423]], false],
  ["nac", [[2.122, 0.783, "c"], [2.132, 0.844], [2.165, 0.858], [2.291, 0.845], [2.347, 0.824], [2.403, 0.763, "c"]]],
  ["hl", [[2.167, 0.348], [2.242, 0.349], [2.284, 0.413], [2.308, 0.44], [2.354, 0.447], [2.41, 0.393]], false],
  ["inlet", [[2.13, 0.376, "c"], [2.195, 0.319], [2.269, 0.268], [2.4, 0.244], [2.634, 0.228, "c"], [2.615, 0.21], [2.4, 0.211],
    [2.148, 0.221], [2.082, 0.254]]],
];
// the wing as the 3-view draws it: the root fillet rising from the nacelle, the trailing edge running
// down to the root, the nacelle's lower aft fairing back to the fuselage; and the flap at the root
const BE55_WING = [
  ["wing", [[2.261, 0.403, "c"], [2.336, 0.543], [2.421, 0.674], [2.496, 0.739], [2.824, 0.765], [3.198, 0.75], [3.432, 0.716],
    [3.506, 0.678, "l"], [4.299, 0.094, "c"], [3.943, 0.044], [3.531, 0.004], [2.825, 0.026], [2.493, 0.098], [2.166, 0.151, "c"]]],
  ["hl", [[3.534, 0.603], [3.384, 0.576], [3.598, 0.35], [3.804, 0.386]], false],
];
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
  wingSide: BE55_WING,
  eng: { kind: "prop", at: [0.19], fwd: 1.6, drop: -0.28, len: 2.7, dia: 0.54, prop: 1.98, blades: 3, spinner: 0.13, tailZ: 0.3 },
  stab: { le: 1.98, z: 0.86, span: 4.86, root: 0.25, cr: 1.2, ct: 0.78, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    // the lens in the nose
    doors: [[[0.174, 0.395, "c"], [0.427, 0.375, "c"], [0.426, 0.309, "c"], [0.202, 0.371, "c"]]],
    // rudder hinge; the nose cap's seam and the nose baggage door's front edge; the dorsal fin's joint
    // with the fuselage top and the plate at its foot; the fin's panel line; the rudder trim tab
    lines: [[[7.7, 0.97], [8.2, 2.42], [8.05, 2.47], [8.05, 2.55]],
      [[0.082, 0.592], [0.09, 0.358]], [[0.986, 0.877], [0.989, 0.559], [0.987, 0.232]],
      [[4.978, 1.3], [5.259, 1.267], [5.82, 1.189], [6.661, 1.073], [7.662, 0.941]],
      [[5.979, 1.155], [5.979, 1.23], [6.279, 1.238], [6.278, 1.154]],
      [[7.066, 1.568], [7.842, 1.546]], [[8.498, 1.739], [8.321, 1.768], [8.14, 1.17], [8.336, 1.141]]],
    // the nacelle's details; the fixed step behind the wing; the small dome on the cabin roof
    marks: [...BE55_NACELLE,
      ["strut", [[4.523, 0.046, "c"], [4.579, 0.046, "c"], [4.578, -0.16, "c"], [4.522, -0.16, "c"]]],
      ["strut", [[4.438, -0.169, "c"], [4.55, -0.151], [4.653, -0.17, "c"], [4.597, -0.207], [4.484, -0.206]]],
      ["hub", [[3.267, 1.435, "c"], [3.281, 1.482], [3.342, 1.5], [3.482, 1.495], [3.52, 1.471], [3.524, 1.434, "c"]]]],
  },
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
});
F.be58.parts = {
  ...F.be58.parts,
  doors: [[[2.27, 0.55, "c"], [2.27, 0.9, "c"], [2.7, 1.35, "c"], [3.66, 1.37, "c"], [3.66, 0.55, "c"]],
    rect(4.33, 4.94, 0.2, 1.3, 0.06), rect(4.96, 5.56, 0.24, 1.29, 0.06), ...F.be58.parts.doors],
};
// the plug is between windscreen and wing: the wing (and its nacelles) moves back with the tail, and
// so do the nacelle's details and the wing's side view
{
  const back = (pts) => pts.map(([s, z, ...r]) => [s + 0.26, z, ...r]);
  F.be58.wing = { ...F.be58.wing, le: BE55.wing.le + 0.26 };
  F.be58.wingSide = BE55_WING.map(([c, pts, cl]) => [c, back(pts), cl]);
  F.be58.parts.marks = [...BE55_NACELLE.map(([c, pts, cl]) => [c, back(pts), cl]), ...F.be58.parts.marks.slice(BE55_NACELLE.length)];
}

// ---------- Mooney M20 ----------
// Reference: Mooney M20G Statesman 3-view (Wikimedia Commons,
// File:Mooney_M20G_Statesman_3-view_line_drawing.png, Wikipedia article Mooney M20), side
// view 24 ft (7.32 m) measured; the M20J (types.csv M20P 7.5) has 0.2 m more cowl and spinner.
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
  // the wing as the 3-view draws it: the pointed root fillet, the root section's lens with the joint
  // across it, the trailing edge running down to the flap at the root; the flap hinge
  wingSide: [
    ["wing", [[1.831, 0.172, "c"], [1.929, 0.254], [2.008, 0.323], [2.028, 0.459], [2.038, 0.606], [2.058, 0.694], [2.176, 0.733],
      [2.371, 0.742], [2.567, 0.726], [2.762, 0.701], [2.957, 0.646, "l"], [3.621, 0.16, "c"], [4.031, 0.119], [4.324, 0.069, "c"],
      [4.031, 0.041], [3.737, 0.037], [3.542, 0.033], [3.151, 0.039], [2.564, 0.042], [2.173, 0.087], [1.929, 0.122]]],
    ["hl", [[2.068, 0.684], [2.224, 0.644], [2.371, 0.624], [2.566, 0.614], [2.762, 0.618], [2.957, 0.646]], false],
    ["hl", [[2.567, 0.721, "l"], [2.566, 0.604]], false],
    ["hl", [[2.586, 0.594], [2.781, 0.584], [2.967, 0.446], [3.162, 0.435]], false],
    ["hl", [[2.967, 0.446, "l"], [3.542, 0.038]], false],
  ],
  eng: { kind: "none", nose: { s: 0.43, z: 0.78, d: 1.88, blades: 2 } },
  stab: { le: 1.37, z: 0.65, span: 3.58, root: 0.2, cr: 1.0, ct: 0.7, sweep: 4, dih: 0, thick: 0.1 },
  parts: {
    // the right door; the baggage door
    doors: [[[1.84, 0.5, "c"], [1.84, 0.82, "c"], [1.97, 1.2, "c"], [2.53, 1.22, "c"], [2.53, 0.5, "c"]],
      rect(3.953, 4.463, 0.225, 0.657, 0.05)],
    // rudder hinge and the fin cap's joint; from the 3-view: the lower cowl's inlet lip, the panel
    // ahead of the windscreen; the dorsal fin's joint with the fuselage top and the fin's root; the
    // two seams below the tailplane, and the small hook under the tail cone
    lines: [[[6.4, 1.93], [7.08, 0.2]], [[6.219, 1.969], [6.248, 1.929], [6.375, 1.909]],
      [[0.493, 0.485], [0.551, 0.406], [0.658, 0.318], [0.824, 0.249], [1.049, 0.199]],
      [[1.355, 0.951], [1.354, 0.775], [1.442, 0.774]], [[1.511, 0.764], [1.579, 0.764], [1.58, 0.94]],
      [[5.0, 0.915], [5.696, 0.792], [6.204, 0.698]], [[6.019, 0.913], [6.204, 0.707]],
      [[6.164, 0.59], [6.153, 0.101]], [[6.311, 0.59], [6.319, 0.13]],
      [[6.143, 0.092], [6.202, 0.062], [6.26, 0.052]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};
F.m20 = stretch(M20, 0.9, 0.18);

// ---------- Boeing-Stearman Model 75 (PT-17 / N2S Kaydet) ----------
// Reference: U.S. Navy N2S-3 general arrangement diagram (Wikimedia Commons,
// File:Boeing_N2S-3_3-view_line_drawing.png, Wikipedia article Boeing-Stearman Model 75),
// side view 25 ft (types.csv 7.6) drawn level. Biplane: the lower wing is the renderer's wing,
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
    lines: [[[6.72, 0.5], [6.72, 1.19], [6.39, 1.19], [6.39, 1.42]], [[2.98, 0.86], [3.48, 0.84]], [[3.78, 0.83], [4.3, 0.81]],
      // from the general arrangement diagram: the engine ring's aft edge (two lines), the panel line
      // along the side, the panel behind the rear cockpit, and the rudder's lower edge down to the tail cone
      [[0.704, 0.88], [0.697, -0.05]], [[0.734, 0.88], [0.728, -0.05]],
      [[0.763, 0.648], [2.505, 0.632], [4.385, 0.616]], [[3.649, 0.964], [3.646, 0.622]], [[4.387, 0.881], [4.385, 0.616]],
      [[6.764, 0.492], [7.068, 0.111]]],
    // the D-shaped port in the forward side panel, the small fitting under the panel line, the hand
    // hold, the dome on the turtle deck, the rudder trim tab
    doors: [[[0.774, 0.618, "c"], [0.773, 0.467, "c"], [0.869, 0.467], [0.918, 0.526], [0.876, 0.605]],
      rect(3.905, 4.007, 0.643, 0.704, 0.02),
      [[7.491, 0.738, "c"], [7.551, 0.75, "c"], [7.567, 0.455, "c"], [7.513, 0.438, "c"]]],
    marks: [["hl", [[1.147, 0.633], [1.153, 0.603], [1.171, 0.591], [1.189, 0.603], [1.195, 0.633]], false],
      ["hub", [[4.549, 0.86, "c"], [4.562, 0.896], [4.592, 0.919], [4.628, 0.907], [4.646, 0.871, "c"]]]],
    // the ringed fitting at the top of the rudder's trailing edge
    dots: [["hub", 7.306, 1.239, 0.09, 0.078], ["inlet", 7.306, 1.239, 0.036, 0.036]],
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

// ---------- Diamond DA42 Twin Star ----------
// Reference: Diamond DA-42 three-view silhouette (Wikimedia Commons,
// File:Diamond_DA-42_three-view_silhouette.png, Wikipedia article Diamond DA42), side view
// scaled to 8.6 m (types.csv; 8.56 m published), details checked against the side-on photo
// File:Diamond_da42_twin_star_hb-sdm_riat_2010_arp.jpg. Lower confidence than the line
// drawings (a small filled silhouette). Composite pod with a big bubble canopy, slim tail
// boom, swept fin with a ventral extension and the T-tail on top, diesel nacelles slung
// under the wing well ahead of it with three-blade props, retractable gear (retracted).
F.da42 = {
  kind: "piston", L0: 8.6, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.32, "c"], [0.1, 0.45], [0.2, 0.5], [0.4, 0.56], [0.6, 0.62], [0.8, 0.67], [1.0, 0.72], [1.2, 0.76],
    [1.4, 0.8], [1.6, 0.83], [1.8, 0.865], [2.0, 0.895], [2.2, 0.97], [2.4, 1.05], [2.6, 1.1], [2.8, 1.15], [3.0, 1.185],
    [3.3, 1.22], [3.6, 1.215], [3.9, 1.2], [4.1, 1.17], [4.3, 1.11], [4.5, 1.05], [4.7, 0.97], [4.9, 0.92], [5.1, 0.85],
    [5.3, 0.77], [5.5, 0.72], [5.7, 0.67], [5.9, 0.625], [6.1, 0.6], [6.4, 0.63], [6.7, 0.67], [7.0, 0.71], [7.2, 0.73],
    [7.32, 0.86], [7.42, 1.06], [7.5, 1.3], [7.57, 1.49, "c"], [8.48, 1.5, "c"], [8.55, 1.38], [8.55, 0.2], [8.45, 0.0],
    [8.2, -0.08], [7.8, -0.16], [7.45, -0.17], [7.0, -0.09], [6.6, 0.0], [6.3, 0.06], [6.0, 0.09], [5.5, 0.04],
    [5.0, -0.01], [4.5, -0.07], [3.9, -0.12], [3.2, -0.12], [2.5, -0.08], [1.8, -0.02], [1.5, -0.01], [1.3, 0.01],
    [1.0, 0.04], [0.8, 0.07], [0.5, 0.1], [0.3, 0.13], [0.1, 0.18],
  ],
  glass: [
    [[2.05, 0.9], [2.6, 1.1, ""], [3.3, 1.2, ""], [3.75, 1.19], [3.65, 0.74], [2.4, 0.74]],
    [[3.88, 1.17], [4.3, 1.0], [4.2, 0.75], [3.8, 0.75]],
  ],
  frame: 0.04,
  wing: { le: 2.55, root: 0.6, span: 13.42, cr: 1.55, ct: 0.85, sweep: 1, dih: 5, z: -0.02, t: [0.15, 0.12] },
  eng: { kind: "prop", at: [0.164], fwd: 1.03, drop: 0.04, len: 2.7, dia: 0.6, prop: 1.9, blades: 3, spinner: 0.12, tailZ: 0.2 },
  stab: { le: 1.05, z: 1.535, span: 3.6, root: 0.1, cr: 1.0, ct: 0.75, sweep: 8, dih: 0, thick: 0.1 },
  // Detail from the three-view of the DA 42 NG AFM (Doc. No. 7.01.15-E Rev. 1, section 1.7), whose side
  // view the outline above matches to within 5 cm: the nose baggage door and its handle, the rudder
  // hinge and its trim tab, the joint of the fin's root fillet, the seam where the boom runs under
  // it, the ventral fin's root, the round opening on the nacelle's side, the frame post between the
  // front canopy and the rear door's window, and the near wing's swept winglet, which stands in
  // front of the cabin in a side view.
  parts: {
    doors: [[[0.54, 0.608, "c"], [0.542, 0.355], [0.581, 0.273], [0.671, 0.24], [1.096, 0.221], [1.169, 0.257], [1.197, 0.319],
      [1.228, 0.681, "c"]], rect(0.855, 1.015, 0.334, 0.364, 0.015)],
    lines: [[[8.253, 1.46], [7.787, 0.327], [7.711, 0.074]], [[8.535, 0.869], [8.463, 0.869], [8.442, 0.662], [8.412, 0.436], [8.382, 0.211]],
      [[6.967, 0.581], [7.094, 0.625], [7.195, 0.705], [7.25, 0.794], [7.287, 0.875]], [[5.902, 0.676], [6.1, 0.637], [6.29, 0.617]],
      [[5.87, 0.278], [6.774, 0.303], [7.723, 0.327]]],
    marks: [
      ["fin", [[3.178, 1.153, "c"], [3.341, 1.151, "c"], [3.335, 0.744, "c"], [3.137, 0.747, "c"]]],
      ["hl", [[3.25, 1.152], [3.209, 0.746]], false], ["hl", [[3.295, 1.161], [3.281, 0.745]], false],
      ["wl", [[3.288, 0.582, "c"], [3.326, 0.754], [3.437, 0.924], [3.529, 1.067], [3.622, 1.211], [3.696, 1.355], [3.769, 1.435],
        [3.86, 1.479, "c"], [3.986, 1.468, "c"], [3.939, 1.306], [3.892, 1.153], [3.799, 0.919], [3.724, 0.721], [3.695, 0.577, "c"]]],
    ],
    dots: [["hl", 2.416, 0.223, 0.127]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Diamond DA40 Diamond Star ----------
// Reference: Diamond DA 40 NG Airplane Flight Manual, Doc. 6.01.15-E (Rev. 0, 01-Apr-2010), section 1.7
// "Three-view drawing" (page 1-18): the side view, turned upright, traced and scaled so the spinner
// tip to the tailplane tip is the 8.1 m of types.csv (the AFM gives 8060 mm). z = 0 is the belly under
// the wing. The DA40 was earlier drawn from a shortened DA42 outline, which missed this view by up to
// 0.42 m at the tail; it is now its own family. From the AFM view: the spinner and the cowling with its
// split line, aft seam, lower inlet lips, access door and the slot by the spinner; the canopy and the
// rear window with their frames and the sill line; the wing root and flap as the side view shows them,
// with the near winglet standing over the rear window; the swept fin with the fillet joint, the T-tail,
// the rudder with its hinge and trim-tab notches, the ventral fin under the tail cone and its joint;
// the fixed tricycle gear on its spring legs, with the wheel fairings.
F.da40 = {
  kind: "piston", L0: 8.1, over: 0, D: 1, W: 1.15,
  body: [[0.0, 0.72, "c"], [0.069, 0.809], [0.098, 0.818], [0.137, 0.833], [0.172, 0.843], [0.24, 0.862], [0.309, 0.872], [0.392, 0.877, "c"],
    [0.421, 0.892], [0.451, 0.902], [0.564, 0.911], [0.755, 0.916], [1.078, 0.907], [1.259, 0.897], [1.343, 0.892], [1.367, 0.892],
    [1.416, 0.921, "c"], [1.519, 0.985], [1.705, 1.073], [1.842, 1.127], [1.97, 1.166], [2.141, 1.201], [2.239, 1.22], [2.357, 1.235],
    [2.798, 1.22], [2.96, 1.205], [3.082, 1.191], [3.195, 1.176], [3.303, 1.161], [3.406, 1.142], [3.499, 1.122], [3.631, 1.093],
    [3.763, 1.054], [3.847, 1.029], [3.94, 1.0], [4.018, 0.97], [4.092, 0.941], [4.214, 0.882], [4.297, 0.843], [4.425, 0.784],
    [4.621, 0.701], [4.812, 0.627], [4.9, 0.598], [5.047, 0.559], [5.199, 0.534], [5.405, 0.51], [5.616, 0.485], [5.821, 0.461],
    [6.027, 0.436], [6.238, 0.412], [6.444, 0.387], [6.556, 0.392], [6.61, 0.417], [6.645, 0.461, "l"], [7.144, 1.215], [7.159, 1.259],
    [7.149, 1.328], [7.14, 1.362, "c"], [7.737, 1.362, "c"], [7.767, 1.343], [7.879, 1.323], [7.973, 1.308], [8.017, 1.303], [8.022, 1.289, "cl"],
    [7.875, 0.26, "c"], [7.806, 0.216], [7.737, 0.176], [7.688, 0.147], [7.674, 0.132], [7.507, 0.118], [7.345, 0.108, "c"], [7.306, 0.083],
    [7.169, 0.0, "c"], [6.85, 0.025], [6.581, 0.059], [6.277, 0.088], [6.013, 0.123], [5.503, 0.137], [4.988, 0.142], [4.675, 0.108],
    [4.361, 0.078], [4.097, 0.044], [3.812, 0.015], [3.249, 0.0], [2.808, 0.0], [2.685, 0.0], [2.528, 0.025], [2.381, 0.034],
    [2.239, 0.049], [2.014, 0.059], [1.877, 0.074], [1.715, 0.083], [1.622, 0.098], [1.519, 0.108], [1.377, 0.132], [1.259, 0.157],
    [1.191, 0.172, "c"], [1.176, 0.069, "c"], [1.0, 0.078], [0.848, 0.088], [0.706, 0.098], [0.617, 0.108], [0.519, 0.132], [0.466, 0.152],
    [0.436, 0.162], [0.377, 0.206], [0.368, 0.225, "l"], [0.368, 0.368], [0.377, 0.441], [0.387, 0.539], [0.363, 0.544], [0.323, 0.549],
    [0.255, 0.564], [0.196, 0.583], [0.152, 0.598], [0.064, 0.642]],
  // the canopy and the rear side window (the winglet stands over its lower edge)
  glass: [[[1.446, 0.911, "c"], [1.583, 0.995], [1.779, 1.093], [2.024, 1.176], [2.171, 1.205], [2.367, 1.196], [2.509, 1.186], [2.577, 1.171, ""],
    [2.617, 1.132, ""], [2.617, 1.063], [2.607, 0.965], [2.573, 0.828], [2.528, 0.735, ""], [2.489, 0.696, ""], [2.401, 0.671], [2.22, 0.662],
    [1.965, 0.652], [1.808, 0.662], [1.74, 0.676, ""], [1.681, 0.711, "c"]],
    [[2.788, 1.152, ""], [3.019, 1.137], [3.229, 1.103], [3.411, 1.068], [3.582, 1.034], [3.66, 1.019], [3.724, 0.98, ""], [3.749, 0.926, ""],
    [3.734, 0.867, ""], [3.665, 0.818, ""], [3.494, 0.789], [3.322, 0.76], [3.151, 0.735], [2.955, 0.715], [2.818, 0.701, ""], [2.759, 0.72, ""],
    [2.744, 0.794], [2.754, 1.014], [2.764, 1.112, ""]]],
  frame: 0.02,
  wing: { le: 2.254, root: 0.6, span: 11.63, cr: 1.45, ct: 0.8, sweep: 1, dih: 5, z: 0.3, t: [0.15, 0.12] },
  // the wing as the AFM side view draws it: the root section with the fairing round its leading edge,
  // the lower surface, the flap hinge and the flap's chord line
  wingSide: [
    ["wing", [[2.254, 0.515, "cl"], [3.161, 0.441, "cl"], [3.401, 0.074, "c"], [3.469, 0.059], [3.518, 0.044, "c"], [3.249, 0.044], [2.69, 0.044], [2.524, 0.059],
      [2.318, 0.074], [2.176, 0.088], [2.107, 0.098], [2.034, 0.123], [2.019, 0.147], [2.038, 0.181], [2.083, 0.211], [2.161, 0.245, "cl"]]],
    ["hl", [[2.151, 0.152], [2.239, 0.132], [2.362, 0.118], [2.592, 0.088], [2.891, 0.083], [3.195, 0.078], [3.42, 0.069]], false],
    ["hl", [[2.979, 0.436], [3.166, 0.069]], false],
    ["hl", [[3.072, 0.279], [3.264, 0.27]], false],
  ],
  eng: { kind: "none", nose: { s: 0.284, z: 0.72, d: 1.8, blades: 3 } },
  parts: {
    // the cowling's access door and the slot by the spinner
    doors: [[[0.642, 0.711, "l"], [0.774, 0.706], [0.789, 0.691, "l"], [0.789, 0.598], [0.774, 0.583, "l"], [0.647, 0.588], [0.627, 0.603, "l"], [0.627, 0.691]],
      [[0.431, 0.72, "c"], [0.446, 0.72, "c"], [0.446, 0.637, "c"], [0.436, 0.617, "c"], [0.426, 0.627, "c"]]],
    // the spinner's back plate; the cowl split line, the cowling's aft seam and the lower inlet's two lips;
    // the windscreen's outer frame, the sill under the canopy, the frames between the canopy and the rear
    // window and round the rear window; the fin fillet's joint, the ventral fin's joint, the rudder hinge
    // with its two trim-tab notches, the rudder's lower and upper edges; the nose leg's fittings
    lines: [[[0.402, 0.862], [0.397, 0.72], [0.387, 0.544]],
      [[0.412, 0.568], [0.72, 0.549], [1.049, 0.529], [1.348, 0.515], [1.548, 0.515], [1.612, 0.534]],
      [[1.205, 0.51], [1.196, 0.343], [1.186, 0.196]],
      [[0.431, 0.412], [0.495, 0.368], [0.593, 0.323], [0.681, 0.299], [0.809, 0.279], [1.063, 0.265], [1.181, 0.255]],
      [[0.466, 0.323], [0.559, 0.279], [0.622, 0.255], [0.706, 0.23], [0.862, 0.216], [1.093, 0.201], [1.181, 0.191]],
      [[1.397, 0.911], [1.519, 0.804], [1.642, 0.691], [1.73, 0.593]],
      [[1.749, 0.583], [1.803, 0.564], [2.274, 0.559], [2.715, 0.568]],
      [[2.769, 0.559], [3.166, 0.544]],
      [[2.685, 1.161], [2.695, 1.063], [2.675, 0.97], [2.646, 0.862], [2.612, 0.75], [2.577, 0.681]],
      [[2.695, 1.225], [2.72, 1.147], [2.72, 1.034], [2.695, 0.921], [2.671, 0.809], [2.646, 0.72], [2.636, 0.696], [2.671, 0.622],
      [2.725, 0.593]],
      [[3.798, 1.019], [3.807, 0.96], [3.798, 0.848], [3.788, 0.774], [3.778, 0.715], [3.744, 0.637]],
      [[3.239, 0.583], [3.455, 0.564], [3.631, 0.568], [3.7, 0.598]],
      [[6.179, 0.441], [6.468, 0.534], [6.752, 0.627]],
      [[5.959, 0.142], [6.311, 0.137], [7.228, 0.127], [7.291, 0.123]],
      [[7.336, 0.137], [7.345, 0.245], [7.38, 0.358], [7.424, 0.48], [7.463, 0.588], [7.507, 0.711], [7.546, 0.823], [7.566, 0.887],
      [7.576, 0.941], [7.507, 0.98], [7.522, 1.019], [7.551, 1.024], [7.6, 1.005], [7.61, 1.024], [7.639, 1.103], [7.659, 1.152],
      [7.679, 1.205], [7.698, 1.25], [7.718, 1.294], [7.732, 1.328], [7.737, 1.367]],
      [[7.664, 1.127], [7.703, 1.127], [7.713, 1.161], [7.723, 1.201]],
      [[7.34, 0.132], [7.674, 0.147]],
      [[7.767, 1.318], [8.017, 1.284]],
      [[1.083, 0.069], [1.083, 0.01]],
      [[1.201, 0.069], [1.201, 0.044], [1.147, 0.015]],
      [[1.132, -0.015], [1.24, 0.039]]],
    gear: [
      { leg: [[2.602, 0.083], [2.622, -0.078]], w: [0.162, 0.118], at: [2.646, -0.319], r: 0.211, spat: { pts: [[2.465, -0.118], [2.528, -0.088], [2.592, -0.078], [2.739, -0.083], [2.862, -0.118], [2.974, -0.152], [3.121, -0.206], [3.254, -0.255, "c"],
        [3.254, -0.387, "c"], [3.077, -0.407], [2.916, -0.421], [2.734, -0.417], [2.646, -0.392], [2.612, -0.412], [2.43, -0.402], [2.381, -0.377],
        [2.342, -0.333], [2.332, -0.299], [2.342, -0.255], [2.377, -0.191], [2.421, -0.147]] } },
      { leg: [[1.083, -0.015], [0.75, -0.201]], w: [0.044, 0.039], at: [0.848, -0.348], r: 0.181, spat: { pts: [[1.22, -0.24, "c"], [1.103, -0.211], [0.98, -0.196], [0.843, -0.186], [0.76, -0.196], [0.691, -0.211], [0.617, -0.225], [0.564, -0.265],
        [0.534, -0.314], [0.534, -0.368], [0.549, -0.387], [0.627, -0.412], [0.701, -0.431], [0.799, -0.431], [0.823, -0.402], [0.858, -0.431],
        [0.995, -0.417], [1.117, -0.387], [1.215, -0.363], [1.235, -0.353, "c"]] } },
    ],
    // the T-tail as the AFM draws it, with the elevator's horn line; the near winglet, filled without an
    // edge where it stands on the wing root and outlined where the AFM draws it
    draw: [({ sk }) => {
      sk.smooth("stab", [[7.095, 1.426, "c"], [7.184, 1.45], [7.287, 1.465], [7.512, 1.465], [7.649, 1.45], [7.757, 1.436], [7.87, 1.421], [7.953, 1.416],
        [8.1, 1.411, "c"], [7.963, 1.406], [7.865, 1.392], [7.742, 1.377], [7.634, 1.362], [7.492, 1.348], [7.252, 1.352], [7.149, 1.367],
        [7.1, 1.387], [7.086, 1.406]]);
      sk.poly("hl", [[7.786, 1.426], [7.786, 1.387]], false);
      sk.smooth("wl", [[2.734, 0.588, "cl"], [3.117, 0.936], [3.2, 0.951], [3.308, 0.936], [3.371, 0.921, "cl"], [3.278, 0.691], [3.161, 0.441, "cl"], [2.955, 0.446],
        [2.749, 0.451, "cl"]], true, ' style="stroke:none"');
      sk.smooth("wl", [[2.734, 0.588, "cl"], [3.117, 0.936], [3.2, 0.951], [3.308, 0.936], [3.371, 0.921, "cl"], [3.278, 0.691], [3.161, 0.441, "c"]], false, ' style="fill:none"');
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Cirrus SR20 / SR22 ----------
// No three-view reachable: measured from the near-side-on photo File:Cirrus_SR22_G3_Turbo_
// Private_N918SE,_LUX_Luxembourg_(Findel),_Luxembourg_PP1373043529.jpg (Wikimedia Commons,
// Wikipedia article Cirrus SR22), scaled to 7.9 m (types.csv; 7.92 m published). Lower
// confidence (photo perspective). Composite fuselage with a long cowl and big windscreen,
// gull-wing doors with large windows and the big fixed rear cabin window, the tall curved fin,
// low wing, fixed gear with long spats and the canted nose leg. SR20 has the same airframe.
F.sr22 = {
  kind: "piston", L0: 7.9, over: 0, D: 1, W: 1.27,
  body: [
    [0, 0.61, "c"], [0.1, 0.66], [0.2, 0.7], [0.3, 0.735], [0.4, 0.755], [0.48, 0.77], [0.7, 0.82], [1.0, 0.86],
    [1.3, 0.89], [1.68, 0.925, "c"], [1.9, 1.03], [2.1, 1.14], [2.3, 1.24], [2.45, 1.3], [2.7, 1.35], [3.0, 1.375],
    [3.3, 1.37], [3.5, 1.34], [3.9, 1.28], [4.23, 1.21], [4.6, 1.12], [4.87, 1.05], [5.2, 0.98], [5.52, 0.92],
    [5.85, 0.87], [6.17, 0.83], [6.5, 0.81], [6.7, 0.86], [6.85, 1.05], [7.04, 1.47], [7.2, 1.7], [7.39, 1.86],
    [7.55, 1.95], [7.65, 1.98], [7.8, 1.98], [7.9, 1.95, "c"], [7.8, 1.4], [7.72, 0.95], [7.62, 0.62], [7.5, 0.42],
    [7.35, 0.33], [7.13, 0.28], [6.6, 0.22], [6.17, 0.18], [5.5, 0.11], [4.87, 0.05], [4.2, 0.02], [3.58, 0],
    [2.94, -0.02], [2.3, -0.01], [1.65, 0], [1.3, 0.03], [1.0, 0.06], [0.8, 0.12], [0.68, 0.18], [0.55, 0.28],
    [0.48, 0.36], [0.42, 0.47], [0.3, 0.5], [0.2, 0.53], [0.1, 0.56],
  ],
  glass: [
    [[1.72, 0.93], [2.1, 1.15, ""], [2.43, 1.29], [2.46, 0.86], [2.05, 0.84]],
    [[2.56, 0.78], [2.6, 1.26], [3.3, 1.29], [3.32, 0.77]],
    [[3.42, 0.77], [3.42, 1.21], [3.85, 1.21, ""], [4.18, 1.02], [4.0, 0.79, ""]],
  ],
  frame: 0.035,
  wing: { le: 2.45, root: 0.6, span: 11.68, cr: 1.5, ct: 0.9, sweep: 2, dih: 4.5, z: 0.08, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.4, z: 0.61, d: 1.98, blades: 3 } },
  stab: { le: 1.48, z: 0.54, span: 3.6, root: 0.2, cr: 1.05, ct: 0.65, sweep: 6, dih: 0, thick: 0.1 },
  parts: {
    doors: [[[2.5, 0.3, "c"], [2.5, 1.32, "c"], [3.38, 1.36, "c"], [3.38, 0.3, "c"]]],
    lines: [[[7.15, 0.5], [7.42, 1.86]]],
    gear: [
      { leg: [[3.3, 0.02], [3.29, -0.25]], w: [0.12, 0.08], at: [3.29, -0.37], r: 0.19, spat: { f: 0.42, a: 0.5, t: 0.17, b: 0.15 } },
      { leg: [[1.19, 0.05], [0.97, -0.33]], w: [0.07, 0.06], at: [0.94, -0.37], r: 0.15, spat: { f: 0.4, a: 0.45, t: 0.15, b: 0.12 } },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Pilatus PC-12 ----------
// No three-view reachable: measured from the side-on photo File:Pilatus_PC-12-45,_Jetfly_
// Aviation_JP532772.jpg (Wikimedia Commons, Wikipedia article Pilatus PC-12; left side,
// mirrored), scaled to 14.4 m (types.csv). Lower confidence (photo). Single PT6A with the
// exhaust stack low on the cowl and a four-blade prop, low wing with winglets, T-tail on a
// swept fin with a long dorsal, ventral strakes under the tail cone, round cabin windows,
// the airstair door behind the cockpit and the big cargo door aft (both on the left side;
// shown as the type's signature), trailing-link gear retracted.
// Windows, doors and detail follow the manufacturer's side view in Pilatus's "PC-12 PRO Just The
// Facts" (2025), page 4 "Exterior View" (a 448 px rendering, about 3.4 cm a pixel, scaled by its
// 14.40 m length; it fits the outline within a few cm at the nose, crown and fin). Against it the
// photo-measured windscreen, cabin windows and doors sat 0.3-0.5 m too far forward and the windows
// 0.1 m too low: they now follow the Pilatus view, as do the cowling seams, exhaust stack, vents,
// dorsal antenna and rudder hinge.
// a rounded-rectangle pane (glass corners are sharp unless flagged smooth)
const pane12 = (...a) => rect(...a).map((p) => (p[2] ? p : [p[0], p[1], ""]));
F.pc12 = {
  kind: "turboprop", L0: 14.4, over: 0, D: 1, W: 1.6,
  body: [
    [0, 0.81, "c"], [0.15, 0.9], [0.3, 0.97], [0.39, 1.0], [0.5, 1.04], [1.0, 1.15], [1.5, 1.22], [2.0, 1.27],
    [2.48, 1.31, "c"], [2.8, 1.52], [3.1, 1.7], [3.44, 1.84], [4.0, 1.87, "l"], [6.5, 1.87], [8.0, 1.8], [9.5, 1.95],
    [11.0, 2.1], [11.75, 2.2], [12.1, 2.52], [12.42, 2.96], [12.6, 3.02], [13.9, 3.02, "c"], [13.06, 0.86, "c"],
    [12.6, 0.78], [12.3, 0.8], [11.2, 0.56], [10.0, 0.42], [8.8, 0.24], [7.5, 0.08], [6.0, -0.04], [4.5, -0.06],
    [3.0, 0.02], [2.4, 0.08], [1.89, 0.14], [1.05, 0.3], [0.6, 0.5], [0.39, 0.62], [0.2, 0.7], [0.1, 0.75],
  ],
  // the cockpit side window, then the four cabin windows (rounded rectangles, unevenly spaced)
  glass: [
    [[2.8, 1.36, "c"], [3.24, 1.68, ""], [3.47, 1.71, ""], [3.77, 1.65, ""], [3.89, 1.53, ""], [3.89, 1.36, ""], [3.8, 1.17, ""],
      [3.47, 1.15, ""], [3.13, 1.15, ""]],
    pane12(4.89, 5.27, 1.07, 1.54, 0.09), pane12(5.51, 5.9, 1.07, 1.54, 0.09), pane12(6.3, 6.68, 1.07, 1.54, 0.09),
    pane12(7.3, 7.68, 1.06, 1.53, 0.09),
  ],
  frame: 0.035,
  wing: { le: 4.2, root: 0.7, span: 16.28, cr: 2.25, ct: 1.0, sweep: 2, dih: 5, z: 0.12, t: [0.16, 0.12] },
  tip: { h: 0.35, sweep: 45, top: 0.25, base: 0.8 },
  eng: { kind: "none", nose: { s: 0.33, z: 0.81, d: 2.67, blades: 4 } },
  stab: { le: 2.36, z: 3.15, span: 5.2, root: 0.15, cr: 1.55, ct: 0.95, sweep: 30, dih: 0, thick: 0.1 },
  parts: {
    // the airstair door (1.35 m high, its sill from the brochure's figure) and the cargo door
    doors: [rect(4.12, 4.85, 0.46, 1.81, 0.08), rect(7.09, 8.53, 0.23, 1.74, 0.1)],
    // the rudder hinge; the cowling's two seams
    lines: [[[12.35, 0.92], [13.44, 2.9]], [[1.64, 1.22], [1.64, 0.22]], [[2.49, 1.29], [2.49, 0.08]]],
    // the dorsal antenna on the cabin roof; the exhaust stack and two vents on the cowling
    shapes: [["strut", [[7.9, 1.78, "c"], [8.29, 2.26, "c"], [8.39, 2.21, "c"], [8.09, 1.78, "c"]]]],
    dots: [["inlet", 1.2, 0.81, 0.26, 0.15], ["inlet", 1.81, 0.74, 0.04], ["inlet", 2.3, 0.67, 0.05]],
    draw: [(k) => {
      // ventral strake under the tail cone
      k.sk.smooth("fin", [[8.86, 0.3, "c"], [11.2, 0.41, "c"], [11.5, 0.86, "c"], [10.6, 0.5], [9.4, 0.36]]);
    }],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Daher TBM 900 series ----------
// Reference: Daher TBM 900 Pilot's Information Manual (tbm.aero), Section 1, Figure 1.2.1 (1/2)
// "Three view drawing": the manufacturer's side-view rendering, scaled by its own 10.736 m overall
// length dimension (2.7 cm per pixel of the embedded image). The nose and the tail cone's underside
// were first measured off the three-quarter photo File:N893MA_2015_SOCATA-TBM_900_s-n_1065_
// (23427100365).jpg and agree with the manufacturer's view within 2 cm; the cabin crown, the dorsal fin
// and the fin did not (crown 10 cm too high, fin leading edge up to half a metre low), so the outline
// aft of the windscreen, the glazing, the tailplane's station and height, the exhaust stack, the
// antennas and the ventral strake are traced from the manufacturer's view. The rendering shows the gear
// down; it is drawn retracted, as in flight. Long PT6A cowl with the side exhaust stack and five-blade
// prop, pressurised cabin with three small windows behind the pilot's, low wing with winglets.
F.tbm9 = {
  kind: "turboprop", L0: 10.7, over: 0, D: 1, W: 1.4,
  body: [
    [0, 0.55, "c"], [0.2, 0.7], [0.4, 0.8], [0.6, 0.86], [0.7, 0.9], [1.0, 0.99], [1.5, 1.07], [2.0, 1.13], [2.5, 1.19],
    [3.05, 1.26, "c"], [3.244, 1.427], [3.407, 1.515], [3.57, 1.591], [3.732, 1.639], [3.895, 1.678], [4.058, 1.706], [4.221, 1.724],
    [4.384, 1.725, "l"], [6.664, 1.727], [6.827, 1.735], [6.99, 1.752], [7.153, 1.767], [7.316, 1.785], [7.479, 1.809], [7.641, 1.836],
    [7.804, 1.866], [7.967, 1.907], [8.13, 1.966], [8.293, 2.076, "l"], [9.759, 3.554], [9.813, 3.566, "l"], [10.516, 3.549, "cl"],
    [9.916, 1.812, "c"], [10.302, 1.663], [10.682, 1.541, "c"],
    [10.193, 1.321], [9.243, 1.022], [8.293, 0.726], [7.479, 0.468], [7.0, 0.28],
    [6.0, 0.08], [5.0, 0], [4.0, -0.02], [3.0, 0], [2.0, 0.05], [1.2, 0.11], [0.8, 0.18], [0.62, 0.28], [0.45, 0.34],
    [0.2, 0.42],
  ],
  // the windscreen's side pane along the crown, and the pilot's swept side window
  glass: [
    [[3.0, 1.215, "c"], [3.271, 1.378], [3.542, 1.527], [3.76, 1.622], [3.95, 1.657, "c"], [3.868, 1.541], [3.624, 1.432], [3.352, 1.296], [3.108, 1.174, "c"]],
    [[3.502, 0.998, "c"], [3.624, 1.201], [3.787, 1.378], [3.95, 1.459], [4.18, 1.459, "c"], [4.208, 1.215, "c"], [4.14, 1.147, "c"], [3.597, 0.971, "c"]],
  ],
  frame: 0.015,
  // the three cabin windows, unevenly spaced
  win: [4.569, 5.158, 5.972].map((s) => ({ z: 1.323, from: s, to: s, w: 0.26, h: 0.3 })),
  wing: { le: 4.4, root: 0.65, span: 12.83, cr: 1.95, ct: 1.0, sweep: 3, dih: 6.5, z: 0.12, t: [0.16, 0.12] },
  tip: { h: 0.35, sweep: 45, top: 0.25, base: 0.8 },
  eng: { kind: "none", nose: { s: 0.45, z: 0.55, d: 2.31, blades: 5 } },
  stab: { le: 1.27, z: 1.6, span: 4.85, root: 0.15, cr: 1.4, ct: 0.8, sweep: 15, dih: 4, thick: 0.1 },
  parts: {
    lines: [[[9.81, 1.9], [10.15, 3.38]]],
    // as the manufacturer's view draws them: the exhaust stack on the cowl's side with its outlet, the
    // blade antenna on the spine and the swept one under the belly, the ventral strake under the tail cone
    shapes: [
      ["core", [[0.882, 0.808, "c"], [1.208, 0.808], [1.235, 0.618, "c"], [0.882, 0.618, "c"]]],
      ["strut", [[6.23, 1.703, "c"], [6.433, 1.961, "c"], [6.501, 1.948, "c"], [6.461, 1.703, "c"]]],
      ["strut", [[6.474, 0.292, "c"], [6.623, 0.292, "c"], [6.827, 0.088], [6.909, 0.034, "c"], [6.678, 0.034, "c"]]],
      ["fin", [[7.451, 0.496, "c"], [7.533, 0.319, "c"], [8.89, 0.781, "c"], [9.053, 0.971, "c"]]],
    ],
    dots: [["inlet", 1.303, 0.713, 0.081, 0.087]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- American Champion / Bellanca Citabria ----------
// No three-view reachable: measured from the side-on, tail-up photo File:Bellanca_7GCBC_
// (N68576).jpg (Wikimedia Commons, Wikipedia article American Champion Citabria), scaled to
// 6.9 m (types.csv; 7GCBC 6.91 m). Lower confidence (photo). High strut-braced wing with V struts,
// tandem cabin with the long side glazing, round cowl, spring-steel main gear with spats,
// steerable tailwheel (taildragger), tall square-topped fin.
F.ch7b = {
  kind: "piston", L0: 6.9, over: 0, D: 1, W: 0.85,
  body: [
    [0, 0.67, "c"], [0.1, 0.71], [0.25, 0.75], [0.41, 0.78], [0.47, 0.85], [0.6, 0.865], [1.0, 0.87], [1.36, 0.875, "c"],
    [1.6, 1.05], [1.8, 1.2], [1.95, 1.3], [2.1, 1.33, "l"], [3.5, 1.33], [3.62, 1.27], [3.95, 1.02], [4.93, 0.89],
    [5.55, 0.84, "c"], [6.36, 1.93], [6.45, 1.955], [6.72, 1.955], [6.8, 1.9, "c"], [6.87, 0.65], [6.85, 0.46],
    [6.72, 0.36], [6.42, 0.38], [5.53, 0.32], [4.34, 0.17], [3.15, 0.05], [1.96, 0], [1.0, 0.05], [0.77, 0.14],
    [0.59, 0.29], [0.5, 0.42], [0.45, 0.53], [0.3, 0.57], [0.15, 0.61],
  ],
  glass: [
    [[1.42, 0.9], [1.75, 1.17, ""], [2.04, 1.29], [2.1, 0.85]],
    [[2.2, 0.78], [2.2, 1.26], [3.0, 1.26], [3.0, 0.78]],
    [[3.08, 0.8], [3.08, 1.25], [3.45, 1.25, ""], [3.88, 1.0], [3.6, 0.84, ""]],
  ],
  frame: 0.035,
  wing: { le: 1.92, root: 0.45, span: 10.2, cr: 1.55, ct: 1.55, sweep: 0, dih: 1, z: 1.4, t: [0.13, 0.13] },
  eng: { kind: "none", nose: { s: 0.41, z: 0.67, d: 1.88, blades: 2 } },
  stab: { le: 1.13, z: 0.82, span: 3.05, root: 0.15, cr: 1.15, ct: 0.85, sweep: 5, dih: 0, thick: 0.09 },
  parts: {
    doors: [[[2.15, 0.25, "c"], [2.15, 1.28, "c"], [3.03, 1.28, "c"], [3.03, 0.25, "c"]]],
    lines: [[[6.45, 0.38], [6.47, 1.93]]],
    struts: [[[2.12, 0.1], [2.35, 1.37], 0.07, 0.06], [[2.15, 0.1], [3.1, 1.37], 0.06, 0.05]],
    gear: [
      { leg: [[1.87, 0.02], [1.82, -0.42]], w: [0.08, 0.06], at: [1.81, -0.54], r: 0.21, spat: { f: 0.45, a: 0.5, t: 0.22, b: 0.1 } },
      { leg: [[6.54, 0.39], [6.78, 0.16]], w: [0.05, 0.04], at: [6.78, 0.14], r: 0.1 },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Van's Aircraft RV family ----------
// References: Van's Aircraft's "Weight and Balance Data Quick Reference" sheets (vansaircraft.com/downloads/,
// RV4wb, RV6wb, RV6Awb, RV7wb, RV7Awb, RV8wb, RV8Awb, RV9wb, RV9Awb, RV10wb, RV12wb, RV14wb and RV14Awb PDFs):
// side views of each model, scaled by the datum-to-leading-edge dimension where that is drawn to scale, else
// by the published length, and cross-checked against the wing chord (area / span) and the overall length on
// each model's page at vansaircraft.com (the types.csv lengths agree with those pages). z = 0 is the belly
// at the wing root leading edge. Every RV is a low, constant-chord wing with about 3.5 degrees of dihedral,
// Van's rounded fin with the raked rudder trailing edge and the counterbalance horn at its top, and fixed
// gear with wheel pants: spring-steel legs and a tailwheel on a spring, or (the "A" models) a swept nose
// leg and the mains further aft. The types map below picks the A model from the registered model name.

// the body's upper edge at station s (straight between its points, from the nose aft)
function crown(body, s) {
  for (let i = 1; i < body.length && body[i][0] >= body[i - 1][0]; i++) {
    const [s0, z0] = body[i - 1], [s1, z1] = body[i];
    if (s >= s0 && s <= s1) return s1 > s0 ? z0 + ((z1 - z0) * (s - s0)) / (s1 - s0) : Math.max(z0, z1);
  }
  return body[0][1];
}
// A canopy or window pane: its top follows the body outline from s0 to s1, its lower edge runs through
// the given [s, z(, flag)] points from aft to front.
function pane(body, s0, s1, lower) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 0.1)), top = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    top.push([s, crown(body, s), i === 0 || i === n ? "c" : ""]);
  }
  return [...top, ...lower];
}
// fixed gear: a leg from top to bottom, a wheel of radius r at the axle, and its pant
const PANT = { f: 0.29, a: 0.54, t: 0.19, b: 0.11 }, NOSEPANT = { f: 0.27, a: 0.42, t: 0.16, b: 0.1 };
const wheelLeg = (top, bot, at, r, w = [0.09, 0.07], spat = PANT) => ({ leg: [top, bot], w, at, r, spat });
// a small tailwheel at the end of its spring
const tailwheel = (top, at, r = 0.065) => ({ leg: [top, [at[0] - 0.02, at[1] + 0.02]], w: [0.05, 0.035], at, r });
// rudder hinge line with the counterbalance horn: up the hinge at s from z0 to z1, forward to s2, up to z2
const hinge = (s, z0, z1, s2, z2) => [[s, z0], [s, z1], [s2, z1], [s2, z2]];
const rv = (o) => ({ kind: "piston", over: 0, D: 1, frame: 0.03, extras: EXTRAS, overlays: OVERLAYS, ...o });
const withGear = (f, gear) => ({ ...f, parts: { ...f.parts, gear } });

// RV-3: single seat, sliding bubble canopy, the shortest RV. No weight-and-balance drawing: measured from
// Van's side silhouette (vansaircraft.com/rv-3/, wp-content/uploads/2019/01/rv-3.png) scaled to the 19 ft
// (5.79 m, types.csv) spinner-to-rudder length; wing from the published 19 ft 11 in span and 90 sq ft area.
// Lower confidence (silhouette).
const RV3_BODY = [
  [0, 0.47, "c"], [0.09, 0.565], [0.2, 0.615], [0.45, 0.689], [0.78, 0.749], [1.2, 0.8], [1.62, 0.84], [1.67, 0.86, "c"],
  [1.74, 0.951], [1.83, 1.019], [1.98, 1.079], [2.16, 1.124], [2.3, 1.132], [2.45, 1.131], [2.7, 1.094], [2.85, 1.055],
  [3.05, 0.98], [3.25, 0.915], [3.42, 0.885, "l"], [4.56, 0.84], [4.61, 0.86], [4.65, 0.92, "l"], [4.92, 1.536], [4.96, 1.575],
  [5.03, 1.59, "l"], [5.4, 1.57], [5.53, 1.53, "cl"], [5.76, 0.644], [5.77, 0.54], [5.74, 0.48], [5.65, 0.437],
  [5.45, 0.4, "l"], [2.34, -0.005], [2.04, -0.02, "l"], [0.75, -0.022], [0.71, -0.01, "c"], [0.69, 0.11, "c"], [0.6, 0.142],
  [0.33, 0.277], [0.21, 0.31], [0.06, 0.382],
];
F.rv3 = rv({
  L0: 5.79, W: 0.72, body: RV3_BODY,
  glass: [
    pane(RV3_BODY, 1.69, 1.96, [[1.96, 0.83], [1.75, 0.84]]),
    pane(RV3_BODY, 2.02, 3.2, [[3.0, 0.9, ""], [2.8, 0.9, "c"], [2.76, 0.8, "c"], [2.02, 0.8]]),
  ],
  wing: { le: 1.45, root: 0.36, span: 6.07, cr: 1.38, ct: 1.38, sweep: 0, dih: 3.5, z: 0.08, t: [0.15, 0.135] },
  eng: { kind: "none", nose: { s: 0.22, z: 0.47, d: 1.73, blades: 2 } },
  stab: { le: 1.14, z: 0.62, span: 2.4, root: 0.1, cr: 0.8, ct: 0.5, sweep: 14, dih: 0, thick: 0.1 },
  parts: {
    lines: [hinge(5.43, 0.4, 1.47, 5.3, 1.58), [[0.22, 0.31], [0.22, 0.62]]],
    gear: [wheelLeg([1.24, 0], [1.32, -0.37], [1.41, -0.58], 0.15, [0.08, 0.06], { f: 0.3, a: 0.52, t: 0.2, b: 0.1 }),
      tailwheel([5.45, 0.37], [5.96, 0.15], 0.06)],
  },
});

// RV-4: tandem two-seat with the long sliding bubble, narrow fuselage, taildragger only. RV4wb side view,
// scaled to the 20 ft 4 in (6.2 m) spinner-to-rudder length (wing chord then 57.3 in against 57.4 in from
// 110 sq ft / 23 ft); the tailwheel reaches 6.34 m.
const RV4_BODY = [
  [0, 0.46, "c"], [0.04, 0.52], [0.2, 0.6], [0.24, 0.625], [0.57, 0.711], [0.93, 0.779], [1.32, 0.823], [1.62, 0.842, "c"],
  [1.74, 0.984], [1.86, 1.078], [2.04, 1.145], [2.22, 1.18], [2.4, 1.196], [2.64, 1.186], [2.82, 1.154], [3.15, 1.074],
  [3.39, 0.993], [3.6, 0.912, "l"], [4.86, 0.857], [4.93, 0.88], [4.98, 0.95, "l"], [5.3, 1.62], [5.36, 1.7], [5.44, 1.722, "l"],
  [5.85, 1.66], [5.97, 1.615, "cl"], [6.18, 0.74], [6.215, 0.56], [6.2, 0.48], [6.12, 0.445, "l"], [5.73, 0.345],
  [5.0, 0.285], [4.29, 0.228], [3.4, 0.11], [2.43, 0.012], [2.0, 0, "l"], [1.15, 0, "l"], [0.7, 0], [0.66, 0.03, "c"],
  [0.62, 0.11], [0.45, 0.2], [0.3, 0.28], [0.2, 0.33], [0.1, 0.38],
];
F.rv4 = rv({
  L0: 6.2, W: 0.78, body: RV4_BODY,
  glass: [
    pane(RV4_BODY, 1.64, 2.33, [[2.33, 0.8], [1.78, 0.8], [1.68, 0.82]]),
    pane(RV4_BODY, 2.4, 3.55, [[3.4, 0.93, ""], [3.1, 0.87], [2.4, 0.81]]),
  ],
  wing: { le: 1.47, root: 0.39, span: 7.01, cr: 1.46, ct: 1.46, sweep: 0, dih: 3.5, z: 0.085, t: [0.15, 0.135] },
  eng: { kind: "none", nose: { s: 0.21, z: 0.46, d: 1.78, blades: 2 } },
  stab: { le: 1.25, z: 0.73, span: 2.6, root: 0.1, cr: 0.95, ct: 0.58, sweep: 16, dih: 0, thick: 0.1 },
  parts: {
    lines: [[[5.65, 0.34], [5.65, 1.71]], [[0.21, 0.33], [0.21, 0.61]]],
    gear: [wheelLeg([1.3, 0], [1.39, -0.32], [1.44, -0.53], 0.13, [0.1, 0.08], { f: 0.27, a: 0.56, t: 0.21, b: 0.06 }),
      tailwheel([5.73, 0.34], [6.13, 0.14], 0.065)],
  },
});

// RV-6 / RV-6A: the first side-by-side RV, sliding canopy, short (23 ft) wing and the smaller fin. RV6wb side
// view, scaled to the 20 ft 2 in (6.15 m, types.csv) spinner-to-tailwheel length: the wing chord then measures
// 57.5 in (110 sq ft / 23 ft = 57.4 in) and the rudder ends at 5.97 m. RV-6A gear from RV6Awb.
const RV6_BODY = [
  [0, 0.39, "c"], [0.12, 0.488], [0.22, 0.525], [0.31, 0.545], [0.36, 0.568], [0.6, 0.615], [1.0, 0.68], [1.4, 0.725],
  [1.73, 0.765, "c"], [1.83, 0.86], [1.95, 0.94], [2.1, 1.0], [2.28, 1.045], [2.42, 1.06], [2.6, 1.047], [2.8, 1.012],
  [3.0, 0.967], [3.15, 0.932, "l"], [4.72, 0.765], [4.79, 0.79], [4.84, 0.87, "l"], [5.08, 1.45], [5.13, 1.535],
  [5.2, 1.575], [5.3, 1.585, "l"], [5.66, 1.552], [5.72, 1.51, "cl"], [5.96, 0.52], [5.95, 0.44], [5.88, 0.39, "l"],
  [5.5, 0.315, "l"], [2.97, 0.039], [2.4, 0, "l"], [1.3, 0], [1.22, -0.03], [1.12, -0.085, "l"], [0.6, -0.09],
  [0.54, -0.07, "c"], [0.52, 0.06, "c"], [0.45, 0.11], [0.39, 0.16], [0.33, 0.215], [0.2, 0.258], [0.09, 0.3],
];
F.rv6 = rv({
  L0: 6.15, W: 1.07, body: RV6_BODY,
  glass: [
    pane(RV6_BODY, 1.75, 2.62, [[2.62, 0.67], [1.92, 0.67], [1.79, 0.72]]),
    pane(RV6_BODY, 2.68, 3.12, [[3.0, 0.82, ""], [2.85, 0.69], [2.68, 0.67]]),
  ],
  wing: { le: 1.52, root: 0.52, span: 7.01, cr: 1.46, ct: 1.46, sweep: 0, dih: 3.5, z: 0.085, t: [0.15, 0.135] },
  eng: { kind: "none", nose: { s: 0.31, z: 0.39, d: 1.78, blades: 2 } },
  stab: { le: 1.37, z: 0.65, span: 2.9, root: 0.12, cr: 0.95, ct: 0.58, sweep: 14, dih: 0, thick: 0.1 },
  parts: {
    lines: [[[5.43, 0.31], [5.43, 1.53]], [[0.31, 0.23], [0.31, 0.54]]],
    gear: [wheelLeg([1.33, -0.04], [1.45, -0.42], [1.51, -0.61], 0.13, [0.09, 0.07], { f: 0.27, a: 0.55, t: 0.2, b: 0.08 }),
      tailwheel([5.52, 0.3], [5.92, 0.1])],
  },
});
F.rv6a = withGear(F.rv6, [
  wheelLeg([1.91, 0], [2.06, -0.4], [2.15, -0.6], 0.15),
  wheelLeg([0.78, -0.08], [0.5, -0.43], [0.63, -0.6], 0.14, [0.06, 0.05], NOSEPANT),
]);

// RV-7 / RV-7A: the RV-6's successor with the 25 ft wing, a bigger fin and rudder and a longer forward
// fuselage; slider or tip-up canopy. RV7Awb side view (scaled to the 20 ft 4 in, 6.2 m spinner-to-rudder
// length; its 70 in datum dimension gives 6.15 m and the root chord 57.7 in), windscreen checked against
// Van's side silhouette (vansaircraft.com/rv-7/, rv-7.png). Tailwheel gear from RV7wb.
const RV7_BODY = [
  [0, 0.42, "c"], [0.09, 0.521], [0.2, 0.567], [0.33, 0.6], [0.57, 0.655], [1.0, 0.715], [1.4, 0.76], [1.69, 0.795, "c"],
  [1.8, 0.905], [1.95, 1.015], [2.1, 1.09], [2.28, 1.14], [2.45, 1.15], [2.65, 1.14], [2.85, 1.1], [3.0, 1.06],
  [3.2, 1.0, "l"], [3.72, 0.955], [4.56, 0.85], [4.84, 0.822], [4.93, 0.84], [4.99, 0.9, "l"], [5.25, 1.6], [5.29, 1.72],
  [5.35, 1.785], [5.45, 1.8, "l"], [5.85, 1.765], [5.94, 1.727, "cl"], [6.18, 0.603], [6.2, 0.53], [6.17, 0.45],
  [6.1, 0.415, "l"], [5.88, 0.362, "l"], [5.22, 0.268], [4.59, 0.205], [3.66, 0.095], [2.97, 0.035], [2.46, 0, "l"],
  [1.3, 0], [1.24, -0.04], [1.15, -0.068, "l"], [0.63, -0.062], [0.56, -0.04, "c"], [0.53, 0.12, "c"], [0.45, 0.165],
  [0.33, 0.235], [0.18, 0.285], [0.09, 0.322],
];
const RV7_GLASS = [
  pane(RV7_BODY, 1.71, 2.16, [[2.16, 0.69], [1.9, 0.69], [1.78, 0.74]]),
  pane(RV7_BODY, 2.22, 3.18, [[3.0, 0.82, ""], [2.85, 0.7], [2.22, 0.69]]),
];
F.rv7 = rv({
  L0: 6.2, W: 1.1, body: RV7_BODY, glass: RV7_GLASS,
  wing: { le: 1.55, root: 0.53, span: 7.62, cr: 1.473, ct: 1.473, sweep: 0, dih: 3.5, z: 0.085, t: [0.15, 0.135] },
  eng: { kind: "none", nose: { s: 0.33, z: 0.42, d: 1.83, blades: 2 } },
  stab: { le: 1.23, z: 0.69, span: 3.1, root: 0.12, cr: 0.92, ct: 0.58, sweep: 13, dih: 0, thick: 0.1 },
  parts: {
    lines: [hinge(5.66, 0.33, 1.7, 5.49, 1.79), [[0.33, 0.24], [0.33, 0.6]]],
    gear: [wheelLeg([1.3, -0.01], [1.43, -0.4], [1.49, -0.6], 0.16),
      tailwheel([5.75, 0.345], [6.22, 0.15])],
  },
});
const RV7A_GEAR = [
  wheelLeg([1.83, 0], [1.95, -0.36], [2.03, -0.57], 0.16),
  wheelLeg([1.02, -0.07], [0.66, -0.42], [0.73, -0.58], 0.15, [0.06, 0.05], NOSEPANT),
];
F.rv7a = withGear(F.rv7, RV7A_GEAR);

// RV-9 / RV-9A: the RV-7 fuselage and tail with the longer (28 ft), narrower-chord (53 in, 124 sq ft) Roncz
// wing and a larger horizontal tail; not aerobatic. RV9Awb side view (70 in datum dimension, 6.23 m), fin and
// wing root as drawn there; tailwheel gear from RV9wb.
F.rv9 = rv({
  ...F.rv7, L0: 6.22,
  wing: { le: 1.6, root: 0.53, span: 8.53, cr: 1.346, ct: 1.346, sweep: 0, dih: 3.5, z: 0.08, t: [0.15, 0.135] },
  stab: { le: 1.26, z: 0.69, span: 3.4, root: 0.12, cr: 0.9, ct: 0.6, sweep: 11, dih: 0, thick: 0.1 },
  parts: {
    lines: [hinge(5.58, 0.33, 1.69, 5.4, 1.81), [[0.33, 0.24], [0.33, 0.6]]],
    gear: [wheelLeg([1.31, -0.01], [1.48, -0.42], [1.56, -0.61], 0.16), tailwheel([5.75, 0.345], [6.12, 0.2])],
  },
});
F.rv9a = withGear(F.rv9, [
  wheelLeg([1.95, 0], [2.04, -0.35], [2.12, -0.57], 0.16),
  wheelLeg([1.02, -0.06], [0.62, -0.44], [0.74, -0.58], 0.15, [0.06, 0.05], NOSEPANT),
]);

// RV-8 / RV-8A: the bigger tandem two-seater (after the RV-4) with the long sliding bubble, the big fin and
// the RV-4's lines stretched. RV8Awb side view (a scan, deskewed 1 degree; its 70 in datum
// dimension gives 6.37 m and a 57.3 in chord, against 21 ft / 6.4 m), drawn at 6.4 m. RV-8 tailwheel gear
// (main legs straight down at the leading edge) from RV8wb.
const RV8_BODY = [
  [0, 0.435, "c"], [0.06, 0.501], [0.15, 0.552], [0.3, 0.59], [0.36, 0.605], [0.48, 0.651], [1.0, 0.75], [1.7, 0.835, "c"],
  [1.77, 0.933], [1.86, 1.022], [2.07, 1.15], [2.28, 1.222], [2.58, 1.271], [2.91, 1.267], [3.27, 1.204], [3.45, 1.15],
  [3.69, 1.051], [3.85, 0.96], [4.02, 0.878, "l"], [5.13, 0.814], [5.19, 0.85], [5.23, 0.92, "l"], [5.49, 1.714],
  [5.53, 1.778], [5.6, 1.805, "l"], [6.1, 1.778], [6.14, 1.74, "cl"], [6.39, 0.613], [6.4, 0.54], [6.38, 0.48],
  [6.32, 0.44, "l"], [5.94, 0.355, "l"], [2.79, 0.017], [2.28, 0, "l"], [1.0, -0.005], [0.84, 0.014], [0.69, 0.057],
  [0.54, 0.122], [0.36, 0.25], [0.18, 0.303], [0.09, 0.345],
];
// RV-8 gear from the CAD: the main leg's fairing with its intersection fairing and the wheel pant (the tyre
// shows below it), and the tailwheel's spring and fork
const RV8_GEAR = [
  { at: [1.711, -0.591], r: 0.198, spat: { pts: [[1.713, -0.751], [1.653, -0.748], [1.596, -0.74], [1.543, -0.725], [1.496, -0.705],
    [1.47, -0.689], [1.438, -0.662], [1.416, -0.633], [1.406, -0.602], [1.408, -0.57], [1.421, -0.539], [1.446, -0.51], [1.481, -0.484],
    [1.525, -0.462], [1.558, -0.45], [1.613, -0.436], [1.671, -0.428], [1.711, -0.427], [1.788, -0.432], [1.839, -0.442],
    [2.249, -0.557, "c"], [2.249, -0.614, "c"], [1.892, -0.721], [1.79, -0.745]] },
    shapes: [["strut", [[1.649, -0.431, "c"], [1.643, -0.029, "c"], [1.681, -0.04], [1.754, -0.039, "c"], [1.802, -0.025, "c"], [1.773, -0.43, "c"]]],
      ["pant", [[1.76, 0.027], [1.718, 0.033], [1.684, 0.033], [1.656, 0.029], [1.625, 0.019], [1.614, 0.011], [1.614, -0.001, "c"],
        [1.647, -0.032], [1.681, -0.04], [1.754, -0.039], [1.774, -0.035], [1.886, 0.009, "c"]]]] },
  { at: [6.323, 0.158], r: 0.076, shapes: [["strut", [[5.834, 0.349, "c"], [6.155, 0.249, "c"], [6.15, 0.234, "c"], [5.83, 0.327, "c"]]],
    ["strut", [[6.205, 0.241, "c"], [6.237, 0.241, "c"], [6.237, 0.193, "c"], [6.205, 0.192, "c"]]],
    ["strut", [[6.204, 0.189, "c"], [6.246, 0.189, "c"], [6.326, 0.17, "c"], [6.323, 0.145, "c"], [6.204, 0.144, "c"]]]] },
];
// Detail from Van's CAD three-views ("3 VIEW ALL RV.dwg", vansaircraft.com 3_VIEW_ALL.zip), drawn 1:1 in
// inches: the RV-8 side view fits this outline within 2 cm (90 %, 3.6 cm at worst), so it is traced as is:
// the cowl's inlet lips and face, the upper skin line, the firewall seam with the cowl's exit lip under
// the belly, the windscreen base and frame, the canopy sill, skirt and aft frame, the wing root and the
// tailplane as drawn (wingSide, stabSide), the elevator joint, the rudder hinge with its horn, the rudder's
// top and lower edges, the main-leg fairing with its intersection fairing and wheel pant, and the tailwheel
// spring and fork.
F.rv8 = rv({
  L0: 6.4, W: 0.86, body: RV8_BODY,
  glass: [
    pane(RV8_BODY, 1.72, 2.12, [[2.12, 0.81], [1.8, 0.81], [1.74, 0.83]]),
    pane(RV8_BODY, 2.18, 3.95, [[3.75, 0.86, ""], [3.5, 0.82], [2.18, 0.81]]),
  ],
  wing: { le: 1.71, root: 0.43, span: 7.32, cr: 1.47, ct: 1.47, sweep: 0, dih: 3.5, z: 0.09, t: [0.15, 0.135] },
  wingSide: [["wing", [[2.505, 0.157], [2.301, 0.175], [2.091, 0.187], [1.966, 0.186], [1.875, 0.176], [1.808, 0.159], [1.759, 0.138],
    [1.721, 0.108], [1.709, 0.091], [1.705, 0.079], [1.704, 0.067], [1.709, 0.054], [1.716, 0.046], [1.73, 0.037], [1.761, 0.027],
    [1.845, 0.015], [1.978, -0.002], [2.095, -0.01], [2.431, -0.004], [2.796, 0.02], [3.169, 0.053, "c"], [3.158, 0.066], [3.084, 0.077]]]],
  eng: { kind: "none", nose: { s: 0.36, z: 0.435, d: 1.83, blades: 2 } },
  stab: { le: 1.21, z: 0.69, span: 3.0, root: 0.1, cr: 0.87, ct: 0.56, sweep: 12, dih: 0, thick: 0.1 },
  stabSide: [["stab", [[5.16, 0.693], [5.165, 0.701], [5.192, 0.713], [5.273, 0.732], [5.354, 0.739], [5.521, 0.744], [5.66, 0.739],
    [6.03, 0.702, "c"], [6.029, 0.695, "c"], [5.66, 0.653], [5.53, 0.646], [5.365, 0.648], [5.274, 0.655], [5.199, 0.671], [5.175, 0.679]]],
    ["hl", [[5.659, 0.739], [5.659, 0.652]], false]],
  parts: {
    lines: [
      // rudder hinge and horn, the rudder's top and lower edges
      [[5.833, 0.354], [5.834, 1.728], [5.673, 1.732], [5.674, 1.817]], [[5.671, 1.735], [6.124, 1.715]], [[5.931, 0.365], [6.316, 0.454]],
      // cowl: inlet lips and face, upper skin line, firewall seam running into the exit lip under the belly
      [[0.34, 0.524], [0.425, 0.58], [0.462, 0.596], [0.554, 0.627], [0.668, 0.655]],
      [[0.34, 0.524], [0.356, 0.516], [0.364, 0.502], [0.365, 0.391], [0.355, 0.374], [0.341, 0.367]], [[0.34, 0.524], [0.341, 0.367]],
      [[0.431, 0.255], [0.366, 0.322], [0.341, 0.367]], [[1.937, 0.861], [0.618, 0.674]],
      [[1.197, 0.756], [1.224, 0.561], [1.228, -0.063], [0.931, 0.011]],
      // windscreen base and frame, canopy sill and skirt
      [[1.685, 0.825], [1.81, 0.793], [1.939, 0.781], [2.004, 0.782]], [[1.937, 0.861], [1.942, 0.836], [1.966, 0.813], [2.013, 0.795], [2.062, 0.786]],
      [[2.004, 0.782], [3.422, 0.838]],
      [[2.151, 0.788], [2.152, 0.65], [3.31, 0.656], [3.4, 0.716], [3.466, 0.745], [3.535, 0.764], [3.681, 0.788], [3.79, 0.814], [3.896, 0.847], [4.0, 0.888]],
    ],
    // the canopy's aft frame, over the glass
    marks: [["hl", [[3.402, 0.837], [3.421, 0.91], [3.768, 0.892]], false],
      ["hl", [[3.422, 0.838], [3.52, 0.845], [3.618, 0.858], [3.714, 0.878], [3.809, 0.904], [3.902, 0.935]], false]],
    gear: RV8_GEAR,
  },
});
// RV-8A gear from the CAD: the raked main-leg fairing with its intersection fairing and pant, and the nose
// leg's fairing and pant (the tyres show below the pants)
F.rv8a = withGear(F.rv8, [
  { at: [2.32, -0.545], r: 0.182, spat: { pts: [[2.859, -0.487, "c"], [2.449, -0.372], [2.398, -0.362], [2.301, -0.357], [2.242, -0.362],
    [2.186, -0.374], [2.135, -0.391], [2.091, -0.413], [2.066, -0.43], [2.038, -0.458], [2.021, -0.488], [2.015, -0.52], [2.021, -0.552],
    [2.039, -0.582], [2.067, -0.61], [2.106, -0.634], [2.152, -0.654], [2.205, -0.669], [2.303, -0.681], [2.4, -0.674], [2.451, -0.664],
    [2.859, -0.545, "c"]] },
    shapes: [["strut", [[2.191, -0.372, "c"], [2.013, -0.034, "c"], [2.173, -0.032, "c"], [2.3, -0.357, "c"]]],
      ["pant", [[1.967, 0.013, "c"], [1.992, -0.011], [2.013, -0.034], [2.03, -0.043], [2.085, -0.046], [2.124, -0.046], [2.144, -0.042],
        [2.173, -0.031], [2.264, 0.005, "c"], [2.15, 0.012], [2.05, 0.014]]]] },
  { at: [0.8, -0.642], r: 0.14, spat: { pts: [[1.19, -0.583, "c"], [0.868, -0.493], [0.828, -0.485], [0.752, -0.481], [0.675, -0.491],
    [0.597, -0.519], [0.567, -0.538], [0.545, -0.56], [0.531, -0.584], [0.527, -0.609], [0.532, -0.634], [0.545, -0.658], [0.568, -0.68],
    [0.598, -0.699], [0.676, -0.726], [0.753, -0.735], [0.829, -0.731], [0.869, -0.722], [1.19, -0.629, "c"]] },
    shapes: [["strut", [[1.028, -0.021, "c"], [0.601, -0.495], [0.592, -0.507], [0.585, -0.526, "c"], [0.63, -0.504, "c"], [0.638, -0.491],
      [0.654, -0.486], [0.7, -0.476], [0.742, -0.472, "c"], [1.088, -0.087], [1.111, -0.07], [1.128, -0.061], [1.145, -0.055], [1.173, -0.051, "c"]]]] },
]);

// RV-10: the four-seater: a cabin with a roof rather than a bubble, big gull-wing doors (the door window
// in each) and fixed rear windows, IO-540 with a three-blade propeller, tricycle gear only. RV10wb side
// view, scaled to the 24 ft 5 in (7.44 m) length (its 99.44 in datum dimension gives 7.32 m).
const RV10_BODY = [
  [0, 0.52, "c"], [0.12, 0.62], [0.27, 0.683], [0.54, 0.714], [0.78, 0.765], [1.05, 0.79], [1.38, 0.836], [1.6, 0.875],
  [1.76, 0.9, "c"], [1.89, 1.0], [2.04, 1.113], [2.18, 1.215], [2.32, 1.275], [2.5, 1.31], [2.7, 1.328], [2.91, 1.33],
  [3.36, 1.282], [3.8, 1.2], [4.29, 1.097, "l"], [6.0, 0.944], [6.08, 0.99], [6.13, 1.08, "l"], [6.45, 2.1], [6.5, 2.15],
  [6.58, 2.162, "l"], [7.1, 2.07], [7.16, 2.02, "cl"], [7.41, 0.76], [7.44, 0.6], [7.42, 0.51], [7.35, 0.47, "l"],
  [6.89, 0.405, "l"], [5.82, 0.288], [4.29, 0.134], [3.72, 0.07], [3.12, 0, "l"], [1.5, 0], [1.2, -0.015], [0.9, -0.03],
  [0.7, -0.03], [0.6, 0.0, "c"], [0.55, 0.15], [0.48, 0.226], [0.36, 0.32], [0.27, 0.35], [0.12, 0.42],
];
// Detail from Van's CAD three-views ("3 VIEW ALL RV.dwg"): the RV-10 side view (drawn without its spinner)
// fits this outline within 1.5 cm (median; 4.5 cm for 90 %), so the outline stays. Its door window and rear
// window are taken from it (the earlier ones were 5-10 cm off), and traced: the cowl's upper and lower
// lines, inlet face and lip, the firewall seam running into the cowl's lower lip, the windscreen's lower
// frame and corner fairing, the gull-wing door and the baggage door, the wing root as drawn (wingSide), the
// rudder hinge and horn, the rudder's lower edge, the tail light, the elevator joint, the main-leg fairing
// with its pant and seam, and the nose-leg fairing (the CAD leaves the nose pant incomplete: the one drawn
// is from Van's silhouette).
F.rv10 = rv({
  L0: 7.44, W: 1.27, body: RV10_BODY,
  glass: [
    pane(RV10_BODY, 1.79, 2.4, [[2.429, 1.215, "c"], [2.409, 1.17], [2.262, 0.74, "c"], [2.176, 0.743], [2.113, 0.773], [2.07, 0.827], [2.054, 0.898, "c"],
      [1.82, 0.89]]),
    [[2.345, 0.72], [2.371, 0.698], [2.406, 0.69], [3.106, 0.725], [3.121, 0.729], [3.147, 0.752], [3.153, 0.778], [3.146, 1.186], [3.124, 1.218],
      [3.077, 1.235], [2.938, 1.242], [2.778, 1.242], [2.641, 1.233], [2.507, 1.215], [2.474, 1.201], [2.45, 1.171], [2.333, 0.791]],
    [[3.214, 0.782], [3.223, 0.756], [3.242, 0.74], [3.268, 0.734], [3.404, 0.742], [3.532, 0.757], [3.645, 0.777], [3.769, 0.806], [3.829, 0.838],
      [3.858, 0.874], [3.875, 0.97], [3.854, 1.022], [3.836, 1.045], [3.79, 1.076], [3.659, 1.126], [3.53, 1.165], [3.396, 1.195], [3.268, 1.214],
      [3.219, 1.199], [3.21, 1.172]],
  ],
  wing: { le: 2.08, root: 0.63, span: 9.68, cr: 1.42, ct: 1.42, sweep: 0, dih: 3.5, z: 0.085, t: [0.15, 0.135] },
  wingSide: [["wing", [[2.128, 0.074], [2.137, 0.089], [2.165, 0.117], [2.207, 0.142], [2.256, 0.163], [2.321, 0.182], [2.386, 0.197], [2.47, 0.208],
    [2.532, 0.212], [2.611, 0.211], [2.686, 0.203], [2.833, 0.179], [3.31, 0.085], [3.557, 0.054, "c"], [3.309, 0.022], [2.627, -0.017],
    [2.436, -0.013], [2.258, 0.003], [2.173, 0.024], [2.146, 0.036], [2.126, 0.062]]]],
  eng: { kind: "none", nose: { s: 0.27, z: 0.52, d: 2.03, blades: 3 } },
  stab: { le: 1.36, z: 0.88, span: 3.6, root: 0.14, cr: 0.99, ct: 0.62, sweep: 12, dih: 0, thick: 0.1 },
  parts: {
    // the gull-wing door (hinged at the roof) and the baggage door
    doors: [[[2.251, 0.661, "c"], [2.254, 0.456], [2.265, 0.445, "l"], [3.181, 0.455], [3.199, 0.467, "cl"], [3.191, 1.273, "c"], [3.007, 1.295],
      [2.728, 1.297], [2.561, 1.281], [2.497, 1.268], [2.46, 1.25], [2.43, 1.215, "cl"], [2.251, 0.674, "c"]],
      [[4.376, 0.732, "cl"], [3.85, 0.71, "cl"], [3.856, 0.195, "cl"], [4.194, 0.233, "cl"], [4.38, 0.417, "cl"]]],
    lines: [
      // rudder hinge and horn, the rudder's lower edge
      [[6.895, 0.432], [6.89, 0.907], [6.87, 1.967], [6.586, 1.992], [6.601, 2.161]], [[7.382, 0.525], [6.895, 0.432]],
      // cowl: upper and lower lines, inlet face and lower lip, the firewall seam into the lower lip
      [[0.429, 0.644], [0.593, 0.682], [0.823, 0.725], [1.413, 0.809]], [[0.426, 0.631], [0.429, 0.312]],
      [[0.431, 0.304], [0.502, 0.245], [0.582, 0.192], [0.672, 0.143], [0.8, 0.094], [0.931, 0.056], [1.067, 0.029], [1.204, 0.009], [1.342, -0.004], [1.48, -0.009]],
      [[1.449, 0.814], [1.48, 0.591], [1.487, -0.099], [1.106, -0.101], [1.003, -0.091], [0.899, -0.074], [0.794, -0.046]],
      // the windscreen's lower frame and its corner fairing
      [[2.18, 0.7], [1.976, 0.779], [1.894, 0.806]],
      [[2.251, 0.728], [2.251, 0.74], [2.176, 0.743], [2.143, 0.755], [2.113, 0.773], [2.089, 0.798], [2.07, 0.827], [2.059, 0.86], [2.054, 0.898], [1.414, 0.809]],
    ],
    // the elevator joint over the tailplane, the seam of the main-wheel pant
    marks: [["hl", [[6.706, 0.924], [6.706, 0.846]], false], ["hl", [[2.762, -0.693], [2.759, -0.538]], false]],
    // the tail light at the foot of the rudder
    dots: [["hub", 7.405, 0.568, 0.06, 0.032]],
    gear: [
      { at: [2.765, -0.568], r: 0.19, spat: { pts: [[2.413, -0.502], [2.424, -0.474], [2.447, -0.443], [2.479, -0.416], [2.525, -0.389], [2.573, -0.37],
        [2.633, -0.354], [2.698, -0.344], [2.754, -0.341], [2.84, -0.346], [2.926, -0.361], [3.03, -0.388], [3.243, -0.449], [3.374, -0.483, "c"],
        [3.375, -0.546, "c"], [3.22, -0.59], [2.942, -0.675], [2.883, -0.68], [2.81, -0.69], [2.763, -0.693], [2.706, -0.691], [2.617, -0.688],
        [2.544, -0.665], [2.49, -0.637], [2.486, -0.635], [2.411, -0.535]] },
        shapes: [["strut", [[2.424, -0.066, "c"], [2.599, -0.362, "c"], [2.752, -0.341, "c"], [2.64, -0.088, "c"]]]] },
      { at: [0.85, -0.63], r: 0.17, spat: { f: 0.3, a: 0.48, t: 0.19, b: 0.12 },
        shapes: [["strut", [[1.403, -0.1, "c"], [0.691, -0.504, "c"], [0.657, -0.452, "c"], [1.21, -0.102, "c"]]]] },
    ],
  },
});

// RV-12 / RV-12iS: the light-sport RV: Rotax with a three-blade propeller, one big forward-hinged canopy,
// tall slab-sided fin, an all-moving stabilator with its anti-servo tab under the rudder, tricycle gear only.
// RV12wb side view (its 70 in datum dimension: 5.98 m to the rudder, 6.22 m to the tab tip; 19 ft 11 in
// published), gear with the pants of Van's RV-12iS silhouette (vansaircraft.com/rv-12is/).
const RV12_BODY = [
  [0, 0.555, "c"], [0.12, 0.64], [0.25, 0.682], [0.69, 0.733], [1.0, 0.765], [1.26, 0.79], [1.48, 0.82, "c"],
  [1.56, 0.93], [1.65, 1.02], [1.83, 1.11], [2.01, 1.142], [2.2, 1.13], [2.4, 1.085], [2.6, 1.03], [2.94, 0.96, "l"],
  [4.71, 0.826], [4.75, 0.85], [4.78, 0.9, "l"], [5.24, 1.86], [5.28, 1.925], [5.35, 1.948, "l"], [5.62, 1.94],
  [5.66, 1.905, "l"], [5.97, 1.891, "c"], [5.995, 1.85, "l"], [6.0, 0.72], [6.02, 0.66, "c"], [5.95, 0.575],
  [5.82, 0.49], [5.6, 0.44, "l"], [2.31, 0.016], [2.0, 0, "l"], [0.96, 0.02], [0.82, -0.01], [0.72, -0.015],
  [0.6, 0.032], [0.42, 0.142], [0.3, 0.267], [0.24, 0.42], [0.12, 0.47],
];
F.rv12 = rv({
  L0: 6.07, W: 1.12, body: RV12_BODY,
  glass: [
    pane(RV12_BODY, 1.5, 2.2, [[2.12, 0.62], [1.75, 0.62, ""], [1.56, 0.74]]),
    pane(RV12_BODY, 2.28, 2.88, [[2.75, 0.8, ""], [2.5, 0.66], [2.22, 0.62]]),
  ],
  wing: { le: 1.59, root: 0.56, span: 8.15, cr: 1.45, ct: 1.45, sweep: 0, dih: 3.5, z: 0.085, t: [0.15, 0.135] },
  eng: { kind: "none", nose: { s: 0.25, z: 0.555, d: 1.73, blades: 3 } },
  stab: { le: 0.64, z: 0.62, span: 2.8, root: 0.1, cr: 0.72, ct: 0.66, sweep: 2, dih: 0, thick: 0.1 },
  parts: {
    lines: [[[5.62, 0.75], [5.62, 1.94]], [[0.25, 0.42], [0.25, 0.68]]],
    gear: [
      wheelLeg([2.24, 0.1], [2.2, -0.25], [2.18, -0.37], 0.17, [0.12, 0.05], { f: 0.28, a: 0.45, t: 0.17, b: 0.1 }),
      wheelLeg([0.77, -0.02], [0.47, -0.25], [0.58, -0.36], 0.15, [0.05, 0.04], { f: 0.25, a: 0.38, t: 0.15, b: 0.09 }),
    ],
  },
});

// RV-14 / RV-14A: the newest two-seat side-by-side RV: a wider, taller cabin under a one-piece tip-up canopy
// with a fixed rear window, the bigger cowl of the IO-390, the big fin. RV14wb side view (72 in datum
// dimension; 6.43 m spinner to rudder = 21 ft 1 in published); RV-14A gear from RV14Awb (same scale).
const RV14_BODY = [
  [0, 0.45, "c"], [0.06, 0.515], [0.15, 0.564], [0.24, 0.593], [0.35, 0.625], [0.93, 0.721], [1.2, 0.76], [1.62, 0.81, "c"],
  [1.75, 0.94], [1.86, 1.0], [2.04, 1.093], [2.22, 1.152], [2.43, 1.182], [2.64, 1.177], [2.85, 1.15], [3.0, 1.1],
  [3.15, 1.06], [3.33, 1.025, "l"], [5.04, 0.834], [5.1, 0.858], [5.15, 0.93, "l"], [5.46, 1.849], [5.52, 1.883],
  [5.6, 1.89, "l"], [6.09, 1.829], [6.14, 1.79, "cl"], [6.42, 0.633], [6.43, 0.544], [6.41, 0.49], [6.34, 0.455, "l"],
  [5.8, 0.353, "l"], [3.06, 0.044], [2.16, 0, "l"], [1.3, -0.01], [1.17, -0.02], [0.93, 0.005], [0.66, 0.083],
  [0.51, 0.152], [0.36, 0.275], [0.15, 0.333], [0.06, 0.382],
];
F.rv14 = rv({
  L0: 6.43, W: 1.17, body: RV14_BODY,
  glass: [
    pane(RV14_BODY, 1.64, 2.84, [[2.74, 0.67], [1.92, 0.67, ""], [1.72, 0.74]]),
    pane(RV14_BODY, 2.92, 3.24, [[3.12, 0.85, ""], [2.97, 0.66], [2.85, 0.66]]),
  ],
  wing: { le: 1.62, root: 0.58, span: 8.23, cr: 1.42, ct: 1.42, sweep: 0, dih: 3.5, z: 0.1, t: [0.16, 0.14] },
  eng: { kind: "none", nose: { s: 0.35, z: 0.45, d: 1.88, blades: 2 } },
  stab: { le: 1.24, z: 0.715, span: 3.2, root: 0.12, cr: 0.86, ct: 0.56, sweep: 13, dih: 0, thick: 0.1 },
  parts: {
    lines: [hinge(5.8, 0.36, 1.74, 5.63, 1.885), [[0.35, 0.28], [0.35, 0.62]]],
    gear: [wheelLeg([1.26, -0.03], [1.5, -0.49], [1.61, -0.68], 0.18, [0.12, 0.09], { f: 0.29, a: 0.54, t: 0.19, b: 0.13 }),
      tailwheel([5.79, 0.343], [6.3, 0.29], 0.07)],
  },
});
F.rv14a = withGear(F.rv14, [
  wheelLeg([2.31, -0.05], [2.34, -0.32], [2.3, -0.56], 0.17, [0.13, 0.1], { f: 0.32, a: 0.54, t: 0.24, b: 0.09 }),
  wheelLeg([1.12, -0.03], [0.63, -0.45], [0.85, -0.58], 0.17, [0.07, 0.06], { f: 0.34, a: 0.5, t: 0.17, b: 0.12 }),
]);

// the registered model name tells the tricycle "A" from the taildragger (an unknown name: the taildragger)
const tri = (n, a, tw) => (name) => (new RegExp(`RV[\\s-]?${n}\\s*-?A\\b`, "i").test(name || "") ? a : tw);

export const families = F;
export const types = {
  C150: "c150", C152: "c150", C172: "c172", C182: "c182", C206: "c206", C208: "c208b",
  P28A: "pa28", P28B: "pa28b", PA46: "pa46", P46T: "p46t",
  SR20: ["sr22", { eng: { kind: "none", nose: { s: 0.4, z: 0.61, d: 1.93, blades: 2 } } }], SR22: "sr22",
  DA40: "da40", DA42: "da42", BE36: "be36", BE58: "be58", M20P: "m20",
  CH7B: "ch7b", ST75: "st75", PC12: "pc12", TBM9: "tbm9",
  RV3: "rv3", RV4: "rv4", RV6: tri(6, "rv6a", "rv6"), RV7: tri(7, "rv7a", "rv7"), RV8: tri(8, "rv8a", "rv8"),
  RV9: tri(9, "rv9a", "rv9"), RV10: "rv10", RV12: "rv12", RV14: tri(14, "rv14a", "rv14"),
};
