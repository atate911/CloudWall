// Single-engine utility aircraft and trainers: the Pilatus Porter and turboprop trainers, the Epic
// LT, the Kodiak and the Otter. Format: see ../profiles.js.
//
// Drawn like the light aircraft (profiles/light.js): `body` outlines with D = 1, so every point is
// in metres, the fin part of the body outline, and small parts listed as data in `parts`. A body
// outline does not stretch, so every family's L0 + over equals the types.csv length of the types
// mapped to it. Retractable gear is drawn up, as in flight.
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------
//   doors   closed [s, z, flag] loops drawn with the door stroke
//   lines   [s, z] polylines drawn as thin lines (rudder hinge, panel joints)
//   struts  [[s, z] bottom, [s, z] top, width at bottom, width at top]
//   gear    {leg: [[s, z] top, [s, z] bottom], w: [w0, w1], at: [s, z] axle, r, spat: {pts}, shapes, lines}
//   shapes  [class, [[s, z, flag]...], closed?] smooth parts drawn last, over the wing and glass
//   dots    [class, s, z, rx, ry] small round parts drawn last

// A tapered leg or strut from [s0, z0] to [s1, z1], w0 / w1 wide (metres, along s).
const leg = (sk, [s0, z0], [s1, z1], w0 = 0.08, w1 = w0) =>
  sk.poly("strut", [[s0 - w0 / 2, z0], [s0 + w0 / 2, z0], [s1 + w1 / 2, z1], [s1 - w1 / 2, z1]]);

// A wheel with a traced spat outline, or a plain hub.
function wheel(sk, s, z, r, spat) {
  sk.ellipse("tire", s, z, r, r);
  if (spat && spat.pts) sk.smooth("pant", spat.pts);
  else sk.ellipse("hub", s, z, r * 0.42, r * 0.42);
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
    for (const [cls, pts, closed = true] of g.shapes || []) k.sk.smooth(cls, pts, closed);
    for (const l of g.lines || []) k.sk.poly("hl", l, false);
  }
  for (const [cls, pts, closed = true] of p.shapes || []) k.sk.smooth(cls, pts, closed);
  for (const [cls, s, z, rx, ry = rx] of p.dots || []) k.sk.ellipse(cls, s, z, rx, ry);
}];

// A rounded rectangle: s0..s1, z0..z1, corner radius rr.
const rect = (s0, s1, z0, z1, rr = 0.06) => [[s0 + rr, z0, "l"], [s1 - rr, z0], [s1, z0 + rr, "l"], [s1, z1 - rr], [s1 - rr, z1, "l"],
  [s0 + rr, z1], [s0, z1 - rr, "l"], [s0, z0 + rr]];
// the same as a glass pane (pane corners are sharp unless flagged smooth)
const pane = (...a) => rect(...a).map((p) => (p[2] ? p : [p[0], p[1], ""]));

