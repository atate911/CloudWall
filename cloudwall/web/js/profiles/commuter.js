// Commuter turboprops: the 19- to 36-seat twins of the regional and island airlines. Format: see
// ../profiles.js.
//
// These are drawn with `body` outlines (D = 1, so every point is in metres), as the light aircraft
// are: their boxy fuselages, sponsons and fins are easier to trace whole than to build from a nose
// and a tail. The fin is part of the outline. A body outline does not stretch, so every family's
// L0 + over equals the types.csv length of the types mapped to it. Small parts are listed as data
// in `parts` and drawn by the two functions below.
const F = {};

// ---------- drawing helpers (kit: see silhouette.js above draw()) ----------
//   doors    closed [s, z, flag] loops drawn with the door stroke
//   lines    [s, z] polylines drawn as thin lines (rudder hinge, panel joints)
//   wins     window rows [z, w, h, [s...]]: cabin windows as rounded panes centred at height z
//   struts   [[s, z] bottom, [s, z] top, width at bottom, width at top]
//   gear     {leg: [[s, z] top, [s, z] bottom], w: [w0, w1], at: [s, z] axle, r, spat: {f, a, t, b}}
//   nacelles {s (spinner tip), z (axis), outline [[u aft of the tip, dz above the axis, flag]...],
//            sp (spinner length), sr (spinner radius at its base), prop (diameter), blades, inlet [u, dz, rx, ry]}
//   shapes   [class, [[s, z, flag]...], closed?] smooth parts drawn last (fairings, fins, sponsons)
//   dots     [class, s, z, rx, ry] small round parts drawn last (ports, lights)
//   under    [class, [[s, z, flag]...], closed?] parts drawn just after the fuselage (behind the wing)

// A tapered leg or strut from [s0, z0] to [s1, z1], w0 / w1 wide (metres, along s).
const leg = (sk, [s0, z0], [s1, z1], w0 = 0.08, w1 = w0) =>
  sk.poly("strut", [[s0 - w0 / 2, z0], [s0 + w0 / 2, z0], [s1 + w1 / 2, z1], [s1 - w1 / 2, z1]]);

// A wheel with a teardrop spat or a plain hub.
function wheel(sk, s, z, r, spat) {
  sk.ellipse("tire", s, z, r, r);
  if (!spat) { sk.ellipse("hub", s, z, r * 0.42, r * 0.42); return; }
  const { f, a, t, b } = spat;
  sk.smooth("pant", [[s - f, z + 0.02], [s - f * 0.72, z + t * 0.8], [s - f * 0.15, z + t], [s + a * 0.45, z + t * 0.82],
    [s + a, z + t * 0.12, "c"], [s + a * 0.5, z - b * 0.82], [s - f * 0.25, z - b], [s - f * 0.8, z - b * 0.62]]);
}

// A rounded rectangle as a door or window outline: s0..s1, z0..z1, corner radius rr.
const rect = (s0, s1, z0, z1, rr = 0.06) => [[s0 + rr, z0, "l"], [s1 - rr, z0], [s1, z0 + rr, "l"], [s1, z1 - rr], [s1 - rr, z1, "l"],
  [s0 + rr, z1], [s0, z1 - rr, "l"], [s0, z0 + rr]];

const EXTRAS = [(k) => {
  const p = k.f.parts || {};
  for (const [cls, pts, closed = true] of p.under || []) k.sk.smooth(cls, pts, closed);
  for (const d of p.doors || []) k.sk.smooth("door", d);
  for (const l of p.lines || []) k.sk.poly("hl", l, false);
  for (const [z, w, h, at] of p.wins || []) for (const s of at) k.sk.smooth("glass", rect(s - w / 2, s + w / 2, z - h / 2, z + h / 2, Math.min(w, h) * 0.3));
}];
const OVERLAYS = [(k) => {
  const p = k.f.parts || {};
  for (const [a, b, w0, w1] of p.struts || []) leg(k.sk, a, b, w0, w1);
  for (const g of p.gear || []) {
    if (g.leg) leg(k.sk, g.leg[0], g.leg[1], ...(g.w || []));
    if (g.at) wheel(k.sk, g.at[0], g.at[1], g.r, g.spat);
  }
  for (const n of p.nacelles || []) {
    k.sk.smooth("nac", n.outline.map(([u, dz, fl]) => [n.s + u, n.z + dz, fl]));
    k.sk.poly("hl", [[n.s + n.sp, n.z + n.sr], [n.s + n.sp, n.z - n.sr]], false);
    if (n.inlet) k.sk.ellipse("inlet", n.s + n.inlet[0], n.z + n.inlet[1], n.inlet[2], n.inlet[3]);
    k.prop(k.sk, n.s + n.sp * 0.7, n.z, n.prop, n.blades);
  }
  for (const [cls, pts, closed = true] of p.shapes || []) k.sk.smooth(cls, pts, closed);
  for (const [cls, s, z, rx, ry = rx] of p.dots || []) k.sk.ellipse(cls, s, z, rx, ry);
}];
const commuter = (o) => ({ kind: "turboprop", over: 0, D: 1, frame: 0.03, extras: EXTRAS, overlays: OVERLAYS, ...o });

