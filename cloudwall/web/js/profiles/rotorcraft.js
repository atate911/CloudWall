// Helicopters. Format: see ../profiles.js.
// Outlines are `body` loops with D = 1, so every point is in metres: s aft from the nose tip,
// z up from the lowest line of the cabin belly (skids and wheels hang below z = 0). L0 is the
// fuselage length, nose tip to the aftmost point of the fin or tail rotor; types.csv lengths are
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
// More of the 3-view's side view (EC135 only; the H145 drawn from it is not known to share them):
// access panels on the cowling and the cabin side, the seam across the upper fin, the shroud line
// under the fenestron, and the tail position light.
const box = (s0, s1, z0, z1) => [[s0, z0, "c"], [s1, z0, "c"], [s1, z1, "c"], [s0, z1, "c"]];
const EC135_DETAIL = [
  ["hl", box(3.33, 3.552, 1.818, 1.906)], ["hl", box(3.944, 4.28, 1.489, 1.619)],
  ["hl", box(2.961, 3.301, 0.777, 0.904)], ["hl", box(3.794, 3.977, 0.581, 0.715)],
  ["hl", [[8.531, 2.298], [9.691, 2.298]], false],
  ["hl", [[8.058, 1.253], [8.45, 1.074], [8.776, 0.96], [9.005, 0.862], [9.364, 0.894], [9.625, 1.009], [9.847, 1.218]], false],
  ["strut", box(10.122, 10.167, 1.492, 1.616)], ["strut", box(10.167, 10.206, 1.518, 1.58)],
];
// From the side view in Airbus's ACH135 Technical Description 2023 (Figure 2.1, External dimensions;
// fitted to the 3-view's outline within about 0.1 m around the cowling): the louvred oval vent on top
// of the cowling (moved 0.13 m forward onto the 3-view's hump), the louvred grille panel on the
// cowling side in two panes, the two round vents, the four recessed footsteps up the side and the
// handle at the roof edge. EC135 only, like the detail above.
const EC135_ACH = [
  ["inlet", [[3.687, 2.235, "c"], [3.755, 2.315], [3.892, 2.346], [4.049, 2.329], [4.109, 2.251, "c"], [4.041, 2.162], [3.895, 2.13], [3.747, 2.158]]],
  ["hl", box(4.104, 4.389, 1.406, 1.998)], ["hl", [[4.101, 1.612], [4.395, 1.616]], false],
  ...[1.47, 1.53, 1.68, 1.75, 1.82, 1.89, 1.95].map((z) => ["hl", [[4.13, z], [4.36, z]], false]),
  ...[[2.993, 3.05, 1.616, 1.734], [3.631, 3.698, 1.566, 1.694], [3.809, 3.876, 1.451, 1.57], [4.528, 4.595, 1.187, 1.315]]
    .map(([s0, s1, z0, z1]) => ["inlet", box(s0, s1, z0, z1)]),
  ["door", box(3.506, 3.692, 2.064, 2.116)],
];
const EC135_ENDPLATE = [[8.07, 1.76, "c"], [7.73, 1.76, "c"], [7.51, 1.44, "c"], [7.86, 0.88, "c"], [8.18, 0.88, "c"], [8.05, 1.4]];
F.ec35 = {
  kind: "heli", L0: 10.2, over: 2.0, D: 1, W: 1.5,
  body: EC135_BODY,
  glass: EC135_GLASS,
  frame: 0.035,
  rotor: { s: 3.2, z: 2.65, mast: 0.15, d: 10.2 },
  extras: [paint(EC135_SEAMS), paint(EC135_DETAIL), paint(EC135_ACH),
    ({ sk }) => { sk.ellipse("hl", 3.598, 1.82, 0.098, 0.078); sk.ellipse("hl", 3.871, 1.217, 0.088, 0.059); }],
  overlays: [
    skids({ z: -0.42, t: 0.09, aft: 3.85, fwd: 1.2, toe: [0.95, -0.2], legs: [[1.53, 0.06, 1.53, 0.12], [3.53, 0.02, 3.53, 0.12]] }),
    // the long boarding step across the skid legs, and the dome over the rotor hub (3-view)
    paint([["skid", [[1.143, -0.102, "c"], [3.683, -0.102, "c"], [3.703, -0.079], [3.683, -0.056, "c"], [1.143, -0.056, "c"], [1.123, -0.079]]],
      ["hub", [[2.716, 2.667, "c"], [2.801, 2.746], [2.899, 2.804], [3.063, 2.873], [3.18, 2.886], [3.324, 2.857], [3.487, 2.785], [3.605, 2.706, "c"],
        [3.454, 2.71, "l"], [2.801, 2.697, "l"]]]]),
    fenestron(9.11, 1.63, 0.56, 0.2),
    // the horizontal stabiliser's starboard endplate, with its position light (3-view)
    paint([["stab", EC135_ENDPLATE]]),
    ({ sk }) => sk.ellipse("hl", 7.784, 1.407, 0.069, 0.025),
    // ACH135 Technical Description side view: the whip antenna on the boom, the two round fittings on
    // the boom's side, and the lights at the fin cap's front and aft corners
    paint([["strut", box(6.53, 6.55, 1.481, 1.882)], ["strut", box(9.339, 9.573, 3.29, 3.357)], ["strut", box(10.026, 10.09, 3.256, 3.32)]]),
    ({ sk }) => { sk.ellipse("hl", 6.369, 1.331, 0.039, 0.039); sk.ellipse("hl", 6.712, 1.336, 0.039, 0.039); },
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
      // from the 3-view: the engine cowling's front seam, the boom joint, the swashplate and its pitch link
      ["hl", [[4.199, 1.783], [4.199, 1.302]], false],
      ["hl", [[5.185, 1.446], [5.185, 0.941]], false],
      ["strut", box(2.602, 2.814, 1.87, 1.947)], ["strut", box(2.718, 2.785, 1.947, 2.014)],
      // traced from the US Army OH-58A (military 206A) technical-manual side view, keeping only what Bell's
      // 206B3 Product Specification side view (Jan 2004) also draws: the pitot tube ahead of the nose, the
      // latch on each cabin door and the doors' hinges, the baggage door behind the cabin with its hinges
      // and latches, and the line along the top of the boom
      ["strut", [[-0.316, 0.283, "c"], [-0.047, 0.29, "c"], [-0.046, 0.266, "c"], [-0.315, 0.259, "c"]]],
      ["door", [[1.675, 0.491, "c"], [1.778, 0.493, "c"], [1.78, 0.424, "c"], [1.677, 0.422, "c"]]],
      ["door", [[2.572, 0.536, "c"], [2.662, 0.539, "c"], [2.664, 0.449, "c"], [2.574, 0.447, "c"]]],
      ...[[[1.335, 1.027], [1.433, 0.974]], [[1.055, 0.411], [1.147, 0.358]], [[1.985, 1.004], [2.076, 0.958]],
        [[1.878, 0.4], [1.962, 0.354]]].map(([[s0, z1], [s1, z0]]) => ["strut", box(s0, s1, z0, z1)]),
      ["door", [[3.236, 0.762, "c"], [3.69, 0.816], [4.165, 0.864, "c"], [4.18, 0.837], [4.175, 0.27, "c"], [4.141, 0.242], [3.707, 0.216],
        [3.265, 0.217, "c"], [3.236, 0.258]]],
      ...[[3.238, 3.329, 0.638, 0.696], [3.234, 3.325, 0.265, 0.322], [4.079, 4.163, 0.71, 0.753], [4.07, 4.161, 0.295, 0.339]]
        .map(([s0, s1, z0, z1]) => ["strut", box(s0, s1, z0, z1)]),
      ["hl", [[5.182, 1.335], [6.852, 1.409], [7.955, 1.488]], false],
    ]),
  ],
  overlays: [
    skids({ z: -0.43, t: 0.1, aft: 3.5, fwd: 1.5, toe: [1.27, -0.3], legs: [[1.94, 0.0, 1.94, 0.15], [3.28, 0.04, 3.28, 0.15]] }),
    paint([
      // 3-view: the collar where the forward cross tube meets the belly, the saddle over the aft one
      ["skid", [[1.857, -0.002], [1.929, 0.032], [2.006, 0.032], [2.073, -0.002, "c"], [2.03, -0.103], [1.948, -0.088], [1.871, -0.103, "c"]]],
      ["skid", [[3.16, 0.07, "c"], [3.16, 0.08], [3.179, 0.148], [3.256, 0.181], [3.353, 0.176], [3.439, 0.138], [3.482, 0.09], [3.482, 0.07, "c"]]],
      // the teetering rotor head as the 3-view draws it: the hub block between the two blade grips
      ["hub", box(2.15, 2.564, 2.447, 2.601)], ["hub", box(2.843, 3.256, 2.447, 2.601)], ["hub", box(2.593, 2.795, 2.437, 2.639)],
      ["hl", box(2.419, 2.554, 2.456, 2.581)], ["hl", box(2.862, 2.977, 2.456, 2.581)],
    ]),
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
      // the five engine-air inlet grilles (3-view: five louvres each), the boom joint, the drive-shaft
      // cover along the boom, and the door handles under the windows
      ...[3.846, 4.046, 4.224, 4.398, 4.572].flatMap((s0) => [1.653, 1.611, 1.568, 1.526, 1.484].map((z) => ["hl", [[s0, z], [s0 + 0.128, z]], false])),
      ["hl", [[5.423, 1.428], [5.432, 0.945]], false],
      ["hl", [[5.422, 1.376], [9.023, 1.567]], false],
      ...[1.836, 2.519, 3.397].map((s0) => ["door", [[s0, 0.49, "c"], [s0 + 0.108, 0.49, "c"], [s0 + 0.108, 0.522, "c"], [s0, 0.522, "c"]]]),
      // from the side view in Bell's 407GXi Product Specifications ("Helicopter Dimensions", low skid
      // gear): the baggage door just behind the rear cabin door, the access panel framing the inlet
      // grilles with its three fasteners on the roof seam (Bell draws the grilles about 0.3 m further
      // forward than the 3-view does; the frame is drawn round the 3-view's grilles), and the curved
      // seam on the side of the transmission fairing
      ["door", [[3.731, 0.767, "c"], [4.562, 0.909, "c"], [4.588, 0.398, "c"], [3.75, 0.244, "c"]]],
      ["hl", [[3.792, 1.34], [3.778, 1.71]], false], ["hl", [[4.835, 1.34], [4.827, 1.62]], false],
      ...[3.83, 4.3, 4.77].map((s) => ["strut", box(s - 0.012, s + 0.012, 1.35, 1.38)]),
      ["hl", [[2.965, 1.81], [3.047, 1.743], [3.111, 1.645], [3.133, 1.566], [3.076, 1.494]], false],
    ]),
  ],
  overlays: [
    // the domed cap over the rotor hub (3-view)
    paint([["hub", [[2.177, 2.555, "c"], [2.377, 2.66], [2.64, 2.696], [2.903, 2.685], [3.113, 2.632], [3.27, 2.553, "cl"]]]]),
    skids({ z: -0.38, t: 0.1, aft: 4.14, fwd: 1.5, toe: [1.31, -0.18], legs: [[1.95, 0.0, 1.86, 0.13], [3.92, 0.06, 3.72, 0.13]] }),
    // the stabiliser's starboard endplate fin
    paint([["stab", [[7.54, 1.81, "c"], [7.32, 1.81, "c"], [7.0, 1.42, "c"], [7.32, 0.94, "c"], [7.65, 0.94, "c"], [7.41, 1.42, "c"]]]]),
    // from Bell's 407GXi specification side view: the saddles where the cross tubes meet the belly,
    // the two fittings on top of the skid tube between the legs, the position light on the endplate
    // and the light on top of the fin
    paint([["skid", [[1.825, 0.0, "c"], [2.075, 0.0, "c"], [2.04, -0.075, "c"], [1.865, -0.075, "c"]]],
      ["skid", [[3.81, 0.06, "c"], [4.03, 0.06, "c"], [3.99, -0.01, "c"], [3.85, -0.01, "c"]]],
      ...[2.92, 3.33].map((s) => ["strut", box(s - 0.012, s + 0.012, -0.285, -0.235)])]),
    ({ sk }) => { sk.ellipse("hl", 7.274, 1.366, 0.035, 0.025); sk.ellipse("hub", 9.66, 2.7, 0.035, 0.035); },
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
      // traced from the H125 side view in Airbus's "H125 Technical Description 2025": the seam between the
      // transmission and engine cowlings, the engine cowling's curved lower and aft edges, the frame behind
      // the cabin and its join to the boom, the drive-shaft cover along the boom with its joints and the
      // raised collar, the small fairing on the boom, the two recesses at the roof edge over the rear door
      // and the seam under them, and the baggage door with its latch
      ["hl", [[3.692, 2.108], [3.7, 1.614]], false],
      ["hl", [[2.542, 1.832], [3.054, 1.729], [3.424, 1.649], [3.582, 1.604], [3.844, 1.435], [4.003, 1.288], [4.122, 1.235, "l"],
        [4.616, 1.235, "c"], [4.838, 1.647]], false],
      ["hl", [[4.616, 1.235], [4.814, 1.159], [4.877, 1.137, "c"], [5.041, 1.194]], false],
      ["hl", [[4.877, 1.137], [4.894, 0.516]], false],
      ["hl", [[5.15, 1.251], [7.419, 1.293], [9.696, 1.343]], false],
      ...[[[5.146, 1.502], [5.15, 1.251]], [[6.529, 1.444], [6.532, 1.272]], [[7.981, 1.521], [7.984, 1.302]],
        [[9.088, 1.546], [9.091, 1.326]]].map((l) => ["hl", l, false]),
      ["fin", [[5.511, 1.256, "c"], [5.507, 1.57, "c"], [5.656, 1.573, "c"], [5.66, 1.258, "c"]]],
      ["stab", [[7.988, 1.09, "c"], [8.034, 1.13], [8.167, 1.139], [8.388, 1.111, "c"], [8.373, 1.064], [8.169, 1.037], [8.027, 1.051]]],
      ["inlet", [[2.803, 1.215, "c"], [2.833, 1.302], [2.942, 1.335], [3.053, 1.305], [3.093, 1.22, "c"]]],
      ["inlet", [[3.494, 1.226, "c"], [3.524, 1.312], [3.633, 1.346], [3.743, 1.316], [3.784, 1.23, "c"]]],
      ["hl", [[2.693, 1.206], [3.965, 1.225]], false],
      ["door", [[4.218, 1.119, "c"], [4.665, 1.126, "c"], [4.681, 0.568, "c"], [4.44, 0.431], [4.244, 0.42, "c"]]],
      ["door", [[4.104, 0.874, "c"], [4.206, 0.875, "c"], [4.208, 0.687, "c"], [4.106, 0.685, "c"]]],
    ]),
  ],
  overlays: [
    // the Starflex rotor head as the AS355 silhouette draws it: the star's legs, centre post and base
    // under the bar of the blade sleeves (with their slots) and the dome cap; and the small fitting on
    // the fin top
    paint([
      ["strut", box(3.188, 3.426, 2.189, 2.235)], ["strut", box(3.097, 3.516, 2.234, 2.306)], ["strut", box(3.239, 3.354, 2.235, 2.531)],
      ["strut", [[3.064, 2.531, "c"], [3.122, 2.531, "c"], [3.162, 2.305, "c"], [3.104, 2.305, "c"]]],
      ["strut", [[3.49, 2.532, "c"], [3.548, 2.532, "c"], [3.51, 2.306, "c"], [3.452, 2.306, "c"]]],
      ["hub", box(2.852, 3.992, 2.53, 2.681)],
      ["hl", box(2.929, 3.045, 2.556, 2.582)], ["hl", box(2.929, 3.045, 2.62, 2.646)],
      ["hl", box(3.567, 3.915, 2.558, 2.584)], ["hl", box(3.567, 3.915, 2.622, 2.649)],
      ["hub", [[3.012, 2.698, "c"], [3.115, 2.737], [3.309, 2.763], [3.502, 2.738], [3.592, 2.699, "cl"]]],
      ["strut", [[10.692, 2.686, "c"], [10.698, 2.737], [10.724, 2.744], [10.737, 2.686, "c"]]],
    ]),
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
      // more of the orthographic drawing: the wire-strike cutter ahead of the rotor pylon, the cabin
      // door's lower track fairing, the drive-shaft cover along the boom and up the tail pylon, and the
      // boom joint ahead of the pylon
      ["strut", [[3.544, 2.65, "c"], [3.878, 2.409, "c"], [3.89, 2.425, "c"], [3.556, 2.666, "c"]]],
      ["hl", [[5.512, 0.153, "c"], [6.335, 0.18], [6.576, 0.278], [6.915, 0.243, "c"], [6.625, 0.193], [6.262, 0.132], [5.513, 0.117, "c"]]],
      ["hl", [[8.192, 1.614], [12.113, 1.023]], false],
      ["hl", [[11.29, 1.141], [11.293, 0.258]], false],
      ["hl", [[12.741, 1.382, "c"], [12.923, 1.231, "c"], [14.357, 2.797]], false],
    ]),
  ],
  overlays: [
    // the elastomeric blade cuffs either side of the rotor hub (orthographic drawing)
    ({ sk }) => { sk.ellipse("hub", 3.688, 2.965, 0.15, 0.13); sk.ellipse("hub", 5.164, 3.018, 0.15, 0.13); },
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
    // more of the 3-view (placed through its round windows): the forward pylon's panel seam, the panel
    // line across the aft pylon, the seam from under the nacelle to the pylon's trailing edge, and the
    // blade under the nose
    ["hl", [[1.952, 3.08], [1.953, 2.46]], false],
    ["hl", [[11.921, 3.245], [14.725, 3.323]], false],
    ["hl", [[12.948, 2.196], [15.483, 1.813]], false],
    ["strut", [[2.153, 0.119, "c"], [2.387, 0.113, "c"], [2.319, -0.161], [2.77, -0.266, "c"], [2.19, -0.252, "c"]]],
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
      // the two small boxes under the nacelle (3-view)
      ["hl", [[12.061, 1.961, "c"], [12.477, 1.961, "c"], [12.477, 2.144, "c"], [12.061, 2.144, "c"]]],
      ["hl", [[12.472, 1.98, "c"], [12.851, 1.98, "c"], [12.851, 2.164, "c"], [12.472, 2.164, "c"]]],
    ]),
  ],
};