// ---------- Pilatus PC-21 ----------
// Reference: Pilatus "PC-21 Model Building Plan 1:25" (pilatus-aircraft.com, Media, Model Building
// Plans), page 2: the manufacturer's dimensioned side view, a vector drawing rendered at 900 dpi and
// scaled by its own 36 ft 11 in (11.23 m) overall length, nose tip to tailplane tip (3.9 mm a pixel).
// The view shows the gear down; it is drawn retracted, as in flight. Long pointed nose over the
// PT6A-68B with its exhaust stacks and the five-blade prop, the stepped tandem canopy in one long
// bubble, the low wing's big root fillet, the swept fin with its curved dorsal fin, and the ventral
// strake under the upswept tail cone.
F.pc21 = {
  kind: "turboprop", L0: 11.23, over: 0, D: 1, W: 1.0,
  body: [
    [0, 0.5, "c"], [0.1, 0.585], [0.25, 0.655], [0.5, 0.742], [0.75, 0.8], [1.0, 0.862], [1.5, 0.947], [2.0, 1.025],
    [2.5, 1.108], [2.9, 1.18], [3.02, 1.215, "c"], [3.25, 1.383], [3.5, 1.523], [3.75, 1.643], [4.0, 1.738], [4.5, 1.877],
    [5.0, 1.951], [5.4, 1.967], [5.75, 1.947], [6.0, 1.9], [6.25, 1.827], [6.55, 1.745], [6.75, 1.695], [7.3, 1.638],
    [7.7, 1.66], [8.0, 1.711], [8.5, 1.788], [9.0, 1.866], [9.2, 1.94], [9.35, 2.1, "l"], [9.75, 2.92], [9.86, 3.05],
    [10.25, 3.09, "l"], [10.8, 3.17, "c"], [10.75, 0.97, "c"],
    [10.5, 0.908], [10.0, 0.808], [9.5, 0.72], [9.0, 0.633], [8.5, 0.544], [8.0, 0.455], [7.5, 0.364], [7.0, 0.277],
    [6.5, 0.192], [6.0, 0.114], [5.5, 0.04], [5.0, 0.0], [4.0, -0.005], [3.0, -0.005], [2.0, -0.002], [1.5, 0.006],
    [1.25, 0.025], [1.1, 0.08], [1.0, 0.2], [0.92, 0.275, "c"], [0.83, 0.285], [0.5, 0.312], [0.25, 0.37], [0.1, 0.43],
  ],
  // the front and rear cockpits' glazing either side of the canopy arch
  glass: [
    [[3.1, 1.24, "c"], [3.5, 1.505, ""], [4.0, 1.715, ""], [4.4, 1.835, ""], [4.72, 1.905, "c"], [4.63, 1.34, "c"], [3.38, 1.13, "c"]],
    [[4.9, 1.935, "c"], [5.4, 1.952, ""], [5.9, 1.905, ""], [6.25, 1.8, ""], [6.47, 1.735, "c"], [6.13, 1.55, "c"], [4.8, 1.36, "c"]],
  ],
  frame: 0.03,
  wing: { le: 3.55, root: 0.5, span: 9.11, cr: 2.3, ct: 1.0, sweep: 5, dih: 6, z: 0.1, t: [0.15, 0.12] },
  // the wing root as the plan draws it: the big fillet blending into the fuselage side, its inner
  // edge, and the flap fairing under the trailing edge
  wingSide: [
    ["wing", [[3.56, 0.24, "c"], [3.66, 0.37], [3.9, 0.475], [4.2, 0.513], [4.5, 0.527], [4.9, 0.56], [5.2, 0.59], [5.5, 0.6],
      [5.68, 0.6, "c"], [5.88, 0.09, "c"], [5.5, 0.0], [4.5, -0.012], [4.0, -0.002], [3.7, 0.06], [3.6, 0.13]]],
    ["hl", [[3.62, 0.18], [3.8, 0.29], [4.2, 0.39], [4.5, 0.46], [4.7, 0.515]], false],
    ["hl", [[4.66, 0.36, "c"], [5.0, 0.37], [5.4, 0.415], [5.66, 0.5, "c"], [5.4, 0.225], [5.0, 0.192], [4.8, 0.175]], false],
  ],
  eng: { kind: "none", nose: { s: 0.72, z: 0.5, d: 2.39, blades: 5 } },
  stab: {},
  stabSide: [
    ["stab", [[8.55, 1.13, "c"], [9.2, 1.19], [10.0, 1.205], [10.8, 1.17], [11.23, 1.125, "c"], [10.8, 1.08], [10.0, 1.05], [9.2, 1.07]]],
    ["hl", [[9.9, 1.2], [9.9, 1.05]], false],
  ],
  parts: {
    // the rudder hinge; the cowling's seams
    lines: [[[10.15, 3.07], [9.9, 1.36]], [[1.64, 1.0], [1.83, 0.0]], [[2.14, 1.07], [2.27, 0.3]], [[3.02, 1.215], [3.05, 0.25]],
      ...[0.81, 0.86, 0.91, 0.96, 1.01].map((z) => [[8.02, z], [8.36, z]])],
    // the access panels on the rear fuselage and the louvred vent behind them
    doors: [rect(6.86, 7.32, 0.62, 1.08, 0.08), rect(6.33, 6.78, 0.15, 0.43, 0.07), rect(7.98, 8.4, 0.76, 1.05, 0.07)],
    // the exhaust stack on the cowling, the ventral strake under the tail cone, the antennas on the
    // cowling, the spine and the belly
    shapes: [
      ["core", [[1.17, 0.6, "c"], [1.3, 0.67], [1.6, 0.665], [1.66, 0.58, "c"], [1.4, 0.5], [1.2, 0.53]]],
      ["fin", [[8.45, 0.545, "c"], [10.6, 0.672, "c"], [10.74, 0.95, "c"], [9.6, 0.735]]],
      ["strut", [[2.5, 1.09, "c"], [2.57, 1.16, "c"], [2.63, 1.15, "c"], [2.62, 1.1, "c"]]],
      ["strut", [[7.25, 1.63, "c"], [7.35, 1.71, "c"], [7.42, 1.7, "c"], [7.4, 1.635, "c"]]],
      ["strut", [[7.58, 0.36, "c"], [7.56, 0.2, "c"], [7.2, 0.15, "c"], [7.19, 0.18, "c"], [7.49, 0.22, "c"], [7.5, 0.35, "c"]]],
    ],
    dots: [["inlet", 1.42, 0.59, 0.12, 0.045]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

export const families = F;
export const types = {
  PC21: "pc21",
};
