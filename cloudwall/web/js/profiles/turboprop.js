// Twin turboprops. Format: see ../profiles.js.
const F = {};

// A dorsal fin blending into the fin's leading edge: from the crown at s0 (from the tail end,
// metres, negative) up to the leading-edge point (s1, z1). Filled without a stroke first, then
// stroked along the outside only, so it merges with the fin and fuselage behind it.
const dorsal = (s0, s1, z1, bulge = 0.5) => ({ sk, at, top, f, L }) => {
  const a = at(s0), b = at(s1), za = top(a), m = (t, u) => [lerp(a, b, t), za + (z1 - za) * u];
  const te = L - f.fin.le + f.fin.cr - 0.25;
  const curve = [[a - 0.3, za - 0.01, "c"], m(0.3, 0.08 * bulge + 0.04), m(0.62, 0.22 + 0.2 * bulge), m(0.86, 0.55 + 0.1 * bulge), [b, z1, "c"]];
  sk.smooth("fin", [...curve, [b + 0.5, z1 - 0.2, "c"], [te, top(te) + 0.08, "c"], [te, top(te) - 0.4, "c"], [a - 0.3, za - 0.4, "c"]], true, ' style="stroke:none"');
  sk.smooth("fin", curve, false, ' style="fill:none"');
};
const lerp = (x, y, t) => x + (y - x) * t;
// Nacelle drawn from a side outline: spinner tip at the local leading edge minus fwd, axis drop
// below the local chord; outline points [u (m aft of the spinner tip), dz (m above the axis)].
const nacelle = (o) => ({ sk, sec, prop }) => {
  for (const e of o.at) {
    const q = sec(e), s0 = q.le - o.fwd, zc = q.z - o.drop;
    sk.smooth("nac", o.outline.map(([u, dz, fl]) => [s0 + u, zc + dz, fl]));
    sk.poly("hl", [[s0 + o.sp, zc + o.sr], [s0 + o.sp, zc - o.sr]], false);
    if (o.inlet) sk.ellipse("inlet", s0 + o.inlet[0], zc + o.inlet[1], o.inlet[2], o.inlet[3]);
    prop(sk, s0 + o.sp * 0.7, zc, o.prop, o.blades);
  }
};

// A door drawn to its real height (the renderer's door kinds assume airliner proportions).
const door = (s, w, z0, h, r = 0.12) => ({ sk, at }) => {
  const a = at(s) - w / 2, b = at(s) + w / 2;
  sk.smooth("door", [[a + r, z0, "l"], [b - r, z0], [b, z0 + r, "l"], [b, z0 + h - r], [b - r, z0 + h, "l"], [a + r, z0 + h], [a, z0 + h - r, "l"], [a, z0 + r]]);
};
// PT6A exhaust stack: a short stub out of the nacelle side, turned aft, behind the propeller.
const stacks = (s, z, l = 0.42, h = 0.2) => ({ sk, sec, f }) => {
  for (const eta of f.eng.at) {
    const q = sec(eta), s0 = q.le - f.eng.fwd + s, zc = q.z - f.eng.drop + z;
    sk.smooth("core", [[s0, zc + h / 2, "c"], [s0 + l * 0.7, zc + h * 0.55], [s0 + l, zc + h * 0.1, "c"], [s0 + l * 0.75, zc - h * 0.45], [s0, zc - h / 2, "c"]]);
    sk.ellipse("inlet", s0 + l * 0.93, zc - h * 0.05, 0.04, h * 0.42);
  }
};

// Parts traced off a type's drawing: [class, points]. Classes: strut (a filled outline: antennas),
// door (an outline), glassdoor (a pane), hl (a panel line), dot ([s, z, rx, ry]: a small dark port).
const marks = (parts) => ({ sk }) => {
  for (const [cls, p] of parts) {
    if (cls === "dot") sk.ellipse("inlet", ...p);
    else if (cls === "strut") sk.poly("strut", p);
    else if (cls === "door") sk.smooth("door", p);
    else if (cls === "glassdoor") sk.smooth("glass", p);
    else sk.poly("hl", p, false);
  }
};

