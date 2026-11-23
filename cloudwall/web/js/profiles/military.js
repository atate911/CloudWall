// Military types without a civil family. Format: see ../profiles.js.
const F = {};

// ---------- Boeing C-17A Globemaster III ----------
// Reference: Boeing "BC-17/C-17A Airport Compatibility" brochure (2005, rev. 2011), General
// Arrangement p. 3: side elevation (overall 53.04 m, fuselage 48.49 m, height 16.79 m), plan view
// (wing, nacelle and stab positions) and front view (anhedral, winglets).
F.c17 = {
  kind: "quad", L0: 48.49, over: 4.55, D: 6.37, W: 6.5, fwd: 0.5, fair: 0,
  nose: {
    tip: 0.43,
    top: [[0.05, 0.56], [0.1, 0.607], [0.15, 0.649], [0.2, 0.68], [0.3, 0.775], [0.4, 0.837], [0.5, 0.879], [0.6, 0.911],
      [0.8, 0.958], [1.0, 0.984], [1.2, 0.994], [1.35, 1]],
    bot: [[0.05, 0.314], [0.1, 0.272], [0.2, 0.209], [0.3, 0.167], [0.4, 0.131], [0.55, 0.098], [0.7, 0.063], [0.9, 0.031], [1.1, 0.01], [1.3, 0]],
  },
  tail: {
    top: [[3.7, 1], [3.25, 1.026], [2.75, 1.062], [2.25, 1.099], [1.65, 1.126], [1.0, 1.11], [0.7, 1.105], [0.55, 1.088], [0.39, 1.025],
      [0.234, 1.0], [0.077, 0.974], [0, 0.958]],
    bot: [[3.6, 0], [3.25, 0.042], [3, 0.084], [2.5, 0.194], [2, 0.319], [1.5, 0.461], [1, 0.607], [0.75, 0.67], [0.5, 0.759],
      [0.25, 0.832], [0, 0.879]],
  },
  glass: [
    [[0.462, 0.83], [0.413, 0.816], [0.379, 0.773], [0.435, 0.77]],
    [[0.434, 0.769], [0.351, 0.764], [0.305, 0.687], [0.365, 0.644], [0.401, 0.642]],
    [[0.351, 0.764], [0.284, 0.757], [0.305, 0.687]],
    [[0.548, 0.773], [0.434, 0.773], [0.406, 0.638], [0.548, 0.633]],
  ],
  floor: 0.15,
  doors: [[6.33, 1.2], [26.2, 1.1]],
  win: [{ z: 0.32, from: 7.5, to: 7.5, w: 0.3, h: 0.3 }],
  wing: { le: 14.6, root: 3.3, span: 50.3, cr: 13.1, ct: 2.1, sweep: 30.5, dih: -4.5, z: 0.875, t: [0.13, 0.11] },
  tip: { h: 2.4, sweep: 36, top: 0.6, base: 0.9 },
  eng: { kind: "fan", at: [0.195, 0.5], fwd: 7.0, drop: 1.75, len: 6.4, dia: 2.7, fx: 0.7, cx: 0.86, pyFront: 0.2, pyLead: 0.4, pyTe: 0.4, pyAft: 0.75 },
  fin: { le: 11.15, cr: 7.9, ct: 8.0, h: 9.0, sweep: 41, fillet: [1.0, 0.4], rudder: 0.65 },
  stab: { le: 3.1, z: "T", drop: 0.37, span: 19.81, root: 0.4, cr: 7.5, ct: 1.8, sweep: 34, dih: -3 },
  extras: [
    // dorsal wing-root fairing and the main-gear sponson on the lower fuselage side
    ({ sk }) => {
      sk.smooth("hull", [[11.5, 6.2, "c"], [13.5, 6.55], [16, 6.62], [22, 6.5], [28, 6.38], [31, 6.2, "c"]], false);
      sk.smooth("hull", [[13.6, 0.4], [13.9, 1.7], [15.5, 2.5], [19, 2.75], [23, 2.65], [26.5, 1.9], [31, 0.4, "c"], [25, -0.15], [18, -0.2], [14.6, -0.05]]);
    },
  ],
  overlays: [
    // cargo ramp edge, radome joint, aft-body strakes and the fin-top fairing over the T-tail
    ({ sk }) => {
      sk.poly("hl", [[26.5, 0.75], [32, 2.0], [37.2, 3.4], [41.5, 4.6]], false);
      sk.poly("hl", [[0.95, 4.65], [0.8, 3.6], [1.05, 1.6]], false);
      sk.smooth("stab", [[39.6, 3.6, "c"], [42, 4.48], [45.3, 5.1, "c"], [44, 4.3], [42, 3.9]]);
      sk.smooth("fin", [[44.4, 15.6, "c"], [45.0, 16.15], [46.2, 16.36], [50, 15.95], [53.0, 15.3, "c"], [52.5, 14.75], [48, 14.85], [44.6, 15.0, "c"]]);
    },
  ],
};

