// Twin turboprops. Format: see ../profiles.js.
const F = {};

// STARTER (rough): DHC-8-400 from published dimensions; to be measured.
F.dh8d = {
  kind: "turboprop", L0: 32.3, over: 0.5, D: 2.69, W: 2.69, fwd: 0.5, fair: 0.0,
  nose: { tip: 0.42, top: [[0.15, 0.58], [0.4, 0.7], [0.7, 0.82], [1.0, 0.9], [1.4, 0.96], [2.0, 1]],
    bot: [[0.1, 0.26], [0.4, 0.12], [0.9, 0.03], [1.5, 0]] },
  tail: { top: [[2.0, 1], [1.0, 0.92], [0, 0.78]], bot: [[4.2, 0], [3.0, 0.12], [1.8, 0.32], [0.7, 0.55], [0, 0.68]] },
  glass: [[[0.4, 0.7], [0.55, 0.8], [0.7, 0.8], [0.66, 0.66]], [[0.72, 0.8], [0.88, 0.83], [0.86, 0.66], [0.7, 0.66]]],
  floor: 0.3, doors: [[3.4, 0.86], [-5.0, 0.76]],
  win: [{ z: 0.58, from: 4.5, to: -5.8, pitch: 0.69, w: 0.28, h: 0.4 }],
  wing: { le: 13.4, root: 1.3, span: 28.42, cr: 3.0, ct: 1.6, sweep: 3, dih: 2.5, z: 1.02, t: [0.18, 0.13] },
  eng: { kind: "prop", at: [0.21], fwd: 2.6, drop: 0.4, len: 8.0, dia: 1.35, over: 0.2, prop: 4.11, blades: 6 },
  fin: { le: 6.0, cr: 4.6, ct: 2.4, h: 4.6, sweep: 32, fillet: [5.0, 0.9] },
  stab: { le: 1.4, z: "T", span: 8.5, root: 0.3, cr: 2.3, ct: 1.4, sweep: 25, dih: 0, bullet: [2.6, 0.35] },
};

export const families = F;
export const types = {
  DH8D: "dh8d",
};
