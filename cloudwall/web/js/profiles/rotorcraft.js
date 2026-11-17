// Helicopters. Format: see ../profiles.js.
// Outlines are `body` loops with D = 1, so every point is in metres: s aft from the nose tip,
// z up from the lowest line of the cabin belly (skids and wheels hang below z = 0). L0 is the
// fuselage length, nose tip to the aftmost point of the fin or tail rotor; data.js lengths are
// rotors-turning lengths, so `over` = that length - L0 (the rotor disc ahead of the nose).
// The drawing faces right, so we see the starboard side: a tail rotor on the port side of the
// fin (Robinson, Bell, Sikorsky S-76, Leonardo, MBB/Kawasaki) is on the far side and is drawn
// before the tail surfaces that hide it; one on the starboard side (AS350, UH-60) in front.
const F = {};

const rad = (deg) => (deg * Math.PI) / 180;

// ---------- drawing helpers for the extras/overlays hooks ----------

// Freehand parts: [cls, [[s, z, flag]...], closed?]. Classes used: door (door seams, no fill),
// hl (panel lines), inlet (dark intake and exhaust openings), fin (airframe-coloured parts drawn
// over something), stab (tailplane-coloured parts), strut/skid (gear tubes), hub (rotor hubs).
const paint = (parts) => ({ sk }) => {
  for (const [cls, pts, closed = true] of parts) sk.smooth(cls, pts, closed);
};

// A conventional tail rotor seen from the side: its disc, the blades frozen at angle `ang`
// (degrees from the horizontal), and the hub. d = diameter, n = blade count.
function tailRotor(sk, s, z, d, n, ang = 70, squash = 1) {
  const R = d / 2, w = Math.min(0.1, Math.max(0.05, d * 0.055));
  sk.ellipse("disc", s, z, R, R * squash);
  for (let i = 0; i < n; i++) {
    const a = rad(ang + (i * 360) / n), u = [Math.cos(a), Math.sin(a) * squash], v = [-Math.sin(a), Math.cos(a)];
    const P = (r, o) => [s + u[0] * r + v[0] * o, z + u[1] * r + v[1] * o];
    sk.poly("blade", [P(0.06, w * 0.5), P(R * 0.97, w * 0.4), P(R, 0), P(R * 0.97, -w * 0.4), P(0.06, -w * 0.5)]);
  }
  sk.ellipse("hub", s, z, Math.max(0.07, d * 0.05), Math.max(0.07, d * 0.05));
}
const tail = (s, z, d, n, ang, squash) => ({ sk }) => tailRotor(sk, s, z, d, n, ang, squash);

// A fenestron (ducted tail rotor in the fin), seen face-on as the side view shows it: the duct,
// the stator spokes and the hub. r = duct radius, rh = hub radius.
const fenestron = (s, z, r, rh, spokes = 8) => ({ sk }) => {
  sk.ellipse("fen", s, z, r, r);
  for (let i = 0; i < spokes; i++) {
    const a = rad(22.5 + (i * 360) / spokes), c = Math.cos(a), sn = Math.sin(a), w = 0.025;
    sk.poly("blade", [[s + c * rh - sn * w, z + sn * rh + c * w], [s + c * r * 0.97 - sn * w, z + sn * r * 0.97 + c * w],
      [s + c * r * 0.97 + sn * w, z + sn * r * 0.97 - c * w], [s + c * rh + sn * w, z + sn * rh - c * w]]);
  }
  sk.ellipse("hub", s, z, rh, rh);
};

// Skid landing gear (the near-side skid; the far one hides behind it). z: bottom of the tube,
// t: tube depth, aft/fwd: ends of the straight run, toe: [s, z] tip of the upturned toe,
// legs: [s at the belly, z at the belly, s at the skid, width]. The renderer's own skid draws a
// backward hook at the toe, so skids are drawn here instead.
const skids = (g) => ({ sk }) => {
  const { z, t = 0.09, aft, fwd, toe } = g;
  for (const [s0, z0, s1 = s0, w = 0.1] of g.legs) {
    sk.poly("strut", [[s0 - w / 2, z0], [s0 + w / 2, z0], [s1 + w * 0.4, z + t * 0.5], [s1 - w * 0.4, z + t * 0.5]]);
  }
  const [ts, tz] = toe, back = g.back ?? 0.04;
  sk.smooth("skid", [[aft, z + back, "c"], [aft - 0.06, z, "l"], [fwd, z], [ts, tz, "c"], [ts + t * 0.8, tz + t * 0.1, "c"],
    [fwd + 0.02, z + t, "l"], [aft - 0.06, z + t], [aft, z + t, "c"]]);
};

// A polygon [[s, z]...] with its corners rounded off by radius r (for window panes): each corner
// becomes a curve tangent to both edges.
const round = (pts, r) => pts.flatMap((p, i) => {
  const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
  const towards = (q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]), k = Math.min(r, d / 2.2) / d; return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]; };
  return [[...towards(a), ""], [...towards(b), "l"]];
});

// A rotor mast of width w from z0 up to the hub at z1 (the renderer's mast is 0.18 m wide; give
// the rotor mast: 0 and draw a slimmer one here).
const mast = (s, z0, z1, w) => ({ sk }) => sk.poly("strut", [[s - w / 2, z0], [s + w / 2, z0], [s + w * 0.4, z1], [s - w * 0.4, z1]]);