// ---------- Dornier 228 ----------
// References: Wikimedia Commons "Dornier Do 228 three-view silhouette.png" (side views of the 228-100
// and 228-200 at one scale; the -200's measured and scaled to its 16.56 m, Wikipedia) for the
// fuselage, fin, sponsons and windows, and "Dornier 228.png" (three-view line drawing) for the wing,
// nacelles and tailplane: span 16.97 m, nacelles 4.4 m out, wing root chord about 2.2 m. Checked
// against near side-on photos ("Norving Dornier 228 D-ICOG.jpg", "Do228NG - RIAT 2012"). Long drooping
// nose, square cabin with the wing on its roof, short TPE331 nacelles slung ahead of and over the
// wing, main gear retracting into fairings on the lower fuselage, swept fin with a fillet; four-blade
// propellers (five on the 228NG).
F.d228 = commuter({
  L0: 16.56, W: 1.4,
  body: [
    [0.0, 0.38, "c"], [0.033, 0.46], [0.23, 0.645], [0.6, 0.83], [1.33, 1.075], [1.81, 1.195], [2.2, 1.29], [2.4, 1.38], [2.73, 1.74],
    [2.95, 1.97], [3.15, 2.04, "l"], [5.05, 2.05], [5.25, 2.2], [5.6, 2.28], [6.6, 2.34], [7.55, 2.3], [8.3, 2.21], [9.17, 2.05, "l"],
    [11.04, 2.05, "l"], [13.78, 2.52], [14.06, 2.65, "l"], [14.96, 3.99], [15.2, 4.2], [15.45, 4.27, "l"], [16.1, 4.28, "c"],
    [16.2, 4.24, "c"], [16.34, 2.54, "l"], [16.43, 2.32], [16.47, 1.6], [16.43, 1.24], [16.08, 1.08], [15.88, 0.89], [15.58, 0.75],
    [15.2, 0.63, "l"], [11.0, -0.02], [9.4, -0.04], [8.6, -0.25], [7.9, -0.38], [7.27, -0.39], [6.2, -0.25], [5.4, -0.04, "l"],
    [0.36, -0.03], [0.14, -0.01], [0.04, 0.05],
  ],
  glass: [
    [[2.27, 1.33], [2.72, 1.77, ""], [2.95, 1.92], [3.08, 1.86], [2.86, 1.33]],
    [[3.0, 1.12], [3.0, 1.66], [3.46, 1.82], [3.6, 1.75], [3.6, 1.12]],
  ],
  wing: { le: 6.2, root: 0.7, span: 16.97, cr: 2.18, kink: [0.3, 2.0], ct: 1.15, sweep: 4, dih: 0, z: 2.15, t: [0.14, 0.12] },
  stab: { le: 1.4, z: 1.3, span: 6.45, root: 0.25, cr: 1.3, ct: 0.85, sweep: 12, dih: 0, thick: 0.1 },
  parts: {
    wins: [[1.26, 0.24, 0.3, [4.13, 4.62, 5.39, 5.89, 6.48, 7.09, 7.86, 8.85, 9.73, 10.43]]],
    doors: [rect(9.43, 10.74, 0.24, 1.66, 0.1)],
    lines: [[[10.08, 0.24], [10.08, 1.66]], [[0.36, -0.03], [0.32, 0.6]], [[15.62, 1.42], [15.56, 4.28]]],
    nacelles: [{
      s: 4.74, z: 1.63, sp: 0.45, sr: 0.3, prop: 2.5, blades: 4, inlet: [0.75, -0.38, 0.1, 0.07],
      outline: [[0, 0, "c"], [0.2, 0.22], [0.45, 0.3, "c"], [0.6, 0.45], [1.1, 0.53], [2.2, 0.46], [3.4, 0.3], [4.25, 0.05, "c"],
        [3.9, -0.18], [2.7, -0.42], [1.3, -0.52], [0.65, -0.48], [0.47, -0.3], [0.45, -0.3, "c"], [0.2, -0.22]],
    }],
  },
});