// ---------- Airbus Helicopters H145 (EC45) ----------
// Drawn as the H145 D-2/D-3 (fenestron, the variant now delivered to most US EMS operators),
// not the EC145 C-2 with its conventional tail rotor. No dimensioned drawing was reachable:
// the outline is the measured EC135 one (same design family: nose, cockpit, rear clamshell
// pod, boom, endplate stabiliser, fenestron fin) scaled to the H145's published size,
// fuselage 11.64 m (x1.14) and the deeper cabin (heights x1.1), checked by eye against the
// Commons photo "H145 Christoph 27 als D-HXFI.jpg". Rotor 10.8 m (Wikipedia H145 spec table),
// rotors-turning length 13.64 m. Lower confidence than the measured types.
const SX45 = 1.141, SZ45 = 1.1;
F.ec45 = {
  kind: "heli", L0: 11.55, over: 1.45, D: 1, W: 1.73,
  body: sc(EC135_BODY, SX45, SZ45),
  glass: EC135_GLASS.map((g) => sc(g, SX45, SZ45)),
  frame: 0.035,
  rotor: { s: 3.65, z: 2.95, mast: 0.18, d: 10.8 },
  extras: [paint(EC135_SEAMS.map(([c, pts, cl]) => [c, sc(pts, SX45, SZ45), cl]))],
  overlays: [
    skids({ z: -0.55, t: 0.1, aft: 4.45, fwd: 1.35, toe: [1.05, -0.3], legs: [[1.75, 0.06, 1.72, 0.13], [4.05, 0.02, 4.02, 0.13]] }),
    fenestron(9.11 * SX45, 1.63 * SZ45, 0.66, 0.22, 10),
    paint([["stab", sc(EC135_ENDPLATE, SX45, SZ45)]]),
  ],
};