// ---------- De Havilland Canada Dash 8-400 (Q400) ----------
// Published dimensions (Wikipedia): length 32.81 m, span 28.42 m, height 8.34 m, fuselage 2.69 m,
// propellers 4.11 m (six blades), main gear track 8.79 m (so the nacelles sit 4.4 m out). Station
// and depth of the nacelles, doors, window pitch and dorsal checked against near side-on Commons
// photos ("Hamburg Airport Wideroe ... LN-WDR (DSC08713).jpg", "Dash 8-Q400 - Porter Airlines"). Long slender nose, wing on top of the
// fuselage, deep nacelles hanging under the wing that carry the main gear and run well past the
// trailing edge, tall T-tail on a long dorsal fin.
F.dh8d = {
  kind: "turboprop", L0: 32.5, over: 0.31, D: 2.69, W: 2.69, fwd: 0.5, fair: 0, floor: 0.2,
  nose: {
    tip: 0.36,
    top: [[0.06, 0.45], [0.15, 0.51], [0.3, 0.575], [0.5, 0.645], [0.7, 0.72], [0.85, 0.8], [1.0, 0.88], [1.15, 0.94], [1.35, 0.975], [1.6, 0.995], [1.9, 1]],
    bot: [[0.06, 0.25], [0.15, 0.19], [0.3, 0.13], [0.5, 0.08], [0.7, 0.045], [0.9, 0.02], [1.2, 0.004], [1.5, 0]],
  },
  tail: {
    top: [[3.2, 1], [2.4, 0.985], [1.6, 0.95], [0.8, 0.9], [0, 0.84]],
    bot: [[3.9, 0], [3.4, 0.05], [2.8, 0.14], [2.2, 0.25], [1.6, 0.37], [1.0, 0.5], [0.5, 0.62], [0.15, 0.71], [0, 0.75]],
  },
  glass: [
    [[0.9, 0.735], [1.04, 0.845], [1.2, 0.86], [1.2, 0.725]],
    [[1.23, 0.865], [1.42, 0.87], [1.42, 0.725], [1.23, 0.725]],
    [[1.46, 0.865], [1.62, 0.865], [1.66, 0.79], [1.62, 0.725], [1.46, 0.725]],
  ],
  doors: [[5.4, 0.86, "D", undefined, 1.75], [-8.9, 0.76, "D", undefined, 1.75]],
  win: [{ z: 0.57, from: 6.6, to: -9.7, pitch: 0.52, w: 0.24, h: 0.36 }],
  wing: { le: 13.6, root: 1.35, span: 28.42, cr: 2.95, ct: 1.3, sweep: 3, dih: 2.5, z: 1.06, t: [0.18, 0.13] },
  fin: { le: 6.4, cr: 4.4, ct: 2.6, h: 4.65, sweep: 31, rudder: 0.66 },
  stab: { le: 1.0, z: "T", drop: 0.15, span: 8.5, root: 0.25, cr: 2.3, ct: 1.3, sweep: 20, dih: 0, bullet: [2.4, 0.3] },
  extras: [dorsal(-11.0, -5.74, 3.6, 0.3)],
  overlays: [nacelle({
    at: [0.237], fwd: 3.0, drop: 0.1, sp: 0.5, sr: 0.38, prop: 4.11, blades: 6, inlet: [0.75, -0.6, 0.07, 0.14],
    outline: [[0, 0, "c"], [0.25, 0.25], [0.5, 0.38, "c"], [0.6, 0.47], [1.5, 0.45], [3.0, 0.4], [4.6, 0.3], [6.2, 0.08], [7.5, -0.28], [8.2, -0.55, "c"],
      [7.2, -0.92], [5.6, -1.15], [3.6, -1.2], [2.0, -1.15], [1.1, -0.95], [0.7, -0.7], [0.55, -0.45], [0.5, -0.38, "c"], [0.25, -0.25]],
  })],
};
// Dash 8-300: shorter (25.68 m), smaller nacelles, four-blade 3.96 m propellers, span 27.43 m.
F.dh8c = {
  ...F.dh8d, L0: 25.35, over: 0.33,
  doors: [[4.9, 0.76, "D", undefined, 1.65], [-7.0, 0.76, "D", undefined, 1.65]],
  win: [{ z: 0.57, from: 6.0, to: -7.8, pitch: 0.52, w: 0.24, h: 0.36 }],
  wing: { ...F.dh8d.wing, le: 10.4, span: 27.43, cr: 2.6 },
  fin: { ...F.dh8d.fin, le: 6.0, cr: 4.2, h: 4.3 },
  extras: [dorsal(-9.6, -5.4, 3.5, 0.3)],
  overlays: [nacelle({
    at: [0.24], fwd: 2.6, drop: 0.1, sp: 0.45, sr: 0.34, prop: 3.96, blades: 4, inlet: [0.68, -0.54, 0.06, 0.12],
    outline: [[0, 0, "c"], [0.22, 0.22], [0.45, 0.34, "c"], [0.54, 0.42], [1.3, 0.4], [2.6, 0.36], [4.0, 0.26], [5.3, 0.06], [6.4, -0.24], [7.0, -0.48, "c"],
      [6.1, -0.82], [4.8, -1.03], [3.1, -1.08], [1.7, -1.03], [0.95, -0.85], [0.6, -0.62], [0.49, -0.4], [0.45, -0.34, "c"], [0.22, -0.22]],
  })],
};