// ---------- Boeing C-135 / 707 airframes: KC-135R, E-3 Sentry, E-6 Mercury ----------
// Reference: Boeing 707 Airplane Characteristics D6-58322 (scanned), fig. 2.3 ground clearances,
// side elevation of the 707-120B (p. 13; overall 44.22 m, fuselage 42.32 m, fuselage height 4.33 m
// from fig. 2.2). The KC-135 shares that nose, wing, tall fin and tail cone on a fuselage 2.7 m
// shorter (KC-135R 41.53 m long, 39.88 m span, 12.70 m high per Wikipedia); its length comes from
// types.csv. Engine stations (8.28 / 14.05 m out), wing root, cargo door and fuselage height
// (4.22 m) from the USAF "Boeing KC-135A Stratotanker 3-view line drawing" (Wikimedia Commons).
// The E-3 and E-6 are 707-320B airframes (46.61 m, span 44.42 m): longer fuselage, bigger wing. Engines from published data: F108 (CFM56-2) on KC-135R and E-6, TF33 (JT3D) on the E-3.
const C135_NOSE = {
  tip: 0.44,
  top: [[0.05, 0.54], [0.1, 0.571], [0.2, 0.616], [0.3, 0.669], [0.4, 0.735], [0.5, 0.788], [0.6, 0.832], [0.7, 0.872],
    [0.8, 0.899], [0.9, 0.925], [1.0, 0.952], [1.2, 0.978], [1.4, 0.996], [1.6, 1]],
  bot: [[0.05, 0.344], [0.1, 0.313], [0.2, 0.256], [0.3, 0.212], [0.4, 0.172], [0.5, 0.136], [0.6, 0.101], [0.7, 0.075],
    [0.8, 0.061], [0.9, 0.044], [1.0, 0.03], [1.2, 0.01], [1.4, 0]],
};
// the flying boom, stowed under the tail, with the boom operator's pod ahead of its hinge
const boom = ({ sk, L, D }) => {
  sk.smooth("hull", [[L - 8.2, 0.42 * D, "c"], [L - 7.2, 0.3 * D], [L - 5.6, 0.29 * D], [L - 4.6, 0.43 * D, "c"]]);
  sk.ellipse("glass", L - 7.0, 0.33 * D, 0.32, 0.12);
  const h = [L - 5.4, 0.42 * D], a = (-9 * Math.PI) / 180, len = 9.6, end = [h[0] + len * Math.cos(a), h[1] + len * Math.sin(a)];
  sk.poly("pyl", [[h[0], h[1] + 0.22], [end[0], end[1] + 0.12], [end[0] + 0.5, end[1] + 0.04], [end[0] + 0.5, end[1] - 0.04], [end[0], end[1] - 0.12], [h[0], h[1] - 0.22]]);
  // ruddevators: a V seen from the side
  const r = [h[0] + 6.8 * Math.cos(a), h[1] + 6.8 * Math.sin(a)];
  sk.poly("stab", [[r[0] - 0.4, r[1] + 0.05], [r[0] + 0.9, r[1] + 0.95], [r[0] + 1.5, r[1] + 0.9], [r[0] + 0.9, r[1] - 0.05]]);
};
// HF antenna probe pointing forward from the fin tip
const hfProbe = ({ sk, f, D, L, top, tan }) => {
  const t = f.fin, s0 = L - t.le, zt = D + t.h, tipLE = s0 + (zt - top(s0)) * tan(t.sweep);
  sk.poly("fin", [[tipLE + 0.4, zt - 0.02], [tipLE - 2.5, zt - 0.1], [tipLE - 2.5, zt - 0.16], [tipLE + 0.5, zt - 0.3]]);
};
F.k35r = {
  kind: "quad", L0: 42.3, over: 1.92, D: 4.22, W: 3.66, fwd: 0.37, fair: 0.04, fairAft: 1.0,
  nose: C135_NOSE,
  tail: {
    top: [[2.0, 1], [1.5, 0.985], [1.0, 0.955], [0.5, 0.915], [0, 0.865]],
    bot: [[3.13, 0], [2.8, 0.057], [2.35, 0.132], [1.89, 0.226], [1.435, 0.323], [0.98, 0.41], [0.524, 0.513], [0.296, 0.58], [0.068, 0.672], [0, 0.72]],
  },
  glass: [
    [[0.32, 0.66], [0.37, 0.71], [0.44, 0.758], [0.44, 0.655], [0.36, 0.64]],
    [[0.448, 0.762], [0.565, 0.778], [0.555, 0.632], [0.448, 0.652]],
    [[0.59, 0.74], [0.7, 0.75], [0.72, 0.665], [0.665, 0.6], [0.6, 0.625]],
  ],
  floor: 0.4,
  doors: [[8.9, 2.75, "D", undefined, 2.05]],
  wing: { le: 12.9, root: 1.83, span: 39.88, cr: 8.4, kink: [0.3, 5.6], ct: 2.4, sweep: 39, dih: 6, z: 0.2, t: [0.13, 0.09] },
  ftf: [0.28, 0.5, 0.7],
  eng: { kind: "fan", at: [0.356, 0.675], fwd: 4.2, drop: 1.2, len: 5.2, dia: 2.05, fx: 0.72, cx: 0.88, pyFront: 0.35, pyTe: 0.5, pyAft: 0.85 },
  fin: { le: 6.7, cr: 5.85, ct: 2.6, h: 6.9, sweep: 35, fillet: [1.2, 1.0], rudder: 0.61 },
  stab: { le: 4.5, z: 0.78, span: 12.1, root: 0.6, cr: 4.4, ct: 1.8, sweep: 38, dih: 7 },
  overlays: [boom, hfProbe],
};
// E-3 Sentry: 707-320B airframe, TF33 fan-duct nacelles, rotodome (9.1 m across, 1.8 m thick)
// on two struts over the rear fuselage, centred 30 m aft of the nose (Wikipedia; AWACS line drawing).
const C135_320 = {
  D: 4.33, W: 3.76, L0: 44.69, over: 1.92,
  wing: { le: 14.9, root: 1.88, span: 44.42, cr: 9.6, kink: [0.28, 6.0], ct: 2.5, sweep: 39, dih: 6, z: 0.2, t: [0.13, 0.09] },
  stab: { le: 4.5, z: 0.78, span: 13.95, root: 0.6, cr: 4.8, ct: 1.8, sweep: 38, dih: 7 },
};
const rotodome = ({ sk, at, top }) => {
  const c = at(30.0), zb = top(c) + 3.6, R = 4.57, h = 1.83;
  sk.poly("pyl", [[c - 1.9, top(c - 1.9) - 0.1], [c - 0.7, zb + 0.2], [c + 1.1, zb + 0.2], [c + 1.3, top(c + 1.3) - 0.1]]);
  sk.smooth("hull", [[c - R, zb + h * 0.5, "c"], [c - R + 0.5, zb + h * 0.92], [c, zb + h], [c + R - 0.5, zb + h * 0.92], [c + R, zb + h * 0.5, "c"],
    [c + R - 0.5, zb + h * 0.08], [c, zb], [c - R + 0.5, zb + h * 0.08]]);
  sk.poly("hl", [[c - R + 0.05, zb + h * 0.5], [c + R - 0.05, zb + h * 0.5]], false);
};
F.e3 = {
  ...F.k35r, ...C135_320,
  doors: [[5.2, 0.86], [-7.0, 0.86]],
  win: [{ z: 0.62, from: 7.5, to: 7.5, w: 0.26, h: 0.3 }],
  eng: { kind: "fan", at: [0.315, 0.63], fwd: 4.0, drop: 1.25, len: 5.6, dia: 1.55, fx: 0.42, cx: 0.9, pyFront: 0.3, pyTe: 0.55, pyAft: 0.8 },
  overlays: [rotodome, hfProbe],
};
// E-6B Mercury: 707-320B airframe with CFM56 nacelles and wingtip ESM/HF pods (45.16 m over the pods)
const tipPods = ({ sk, sec }) => {
  const q = sec(1), s = q.le, z = q.z + 0.1;
  sk.smooth("nac", [[s - 1.6, z, "c"], [s - 0.6, z + 0.36], [s + 1.2, z + 0.4], [s + 2.6, z + 0.3], [s + 3.1, z, "c"], [s + 2.6, z - 0.3], [s + 1.2, z - 0.4], [s - 0.6, z - 0.36]]);
  sk.poly("fin", [[s - 1.6, z + 0.02], [s - 3.0, z + 0.02], [s - 3.0, z - 0.02], [s - 1.6, z - 0.04]]);
};
F.e6 = {
  ...F.k35r, ...C135_320,
  doors: [[5.2, 0.86], [-7.0, 0.86]],
  win: [{ z: 0.62, from: 7.3, to: 12.4, pitch: 0.51 * 5, w: 0.26, h: 0.34 }],
  eng: { ...F.k35r.eng, at: [0.315, 0.63], fwd: 4.4 },
  overlays: [tipPods, hfProbe],
};

