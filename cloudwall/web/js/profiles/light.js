// Light aircraft: pistons and single turboprops. Format: see ../profiles.js.
const F = {};

// STARTER (rough): Cessna 172 from published dimensions; to be measured. D = 1 so the
// outline is in metres.
F.c172 = {
  kind: "piston", L0: 7.95, over: 0.33, D: 1, W: 1.0,
  body: [[0, 0.62], [0.25, 0.95], [0.9, 1.05], [1.45, 1.12], [2.15, 1.55], [3.4, 1.55], [4.0, 1.4], [6.0, 1.05], [7.6, 0.95],
    [7.95, 0.85, "cl"], [7.95, 0.62, "c"], [6.0, 0.45], [3.6, 0.02], [1.6, 0.0], [0.9, 0.12], [0.3, 0.3], [0.05, 0.5]],
  glass: [[[1.48, 1.14], [2.1, 1.5], [2.38, 1.5], [2.34, 1.16]], [[2.45, 1.46], [3.2, 1.46], [3.2, 0.98], [2.45, 0.98]], [[3.32, 1.45], [3.95, 1.36], [3.72, 0.98], [3.32, 0.98]]],
  frame: 0.05,
  wing: { le: 1.95, root: 0.55, span: 11.0, cr: 1.63, kink: [0.4, 1.63], ct: 1.13, sweep: 0, dih: 1.7, z: 1.5, t: [0.15, 0.12] },
  struts: [[0.5, 2.6, 0.25]],
  eng: { kind: "none", nose: { s: 0.08, z: 0.62, d: 1.9, blades: 2 } },
  fin: { le: 1.75, cr: 1.45, ct: 0.75, h: 1.2, sweep: 38, fillet: [1.4, 0.3] },
  stab: { le: 1.2, z: 0.78, span: 3.45, root: 0.25, cr: 0.95, ct: 0.75, sweep: 6, dih: 0 },
  gear: [{ s: 2.62, z: 0.1, ws: 2.85, wz: -0.5, r: 0.19, pant: true }, { s: 0.75, z: 0.2, ws: 0.72, wz: -0.52, r: 0.17, pant: true }],
};

export const families = F;
export const types = {
  C172: "c172", C152: "c172", C150: "c172", C182: "c172",
};