// ---------- Robinson R66 Turbine (R66) ----------
// Reference: Robinson's R66 Pilot's Operating Handbook, Section 1, "R66 External Dimensions" (page 1-3,
// rev. 15 Aug 2023, from robinsonheli.com), side view traced at 400 dpi. The drawing is level and to
// scale: 354 in (8.99 m) from the nose to the tail, 72 in from the skid bottom to the roof, 60 in tail
// rotor, 459 in overall. It draws the left side, mirrored here. It replaces an outline traced from a
// photo. Traced: the windshield and its frames, the two doors with their windows and the small windows
// low in each, the door handle, the frame over the front door, the mast fairing with the collar at its
// foot, the engine cowling with its louvres, the air inlet on the engine bay, the aft fairing and its
// fitting, the two swept antennas and the fittings on the tail cone, the tail gearbox, the upper and
// lower fins, the horizontal stabiliser at the lower fin's foot, the tail-rotor guard tube and the tail
// skid, and the skids with their leg fittings.
F.r66 = {
  kind: "heli", L0: 8.997, over: 2.703, D: 1, W: 1.47,
  body: [[0.0,0.451,"c"], [0.013,0.572], [0.067,0.694], [0.236,0.889], [0.404,1.057], [0.62,1.185], [0.869,1.293], [1.091,1.354], [1.279,1.387], [1.549,1.414], [1.751,1.428], [1.886,1.441], [1.966,1.475], [2.034,1.562,"cl"], [2.202,2.66,"c"], [2.579,2.68,"cl"], [2.774,1.609,"c"], [2.842,1.569], [2.943,1.495], [3.064,1.461], [3.636,1.488,"l"], [8.013,1.818,"c"], [8.175,1.778], [8.175,1.683], [8.013,1.636,"c"], [7.239,1.529], [6.869,1.481,"l"], [4.242,1.044,"c"], [4.229,0.956], [4.175,0.795], [4.088,0.566], [4.034,0.418], [3.973,0.256,"c"], [3.838,0.215], [3.697,0.182], [3.522,0.135], [3.313,0.101], [3.111,0.054], [2.855,0.04], [2.532,0.027], [1.892,0.007], [1.704,0.0], [0.613,0.0], [0.458,0.02], [0.37,0.047], [0.229,0.108], [0.121,0.195], [0.034,0.283]],
  glass: [[[0.027,0.337,"c"], [0.0,0.465,""], [0.013,0.572,""], [0.067,0.694,""], [0.236,0.889,""], [0.404,1.057,""], [0.62,1.185,""], [0.869,1.293,""], [1.091,1.354,"c"], [0.714,0.498,"c"], [0.512,0.451,"c"]], [[1.118,1.205,"c"], [1.603,1.226,"c"], [1.441,0.673,"c"], [0.943,0.545,"c"]], [[1.724,1.219,"c"], [2.141,1.199,"c"], [2.101,0.808,"c"], [1.549,0.68,"c"]], [[0.768,0.465,"c"], [0.882,0.478,"c"], [0.808,0.303,"c"], [0.714,0.296,"c"]], [[1.535,0.633,"c"], [1.657,0.646,"c"], [1.603,0.444,"c"], [1.468,0.438,"c"]]],
  frame: 0.025,
  rotor: { s: 2.357, z: 2.936, mast: 0, d: 10.06 },
  extras: [
    mast(2.357, 2.68, 2.906, 0.12),
    // tail rotor on the port side: behind the fins in this view
    tail(8.162, 1.731, 1.52, 2, 140),
    paint([
      ["fin", [[8.047,1.818,"c"], [8.35,2.761,"c"], [8.559,2.754,"c"], [8.458,1.63,"c"]]],
      ["fin", [[8.013,1.636,"c"], [8.485,1.616,"c"], [8.552,1.118,"c"], [8.229,1.172,"c"]]],
      ["stab", [[8.35,1.064,"c"], [8.687,1.098], [8.997,1.125,"c"], [8.687,1.071], [8.384,1.037]]],
      ["strut", [[6.963,1.468,"c"], [7.01,1.293], [7.212,1.091], [7.508,1.024], [8.013,1.051], [8.35,1.071,"c"], [8.35,1.037,"c"], [8.013,1.017], [7.502,0.983], [7.185,1.057], [6.976,1.266], [6.929,1.468,"c"]]],
      ["strut", [[8.35,1.03,"c"], [8.788,0.855], [8.862,0.835,"c"], [8.862,0.808,"c"], [8.774,0.822], [8.337,0.997,"c"]]],
      ["strut", [[8.013,1.818,"c"], [8.114,1.845], [8.283,1.791], [8.296,1.67], [8.148,1.616], [8.013,1.636,"c"]]],
      ["door", [[1.077,1.239,"c"], [1.657,1.253,"c"], [1.374,0.397,""], [1.01,0.276,""], [0.721,0.182,""], [0.646,0.229,""], [0.62,0.283,""], [0.714,0.498,"c"], [1.077,1.239,"c"]]],
      ["door", [[1.697,1.246,"c"], [2.182,1.239,"c"], [2.182,0.579,""], [2.114,0.458,""], [1.67,0.249,""], [1.468,0.182,""], [1.387,0.195,""], [1.36,0.269,""], [1.401,0.404,"c"], [1.697,1.246,"c"]]],
      ["hl", [[1.111,1.347], [0.714,0.498]], false],
      ["hl", [[0.714,0.498], [0.512,0.451], [0.175,0.364], [0.027,0.337]], false],
      ["hl", [[1.091,1.354], [1.542,1.387], [1.414,1.407], [1.259,1.387], [1.091,1.354]], false],
      ["hl", [[2.034,1.582], [2.303,1.589], [2.545,1.589], [2.774,1.603]], false],
      ["hl", [[2.189,1.576], [2.182,1.36]], false],
      ["hl", [[1.886,1.428], [2.694,1.293], [3.717,1.118]], false],
      ["hl", [[3.65,1.428], [3.697,1.178]], false],
      ["hl", [[3.717,1.118], [4.081,1.077], [4.242,1.044]], false],
      ["inlet", [[3.131,1.36,"c"], [3.239,1.374,"c"], [3.259,1.226,"c"], [3.145,1.239,"c"]]],
      ["inlet", [[3.279,1.387,"c"], [3.394,1.401,"c"], [3.414,1.192,"c"], [3.306,1.212,"c"]]],
      ["inlet", [[3.434,1.407,"c"], [3.542,1.414,"c"], [3.589,1.165,"c"], [3.475,1.178,"c"]]],
      ["fin", [[2.902,1.044,"c"], [3.205,1.024,""], [3.219,0.97,""], [3.165,0.916,""], [2.923,0.875,"c"]]],
      ["fin", [[4.229,0.97,"c"], [4.269,0.956,"c"], [4.249,0.822,"c"], [4.209,0.835,"c"]]],
      ["strut", [[3.771,1.502,"c"], [4.074,1.939,"c"], [4.108,1.919,"c"], [3.859,1.508,"c"]]],
      ["strut", [[4.882,1.576,"c"], [5.205,2.027,"c"], [5.239,2.007,"c"], [4.97,1.582,"c"]]],
      ["fin", [[6.64,1.717,"c"], [6.653,1.825,"c"], [6.721,1.825,"c"], [6.734,1.717,"c"]]],
      ["fin", [[7.017,1.515,"c"], [7.024,1.63,"c"], [7.138,1.63,"c"], [7.138,1.515,"c"]]],
      ["fin", [[6.976,1.481,"c"], [7.118,1.522,""], [7.273,1.481,"c"], [7.118,1.434,""]]],
      ["strut", [[1.717,0.054,"c"], [1.758,0.088,"c"], [1.886,0.074,"c"], [1.886,0.034,"c"]]],
      ["strut", [[3.138,0.121,"c"], [3.165,0.148,"c"], [3.313,0.148,"c"], [3.313,0.101,"c"]]],
      ["inlet", [[1.178,0.215,"c"], [1.212,0.236], [1.266,0.215,"c"], [1.239,0.195]]],
    ]),
  ],
  overlays: [
    skids({ z: -0.438, t: 0.074, aft: 3.347, fwd: 1.024, toe: [0.761,-0.276], back: 0.02,
      legs: [[1.805, 0.074, 1.717, 0.155], [3.226, 0.135, 3.091, 0.155]] }),
  ],
};

