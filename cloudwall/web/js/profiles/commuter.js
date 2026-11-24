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

export const families = F;
export const types = {
  D228: "d228", DHC6: "dhc6",
};
