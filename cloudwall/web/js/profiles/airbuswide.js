// Airbus widebodies. Format: see ../profiles.js.
const F = {};

// Cargo doors and other openings the renderer's door model can't size (it ties a cargo door's
// height to the cabin floor): drawn as plain rectangles right after the fuselage, so the wing,
// engines and tail still pass in front of them. [s (centre; < 0 from the tail end), width, sill z, height] in metres.
const openings = (list, cls = "door cargo") => ({ sk, at }) => {
  for (const [s, w, z0, h] of list) {
    const [x, y] = sk.xy(at(s) + w / 2, z0 + h);
    sk.xy(at(s) - w / 2, z0);
    sk.out.push(`<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h}" rx="${Math.min(0.2, w / 3).toFixed(2)}"/>`);
  }
};

// The edge of the wing-to-body fairing on the fuselage side, ahead of the wing: points [ds, z] in
// metres, ds from the wing root leading edge (so it follows the wing when a variant is stretched).
const fairing = (pts) => ({ sk, f, L }) => {
  const le = f.wing.le + (L - (f.L0 || L)) * (f.fwd ?? 0.5);
  sk.smooth("hl", pts.map(([ds, z]) => [le + ds, z]), false);
};

// ---------- A330 / A340-200/-300 ----------
// Reference: Airbus A330 AC (Airplane Characteristics) rev. Dec 2025, 2-2-0 General Aircraft Dimensions,
// FIGURE-2-2-0-991-001-A01 sheets 1-2 (A330-300 side and plan views), -002 (A330-200); 2-7-0 Door
// Location FIGURE-2-7-0-991-006-B01 (right side, with the cargo doors) and the door clearance figures
// for door stations and sizes. Side views were de-rotated by the drawn ground attitude (0.4 deg nose down).
// Measured on the A330-300: L0 63.67 (nose to the APU cone tip), D 5.64.
const A330_NOSE = {
  tip: 0.447,
  top: [[0.05, 0.525], [0.1, 0.564], [0.15, 0.593], [0.2, 0.616], [0.25, 0.657], [0.3, 0.701], [0.35, 0.744], [0.4, 0.778],
    [0.5, 0.826], [0.6, 0.861], [0.7, 0.89], [0.8, 0.913], [0.9, 0.933], [1.0, 0.951], [1.1, 0.964], [1.2, 0.976],
    [1.3, 0.986], [1.4, 0.993], [1.5, 0.997], [1.65, 1]],
  bot: [[0.05, 0.365], [0.1, 0.323], [0.15, 0.291], [0.2, 0.266], [0.3, 0.224], [0.4, 0.188], [0.5, 0.156], [0.6, 0.129],
    [0.7, 0.105], [0.8, 0.084], [0.9, 0.066], [1.0, 0.048], [1.1, 0.035], [1.2, 0.024], [1.3, 0.015], [1.45, 0.006], [1.65, 0]],
};
const A330_TAIL = {
  top: [[1.25, 1], [1.0, 0.997], [0.7, 0.985], [0.5, 0.976], [0.3, 0.965], [0.13, 0.947], [0, 0.933]],
  bot: [[3.7, 0], [3.5, 0.006], [3.3, 0.02], [3.1, 0.039], [2.9, 0.063], [2.7, 0.094], [2.5, 0.131], [2.3, 0.176],
    [2.1, 0.224], [1.9, 0.275], [1.7, 0.33], [1.5, 0.388], [1.3, 0.452], [1.1, 0.52], [0.9, 0.592], [0.7, 0.652],
    [0.5, 0.708], [0.3, 0.77], [0.2, 0.815], [0.1, 0.87], [0, 0.925]],
};
// flight deck: windshield, sliding window, rear side window
const A330_GLASS = [
  [[0.329, 0.63], [0.238, 0.633], [0.297, 0.705], [0.363, 0.703]],
  [[0.452, 0.614], [0.355, 0.614], [0.355, 0.645], [0.394, 0.702], [0.452, 0.702]],
  [[0.576, 0.613], [0.477, 0.613], [0.477, 0.707], [0.544, 0.707], [0.576, 0.668]],
];
const A330_FAIRING = [[-3.3, 0], [-2.9, 0.6], [-2.1, 1.3], [-0.7, 2.0], [1.1, 2.5], [3.0, 2.7]];
const A330_WING = { le: 22.87, root: 2.82, span: 57.92, cr: 10.53, kink: [0.267, 7.19], ct: 2.45, sweep: 31.9, dih: 5.2, z: 0.302, t: [0.13, 0.1] };
const WIN = { z: 0.656, pitch: 0.533, w: 0.25, h: 0.36 };
const A330 = {
  kind: "wide", D: 5.64, W: 5.64, fwd: 0.6, fair: 0.075, fairAft: 1.39,
  nose: A330_NOSE, tail: A330_TAIL, glass: A330_GLASS, frame: 0.035, floor: 0.456,
  wing: A330_WING,
  // canted winglet, 2.7 m along its span, 1.4 m tall in side view
  tip: { h: 1.38, sweep: 56, top: 0.6, base: 0.86 },
  ftf: [0.194, 0.309, 0.432, 0.562],
  // Rolls-Royce Trent 700 (the most common A330 engine): long-duct nacelle with a short exhaust cone
  eng: { kind: "fan", at: [0.248], fwd: 5.61, drop: 2.23, len: 8.13, dia: 3.12, style: "long", fx: 0.868 },
  stab: { le: 7.41, z: 0.79, span: 19.4, root: 1.5, cr: 4.81, ct: 1.95, sweep: 33.5, dih: 5.5 },
};
// Door 4 sits 0.2 m higher than doors 1 and 2 (2-3-0 jacked sill heights 6.32 / 6.53 m), so it is
// drawn as an opening of its own; the Type I exit (door 3) is a narrow full-height door.
F.a333 = {
  ...A330, L0: 63.67, over: 0,
  doors: [[5.85, 1.07], [17.74, 1.07], [35.96, 0.81]],
  extras: [openings([[50.96, 1.07, 2.86, 1.85]], "door"),
    openings([[9.53, 2.7, 0.62, 1.7], [44.36, 2.72, 0.66, 1.68], [47.34, 0.95, 1.0, 0.72]]), fairing(A330_FAIRING)],
  win: [{ ...WIN, from: 7.24, to: 14.17 }, { ...WIN, from: 15.22, to: 33.75 }, { ...WIN, from: 39.38, to: 49.53 }],
  fin: { le: 11.25, cr: 7.75, ct: 2.93, h: 8.41, sweep: 44.1, fillet: [1.8, 1.65], rudder: 0.69 },
};
// A330-200: 3.18 m shorter ahead of the wing and 2.15 m behind it, and a fin 0.9 m taller with a
// longer root (FIGURE-2-2-0-991-002); the fin tip trailing edge is the aftmost point (overall 59.0 m).
F.a332 = {
  ...A330, L0: 58.44, over: 0.56,
  wing: { ...A330_WING, le: 19.72 },
  doors: [[5.85, 1.07], [14.56, 1.07], [32.77, 0.81]],
  extras: [openings([[45.63, 1.07, 2.86, 1.85]], "door"),
    openings([[9.53, 2.7, 0.62, 1.7], [38.98, 2.72, 0.66, 1.68], [42.01, 0.95, 1.0, 0.72]]), fairing(A330_FAIRING)],
  win: [{ ...WIN, from: 7.25, to: 13.36 }, { ...WIN, from: 15.8, to: 30.65 }, { ...WIN, from: 36.23, to: 43.67 }],
  fin: { le: 11.4, cr: 8.61, ct: 2.9, h: 9.32, sweep: 44.3, fillet: [1.8, 1.65], rudder: 0.7 },
};