// ---------- Boeing B-52H Stratofortress ----------
// Reference: Wikimedia Commons "Boeing B-52H Stratofortress 3-view line drawing.png" (side, plan
// and front views; length 48.5 m, span 56.39 m, height 12.4 m per Wikipedia). The side view is
// drawn on the ground with the wing drooping; the wing here is given its in-flight flex instead.
// Eight TF33s in four paired pods (one pod per pylon seen from the side), outrigger wheels
// retracted, tail turret fairing at the end of a full-height tail.
const tailTurret = ({ sk, L, D }) => {
  sk.smooth("hull", [[L - 0.1, 0.98 * D, "c"], [L + 0.45, 0.95 * D], [L + 0.75, 0.82 * D], [L + 0.8, 0.66 * D], [L + 0.55, 0.52 * D], [L - 0.1, 0.48 * D, "c"]]);
  sk.poly("strut", [[L + 0.7, 0.575 * D], [L + 1.3, 0.575 * D], [L + 1.3, 0.545 * D], [L + 0.7, 0.545 * D]]);
};
F.b52 = {
  kind: "quad", L0: 47.2, over: 1.3, D: 3.88, W: 2.9, fwd: 0.5, fair: 0,
  nose: {
    tip: 0.44,
    top: [[0.05, 0.53], [0.1, 0.56], [0.2, 0.62], [0.3, 0.672], [0.4, 0.711], [0.5, 0.787], [0.6, 0.863], [0.7, 0.909], [0.8, 0.933],
      [0.9, 0.952], [1.0, 0.968], [1.2, 0.985], [1.4, 0.995], [1.6, 1]],
    bot: [[0.05, 0.368], [0.1, 0.346], [0.2, 0.294], [0.3, 0.249], [0.4, 0.205], [0.5, 0.168], [0.6, 0.139], [0.7, 0.109], [0.77, 0.08, "c"],
      [0.88, -0.044, "c"], [1.1, -0.045], [1.3, -0.03], [1.5, 0]],
  },
  tail: {
    top: [[3, 1], [0.15, 1], [0, 0.985]],
    bot: [[3.75, 0], [3.5, 0.065], [3, 0.13], [2.5, 0.2], [2, 0.272], [1.5, 0.337], [1, 0.4], [0.5, 0.436], [0, 0.465]],
  },
  glass: [
    [[0.77, 0.9], [0.63, 0.885], [0.49, 0.724], [0.63, 0.722]],
    [[0.902, 0.825], [0.8, 0.825], [0.8, 0.722], [0.902, 0.722]],
    [[1.062, 0.825], [0.925, 0.825], [0.92, 0.722], [1.062, 0.722]],
  ],
  wing: { le: 11.3, root: 1.45, span: 56.39, cr: 10.2, ct: 2.4, sweep: 37.7, dih: -1, bend: 1.0, z: 0.78, t: [0.12, 0.09] },
  eng: { kind: "fan", at: [0.338, 0.626], fwd: 5.5, drop: 1.3, len: 6.2, dia: 1.5, fx: 0.5, cx: 0.9, pyFront: 0.15, pyLead: 0.3, pyTe: 0.3, pyAft: 0.7 },
  fin: { le: 11.0, cr: 7.65, ct: 2.7, h: 6.97, sweep: 40.4, rudder: 0.88 },
  stab: { le: 10.2, z: 0.673, span: 15.85, root: 1.45, cr: 7.5, ct: 1.2, sweep: 45, dih: 0 },
  overlays: [tailTurret],
};