// ---------- de Havilland Canada DHC-6 Twin Otter ----------
// References: published dimensions (Wikipedia: length 15.77 m with the long nose of the Series 200
// on, span 19.81 m with a 1.97 m chord from its 39 m2, height 5.94 m), the side view of the Commons
// "De Havilland Canada UV-18A Twin Otter 3-view line drawing.png" for the stations of the wing, gear
// and fin, and the near side-on Commons photo "DHC-6 (DLT) at FRA 1983-02-28.jpg" (Series 300
// D-IDWT) scaled to the length for the outline, windows, nacelles, gear and tail. Long pointed nose,
// square cabin under a strut-braced high wing, PT6A nacelles slung from the wing with three-blade
// propellers, fixed tricycle gear on a sprung main leg, tall swept fin with the tailplane low on it.
F.dhc6 = commuter({
  L0: 15.77, W: 1.6,
  body: [
    [0, 0.47, "c"], [0.12, 0.63], [0.4, 0.79], [0.9, 0.96], [1.5, 1.12], [2.0, 1.27], [2.45, 1.45], [2.75, 1.68], [3.05, 1.92],
    [3.4, 2.0, "l"], [9.0, 1.97], [11.0, 1.92], [12.3, 1.9], [12.7, 1.98], [13.05, 2.2, "l"], [14.45, 5.0], [14.62, 5.07, "l"],
    [15.72, 5.0, "c"], [15.77, 4.9, "l"], [15.62, 2.45, "l"], [15.58, 1.55], [15.42, 1.3], [15.1, 1.15], [13.6, 0.85], [11.5, 0.43],
    [10.0, 0.17], [8.9, 0.02, "l"], [1.7, 0], [1.1, 0.05], [0.5, 0.15], [0.15, 0.3],
  ],
  glass: [
    [[2.5, 1.45], [2.78, 1.72], [3.0, 1.92], [3.08, 1.86], [3.0, 1.45]],
    [[3.1, 1.3], [3.1, 1.82], [3.52, 1.88], [3.52, 1.3]],
  ],
  wing: { le: 5.2, root: 0.8, span: 19.81, cr: 1.98, ct: 1.98, sweep: 0, dih: 1, z: 2.12, t: [0.16, 0.16] },
  stab: { le: 1.75, z: 2.32, span: 6.3, root: 0.3, cr: 1.55, ct: 1.3, sweep: 3, dih: 0, thick: 0.1 },
  parts: {
    wins: [[1.36, 0.26, 0.32, [4.3, 4.88, 5.45, 5.98, 6.53, 7.08, 7.63, 8.5]]],
    doors: [rect(9.0, 9.85, 0.12, 1.68, 0.1), rect(2.95, 3.6, 0.2, 1.88, 0.08)],
    lines: [[[14.98, 2.35], [15.02, 4.95]], [[0.42, 0.14], [0.36, 0.8]]],
    struts: [[[6.3, 0.25], [6.05, 2.02], 0.14, 0.12]],
    gear: [
      { leg: [[6.25, 0.1], [6.55, -0.55]], w: [0.16, 0.12], at: [6.55, -0.56], r: 0.39 },
      { leg: [[1.75, 0.05], [1.72, -0.62]], w: [0.09, 0.07], at: [1.72, -0.66], r: 0.3 },
    ],
    nacelles: [{
      s: 3.15, z: 1.43, sp: 0.42, sr: 0.24, prop: 2.6, blades: 3, inlet: [0.6, -0.35, 0.08, 0.06],
      outline: [[0, 0, "c"], [0.18, 0.18], [0.42, 0.24, "c"], [0.55, 0.42], [0.9, 0.62], [1.6, 0.72], [2.8, 0.75], [3.6, 0.55], [4.2, 0.2, "c"],
        [3.6, 0.0], [2.4, -0.18], [1.3, -0.24], [0.6, -0.28], [0.45, -0.24, "c"], [0.18, -0.18]],
    }],
  },
});