// ---------- Robinson R44 Raven (R44) ----------
// Reference: Robinson's R44 Pilot's Operating Handbook, Section 1, "R44 External Dimensions" (page 1-3,
// rev. 26 Jan 2024, from robinsonheli.com), side view traced at 400 dpi. The drawing is level and to
// scale: 353 in (8.97 m) from the nose to the tail-rotor disc, 72 in from the skid bottom to the roof,
// 198 in rotor radius, 58 in tail rotor, 459 in overall. It draws the left side, mirrored here.
// It replaces an outline adapted from the R66 photo, which put the hub 0.2 m and the tail rotor 0.3 m
// too far aft, the tail rotor 0.35 m and the skids 0.16 m too low. Traced: the bubble windshield and its
// frames, the two doors with their windows, the frame over the front door, the tapered mast fairing with
// its vents and the pitot tube on its leading edge, the upper cowling's lower edge with the scoop and the
// louvred panel, the aft fairing and its fitting, the swept antenna and the fittings on the tail cone,
// the tail gearbox, the upper and lower fins, the horizontal stabiliser at the lower fin's foot, the
// tail-rotor guard tube and the tail skid, and the skids with their leg fittings.
// The R44 II shares the airframe (its POH page 1-3 draws the same side view).
F.r44 = {
  kind: "heli", L0: 8.965, over: 2.735, D: 1, W: 1.28,
  body: [[0.0,0.493,"c"], [0.018,0.628], [0.074,0.763], [0.154,0.88], [0.277,0.985], [0.413,1.096], [0.573,1.207], [0.64,1.231], [0.88,1.33], [1.09,1.379], [1.274,1.416], [1.533,1.428], [1.921,1.435], [2.056,1.422,"cl"], [2.235,2.512,"c"], [2.617,2.524,"cl"], [2.801,1.336,"cl"], [8.078,1.669,"c"], [8.121,1.589], [8.047,1.508,"cl"], [4.144,1.004,"cl"], [3.762,0.277,"c"], [3.602,0.234], [3.374,0.185], [3.152,0.129], [2.986,0.099], [2.506,0.074], [2.05,0.055], [1.755,0.037], [1.582,0.025], [1.348,0.018], [1.09,0.006], [0.757,0.0], [0.548,0.025], [0.4,0.055], [0.289,0.099], [0.179,0.166], [0.086,0.259], [0.025,0.369]],
  glass: [[[0.025,0.462,"c"], [0.018,0.628,""], [0.074,0.763,""], [0.154,0.88,""], [0.277,0.985,""], [0.413,1.096,""], [0.573,1.207,""], [0.88,1.33,""], [1.102,1.385,"c"], [0.659,0.486,"c"], [0.351,0.468,"c"]], [[1.225,1.256,"c"], [1.601,1.268,"c"], [1.422,0.72,"c"], [0.844,0.653,"c"]], [[1.755,1.238,"c"], [2.173,1.225,"c"], [2.13,0.794,"c"], [1.607,0.72,"c"]]],
  frame: 0.025,
  rotor: { s: 2.327, z: 2.771, mast: 0, d: 10.06 },
  extras: [
    mast(2.327, 2.524, 2.741, 0.11),
    // tail rotor on the port side: behind the fins in this view
    tail(8.22, 1.613, 1.49, 2, 144),
    paint([
      ["fin", [[8.14,1.699,"c"], [8.404,2.654,"c"], [8.614,2.648,"c"], [8.534,1.552,"c"]]],
      ["fin", [[8.053,1.502,"c"], [8.558,1.336,"c"], [8.651,0.96,"c"], [8.324,0.911,"c"]]],
      ["stab", [[8.386,0.93,"c"], [8.663,0.973], [8.995,1.016,"c"], [8.663,0.942], [8.417,0.893]]],
      ["strut", [[6.939,1.342,"c"], [7.074,1.225], [7.259,1.071], [7.493,0.948], [7.739,0.899], [8.17,0.905], [8.417,0.917,"c"], [8.417,0.88,"c"], [8.17,0.868], [7.727,0.862], [7.462,0.911], [7.222,1.041], [7.025,1.201], [6.902,1.33,"c"]]],
      ["strut", [[8.558,0.899,"c"], [8.817,0.739], [8.971,0.72,"c"], [8.971,0.696,"c"], [8.798,0.702], [8.54,0.868,"c"]]],
      ["strut", [[8.078,1.687,"c"], [8.183,1.724], [8.33,1.675], [8.355,1.552], [8.232,1.49], [8.047,1.508,"c"]]],
      ["door", [[1.121,1.299,"c"], [1.693,1.305,"c"], [1.391,0.437,""], [0.77,0.228,""], [0.634,0.259,""], [0.616,0.332,""], [1.121,1.299,"c"]]],
      ["door", [[1.705,1.299,"c"], [2.235,1.281,"c"], [2.198,0.536,""], [2.106,0.32,""], [1.558,0.179,""], [1.447,0.228,""], [1.435,0.308,""], [1.705,1.299,"c"]]],
      ["hl", [[1.108,1.391], [0.659,0.486]], false],
      ["hl", [[0.659,0.486], [0.351,0.468], [0.043,0.456]], false],
      ["hl", [[1.158,1.299], [0.696,0.406]], false],
      ["hl", [[1.108,1.385], [1.552,1.428], [1.595,1.41], [1.151,1.367], [1.108,1.385]], false],
      ["hl", [[2.056,1.422], [2.543,1.33], [3.122,1.213], [3.645,1.108], [4.144,1.01]], false],
      ["hl", [[3.676,1.071], [3.694,0.862], [3.984,0.813], [4.144,1.01]], false],
      ["hl", [[3.682,1.028], [4.064,0.973]], false],
      ["hl", [[3.688,0.96], [4.039,0.905]], false],
      ["hl", [[3.7,0.899], [4.014,0.844]], false],
      ["hl", [[2.494,2.494], [2.494,2.432]], false],
      ["hl", [[2.524,2.494], [2.524,2.432]], false],
      ["hl", [[2.561,2.494], [2.561,2.432]], false],
      ["hl", [[2.592,2.494], [2.592,2.432]], false],
      ["fin", [[3.122,1.213,"c"], [3.245,1.287,"c"], [3.337,1.281,"c"], [3.337,1.182,"c"]]],
      ["fin", [[3.86,0.462,"c"], [3.922,0.382,"c"], [3.805,0.363,"c"]]],
      ["strut", [[3.645,1.391,"c"], [3.971,1.841,"c"], [4.002,1.822,"c"], [3.737,1.391,"c"]]],
      ["strut", [[1.97,1.539,"c"], [2.063,1.527,"c"], [2.063,1.502,"c"], [1.97,1.515,"c"]]],
      ["strut", [[1.582,0.111,"c"], [1.73,0.135,"c"], [1.742,0.086,"c"], [1.582,0.074,"c"]]],
      ["strut", [[2.949,0.185,"c"], [3.128,0.215,"c"], [3.134,0.16,"c"], [2.949,0.142,"c"]]],
      ["fin", [[6.723,1.595,"c"], [6.742,1.699,"c"], [6.81,1.699,"c"], [6.828,1.595,"c"]]],
      ["fin", [[7.074,1.416,"c"], [7.074,1.515,"c"], [7.13,1.564,"c"], [7.185,1.515,"c"], [7.185,1.416,"c"]]],
      ["fin", [[6.927,1.355,"c"], [7.031,1.385,""], [7.136,1.355,"c"], [7.031,1.318,""]]],
    ]),
  ],
  overlays: [
    skids({ z: -0.406, t: 0.062, aft: 3.38, fwd: 0.936, toe: [0.677,-0.246], back: 0.02,
      legs: [[1.65, 0.031, 1.65, 0.135], [3.054, 0.135, 3.054, 0.135]] }),
  ],
};