// A330neo: same fuselages; Trent 7000 (2.84 m fan, 3.78 m nacelle) in a short separate-flow
// nacelle with the core and plug showing, and the new 64 m wing whose tip ends in a long, curved,
// strongly canted sharklet. Measured on FIGURE-2-2-0-991-0xx (A330-900, pages 65-66).
// The sharklet is drawn from the tip section: [ds from tip leading edge, dz from tip chord] in metres,
// up the leading edge to the point and back down the trailing edge.
const sharklet = (pts) => ({ sk, sec }) => {
  const q = sec(1);
  sk.smooth("wl", pts.map(([ds, dz, fl]) => [q.le + ds, q.z + dz, fl]));
};
const A330NEO = {
  tip: null,
  overlays: [sharklet([[0.9, 0.16, "c"], [1.4, 0.3], [2.36, 0.42], [2.86, 0.56], [3.36, 0.75], [3.86, 1.02], [4.2, 1.24],
    [4.5, 1.33], [4.82, 1.3, "c"], [4.66, 1.08], [4.46, 0.89], [4.16, 0.64], [3.86, 0.45], [3.36, 0.22], [2.86, 0.13], [2.44, 0.02, "c"]])],
  eng: { kind: "fan", at: [0.251], fwd: 5.86, drop: 1.97, len: 7.76, dia: 3.78, fx: 0.7, cx: 0.81 },
};
F.a339 = { ...F.a333, ...A330NEO };
F.a338 = { ...F.a332, ...A330NEO };