// ---------- Beechcraft King Air 200 / 350 ----------
// Reference: Wikimedia Commons "Beechcraft B200 King Air 3-view line drawing.gif" (side and plan
// views; length 13.34 m, span 16.61 m per Wikipedia). Low wing, nacelles reaching past the trailing
// edge, PT6A exhaust stacks behind the props, swept T-tail on a long dorsal. The 350 (B300) adds
// 0.86 m of cabin (two more windows), a longer wing with winglets and four-blade props
// (published dimensions: length 14.22 m, span 17.65 m).
F.be20 = {
  kind: "turboprop", L0: 11.86, over: 1.48, D: 1.8, W: 1.55, fwd: 0.6, fair: 0,
  nose: {
    tip: 0.3,
    top: [[0.14, 0.44], [0.28, 0.5], [0.42, 0.544], [0.56, 0.589], [0.69, 0.628], [0.97, 0.7], [1.11, 0.733], [1.25, 0.794], [1.39, 0.894],
      [1.53, 0.967], [1.67, 1]],
    bot: [[0.14, 0.156], [0.28, 0.106], [0.42, 0.083], [0.56, 0.061], [0.69, 0.05], [0.97, 0.033], [1.11, 0.028], [1.39, 0.011], [1.53, 0]],
  },
  tail: {
    top: [[2.6, 1], [2.37, 0.975], [1.2, 0.84], [0, 0.706]],
    bot: [[2.98, 0.006], [2.7, 0.033], [2.14, 0.117], [1.59, 0.2], [1.03, 0.283], [0.48, 0.367], [0.06, 0.433], [0, 0.44]],
  },
  glass: [
    [[1.49, 0.905], [1.4, 0.93], [1.19, 0.74], [1.27, 0.66]],
    [[1.535, 0.68], [1.515, 0.84], [1.35, 0.68]],
    [[1.805, 0.856], [1.62, 0.856], [1.567, 0.8], [1.567, 0.7], [1.6, 0.661], [1.805, 0.661]],
  ],
  win: [{ z: 0.727, from: 4.2, to: 6.16, pitch: 0.49, w: 0.36, h: 0.36 }, { z: 0.727, from: -3.93, to: -3.93, w: 0.45, h: 0.3 }],
  wing: { le: 3.88, root: 0.75, span: 16.61, cr: 2.1, ct: 1.1, sweep: 1, dih: 6, z: 0.11, t: [0.16, 0.12] },
  eng: { kind: "prop", at: [0.228], fwd: 2.7, drop: -0.17, len: 5.26, dia: 0.94, spinner: 0.07, tailZ: -0.85, belly: 1.0, prop: 2.5, blades: 3 },
  fin: { le: 2.21, cr: 2.3, ct: 1.8, h: 1.57, sweep: 38.8, fillet: [2.05, 0.54, "l"], rudder: 0.62 },
  stab: { le: 0.65, z: "T", drop: -0.08, span: 5.61, root: 0.1, cr: 1.75, ct: 0.8, sweep: 18, dih: 0, bullet: [1.3, 0.16] },
  extras: [door(-4.8, 0.72, 0.25, 1.38)],
  overlays: [stacks(1.45, 0.2)],
};
F.b350 = {
  ...F.be20,
  win: [{ z: 0.727, from: 4.2, to: 7.14, pitch: 0.49, w: 0.36, h: 0.36 }, { z: 0.727, from: -3.93, to: -3.93, w: 0.45, h: 0.3 }],
  wing: { ...F.be20.wing, span: 17.1 },
  tip: { h: 0.45, sweep: 35, top: 0.28, base: 0.9, blend: 0.1 },
  eng: { ...F.be20.eng, blades: 4, prop: 2.67 },
};