// A tailplane seen from the side: a thin cambered section from le to te at height z.
const aerofoil = (le, te, z, th = 0.07, camber = 0) => [[le, z, "c"], [le + (te - le) * 0.25, z + th * 0.6 + camber],
  [te, z + camber * 0.5, "c"], [le + (te - le) * 0.3, z - th * 0.4 + camber * 0.3]];

// A rotor hub like the renderer's own, for a second rotor (the renderer gives the aft rotor
// of a tandem only its mast and disc).
const hub = (s, z) => ({ sk }) => sk.smooth("hub", [[s - 0.35, z - 0.05], [s - 0.1, z + 0.12], [s + 0.12, z + 0.12], [s + 0.35, z - 0.05, "c"], [s, z - 0.18]]);

// Scale a point list (or a list of them) by sx along and sz up, for a family drawn after a
// measured relative.
const sc = (pts, sx, sz) => pts.map(([s, z, fl]) => (fl === undefined ? [s * sx, z * sz] : [s * sx, z * sz, fl]));

// A tailplane section seen edge-on from (le, zle) to (te, zte), thickness th.
const aero = (le, zle, te, zte, th) => [[le, zle, "c"], [le + (te - le) * 0.25, zle + (zte - zle) * 0.25 + th * 0.6],
  [te, zte, "c"], [le + (te - le) * 0.3, zle + (zte - zle) * 0.3 - th * 0.4]];

// ---------- Airbus Helicopters H135 / EC135 (EC35) ----------
// Reference: Wikimedia Commons "Eurcopter EC135 orthographical image.svg" (3-view, side view
// traced; scaled to the 10.20 m fuselage length, nose to tail bumper). Rotor 10.20 m (Wikipedia
// EC135 spec table). Overall rotors turning 12.16 m. Features: rounded nose with the big
// wrap-round windscreen and chin windows, sliding rear door, clamshell doors in the tapered rear
// pod, engine cowling with the low mast fairing, boom with the drive-shaft fairing on top,
// horizontal stabiliser with endplates, swept fin with the fenestron, ventral fin, skids.
// The default drawing for any helicopter without a profile of its own.
const EC135_BODY = [[0, 0.78], [0.1, 1.03], [0.3, 1.23], [0.6, 1.43], [1.0, 1.64], [1.4, 1.79], [1.8, 1.97], [2.2, 2.08],
    [2.63, 2.15, "c"], [2.75, 2.3], [2.95, 2.46], [3.3, 2.51], [3.75, 2.51], [3.98, 2.46], [4.07, 2.36], [4.13, 2.16, "c"],
    [4.4, 2.14], [4.8, 2.06], [5.1, 2.0], [5.3, 1.9], [5.5, 1.82], [5.75, 1.79], [7.7, 1.73], [8.02, 1.75],
    [8.12, 1.8, "l"], [9.12, 3.21], [9.3, 3.29, "l"], [10.09, 3.29, "c"], [9.88, 2.77], [9.76, 2.42], [9.77, 2.26], [9.85, 2.1],
    [10.12, 1.7, "c"], [10.08, 1.55], [9.85, 1.22, "l"], [9.55, 0.68], [9.45, 0.58, "c"], [8.88, 0.56, "c"], [8.62, 0.98],
    [8.3, 1.14], [8.05, 1.24], [7.0, 1.23], [5.8, 1.2], [5.68, 1.16], [5.4, 0.91], [5.0, 0.61], [4.6, 0.36], [4.3, 0.19],
    [4.0, 0.05], [3.6, 0.0], [3.0, 0.01], [2.2, 0.03], [1.4, 0.05], [1.0, 0.12], [0.6, 0.23], [0.3, 0.37], [0.1, 0.53], [0.02, 0.66]];
const EC135_GLASS = [
    // windscreen, chin window, cockpit door, sliding door, aft cabin window, roof-edge window
    [[0.03, 0.76], [0.03, 0.97, ""], [0.3, 1.25, ""], [0.75, 1.52, ""], [1.2, 1.72, ""], [1.66, 1.85], [1.56, 1.68], [0.76, 0.75]],
    [[0.04, 0.71], [0.64, 0.71], [0.47, 0.32], [0.24, 0.42, ""], [0.08, 0.56, ""]],
    [[1.76, 1.54], [1.3, 1.54], [0.92, 0.85], [1.0, 0.82], [1.76, 0.99]],
    [[2.68, 1.54], [1.92, 1.54], [1.92, 0.97], [2.68, 0.93]],
    [[3.44, 1.5], [3.0, 1.51], [2.98, 1.0], [3.23, 1.0]],
    [[2.56, 2.06], [2.47, 2.01], [2.47, 1.78], [2.56, 1.75]],
  ];