// ---------- Shared helpers ----------
// A main-gear sponson (fairing) on the lower fuselage side: from s0 to s1 (metres from the nose,
// negative from the tail end), top height h (m), bottom at the keel.
const sponson = (s0, s1, h, drop = 0.15) => ({ sk, at }) => {
  const a = at(s0), b = at(s1), l = b - a;
  sk.smooth("hull", [[a, 0.2, "c"], [a + 0.06 * l, h * 0.75], [a + 0.25 * l, h], [a + 0.7 * l, h * 0.92], [b, 0.25, "c"], [a + 0.7 * l, -drop], [a + 0.2 * l, -drop], [a + 0.03 * l, -drop * 0.3]]);
};
// A wing-mounted turboprop nacelle drawn from a side outline (u m aft of the spinner tip, dz m
// above the propeller axis), placed like the renderer's: spinner at the local LE minus fwd.
const tpNacelle = (o) => ({ sk, sec, prop }) => {
  for (const e of o.at) {
    const q = sec(e), s0 = q.le - o.fwd, zc = q.z - o.drop;
    sk.smooth("nac", o.outline.map(([u, dz, fl]) => [s0 + u, zc + dz, fl]));
    sk.poly("hl", [[s0 + o.sp, zc + o.sr], [s0 + o.sp, zc - o.sr]], false);
    if (o.inlet) sk.ellipse("inlet", s0 + o.inlet[0], zc + o.inlet[1], o.inlet[2], o.inlet[3]);
    prop(sk, s0 + o.sp * 0.7, zc, o.prop, o.blades);
  }
};

// Panel joints, frames, seams and hatch outlines traced off a family's drawing, as [s, z] polylines in
// metres, drawn as thin lines over the fuselage and fin (the wing and nacelles are drawn over them).
const panels = (lines) => ({ sk }) => { for (const l of lines) sk.poly("hl", l, false); };