// ---------- Beechcraft King Air 90 / F90 / 100 ----------
// Reference: Wikimedia Commons "Beechcraft U-21A Ute 3-view line drawing.png", a dimensioned
// manufacturer's drawing of the King Air 90 airframe (length 35 ft 6 in, span 45 ft 10.5 in, height
// 14 ft 2.56 in, propellers 7 ft 9 in, main gear track 12 ft 9 in): its side view gives the 90's
// tail cone, conventional tail with dorsal fillet and dihedral tailplane, and the wing and nacelle
// stations. Published dimensions (Wikipedia): C90 length 10.82 m, span 15.32 m; F90 12.13 m long,
// 14.00 m span; 100 series 12.17 m long, 14.0 m span, 4.70 m high. Windows and door checked against
// Commons photos: "Beechcraft King Air C90GTx Sideview.jpg" and "Beechcraft King Air F90 N3809C
// MD1.jpg" (three round cabin windows ahead of the airstair door, one behind it, on the left side),
// "C-GSYN Adlair Aviation Ltd Beechcraft King Air 100 (BE10) 03.JPG" and "Beechcraft King Air A100
// 5R-MHC.jpg" (the 200's five). The 90 shares the 200's nose, cabin section and nacelles, so those
// are the 200's above; its cabin is 1.35 m shorter, 60 % of it ahead of the wing as the 200 drawing
// has it. The F90 is the 90's fuselage and wing with the 200's T-tail; the 100 is the 200's
// fuselage with a conventional tail like the 90's, taller (its 4.70 m height less the 200's 4.37 m).
const KA90_TAIL = {
  top: [[2.4, 1], [2.1, 0.97], [1.0, 0.84], [0, 0.73]],
  bot: [[3.1, 0], [2.57, 0.08], [2.0, 0.17], [1.37, 0.28], [0.7, 0.37], [0.14, 0.42], [0, 0.44]],
};
F.be9l = {
  ...F.be20, L0: 10.17, over: 0.65,
  tail: KA90_TAIL,
  win: [{ z: 0.727, from: 4.15, to: 5.13, pitch: 0.49, w: 0.36, h: 0.36 }, { z: 0.727, from: -3.75, to: -3.75, w: 0.45, h: 0.3 }],
  wing: { ...F.be20.wing, le: 3.0, span: 15.32 },
  eng: { ...F.be20.eng, at: [0.17], fwd: 2.57, len: 5.12, prop: 2.29, blades: 4 },
  fin: { le: 1.65, cr: 1.68, ct: 0.9, h: 1.78, sweep: 40.6, fillet: [0.8, 0.35], rudder: 0.62 },
  stab: { le: 2.03, z: 0.7, span: 5.25, root: 0.3, cr: 1.75, ct: 1.2, sweep: 13, dih: 9 },
  extras: [door(-4.42, 0.72, 0.25, 1.38)],
};
F.be9t = {
  ...F.be9l, L0: 10.65, over: F.be20.over,
  tail: F.be20.tail, fin: F.be20.fin, stab: F.be20.stab,
  win: [F.be9l.win[0], { ...F.be9l.win[1], from: -4.23, to: -4.23 }],
  wing: { ...F.be9l.wing, span: 14.0 },
  extras: [door(-4.9, 0.72, 0.25, 1.38)],
};
F.be10 = {
  ...F.be20, L0: 11.52, over: 0.65,
  tail: KA90_TAIL,
  win: [F.be20.win[0], { ...F.be20.win[1], from: -3.59, to: -3.59 }],
  wing: { ...F.be20.wing, span: 14.0 },
  eng: { ...F.be20.eng, blades: 4 },
  fin: { ...F.be9l.fin, le: 1.75, cr: 1.8, ct: 0.95, h: 2.0 },
  stab: { ...F.be9l.stab, le: 2.1 },
  extras: [door(-4.46, 0.72, 0.25, 1.38)],
};