const EC135_SEAMS = [
    ["door", [[2.8, 1.6], [1.5, 1.6, "c"], [0.74, 0.74], [0.76, 0.5], [0.92, 0.4, "c"], [2.7, 0.4], [2.8, 0.5, "c"]]],
    ["hl", [[1.82, 1.6], [1.82, 0.4]], false],
    ["door", [[5.72, 1.1, "c"], [4.6, 1.1], [4.42, 0.96], [4.05, 0.47], [4.12, 0.37], [4.5, 0.36, "c"], [5.0, 0.66], [5.6, 1.06, "c"]]],
    ["hl", [[1.7, 1.73], [2.47, 1.7], [3.42, 1.59], [4.55, 1.2, "c"], [5.72, 1.2, "c"], [5.72, 1.79]], false],
    ["hl", [[5.75, 1.62], [7.75, 1.6]], false],
    ["inlet", [[5.45, 1.9], [5.3, 2.02], [4.95, 2.05], [4.83, 1.95], [4.85, 1.72], [5.05, 1.62], [5.45, 1.78]]],
  ];
const EC135_ENDPLATE = [[8.07, 1.76, "c"], [7.73, 1.76, "c"], [7.51, 1.44, "c"], [7.86, 0.88, "c"], [8.18, 0.88, "c"], [8.05, 1.4]];
F.ec35 = {
  kind: "heli", L0: 10.2, over: 2.0, D: 1, W: 1.5,
  body: EC135_BODY,
  glass: EC135_GLASS,
  frame: 0.035,
  rotor: { s: 3.2, z: 2.65, mast: 0.15, d: 10.2 },
  extras: [paint(EC135_SEAMS)],
  overlays: [
    skids({ z: -0.42, t: 0.09, aft: 3.85, fwd: 1.2, toe: [0.95, -0.2], legs: [[1.53, 0.06, 1.53, 0.12], [3.53, 0.02, 3.53, 0.12]] }),
    fenestron(9.11, 1.63, 0.56, 0.2),
    // the horizontal stabiliser's starboard endplate
    paint([["stab", EC135_ENDPLATE]]),
  ],
};

// ---------- Bell 206 JetRanger (B06) ----------
// Reference: Wikimedia Commons "Bell 206A orthographical image.svg" (3-view; side view traced and
// scaled so nose tip to tail-rotor blade tip is 9.50 m, which gives the 11.82 m rotors-turning
// length and the 10.16 m rotor of the Wikipedia Bell 206B spec table). Tail rotor 1.65 m
// (Bell 206B-3 data); the drawing's tail rotor is drawn oversize. Features: pointed nose with
// chin windows, two-pane door windows, roof eyebrow windows, transmission fairing and tall mast,
// curved exhaust stack, tapering boom with the small inverted-aerofoil stabiliser, swept upper
// fin and ventral fin with tail skid, two-blade teetering rotors, tail rotor on the port side.
F.b06 = {
  kind: "heli", L0: 9.46, over: 2.44, D: 1, W: 1.3,
  body: [[0.0, 0.34], [0.05, 0.42], [0.3, 0.58], [0.5, 0.67], [0.6, 0.76], [0.8, 0.98], [1.0, 1.15], [1.2, 1.26],
    [1.4, 1.31], [1.6, 1.39], [1.8, 1.57], [1.95, 1.64], [2.25, 1.66], [2.36, 1.73], [2.43, 1.86], [2.55, 1.88],
    [2.95, 1.88], [3.06, 1.84], [3.4, 1.84], [4.0, 1.83], [4.3, 1.8], [4.5, 1.73], [4.8, 1.6], [5.0, 1.51], [5.2, 1.45],
    [5.4, 1.45], [6.0, 1.48], [7.0, 1.52], [8.3, 1.6], [8.75, 1.67], [9.05, 1.6], [9.12, 1.5], [9.02, 1.4], [8.7, 1.36],
    [8.35, 1.24], [7.0, 1.1], [6.0, 1.01], [5.35, 0.94], [5.22, 0.9], [5.0, 0.65], [4.8, 0.41], [4.65, 0.3], [4.3, 0.22],
    [4.0, 0.16], [3.7, 0.1], [3.45, 0.03], [3.0, 0.0], [1.0, 0.0], [0.8, 0.01], [0.6, 0.04], [0.4, 0.1], [0.2, 0.17],
    [0.06, 0.25]],
  glass: [
    // windscreen, roof eyebrow, chin window, front door (two panes), rear door (two panes)
    [[0.56, 0.69], [0.8, 0.97, ""], [1.1, 1.2, ""], [1.4, 1.31, ""], [1.62, 1.34], [1.5, 1.05, ""], [1.14, 0.52]],
    [[1.62, 1.35], [2.22, 1.34], [2.22, 1.26], [1.62, 1.25]],
    [[0.08, 0.35], [0.82, 0.36], [0.88, 0.05], [0.5, 0.08, ""], [0.2, 0.18, ""]],
    [[2.13, 1.16], [1.69, 1.16], [1.55, 0.86], [2.02, 0.86]],
    [[2.01, 0.81], [1.53, 0.81], [1.41, 0.59], [1.91, 0.59]],
    [[3.08, 1.16], [2.34, 1.16], [2.23, 0.86], [3.0, 0.86]],
    [[2.99, 0.81], [2.23, 0.81], [2.2, 0.59], [2.97, 0.59]],
  ],
  frame: 0.03,
  rotor: { s: 2.69, z: 2.55, mast: 0, d: 10.16 },
  extras: [
    mast(2.69, 1.88, 2.55, 0.09),
    tail(8.63, 1.5, 1.65, 2, 60),
    paint([
      // far-side tail rotor: the gearbox fairing and the fins hide its hub
      ["fin", [[8.36, 1.6, "c"], [8.8, 2.5], [8.88, 2.58, "c"], [9.19, 2.58, "c"], [8.86, 1.6, "c"]]],
      ["fin", [[8.34, 1.25, "c"], [8.71, 0.59, "c"], [9.04, 0.59, "c"], [8.84, 1.32, "c"]]],
      ["fin", [[8.42, 1.62], [8.75, 1.67], [9.05, 1.6], [9.12, 1.5], [9.02, 1.4], [8.7, 1.36], [8.42, 1.38]]],
      ["strut", [[8.95, 0.61, "c"], [9.1, 0.49], [9.28, 0.45, "c"], [9.28, 0.41, "c"], [9.08, 0.44], [8.92, 0.59, "c"]]],
      // exhaust stack, door seams, cowling seam, engine air inlet louvres
      ["fin", [[3.52, 1.84, "c"], [3.5, 1.98], [3.6, 2.07], [3.72, 2.05, "c"], [3.78, 1.92, "c"], [3.66, 1.97], [3.62, 1.84, "c"]]],
      ["door", [[2.26, 1.26, "c"], [1.62, 1.26, "c"], [1.11, 0.19, "c"], [1.97, 0.11, "c"]]],
      ["door", [[3.15, 1.22, "c"], [2.3, 1.22, "c"], [2.02, 0.12, "c"], [3.0, 0.12, "c"], [3.12, 0.3, "c"]]],
      ["hl", [[1.62, 1.31], [4.6, 1.31]], false],
      ["hl", [[3.07, 1.84], [3.05, 1.32]], false],
      ...[4.42, 4.49, 4.56].map((s) => ["inlet", [[s, 1.57, "c"], [s + 0.035, 1.58, "c"], [s + 0.035, 1.38, "c"], [s, 1.38, "c"]]]),
      ["stab", aerofoil(6.54, 6.96, 1.27, 0.06, 0.02)],
    ]),
  ],
  overlays: [
    skids({ z: -0.43, t: 0.1, aft: 3.5, fwd: 1.5, toe: [1.27, -0.3], legs: [[1.94, 0.0, 1.94, 0.15], [3.28, 0.04, 3.28, 0.15]] }),
  ],
};