// ---------- Lockheed C-130H / C-130J Hercules ----------
// Reference: Wikimedia Commons "Lockheed C-130J Hercules 3-view drawing.svg" (side, plan and front
// views of the short C-130J; length 29.79 m, span 40.41 m per Wikipedia). The C-130H airframe is
// the same; it differs in engines (T56, four-blade props) where the J has AE2100s with six-blade
// scimitar Dowty R391 props (both 4.11 m). High wing on a root fairing, long nacelles hanging
// under the wing from the props well ahead to aft fairings behind the trailing edge, main-gear
// sponsons, upswept rear fuselage with the ramp ending in a thin beaver tail, tall fin on a long
// straight dorsal, low-set stabiliser at the end of the tail. C30J (C-130J-30) is 4.57 m longer.
const T56 = {
  at: [0.168, 0.44], fwd: 3.0, drop: 0.53, sp: 0.5, sr: 0.3, prop: 4.11, blades: 4, inlet: [0.8, -0.62, 0.06, 0.12],
  outline: [[0, 0, "c"], [0.25, 0.2], [0.5, 0.3, "c"], [0.6, 0.38], [1.5, 0.38], [3.0, 0.38], [5.0, 0.33], [7.0, 0.22], [8.4, 0.06], [9.25, -0.1, "c"],
    [8.4, -0.22], [7.0, -0.3], [5.2, -0.42], [3.65, -0.75], [2.15, -0.82], [0.95, -0.76], [0.62, -0.5], [0.5, -0.3, "c"], [0.25, -0.2]],
};
// The side view's panel joints, frames and seams, vectorised from the same drawing (its side view
// drawn to its 29.79 m length, the keel on z = 0; the drawing shows the left side, mirrored here):
// fuselage frames and stringer lines, the roof seam, the flight-deck frame, the ramp and its hinge
// lines under the upswept tail, the sponson panels, and the fin's spar and rib lines.
const C130_PANELS = [
  [[1.58,0.54],[1.57,0.55],[1.58,1.63]],
  [[1.67,0.42],[2.04,0.31],[2.27,0.26],[2.3,0.24],[2.37,0.24],[2.4,0.22],[2.56,0.19],[2.6,0.17],[3.01,0.09]],
  [[2.24,0.34],[2.31,0.34],[2.68,0.25],[2.9,0.23],[2.95,0.2],[3.06,0.2],[3.09,0.18]], [[2.46,1.71],[2.46,2.16]],
  [[2.76,1.62],[2.76,0.26]], [[3.12,3.38],[3.11,3.05]], [[3.17,0.22],[3.31,0.28],[3.54,0.27]], [[3.35,0.3],[3.35,3.81]],
  [[3.37,0.36],[4.21,0.33],[5.28,0.33]],
  [[3.55,3.17],[3.96,3.23],[4.0,3.26],[4.14,3.26],[4.2,3.28],[4.35,3.28],[4.41,3.3],[5.09,3.33]],
  [[4.29,1.62],[4.29,0.34],[4.26,0.31],[4.26,0]], [[5.0,2.47],[5.0,2.1],[4.96,2.05],[4.44,2.05],[4.4,2.1],[4.4,2.52]],
  [[5.29,3.99],[5.29,0.4]], [[5.31,0.27],[7.73,0.27]], [[5.31,3.35],[8.29,3.35]], [[6.56,3.25],[6.56,0.4]],
  [[7.06,1.16],[6.93,1.16],[6.9,1.18],[6.83,1.27],[6.83,1.34]], [[7.74,3.99],[7.74,0]], [[8.47,0.89],[8.47,2.6]],
  [[8.48,3.26],[5.15,3.27]], [[8.49,0.86],[9.09,0.86]],
  [[8.77,1.81],[8.76,2.12],[8.78,2.2],[8.78,2.33],[8.8,2.4],[8.81,2.56]], [[8.84,0.84],[8.84,0]],
  [[9.18,2.62],[9.19,1.14],[9.17,1.07]], [[9.3,1.22],[9.33,1.04],[9.31,0.61]], [[9.34,2.63],[9.63,2.62]],
  [[9.67,0.39],[9.66,0.4],[8.85,0.38],[5.31,0.39]], [[10.03,1.74],[9.66,1.74]], [[10.19,0.22],[10.2,0.82]],
  [[10.34,1.75],[10.83,1.88],[10.91,1.88],[11.1,1.93],[11.25,1.93],[11.51,1.96],[14.69,1.96],[14.94,1.93],[15.11,1.93],[15.2,1.9],[15.36,1.9],[15.45,1.88],[15.69,1.88],[15.82,1.86],[16.06,1.86],[16.44,1.82]],
  [[11.22,0.94],[11.18,0.98],[10.79,0.98],[10.69,0.96],[10.29,0.94]], [[11.22,0.93],[11.22,0.08]],
  [[11.23,0.24],[11.25,0.25],[11.58,0.24]], [[11.57,0.97],[11.27,0.98]], [[11.58,0.39],[11.23,0.39]],
  [[11.59,0.07],[11.58,0.24],[11.59,1.95]], [[11.6,0.84],[13.4,0.83],[14.47,0.84],[14.48,0.02]],
  [[12.09,2.81],[11.97,2.78],[11.91,2.74],[11.83,2.74],[11.63,2.68],[11.45,2.65],[11.4,2.63],[10.83,2.54],[10.64,2.54]],
  [[12.46,0.52],[12.33,0.56],[12.21,0.56],[12.09,0.52]], [[13.43,0.43],[13.41,0.82]], [[13.46,1.97],[13.46,2.71]],
  [[13.51,0.47],[13.64,0.54],[13.74,0.56],[13.87,0.56],[13.97,0.54],[14.13,0.46]], [[14.61,0.63],[14.61,0.02]],
  [[14.66,1.14],[14.68,1.16],[15.02,1.16],[15.04,1.14]],
  [[14.7,0.06],[15.16,0.1],[15.3,0.15],[15.37,0.15],[15.42,0.17],[15.67,0.22],[16.35,0.4]],
  [[15.03,0.66],[14.78,0.64],[14.68,0.64],[14.64,0.66]], [[15.05,1.13],[15.05,0.68]], [[15.1,1.29],[15.1,0.11]],
  [[15.34,0.54],[15.03,0.48],[14.88,0.48],[14.83,0.46],[14.62,0.44]], [[15.59,2.72],[15.6,0.49]],
  [[15.61,0.48],[16.28,0.49]], [[16.31,0.54],[16.31,1.82]], [[16.56,0.54],[16.56,2.16]], [[17.37,2.23],[16.63,2.23]],
  [[17.42,2.17],[17.42,0.51],[17.39,0.48],[16.61,0.48]], [[17.61,2.28],[18.45,2.28]],
  [[17.61,0.98],[17.84,1.0],[17.88,1.02],[17.97,1.02],[18.0,1.05],[18.08,1.05],[18.29,1.09]],
  [[17.66,0.22],[17.73,0.22],[18.24,0.38]], [[17.78,0.46],[18.33,0.6]], [[18.24,1.0],[17.61,0.9]],
  [[18.46,1.16],[18.46,3.22]], [[19.26,3.35],[19.27,1.41]], [[20.12,3.42],[20.12,1.74]],
  [[20.16,1.14],[20.42,1.15],[20.49,1.17]], [[20.26,1.7],[19.96,1.58]],
  [[20.52,1.64],[20.59,1.66],[20.71,1.66],[20.8,1.63],[20.98,1.65]], [[21.03,2.11],[21.03,3.47]],
  [[21.26,2.08],[21.72,2.27]], [[21.67,2.33],[21.66,2.35],[21.67,3.52]], [[22.11,2.49],[22.4,2.61]],
  [[22.47,3.56],[22.46,3.55],[22.47,2.64]], [[23.21,2.86],[23.95,3.15]], [[24.92,3.96],[24.4,3.91],[24.28,3.87]],
  [[25.08,7.48],[24.97,7.2]], [[25.14,4.11],[25.14,4.19],[25.28,4.71],[25.38,5.2]], [[25.37,4.1],[19.25,4.1]],
  [[26.0,7.74],[27.93,7.74],[27.99,7.7],[28.18,7.72]],
  [[26.51,4.03],[26.51,4.17],[26.48,4.24],[26.49,4.44],[26.51,4.51],[26.51,4.7],[26.53,4.77],[26.53,4.95],[26.56,5.02],[26.58,5.48],[26.6,5.53],[26.62,5.99],[26.65,6.05],[26.67,6.5],[26.69,6.56],[26.69,6.75],[26.71,6.82],[26.74,7.26],[26.76,7.33],[26.78,7.79],[26.81,7.85],[26.83,8.3],[26.85,8.36],[26.88,8.81],[26.9,8.87],[26.9,9.06],[26.92,9.13],[26.94,9.58],[26.97,9.64],[26.97,9.84],[26.99,9.91],[27.01,10.34]],
  [[26.57,10.27],[26.46,9.86],[26.46,9.8],[26.42,9.68],[26.42,9.61],[26.37,9.47],[26.35,9.31],[26.33,9.28],[26.3,9.12],[26.28,9.09],[26.24,8.82],[26.21,8.79],[26.12,8.34],[26.1,8.3],[26.08,8.14],[26.05,8.11],[26.01,7.85],[25.94,7.62],[25.85,7.16],[25.83,7.13],[25.8,6.97],[25.78,6.93],[25.78,6.87],[25.76,6.83],[25.74,6.67],[25.71,6.64],[25.67,6.45],[25.62,6.18],[25.6,6.15],[25.58,5.99],[25.55,5.96],[25.51,5.69],[25.48,5.66],[25.48,5.6],[25.44,5.47],[25.42,5.31]],
  [[26.85,8.61],[26.2,8.61],[25.98,8.69]], [[27.26,8.63],[28.04,8.63]], [[27.26,9.66],[27.85,9.66]],
  [[27.26,4.07],[27.25,10.66]], [[27.7,4.08],[27.7,7.73]],
  [[28.22,4.08],[28.22,6.02],[28.17,6.24],[28.15,6.49],[28.13,6.55],[28.06,7.11],[28.04,7.16],[28.01,7.41],[27.99,7.47],[27.99,7.56],[27.97,7.63],[27.98,7.69]],
  [[28.48,5.96],[28.47,5.94],[28.41,5.96],[28.32,5.94],[28.25,5.97],[27.75,5.94],[27.27,5.96]],
];
F.c130 = {
  kind: "turboprop", L0: 28.95, over: 0.84, D: 3.75, W: 4.34, fwd: 0.55, fair: 0, floor: 0.11, frame: 0.035,
  nose: {
    tip: 0.325,
    top: [[0.048, 0.439], [0.096, 0.469], [0.144, 0.494], [0.192, 0.506], [0.24, 0.524], [0.288, 0.543], [0.336, 0.573], [0.384, 0.628], [0.432, 0.684],
      [0.48, 0.744], [0.528, 0.793], [0.576, 0.829], [0.672, 0.891], [0.768, 0.927], [0.864, 0.951], [0.96, 0.97], [1.056, 0.982], [1.152, 0.994], [1.34, 1]],
    bot: [[0.048, 0.195], [0.096, 0.171], [0.144, 0.146], [0.192, 0.128], [0.288, 0.091], [0.384, 0.055], [0.48, 0.024], [0.576, 0], [0.672, -0.016],
      [0.864, -0.006], [1.1, 0.004], [1.4, 0]],
  },
  tail: {
    top: [[3.0, 1], [0.1, 1], [0, 0.99]],
    bot: [[3.2, 0], [2.74, 0.06], [2.5, 0.153], [2.26, 0.231], [2.02, 0.353], [1.78, 0.464], [1.54, 0.567], [1.3, 0.671], [1.06, 0.775], [0.82, 0.793],
      [0.58, 0.829], [0.34, 0.884], [0.1, 0.94], [0, 0.96]],
  },
  glass: [
    [[0.82, 0.785], [0.62, 0.795], [0.57, 0.765], [0.59, 0.742], [0.82, 0.742]],
    [[0.8, 0.728], [0.66, 0.728], [0.66, 0.6], [0.8, 0.6]],
    [[0.645, 0.728], [0.57, 0.728], [0.47, 0.635], [0.5, 0.6], [0.645, 0.6]],
    [[0.47, 0.598], [0.36, 0.53], [0.33, 0.46], [0.46, 0.53]],
    [[0.64, 0.48], [0.565, 0.48], [0.565, 0.35], [0.64, 0.35]],
    [[0.55, 0.48], [0.49, 0.48], [0.49, 0.36], [0.55, 0.35]],
  ],
  doors: [[4.7, 0.9, "D", undefined, 1.75], [17.1, 0.85, "D", undefined, 1.8]],
  // round cabin windows as the drawing places them: three ahead of the wing at 1.33 m above the keel,
  // two over the ramp at 2.15 m
  win: [{ z: 0.355, from: 5.91, to: 7.99, pitch: 1.04, w: 0.32, h: 0.32 }, { z: 0.573, from: 14.95, to: 15.84, pitch: 0.89, w: 0.32, h: 0.32 }],
  wing: { le: 11.2, root: 2.17, span: 40.41, cr: 4.9, kink: [0.2, 4.8], ct: 2.25, sweep: 1.7, dih: 2.5, z: 0.92, t: [0.17, 0.12] },
  fin: { le: 6.47, cr: 6.42, ct: 1.9, h: 6.75, sweep: 27.9, fillet: [4.78, 1.05, "l"], rudder: 0.76, round: 0.5 },
  stab: { le: 4.65, z: 0.95, span: 16.05, root: 0.6, cr: 4.3, ct: 2.7, sweep: 11, dih: 0 },
  extras: [sponson(9.6, 16.9, 1.55), panels(C130_PANELS)],
  overlays: [tpNacelle(T56)],
};
// C-130J-30: 2.54 m plug ahead of the wing and 2.03 m behind it (4.57 m in all, types.csv length);
// the wing (and so the nacelles) moves with the forward plug, the sponson with the wing, the
// paratroop doors and rear windows with both plugs.
F.c30j = {
  ...F.c130, fwd: 2.54 / 4.57,
  doors: [[4.7, 0.9, "D", undefined, 1.75], [17.1 + 4.57, 0.85, "D", undefined, 1.8]],
  win: [{ z: 0.355, from: 5.91, to: 7.99, pitch: 1.04, w: 0.32, h: 0.32 }, { z: 0.573, from: 14.95 + 4.57, to: 15.84 + 4.57, pitch: 0.89, w: 0.32, h: 0.32 }],
  extras: [sponson(9.6 + 2.54, 16.9 + 2.54, 1.55)],
  overlays: [tpNacelle({ ...T56, blades: 6 })],
};