// A340-200/-300: the A330-200/-300 airframe (the -300 fuselage, wing, winglet, fin and tail are
// identical in the drawings) with four CFM56-5C in long-duct nacelles with a short exhaust nozzle.
// Reference: Airbus A340-200/-300 AC, FIGURE-2-2-0-991-001 (A340-300) and -002 (A340-200), plan views for
// the engine stations (inboard 9.2 m, outboard 19.5 m from the centreline), 2-7-0 door locations.
// The A340-200 is the -300 less 2.13 m between door 2 and the wing and 2.14 m between doors 3 and 4;
// unlike the A330-200 it keeps the -300's fin.
const CFM56_5C = { kind: "fan", at: [0.245, 0.636], fwd: 4.34, drop: 1.85, len: 6.35, dia: 2.42, style: "long", fx: 0.893 };
F.a343 = { ...F.a333, eng: CFM56_5C };
F.a342 = {
  ...F.a343, L0: 59.39, over: 0,
  wing: { ...A330_WING, le: 20.74 },
  doors: [[5.85, 1.07], [17.74, 1.07], [33.83, 0.81]],
  extras: [openings([[46.69, 1.07, 2.86, 1.85]], "door"),
    openings([[9.53, 2.7, 0.62, 1.7], [40.09, 2.78, 0.66, 1.68], [43.07, 0.95, 1.0, 0.72]]), fairing(A330_FAIRING)],
  win: [{ ...WIN, from: 7.21, to: 16.25 }, { ...WIN, from: 18.9, to: 31.65 }, { ...WIN, from: 37.99, to: 45.4 }],
};

// ---------- A340-500/-600 ----------
// Reference: Airbus A340-500/-600 AC, FIGURE-2-2-0-991 (A340-600 side and plan views, pages 40-41;
// A340-500 page 42), 2-7-0 door locations. The A330 nose and cross-section with a longer tail cone
// whose top runs straight to the tip, a bigger wing (root chord 12.5 m, 33.7 deg leading edge, 63.45 m
// span over the winglets), a 8.8 m fin with an 8.6 m root, a 21.5 m tailplane, and four Rolls-Royce
// Trent 500 in 3.1 m nacelles whose fan cowl ends at two-thirds of the length, showing a long core
// nozzle. The -600 has five door pairs (door 3 a Type I exit over the wing root, door 5 set 0.2 m
// higher); the -500 is 5.30 m shorter ahead of the wing and 2.13 m behind it, with four.
// Station note: the plan views put the wing 0.46 m further forward than the side views; the side
// views are used.
const A346_TAIL = {
  top: [[2.0, 1], [1.4, 0.99], [1.0, 0.98], [0.5, 0.97], [0, 0.958]],
  bot: [[3.6, 0], [3.2, 0.033], [2.8, 0.098], [2.4, 0.179], [2.0, 0.276], [1.8, 0.327], [1.6, 0.385], [1.4, 0.449],
    [1.2, 0.518], [1.0, 0.593], [0.8, 0.651], [0.6, 0.71], [0.4, 0.79], [0.2, 0.89], [0, 0.948]],
};
const A346_WING = { le: 28.65, root: 2.87, span: 61.0, cr: 12.52, kink: [0.276, 8.68], ct: 2.94, sweep: 33.66, dih: 5.0, z: 0.302, t: [0.13, 0.1] };
const A346_FAIRING = [[-2.9, 0], [-2.5, 0.6], [-1.7, 1.15], [-0.1, 1.95], [2.2, 2.45], [4.0, 2.7]];
F.a346 = {
  ...A330, L0: 75.36, over: 0, fair: 0.082, fairAft: 1.36,
  tail: A346_TAIL, wing: A346_WING,
  tip: { h: 1.34, sweep: 56.5, top: 0.72, base: 0.78 },
  ftf: [0.19, 0.3, 0.42, 0.54],
  doors: [[5.85, 1.07], [23.91, 1.07], [34.09, 0.81], [47.46, 1.07]],
  extras: [openings([[61.58, 1.07, 2.86, 1.85]], "door"),
    openings([[9.53, 2.7, 0.62, 1.7], [54.98, 2.72, 0.66, 1.68], [57.96, 0.95, 1.0, 0.72]]), fairing(A346_FAIRING)],
  win: [{ ...WIN, from: 7.28, to: 22.7 }, { ...WIN, from: 25.34, to: 33.33 }, { ...WIN, from: 34.66, to: 42.11 }, { ...WIN, from: 48.75, to: 60.45 }],
  eng: { kind: "fan", at: [0.245, 0.609], fwd: 5.43, drop: 2.15, len: 7.36, dia: 3.09, fx: 0.652, cx: 0.879 },
  fin: { le: 12.18, cr: 8.58, ct: 3.05, h: 8.8, sweep: 44.4, fillet: [1.6, 1.75], rudder: 0.68 },
  stab: { le: 8.61, z: 0.81, span: 21.5, root: 1.6, cr: 5.82, ct: 2.35, sweep: 34.4, dih: 5 },
};
F.a345 = {
  ...F.a346, L0: 67.93,
  wing: { ...A346_WING, le: 23.3 },
  doors: [[5.85, 1.07], [18.61, 1.07], [37.67, 0.81]],
  extras: [openings([[54.14, 1.07, 2.86, 1.85]], "door"),
    openings([[9.53, 2.7, 0.62, 1.7], [47.55, 2.72, 0.66, 1.68], [50.53, 0.95, 1.0, 0.72]]), fairing(A346_FAIRING)],
  win: [{ ...WIN, from: 7.28, to: 17.12 }, { ...WIN, from: 20.05, to: 35.49 }, { ...WIN, from: 42.66, to: 51.2 }],
};

