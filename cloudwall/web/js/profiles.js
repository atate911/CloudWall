// Aircraft side elevations, measured from the manufacturers' airport planning manuals
// (Boeing ACAPs, Airbus AC documents, Embraer and Bombardier APMs) and published dimensions.
//
// Units are metres. Stations s run aft from the nose tip and heights z up from the keel.
// Each family describes one airframe:
//   L0       fuselage length (nose tip to tail-cone end) of the variant it was measured on
//   over     how far the tail surfaces reach beyond the tail cone (overall length - L0)
//   D, W     fuselage height and width; fwd: share of a stretch added ahead of the wing
//   nose     tip height, then top and bottom outline points [s, z], all in units of D
//   tail     top and bottom outline points [distance forward of the tail-cone end, z] in D
//   body     instead of nose/tail: a closed outline [s, z, flag] in D (light aircraft, helicopters)
//   glass    flight-deck panes, each a list of [s, z] in D
//   doors    [s, width, kind, anchor, height, sill]: s < 0 counts from the tail-cone end; anchor "w" from
//            the wing root leading edge. kind D passenger (default), E overwing exit, C cargo, U upper deck
//   win      window rows {z (D), from, to (s), pitch, w, h, upper}
//   wing     {le (root leading edge s), root (half-width at root), span, cr, kink [e, chord], ct,
//            sweep (LE, deg), dih (deg), z (chord height at root, D), t [root, tip thickness], rake, bend}
//   tip      wingtip device {type fence | (blade) h, sweep, top, base, blend, lo, loSweep, loTip}
//   ftf      flap-track fairings: span fractions, or [e, start, end, depth] in shares of local chord
//   eng      {kind fan|prop, at [span fractions], fwd (inlet ahead of local LE), drop (centre below
//            local chord), len, dia, style sep|long|flat, fx, cx, chev, plug, pylon, aft {s, z}, nose {...}}
//   fin      {le (root LE forward of tail end), cr, ct, h (above crown), sweep, fillet [len, h, straight],
//            cap, round (radius of a rounded leading tip corner), base (root height above crown), rudder}
//   stab     {le, z (D) | "T" | fz (fraction up the fin), span, root, cr, ct, sweep, dih, bullet}
//   tailEng  centre engine through the fin root {s (inlet forward of tail end), z (above crown), len, dia}
//   gear, struts, rotor: fixed undercarriage, wing struts and rotors for light aircraft and helicopters
//   extras, overlays: functions (kit) => void for one-off parts, drawn just after the fuselage or
//            last of all; kit is described in silhouette.js
// Each group loads on its own, so a mistake in one file costs only that group's drawings.
const GROUP_FILES = ["boeing", "boeingwide", "airbus", "airbuswide", "regional", "bizjet", "turboprop", "light", "rotorcraft", "military"];
const GROUPS = (await Promise.all(GROUP_FILES.map((g) => import(`./profiles/${g}.js`).catch((e) => {
  console.error(`aircraft profiles: ${g}.js did not load`, e);
  return null;
})))).filter(Boolean);
const F = Object.assign({}, ...GROUPS.map((g) => g.families));
const TYPES = Object.assign({}, ...GROUPS.map((g) => g.types));
// the family drawn for a broad shape when the type has no profile of its own
const DEFAULTS = { narrow: "b737ngw", wide: "b787", quad: "b744", regional: "crj9", bizjet: "cl60", turboprop: "dh8d", piston: "c172", heli: "ec35" };

export function profileFor(type, shape, length) {
  const t = TYPES[type];
  const [fam, variant] = Array.isArray(t) ? t : [t || DEFAULTS[shape] || DEFAULTS.narrow];
  const base = F[fam] || F[DEFAULTS[shape]] || F[DEFAULTS.narrow];
  if (!base) return null;
  const f = { ...base, ...(variant || {}) };
  // a known type is stretched to its own length; a stand-in keeps its family's proportions
  f.L = (t && F[fam] && length ? length - (f.over || 0) : base.L0);
  return f;
}
export const knownFamilies = () => Object.keys(F);
export const knownTypes = () => Object.keys(TYPES);