// ---------- ATR 72 ----------
// Reference: Wikimedia Commons "ATR family v1.0.png" (dimensioned side, plan and front views of
// the ATR 72 and 42; length 27.17 m, span 27.05 m, height 7.65 m). High wing on a raised
// fairing, short PW127 nacelles, main-gear sponsons on the lower fuselage, T-tail on a large
// dorsal fillet, forward cargo door and aft passenger door on the left side. AT72 (-200/-210)
// has four-blade propellers, AT76 (-600) six-blade (both 3.93 m).
const atrSponson = ({ sk }) => {
  sk.smooth("hull", [[9.8, 0.35, "c"], [10.3, 0.85], [12.0, 1.0], [14.0, 0.75], [15.25, 0.2, "c"], [13.5, -0.18], [11.5, -0.2], [10.2, -0.08]]);
};
// Traced off the same Commons drawing's side view (47 mm a pixel): the radome joint and its latches,
// the two nose ports, the antenna behind the flight deck, the exit with its window ahead of the
// cabin windows, the blade antenna under the tail cone, the gear-bay door, vent and scoop on the
// sponson, and the fin's stepped rudder hinge and trim-tab line.
const ATR_TRACED = [
["hl", [[0.54,1.236], [0.573,0.973], [0.573,0.385]]],
["hl", [[0.573,0.761], [0.729,0.761]]],
["hl", [[0.578,0.376], [0.705,0.376]]],
["dot", [1.504,1.297,0.122,0.103]],
["dot", [1.297,1.119,0.08,0.075]],
["strut", [[3.422,2.585,"c"], [3.487,2.89,"c"], [3.6,2.89,"c"], [3.675,2.585,"c"]]],
["door", [[5.922,2.091,"l"], [6.251,2.091], [6.345,1.998,"l"], [6.345,1.151], [6.251,1.058,"l"], [5.922,1.058], [5.828,1.151,"l"], [5.828,1.998]]],
["glassdoor", [[6.087,1.81,"l"], [6.133,1.81], [6.204,1.739,"l"], [6.204,1.504], [6.133,1.433,"l"], [6.087,1.433], [6.016,1.504,"l"], [6.016,1.739]]],
["strut", [[19.599,0.235,"c"], [19.787,0.024,"c"], [19.928,0.0,"c"], [19.834,0.211,"c"]]],
["hl", [[12.056,0.211], [12.056,0.55], [12.088,0.611], [12.634,0.611], [12.652,0.588], [12.652,0.211], [12.878,0.188], [12.916,-0.155]]],
["hl", [[11.915,0.155], [11.9,-0.165]]],
["door", [[11.449,0.174,"l"], [11.506,0.174], [11.524,0.155,"l"], [11.524,-0.014], [11.506,-0.033,"l"], [11.449,-0.033], [11.43,-0.014,"l"], [11.43,0.155]]],
["door", [[10.161,0.39,"c"], [10.443,0.418,"c"], [10.457,0.211,"c"]]],
["hl", [[24.872,2.773], [24.919,2.867], [24.933,2.994], [24.745,3.088], [24.745,3.196], [25.483,4.864], [25.568,4.935], [25.591,5.109], [25.859,5.72], [25.897,5.748], [26.038,5.71]]],
["hl", [[26.517,5.076], [25.709,2.585]]]
];
F.at72 = {
  kind: "turboprop", L0: 27.17, over: 0, D: 2.62, W: 2.87, fwd: 0.5, fair: 0, floor: 0.21,
  nose: {
    tip: 0.31,
    top: [[0.05, 0.43], [0.1, 0.48], [0.15, 0.5], [0.2, 0.535], [0.3, 0.59], [0.4, 0.645], [0.5, 0.73], [0.6, 0.82], [0.7, 0.89],
      [0.8, 0.945], [0.9, 0.965], [1.0, 0.982], [1.1, 0.995], [1.3, 1]],
    bot: [[0.05, 0.216], [0.1, 0.179], [0.2, 0.142], [0.3, 0.105], [0.4, 0.069], [0.5, 0.05], [0.6, 0.031], [0.7, 0.02], [0.8, 0.01], [0.9, 0]],
  },
  tail: {
    top: [[3.6, 1], [2.5, 0.971], [2, 0.948], [1.5, 0.907], [1, 0.875], [0.5, 0.835], [0, 0.784]],
    bot: [[3.0, 0.007], [2.5, 0.074], [2, 0.194], [1.5, 0.297], [1, 0.417], [0.5, 0.52], [0.25, 0.589], [0, 0.659]],
  },
  glass: [
    [[0.676, 0.62], [0.745, 0.79], [0.88, 0.795], [0.88, 0.62]],
    [[0.9, 0.62], [0.9, 0.795], [1.03, 0.795], [1.03, 0.62]],
    [[1.065, 0.62], [1.065, 0.795], [1.17, 0.795], [1.214, 0.72], [1.2, 0.62]],
  ],
  doors: [[-7.14, 0.75]],
  win: [{ z: 0.565, from: 6.52, to: -8.2, pitch: 0.545, w: 0.21, h: 0.31 }],
  wing: { le: 11.5, root: 1.43, span: 27.05, cr: 2.57, ct: 1.45, sweep: 3, dih: 1, z: 1.05, t: [0.18, 0.13] },
  eng: { kind: "prop", at: [0.217], fwd: 2.8, drop: 0.45, len: 6.5, dia: 1.42, spinner: 0.08, tailZ: -0.1, belly: 0.95, prop: 3.93, blades: 4 },
  fin: { le: 4.41, cr: 3.2, ct: 2.15, h: 4.05, sweep: 27.7, rudder: 0.62 },
  stab: { le: 2.0, z: "T", drop: 0.6, span: 7.31, root: 0.2, cr: 1.6, ct: 1.0, sweep: 10, dih: 0 },
  extras: [dorsal(-8.67, -3.2, 4.7, 0.9), atrSponson, door(4.33, 1.3, 0.45, 1.65), marks(ATR_TRACED)],
};
F.at76 = { ...F.at72, eng: { ...F.at72.eng, blades: 6 } };