// ---------- Bell 407 (B407) ----------
// Reference: Wikimedia Commons "Bell 407 orthographical image.svg" (3-view, same artist as the
// 206A one; side view traced, scaled so mast to tail-rotor hub matches the Wikipedia spec table:
// 12.70 m rotors turning, 10.67 m main rotor, 1.65 m tail rotor). Against the 206: cabin
// stretched about 0.2 m with three big rounded windows (front door, double rear doors), longer
// engine cowling with the inlet louvres, composite boom with the arrowhead endplate fins on
// the stabiliser, taller fin, four-blade soft-in-plane rotor with a domed hub, tail rotor on
// the port side.
F.b407 = {
  kind: "heli", L0: 10.15, over: 2.55, D: 1, W: 1.5,
  body: [[0.0, 0.35], [0.05, 0.43], [0.3, 0.59], [0.5, 0.67], [0.6, 0.76], [0.8, 0.97], [1.0, 1.15], [1.2, 1.26],
    [1.4, 1.32], [1.6, 1.38], [1.8, 1.57], [1.95, 1.64], [2.3, 1.66], [2.38, 1.7], [2.46, 1.8], [2.6, 1.84], [3.0, 1.84],
    [3.7, 1.81], [4.3, 1.75], [4.9, 1.64], [5.2, 1.58], [5.3, 1.55, "c"], [5.38, 1.47], [5.5, 1.45], [6.0, 1.47],
    [7.0, 1.52], [8.0, 1.57], [9.0, 1.63], [9.4, 1.77], [9.7, 1.74], [9.83, 1.62], [9.72, 1.48], [9.4, 1.42], [9.0, 1.33],
    [8.0, 1.21], [7.0, 1.09], [6.0, 0.98], [5.6, 0.94], [5.48, 0.92], [5.35, 0.78], [5.2, 0.57], [5.0, 0.37], [4.85, 0.24],
    [4.6, 0.17], [4.3, 0.11], [4.0, 0.05], [3.85, 0.0], [1.0, 0.0], [0.8, 0.01], [0.6, 0.05], [0.4, 0.1], [0.2, 0.17],
    [0.06, 0.25]],
  glass: [
    // windscreen, roof eyebrow, chin window, front door, the two rear doors
    [[0.54, 0.68], [0.8, 0.97, ""], [1.1, 1.2, ""], [1.4, 1.31, ""], [1.6, 1.34], [1.45, 1.0, ""], [1.1, 0.52]],
    [[1.63, 1.37], [2.2, 1.36], [2.2, 1.27], [1.63, 1.26]],
    [[0.06, 0.34], [0.8, 0.35], [0.86, 0.03], [0.5, 0.06, ""], [0.2, 0.16, ""]],
    [[2.18, 1.16], [1.69, 1.16], [1.44, 0.61], [2.12, 0.61]],
    [[2.78, 1.19], [2.35, 1.19], [2.23, 0.61], [2.76, 0.61]],
    [[3.66, 1.17], [2.91, 1.19], [2.81, 0.61], [3.55, 0.61]],
  ],
  frame: 0.03,
  rotor: { s: 2.72, z: 2.5, mast: 0, d: 10.67 },
  extras: [
    mast(2.72, 1.84, 2.5, 0.14),
    tail(9.32, 1.57, 1.65, 2, 60),
    paint([
      // far-side tail rotor: the gearbox fairing and the fins hide its hub
      ["fin", [[9.1, 1.7, "c"], [9.5, 2.6], [9.6, 2.68, "c"], [9.89, 2.68, "c"], [9.58, 1.68, "c"]]],
      ["fin", [[9.08, 1.34, "c"], [9.44, 0.66, "c"], [9.78, 0.66, "c"], [9.52, 1.37, "c"]]],
      ["fin", [[9.05, 1.62], [9.4, 1.77], [9.7, 1.74], [9.83, 1.62], [9.72, 1.48], [9.4, 1.43], [9.05, 1.4]]],
      ["strut", [[9.62, 0.67, "c"], [9.8, 0.62], [10.0, 0.6, "c"], [10.0, 0.56, "c"], [9.78, 0.58], [9.6, 0.64, "c"]]],
      // exhaust stack, door seams, cowling seams, inlet louvres
      ["fin", [[3.8, 1.81, "c"], [3.78, 1.95], [3.88, 2.03], [4.0, 2.02, "c"], [4.07, 1.9, "c"], [3.95, 1.94], [3.9, 1.81, "c"]]],
      ["door", [[2.23, 1.24, "c"], [1.63, 1.24, "c"], [1.1, 0.2, "c"], [1.2, 0.1], [2.15, 0.1, "c"]]],
      ["door", [[2.86, 1.24, "c"], [2.27, 1.24, "c"], [2.18, 0.1, "c"], [2.83, 0.1, "c"]]],
      ["door", [[3.73, 1.24, "c"], [2.9, 1.24, "c"], [2.87, 0.1, "c"], [3.45, 0.1], [3.65, 0.25, "c"]]],
      ["hl", [[2.2, 1.34], [5.3, 1.34]], false],
      ["hl", [[3.2, 1.84], [3.2, 1.34]], false],
      ...[1.5, 1.55, 1.6].map((z) => ["hl", [[3.86, z], [4.7, z]], false]),
    ]),
  ],
  overlays: [
    skids({ z: -0.38, t: 0.1, aft: 4.14, fwd: 1.5, toe: [1.31, -0.18], legs: [[1.95, 0.0, 1.86, 0.13], [3.92, 0.06, 3.72, 0.13]] }),
    // the stabiliser's starboard endplate fin
    paint([["stab", [[7.54, 1.81, "c"], [7.32, 1.81, "c"], [7.0, 1.42, "c"], [7.32, 0.94, "c"], [7.65, 0.94, "c"], [7.41, 1.42, "c"]]]]),
  ],
};

