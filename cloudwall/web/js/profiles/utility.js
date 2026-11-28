// Utility and sport aircraft: crop sprayers, military trainers and the light singles and twins
// close to them (Air Tractor, Mentor, Bonanza 33 and 35, Commander). Format: see ../profiles.js.
//
// Drawn like light.js: `body` outlines with D = 1, so every point is in metres, and z = 0 the
// belly under the firewall; the fin is part of the body outline. A body outline does not stretch,
// so every family's L0 + over equals the types.csv length of the types mapped to it. The helpers
// below are copied from light.js, so that each group file loads on its own.
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------
// Each family lists its small parts as data in `parts`; the two functions below draw them,
// so a stretched copy (see stretch()) only has to move numbers.
//   doors   closed [s, z, flag] loops drawn with the door stroke
//   lines   [s, z] polylines drawn as thin lines (rudder hinge, panel joints)
//   struts  [[s, z] bottom, [s, z] top, width at bottom, width at top]
//   gear    {leg: [[s, z] top, [s, z] bottom], w: [w0, w1], at: [s, z] axle, r, spat: {f, a, t, b}, shapes, lines}
//           shapes / lines: that leg's own fairings and fittings ([class, pts, closed?] / [s, z] polylines),
//           drawn over its wheel; under: parts drawn before the wheel (leg fairings behind a wheel pant).
//           All are swapped with the gear by withGear() and carried by stretch() and scale()
//           spat: reach ahead of / behind the axle, top above / bottom below it; or {pts}: its traced outline
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
    for (const [cls, pts, closed = true] of g.under || []) k.sk.smooth(cls, pts, closed);
    if (g.at) wheel(k.sk, g.at[0], g.at[1], g.r, g.spat);
    for (const [cls, pts, closed = true] of g.shapes || []) k.sk.smooth(cls, pts, closed);
    for (const l of g.lines || []) k.sk.poly("hl", l, false);
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
        shapes: g.shapes && g.shapes.map(([c, pts, cl]) => [c, loop(pts), cl]), lines: g.lines && g.lines.map(loop),
        under: g.under && g.under.map(([c, pts, cl]) => [c, loop(pts), cl]) })),
    },
    ...more,
  };
}