// ---------- Short 360 and 330 ----------
// References: published dimensions (Wikipedia: 360-300 length 21.58 m, span 22.81 m, height 7.21 m;
// 330-200 length 17.69 m, span 22.76 m, height 4.95 m; the 360 adds a 0.91 m plug, which the photos
// put ahead of the wing, one window more there, and a new rear fuselage and tail) and near side-on
// Commons photos scaled to those lengths: for the
// 360 "Short 360-300, RAS - Rheinland Air Service AN0908076.jpg" (broadside; heights scaled by 0.96 to
// its published height), checked against "Short 360-200, Aerocondor JP5963911.jpg" and "Night Express
// Short 360-300(F) D-CRAS"; for the 330 "Short 330 (DLT) at FRA 1983-02-28 (2).jpg", its stations aft
// of the plug taken from the 360 less the plug. Square-section fuselage with the fuel over the cabin,
// high braced wing on stub wings that carry the main gear (retracted here into their sponsons),
// long PT6A nacelles on top of the wing; the 330 has twin rectangular fins at the tailplane tips,
// the 360 a single swept fin on a long tapered rear fuselage.
F.sh36 = commuter({
  L0: 21.58, W: 2.24,
  body: [
    [0, 0.15, "c"], [0.1, 0.32], [0.39, 0.48], [1.05, 0.78], [1.7, 1.09], [2.43, 1.41], [2.8, 1.68], [3.15, 1.98], [3.6, 2.15], [3.95, 2.26],
    [4.6, 2.35], [5.5, 2.4, "l"], [13.0, 2.42], [14.2, 2.4], [15.6, 2.5], [16.8, 2.64], [17.6, 2.83], [18.2, 3.12], [18.8, 3.69, "l"],
    [20.35, 6.16], [20.55, 6.29, "l"], [21.5, 6.32, "c"], [21.58, 6.24, "l"], [20.95, 2.5], [21.1, 2.11], [21.05, 1.87, "c"], [20.0, 1.6],
    [18.0, 1.03], [16.5, 0.65], [15.4, 0.34], [14.3, 0.12], [13.4, 0.0, "l"], [11.4, -0.02], [11.15, 0.0], [10.9, -0.36], [10.0, -0.44],
    [8.9, -0.42], [8.4, -0.29], [8.2, -0.05], [8.0, -0.02, "l"], [0.8, -0.03], [0.4, -0.01], [0.15, 0.04], [0.04, 0.09],
  ],
  glass: [
    [[2.45, 1.42], [2.85, 1.72], [3.12, 1.95], [3.22, 1.86], [3.05, 1.42]],
    [[3.15, 1.3], [3.15, 1.68], [3.75, 1.68], [3.75, 1.3]],
  ],
  wing: { le: 8.2, root: 1.12, span: 22.81, cr: 1.85, ct: 1.85, sweep: 0, dih: 1.5, z: 2.5, t: [0.14, 0.14] },
  stab: { le: 2.38, z: 2.02, span: 7.2, root: 0.3, cr: 1.8, ct: 1.1, sweep: 14, dih: 0, thick: 0.1 },
  parts: {
    wins: [[0.93, 0.3, 0.4, [4.54, 5.29, 6.03, 7.37, 8.04, 8.68, 10.07, 10.72, 11.41, 12.07, 12.74, 13.49]]],
    doors: [rect(4.14, 4.97, 0.57, 1.7, 0.12), rect(13.07, 13.92, 0.11, 1.59, 0.12)],
    lines: [[[20.32, 2.55], [21.0, 6.2]], [[8.2, -0.05], [11.15, 0.0]]],
    struts: [[[9.34, 0.3], [9.15, 2.42], 0.2, 0.16]],
    nacelles: [{
      s: 6.03, z: 2.21, sp: 0.5, sr: 0.3, prop: 2.9, blades: 6, inlet: [0.75, -0.4, 0.1, 0.08],
      outline: [[0, 0, "c"], [0.22, 0.22], [0.5, 0.3, "c"], [0.65, 0.4], [1.0, 0.5], [2.0, 0.56], [3.2, 0.5], [4.25, 0.28, "c"],
        [3.4, -0.2], [2.3, -0.48], [1.2, -0.56], [0.7, -0.5], [0.52, -0.32], [0.5, -0.3, "c"], [0.22, -0.22]],
    }],
  },
});
// The 330's fins stand on the tailplane tips, so they are drawn over it.
const sh33Fin = [[16.25, 1.45, "c"], [16.25, 4.05], [16.42, 4.3, "l"], [17.52, 4.3], [17.69, 4.12, "l"], [17.69, 1.4], [17.55, 1.25, "l"], [16.42, 1.25]];
F.sh33 = commuter({
  L0: 17.69, W: 2.24,
  body: [
    ...F.sh36.body.slice(0, 12), [13.5, 2.4], [15.0, 2.33], [16.2, 2.17], [16.5, 2.07, "c"], [16.5, 1.82, "c"], [15.5, 1.45], [14.2, 0.95],
    [13.05, 0.45], [12.2, 0.12], [11.6, 0.0, "l"], [10.49, -0.02], [10.24, 0.0], [9.99, -0.36], [9.09, -0.44], [7.99, -0.42], [7.49, -0.29],
    [7.29, -0.05], [7.09, -0.02, "l"], ...F.sh36.body.slice(-4),
  ],
  glass: F.sh36.glass,
  wing: { ...F.sh36.wing, le: 7.29, span: 22.76 },
  stab: { le: 2.0, z: 2.05, span: 5.6, root: 0.3, cr: 1.7, ct: 1.7, sweep: 0, dih: 0, thick: 0.1 },
  parts: {
    wins: [[0.93, 0.3, 0.4, [4.57, 5.29, 6.58, 7.23, 7.9, 9.24, 9.9, 10.55, 11.2, 11.86, 12.58]]],
    doors: [rect(4.14, 4.97, 0.57, 1.7, 0.12), rect(12.16, 13.0, 0.11, 1.59, 0.12)],
    lines: [[[7.29, -0.05], [10.24, 0.0]]],
    struts: [[[8.43, 0.3], [8.24, 2.42], 0.2, 0.16]],
    nacelles: [{ ...F.sh36.parts.nacelles[0], s: 5.12, blades: 5, prop: 2.82 }],
    shapes: [["fin", sh33Fin], ["hl", [[17.08, 1.3], [17.08, 4.28]], false]],
  },
});