// ---------- Beechcraft 1900D ----------
// Published dimensions only (Wikipedia / Beechcraft data): length 17.63 m, span 17.67 m, height
// 4.72 m, cabin 1.80 m high. King Air family nose and nacelles (measured above, in metres) on a
// longer fuselage whose stand-up cabin roof rises behind the flight deck; winglets, T-tail with
// tailets under the stabiliser tips, stabilons and ventral strakes on the tail cone.
const b190Tail = ({ sk, L, D, f, tan }) => {
  const t = f.stab, z = D + f.fin.h - (t.drop ?? 0.1), s0 = L - t.le + (t.span / 2 - t.root) * tan(t.sweep);
  // tailets: small fins hanging under the stabiliser tips
  sk.smooth("fin", [[s0 + 0.2, z + 0.03, "c"], [s0 + 0.5, z - 0.5, "c"], [s0 + 0.78, z - 0.5, "c"], [s0 + 0.8, z + 0.03, "c"]]);
  // stabilons ahead of the fin and a ventral strake under the tail cone
  sk.smooth("stab", [[L - 4.0, 0.64 * D, "c"], [L - 3.2, 0.69 * D], [L - 2.6, 0.78 * D, "c"], [L - 2.9, 0.65 * D], [L - 3.4, 0.62 * D]]);
  sk.smooth("fin", [[L - 3.0, 0.3 * D, "c"], [L - 1.8, 0.24 * D, "c"], [L - 1.4, 0.36 * D, "c"], [L - 1.8, 0.4 * D, "c"]]);
};
F.b190 = {
  kind: "turboprop", L0: 16.4, over: 1.23, D: 2.15, W: 1.6, fwd: 0.5, fair: 0,
  nose: {
    tip: 0.25,
    top: [[0.117, 0.368], [0.234, 0.419], [0.352, 0.455], [0.469, 0.493], [0.578, 0.526], [0.812, 0.586], [0.929, 0.614], [1.046, 0.665],
      [1.163, 0.748], [1.281, 0.809], [1.398, 0.837], [1.55, 0.842], [1.7, 0.86], [1.82, 0.93], [1.95, 0.985], [2.05, 1]],
    bot: [[0.117, 0.131], [0.234, 0.089], [0.352, 0.069], [0.469, 0.051], [0.578, 0.042], [0.812, 0.028], [0.929, 0.023], [1.163, 0.009], [1.281, 0]],
  },
  tail: {
    top: [[3.4, 1], [3.0, 0.975], [2.6, 0.92], [2.2, 0.85], [1.0, 0.75], [0, 0.66]],
    bot: [[3.3, 0], [2.8, 0.06], [2.2, 0.14], [1.6, 0.22], [1.0, 0.3], [0.5, 0.36], [0, 0.42]],
  },
  glass: [
    [[1.247, 0.757], [1.172, 0.778], [0.996, 0.619], [1.063, 0.552]],
    [[1.285, 0.569], [1.268, 0.703], [1.13, 0.569]],
    [[1.511, 0.716], [1.356, 0.716], [1.311, 0.67], [1.311, 0.586], [1.339, 0.553], [1.511, 0.553]],
  ],
  win: [{ z: 0.6, from: 4.35, to: -5.0, pitch: 0.66, w: 0.36, h: 0.46 }],
  wing: { le: 5.3, root: 0.8, span: 16.8, cr: 2.45, ct: 1.1, sweep: 2, dih: 6, z: 0.1, t: [0.16, 0.12] },
  tip: { h: 0.42, sweep: 35, top: 0.25, base: 0.9, blend: 0.1 },
  eng: { kind: "prop", at: [0.24], fwd: 2.9, drop: -0.2, len: 5.8, dia: 1.0, spinner: 0.07, tailZ: -0.8, belly: 1.0, prop: 2.78, blades: 4 },
  fin: { le: 3.1, cr: 2.8, ct: 1.6, h: 2.0, sweep: 40, rudder: 0.65 },
  stab: { le: 0.8, z: "T", drop: -0.05, span: 5.63, root: 0.1, cr: 1.7, ct: 0.9, sweep: 18, dih: 0, bullet: [1.3, 0.16] },
  extras: [dorsal(-6.4, -2.6, 2.75, 0.6), door(3.8, 0.66, 0.3, 1.72), door(-4.3, 1.32, 0.42, 1.35)],
  overlays: [stacks(1.5, 0.2), b190Tail],
};

// ---------- Fairchild Swearingen Metro III / 23 ----------
// Published dimensions only (Wikipedia): length 18.09 m, span 17.37 m, height 5.08 m, cabin
// 1.45 m high. Very long thin fuselage with a long pointed nose, low wing, slim TPE331 nacelles
// riding on the wing, cruciform tail (stabiliser part-way up the swept fin), four-blade props.
F.sw4 = {
  kind: "turboprop", L0: 17.4, over: 0.69, D: 1.72, W: 1.65, fwd: 0.5, fair: 0,
  nose: {
    tip: 0.36,
    top: [[0.1, 0.42], [0.3, 0.5], [0.6, 0.58], [0.9, 0.65], [1.2, 0.72], [1.5, 0.79], [1.75, 0.88], [1.95, 0.95], [2.15, 0.99], [2.4, 1]],
    bot: [[0.1, 0.24], [0.3, 0.17], [0.6, 0.11], [0.9, 0.07], [1.2, 0.04], [1.6, 0.015], [2.0, 0]],
  },
  tail: {
    top: [[3.5, 1], [2.5, 0.97], [1.5, 0.9], [0.7, 0.84], [0, 0.78]],
    bot: [[4.5, 0], [3.8, 0.07], [3.0, 0.17], [2.2, 0.28], [1.4, 0.4], [0.7, 0.52], [0, 0.62]],
  },
  glass: [
    [[1.55, 0.765], [1.75, 0.85], [1.95, 0.91], [1.95, 0.72], [1.62, 0.71]],
    [[2.0, 0.92], [2.25, 0.935], [2.28, 0.74], [2.0, 0.73]],
  ],
  win: [{ z: 0.62, from: 5.2, to: -5.4, pitch: 0.82, w: 0.3, h: 0.36 }],
  wing: { le: 7.4, root: 0.8, span: 17.37, cr: 2.5, ct: 1.0, sweep: 2, dih: 5, z: 0.1, t: [0.15, 0.11] },
  eng: { kind: "prop", at: [0.2], fwd: 2.0, drop: -0.42, len: 5.0, dia: 0.72, spinner: 0.08, tailZ: -0.2, belly: 1.0, prop: 2.69, blades: 4 },
  fin: { le: 3.7, cr: 3.0, ct: 1.3, h: 2.66, sweep: 42, rudder: 0.66 },
  stab: { le: 2.3, fz: 0.3, span: 4.86, root: 0.15, cr: 1.5, ct: 0.75, sweep: 15, dih: 0 },
  extras: [dorsal(-6.2, -2.95, 2.25, 0.4), door(4.3, 0.64, 0.25, 1.35), door(-5.0, 1.3, 0.3, 1.25)],
};