// ---------- A350 ----------
// Reference: Airbus A350 AC rev. Jul 2026, FIGURE-2-2-0-991-001 sheets 1-2 (A350-900 side and plan
// views, raster figures measured at their native 337 ppi), -002 (A350-1000), 2-7-0 FIGURE-2-7-0-991-001
// (door locations, both sides). D 6.07 measured (6.09 published). The drawn side view has no
// visible attitude. L0 is the APU face (65.26 m); the fin tip trailing edge reaches 1.35 m further.
// The droop-snoot nose has its tip at a quarter of the fuselage height and a radome joint 1.3 m back;
// the black "raccoon mask" round the flight-deck windows is drawn as one dark shape (the renderer paints
// it over the panes, which are black anyway). Wing: 13.3 m root chord, unswept inner trailing edge,
// 35 deg leading edge; the tip curls up into a tall curved blended winglet, drawn from the tip section
// (measured off the side view). Trent XWB: 4.0 m nacelle, separate flow with a small core and plug.
// In flight the wing flexes up like the 787's: `bend` lifts the tip a moderate 1.2 m over the
// ground-attitude drawing (real cruise deflection is larger; kept moderate so the tip device still reads).
const A350_NOSE = {
  tip: 0.262,
  top: [[0.05, 0.35], [0.1, 0.402], [0.15, 0.446], [0.2, 0.489], [0.25, 0.527], [0.3, 0.568], [0.35, 0.612], [0.4, 0.66],
    [0.45, 0.712], [0.5, 0.758], [0.55, 0.789], [0.6, 0.817], [0.7, 0.858], [0.8, 0.893], [0.9, 0.919], [1.0, 0.942],
    [1.1, 0.956], [1.2, 0.969], [1.3, 0.981], [1.4, 0.99], [1.5, 0.996], [1.65, 1]],
  bot: [[0.05, 0.184], [0.1, 0.151], [0.15, 0.128], [0.2, 0.109], [0.3, 0.08], [0.4, 0.055], [0.5, 0.04], [0.6, 0.027],
    [0.7, 0.017], [0.8, 0.009], [0.9, 0.003], [1.0, 0]],
};
const A350_TAIL = {
  top: [[3.0, 1], [2.6, 0.997], [2.4, 0.99], [2.2, 0.983], [2.0, 0.969], [1.4, 0.921], [1.0, 0.888], [0.5, 0.815], [0, 0.74]],
  bot: [[3.6, 0], [3.4, 0.003], [3.2, 0.012], [3.0, 0.026], [2.8, 0.047], [2.6, 0.068], [2.4, 0.102], [2.2, 0.139],
    [2.0, 0.182], [1.6, 0.276], [1.2, 0.373], [0.8, 0.468], [0.4, 0.565], [0.2, 0.612], [0, 0.657]],
};
const A350_MASK = [[0.645, 0.61], [0.62, 0.675], [0.56, 0.692], [0.48, 0.7], [0.44, 0.69], [0.4, 0.645], [0.35, 0.598],
  [0.3, 0.553], [0.26, 0.518, "c"], [0.34, 0.53], [0.46, 0.535], [0.57, 0.538], [0.635, 0.56]];