// ---------- CASA C-212 Aviocar (Series 300 / 400) ----------
// References: published dimensions (Wikipedia: length 16.15 m, span 20.28 m, height 6.6 m, propellers
// 2.74 m, four blades) and the Commons side-view illustration "Casa Aviocar Fuerza Aérea
// Dominicana.svg" scaled to the length for the outline, nacelles, wing, winglets, portholes and doors,
// checked against the near side-on photo "Skytraders (VH-VHA) CASA C-212-400 Aviocar at Sydney
// Airport.jpg" (fuselage depth to length within 3 %, the gear stations). The 300 and 400 have the
// longer nose with a baggage hold and winglets that the earlier 100 and 200 lack. Box fuselage
// with round portholes, wing on its roof, TPE331 nacelles ahead of it, fixed gear in sponsons, and a
// rear loading ramp under the upswept tail.
F.c212 = commuter({
  L0: 16.15, W: 2.3,
  body: [
    [0, 0.54, "c"], [0.05, 0.64], [0.18, 0.76], [0.38, 0.87], [0.62, 0.98], [0.93, 1.1], [1.43, 1.26], [2.06, 1.41], [2.38, 1.76], [2.67, 2.05],
    [2.82, 2.14], [3.05, 2.21], [3.47, 2.27], [4.55, 2.3, "l"], [9.1, 2.33], [10.18, 2.37, "l"], [13.75, 3.54, "c"], [14.23, 5.88, "c"],
    [15.34, 5.88, "c"], [15.59, 4.8], [16.06, 2.61], [16.15, 2.39, "c"], [16.07, 2.3], [15.84, 2.24], [14.15, 1.96], [13.61, 1.84],
    [11.32, 0.69], [10.66, 0.36], [10.2, 0.12], [9.93, 0.06, "l"], [7.1, 0.01], [3.29, 0], [1.86, 0.07], [0.87, 0.17], [0.45, 0.24],
    [0.13, 0.33], [0.05, 0.38],
  ],
  glass: [
    [[2.12, 1.38], [2.58, 1.79], [2.8, 1.8], [2.8, 1.38]],
    [[2.9, 1.38], [2.9, 1.8], [3.35, 1.8], [3.35, 1.38]],
  ],
  wing: { le: 6.39, root: 1.15, span: 20.28, cr: 2.45, kink: [0.35, 2.45], ct: 1.3, sweep: 0, dih: 1, z: 2.38, t: [0.13, 0.11] },
  stab: { le: 2.25, z: 2.45, span: 8.4, root: 0.3, cr: 2.0, ct: 1.2, sweep: 8, dih: 0, thick: 0.1 },
  parts: {
    under: [["pant", [[6.25, 0.36], [6.65, 0.74], [7.4, 0.8], [8.2, 0.74], [8.6, 0.38], [8.2, 0.04], [7.4, -0.02], [6.65, 0.04]]]],
    wins: [[1.38, 0.33, 0.33, [4.77, 5.54, 6.34, 7.1, 7.87, 8.63]]],
    doors: [
      [[3.5, 0.28, "l"], [4.15, 0.28, "l"], [4.15, 1.2], [3.83, 1.47], [3.5, 1.2, "l"]],
      rect(9.22, 9.98, 0.37, 1.98, 0.14), rect(0.71, 1.51, 0.3, 1.0, 0.1),
    ],
    lines: [[[14.99, 5.1], [15.13, 2.62]], [[0.62, 0.22], [0.6, 0.98]], [[10.2, 0.12], [15.84, 2.24]]],
    gear: [
      { leg: [[7.35, 0.1], [7.35, -0.3]], w: [0.2, 0.16], at: [7.35, -0.33], r: 0.37 },
      { leg: [[1.95, 0.08], [1.95, -0.42]], w: [0.09, 0.07], at: [1.95, -0.45], r: 0.3 },
    ],
    nacelles: [{
      s: 4.46, z: 2.24, sp: 0.5, sr: 0.28, prop: 2.74, blades: 4, inlet: [0.7, -0.4, 0.09, 0.07],
      outline: [[0, 0, "c"], [0.2, 0.2], [0.5, 0.28, "c"], [0.62, 0.35], [1.0, 0.37], [2.3, 0.34], [3.5, 0.2], [4.5, 0.06, "c"],
        [3.6, -0.06], [2.8, -0.22], [1.9, -0.49], [1.0, -0.52], [0.6, -0.45], [0.52, -0.3], [0.5, -0.28, "c"], [0.2, -0.2]],
    }],
    // the winglets, seen edge-on above the wing
    shapes: [["wl", [[7.0, 2.5, "c"], [8.5, 3.12, "c"], [8.62, 3.1, "c"], [8.62, 2.46, "c"]]]],
  },
});