// ---------- Lockheed C-5M Super Galaxy ----------
// Reference: Wikimedia Commons "Lockheed C-5 Galaxy 3-view line drawing.jpg" (dimensioned: length
// 75.31 m, span 67.89 m, height 19.84 m). High anhedral wing, T-tail with a long bullet on a fin
// rising from a root fairing, upward-hinging nose visor (seam drawn from below the flight-deck
// windows down to the keel), long main-gear sponsons, F138 (CF6-80C2) nacelles on tall pylons,
// upper-deck doors fore and aft, upswept rear with the aft cargo doors.
const c5Visor = ({ sk, D }) => {
  sk.smooth("hl", [[4.3, 0.8 * D], [5.4, 0.55 * D], [6.7, 0.3 * D], [7.9, 0.04 * D]], false);
};
F.c5m = {
  kind: "quad", L0: 70.0, over: 5.31, D: 7.6, W: 7.0, fwd: 0.5, fair: 0, floor: 0.15, upper: 0.746,
  nose: {
    tip: 0.38,
    top: [[0.05, 0.477], [0.1, 0.504], [0.15, 0.548], [0.2, 0.583], [0.25, 0.618], [0.3, 0.645], [0.35, 0.68], [0.4, 0.707], [0.45, 0.733],
      [0.5, 0.768], [0.55, 0.804], [0.6, 0.83], [0.7, 0.918], [0.8, 0.963], [0.9, 0.989], [1.0, 0.998], [1.15, 1]],
    bot: [[0.05, 0.284], [0.1, 0.249], [0.15, 0.223], [0.2, 0.197], [0.3, 0.154], [0.4, 0.119], [0.5, 0.084], [0.6, 0.067], [0.7, 0.041],
      [0.8, 0.024], [0.9, 0.007], [1.0, 0]],
  },
  tail: {
    top: [[3.55, 1], [3.17, 1.036], [2.92, 1.055], [2.42, 1.074], [1.92, 1.076], [1.42, 1.061], [0.92, 1.01], [0.55, 0.95], [0.25, 0.87], [0, 0.8]],
    bot: [[3.25, 0], [2.92, 0.029], [2.67, 0.074], [2.42, 0.127], [2.17, 0.181], [1.92, 0.234], [1.67, 0.297], [1.42, 0.359], [1.17, 0.422],
      [0.92, 0.484], [0.67, 0.555], [0.42, 0.626], [0.17, 0.715], [0.04, 0.768], [0, 0.775]],
  },
  glass: [[[0.64, 0.83], [0.72, 0.895], [0.83, 0.915], [0.83, 0.82], [0.66, 0.81]]],
  doors: [[8.7, 1.0, "D", undefined, 1.8], [15.8, 0.8, "U", undefined, 1.33], [43.4, 0.8, "U", undefined, 1.33], [43.4, 0.9, "D", undefined, 1.6]],
  wing: { le: 22.5, root: 3.5, span: 67.89, cr: 12.1, ct: 3.2, sweep: 28.5, dih: -5.5, bend: 1.0, z: 0.88, t: [0.12, 0.1] },
  eng: { kind: "fan", at: [0.24, 0.47], fwd: 4.3, drop: 3.2, len: 7.0, dia: 2.5, fx: 0.45, cx: 0.85, pyFront: 0.2, pyLead: 0.6, pyTe: 0.3, pyAft: 0.6 },
  fin: { le: 10.4, cr: 9.2, ct: 7.8, h: 8.95, sweep: 36.5, rudder: 0.68 },
  stab: { le: 5.5, z: "T", drop: -0.35, span: 20.95, root: 0.6, cr: 8.5, ct: 1.5, sweep: 34, dih: 0, bullet: [12.0, 0.9] },
  extras: [sponson(22.3, 43.3, 2.3, 0.3)],
  overlays: [c5Visor],
};