// ---------- Airbus Helicopters H125 / AS350 Ecureuil (AS50) ----------
// Reference: Wikimedia Commons "Aérospatiale AS355 Écureuil 2 profile silhouette.svg" (the twin
// AS355 shares the AS350 airframe outline), traced and scaled to the 10.93 m fuselage length of
// the Wikipedia AS350 spec table; panel lines after "Aérospatiale AS550 Fennec - illustration.svg".
// Checks: 3.32 m height to the rotor head (H125 3.34 m), 1.86 m tail rotor, mast to rotor tip
// gives the 12.94 m rotors-turning length. Features: round bulbous nose and wrap-round
// windscreen with chin and lower door windows, roof step up to the long transmission/engine
// cowling, three-blade Starflex rotor, slim boom whose underside sweeps up from the cabin,
// swept upper fin, ventral fin, stabiliser with tip fins, two-blade tail rotor on the starboard
// side (in front of the fin in this view), high skids.
F.as50 = {
  kind: "heli", L0: 10.93, over: 1.97, D: 1, W: 1.8,
  body: [[0, 0.52], [0.05, 0.64], [0.2, 0.83], [0.4, 1.0], [0.6, 1.16], [0.8, 1.32], [1.0, 1.47], [1.15, 1.59], [1.3, 1.65],
    [1.6, 1.71], [1.85, 1.74], [1.95, 1.84], [2.1, 1.93], [2.3, 1.97], [2.42, 1.98, "c"], [2.47, 2.1], [2.6, 2.14],
    [3.0, 2.18], [3.6, 2.19], [4.2, 2.16], [4.5, 2.08], [4.8, 1.97], [5.1, 1.84], [5.4, 1.68], [5.6, 1.56], [5.75, 1.47],
    [6.0, 1.45], [9.2, 1.41], [9.79, 1.48, "l"], [10.54, 2.63], [10.6, 2.69, "l"], [10.93, 2.69, "c"], [10.3, 1.29, "c"],
    [10.25, 1.13, "c"], [10.3, 0.48, "c"], [9.9, 0.5, "c"], [9.74, 0.91], [9.6, 1.03], [9.0, 0.98], [8.0, 0.85], [7.0, 0.73],
    [6.0, 0.6], [5.5, 0.54], [5.0, 0.47], [4.6, 0.34], [4.3, 0.24], [4.0, 0.14], [3.5, 0.06], [3.0, 0.02], [2.0, 0.0],
    [1.5, 0.01], [1.0, 0.05], [0.7, 0.09], [0.4, 0.18], [0.2, 0.25], [0.08, 0.35]],
  glass: [
    // windscreen, roof window, front door, lower front (chin) window, lower door window, rear door
    [[1.25, 1.6], [0.98, 0.81], [0.3, 0.88], [0.7, 1.28, ""]],
    round([[1.7, 1.71], [1.3, 1.67], [1.33, 1.57], [1.68, 1.6]], 0.04),
    round([[1.77, 1.5], [1.33, 1.52], [1.18, 0.82], [1.6, 0.8]], 0.09),
    round([[0.86, 0.64], [0.34, 0.6], [0.27, 0.4], [0.45, 0.23], [0.68, 0.21]], 0.08),
    round([[1.6, 0.73], [1.0, 0.73], [0.95, 0.44], [1.57, 0.43]], 0.06),
    round([[2.68, 1.42], [2.0, 1.42], [1.82, 0.83], [2.62, 0.83]], 0.13),
  ],
  frame: 0.035,
  rotor: { s: 3.32, z: 2.62, mast: 0, d: 10.69 },
  extras: [
    mast(3.32, 2.18, 2.62, 0.13),
    paint([
      ["door", [[1.82, 1.5, "c"], [1.32, 1.52, "c"], [0.9, 0.5], [0.95, 0.4, "c"], [1.6, 0.38, "c"]]],
      ["door", [[2.78, 1.5, "c"], [1.86, 1.5, "c"], [1.62, 0.38, "c"], [2.72, 0.36, "c"], [2.82, 0.6]]],
      // engine cowling doors, boom joint, engine air intake
      ["hl", [[2.42, 1.98], [2.4, 1.74], [3.4, 1.57], [3.95, 1.27], [4.96, 0.99], [5.73, 1.1], [5.75, 1.47]], false],
      ["inlet", [[4.96, 1.62], [5.15, 1.7], [5.33, 1.62], [5.15, 1.52]]],
      ["strut", [[9.9, 0.4, "c"], [10.2, 0.31], [10.6, 0.25, "c"], [10.6, 0.21, "c"], [10.2, 0.27], [9.88, 0.36, "c"]]],
    ]),
  ],
  overlays: [
    skids({ z: -0.55, t: 0.09, aft: 4.57, fwd: 1.95, toe: [1.64, -0.3], legs: [[2.57, 0.0, 2.57, 0.11], [4.04, 0.13, 4.04, 0.11]] }),
    // starboard tail rotor, then the stabiliser with its tip fin in front of it
    tail(9.58, 1.37, 1.86, 2, 85),
    paint([["stab", [...aerofoil(9.75, 10.55, 1.2, 0.08), ]], ["stab", [[10.42, 1.12, "c"], [10.6, 1.14], [10.62, 1.3], [10.45, 1.33, "c"]]]]),
  ],
};