const A350_WIN = { z: 0.608, w: 0.28, h: 0.42 };
const radome = (s, z0, z1) => ({ sk }) => sk.poly("hl", [[s, z0], [s, z1]], false);
F.a359 = {
  kind: "wide", L0: 65.26, over: 1.35, D: 6.07, W: 5.96, fwd: 0.55, fair: 0.087, fairAft: 1.43,
  nose: A350_NOSE, tail: A350_TAIL, mask: A350_MASK, floor: 0.427,
  doors: [[6.82, 1.07, "D", undefined, 1.95], [18.86, 1.07, "D", undefined, 1.95], [37.93, 1.07, "D", undefined, 1.95], [52.55, 1.07, "D", undefined, 1.95]],
  extras: [openings([[11.68, 2.7, 0.7, 1.7], [47.3, 2.7, 0.75, 1.7]]), radome(1.32, 0.42, 2.98),
    fairing([[-1.9, 0], [-2.3, 0.23], [-2.75, 0.42], [-3.05, 0.75], [-2.7, 1.1], [-1.9, 1.56], [-1.0, 2.0], [0, 2.25], [1.5, 2.43], [3.5, 2.77]])],
  win: [{ ...A350_WIN, from: 8.39, to: 16.0, pitch: 0.635 }, { ...A350_WIN, from: 20.44, to: 34.37, pitch: 0.663 }, { ...A350_WIN, from: 40.5, to: 50.64, pitch: 0.634 }],
  wing: { le: 22.5, root: 2.98, span: 60.0, cr: 13.28, kink: [0.278, 8.43], ct: 2.28, sweep: 35.3, dih: 5.5, z: 0.305, t: [0.13, 0.1], bend: 1.2 },
  overlays: [sharklet([[0.3, 0.12, "c"], [0.9, 0.2], [1.37, 0.57], [1.87, 0.89], [2.37, 1.25], [2.87, 1.61], [3.37, 1.93], [3.87, 2.21],
    [4.37, 2.36], [4.82, 2.33, "c"], [4.67, 2.2], [4.37, 1.95], [3.87, 1.45], [3.37, 0.91], [2.87, 0.43], [2.37, 0.16], [1.87, 0.04], [1.2, -0.02, "c"]])],
  ftf: [[0.33, 0.6, 1.15, 0.06], [0.48, 0.6, 1.15, 0.06], [0.63, 0.6, 1.15, 0.055]],
  eng: { kind: "fan", at: [0.276], fwd: 5.82, drop: 2.37, len: 8.08, dia: 3.98, fx: 0.73, cx: 0.854 },
  fin: { le: 10.16, cr: 7.0, ct: 3.04, h: 8.48, sweep: 44, fillet: [0.8, 0.5], rudder: 0.67, round: 0.6 },
  stab: { le: 7.26, z: 0.7, span: 19.24, root: 1.5, cr: 5.59, ct: 1.9, sweep: 36, dih: 5 },
};
// A350-1000: 6.99 m longer (3.85 m ahead of the wing), doors from 2-7-0, the trailing-edge extension
// adds ~0.1 m of tip chord; same fin, tail and nacelle (Trent XWB-97).
F.a35k = {
  ...F.a359, L0: 72.25, over: 1.34,
  wing: { ...F.a359.wing, le: 26.35, ct: 2.38 },
  doors: [[6.82, 1.07, "D", undefined, 1.95], [23.3, 1.07, "D", undefined, 1.95], [42.38, 1.07, "D", undefined, 1.95], [59.53, 1.07, "D", undefined, 1.95]],
  extras: [openings([[11.68, 2.7, 0.7, 1.7], [54.28, 2.7, 0.75, 1.7]]), radome(1.32, 0.42, 2.98), F.a359.extras[2]],
  win: [{ ...A350_WIN, from: 8.39, to: 21.1, pitch: 0.635 }, { ...A350_WIN, from: 24.9, to: 38.8, pitch: 0.663 }, { ...A350_WIN, from: 44.9, to: 57.6, pitch: 0.634 }],
};

export const families = F;
export const types = {
  A332: "a332", A333: "a333", A338: "a338", A339: "a339", A342: "a342", A343: "a343", A345: "a345", A346: "a346", A359: "a359", A35K: "a35k",
};
