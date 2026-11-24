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

// ---------- Pilatus PC-9 ----------
// Reference: Pilatus "PC-9 M Model Building Plan 1:25" (pilatus-aircraft.com, Media, Model Building
// Plans), page 2: the manufacturer's dimensioned side view, a vector drawing rendered at 1200 dpi and
// scaled by its own 33 ft 4 in (10.18 m) length, nose tip to tailplane tip (2.8 mm a pixel; the 2.31 m
// wheelbase then measures within 1 cm). Gear drawn up. Long nose with the big exhaust stack, the
// stepped tandem canopy, the low wing rising to its tips (seen from the side as a tall trapezoid),
// the swept fin on a long straight dorsal fin and the ventral fin under the tail cone (PC-9 M).
F.pc9 = {
  kind: "turboprop", L0: 10.18, over: 0, D: 1, W: 0.97,
  body: [
    [0, 0.72, "c"], [0.1, 0.83], [0.25, 0.9], [0.5, 0.985], [0.75, 1.021], [1.0, 1.052], [1.5, 1.113], [2.0, 1.171], [2.5, 1.225],
    [2.66, 1.245, "c"], [2.75, 1.29], [3.0, 1.426], [3.25, 1.543], [3.5, 1.632], [3.75, 1.7], [4.0, 1.748], [4.5, 1.788], [4.75, 1.793],
    [5.0, 1.779], [5.25, 1.73], [5.5, 1.64], [5.75, 1.533], [6.0, 1.442], [6.25, 1.377], [6.47, 1.33, "cl"], [7.5, 1.43, "cl"],
    [8.4, 1.93, "cl"], [8.6, 2.58], [8.75, 2.66, "l"], [9.3, 2.61, "cl"], [9.62, 0.98, "c"],
    [9.66, 0.85], [9.83, 0.72], [9.84, 0.6], [9.75, 0.503], [9.5, 0.414], [9.25, 0.36], [9.0, 0.322], [8.5, 0.3], [8.25, 0.322],
    [8.0, 0.312], [7.5, 0.266], [7.0, 0.221], [6.5, 0.176], [6.0, 0.13], [5.5, 0.086], [5.0, 0.037], [4.5, 0.006], [4.0, -0.006],
    [3.5, 0.01], [3.0, 0.04], [2.5, 0.071], [2.0, 0.101], [1.5, 0.13], [1.0, 0.191], [0.8, 0.25], [0.7, 0.31], [0.66, 0.42, "c"],
    [0.55, 0.47], [0.4, 0.5], [0.25, 0.551], [0.1, 0.62],
  ],
  // front and rear cockpits either side of the canopy arch
  glass: [
    [[2.8, 1.31, "c"], [3.0, 1.42, ""], [3.5, 1.62, ""], [4.0, 1.735, ""], [4.33, 1.775, "c"], [4.13, 1.12, "c"], [3.18, 1.06, "c"]],
    [[4.47, 1.785, "c"], [4.75, 1.788, ""], [5.0, 1.772, ""], [5.25, 1.72, ""], [5.42, 1.65, "c"], [5.17, 1.2, "c"], [4.27, 1.13, "c"]],
  ],
  frame: 0.03,
  wing: { le: 3.15, root: 0.48, span: 10.19, cr: 2.1, ct: 1.0, sweep: 3, dih: 7, z: 0.05, t: [0.15, 0.12] },
  // the wing as the plan draws it: the outer panel rising to the tip, the aileron and flap lines and
  // the flap-track fairing behind the root
  wingSide: [
    ["wing", [[3.68, 0.735, "c"], [4.0, 0.765], [4.5, 0.73], [4.84, 0.72, "c"], [5.25, 0.08, "c"], [4.5, 0.0], [3.75, -0.006],
      [3.25, 0.02], [3.12, 0.1], [3.15, 0.22], [3.4, 0.45]]],
    ["hl", [[4.46, 0.68], [4.97, 0.0]], false],
    ["hl", [[4.62, 0.37], [5.02, 0.37]], false],
    ["wing", [[4.98, 0.33, "c"], [5.4, 0.27], [5.75, 0.17, "c"], [5.3, 0.1], [5.05, 0.1]]],
  ],
  eng: { kind: "none", nose: { s: 0.4, z: 0.72, d: 2.44, blades: 4 } },
  stab: {},
  stabSide: [
    ["stab", [[8.05, 0.765, "c"], [8.5, 0.82], [9.3, 0.865], [9.8, 0.86], [10.18, 0.83, "c"], [9.8, 0.795], [9.3, 0.765], [8.5, 0.74]]],
  ],
  parts: {
    // the rudder hinge, the fuselage's lower line over the ventral fin, the cowling's seams and its
    // side access door
    lines: [[[8.95, 2.64], [8.88, 0.99]], [[8.5, 0.354], [9.0, 0.422], [9.25, 0.473], [9.5, 0.554], [9.64, 0.62]],
      [[0.55, 0.99], [0.58, 0.47]], [[1.45, 1.12], [1.48, 0.13]], [[1.45, 0.66], [1.95, 0.66], [2.15, 0.85], [2.5, 0.85], [2.5, 1.12]]],
    doors: [rect(2.18, 2.55, 0.53, 0.8, 0.03), rect(6.25, 6.76, 0.48, 0.8, 0.04), rect(6.98, 7.27, 0.66, 0.82, 0.03),
      rect(2.65, 3.2, 0.05, 0.25, 0.04)],
    // the exhaust stack and its outlet
    shapes: [
      ["core", [[0.72, 0.73, "c"], [0.85, 0.795], [1.2, 0.81], [1.38, 0.795, "c"], [1.4, 0.68, "c"], [1.2, 0.665], [0.85, 0.68]]],
    ],
    dots: [["inlet", 1.3, 0.74, 0.06, 0.06]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Pilatus PC-6 Porter / Turbo Porter ----------
// Reference: "Pilatus PC-6 Turbo-Porter 3-view line drawing" (Wikimedia Commons,
// File:Pilatus_PC-6_Turbo-Porter_3-view_line_drawing.svg, Wikipedia article Pilatus PC-6 Porter),
// the side view rendered 1920 px wide and scaled by the 10.90 m length in Pilatus's PC-6 model
// building plan (8.4 mm a pixel). A PT6A Turbo Porter: the long slim cowl with its exhaust stack,
// the deep slab-sided cabin with the wing sitting on its roof, a single strut each side, the big
// sliding door, the tall square fin and rudder, and the long-legged main gear and tailwheel.
F.pc6 = {
  kind: "turboprop", L0: 10.9, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.5, "c"], [0.15, 0.62], [0.32, 0.73], [0.5, 0.82], [0.56, 0.86, "c"], [1.0, 0.94], [1.5, 1.0], [2.0, 1.07], [2.5, 1.13],
    [3.05, 1.18, "c"], [3.25, 1.33], [3.42, 1.47], [3.62, 1.54, "l"], [5.6, 1.54, "l"], [6.0, 1.52, "l"], [7.1, 1.435, "cl"],
    [9.12, 2.0, "cl"], [9.12, 3.13, "cl"], [9.56, 3.13, "cl"], [9.56, 3.25, "cl"], [10.3, 3.25, "cl"], [10.3, 1.33, "c"],
    [10.43, 1.2], [10.48, 1.02, "c"], [10.0, 0.87, "l"], [6.27, 0.17, "cl"], [2.65, 0.0, "l"], [1.95, 0.04], [1.0, 0.12, "c"],
    [0.98, 0.2], [0.9, 0.28, "c"], [0.56, 0.27, "c"], [0.4, 0.31], [0.2, 0.4],
  ],
  // the windscreen's side pane, the cockpit door window, the two arched cabin windows in the
  // sliding door, and the round window behind it
  glass: [
    [[3.16, 1.2, "c"], [3.42, 1.43, ""], [3.62, 1.5, "c"], [3.6, 1.38, "c"], [3.32, 1.15, "c"]],
    [[3.42, 1.33, "c"], [3.4, 0.75, "c"], [3.8, 0.72, "c"], [3.87, 1.28], [3.78, 1.36, "c"]],
    [[4.16, 0.92, "c"], [4.16, 1.06, ""], [4.24, 1.22, ""], [4.45, 1.3, ""], [4.88, 1.3, "c"], [4.88, 0.92, "c"]],
    [[4.96, 0.92, "c"], [4.96, 1.3, "c"], [5.4, 1.3, ""], [5.61, 1.22, ""], [5.69, 1.06, ""], [5.69, 0.92, "c"]],
    [[5.79, 1.11, ""], [5.84, 1.22, ""], [5.95, 1.26, ""], [6.06, 1.22, ""], [6.11, 1.11, ""], [6.06, 1.0, ""], [5.95, 0.96, ""], [5.84, 1.0, ""]],
  ],
  frame: 0.035,
  wing: { le: 3.55, root: 0.6, span: 15.87, cr: 1.9, ct: 1.9, sweep: 0, dih: 1, z: 1.55, t: [0.14, 0.14] },
  // the wing on the cabin roof as the 3-view draws it, with its flap hinge line
  wingSide: [
    ["wing", [[3.55, 1.6, "c"], [3.7, 1.74], [4.0, 1.8], [4.5, 1.785], [5.0, 1.7], [5.4, 1.6], [5.65, 1.55, "c"], [5.0, 1.5], [4.0, 1.5], [3.6, 1.52]]],
    ["hl", [[4.7, 1.53], [5.45, 1.56]], false],
  ],
  eng: { kind: "none", nose: { s: 0.45, z: 0.5, d: 2.67, blades: 3 } },
  stab: {},
  stabSide: [
    ["stab", [[9.65, 1.2, "c"], [9.9, 1.27], [10.3, 1.27], [10.9, 1.16, "c"], [10.3, 1.12], [9.9, 1.12]]],
  ],
  parts: {
    // the sliding cabin door and its split, the cockpit door
    doors: [
      [[4.05, 0.25, "c"], [4.05, 1.12], [4.3, 1.33], [5.5, 1.33], [5.75, 1.12], [5.75, 0.25, "c"]],
      [[3.27, 1.4, "c"], [3.27, 0.3, "c"], [3.86, 0.3], [3.92, 0.5], [3.95, 1.36, "c"]],
    ],
    // the split between the sliding door's halves; the rudder hinge; the cowling's seams and panels
    lines: [[[4.92, 0.25], [4.92, 1.33]], [[9.6, 3.13], [9.62, 1.3]], [[1.25, 0.96], [1.27, 0.12]], [[2.65, 1.13], [2.65, 0.0]],
      [[1.27, 0.7], [2.65, 0.85]], [[1.3, 0.47], [2.65, 0.55]], [[6.27, 0.17], [6.27, 1.52]]],
    struts: [[[4.0, 0.08], [4.0, 1.5], 0.1, 0.09], [[3.36, -0.6], [3.98, 0.0], 0.06, 0.06]],
    gear: [
      { leg: [[3.32, 0.0], [3.32, -0.65]], w: [0.08, 0.07], at: [3.32, -0.65], r: 0.33 },
      { leg: [[10.5, 0.95], [10.47, 0.58]], w: [0.06, 0.05], at: [10.82, 0.42], r: 0.14,
        lines: [[[10.47, 0.58], [10.82, 0.42]]], shapes: [["strut", [[10.44, 0.6], [10.5, 0.62], [10.84, 0.45], [10.8, 0.4]]]] },
    ],
    // the exhaust stack, the scoop under the cowling and the step under the cabin
    shapes: [
      ["core", [[0.68, 0.48, "c"], [0.75, 0.56], [0.98, 0.58, "c"], [0.98, 0.49, "c"], [0.75, 0.46]]],
      ["strut", [[1.85, 0.05, "c"], [1.96, -0.05, "c"], [2.0, 0.04, "c"]]],
      ["strut", [[4.72, 0.0], [4.74, -0.13], [4.65, -0.13], [4.65, -0.16], [4.92, -0.16], [4.92, -0.13], [4.8, -0.13], [4.79, 0.0]]],
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

export const families = F;
export const types = {
  PC6: "pc6", PC9: "pc9", PC21: "pc21",
};
