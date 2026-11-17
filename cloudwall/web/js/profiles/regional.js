// Regional jets: CRJ, ERJ, E-Jets. Format: see ../profiles.js.
const F = {};

// STARTER (rough): CRJ900 from the APM CSP C-020 dimension table; to be measured.
F.crj9 = {
  kind: "regional", L0: 33.5, over: 2.74, D: 2.69, W: 2.69, fwd: 0.6, fair: 0.04,
  nose: { tip: 0.38, top: [[0.15, 0.55], [0.4, 0.68], [0.7, 0.8], [1.0, 0.88], [1.4, 0.95], [2.0, 0.99], [2.5, 1]],
    bot: [[0.1, 0.25], [0.4, 0.12], [0.9, 0.03], [1.4, 0]] },
  tail: { top: [[2.5, 1], [1.2, 0.93], [0, 0.75]], bot: [[4.0, 0], [2.8, 0.12], [1.5, 0.33], [0.5, 0.55], [0, 0.65]] },
  glass: [[[0.36, 0.64], [0.5, 0.74], [0.62, 0.75], [0.6, 0.62]], [[0.64, 0.75], [0.8, 0.77], [0.78, 0.62], [0.62, 0.62]]],
  floor: 0.3, doors: [[3.3, 0.91], [1.0, 0.51, "E", "w"], [1.75, 0.51, "E", "w"], [-6.5, 1.07, "C"]],
  win: [{ z: 0.56, from: 4.4, to: -7.0, pitch: 0.51, w: 0.22, h: 0.3 }],
  wing: { le: 16.0, root: 1.3, span: 24.85, cr: 4.6, ct: 1.2, sweep: 28, dih: 4.5, z: 0.12, t: [0.13, 0.1] },
  tip: { h: 1.3, sweep: 50, top: 0.45, base: 0.95, blend: 0.4 },
  ftf: [0.3, 0.55],
  eng: { kind: "fan", aft: { s: 8.6, z: 0.88 }, len: 3.4, dia: 1.38, style: "long", fx: 0.9 },
  fin: { le: 4.0, cr: 4.2, ct: 2.6, h: 4.1, sweep: 42, fillet: [1.5, 0.4] },
  stab: { le: 0.6, z: "T", span: 8.54, root: 0.3, cr: 2.1, ct: 1.0, sweep: 30, dih: -3, bullet: [3.0, 0.35] },
};

export const families = F;
export const types = {
  CRJ9: "crj9",
};