// ---------- Robinson R22 Beta (R22) ----------
// Reference: Robinson's R22 Pilot's Operating Handbook, Section 1, "R22 External Dimensions" (page 1-3,
// from robinsonheli.com), side view traced at 400 dpi. The drawing is level and to scale: 259 in
// (6.58 m) from the nose to the tail-rotor disc, 42 in tail rotor, 25 ft 2 in rotor. It draws the left
// side, mirrored here. It replaces an outline scaled down from the R66 photo. Traced: the windshield
// bubble and its frames, the door with its window, the small window low in it and the handle and lock,
// the fitting at the top of the windshield, the mast fairing with its vents and pitot tube, the upper
// cowling's lower edge and the cabin's aft wall, the open engine bay (the crankcase and cylinders, the
// rocker covers, the frame tubes, the exhaust pipe, the drive pulley and the cooling fan's scroll), the
// tail cone's attachment frame and section joints, the fittings and fairing on the tail cone and the
// strut under it, the tail gearbox, the upper and lower fins and the tail skid, the front leg's fairing
// and the fitting on the skid.
F.r22 = {
  kind: "heli", L0: 6.52, over: 2.18, D: 1, W: 1.12,
  body: [[0.0,0.303,"c"], [0.015,0.425], [0.049,0.547], [0.107,0.669], [0.19,0.791], [0.293,0.903], [0.41,1.01], [0.556,1.113], [0.717,1.196], [0.888,1.254], [1.083,1.279], [1.279,1.288], [1.376,1.293,"cl"], [1.415,1.923,"c"], [1.732,1.923,"cl"], [1.854,1.22,"cl"], [2.352,1.122,"l"], [5.841,1.435,"c"], [5.944,1.396], [5.89,1.293,"cl"], [2.46,0.8,"cl"], [2.133,0.791,"cl"], [2.045,0.049,"cl"], [1.401,0.034], [1.083,0.02], [0.791,0.0], [0.644,0.0], [0.449,0.01], [0.254,0.034], [0.107,0.083], [0.034,0.156]],
  glass: [[[0.01,0.327,"c"], [0.015,0.425,""], [0.049,0.547,""], [0.107,0.669,""], [0.19,0.791,""], [0.293,0.903,""], [0.41,1.01,""], [0.556,1.113,""], [0.717,1.196,""], [0.888,1.254,""], [0.986,1.269,"c"], [0.605,0.41,"c"], [0.303,0.371,"c"]], [[1.015,1.122,"c"], [1.401,1.083,"c"], [1.405,0.791,""], [1.337,0.693,"c"], [0.742,0.595,"c"]], [[0.732,0.566,"c"], [0.844,0.566,"c"], [0.776,0.39,"c"], [0.649,0.376,"c"]]],
  frame: 0.02,
  rotor: { s: 1.532, z: 2.157, mast: 0, d: 7.67 },
  extras: [
    mast(1.532, 1.923, 2.127, 0.09),
    // tail rotor on the port side: behind the fins in this view
    tail(5.973, 1.386, 1.07, 2, 156),
    paint([
      ["fin", [[5.89,1.444,"c"], [6.022,1.84,"c"], [6.173,1.84,"c"], [6.1,1.366,"c"]]],
      ["fin", [[5.841,1.283,"c"], [6.1,1.327,"c"], [6.037,0.839,"c"], [5.88,0.839,"c"]]],
      ["strut", [[5.89,0.844,"c"], [5.973,0.771], [6.071,0.722], [6.12,0.722,"c"], [6.12,0.693,"c"], [6.061,0.693], [5.954,0.747], [5.871,0.825,"c"]]],
      ["strut", [[5.841,1.435,"c"], [5.924,1.444], [6.002,1.396], [5.993,1.318], [5.915,1.288], [5.866,1.293,"c"]]],
      ["door", [[1.01,1.244,"c"], [1.425,1.161,"c"], [1.405,0.791,""], [1.279,0.41,""], [0.717,0.19,""], [0.615,0.224,""], [0.586,0.303,""], [0.605,0.376,"c"], [1.01,1.244,"c"]]],
      ["hl", [[1.01,1.264], [0.605,0.41]], false],
      ["hl", [[0.01,0.303], [0.303,0.346], [0.62,0.376]], false],
      ["hl", [[1.454,0.693], [1.41,0.034]], false],
      ["hl", [[1.454,0.688], [1.767,0.732], [2.157,0.786], [2.352,0.805]], false],
      ["hl", [[2.206,0.791], [2.391,1.108], [2.464,0.8]], false],
      ["hl", [[2.255,0.547], [2.572,0.595]], false],
      ["hl", [[2.987,1.179], [2.987,0.877]], false],
      ["hl", [[3.44,1.22], [3.44,0.942]], false],
      ["hl", [[4.075,1.277], [4.075,1.033]], false],
      ["hl", [[4.695,1.332], [4.695,1.121]], false],
      ["hl", [[5.402,1.395], [5.402,1.223]], false],
      ["core", [[1.708,0.556,"c"], [2.089,0.615,"c"], [2.118,0.303], [2.059,0.117,"c"], [1.767,0.088,"c"], [1.62,0.205]]],
      ["fin", [[1.767,0.586,"c"], [1.972,0.595], [1.991,0.517], [1.937,0.459], [1.791,0.459,"c"]]],
      ["fin", [[1.986,0.595,"c"], [2.089,0.605], [2.108,0.527], [2.069,0.468], [2.001,0.468,"c"]]],
      ["strut", [[1.405,0.049,"c"], [1.669,0.581,"c"], [1.708,0.571,"c"], [1.444,0.034,"c"]]],
      ["strut", [[1.591,0.537,"c"], [1.62,0.551,"c"], [2.079,0.059,"c"], [2.04,0.044,"c"]]],
      ["strut", [[1.669,0.581,"c"], [2.108,0.654,"c"], [2.113,0.625,"c"], [1.688,0.551,"c"]]],
      ["strut", [[1.415,0.054,"c"], [2.059,0.088,"c"], [2.059,0.054,"c"], [1.415,0.024,"c"]]],
      ["strut", [[2.108,0.791,"c"], [2.147,0.791,"c"], [2.064,0.034,"c"], [2.025,0.034,"c"]]],
      ["strut", [[1.523,0.273,"c"], [2.167,0.298,"c"], [2.167,0.239,"c"], [1.523,0.234,"c"]]],
      ["fin", [[2.147,0.571,"c"], [2.279,0.581,"c"], [2.284,0.439,"c"], [2.152,0.429,"c"]]],
      ["fin", [[2.425,0.805,"c"], [2.625,0.805,"c"], [2.64,0.312,""], [2.586,0.264,"c"], [2.46,0.278,"c"]]],
      ["hl", [[2.557,0.732], [2.596,0.376]], false],
      ["inlet", [[0.556,1.083,"c"], [0.62,1.093,"c"], [0.625,1.035,"c"], [0.561,1.03,"c"]]],
      ["inlet", [[1.181,0.639,"c"], [1.24,0.639,"c"], [1.24,0.615,"c"], [1.181,0.615,"c"]]],
      ["fin", [[0.815,0.181,"c"], [0.859,0.205], [0.908,0.181,"c"], [0.859,0.156]]],
      ["fin", [[0.522,0.073,"c"], [0.644,0.166], [0.708,0.2], [0.791,0.205,"c"], [0.805,0.078,"c"], [0.683,0.063]]],
      ["inlet", [[1.571,1.879,"c"], [1.591,1.879,"c"], [1.591,1.806,"c"], [1.571,1.806,"c"]]],
      ["inlet", [[1.61,1.879,"c"], [1.63,1.879,"c"], [1.63,1.806,"c"], [1.61,1.806,"c"]]],
      ["inlet", [[1.649,1.879,"c"], [1.669,1.879,"c"], [1.669,1.806,"c"], [1.649,1.806,"c"]]],
      ["inlet", [[1.688,1.879,"c"], [1.708,1.879,"c"], [1.708,1.806,"c"], [1.688,1.806,"c"]]],
      ["strut", [[1.318,1.386,"c"], [1.381,1.386,"c"], [1.381,1.362,"c"], [1.318,1.362,"c"]]],
      ["fin", [[4.738,1.332,"c"], [4.743,1.415,"c"], [4.797,1.415,"c"], [4.802,1.337,"c"]]],
      ["fin", [[5.114,1.23,"c"], [5.114,1.288,"c"], [5.148,1.322,"c"], [5.183,1.288,"c"], [5.183,1.24,"c"]]],
      ["fin", [[5.075,1.191,"c"], [5.173,1.215,""], [5.28,1.2,"c"], [5.173,1.171,""]]],
      ["strut", [[5.329,1.24,"c"], [5.363,1.249,"c"], [5.466,1.015,"c"], [5.436,1.0,"c"]]],
      ["strut", [[1.84,-0.351,"c"], [1.845,-0.303,"c"], [1.893,-0.303,"c"], [1.898,-0.351,"c"]]],
      ["inlet", [[1.259,0.615,"c"], [1.274,0.63], [1.288,0.615,"c"], [1.274,0.6]]],
    ]),
  ],
  overlays: [
    skids({ z: -0.405, t: 0.054, aft: 2.255, fwd: 0.205, toe: [-0.063,-0.283], back: 0.02,
      legs: [[0.747, 0.078, 0.747, 0.063], [2.011, 0.049, 2.011, 0.063]] }),
  ],
};