// Square-cornered cabin windows (the renderer's window rows are round-ended): centres s (metres),
// width w, height h, centre height z above the keel, corner radius r.
const panes = (list, w, h, z, r = 0.07) => ({ sk }) => {
  for (const s of list) {
    const a = s - w / 2, b = s + w / 2, z0 = z - h / 2, z1 = z + h / 2;
    sk.smooth("glass", [[a + r, z0, "l"], [b - r, z0], [b, z0 + r, "l"], [b, z1 - r], [b - r, z1, "l"], [a + r, z1], [a, z1 - r, "l"], [a, z0 + r]]);
  }
};

// ---------- Beechcraft 99 Airliner ----------
// Published dimensions (Wikipedia, Model 99A): length 44 ft 6.75 in (13.58 m), span 45 ft 10.5 in
// (13.98 m), height 14 ft 4.33 in (4.38 m). It has the Queen Air's wing and the King Air's engines
// and nacelles (so those are the King Air 90's above, measured off the U-21A drawing of the same
// wing, 45 ft 10.5 in span, and nacelles), on a longer cabin behind its own long, drooping nose.
// No three-view on Commons: stations measured off the near side-on Beech factory photo "Beechcraft
// - 99 - Airliner.jpg" (scaled by the overall length) and heights off "Beech 99 (287390412).jpg",
// with "Jamaica Air Shuttle Beechcraft Model 99 In Flight.jpg" for the left side's openings: a
// forward exit with its window, six square cabin windows, the wide airstair-and-cargo door behind
// the wing and a round window aft of it; swept fin on a long low dorsal, dihedral tailplane low on
// the tail cone, three-blade propellers. Tailplane span is estimated from the photos.
F.be99 = {
  kind: "turboprop", L0: 13.0, over: 0.58, D: 1.78, W: 1.6, fwd: 0.4, fair: 0,
  nose: {
    tip: 0.31,
    top: [[0.05, 0.38], [0.15, 0.43], [0.3, 0.47], [0.6, 0.53], [0.9, 0.58], [1.2, 0.63], [1.5, 0.68], [1.72, 0.72], [1.95, 0.88], [2.12, 0.97], [2.3, 1]],
    bot: [[0.05, 0.22], [0.15, 0.15], [0.3, 0.1], [0.6, 0.055], [1.0, 0.025], [1.4, 0.008], [1.8, 0]],
  },
  tail: {
    top: [[2.6, 1], [2.2, 0.97], [1.1, 0.84], [0, 0.72]],
    bot: [[3.4, 0], [2.8, 0.07], [2.1, 0.18], [1.4, 0.29], [0.7, 0.38], [0.15, 0.43], [0, 0.45]],
  },
  glass: [
    [[1.66, 0.7], [1.93, 0.9], [2.01, 0.93], [2.02, 0.86], [1.84, 0.67]],
    [[2.05, 0.9], [2.24, 0.9], [2.27, 0.84], [2.27, 0.71], [2.05, 0.71], [1.95, 0.8]],
  ],
  wing: { le: 5.35, root: 0.8, span: 13.98, cr: 2.2, ct: 1.1, sweep: 1, dih: 6, z: 0.11, t: [0.16, 0.12] },
  eng: { ...F.be9l.eng, prop: 2.36, blades: 3 },
  fin: { le: 2.17, cr: 2.2, ct: 1.0, h: 1.8, sweep: 44, fillet: [1.5, 0.3], rudder: 0.66 },
  stab: { le: 1.74, z: 0.74, span: 5.4, root: 0.3, cr: 1.6, ct: 1.0, sweep: 15, dih: 7 },
  extras: [
    panes([4.34, 5.44, 5.94, 6.44, 6.94, 7.44, 7.94], 0.4, 0.4, 1.32),
    // the forward exit round its window, the airstair-and-cargo door, the round window behind it
    door(4.34, 0.62, 0.78, 0.92), door(8.85, 1.1, 0.25, 1.32),
    ({ sk }) => sk.ellipse("glass", 9.8, 1.32, 0.14, 0.12),
  ],
  overlays: [stacks(1.45, 0.2)],
};