// ---------- BAe Jetstream 31 / 32 ----------
// References: published dimensions (Wikipedia: length 14.37 m, span 15.85 m, height 5.32 m) and Commons
// photos: "XX500 at RNAS Culdrose (8105701505).jpg" (a Jetstream T2, the same airframe, near
// broadside and distant) scaled to the length for the outline, windows, emergency exit and flight
// deck; "ZE438 (15924180000).jpg" (a Jetstream T3, the naval Jetstream 31) for the fin, rudder and
// the tailplane's height on the fin; the port-side "Pascan Aviation - BAe Jetstream 32 - C-GPPS"
// for the nacelles, wing root and airstair door. Round pressurised fuselage with a long drooping
// nose and oval windows, low wing, TPE331 nacelles reaching past the trailing edge, swept fin with
// the tailplane a third of the way up it; gear retracted.
F.js31 = commuter({
  L0: 14.37, W: 1.98,
  body: [
    [0, 0.38, "c"], [0.08, 0.52], [0.44, 0.69], [1.28, 0.99], [2.04, 1.26], [2.38, 1.39], [2.7, 1.58], [3.14, 1.9], [3.5, 1.99],
    [3.98, 2.03, "l"], [10.5, 2.04], [10.97, 2.18], [11.3, 2.44, "l"], [13.46, 4.42, "c"], [14.37, 4.42, "c"], [13.62, 1.5],
    [13.56, 1.2], [13.52, 1.0, "c"], [13.08, 0.84], [11.4, 0.5], [9.3, 0.22], [8.0, 0.04, "l"], [2.0, 0], [1.2, 0.02], [0.5, 0.1],
    [0.15, 0.22], [0.03, 0.31],
  ],
  glass: [
    [[2.62, 1.1], [3.12, 1.62], [3.22, 1.64], [3.22, 1.1]],
    [[3.28, 1.26], [3.28, 1.66], [3.52, 1.7], [3.52, 1.26]],
  ],
  wing: { le: 5.2, root: 0.85, span: 15.85, cr: 2.25, ct: 0.95, sweep: 2, dih: 7, z: 0.25, t: [0.16, 0.12] },
  eng: { kind: "prop", at: [0.27], fwd: 2.15, drop: -0.25, len: 4.6, dia: 0.8, spinner: 0.09, tailZ: -0.2, belly: 0.9, prop: 2.7, blades: 4 },
  stab: { le: 2.77, z: 2.5, span: 6.6, root: 0.12, cr: 1.6, ct: 0.8, sweep: 18, dih: 3, thick: 0.1 },
  parts: {
    wins: [[1.36, 0.34, 0.4, [4.24, 4.82, 5.43, 6.21, 6.95, 7.56, 8.19]]],
    doors: [rect(6.0, 6.45, 0.95, 1.65, 0.12), rect(8.62, 9.32, 0.18, 1.72, 0.14)],
    lines: [[[13.78, 1.9], [13.98, 4.4]]],
  },
});
// Jetstream 32 (Super 31): the same airframe with more powerful engines.
F.js32 = F.js31;

