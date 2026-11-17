// Helicopters. Format: see ../profiles.js.
const F = {};

// STARTER (rough): Airbus Helicopters H135 / EC135 from published dimensions; to be measured.
F.ec35 = {
  kind: "heli", L0: 10.2, over: 2.0, D: 1, W: 1.5,
  body: [[0, 0.75], [0.3, 1.35], [1.0, 1.75], [1.9, 2.05], [3.0, 2.28], [4.3, 2.22], [5.1, 1.75], [8.3, 1.45], [9.0, 1.42],
    [9.25, 2.6, "c"], [9.75, 2.62, "c"], [10.2, 1.0, "c"], [9.6, 0.82, "c"], [8.6, 1.08], [5.1, 1.0], [4.4, 0.25], [1.2, 0.0], [0.4, 0.25]],
  glass: [[[0.2, 0.95], [0.6, 1.5], [1.55, 1.92], [1.75, 1.3], [1.0, 0.75]], [[2.0, 1.78], [2.9, 1.8], [2.9, 1.05], [2.0, 1.05]]],
  frame: 0.05,
  stab: { le: 1.4, z: 1.35, span: 2.6, root: 0.2, cr: 0.55, ct: 0.5, sweep: 5, dih: 0 },
  rotor: { s: 3.2, z: 2.75, mast: 0.45, d: 10.2, tail: { s: 9.68, z: 1.72, d: 1.0, fen: true } },
  gear: [{ skid: [{ s: 1.9, z: 0.05 }, { s: 4.1, z: 0.1 }], z: -0.7, fwd: 0.9, aft: 5.3 }],
};

export const families = F;
export const types = {
  EC35: "ec35",
};