// ---------- Sikorsky UH-60 Black Hawk (H60) ----------
// References: Wikimedia Commons "Sikorsky UH-60 Black Hawk orthographical image.svg" (side view
// traced, scaled to the 29 ft / 8.84 m wheelbase) and "Sikorsky UH-60 Black Hawk dimensions.png"
// (US Army TM side elevation: fuselage 50 ft 7.5 in, overall 64 ft 10 in, rotor 53 ft 8 in, tail
// rotor 11 ft, belly 1 ft 7 in above the ground), which places the rotor and tail rotor hubs.
// Features: long low cabin with the drooped nose and D-shaped chin windows, cockpit, gunner and
// sliding cabin doors, engine nacelles with the exhaust suppressors either side of the rotor
// pylon, four-blade rotor, boom rising into the swept tail pylon with its stepped trailing edge,
// big stabilator, the canted four-blade tail rotor on the starboard side, fixed main gear with
// drag beams and the tail wheel.
F.h60 = {
  kind: "heli", L0: 16.3, over: 3.5, D: 1, W: 2.36,
  body: [[0, 0.5], [0.05, 0.62], [0.2, 0.84], [0.4, 0.95], [0.6, 1.05], [0.8, 1.15], [1.0, 1.27], [1.2, 1.47], [1.4, 1.65],
    [1.6, 1.84], [1.7, 1.91], [1.85, 1.97], [2.1, 2.03], [2.3, 2.14], [2.5, 2.21], [2.8, 2.28], [3.3, 2.37], [3.8, 2.43],
    [4.2, 2.49], [4.6, 2.53], [5.2, 2.54], [6.0, 2.53], [6.3, 2.5], [7.0, 2.47], [7.5, 2.42, "c"], [7.6, 2.18], [8.2, 1.84],
    [9.0, 1.72], [10.0, 1.57], [11.0, 1.42], [12.0, 1.26], [12.45, 1.21], [12.62, 1.3, "l"], [14.33, 3.01], [14.45, 3.26],
    [14.72, 3.34], [15.0, 3.26], [15.09, 3.08], [15.04, 2.81, "c"], [14.3, 1.8, "c"], [14.89, 1.78, "c"], [14.53, 1.22, "c"],
    [14.24, 0.67, "c"], [13.2, 0.47], [12.25, 0.28], [11.3, 0.2], [10.0, 0.15], [9.0, 0.13], [8.0, 0.09], [7.5, 0.03],
    [7.0, 0.0], [2.0, 0.0], [1.6, 0.01], [1.2, 0.05], [1.0, 0.07], [0.8, 0.11], [0.6, 0.15], [0.4, 0.2], [0.2, 0.27], [0.08, 0.36]],
  glass: [
    // chin window, windscreen, cockpit roof and door windows, gunner's windows, cabin door windows
    [[1.18, 0.97], [0.75, 0.95, ""], [0.5, 0.6, ""], [0.75, 0.25, ""], [1.18, 0.22]],
    [[1.72, 1.85], [1.55, 1.86], [0.95, 1.12], [1.1, 1.09]],
    [[2.22, 2.02], [1.9, 2.03], [1.68, 1.86], [2.22, 1.84]],
    [[2.22, 1.68], [1.81, 1.68], [1.34, 1.09], [2.22, 1.05]],
    round([[3.42, 1.6], [3.16, 1.6], [3.16, 0.88], [3.42, 0.88]], 0.1),
    round([[3.09, 1.6], [2.82, 1.6], [2.82, 0.88], [3.09, 0.88]], 0.1),
    round([[5.39, 1.6], [4.7, 1.6], [4.7, 0.88], [5.39, 0.88]], 0.09),
    round([[4.59, 1.6], [3.92, 1.6], [3.92, 0.88], [4.59, 0.88]], 0.09),
  ],
  frame: 0.035,
  rotor: { s: 4.55, z: 3.06, mast: 0, d: 16.36 },
  gear: [{ s: 3.62, z: 0.45, ws: 3.57, wz: -0.2, r: 0.3 }, { s: 12.12, z: 0.3, ws: 12.39, wz: -0.28, r: 0.2 }],
  extras: [
    // rotor standpipe and swashplate, between the engine nacelles
    paint([["strut", [[4.25, 2.5, "c"], [4.85, 2.5, "c"], [4.72, 2.95, "c"], [4.38, 2.95, "c"]]]]),
    paint([
      // starboard engine nacelle with its inlet and the exhaust suppressor
      ["nac", [[3.85, 2.42, "c"], [6.3, 2.5], [7.52, 2.43, "c"], [7.62, 2.22], [7.5, 1.76, "c"], [6.2, 1.78], [3.85, 1.98, "c"]]],
      ["inlet", [[3.92, 2.36, "c"], [4.12, 2.33], [4.2, 2.17], [4.12, 2.03], [3.92, 2.02, "c"]]],
      ["inlet", [[7.28, 2.2], [7.38, 2.24], [7.48, 1.98], [7.4, 1.76], [7.3, 1.8], [7.24, 1.98]]],
      // doors, the cabin door rail, boom joints
      ["door", [[2.3, 1.72, "c"], [1.83, 1.72, "c"], [1.27, 1.0, "c"], [1.27, 0.5, "c"], [2.3, 0.5, "c"]]],
      ["door", [[3.52, 1.76, "c"], [2.74, 1.76, "c"], [2.74, 0.82, "c"], [3.52, 0.82, "c"]]],
      ["door", [[5.56, 1.76, "c"], [3.84, 1.76, "c"], [3.84, 0.15, "c"], [5.56, 0.15, "c"]]],
      ["hl", [[3.84, 1.8], [7.5, 1.8]], false],
      ["hl", [[8.18, 1.84], [8.18, 0.09]], false],
      ["hl", [[12.5, 1.22], [12.4, 0.28]], false],
      // main gear drag beam and its step fairing
      ["strut", [[3.57, -0.17, "c"], [2.2, 0.17, "c"], [2.2, 0.08, "c"], [3.57, -0.25, "c"]]],
      ["fin", [[1.91, 0.22], [2.2, 0.36], [2.55, 0.33], [2.66, 0.2], [2.4, 0.07], [2.0, 0.1]]],
    ]),
  ],
  overlays: [
    // canted (20 degree) four-blade tail rotor on the starboard side of the pylon
    tail(14.62, 3.09, 3.35, 4, 45, 0.94),
    paint([["stab", aero(13.2, 1.2, 14.95, 0.98, 0.12)]]),
  ],
};