// ---------- BAe Jetstream 41 ----------
// References: published dimensions (Wikipedia: length 19.25 m, span 18.29 m, height 5.74 m,
// propellers 2.9 m, five blades) and the near broadside Commons photo "easternairways j41 g-majx
// arp.jpg" (in flight, gear down) scaled to the length for the outline, flight deck, windows, rear
// door, nacelles and tail. The Jetstream 31's round section stretched by 4.9 m, with a new deeper
// windscreen, the wing passing under the cabin in a long fairing, and higher nacelles.
F.js41 = commuter({
  L0: 19.25, W: 1.98,
  body: [
    [0, 0.47, "c"], [0.1, 0.6], [0.75, 0.93], [1.66, 1.36], [2.35, 1.73], [3.04, 2.0], [3.96, 2.11], [5.33, 2.16, "l"], [14.0, 2.16],
    [15.4, 2.32], [16.0, 2.52], [16.56, 2.94, "l"], [18.5, 4.4, "c"], [19.25, 4.4, "c"], [18.62, 1.6], [18.55, 1.3], [18.45, 1.16, "c"],
    [17.9, 1.05], [16.8, 0.76], [15.6, 0.48], [14.5, 0.28], [13.35, 0.06], [12.9, -0.12], [12.0, -0.36], [10.5, -0.45], [8.8, -0.42],
    [7.6, -0.25], [6.8, -0.02, "l"], [2.6, 0], [1.32, 0.12], [0.29, 0.3], [0.08, 0.38],
  ],
  glass: [
    [[2.47, 1.68], [3.04, 1.98], [3.29, 2.0], [3.29, 1.68]],
    [[3.36, 1.68], [3.36, 1.97], [3.82, 1.98], [3.82, 1.68]],
  ],
  wing: { le: 7.6, root: 0.9, span: 18.29, cr: 2.55, ct: 0.95, sweep: 2, dih: 6, z: -0.1, t: [0.16, 0.12] },
  stab: { le: 2.9, z: 2.2, span: 6.6, root: 0.12, cr: 1.7, ct: 0.85, sweep: 20, dih: 3, thick: 0.1 },
  parts: {
    wins: [[1.65, 0.33, 0.36, [5.42, 6.02, 7.2, 7.78, 8.36, 8.94, 9.52, 10.1, 10.69, 11.4, 11.98, 12.55]]],
    doors: [rect(12.9, 13.5, 0.74, 1.98, 0.12)],
    lines: [[[18.08, 1.6], [18.82, 4.38]]],
    nacelles: [{
      s: 6.36, z: 1.3, sp: 0.5, sr: 0.28, prop: 2.9, blades: 5, inlet: [0.7, -0.38, 0.09, 0.06],
      outline: [[0, 0, "c"], [0.2, 0.2], [0.5, 0.28, "c"], [0.65, 0.4], [1.2, 0.5], [2.4, 0.48], [3.6, 0.32], [4.6, 0.05, "c"],
        [3.8, -0.25], [2.6, -0.48], [1.2, -0.52], [0.65, -0.45], [0.52, -0.3], [0.5, -0.28, "c"], [0.2, -0.2]],
    }],
  },
});

export const families = F;
export const types = {
  D228: "d228", DHC6: "dhc6", SH33: "sh33", SH36: "sh36", C212: "c212", JS31: "js31", JS32: "js32", JS41: "js41",
};