// ---------- Sikorsky S-76 (S76) ----------
// Reference: Commons photo "N76FL 1988 Sikorsky S-76B C-N 760347 (7579663250).jpg", a side view in
// flight (starboard side), scaled to the 13.22 m fuselage (nose to fin); mast to tail-rotor hub
// then comes to 7.9 m, matching the 16.0 m rotors-turning length with the 13.41 m rotor and
// 2.44 m tail rotor (Wikipedia S-76 spec table) within 2 %. Shapes cross-checked with Commons
// "Sikorsky S-76D drawing.svg". Features: long sleek pointed nose, big cockpit and cabin windows,
// smooth engine/transmission cowling, deep boom sweeping up to the swept fin, small stabiliser,
// four-blade rotors, tail rotor on the port side; the gear retracts (main-gear doors under the
// cabin, nothing hanging in flight).
F.s76 = {
  kind: "heli", L0: 14.0, over: 2.0, D: 1, W: 2.13,
  body: [[0, 0.71], [0.15, 0.83], [0.5, 0.93], [1.0, 1.02], [1.3, 1.13], [1.6, 1.36], [1.9, 1.6], [2.2, 1.8], [2.6, 1.93],
    [3.0, 1.98], [3.4, 2.05], [3.7, 2.2], [4.0, 2.34], [4.3, 2.45], [4.6, 2.5], [5.5, 2.5], [6.2, 2.46], [7.0, 2.38],
    [7.6, 2.32, "c"], [7.75, 2.18], [7.88, 1.64], [8.1, 1.46], [9.0, 1.36], [10.0, 1.25], [11.0, 1.12], [11.33, 1.08, "l"],
    [12.57, 2.46], [13.0, 2.62], [13.42, 2.5, "c"], [12.25, 1.06, "c"], [12.18, 0.9], [11.5, 0.8], [10.6, 0.71], [9.08, 0.4],
    [8.4, 0.25], [7.7, 0.13], [6.76, 0.04], [6.0, 0.0], [2.0, 0.0], [1.33, 0.13], [0.9, 0.22], [0.56, 0.36], [0.25, 0.5], [0.08, 0.62]],
  glass: [
    [[2.19, 1.76], [1.75, 1.52], [1.33, 1.3], [2.1, 1.26]],
    round([[3.02, 1.86], [2.4, 1.86], [2.2, 1.28], [3.0, 1.26]], 0.1),
    round([[3.62, 1.8], [3.27, 1.8], [3.27, 1.3], [3.62, 1.3]], 0.08),
    round([[4.51, 1.76], [3.78, 1.76], [3.78, 1.22], [4.51, 1.22]], 0.1),
    round([[5.05, 1.65], [4.82, 1.65], [4.82, 1.18], [5.05, 1.18]], 0.06),
  ],
  frame: 0.03,
  rotor: { s: 4.82, z: 2.77, mast: 0.27, d: 13.41 },
  extras: [
    tail(12.77, 2.06, 2.44, 4, 30),
    paint([
      ["fin", [[11.36, 1.1, "l"], [12.57, 2.46], [13.0, 2.62], [13.42, 2.5, "c"], [12.25, 1.06, "c"]]],
      ["fin", [[12.6, 2.4], [12.75, 2.55], [13.05, 2.55], [13.0, 2.38]]],
      ["door", round([[3.12, 1.95], [2.15, 1.95], [1.95, 0.25], [3.12, 0.2]], 0.06)],
      ["door", round([[4.65, 1.9], [3.2, 1.9], [3.2, 0.2], [4.65, 0.2]], 0.06)],
      ["hl", [[3.7, 2.2], [7.6, 2.12]], false],
      ["inlet", [[7.62, 2.15, "c"], [7.78, 2.15, "c"], [7.8, 1.7, "c"], [7.64, 1.75, "c"]]],
      ["inlet", [[4.6, 2.3], [5.0, 2.32], [5.0, 2.12], [4.6, 2.12]]],
      ["fin", [[3.4, 0.05], [3.55, -0.13], [4.35, -0.15], [4.48, 0.05]]],
    ]),
  ],
  overlays: [paint([["stab", aero(11.5, 1.12, 12.32, 1.02, 0.1)]])],
};

