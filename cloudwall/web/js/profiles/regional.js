// Regional jets: CRJ, ERJ, E-Jets. Format: see ../profiles.js.
const F = {};

// ---------- helpers drawn through the extras hook (see silhouette.js) ----------
// d: metres forward of the tail-cone end; z: metres above the keel.
// A rectangular door outline the renderer's own door kinds can't place (under-floor cargo doors).
const hatch = (s, w, z0, h, cargo = true) => (k) => {
  const [x, y] = k.sk.xy(k.at(s) + w / 2, z0 + h);
  k.sk.out.push(`<rect class="door${cargo ? " cargo" : ""}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h.toFixed(2)}" rx="${Math.min(0.15, w / 4)}"/>`);
};
// A dorsal fin ahead of the fin's leading edge: [d, z, flag] points from the fuselage top up to
// the leading edge. Filled without an outline so it merges with the fin, then outlined on top.
const dorsal = (pts) => (k) => {
  const { sk, top } = k;
  const P = pts.map(([d, z, fl]) => [k.L - d, z, fl]);
  const a = P[0][0], [b, zb] = P[P.length - 1], fin = k.f.fin, s0 = k.L - fin.le, sw = k.tan(fin.sweep);
  const back = [];
  for (let i = 0; i <= 8; i++) { const s = k.lerp(s0 + 0.35, a, i / 8); back.push([s, top(s) + 0.03, "l"]); }
  sk.smooth("fin", [[a, top(a) + 0.03, "cl"], ...P.slice(1, -1), [b, zb, "cl"], [b + 0.3, zb - 0.3 / sw, "l"], ...back], true, ` style="stroke:none"`);
  sk.smooth("fin", [[a, top(a), "c"], ...P.slice(1)], false, ` style="fill:none"`);
};
// A T-tail's fin-top fairing (bullet), drawn behind the tailplane: [d, z, flag] closed outline.
const cap = (pts) => (k) => k.sk.smooth("fin", pts.map(([d, z, fl]) => [k.L - d, z, fl]));
// A belly fairing longer than the renderer's own (which starts just ahead of the wing): rebuilds
// the fuselage outline with a bulge through [s, z] points (s from the wing root leading edge,
// front to back, z metres below the keel as negatives). Use with fair: 0.
const belly = (pts) => (k) => {
  const { f, sk, D, L } = k, le = f.wing.le + (L - f.L0) * (f.fwd ?? 0.5), out = [[0, f.nose.tip * D, f.nose.tipFlag]];
  f.nose.top.forEach(([s, z, fl], i, a) => out.push([s * D, z * D, i === a.length - 1 ? "l" : fl]));
  f.tail.top.forEach(([s, z, fl], i, a) => out.push([L - s * D, z * D, i === a.length - 1 ? "cl" : fl]));
  const bot = f.tail.bot.map(([s, z, fl]) => [L - s * D, z * D, fl]).reverse();
  bot[0][2] = "c";
  bot[bot.length - 1][2] = "l";
  out.push(...bot, ...pts.slice().reverse().map(([s, z], i, a) => [le + s, z, i === a.length - 1 ? "l" : ""]));
  f.nose.bot.slice().reverse().forEach(([s, z, fl]) => out.push([s * D, z * D, fl]));
  const d = sk.curve(out);
  sk.out = sk.out.map((e) => (/^<path class="(hull|shade)"/.test(e) ? e.replace(/ d="[^"]*"/, ` d="${d}"`) : e));
};
// A panel line [s, z, flag] (s < 0 from the tail end), e.g. a wing-root fairing.
const seam = (pts, closed = true) => (k) => k.sk.smooth("hl", pts.map(([s, z, fl]) => [k.at(s), z, fl]), closed);
// The exhaust of a rear-mounted fan whose core cowl is fatter than the renderer's stock one:
// a tapered cowl from the fan nozzle (fraction fx, half-height r0 of the nacelle radius) to the
// core nozzle (cx, r1 >= 0.44), then the plug to the tip, its lower edge drooping by dz metres.
// Drawn as an overlay, it covers the stock core and plug.
const exhaust = (r0, r1, dz = 0) => (k) => {
  const e = k.f.eng, s0 = k.L - e.aft.s, zc = e.aft.z * k.D, R = e.dia / 2, S = (u) => s0 + u * e.len;
  const pz = Math.max(0.34, r1 * 0.62);
  k.sk.poly("core", [[S(e.fx), zc + r0 * R], [S(e.cx), zc + r1 * R], [S(e.cx), zc - r1 * R], [S(e.fx), zc - r0 * R]]);
  k.sk.poly("plug", [[S(e.cx), zc + pz * R], [S(1), zc + 0.03 * R], [S(1), zc - dz - 0.03 * R], [S(e.cx), zc - pz * R]]);
};

// ---------- Bombardier CRJ ----------
// CRJ900 (CL-600-2D24): Bombardier Airport Planning Manual CSP C-020, fig. 00-02-02 Figure 5
// sheet 1 (side and plan views, page 12 of 00-02-02; PDF p. 40), levelled by 1.97 deg (the figure
// is drawn at the static ground attitude), and Table 1 (fuselage 33.50 m, overall 36.24 m,
// diameter 2.69 m, stabiliser span 8.54 m). Long pointed nose, small flight-deck panes in a band,
// two Type III overwing exits per side, CF34-8C5 on the rear fuselage, stepped dorsal fin,
// T-tail with a large fin-top fairing and slight anhedral; canted winglets.
const CRJ_NOSE = {
  tip: 0.268,
  top: [[0.037, 0.31], [0.1, 0.346], [0.2, 0.413], [0.3, 0.476], [0.4, 0.528], [0.5, 0.584], [0.6, 0.639], [0.7, 0.699],
    [0.8, 0.766], [0.9, 0.829], [1.0, 0.885], [1.1, 0.922], [1.2, 0.952], [1.3, 0.974], [1.4, 0.993], [1.55, 1]],
  bot: [[0.037, 0.204], [0.074, 0.178], [0.149, 0.149], [0.223, 0.126], [0.297, 0.102], [0.372, 0.082], [0.465, 0.061],
    [0.65, 0.033], [0.743, 0.012], [0.93, 0]],
};
const CRJ_TAIL = {
  top: [[2.33, 1], [2.07, 0.974], [1.327, 0.898], [0.584, 0.816], [0.212, 0.768], [0.063, 0.73], [0, 0.717]],
  bot: [[3.07, 0], [2.81, 0.004], [2.44, 0.026], [2.07, 0.061], [1.7, 0.123], [1.33, 0.208], [0.955, 0.286], [0.584, 0.372],
    [0.398, 0.422], [0.212, 0.48], [0.119, 0.513], [0.063, 0.541], [0, 0.558]],
};
// the wing-root fairing seam is placed from the wing root leading edge so that it follows the
// wing when the fuselage is stretched
const wingSeam = (pts) => (k) => {
  const le = k.f.wing.le + (k.L - k.f.L0) * (k.f.fwd ?? 0.5);
  k.sk.smooth("hl", pts.map(([s, z, fl]) => [le + s, z, fl]), false);
};
const CRJ9_EXTRAS = [hatch(10.12, 1.07, 0.03, 0.47), hatch(12.96, 1.06, 0.03, 0.47), hatch(-7.31, 1.1, 0.74, 0.84),
  dorsal([[4.75, 0], [4.75, 2.86, "c"], [4.5, 2.97], [3.77, 3.03], [3.32, 3.2], [2.97, 3.47]]),
  cap([[1.27, 5.05, "c"], [0.75, 5.5], [0.3, 5.65], [-1.0, 5.52], [-1.75, 5.3], [-1.98, 5.08, "c"], [-1.0, 4.79], [0.3, 4.8]]),
  wingSeam([[-1.79, 0.15], [-1.24, 0.55], [0.06, 0.78], [1.86, 0.8], [5.86, 0.79], [7.36, 0.68], [8.16, 0.34], [8.48, 0.12]]),
  // ventral strakes under the tail cone (CRJ900 only)
  seam([[-6.0, 0.33, "c"], [-4.6, 0.52], [-3.1, 0.79, "c"], [-3.6, 0.6], [-4.6, 0.42]])];
F.crj9 = {
  kind: "regional", L0: 33.55, over: 2.69, D: 2.69, W: 2.69, fwd: 0.59, fair: 0.167, fairAft: 1.69,
  nose: CRJ_NOSE,
  tail: CRJ_TAIL,
  glass: [
    [[0.825, 0.639], [0.971, 0.78], [1.253, 0.78], [1.253, 0.639]],
    [[0.825, 0.636], [0.971, 0.783], [0.852, 0.789], [0.596, 0.634]],
  ],
  frame: 0.035,
  floor: 0.227,
  doors: [[4.74, 0.93], [1.6, 0.51, "E", "w"], [2.64, 0.51, "E", "w"]],
  extras: CRJ9_EXTRAS,
  overlays: [exhaust(0.78, 0.58, 0.12)],
  win: [{ z: 0.656, from: 5.8, to: -8.6, pitch: 0.789, w: 0.23, h: 0.31 }],
  wing: { le: 15.64, span: 23.0, cr: 4.93, kink: [0.36, 3.07], ct: 1.4, sweep: 30, dih: 2, z: 0.06, t: [0.12, 0.1] },
  tip: { h: 1.1, sweep: 56, top: 0.31, base: 0.72, blend: 0.15 },
  ftf: [0.22, 0.45],
  eng: { kind: "fan", aft: { s: 7.9, z: 0.766 }, len: 3.91, dia: 1.56, fx: 0.563, cx: 0.852 },
  fin: { le: 3.94, cr: 3.0, ct: 2.54, h: 2.31, sweep: 43.8, rudder: 0.72 },
  stab: { le: 1.12, z: "T", drop: 0.02, span: 8.54, root: 0.3, cr: 2.5, ct: 0.9, sweep: 35.5, dih: -3.5 },
};

// CRJ200 (CL-600-2B19): Bombardier Airport Planning Manual CSP A-020, 00-02-01 Figure 2
// (General Airplane Dimensions, metric; side and plan views): fuselage 24.38 m, overall 26.77 m,
// span 21.23 m, stabiliser span 6.20 m. Same Challenger-derived nose and flight deck as the
// CRJ700/900, but a slightly shallower fuselage with the cabin floor (and so the windows) lower,
// one Type III overwing exit per side, the small slat-less wing with short upright winglets,
// smaller CF34-3B1 nacelles with a drooped exhaust, a smaller dorsal fin and a flat tailplane.
F.crj2 = {
  kind: "regional", L0: 24.3, over: 2.47, D: 2.64, W: 2.69, fair: 0.08, fairAft: 1.68,
  nose: {
    tip: 0.237,
    top: [[0.038, 0.297], [0.114, 0.343], [0.189, 0.398], [0.265, 0.443], [0.341, 0.492], [0.417, 0.532], [0.492, 0.572],
      [0.568, 0.615], [0.644, 0.664], [0.72, 0.712], [0.795, 0.761], [0.871, 0.804], [0.947, 0.85], [1.023, 0.896],
      [1.098, 0.924], [1.174, 0.947], [1.25, 0.97], [1.326, 0.987], [1.42, 1]],
    bot: [[0.038, 0.218], [0.095, 0.163], [0.17, 0.129], [0.246, 0.106], [0.322, 0.086], [0.398, 0.066], [0.473, 0.051],
      [0.549, 0.04], [0.625, 0.029], [0.701, 0.017], [0.777, 0.011], [0.852, 0.009], [1.0, 0]],
  },
  tail: {
    top: [[1.894, 1], [1.617, 0.958], [1.239, 0.928], [0.86, 0.879], [0.481, 0.837], [0.178, 0.818], [0.064, 0.805], [0, 0.775]],
    bot: [[2.83, 0], [2.375, 0.019], [1.996, 0.057], [1.617, 0.119], [1.239, 0.193], [0.86, 0.263], [0.67, 0.313], [0.481, 0.358],
      [0.292, 0.415], [0.178, 0.472], [0.102, 0.574], [0.064, 0.623], [0.027, 0.68], [0, 0.733]],
  },
  glass: [
    [[0.894, 0.646], [1.013, 0.775], [1.28, 0.775], [1.28, 0.646]],
    [[0.894, 0.643], [1.013, 0.778], [0.84, 0.778], [0.68, 0.643]],
  ],
  frame: 0.035,
  floor: 0.223,
  doors: [[4.77, 0.93]],
  extras: [hatch(11.09, 0.52, 1.19, 0.92, false),
    dorsal([[4.22, 0], [4.22, 2.735, "c"], [3.77, 2.745], [3.27, 2.77], [3.07, 2.855], [2.89, 3.03]]),
    cap([[0.97, 5.0, "c"], [0.67, 5.22], [0.17, 5.34], [-0.48, 5.33], [-0.98, 5.25], [-1.48, 5.13], [-1.93, 5.02, "c"], [-1.23, 4.86], [0.27, 4.8]]),
    seam([[8.35, 0.06], [8.9, 0.43], [10.0, 0.68], [11.0, 0.72], [15.6, 0.72], [16.3, 0.63], [16.6, 0.36], [17.0, 0.07]], false)],
  overlays: [exhaust(0.725, 0.45, 0.3)],
  win: [{ z: 0.614, from: 5.9, to: 14.9, pitch: 0.746, w: 0.27, h: 0.35 }],
  wing: { le: 10.35, span: 20.6, cr: 3.95, kink: [0.3, 2.56], ct: 1.25, sweep: 28, dih: 2, z: 0.114, t: [0.12, 0.1] },
  tip: { h: 1.12, sweep: 42, top: 0.31, base: 0.7, blend: 0.12 },
  ftf: [0.3, 0.55],
  eng: { kind: "fan", aft: { s: 7.39, z: 0.754 }, len: 4.57, dia: 1.42, fx: 0.497, cx: 0.84 },
  fin: { le: 3.45, cr: 3.05, ct: 2.53, h: 2.21, sweep: 44.6, rudder: 0.72 },
  stab: { le: 0.2, z: "T", drop: -0.1, span: 6.2, root: 0.3, cr: 1.9, ct: 0.85, sweep: 33, dih: 0 },
};

// CRJ700 (CL-600-2C10): no planning manual found online (the CRJ700 APM is not on Bombardier's
// public site). Drawn as the CRJ900 shortened by the forward and aft fuselage plugs (Wikipedia
// "Bombardier CRJ700 series": length 32.3 m, span 23.2 m): same nose, section, lowered floor,
// slatted wing, CF34-8C, fin and tailplane; the wing without the CRJ900's 0.8 m tip extensions,
// one overwing exit per side instead of two, one forward cargo door and no ventral strakes.
F.crj7 = {
  ...F.crj9,
  doors: [[4.74, 0.93], [1.6, 0.51, "E", "w"]],
  extras: [CRJ9_EXTRAS[0], CRJ9_EXTRAS[2], CRJ9_EXTRAS[3], CRJ9_EXTRAS[4], CRJ9_EXTRAS[5]],
  wing: { ...F.crj9.wing, span: 21.4, kink: [0.39, 3.07], ct: 1.6 },
};

// ---------- Embraer ERJ ----------
// ERJ-145 (EMB-145 EP/ER/EU/LR/LU/MP/MK): Embraer Airport Planning Manual APM-145/1100,
// Figure 2.2.1 (EMB-145 Airplane General Dimensions; side and plan views): overall length
// 29.87 m, fuselage 27.93 m, diameter 2.28 m, span 20.04 m, tailplane span 7.55 m. Very long,
// low, pointed nose with a stepped windscreen; slim fuselage; one overwing exit per side;
// long belly fairing; Rolls-Royce AE3007 in long, slender mixed-flow nacelles; long straight
// dorsal ramp into a swept fin; T-tail with a pointed fin-top fairing. No winglets (the XR's
// winglets are left out; most ERJ-145s have none).
const ERJ_TAIL = {
  top: [[1.803, 1], [1.496, 0.971], [1.276, 0.954], [1.057, 0.932], [0.838, 0.906], [0.618, 0.871], [0.399, 0.836],
    [0.18, 0.796], [0.048, 0.768], [0, 0.763]],
  bot: [[2.241, 0], [2.154, 0.009], [1.934, 0.033], [1.715, 0.068], [1.496, 0.11], [1.276, 0.164], [1.057, 0.23],
    [0.838, 0.296], [0.618, 0.379], [0.399, 0.463], [0.18, 0.564], [0.048, 0.629], [0, 0.645]],
};
F.e145 = {
  kind: "regional", L0: 27.91, over: 1.96, D: 2.28, W: 2.28, fwd: 0.568, fair: 0,
  nose: {
    tip: 0.158,
    top: [[0.022, 0.184], [0.044, 0.202], [0.088, 0.237], [0.132, 0.268], [0.197, 0.305], [0.263, 0.34], [0.351, 0.379],
      [0.439, 0.423], [0.526, 0.458], [0.636, 0.5], [0.746, 0.538], [0.855, 0.577], [0.965, 0.611], [1.075, 0.645, "c"],
      [1.14, 0.693], [1.206, 0.737], [1.272, 0.781], [1.36, 0.844], [1.447, 0.897], [1.535, 0.941], [1.623, 0.969],
      [1.711, 0.989], [1.82, 1]],
    bot: [[0.022, 0.125], [0.044, 0.112], [0.088, 0.094], [0.132, 0.083], [0.197, 0.072], [0.263, 0.059], [0.351, 0.04],
      [0.439, 0.033], [0.526, 0.022], [0.636, 0.017], [0.746, 0.012], [0.855, 0.007], [1.075, 0]],
  },
  tail: ERJ_TAIL,
  glass: [
    [[1.333, 0.627], [1.487, 0.82], [1.667, 0.811], [1.667, 0.575]],
    [[1.333, 0.627], [1.487, 0.82], [1.338, 0.842], [1.088, 0.649]],
  ],
  frame: 0.035,
  floor: 0.197,
  doors: [[1.6, 0.51, "E", "w"]],
  extras: [
    belly([[-2.9, 0], [-2.2, -0.1], [-1.2, -0.27], [-0.2, -0.41], [1.3, -0.47], [2.8, -0.46], [3.8, -0.43], [4.8, -0.33],
      [5.8, -0.185], [6.8, -0.045], [7.4, 0]]),
    hatch(4.85, 0.78, 0.4, 1.72, false), hatch(-5.365, 1.0, 0.22, 1.0),
    dorsal([[6.16, 0], [4.91, 2.505], [3.41, 2.775], [2.91, 2.865], [2.55, 3.0], [2.31, 3.15], [2.08, 3.42]]),
    cap([[1.19, 4.53, "c"], [0.96, 4.85], [0.81, 5.03], [0.21, 5.09], [-0.59, 5.1], [-1.39, 5.02], [-1.96, 4.96, "c"],
      [-1.59, 4.83], [-1.09, 4.55], [-0.59, 4.44], [0.41, 4.47]]),
    wingSeam([[-2.95, 0.05], [-2.6, 0.38], [-2.2, 0.52], [-1.2, 0.655], [0.8, 0.725], [2.8, 0.725], [4.8, 0.685], [5.8, 0.5],
      [6.3, 0.4], [6.8, 0.28], [7.3, 0.1]])],
  win: [{ z: 0.636, from: 6.05, to: -8.21, pitch: 0.803, w: 0.3, h: 0.34 }],
  wing: { le: 13.2, span: 20.04, cr: 4.28, kink: [0.288, 2.91], ct: 1.04, sweep: 26.3, dih: 3, z: 0.066, t: [0.13, 0.1] },
  ftf: [0.3, 0.5, 0.68],
  eng: { kind: "fan", aft: { s: 7.47, z: 0.741 }, len: 4.6, dia: 1.53, style: "long", fx: 0.944, plug: 0.42 },
  fin: { le: 3.07, cr: 2.86, ct: 2.15, h: 2.27, sweep: 38.7 },
  stab: { le: 0.73, z: "T", drop: -0.23, span: 7.55, root: 0.3, cr: 1.84, ct: 0.95, sweep: 22.5, dih: 0 },
};

// ---------- Embraer E-Jets ----------
// Shared double-bubble fuselage (3.35 m high, 3.01 m wide), nose, flight deck, doors and tail
// cone, traced from the E-Jets E2 Airport Planning Manual APM-5824, Figure 2.1 (EMBRAER 190-E2
// General Aircraft Dimensions) and Figure 2.19 (cross-section). The E190 APM-1901 Figure 2.1 is
// drawn about 9 % squashed vertically (its fuselage measures 3.06 m), so its heights were
// rescaled by 3.35/3.06 before use.
const EJ_NOSE = {
  tip: 0.239,
  top: [[0.012, 0.28], [0.045, 0.312], [0.075, 0.342], [0.119, 0.378], [0.179, 0.424], [0.239, 0.476], [0.299, 0.518],
    [0.388, 0.572], [0.478, 0.616], [0.597, 0.7], [0.716, 0.788], [0.836, 0.86], [0.955, 0.909], [1.075, 0.945],
    [1.194, 0.966], [1.343, 0.982], [1.493, 0.993], [1.642, 1]],
  bot: [[0.012, 0.2], [0.045, 0.172], [0.075, 0.154], [0.119, 0.133], [0.179, 0.113], [0.239, 0.096], [0.299, 0.082],
    [0.388, 0.066], [0.478, 0.051], [0.597, 0.034], [0.716, 0.031], [0.836, 0.024], [0.955, 0.016], [1.075, 0.013],
    [1.194, 0.01], [1.343, 0.004], [1.493, 0]],
};
// high, nearly straight upper line and a strongly upswept underside to the APU exhaust
const EJ_TAIL = {
  top: [[2.776, 1], [2.627, 0.993], [2.478, 0.988], [2.328, 0.979], [2.179, 0.973], [1.881, 0.96], [1.582, 0.946],
    [1.284, 0.928], [0.985, 0.915], [0.388, 0.888], [0.239, 0.876], [0.149, 0.872], [0.09, 0.85], [0.03, 0.836], [0, 0.83]],
  bot: [[3.463, 0], [3.373, 0.006], [3.224, 0.021], [3.075, 0.033], [2.925, 0.054], [2.776, 0.075], [2.627, 0.096],
    [2.478, 0.13], [2.179, 0.185], [1.881, 0.246], [1.582, 0.309], [1.284, 0.378], [0.985, 0.439], [0.687, 0.507],
    [0.388, 0.579], [0.239, 0.621], [0.149, 0.648], [0.09, 0.672], [0.03, 0.699], [0, 0.705]],
};
// the large flight-deck side windows: windscreen side pane and the sliding window
const EJ_GLASS = [
  [[0.731, 0.619], [0.8, 0.787], [0.961, 0.784], [0.961, 0.613]],
  [[0.731, 0.619], [0.8, 0.787], [0.714, 0.786], [0.484, 0.62]],
];
const EJ_FIN = { le: 6.5, cr: 4.56, ct: 1.49, h: 5.1, sweep: 40.4, fillet: [0.63, 0.56], rudder: 0.66, round: 0.25 };
const EJ_WIN = (to) => [{ z: 0.673, from: 6.25, to: 6.25, w: 0.33, h: 0.38 }, { z: 0.673, from: 7.42, to, pitch: 0.80, w: 0.33, h: 0.38 }];

// E190 (ERJ 190-100): APM-1901 Figure 2.1 (side, plan and front views; heights rescaled as above):
// overall 36.24 m, span over winglets 28.72 m, tailplane span 12.08 m. Wing with tall swept
// winglets reaching the crown, CF34-10E under the wing, one overwing exit per side, L1/L2 doors.
F.e190 = {
  kind: "narrow", L0: 36.24, over: 0, D: 3.35, W: 3.01, fwd: 0.56, fair: 0.149, fairAft: 1.566,
  nose: EJ_NOSE, tail: EJ_TAIL, glass: EJ_GLASS, frame: 0.04,
  floor: 0.345,
  doors: [[5.19, 0.9], [-8.24, 0.78], [1.9, 0.5, "E", "w"]],
  win: EJ_WIN(-9.49),
  extras: [wingSeam([[-2.75, 0.05], [-2.4, 0.5], [-1.25, 0.95], [0.25, 1.1], [3.25, 1.12], [6.25, 1.05], [7.6, 0.92], [8.6, 0.6],
    [8.85, 0.3], [8.3, 0.05]])],
  wing: { le: 13.75, root: 1.505, span: 27.0, cr: 5.46, kink: [0.308, 3.59], ct: 1.55, sweep: 26.6, dih: 4.5, z: 0.209, t: [0.13, 0.1] },
  tip: { h: 1.61, sweep: 44, top: 0.3, base: 0.465, blend: 0.3 },
  ftf: [0.2, 0.42, 0.62],
  eng: { kind: "fan", at: [0.263], fwd: 3.3, drop: 1.09, len: 4.27, dia: 1.87, fx: 0.62, cx: 0.73 },
  fin: EJ_FIN,
  stab: { le: 4.7, z: 0.737, span: 12.08, root: 0.9, cr: 3.03, ct: 0.85, sweep: 34.6, dih: 6 },
};
// E170/E175 (ERJ 170-100/-200): no planning manual found online (the E175 APM link is dead).
// The E190's fuselage shortened by the plugs ahead of and behind the wing (data.js length), with
// the smaller wing (Wikipedia "Embraer E-Jet family": span 26.0 m over the original winglets,
// area 72.7 m2: chords scaled from the E190's), smaller CF34-8E, a lower fin and a 10 m tailplane.
F.e175 = {
  ...F.e190,
  wing: { ...F.e190.wing, le: 14.1, span: 24.4, cr: 4.75, kink: [0.308, 3.12], ct: 1.35 },
  tip: { h: 1.45, sweep: 44, top: 0.28, base: 0.465, blend: 0.25 },
  eng: { kind: "fan", at: [0.27], fwd: 2.9, drop: 1.0, len: 3.65, dia: 1.6, fx: 0.62, cx: 0.74 },
  fin: { ...EJ_FIN, h: 4.55, cr: 4.2, ct: 1.4 },
  stab: { ...F.e190.stab, span: 10.0, cr: 2.8, ct: 0.95 },
};
// E175 "long wing" (E75L, the US scope-clause E175s): span 28.65 m with the larger, more canted
// winglets of 2014-on aircraft (Wikipedia); E75S keeps the original 26.0 m wing.
F.e175l = {
  ...F.e175,
  wing: { ...F.e175.wing, span: 25.6, ct: 1.25 },
  tip: { h: 1.75, sweep: 50, top: 0.3, base: 0.55, blend: 0.35 },
};
// E190-E2: APM-5824 Figure 2.1 (side, plan and front views): overall 36.33 m, span 33.72 m,
// tailplane span 10.0 m. New high-aspect-ratio wing with raked tips and no winglets, large
// PW1900G geared turbofans, same fuselage and fin as the E190, smaller tailplane.
F.e290 = {
  ...F.e190, L0: 36.3, over: 0.03, fair: 0.185, fairAft: 1.64,
  doors: [[5.25, 0.9], [-8.25, 0.78], [1.77, 0.55, "E", "w"]],
  win: [{ z: 0.673, from: 6.25, to: 6.25, w: 0.33, h: 0.38 }, { z: 0.673, from: 7.44, to: -9.89, pitch: 0.797, w: 0.33, h: 0.38 }],
  extras: [wingSeam([[-2.9, 0.05], [-2.7, 0.55], [-1.5, 0.95], [1.0, 1.07], [5.0, 1.06], [8.0, 0.95], [9.2, 0.72], [9.5, 0.45],
    [8.8, 0.08]])],
  wing: { le: 12.39, root: 1.505, span: 33.72, cr: 5.85, kink: [0.247, 3.76], ct: 1.14, sweep: 28.9, dih: 4.6, z: 0.209,
    t: [0.13, 0.1], rake: [0.898, 52, 0.29] },
  tip: null,
  eng: { kind: "fan", at: [0.244], fwd: 3.88, drop: 1.09, len: 4.72, dia: 2.4, fx: 0.729, cx: 0.883 },
  fin: { ...EJ_FIN, le: 6.47 },
  stab: { le: 4.65, z: 0.737, span: 10.0, root: 0.9, cr: 3.02, ct: 1.15, sweep: 34.6, dih: 6 },
};

export const families = F;
export const types = {
  CRJ2: "crj2", CRJ7: "crj7", CRJ9: "crj9",
  // ERJ-135: the ERJ-145 with 2.01 m taken out ahead of the wing and 1.53 m behind it (checked by
  // overlay on APM-145/1238 Figure 2.2.1); its window rows re-phased to the drawing
  E135: ["e145", { win: [{ z: 0.636, from: 6.04, to: 12.1, pitch: 0.746, w: 0.3, h: 0.34 }, { z: 0.636, from: 13.7, to: -8.21, pitch: 0.8, w: 0.3, h: 0.34 }] }],
  E145: "e145",
  E170: "e175", E75S: "e175", E75L: "e175l",
  E190: "e190", E195: ["e190", { doors: [[5.19, 0.9], [-8.24, 0.78], [1.9, 0.5, "E", "w"], [2.85, 0.5, "E", "w"]] }],
  E290: "e290",
};