// ---------- Antonov An-124 Ruslan ----------
// Reference: Wikimedia Commons "Antonov An-124 3-view.svg" (side, plan and front views; length
// 68.96 m, span 73.3 m, height 20.78 m per Wikipedia). High anhedral wing, conventional tail with
// the stabiliser low on the tail cone and a very tall swept fin, flight deck on top of a long
// sloping nose with the visor seam ahead of it, long main-gear sponsons, four D-18T nacelles on
// pylons well ahead of the wing, upswept rear ending in a point.
F.a124 = {
  kind: "quad", L0: 68.96, over: 0, D: 7.1, W: 7.3, fwd: 0.5, fair: 0, floor: 0.12, upper: 0.78,
  nose: {
    tip: 0.36,
    top: [[0.05, 0.419], [0.1, 0.465], [0.15, 0.503], [0.2, 0.54], [0.25, 0.569], [0.3, 0.596], [0.35, 0.634], [0.4, 0.652], [0.5, 0.699],
      [0.6, 0.736], [0.7, 0.773], [0.8, 0.848], [0.9, 0.941], [1.0, 0.988], [1.1, 0.997], [1.3, 1]],
    bot: [[0.05, 0.146], [0.1, 0.1], [0.15, 0.071], [0.2, 0.043], [0.3, 0.023], [0.4, 0.004], [0.5, -0.006], [0.6, -0.025], [0.7, -0.045],
      [0.8, -0.064], [0.9, -0.06], [1.0, -0.01], [1.1, 0]],
  },
  tail: {
    top: [[3.0, 1], [0.62, 1], [0.5, 0.965], [0.38, 0.946], [0.25, 0.918], [0.12, 0.879], [0, 0.84]],
    bot: [[2.4, 0], [2.25, 0.015], [2.0, 0.08], [1.75, 0.145], [1.5, 0.219], [1.25, 0.292], [1.0, 0.376], [0.75, 0.468], [0.5, 0.58],
      [0.25, 0.691], [0.12, 0.756], [0, 0.83]],
  },
  glass: [[[0.85, 0.8], [0.9, 0.89], [0.98, 0.935], [1.1, 0.94], [1.1, 0.82]]],
  doors: [[11.3, 0.9, "D", undefined, 1.7], [38.7, 0.8, "U", undefined, 1.2], [49.6, 0.8, "U", undefined, 1.2]],
  wing: { le: 21.6, root: 3.65, span: 73.3, cr: 14.8, ct: 4.3, sweep: 32.6, dih: -5, bend: 1.2, z: 0.88, t: [0.13, 0.1] },
  eng: { kind: "fan", at: [0.223, 0.483], fwd: 7.0, drop: 3.1, len: 7.4, dia: 2.9, fx: 0.72, cx: 0.9, pyFront: 0.25, pyLead: 0.5, pyTe: 0.35, pyAft: 0.7 },
  fin: { le: 17.0, cr: 12.5, ct: 4.7, h: 11.0, sweep: 44.6, fillet: [2.0, 0.8], rudder: 0.7 },
  stab: { le: 11.5, z: 0.83, span: 27.0, root: 1.0, cr: 9.5, ct: 3.4, sweep: 30, dih: -3 },
  extras: [sponson(18.3, 43.9, 1.6, 0.45)],
  overlays: [({ sk, D }) => sk.smooth("hl", [[2.2, 0.78 * D], [2.6, 0.5 * D], [3.2, 0.25 * D], [3.9, 0.03 * D]], false)],
};