// ---------- Beechcraft Bonanza 33 (Debonair) ----------
// Reference: Beechcraft E33 Bonanza 3-view (Commons), side view scaled by its own 7.77 m overall length
// a rounded-rectangle pane (glass corners are sharp unless flagged smooth)
const pane = (...a) => rect(...a).map((p) => (p[2] ? p : [p[0], p[1], ""]));
F.be33 = {
  kind: "piston", L0: 7.77, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.6, "c"], [0.1, 0.66], [0.2, 0.7], [0.3, 0.74], [0.4, 0.79], [0.6, 0.81], [1.0, 0.86], [1.3, 0.9], [1.58, 0.95, "cl"],
    [2.3, 1.37], [2.45, 1.4], [2.7, 1.415], [3.0, 1.42], [3.5, 1.38], [4.0, 1.3], [4.5, 1.22], [5.0, 1.18, "l"], [6.0, 1.18],
    [6.2, 1.22], [6.35, 1.35], [6.45, 1.5, "l"], [7.02, 2.26], [7.1, 2.32], [7.2, 2.33, "l"], [7.76, 2.31, "cl"], [7.53, 0.86, "c"],
    [7.63, 0.82], [7.67, 0.74], [7.62, 0.66], [7.45, 0.61], [7.0, 0.52], [6.5, 0.42], [6.0, 0.33], [5.5, 0.24], [5.0, 0.16],
    [4.5, 0.08], [4.0, 0.01], [3.5, -0.05], [3.0, -0.1], [2.4, -0.12], [2.0, -0.12], [1.5, -0.09], [1.0, -0.05], [0.7, -0.01],
    [0.55, 0.05], [0.47, 0.18], [0.42, 0.33], [0.38, 0.43], [0.3, 0.46], [0.2, 0.5], [0.1, 0.55],
  ],
  // windscreen side, front, middle and the tapered rear side window
  glass: [
    [[1.63, 0.96], [2.27, 1.35, ""], [2.05, 1.02, ""], [1.92, 0.88]],
    [[2.08, 0.84], [2.3, 1.28], [2.97, 1.29], [2.97, 0.81]],
    pane(3.0, 3.55, 0.82, 1.29, 0.06),
    [[3.68, 0.85], [3.68, 1.2], [4.0, 1.15, ""], [4.3, 1.0, ""], [4.38, 0.88]],
  ],
  frame: 0.035,
  wing: { le: 1.7, root: 0.6, span: 10.0, cr: 2.05, ct: 1.1, sweep: 6, dih: 6.5, z: 0.12, t: [0.15, 0.12] },
  // the wing as the 3-view draws it: the pointed root fillet curving up into the root fairing, the
  // flap's trailing edge at the root; the flap hinge and its cross line, the fillet's leading-edge panel
  wingSide: [
    ["wing", [[1.65, 0.18, "c"], [1.85, 0.27], [1.95, 0.34], [2.02, 0.46], [2.1, 0.58], [2.2, 0.64], [2.35, 0.665], [2.6, 0.665],
      [2.85, 0.635], [3.14, 0.585, "l"], [3.86, 0.02, "c"], [3.0, 0.0], [2.5, 0.03], [2.0, 0.09], [1.75, 0.14]]],
    ["hl", [[2.97, 0.6, "l"], [3.5, 0.03]], false],
    ["hl", [[3.07, 0.45], [3.33, 0.47]], false],
    ["hl", [[1.67, 0.18], [1.86, 0.2], [1.93, 0.24], [1.98, 0.33]], false],
  ],
  eng: { kind: "none", nose: { s: 0.3, z: 0.6, d: 2.13, blades: 2 } },
  stab: { le: 1.45, z: 0.88, span: 3.71, root: 0.25, cr: 1.1, ct: 0.75, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    // front door, baggage door (both on the right); the cowling's louvred outlet
    doors: [[[2.0, 0.45, "c"], [2.0, 0.82, "c"], [2.26, 1.34, "c"], [3.0, 1.34, "c"], [3.0, 0.45, "c"]],
      rect(3.55, 4.07, 0.16, 0.78, 0.05), rect(0.68, 1.06, 0.2, 0.4, 0.04)],
    // rudder hinge; the spinner's seam, the upper cowl panel; the outlet's louvres; the fuselage top under the dorsal fin
    lines: [[[7.0, 0.93], [7.42, 2.18], [7.16, 2.2], [7.16, 2.32]],
      [[0.4, 0.79], [0.4, 0.43]], [[0.53, 0.82], [0.53, 0.52], [1.5, 0.52], [1.5, 0.93]],
      [[0.8, 0.34], [0.78, 0.26]], [[0.84, 0.34], [0.82, 0.26]], [[0.88, 0.34], [0.86, 0.26]], [[0.92, 0.34], [0.9, 0.26]],
      [[5.0, 1.18], [6.0, 1.08], [7.0, 0.95]]],
    // the storm window in the front side window, the fixed step behind the wing, the antenna on the roof
    marks: [["pant", [[2.08, 0.97, "c"], [2.37, 0.97, "c"], [2.37, 0.81, "c"], [2.12, 0.81, "c"]]],
      ["glass", [[2.12, 0.94, "c"], [2.34, 0.94, "c"], [2.34, 0.84, "c"], [2.14, 0.84, "c"]]],
      ["strut", [[4.03, 0.0, "c"], [4.08, 0.0, "c"], [4.08, -0.2, "c"], [4.03, -0.2, "c"]]],
      ["strut", [[3.94, -0.21, "c"], [4.055, -0.19], [4.17, -0.22, "c"], [4.055, -0.24]]],
      ["hub", [[3.05, 1.42, "c"], [3.08, 1.455], [3.25, 1.45], [3.27, 1.41, "c"]]]],
    dots: [["inlet", 2.42, 0.6, 0.05, 0.025]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Beechcraft Bonanza 35 (V-tail) ----------
// Reference: Beechcraft V35B Bonanza 3-view (Commons), side view scaled to types.csv's 8.05 m
F.be35 = {
  kind: "piston", L0: 8.05, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.7, "c"], [0.1, 0.77], [0.2, 0.8], [0.36, 0.84, "c"], [0.5, 0.88], [1.0, 0.94], [1.3, 0.97], [1.55, 1.0, "c"],
    [1.8, 1.17], [2.0, 1.28], [2.2, 1.35], [2.4, 1.39], [2.6, 1.41], [3.0, 1.39], [3.5, 1.31], [4.0, 1.24], [4.5, 1.16],
    [5.0, 1.09], [5.5, 1.01], [6.0, 0.94], [6.5, 0.86], [7.0, 0.79], [7.5, 0.72], [7.85, 0.65], [7.97, 0.6], [8.05, 0.52],
    [8.0, 0.46], [7.8, 0.42], [7.5, 0.36], [7.0, 0.29], [6.5, 0.22], [6.0, 0.15], [5.5, 0.08], [5.0, 0.0], [4.5, -0.06],
    [4.0, -0.12], [3.5, -0.14], [3.0, -0.15], [2.5, -0.15], [2.0, -0.15], [1.5, -0.13], [1.0, -0.08], [0.55, 0.0], [0.46, 0.04],
    [0.42, 0.12, "l"], [0.4, 0.48, "c"], [0.36, 0.51, "c"], [0.2, 0.6], [0.1, 0.64],
  ],
  // windscreen side, front, middle and the tapered rear side window
  glass: [
    [[1.6, 0.99], [1.8, 1.15, ""], [2.05, 1.28, ""], [2.38, 1.36], [2.22, 1.19, ""], [2.02, 0.97, ""], [1.92, 0.9]],
    [[1.98, 0.86], [2.42, 1.26, ""], [2.88, 1.24], [2.92, 1.21, ""], [2.92, 0.84]],
    pane(3.0, 3.62, 0.79, 1.255, 0.05),
    [[3.69, 0.77], [3.69, 1.2], [4.0, 1.18, ""], [4.3, 1.1, ""], [4.5, 1.0, ""], [4.63, 0.92, ""], [4.6, 0.8, ""], [4.5, 0.76]],
  ],
  frame: 0.035,
  wing: { le: 1.65, root: 0.6, span: 10.2, cr: 2.1, ct: 1.1, sweep: 6, dih: 6.5, z: 0.1, t: [0.15, 0.12] },
  // the wing as the view draws it: the pointed root fillet rising to the root section, the flap's
  // trailing edge at the root; the root section's lower line, the flap hinge and its cross line
  wingSide: [
    ["wing", [[1.58, 0.15, "c"], [1.75, 0.27], [1.92, 0.38], [2.06, 0.55], [2.13, 0.62], [2.25, 0.67], [2.5, 0.69], [2.8, 0.67],
      [3.0, 0.64], [3.15, 0.61, "l"], [3.9, -0.05, "c"], [3.5, -0.06], [3.0, -0.07], [2.5, -0.05], [2.0, 0.0], [1.7, 0.08]]],
    ["hl", [[2.13, 0.6], [2.5, 0.5], [3.0, 0.51], [3.25, 0.53]], false],
    ["hl", [[3.0, 0.51, "l"], [3.25, 0.22, "l"], [3.55, -0.06]], false],
    ["hl", [[3.25, 0.22], [3.5, 0.26]], false],
  ],
  eng: { kind: "none", nose: { s: 0.28, z: 0.7, d: 2.13, blades: 2 } },
  // the V-tail: its outline down to the root along the tail cone's side, the ruddervator hinge, the trim tab
  stab: { le: 1.42, z: 0.7, span: 3.0, root: 0.2, cr: 1.3, ct: 0.75, sweep: 15, dih: 35, thick: 0.1 },
  stabSide: [
    ["stab", [[6.6, 0.65, "c"], [6.63, 0.85, "l"], [6.86, 1.71], [7.07, 1.86], [7.3, 1.88], [7.8, 1.8, "cl"], [7.98, 0.64, "c"],
      [7.75, 0.6], [7.4, 0.58], [7.0, 0.585]]],
    ["hl", [[7.4, 0.58, "l"], [7.4, 1.68, "l"], [7.07, 1.85]], false],
    ["hl", [[7.75, 0.6, "l"], [7.75, 1.17, "l"], [7.88, 1.17]], false],
  ],
  parts: {
    // front door, baggage door (both on the right); the cowling's outlet
    doors: [[[1.93, 0.42, "c"], [1.93, 0.84, "c"], [2.42, 1.33, "c"], [2.97, 1.33, "c"], [2.97, 0.42, "c"]],
      rect(3.72, 4.2, 0.1, 0.72, 0.05), [[0.59, 0.45, "c"], [1.04, 0.42, "c"], [1.04, 0.16, "c"], [0.59, 0.23, "c"]]],
    // the spinner's seam and the cowl's front face; the upper cowl panel; the fuselage top under the V-tail
    lines: [[[0.36, 0.84], [0.36, 0.51]], [[0.5, 0.88], [0.5, 0.53], [1.47, 0.5], [1.47, 0.99]],
      [[6.63, 0.85], [7.3, 0.76], [7.85, 0.65]]],
    // the storm window, the fixed step, the antennas on the roof and the spine
    marks: [["pant", [[2.07, 1.03, "c"], [2.38, 1.03, "c"], [2.38, 0.82, "c"], [1.97, 0.85, "c"]]],
      ["glass", [[2.1, 1.0, "c"], [2.35, 1.0, "c"], [2.35, 0.85, "c"], [2.02, 0.87, "c"]]],
      ["strut", [[4.1, -0.12, "c"], [4.15, -0.12, "c"], [4.15, -0.3, "c"], [4.1, -0.3, "c"]]],
      ["strut", [[4.01, -0.31, "c"], [4.125, -0.29], [4.24, -0.32, "c"], [4.125, -0.34]]],
      ["strut", [[3.1, 1.385, "c"], [3.1, 1.43], [3.19, 1.42, "c"], [3.21, 1.37, "c"]]],
      ["strut", [[6.19, 0.92, "c"], [6.19, 1.0], [6.3, 0.97], [6.42, 0.88, "c"]]]],
    dots: [["inlet", 2.45, 0.63, 0.05, 0.025]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Beechcraft T-34A / T-34B Mentor ----------
// Reference: Beechcraft T-34 Mentor general arrangement (Commons), a dimensioned Beech drawing of the T-34A
F.t34p = {
  kind: "piston", L0: 7.91, over: 0, D: 1, W: 0.95,
  body: [
    [0, 0.71, "c"], [0.1, 0.79], [0.2, 0.84], [0.33, 0.89, "c"], [0.36, 0.92], [0.5, 0.97], [0.8, 1.02], [1.0, 1.05], [1.4, 1.09],
    [1.72, 1.12, "cl"], [2.08, 1.5], [2.25, 1.58], [2.5, 1.6], [3.0, 1.6], [3.5, 1.59], [3.9, 1.57], [4.2, 1.5], [4.45, 1.37],
    [4.6, 1.31, "c"], [5.0, 1.27], [5.5, 1.235, "l"], [6.5, 1.28, "cl"], [6.65, 2.38], [6.72, 2.48], [6.9, 2.52], [7.2, 2.5],
    [7.5, 2.46], [7.6, 2.4, "l"], [7.82, 1.0], [7.9, 0.88], [7.86, 0.76], [7.7, 0.68], [7.5, 0.64], [7.0, 0.57], [6.5, 0.48],
    [6.0, 0.4], [5.5, 0.32], [5.0, 0.25], [4.5, 0.17], [4.0, 0.13], [3.5, 0.1], [3.0, 0.08], [2.5, 0.06], [2.0, 0.05], [1.5, 0.05],
    [1.0, 0.07], [0.8, 0.1], [0.6, 0.14], [0.5, 0.2], [0.42, 0.3], [0.37, 0.45], [0.33, 0.53, "c"], [0.2, 0.6], [0.1, 0.65],
  ],
  // windscreen, the two sliding canopy sections and the fixed one behind
  glass: [
    [[1.8, 1.14], [2.07, 1.47], [2.12, 1.47], [2.14, 1.12]],
    [[2.18, 1.12], [2.2, 1.55], [2.5, 1.585, ""], [2.92, 1.585], [2.92, 1.12]],
    [[2.97, 1.12], [2.97, 1.585], [3.53, 1.575], [3.53, 1.12]],
    [[3.58, 1.12], [3.58, 1.565], [3.9, 1.545, ""], [4.2, 1.46, ""], [4.5, 1.3], [4.4, 1.2, ""], [4.2, 1.14, ""]],
  ],
  frame: 0.04,
  wing: { le: 1.75, root: 0.5, span: 10.0, cr: 2.13, ct: 1.07, sweep: 6, dih: 6, z: 0.15, t: [0.15, 0.12] },
  // the wing as the drawing has it: the root fillet's pointed nose rising to the root section, the
  // flap's trailing edge at the root; the root section's lower line, the flap hinge and cross line
  wingSide: [
    ["wing", [[1.75, 0.31, "c"], [1.9, 0.38], [2.05, 0.5], [2.15, 0.65], [2.3, 0.72], [2.5, 0.76], [2.8, 0.75], [3.0, 0.72],
      [3.2, 0.68, "l"], [3.9, 0.13, "c"], [3.5, 0.1], [3.0, 0.1], [2.5, 0.12], [2.1, 0.18], [1.85, 0.26]]],
    ["hl", [[2.15, 0.65], [2.5, 0.62], [3.0, 0.63], [3.3, 0.66]], false],
    ["hl", [[3.08, 0.68, "l"], [3.62, 0.13]], false],
    ["hl", [[3.3, 0.45], [3.55, 0.46]], false],
    ["hl", [[1.88, 0.28], [2.37, 0.6]], false],
  ],
  eng: { kind: "none", nose: { s: 0.27, z: 0.71, d: 2.24, blades: 2 } },
  stab: { le: 1.21, z: 0.97, span: 3.71, root: 0.2, cr: 1.1, ct: 0.76, sweep: 4, dih: 0, thick: 0.1 },
  parts: {
    // the cowl's outlet, the access door aft
    doors: [rect(0.57, 1.04, 0.25, 0.52, 0.08), [[4.12, 0.82, "c"], [4.52, 0.82, "c"], [4.52, 0.37, "c"], [4.05, 0.37, "c"]]],
    // rudder hinge and trim tab; spinner seam, upper cowl panel; canopy rail; the fuselage top under the dorsal
    lines: [[[7.2, 1.06], [7.2, 2.35], [7.0, 2.52]], [[7.6, 1.12], [7.6, 1.77], [7.72, 1.77]],
      [[0.33, 0.89], [0.33, 0.53]], [[0.5, 0.96], [0.5, 0.58], [1.46, 0.58], [1.46, 1.09]],
      [[1.75, 1.1], [4.0, 1.1], [4.3, 1.17], [4.6, 1.31]], [[5.5, 1.235], [6.5, 1.14], [7.82, 1.0]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Beechcraft T-34C Turbo-Mentor ----------
// The T-34A above with the PT6A nose: no dimensioned drawing of the C was reachable, so its airframe is the A's
F.t34t = stretch(F.t34p, 1.6, 0.68, {
  kind: "turboprop", L0: 8.75,
  body: [
    [0, 0.72, "c"], [0.12, 0.8], [0.25, 0.85], [0.42, 0.88, "c"], [0.5, 0.91], [0.8, 0.98], [1.2, 1.04], [1.8, 1.09],
    [2.4, 1.12, "cl"], [2.76, 1.5], [2.93, 1.58], [3.18, 1.6], [3.68, 1.6], [4.18, 1.59], [4.58, 1.57], [4.88, 1.5], [5.13, 1.37],
    [5.28, 1.31, "c"], [5.68, 1.27], [6.18, 1.235, "l"], [7.18, 1.28, "cl"], [7.33, 2.38], [7.4, 2.48], [7.58, 2.52], [7.88, 2.5],
    [8.18, 2.46], [8.28, 2.4, "l"], [8.5, 1.0], [8.64, 0.87], [8.75, 0.74, "c"], [8.6, 0.67], [8.38, 0.64], [8.18, 0.62],
    [7.68, 0.57], [7.18, 0.48], [6.68, 0.4], [6.18, 0.32], [5.68, 0.25], [5.18, 0.17], [4.68, 0.13], [4.18, 0.1], [3.68, 0.08],
    [3.18, 0.06], [2.68, 0.05], [2.0, 0.06], [1.5, 0.08], [1.0, 0.14], [0.75, 0.22], [0.6, 0.33], [0.52, 0.45], [0.47, 0.52],
    [0.42, 0.56, "c"], [0.25, 0.62], [0.12, 0.67],
  ],
  eng: { kind: "none", nose: { s: 0.3, z: 0.72, d: 2.24, blades: 3 } },
});
{
  const p = F.t34t.parts;
  F.t34t.parts = {
    ...p,
    // the access door aft (the A's cowl outlet is gone)
    doors: p.doors.slice(1),
    // rudder hinge and tab, canopy rail and dorsal line (moved back with the airframe); spinner seam, cowl joints
    lines: [...p.lines.filter((l) => l[0][0] > 2), [[0.42, 0.88], [0.42, 0.56]], [[1.55, 1.07], [1.55, 0.09]], [[2.35, 1.12], [2.35, 0.06]]],
    // the exhaust stack behind the propeller, the chin inlet under the spinner, the ventral strakes
    shapes: [["core", [[0.85, 0.8, "c"], [1.22, 0.76], [1.32, 0.63, "c"], [0.85, 0.64, "c"]]],
      ["inlet", [[0.46, 0.53, "c"], [0.62, 0.52, "c"], [0.6, 0.41, "c"], [0.52, 0.43, "c"]]],
      ["fin", [[6.9, 0.43, "c"], [8.38, 0.63, "c"], [8.36, 0.47, "c"], [7.1, 0.27, "c"]]]],
  };
}

// ---------- Rockwell Commander 112 / 114 ----------
// Reference: Aero Commander 112 "Three view dimensions" (Commons), a manufacturer's drawing
F.ac11 = {
  kind: "piston", L0: 7.59, over: 0, D: 1, W: 1.25,
  body: [
    [0, 0.69, "c"], [0.15, 0.75], [0.3, 0.8], [0.51, 0.87, "c"], [0.6, 0.9], [1.0, 0.95], [1.3, 0.965], [1.62, 0.97, "c"],
    [1.8, 1.06], [2.0, 1.15], [2.2, 1.22], [2.5, 1.27], [3.0, 1.29], [3.5, 1.25], [4.0, 1.15], [4.5, 1.08], [5.0, 1.02],
    [5.5, 0.98], [5.65, 0.975], [5.85, 1.03], [6.0, 1.12], [6.12, 1.21, "l"], [6.95, 1.83], [7.05, 1.95], [7.15, 1.98],
    [7.35, 1.96, "l"], [7.61, 1.94, "cl"], [7.47, 0.5, "c"], [7.5, 0.42], [7.47, 0.25], [7.4, 0.2], [7.2, 0.18], [6.5, 0.13],
    [6.0, 0.09], [5.5, 0.06], [5.0, 0.04], [4.5, 0.02], [4.0, 0.0], [3.5, 0.0], [3.0, 0.01], [2.5, 0.04], [2.0, 0.07],
    [1.6, 0.1], [1.3, 0.12], [1.0, 0.15], [0.92, 0.19], [0.8, 0.29], [0.6, 0.44], [0.51, 0.5, "c"], [0.3, 0.57], [0.15, 0.62],
  ],
  // windscreen side, door window, the tapered rear window
  glass: [
    [[1.7, 0.99], [1.95, 1.12, ""], [2.37, 1.22], [2.14, 0.84], [2.05, 0.93]],
    [[2.3, 0.79], [2.5, 1.15], [3.02, 1.16], [3.04, 0.68], [2.6, 0.7, ""]],
    [[3.2, 0.65], [3.2, 1.1], [3.6, 1.08, ""], [4.0, 0.98, ""], [4.2, 0.9], [3.9, 0.72, ""], [3.5, 0.65, ""]],
  ],
  frame: 0.04,
  wing: { le: 2.05, root: 0.6, span: 9.98, cr: 1.9, ct: 1.2, sweep: 3, dih: 7, z: 0.12, t: [0.15, 0.12] },
  // the wing as the drawing has it: the root fillet rising to the root section, the flap at the root
  wingSide: [
    ["wing", [[2.03, 0.2, "c"], [2.2, 0.3], [2.3, 0.45], [2.36, 0.6], [2.45, 0.67], [2.7, 0.69], [3.0, 0.66], [3.2, 0.62, "l"],
      [3.95, 0.02, "c"], [3.5, 0.0], [3.0, 0.03], [2.5, 0.1], [2.2, 0.16]]],
    ["hl", [[2.45, 0.62], [2.8, 0.58], [3.15, 0.59]], false],
    ["hl", [[3.1, 0.6, "l"], [3.42, 0.3, "l"], [3.7, 0.02]], false],
    ["hl", [[3.42, 0.3], [3.68, 0.3]], false],
  ],
  eng: { kind: "none", nose: { s: 0.45, z: 0.69, d: 1.93, blades: 2 } },
  stab: { le: 1.37, z: 1.07, span: 3.81, root: 0.15, cr: 1.1, ct: 0.75, sweep: 10, dih: 0, thick: 0.1 },
  parts: {
    // the door around its window (one each side), the baggage door
    doors: [[[2.06, 0.82, "c"], [2.45, 1.21, "c"], [3.12, 1.23, "c"], [3.12, 0.4, "c"], [2.05, 0.34, "c"]],
      rect(3.9, 4.48, 0.1, 0.62, 0.06)],
    // spinner seam, the cowl's split line and aft seam; rudder hinge, the fin cap's joint; the fuselage top under the dorsal
    lines: [[[0.51, 0.87], [0.51, 0.5]], [[0.6, 0.66], [1.6, 0.57]], [[1.6, 0.97], [1.6, 0.1]],
      [[6.57, 0.16], [7.31, 1.85]], [[7.0, 1.86], [7.6, 1.83]], [[4.0, 1.04], [5.5, 0.82], [7.47, 0.5]]],
    // the cooling inlet behind the spinner, the beacon on the fin cap
    shapes: [["inlet", [[0.6, 0.79, "c"], [0.72, 0.77, "c"], [0.72, 0.62, "c"], [0.6, 0.6, "c"]]],
      ["hub", [[7.05, 1.95, "c"], [7.12, 2.03], [7.2, 1.97, "c"]]]],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Aero Commander 500 series (560, 680, 500) ----------
// Reference: U.S. Air Force L-26B (Aero Commander 560A) three-view (Commons), dimensioned in inches
const AC6L_NACELLE = [[2.88, 1.47, "c"], [3.2, 1.49], [3.6, 1.45], [4.5, 1.38], [5.5, 1.31], [5.85, 1.26], [5.97, 1.12],
  [5.85, 0.97], [5.5, 0.87], [5.0, 0.79], [4.5, 0.75], [4.0, 0.77], [3.5, 0.82], [2.95, 0.97], [2.88, 1.03, "c"]];
F.ac6l = {
  kind: "piston", L0: 10.68, over: 0, D: 1, W: 1.42,
  body: [
    [0.01, 0.52, "c"], [0.1, 0.67], [0.3, 0.8], [0.5, 0.87], [1.0, 0.96], [1.28, 0.99, "cl"], [1.6, 1.3], [1.85, 1.43],
    [2.0, 1.5], [2.2, 1.53], [2.6, 1.53], [3.0, 1.54], [3.5, 1.52, "l"], [7.9, 1.52], [8.3, 1.63], [8.6, 1.98, "l"],
    [9.55, 3.9], [9.68, 4.01], [9.9, 4.03, "l"], [10.5, 4.03, "cl"], [10.37, 1.92, "c"], [10.47, 1.77], [10.62, 1.58],
    [10.68, 1.45], [10.6, 1.27], [10.45, 1.12], [10.3, 1.08], [10.0, 1.03], [9.0, 0.83], [8.0, 0.62], [7.0, 0.42], [6.0, 0.22],
    [5.5, 0.1], [5.0, -0.02], [4.5, -0.06], [4.0, -0.09], [3.0, -0.08], [2.0, -0.06], [1.5, -0.03], [1.0, 0.0], [0.5, 0.06],
    [0.2, 0.15], [0.05, 0.25], [0.02, 0.4],
  ],
  // the windscreen's side pane, the cockpit side window, the cabin window behind the wing
  glass: [
    [[1.33, 0.99], [1.78, 1.39], [1.9, 1.41], [1.95, 1.31], [1.83, 0.87]],
    [[1.93, 0.88], [2.07, 1.31], [2.42, 1.32], [2.46, 0.86]],
    rect(6.4, 6.86, 0.86, 1.18, 0.07).map((p) => (p[2] ? p : [p[0], p[1], ""])),
  ],
  frame: 0.04,
  wing: { le: 3.52, root: 0.7, span: 13.43, cr: 2.4, ct: 1.0, sweep: 0, dih: 4, z: 1.55, t: [0.15, 0.12] },
  // the wing as the view draws it, its thick section over the nacelle
  wingSide: [["wing", [[3.52, 1.62, "c"], [3.55, 1.83], [3.65, 1.87], [4.0, 1.86], [4.6, 1.72], [5.0, 1.6], [5.6, 1.39, "c"],
    [5.0, 1.35], [4.5, 1.31], [4.0, 1.36], [3.6, 1.42]]]],
  eng: { kind: "none" },
  stab: { le: 1.23, z: 1.5, span: 5.1, root: 0.3, cr: 1.2, ct: 0.7, sweep: 10, dih: 0, thick: 0.1 },
  // the tailplane in its fairing on the tail cone
  stabSide: [["stab", [[9.5, 1.52, "c"], [9.6, 1.47], [10.0, 1.44], [10.6, 1.52, "c"], [10.0, 1.57], [9.7, 1.56]]]],
  parts: {
    // rudder hinge and cap, the trim tab; the tailplane fairing's hump; the nose's lower seam
    lines: [[[9.55, 1.95], [9.9, 3.75], [10.5, 3.75]], [[10.25, 1.95], [10.27, 2.6], [10.35, 2.6], [10.35, 1.95]],
      [[9.5, 1.52], [9.75, 1.84], [10.0, 1.98], [10.2, 1.95], [10.37, 1.85]], [[0.05, 0.33], [0.3, 0.22], [0.6, 0.14]]],
    // the fin-tip beacon, the landing light in the nose, the inlet on the nacelle's top
    dots: [["hub", 9.9, 4.03, 0.1, 0.12], ["inlet", 0.25, 0.33, 0.1, 0.04], ["inlet", 3.8, 1.84, 0.12, 0.03]],
    // the propeller in front of the nacelle
    draw: [(k) => k.prop(k.sk, 2.78, 1.25, 2.1, 3)],
  },
  // the nacelle and its spinner, behind the wing
  extras: [...EXTRAS, (k) => {
    k.shaded(AC6L_NACELLE, "nac");
    k.sk.smooth("nac", [[2.53, 1.29, "c"], [2.7, 1.42], [2.88, 1.47, "c"], [2.88, 1.03, "c"], [2.7, 1.1]]);
    k.sk.poly("hl", [[3.15, 1.48], [3.15, 0.92]], false);
  }],
  overlays: OVERLAYS,
};

// ---------- Air Tractor AT-802 ----------
// No three-view reachable: measured from the near side-on photo of a two-seat AT-802 landing (Commons)
F.at8t = {
  kind: "turboprop", L0: 10.95, over: 0, D: 1, W: 1.2,
  body: [
    [0, 0.6, "c"], [0.2, 0.75], [0.4, 0.86], [0.65, 0.95, "c"], [1.0, 1.07], [1.5, 1.18], [2.0, 1.3], [2.5, 1.42], [3.0, 1.55],
    [3.5, 1.66], [4.0, 1.77], [4.6, 1.9, "cl"], [5.2, 2.5], [5.5, 2.55], [6.0, 2.56], [6.5, 2.47], [7.0, 2.3], [7.3, 2.05],
    [7.5, 1.83], [7.8, 1.62], [8.3, 1.55], [9.1, 1.47, "cl"], [9.55, 3.38], [9.65, 3.43], [10.0, 3.43], [10.4, 3.36, "cl"],
    [10.58, 1.5, "c"], [10.95, 1.32], [10.98, 1.1], [10.85, 0.97], [10.5, 0.92], [10.0, 0.85], [9.0, 0.7], [8.0, 0.55],
    [7.0, 0.38], [6.0, 0.2], [5.0, 0.05], [4.0, -0.03], [3.0, -0.05], [2.0, 0.0], [1.5, 0.05], [1.0, 0.12], [0.7, 0.25],
    [0.65, 0.3, "c"], [0.4, 0.38], [0.2, 0.47],
  ],
  // windscreen, the front and rear cockpit side windows
  glass: [
    [[4.8, 1.99], [5.2, 2.43], [5.45, 2.43], [5.45, 1.95]],
    [[5.55, 1.62], [5.55, 2.35], [6.15, 2.38], [6.15, 1.6]],
    [[6.31, 1.6], [6.31, 2.2], [6.95, 2.18], [7.08, 1.95], [7.08, 1.6]],
  ],
  frame: 0.05,
  wing: { le: 4.0, root: 0.6, span: 18.06, cr: 2.1, kink: [0.75, 2.1], ct: 1.4, sweep: 0, dih: 3.5, z: 0.15, t: [0.15, 0.12] },
  // the wing as it shows from the side: its root section along the belly, the flap's line
  wingSide: [["wing", [[3.98, 0.1, "c"], [4.15, 0.27], [4.5, 0.36], [5.0, 0.35], [6.1, 0.2, "c"], [5.0, 0.02], [4.3, -0.02]]],
    ["hl", [[5.5, 0.28], [5.5, 0.08]], false]],
  eng: { kind: "none", nose: { s: 0.55, z: 0.6, d: 2.8, blades: 5 } },
  stab: { le: 1.65, z: 1.4, span: 6.0, root: 0.2, cr: 1.3, ct: 1.0, sweep: 0, dih: 0, thick: 0.1 },
  parts: {
    // the rudder hinge; the spinner's seam and the cowl joint; the hopper lid; the cockpit's frames
    lines: [[[9.45, 3.4], [10.15, 1.5]], [[0.65, 0.95], [0.65, 0.3]], [[1.31, 1.14], [1.31, 0.08]],
      [[3.25, 1.6], [3.25, 1.5], [4.4, 1.72], [4.45, 1.85]], [[5.5, 1.55], [7.6, 1.55]]],
    // the exhaust stack on the cowl
    shapes: [["core", [[1.25, 0.76, "c"], [1.75, 0.74], [1.8, 0.62, "c"], [1.25, 0.6, "c"]]]],
    // the landing light in the cowl
    dots: [["inlet", 0.85, 0.27, 0.06]],
    gear: [
      { leg: [[3.65, -0.02], [3.3, -0.95]], w: [0.14, 0.1], at: [3.3, -0.95], r: 0.4 },
      { leg: [[10.05, 0.85], [10.3, -0.12]], w: [0.07, 0.05], at: [10.3, -0.12], r: 0.17 },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

// ---------- Air Tractor AT-502 ----------
// No three-view reachable: measured from the side-on photo of the AT-502B N50470 on the ground (Commons)
F.at3t = {
  kind: "turboprop", L0: 10.21, over: 0, D: 1, W: 1.1,
  body: [
    [0, 0.52, "c"], [0.2, 0.62], [0.42, 0.66, "c"], [0.47, 0.8], [0.6, 0.84], [1.0, 0.93], [1.5, 1.06], [2.0, 1.17], [2.5, 1.27],
    [3.0, 1.42], [3.5, 1.52], [4.0, 1.6], [4.6, 1.7, "cl"], [5.05, 2.33], [5.3, 2.36], [5.8, 2.31], [6.2, 2.22], [6.5, 1.95],
    [6.8, 1.6], [7.1, 1.53], [8.65, 1.48, "cl"], [9.15, 2.77], [9.25, 2.83], [9.6, 2.8], [9.95, 2.72, "cl"], [10.1, 1.4, "c"],
    [10.21, 1.27], [10.2, 1.08], [10.05, 0.99], [9.0, 0.73], [8.0, 0.53], [7.0, 0.34], [6.0, 0.15], [5.0, 0.03], [4.0, -0.03],
    [3.0, -0.03], [2.0, -0.01], [1.0, 0.0], [0.6, 0.03], [0.47, 0.1, "c"], [0.42, 0.38, "c"], [0.2, 0.42],
  ],
  // the windscreen and the cockpit side window
  glass: [
    [[4.64, 1.73], [5.0, 2.26], [5.02, 1.72]],
    [[5.12, 1.48], [5.12, 2.08], [5.8, 2.1], [5.8, 1.48]],
  ],
  frame: 0.05,
  wing: { le: 3.6, root: 0.55, span: 15.85, cr: 1.69, kink: [0.75, 1.69], ct: 1.2, sweep: 0, dih: 3.5, z: 0.15, t: [0.15, 0.12] },
  // the wing as it shows from the side: its root section along the belly, the flap's line
  wingSide: [["wing", [[3.58, 0.1, "c"], [3.72, 0.25], [4.0, 0.32], [4.5, 0.3], [5.3, 0.18, "c"], [4.5, 0.0], [3.9, -0.03]]],
    ["hl", [[4.85, 0.25], [4.85, 0.06]], false]],
  eng: { kind: "none", nose: { s: 0.45, z: 0.52, d: 2.82, blades: 3 } },
  stab: { le: 1.14, z: 1.33, span: 5.0, root: 0.2, cr: 1.1, ct: 0.9, sweep: 0, dih: 0, thick: 0.1 },
  parts: {
    // the rudder hinge round its horn balance; the cowl's front ring and joint; the hopper lid; the canopy rail
    lines: [[[9.41, 2.86], [9.41, 2.13], [9.62, 1.45]], [[0.47, 0.8], [0.47, 0.1]], [[1.25, 0.98], [1.25, 0.0]],
      [[2.8, 1.38], [2.8, 1.25], [4.4, 1.52], [4.55, 1.68]], [[5.05, 1.45], [6.5, 1.45]]],
    // the exhaust stack behind the propeller
    shapes: [["core", [[0.62, 0.72, "c"], [0.9, 0.7], [0.92, 0.5, "c"], [0.62, 0.5, "c"]]]],
    gear: [
      { leg: [[3.5, -0.02], [3.2, -0.9]], w: [0.12, 0.09], at: [3.2, -0.9], r: 0.36 },
      { leg: [[9.55, 0.7], [9.98, 0.12]], w: [0.06, 0.05], at: [9.98, 0.12], r: 0.16 },
    ],
  },
  extras: EXTRAS, overlays: OVERLAYS,
};

export const families = F;
export const types = {
  BE33: "be33", BE35: "be35", T34P: "t34p", T34T: "t34t", AC11: "ac11", AC6L: "ac6l", AT8T: "at8t", AT3T: "at3t",
};