// ---------- Piaggio P.180 Avanti ----------
// Reference: Wikimedia Commons "P180 Avanti.jpg" (side, plan and front views with a cabin section),
// scaled by the published length 14.41 m (Piaggio; Wikipedia 47.3 ft), span 14.03 m (46 ft), height
// 13 ft. Checked against the side-on photo "Piaggio P180 Avanti.JPG" (PH-DLN). Laminar fuselage whose
// depth swells to 2 m over the cabin and tapers to a high tail cone, canard foreplane low on the nose,
// straight mid-set wing behind the cabin carrying long nacelles with five-blade pusher propellers
// (2.16 m in the front view), swept T-tail, and two delta fins under the tail cone. Left side: the
// airstair door ahead of four small cabin windows.
const P180_PARTS = ({ sk, prop, surface }) => {
  // the near delta fin under the tail cone
  sk.smooth("fin", [[9.7, 0.81, "c"], [12.41, 1.06, "c"], [12.36, 0.66], [12.05, 0.61, "c"], [11.24, 0.68]]);
  // the canard: slight anhedral, flapped trailing edge
  surface(sk, "stab", { le: 0.54, root: 0.45, span: 3.48, cr: 0.72, ct: 0.5, sweep: 8, dih: -5, z: 0.42, t: [0.12, 0.1] });
  // the nacelle, its intake scoop and exhaust, then the spinner and the pusher propeller behind it
  sk.smooth("nac", [[6.5, 1.32, "c"], [6.6, 1.52], [7.08, 1.68], [8.0, 1.78], [8.89, 1.8], [9.79, 1.76], [10.47, 1.68, "c"],
    [10.47, 1.14, "c"], [9.79, 1.0], [8.89, 0.93], [8.0, 0.91], [7.08, 0.97], [6.6, 1.1]]);
  sk.smooth("hl", [[7.75, 1.24, "c"], [8.4, 1.37], [9.05, 1.29, "c"], [8.7, 1.18], [8.0, 1.16]]);
  sk.ellipse("inlet", 9.78, 1.47, 0.36, 0.09);
  sk.smooth("nac", [[10.47, 1.58, "c"], [10.9, 1.52], [11.28, 1.4, "c"], [10.9, 1.28], [10.47, 1.22, "c"]]);
  prop(sk, 10.56, 1.4, 2.16, 5);
};
F.p180 = {
  kind: "turboprop", L0: 12.64, over: 1.77, D: 2.0, W: 1.95, fwd: 0.5, fair: 0,
  nose: {
    tip: 0.2,
    top: [[0.11, 0.27], [0.29, 0.36], [0.61, 0.555], [0.83, 0.62], [1.29, 0.76], [1.74, 0.885], [2.28, 0.99], [2.6, 1]],
    bot: [[0.07, 0.135], [0.2, 0.09], [0.38, 0.068], [0.65, 0.045], [1.06, 0.023], [1.51, 0.005], [1.74, 0]],
  },
  tail: {
    top: [[2.32, 1], [1.87, 0.95], [1.42, 0.89], [0.97, 0.81], [0.52, 0.71], [0, 0.58]],
    bot: [[2.55, 0], [2.1, 0.054], [1.65, 0.12], [1.2, 0.2], [0.74, 0.32], [0.29, 0.43], [0, 0.5]],
  },
  glass: [[[0.79, 0.6], [0.86, 0.645], [1.15, 0.75], [1.29, 0.77], [1.49, 0.73], [1.49, 0.575], [0.79, 0.575]]],
  frame: 0.03,
  win: [{ z: 0.67, from: 4.24, to: 6.2, pitch: 0.645, w: 0.235, h: 0.36 }],
  wing: { le: 7.45, root: 0.9, span: 14.03, cr: 1.53, ct: 0.67, sweep: 2.5, dih: 2, z: 0.66, t: [0.13, 0.12] },
  fin: { le: 2.17, cr: 2.03, ct: 1.53, h: 1.38, sweep: 41, rudder: 0.7 },
  stab: { le: 0.4, z: "T", drop: 0.12, span: 4.33, root: 0.25, cr: 1.2, ct: 0.95, sweep: 32, dih: 0, bullet: [1.5, 0.14] },
  extras: [
    door(3.53, 0.66, 0.25, 1.32),
    marks([["hl", [[1.31, 0.12], [1.31, 1.13]]], ["strut", [[6.77, 2.0], [7.2, 2.2], [7.42, 2.2], [7.12, 2.0]]],
      ["door", [[8.2, 0.75, "c"], [9.05, 0.78, "c"], [9.05, 0.42, "c"], [8.2, 0.33, "c"]]], ["strut", [[8.65, 0.07], [8.95, -0.2], [9.2, -0.2], [8.95, 0.07]]]]),
  ],
  overlays: [P180_PARTS],
};

export const families = F;
export const types = {
  DH8D: "dh8d", DH8C: "dh8c", BE20: "be20", B350: "b350", AT72: "at72", AT76: "at76", B190: "b190", SW4: "sw4",
  BE9L: "be9l", BE9T: "be9t", BE10: "be10",
  // the 300 is the 200's airframe with the 350's PT6A-60As and four-blade propellers
  BE30: ["be20", { eng: { ...F.be20.eng, blades: 4, prop: 2.67 } }],
  BE99: "be99", P180: "p180",
};