// ---------- Boeing CH-47 Chinook (H47) ----------
// Reference: Wikimedia Commons "Boeing CH-47 Chinook 3-view line drawing.svg" (side view, drawn
// standing nose-high: levelled by 2.5 degrees, scaled to the 15.6 m fuselage length, heights
// x0.92 to match the 5.685 m height of the Wikipedia CH-47F spec table, which the drawing
// overstates). The drawing also puts the rotors closer together than the published 30.14 m
// rotors-turning length with 18.29 m rotors allows, so the hubs sit 11.85 m apart (fwd 1.85,
// aft 13.7); wheelbase 6.86 m (22 ft 6 in). Cross-checked with "Boeing Vertol CH-47 Chinook
// 3-view line drawing.png". Features: blunt glazed nose with the chin bubble and the stepped
// cockpit panes, forward rotor pylon over the cockpit, long box cabin with the round windows,
// full-length side fuel pods, tall aft pylon with the T55 nacelles and their intake screens on
// its flanks, upswept loading-ramp underside, two tandem three-blade rotors, four wheels.
F.h47 = {
  kind: "heli", L0: 15.6, over: 14.4, D: 1, W: 3.78,
  body: [[0.01, 0.95], [0.05, 1.08], [0.13, 1.2], [0.25, 1.3], [0.43, 1.4], [0.65, 1.5], [0.88, 1.6, "l"], [1.25, 2.4],
    [1.3, 2.95], [1.36, 3.1], [1.45, 3.12], [3.8, 3.0], [3.88, 2.9], [3.9, 2.5, "c"], [10.75, 2.47], [10.98, 2.65],
    [11.3, 3.1], [11.57, 3.75], [11.8, 4.15], [12.05, 4.33], [14.8, 4.33], [15.35, 4.38, "c"], [15.5, 3.3],
    [15.56, 1.85, "c"], [15.4, 1.5], [15.0, 1.12], [14.6, 0.85], [14.2, 0.63], [13.6, 0.39], [13.2, 0.25], [12.8, 0.12],
    [12.3, 0.0], [11.9, -0.04], [4.2, -0.04], [4.0, 0.08], [3.6, 0.1], [2.6, 0.1], [2.0, 0.11], [1.6, 0.13], [1.2, 0.19],
    [1.0, 0.22], [0.8, 0.27], [0.6, 0.33], [0.4, 0.4], [0.2, 0.53], [0.1, 0.65], [0.03, 0.8]],
  glass: [
    // cockpit roof pane, three side panes, lower side pane, chin bubble
    [[1.82, 1.96], [1.75, 2.18, ""], [1.5, 2.17, ""], [1.22, 2.11], [1.12, 1.96]],
    [[1.91, 1.88], [1.68, 1.88], [1.8, 1.67], [1.66, 1.32], [1.89, 1.32], [2.03, 1.67]],
    [[1.57, 1.88], [1.46, 1.88], [1.21, 1.32], [1.57, 1.32], [1.71, 1.67]],
    [[1.36, 1.88], [1.1, 1.88], [0.87, 1.52], [1.13, 1.36]],
    [[1.85, 1.26], [1.18, 1.26], [0.9, 0.65], [1.57, 0.65]],
    [[1.12, 1.33], [0.75, 1.3, ""], [0.4, 1.12, ""], [0.2, 0.85, ""], [0.68, 0.38]],
  ],
  frame: 0.012,
  win: [{ z: 1.44, from: 3.16, to: 11.2, pitch: 2.0, w: 0.56, h: 0.56 }],
  rotor: { s: 1.85, z: 3.45, mast: 0.35, d: 18.29, aft: { s: 13.7, z: 4.75, mast: 0.42 } },
  gear: [{ s: 5.8, z: 0.0, ws: 5.8, wz: -0.34, r: 0.3 }, { s: 12.66, z: 0.15, ws: 12.66, wz: -0.34, r: 0.3 }],
  extras: [paint([
    // side fuel pod, crew door, ramp, pylon panel lines
    ["fin", [[3.92, 0.2], [3.95, 0.85], [4.15, 1.07], [12.55, 1.06], [12.85, 0.85], [12.95, 0.35], [12.7, 0.02], [4.3, -0.04]]],
    ["hl", [[5.55, 1.06], [5.55, -0.04]], false],
    ["hl", [[10.64, 1.06], [10.64, -0.04]], false],
    ["door", round([[3.75, 1.88], [2.74, 1.88], [2.74, 1.07], [3.75, 1.07]], 0.08)],
    ["hl", [[15.45, 1.77], [14.4, 0.98], [13.17, 0.36]], false],
    ["hl", [[12.0, 4.25], [12.0, 3.0]], false],
    ["hl", [[14.9, 4.3], [14.9, 2.2], [15.53, 2.2]], false],
    ["hl", [[3.9, 2.52], [1.3, 2.62]], false],
  ])],
  overlays: [
    hub(13.7, 4.75),
    paint([
      // starboard T55 nacelle on its pylon, with the intake screen and the exhaust
      ["pyl", [[12.1, 2.25, "c"], [13.25, 2.25, "c"], [13.0, 1.78, "c"], [12.2, 1.78, "c"]]],
      ["nac", [[11.3, 2.47, "c"], [11.45, 2.9], [12.03, 2.97, "c"], [12.12, 2.8, "c"], [13.25, 2.76, "c"], [13.3, 2.72, "c"],
        [13.85, 2.7, "c"], [13.85, 2.22, "c"], [13.3, 2.2, "c"], [13.25, 2.18, "c"], [12.12, 2.15, "c"], [12.03, 1.98, "c"], [11.45, 2.04]]],
      ["core", [[11.33, 2.47, "c"], [11.5, 2.86], [11.95, 2.92, "c"], [11.95, 2.02, "c"], [11.5, 2.08]]],
      ["inlet", [[13.82, 2.68, "c"], [13.9, 2.6], [13.9, 2.32], [13.82, 2.24, "c"]]],
    ]),
  ],
};

export const families = F;
export const types = {
  EC35: "ec35", B06: "b06", B407: "b407", AS50: "as50", H60: "h60", H47: "h47",
};