// ---------- Leonardo AW139 (A139) ----------
// Reference: Commons "AW-139.jpg" (3-view line drawing; side view traced, scaled so mast to
// tail-rotor hub is 8.4 m: 16.66 m rotors turning, 13.80 m rotor, 2.7 m tail rotor from the
// Wikipedia AW139 spec table; nose to fin then comes to 13.65 m against the published 13.77 m).
// Features: long pointed nose with chin windows, tall windscreen, cockpit door and three square
// cabin windows in the big sliding door, aft cabin window, high engine cowling with the side
// intakes and exhausts, boom with the long strake rising into the swept fin with the tail-rotor
// gearbox fairing on top, stabiliser low on the boom end, five-blade rotor, four-blade tail
// rotor on the port side, sponsons for the retractable main gear (retracted in flight).
F.a139 = {
  kind: "heli", L0: 14.25, over: 2.35, D: 1, W: 2.26,
  body: [[0, 0.38], [0.24, 0.59], [0.52, 0.73], [0.91, 0.87, "l"], [1.22, 1.12], [1.5, 1.36], [1.78, 1.61], [1.99, 1.71],
    [2.48, 1.91], [3.18, 2.13], [3.62, 2.3], [3.76, 2.6], [3.85, 2.74], [4.1, 2.76], [6.0, 2.76], [6.82, 2.59], [7.17, 2.45],
    [7.52, 2.33], [8.01, 2.13], [8.22, 2.06], [11.4, 1.98], [11.71, 2.13, "l"], [12.59, 3.11], [12.83, 3.32], [13.4, 3.28],
    [13.64, 3.1, "c"], [13.46, 3.0], [13.04, 2.41, "l"], [12.69, 1.71], [12.66, 1.5, "c"], [12.2, 1.4], [11.01, 1.05], [9.62, 0.87],
    [8.22, 0.73], [7.52, 0.52], [6.82, 0.24], [6.22, 0.0], [0.87, 0.0], [0.52, 0.07], [0.24, 0.21], [0.07, 0.31]],
  glass: [
    [[1.98, 1.66], [1.0, 0.97], [1.22, 0.74], [1.6, 0.73], [1.8, 1.0, ""]],
    [[1.48, 0.48], [1.0, 0.45], [0.97, 0.15], [1.2, 0.06], [1.45, 0.15]],
    round([[2.5, 1.42], [2.12, 1.42], [1.96, 0.78], [2.5, 0.76]], 0.07),
    round([[5.03, 1.43], [4.41, 1.43], [4.41, 0.74], [5.03, 0.74]], 0.1),
    round([[4.2, 1.43], [3.57, 1.43], [3.57, 0.74], [4.2, 0.74]], 0.1),
    round([[3.26, 1.43], [2.73, 1.43], [2.73, 0.74], [3.26, 0.74]], 0.1),
    round([[7.6, 1.38], [6.66, 1.38], [6.66, 0.74], [7.6, 0.74]], 0.08),
  ],
  frame: 0.03,
  rotor: { s: 4.55, z: 3.14, mast: 0.38, d: 13.8 },
  extras: [
    tail(12.9, 3.3, 2.7, 4, 30),
    paint([
      ["fin", [[11.74, 2.15, "l"], [12.59, 3.11], [12.83, 3.32], [13.4, 3.28], [13.64, 3.1, "c"], [13.46, 3.0], [13.04, 2.41, "l"],
        [12.69, 1.71], [12.66, 1.5, "c"], [12.2, 1.6]]],
      ["fin", [[12.8, 3.3], [12.86, 3.55], [12.95, 3.55], [13.05, 3.3]]],
      ["door", [[2.55, 1.55, "c"], [1.75, 1.55, "c"], [1.62, 0.21, "c"], [2.55, 0.21, "c"]]],
      ["door", round([[5.1, 1.53], [3.46, 1.53], [3.46, 0.18], [5.1, 0.18]], 0.06)],
      ["hl", [[2.5, 1.79], [8.22, 1.79]], false],
      ["hl", [[8.22, 2.06], [8.22, 0.73]], false],
      ["hl", [[6.2, 1.79], [6.2, 0.2]], false],
      ["hl", [[8.3, 1.72], [11.9, 1.72]], false],
      ["door", [[6.3, 2.48, "c"], [5.95, 2.48, "c"], [5.95, 1.9, "c"], [6.3, 1.9, "c"]]],
      ...[2.05, 2.2, 2.35].map((z) => ["hl", [[5.97, z], [6.28, z]], false]),
      ["inlet", [[7.3, 2.05], [7.6, 2.28], [7.95, 2.1], [7.65, 1.85]]],
      ["fin", [[4.95, 0.02], [4.97, 0.22], [5.15, 0.3], [6.2, 0.3], [6.36, 0.15], [6.3, 0.0]]],
    ]),
  ],
  overlays: [paint([["stab", aero(11.45, 1.52, 12.25, 1.45, 0.2)]])],
};

export const families = F;
export const types = {
  EC35: "ec35", B06: "b06", B407: "b407", AS50: "as50", H60: "h60", H47: "h47",
  EC45: "ec45", R22: "r22", R44: "r44", R66: "r66", S76: "s76", A139: "a139",
};