// ---------- Ilyushin Il-76MD ----------
// Reference: Wikimedia Commons "Ilyushin Il-76.svg" (side, plan and front views; length 46.59 m,
// span 50.5 m, height 14.76 m per Wikipedia). High anhedral wing on a dorsal fairing, T-tail
// with a large bullet, glazed navigator's station in the lower nose with the radome bulge under
// the chin, long main-gear sponsons, four long D-30KP nacelles on pylons, upswept rear with the
// tail turret position at the end.
F.il76 = {
  kind: "quad", L0: 43.0, over: 3.59, D: 4.86, W: 4.8, fwd: 0.5, fair: 0, floor: 0.21,
  nose: {
    tip: 0.44,
    top: [[0.05, 0.515], [0.1, 0.55], [0.15, 0.59], [0.2, 0.62], [0.3, 0.675], [0.4, 0.733], [0.5, 0.808], [0.6, 0.888], [0.7, 0.94],
      [0.8, 0.972], [0.9, 0.99], [1.1, 1]],
    bot: [[0.05, 0.36], [0.1, 0.315], [0.2, 0.23], [0.3, 0.16], [0.4, 0.088], [0.5, 0.03], [0.6, -0.005], [0.7, -0.032], [0.85, -0.045],
      [1.0, -0.02], [1.2, 0.022], [1.4, 0.012], [1.65, 0]],
  },
  tail: {
    top: [[3.1, 0.967], [2.0, 1.0], [1.0, 1.1], [0.3, 1.23], [0, 1.3]],
    bot: [[3.09, 0.008], [2.67, 0.062], [2.26, 0.107], [1.85, 0.23], [1.44, 0.346], [1.03, 0.475], [0.62, 0.609], [0.21, 0.745], [0, 0.84]],
  },
  glass: [
    [[0.47, 0.79], [0.56, 0.87], [0.66, 0.89], [0.66, 0.77], [0.52, 0.765]],
    [[0.68, 0.895], [0.84, 0.905], [0.84, 0.77], [0.68, 0.77]],
    // navigator's glazed nose
    [[0.13, 0.43], [0.52, 0.42], [0.52, 0.2], [0.35, 0.16], [0.2, 0.25]],
  ],
  doors: [[8.1, 1.0, "D", undefined, 1.9]],
  wing: { le: 13.3, root: 2.42, span: 50.5, cr: 10.5, ct: 3.0, sweep: 33.6, dih: -3, z: 1.0, t: [0.13, 0.1] },
  eng: { kind: "fan", at: [0.161, 0.354], fwd: 4.6, drop: 2.15, len: 5.8, dia: 2.1, style: "long", fx: 0.9, plug: 0.4, pyFront: 0.35, pyTe: 0.45, pyAft: 0.8 },
  fin: { le: 10.1, cr: 8.6, ct: 5.9, h: 7.8, sweep: 41.4, rudder: 0.7 },
  stab: { le: 4.5, z: "T", drop: -0.14, span: 17.4, root: 0.5, cr: 5.0, ct: 2.6, sweep: 34, dih: -2, bullet: [8.0, 0.55] },
  extras: [
    ({ sk }) => sk.smooth("hull", [[8.5, 4.84, "c"], [11, 5.28], [13, 5.54], [16, 5.69], [19, 5.56], [21, 5.33], [23, 4.92], [25, 4.72, "c"]], false),
    ({ sk, L, top, f }) => {
      // dorsal fin running forward from the fin
      const a = L - 15.0, b = L - 8.0, za = top(a), z1 = 7.0, te = L - f.fin.le + f.fin.cr - 0.3;
      const c = [[a, za - 0.01, "c"], [a + 2.2, za + 0.15], [a + 4.6, za + 0.75], [a + 6.2, za + 1.6], [b, z1, "c"]];
      sk.smooth("fin", [...c, [b + 0.8, z1 - 0.3, "c"], [te, top(te) + 0.1, "c"], [te, top(te) - 0.4, "c"], [a, za - 0.4, "c"]], true, ' style="stroke:none"');
      sk.smooth("fin", c, false, ' style="fill:none"');
    },
    ({ sk }) => sk.smooth("hull", [[13.2, 0.73, "c"], [14.2, 1.2], [17, 1.36], [23, 1.34], [27.5, 1.15], [29.6, 1.0, "c"], [26, -0.45], [22, -0.78], [17, -0.7], [14.2, -0.1]]),
  ],
  overlays: [
    // tail turret glazing and the radome joint
    ({ sk, L, D }) => {
      sk.smooth("glass", [[L - 0.9, 1.2 * D, "c"], [L - 0.1, 1.24 * D], [L + 0.15, 1.05 * D], [L - 0.2, 0.9 * D, "c"], [L - 0.9, 0.95 * D, "c"]]);
      sk.poly("strut", [[L + 0.1, 1.0 * D], [L + 1.0, 1.0 * D], [L + 1.0, 0.985 * D], [L + 0.1, 0.985 * D]]);
    },
  ],
};

export const families = F;
export const types = {
  C17: "c17", K35R: "k35r", E3TF: "e3", E6: "e6", B52: "b52", C130: "c130", C30J: "c30j", C5M: "c5m", A124: "a124", IL76: "il76",
};
