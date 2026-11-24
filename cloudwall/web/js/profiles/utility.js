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
        shapes: g.shapes && g.shapes.map(([c, pts, cl]) => [c, loop(pts), cl]), lines: g.lines && g.lines.map(loop),
        under: g.under && g.under.map(([c, pts, cl]) => [c, loop(pts), cl]) })),
    },
    ...more,
  };
}

// ---------- Beechcraft Bonanza 33 (Debonair) ----------
// Reference: Beechcraft E33 Bonanza 3-view (Wikimedia Commons,
// File:Beechcraft_E33_Bonanza_3-view_line_drawing.png, Wikipedia article Beechcraft Bonanza), side
// view scaled by its own 25 ft 6 in (7.77 m) overall length dimension (about 1.1 cm a pixel), drawn
// at the attitude the 3-view gives it, as light.js draws the A36 from the same series. The Bonanza
// with the straight swept fin and the short cabin: three side windows, the front door and the
// baggage door on the right (drawn, as this view shows the right side), low wing with its pointed
// root fillet, retractable gear (drawn retracted), two-blade propeller of 7 ft.
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

export const families = F;
export const types = {
  BE33: "be33",
};
