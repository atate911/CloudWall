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

// ---------- de Havilland Canada DHC-3 Otter ----------
// Reference: "De Havilland Canada U-1A Otter 3-view line drawing" (Wikimedia Commons,
// File:De_Havilland_Canada_U-1A_Otter_3-view_line_drawing.png, from the US Army's characteristics
// summary of its Otters), the side view rendered 1920 px wide and scaled by the 41 ft 10 in (12.75 m)
// length (Wikipedia, DHC-3 Otter, from Jane's), hub to rudder, 12.3 mm a pixel. The original radial
// Otter (the turbine conversions fly under another type code): the blunt round cowl of the R-1340
// Wasp with its small hub, the tall slab-sided cabin under the wing, one strut a side, the double
// cargo door, the long curved dorsal fin sweeping up into the rounded fin, and the tailwheel.
F.dhc3 = {
  kind: "piston", L0: 12.75, over: 0, D: 1, W: 1.6,
  body: [
    [0.55, 0.9, "c"], [0.55, 1.42], [0.62, 1.56], [0.78, 1.6], [1.0, 1.61], [1.3, 1.64], [1.82, 1.74, "cl"], [2.6, 2.2, "c"],
    [5.2, 2.18, "l"], [5.75, 2.03, "l"], [8.0, 2.0], [8.5, 2.03], [9.25, 2.15], [10.0, 2.4], [10.5, 2.75], [10.9, 3.2],
    [11.2, 3.7], [11.45, 4.04], [11.75, 4.17], [12.0, 4.08], [12.25, 3.7], [12.5, 3.15], [12.68, 2.6], [12.75, 2.1], [12.72, 1.4],
    [12.62, 1.05], [12.45, 0.97, "c"], [11.75, 0.85], [11.0, 0.76], [10.25, 0.65], [9.5, 0.55], [8.5, 0.42], [7.5, 0.31],
    [6.5, 0.2], [5.5, 0.09], [4.5, 0.02], [3.5, 0.0], [2.5, 0.0], [1.75, 0.02], [1.3, 0.05], [1.0, 0.1], [0.8, 0.17],
    [0.65, 0.27], [0.57, 0.42],
  ],
  // the windscreen's edge, the two flight-deck side windows, the cabin windows and the two in the
  // cargo door
  glass: [
    [[1.92, 1.8, "c"], [2.55, 2.17, "c"], [2.6, 2.09, "c"], [2.0, 1.74, "c"]],
    [[1.98, 1.4], [1.98, 1.58], [2.12, 1.66], [2.15, 1.4]],
    [[2.22, 1.36], [2.22, 1.66], [2.32, 1.76, ""], [2.5, 1.76], [2.56, 1.36]],
    pane(3.15, 3.45, 1.25, 1.6, 0.08), pane(3.64, 3.94, 1.25, 1.6, 0.08), pane(4.15, 4.47, 1.25, 1.6, 0.08), pane(4.7, 5.02, 1.25, 1.6, 0.08),
    pane(5.6, 5.92, 1.25, 1.6, 0.08), pane(6.1, 6.42, 1.25, 1.6, 0.08),
  ],
  frame: 0.035,
  wing: { le: 2.85, root: 0.8, span: 17.69, cr: 2.0, ct: 2.0, sweep: 0, dih: 1, z: 2.1, t: [0.14, 0.14] },
  // the wing root on the cabin roof as the 3-view draws it, with the flap's root fairing
  wingSide: [
    ["wing", [[2.82, 2.27, "c"], [3.0, 2.36], [3.5, 2.43], [4.0, 2.4], [4.5, 2.32], [5.15, 2.18, "c"], [4.5, 2.06], [3.5, 1.93], [3.0, 1.93], [2.86, 2.08]]],
    ["hl", [[4.92, 1.88], [4.92, 2.15]], false],
  ],
  eng: { kind: "none", nose: { s: 0.4, z: 0.88, d: 2.65, blades: 3 } },
  stab: {},
  stabSide: [
    ["stab", [[10.65, 2.06, "c"], [11.0, 2.11], [11.7, 2.11], [12.15, 2.06, "c"], [11.7, 2.0], [11.0, 2.0]]],
  ],
  parts: {
    // the cargo door and its split, the crew door
    doors: [
      [[5.45, 0.45, "c"], [5.45, 1.6], [5.6, 1.72], [6.45, 1.72], [6.6, 1.6], [6.6, 0.45, "c"]],
      [[1.95, 0.65, "c"], [1.95, 1.6], [2.12, 1.78], [2.62, 1.78], [2.7, 1.6], [2.7, 0.95], [2.5, 0.65, "c"]],
      rect(1.95, 2.62, 0.04, 0.38, 0.06),
    ],
    // the cargo door's split, the rudder hinge, the cowling's rings and panel lines
    lines: [[[6.0, 0.45], [6.0, 1.72]], [[11.85, 3.75], [11.85, 0.86]], [[1.0, 0.11], [1.0, 1.61]], [[1.6, 0.04], [1.6, 1.68]],
      [[1.0, 1.15], [1.6, 1.15]], [[1.0, 0.48], [1.6, 0.48]], [[3.0, 0.2], [5.8, 0.24]]],
    struts: [[[3.85, 0.5], [3.55, 1.95], 0.13, 0.12], [[2.92, -0.88], [4.2, 0.0], 0.08, 0.07]],
    gear: [
      { leg: [[2.85, 0.55], [2.85, -0.9]], w: [0.14, 0.1], at: [2.85, -0.92], r: 0.4 },
      { leg: [[10.9, 0.7], [11.2, 0.36]], w: [0.08, 0.06], at: [11.24, 0.33], r: 0.19 },
    ],
    // the hub, the antenna mast ahead of the wing and the fairing behind it
    shapes: [
      ["hub", [[0.0, 0.88, "c"], [0.08, 0.98], [0.3, 1.0], [0.55, 0.97, "c"], [0.55, 0.79, "c"], [0.3, 0.76], [0.08, 0.78]]],
      ["strut", [[5.3, 2.15, "c"], [5.4, 2.21], [5.65, 2.2], [5.78, 2.1, "c"]]],
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Quest / Daher Kodiak 100 ----------
// No three-view reachable: measured from the side-on photo File:Quest_Kodiak_100_side_view_
// 20130608.jpg (Wikimedia Commons, N491KQ), rendered 1920 px wide and scaled by the 34 ft 2 in
// (10.41 m) length (Wikipedia, Daher Kodiak, from Quest's brochure), spinner to tailplane tip, 6.2 mm a
// pixel. Lower confidence (photo): the wing, seen from below in it, is drawn to the chord its 45 ft
// span and 240 sq ft area give. The PT6A's long cowl with its side exhaust stack, the fat cabin with
// four square windows a side, the high strut-braced wing, the long dorsal fin into the swept fin,
// and fixed tricycle gear.
F.kodi = {
  kind: "turboprop", L0: 10.41, over: 0, D: 1, W: 1.4,
  body: [
    [0, 0.71, "c"], [0.1, 0.8], [0.25, 0.88], [0.45, 0.95], [0.55, 0.99], [1.09, 1.07], [1.6, 1.1], [2.2, 1.12, "c"], [2.5, 1.26],
    [2.8, 1.42], [3.05, 1.52], [3.35, 1.56, "l"], [6.23, 1.58, "cl"], [8.27, 2.03, "cl"], [9.25, 3.68, "c"], [9.6, 3.68, "l"],
    [10.0, 3.66, "cl"], [9.75, 1.41, "c"], [9.7, 1.14, "l"], [8.75, 0.86], [7.8, 0.52], [6.68, 0.22], [5.56, 0.07], [4.5, 0.01],
    [3.5, 0.0], [2.5, 0.02], [2.0, 0.06], [1.6, 0.15], [1.0, 0.33], [0.6, 0.43], [0.45, 0.48], [0.25, 0.55], [0.1, 0.62],
  ],
  // the windscreen's side, the crew door window and the four cabin windows
  glass: [
    [[2.27, 1.13, "c"], [2.6, 1.3, ""], [2.97, 1.49, "c"], [3.02, 1.4, "c"], [2.62, 1.12, "c"]],
    [[3.43, 0.95, "c"], [3.38, 1.36, "c"], [3.05, 1.41, "c"], [2.72, 0.98, "c"]],
    pane(3.91, 4.36, 0.95, 1.25, 0.06), pane(4.69, 5.09, 0.95, 1.25, 0.06), pane(5.4, 5.78, 0.95, 1.25, 0.06), pane(6.18, 6.57, 0.95, 1.25, 0.06),
  ],
  frame: 0.035,
  wing: { le: 3.0, root: 0.7, span: 13.72, cr: 1.65, ct: 1.65, sweep: 0, dih: 1, z: 1.6, t: [0.15, 0.13] },
  wingSide: [
    ["wing", [[3.0, 1.57, "c"], [3.12, 1.71], [3.5, 1.79], [4.0, 1.77], [4.4, 1.69], [4.68, 1.6, "c"], [4.2, 1.55], [3.5, 1.53]]],
  ],
  eng: { kind: "none", nose: { s: 0.4, z: 0.71, d: 2.44, blades: 3 } },
  stab: {},
  stabSide: [
    ["stab", [[8.9, 1.42, "c"], [9.3, 1.5], [9.9, 1.48], [10.41, 1.28, "c"], [9.9, 1.3], [9.3, 1.33]]],
  ],
  parts: {
    // the crew door and the cabin door
    doors: [
      [[2.62, 0.38, "c"], [2.62, 0.95], [3.0, 1.46], [3.52, 1.46, "c"], [3.52, 0.38, "c"]],
    ],
    // the rudder hinge, the cowling's rear seam
    lines: [[[9.55, 3.66], [9.42, 1.45]], [[2.2, 1.12], [2.22, 0.06]]],
    struts: [[[3.72, 0.3], [3.49, 1.55], 0.17, 0.13]],
    gear: [
      { leg: [[4.66, 0.02], [4.38, -0.6]], w: [0.16, 0.1], at: [4.36, -0.6], r: 0.33 },
      { leg: [[1.37, 0.08], [1.25, -0.66]], w: [0.09, 0.07], at: [1.24, -0.66], r: 0.24 },
    ],
    // the exhaust stack; the main gear's root fairing on the belly
    shapes: [
      ["core", [[0.64, 0.7, "c"], [0.75, 0.8], [1.06, 0.8, "c"], [1.09, 0.66, "c"], [0.75, 0.64]]],
      ["pant", [[4.3, 0.05, "c"], [4.5, 0.18], [4.9, 0.17], [5.05, 0.05, "c"], [4.7, -0.05]]],
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Epic LT ----------
// No three-view reachable: measured from the near side-on photo File:Epic_LT_Dynasty.JPG (Wikimedia
// Commons: N6XK, the LT the company flew as its certification prototype), rendered 1920 px wide and
// scaled by the 35 ft 10 in (10.92 m) length (Wikipedia, Epic LT, from Epic), spinner to tailplane
// tip, 6.2 mm a pixel. Lower confidence (photo, taken from a little ahead): the wing, foreshortened in
// it, is drawn from its 43 ft span and 203.6 sq ft area. Gear drawn up. The long PT6A-67 cowl with
// its side exhaust stack, the pointed windscreen, the slim carbon fuselage with four oval windows a
// side, the low wing and the swept fin with the tailplane on its root.
const oval = (s, z, rx, ry) => Array.from({ length: 8 }, (_, i) => [s + rx * Math.cos(i * Math.PI / 4), z + ry * Math.sin(i * Math.PI / 4), ""]);
F.epic = {
  kind: "turboprop", L0: 10.92, over: 0, D: 1, W: 1.4,
  body: [
    [0, 0.83, "c"], [0.15, 0.95], [0.4, 1.05], [0.73, 1.13], [1.6, 1.21], [2.3, 1.25], [2.97, 1.29, "c"], [3.4, 1.46], [3.78, 1.58],
    [4.47, 1.66], [5.33, 1.68], [6.57, 1.61], [7.5, 1.52], [8.1, 1.46], [8.35, 1.46], [8.75, 1.62], [9.06, 1.86, "l"], [9.8, 2.47],
    [9.92, 2.52, "l"], [10.55, 2.53, "c"], [10.05, 1.18, "c"], [9.93, 1.0], [9.75, 0.68], [9.5, 0.55], [8.33, 0.37], [7.1, 0.24],
    [5.85, 0.12], [4.5, 0.04], [3.47, 0.02], [2.2, 0.0], [1.3, 0.02], [1.0, 0.1], [0.85, 0.28], [0.73, 0.52, "c"], [0.4, 0.62],
    [0.15, 0.72],
  ],
  // the pilot's side window under the pointed windscreen, and the four oval cabin windows
  glass: [
    [[3.0, 1.33, "c"], [3.45, 1.47, ""], [3.8, 1.54, ""], [4.24, 1.48, "c"], [4.2, 1.3, ""], [4.0, 1.19, "c"], [3.4, 1.24, ""]],
    oval(4.63, 1.335, 0.22, 0.155), oval(5.415, 1.34, 0.21, 0.155), oval(6.16, 1.31, 0.2, 0.14), oval(6.86, 1.27, 0.19, 0.14),
  ],
  frame: 0.02,
  wing: { le: 4.0, root: 0.6, span: 13.1, cr: 1.9, ct: 1.0, sweep: 5, dih: 5, z: 0.15, t: [0.15, 0.12] },
  eng: { kind: "none", nose: { s: 0.7, z: 0.83, d: 2.3, blades: 4 } },
  stab: {},
  stabSide: [
    ["stab", [[8.6, 1.1, "c"], [9.0, 1.16], [10.2, 1.15], [10.92, 1.04, "c"], [10.2, 1.0], [9.0, 1.04]]],
  ],
  parts: {
    // the cabin door
    doors: [rect(5.8, 6.54, 0.38, 1.58, 0.14)],
    // the rudder hinge and the cowling's rear seam
    lines: [[[10.2, 2.52], [9.82, 1.25]], [[2.81, 1.28], [2.81, 0.02]]],
    // the exhaust stack, the spine antennas
    shapes: [
      ["core", [[1.14, 0.83, "c"], [1.25, 0.93], [1.7, 0.92, "c"], [1.73, 0.72, "c"], [1.25, 0.73]]],
      ["strut", [[7.45, 1.53, "c"], [7.8, 1.9, "c"], [7.85, 1.88, "c"], [7.65, 1.51, "c"]]],
      ["strut", [[5.5, 1.67, "c"], [5.53, 1.76, "c"], [5.62, 1.76, "c"], [5.63, 1.67, "c"]]],
    ],
    dots: [["inlet", 1.66, 0.82, 0.05, 0.08]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

export const families = F;
export const types = {
  PC6: "pc6", PC9: "pc9", PC21: "pc21", DHC3: "dhc3", KODI: "kodi", EPIC: "epic",
};
