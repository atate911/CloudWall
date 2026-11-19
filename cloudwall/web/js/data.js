// Reference data: airline liveries and aircraft shapes/sizes.

// ICAO airline code -> [main colour, accent]
const AIRLINES = {
  ASA: ["#01426a", "#7fc241"], QXE: ["#01426a", "#7fc241"], SKW: ["#1d4f91", "#9fb4c7"], SWA: ["#304cb2", "#ffbf27"],
  DAL: ["#c8102e", "#003a70"], UAL: ["#005daa", "#6cace4"], AAL: ["#0078d2", "#c30019"], ENY: ["#0078d2", "#c30019"],
  FDX: ["#4d148c", "#ff6600"], UPS: ["#4b2e1e", "#ffb500"], JBU: ["#003876", "#00a1de"], NKS: ["#ffec00", "#222222"],
  FFT: ["#006643", "#b7d433"], HAL: ["#413691", "#ce0c88"], AAY: ["#01579b", "#fbcd08"], SCX: ["#f58232", "#003876"],
  BAW: ["#075aaa", "#eb2226"], DLH: ["#05164d", "#ffad00"], ICE: ["#003a7d", "#ffcb05"], ACA: ["#d22630", "#222222"],
  JZA: ["#d22630", "#222222"], WJA: ["#00aaa5", "#003c71"], VOI: ["#a6228c", "#222222"], AMX: ["#0b2343", "#e91b2f"],
  KLM: ["#00a1de", "#ffffff"], AFR: ["#002157", "#ed1c24"], ANA: ["#13448f", "#00b3ef"], JAL: ["#c8102e", "#ffffff"],
  KAL: ["#5aa9d6", "#00256c"], UAE: ["#d71921", "#c5a05a"], QTR: ["#5c0632", "#a0a0a0"], CFG: ["#ffb000", "#222222"],
  GTI: ["#002d72", "#d4a017"], ABX: ["#c8102e", "#ffffff"], AMF: ["#c8102e", "#1c3f94"], EJA: ["#1a1a1a", "#c5a05a"],
  LXJ: ["#7a0019", "#c0c0c0"], BOE: ["#0033a0", "#ffffff"], CKS: ["#003b7a", "#e31837"], ATN: ["#f7941d", "#232f3e"],
  PAC: ["#00205b", "#f2a900"], CPA: ["#005d63", "#c1b49a"], EVA: ["#00693e", "#f58220"], SIA: ["#f99f1c", "#00266b"],
  TAP: ["#00a551", "#e30613"], VIR: ["#da0530", "#5f2a75"], AAR: ["#8a8d8f", "#e60012"], FIN: ["#0b1560", "#ffffff"],
};
export function airlineColors(a) {
  const m = /^([A-Z]{3})\d/.exec(a.callsign || "");
  return (m && AIRLINES[m[1]]) || null;
}

// ICAO type -> [shape, length in metres]
const T = {
  C150: ["piston", 7.3], C152: ["piston", 7.3], C172: ["piston", 8.3], C182: ["piston", 8.8], C206: ["piston", 8.6], C208: ["piston", 12.67],
  P28A: ["piston", 7.3], P28B: ["piston", 7.5], PA46: ["piston", 8.8], P46T: ["piston", 9], SR20: ["piston", 7.9], SR22: ["piston", 7.9],
  DA40: ["piston", 8.1], DA42: ["piston", 8.6], BE36: ["piston", 8.4], BE58: ["piston", 9.1], M20P: ["piston", 7.5], RV3: ["piston", 5.79], RV4: ["piston", 6.2], RV6: ["piston", 6.15], RV7: ["piston", 6.2], RV8: ["piston", 6.4], RV9: ["piston", 6.22], RV10: ["piston", 7.44],
  RV12: ["piston", 6.07], RV14: ["piston", 6.43], CH7B: ["piston", 6.9], ST75: ["piston", 7.6], PC12: ["piston", 14.4], TBM9: ["piston", 10.7],
  R22: ["heli", 8.7], R44: ["heli", 11.7], R66: ["heli", 11.7], EC35: ["heli", 12.2], EC45: ["heli", 13.64], B407: ["heli", 12.7],
  B06: ["heli", 11.9], AS50: ["heli", 12.9], H60: ["heli", 19.8], H47: ["heli", 30], A139: ["heli", 16.6], S76: ["heli", 16],
  BE20: ["turboprop", 13.3], B350: ["turboprop", 14.2], B190: ["turboprop", 17.6], DH8D: ["turboprop", 32.8], DH8C: ["turboprop", 25.7],
  AT72: ["turboprop", 27.2], AT76: ["turboprop", 27.2], SW4: ["turboprop", 18.1], C130: ["turboprop", 29.8], C30J: ["turboprop", 34.37],
  SF50: ["bizjet", 9.4], E50P: ["bizjet", 12.8], E55P: ["bizjet", 15.6], C25A: ["bizjet", 14.5], C25B: ["bizjet", 15.6], C56X: ["bizjet", 16],
  C680: ["bizjet", 19.4], C68A: ["bizjet", 19], C700: ["bizjet", 22.3], CL30: ["bizjet", 20.9], CL35: ["bizjet", 20.9], CL60: ["bizjet", 20.9],
  PC24: ["bizjet", 16.8], LJ45: ["bizjet", 17.6], LJ75: ["bizjet", 17.6], GLF4: ["bizjet", 26.9], GLF5: ["bizjet", 29.4], GLF6: ["bizjet", 30.4],
  GL5T: ["bizjet", 29.5], GLEX: ["bizjet", 30.3], GL7T: ["bizjet", 33.9], F2TH: ["bizjet", 20.2], F900: ["bizjet", 20.2], H25B: ["bizjet", 15.6],
  G280: ["bizjet", 20.4], E545: ["bizjet", 19.69], E550: ["bizjet", 20.7],
  CRJ2: ["regional", 26.8], CRJ7: ["regional", 32.3], CRJ9: ["regional", 36.24], E135: ["regional", 26.3], E145: ["regional", 29.9],
  MD82: ["regional", 45.1], MD83: ["regional", 45.1], MD88: ["regional", 45.1], B712: ["regional", 37.8],
  E170: ["narrow", 29.9], E75L: ["narrow", 31.7], E75S: ["narrow", 31.7], E190: ["narrow", 36.2], E195: ["narrow", 38.7], E290: ["narrow", 36.33],
  BCS1: ["narrow", 35], BCS3: ["narrow", 38.7], A318: ["narrow", 31.4], A319: ["narrow", 33.8], A19N: ["narrow", 33.8], A320: ["narrow", 37.6],
  A20N: ["narrow", 37.6], A321: ["narrow", 44.5], A21N: ["narrow", 44.5], B734: ["narrow", 36.4], B735: ["narrow", 31], B736: ["narrow", 31.2],
  B737: ["narrow", 33.6], B738: ["narrow", 39.5], B739: ["narrow", 42.1], B37M: ["narrow", 35.6], B38M: ["narrow", 39.5], B39M: ["narrow", 42.2],
  B3XM: ["narrow", 43.8], B752: ["narrow", 47.3], B753: ["narrow", 54.4], P8: ["narrow", 39.5], K35R: ["quad", 41.5],
  B762: ["wide", 48.5], B763: ["wide", 54.9], B764: ["wide", 61.4], B772: ["wide", 63.7], B77L: ["wide", 63.7], B773: ["wide", 73.9], B77W: ["wide", 73.9],
  B779: ["wide", 76.7], B788: ["wide", 56.7], B789: ["wide", 62.8], B78X: ["wide", 68.3], A306: ["wide", 54.1], A332: ["wide", 58.8],
  A333: ["wide", 63.7], A338: ["wide", 58.8], A339: ["wide", 63.7], A359: ["wide", 66.8], A35K: ["wide", 73.8], MD11: ["wide", 61.6],
  DC10: ["wide", 55.5], K46: ["wide", 50.5], KC10: ["wide", 55.4],
  F16: ["fighter", 15.06], F18: ["fighter", 17.07], F22: ["fighter", 18.92], F35: ["fighter", 15.67],
  A10: ["fighter", 16.26], T38: ["fighter", 14.14], T6: ["piston", 10.16],
  A342: ["quad", 59.4], A343: ["quad", 63.7], A345: ["quad", 67.9], A346: ["quad", 75.4], A388: ["quad", 72.7], B741: ["quad", 70.7],
  B742: ["quad", 70.7], B744: ["quad", 70.7], B748: ["quad", 76.3], BLCF: ["quad", 71.7], C17: ["quad", 53], C5M: ["quad", 75.3],
  A124: ["quad", 69.1], IL76: ["quad", 46.6], B52: ["quad", 48.5], E3TF: ["quad", 46.6], E6: ["quad", 45.8],
  F15: ["fighter", 19.43], F15E: ["fighter", 19.45], F18S: ["fighter", 18.31],
};
const BY_CATEGORY = { A1: ["piston", 8], A2: ["bizjet", 16], A3: ["narrow", 38], A4: ["narrow", 47], A5: ["wide", 62], A6: ["fighter", 19], A7: ["heli", 12] };

export function typeInfo(a) {
  const known = T[a.type];
  const [shape, length] = known || BY_CATEGORY[a.category] || ["narrow", 36];
  // the model names pick a variant that shares a type code (RV-7 or RV-7A, F-15E or F-15EX)
  return { type: a.type, shape, length, known: !!known, name: [a.model, a.type_name].filter(Boolean).join(" ") };
}

// The radar's icon for an aircraft (icons.js): one kind of traffic, told apart at a glance.
// First the kinds the table below names by type (balloons, gliders, twin-rotor helicopters,
// seaplanes, light twins, ...), or that the aircraft's description gives away; then its type in the
// table above; then its type or description when it's a helicopter; then what its transponder says
// it is (the ADS-B emitter category); then its wake category. Null when nothing says, and the radar
// draws its plain aircraft. A Beaver or a Caravan on floats has the same type as one on wheels, so
// it is a seaplane only when its description says so.
const KIND_OF_TYPE = {
  BALL: "balloon", SHIP: "airship", GLID: "glider", ULAC: "ultralight", GYRO: "gyro", UHEL: "heli",   // ICAO's catch-all codes
  H46: "tandem", H47: "tandem", V22: "tiltrotor", Q1: "drone", Q4: "drone", Q9: "drone",
  CL2P: "seaplane", CL2T: "seaplane", LA4: "seaplane", G21: "seaplane", G44: "seaplane", G73: "seaplane", U16: "seaplane",
};
for (const t of ("AEST BE55 BE58 BE76 BE95 BN2P C310 C335 C340 C402 C404 C414 C421 DA42 DA62 P68 PA23 PA27 PA30 PA31 " +
  "PA34 PA44").split(" ")) KIND_OF_TYPE[t] = "twin";                                                  // piston twins
// what a description gives away, in this order (a hang glider is an ultralight, not a glider;
// a Chinook a twin-rotor helicopter)
const KIND_OF_WORDS = [
  ["balloon", /balloon|\bcameron\b|lindstrand|ultramagic|kubicek|thunder (and|&) colt/i],
  ["airship", /airship|blimp|zeppelin/i],
  ["ultralight", /ultra-?light|microlight|\btrike\b|paramotor|powered parachute|paraglider|hang ?glider|weight.shift/i],
  ["glider", /glider|sailplane|schleicher|schempp|\bstemme\b|jonker/i],
  ["gyro", /gyro(plane|copter)?\b|autogiro|autogyro|\bcalidus\b|\bcavalon\b|\bmagni\b/i],
  ["tiltrotor", /osprey|tilt.?rotor|\baw ?609\b|bell 609/i],
  ["tandem", /chinook|sea knight|\bch-4[67]|vertol|tandem/i],
  ["drone", /unmanned|\bua[sv]\b|drone|reaper|predator|global hawk|triton|scaneagle/i],
  ["seaplane", /seaplane|float ?plane|\bfloats\b|amphib|flying boat|catalina|canadair cl-?[24]15|\bicon a5\b|water ?bomber/i],
];
const ICON_OF_SHAPE = { piston: "light", turboprop: "turboprop", bizjet: "bizjet", regional: "regional", narrow: "airliner",
  wide: "heavy", quad: "quad", heli: "heli", fighter: "fighter" };
const HELI_TYPES = new Set(("A109 A119 A129 A139 A149 A169 A189 AS32 AS3B AS50 AS55 AS65 B06 B06T B105 B212 B222 B230 B407 B412 " +
  "B427 B429 B430 B47G B505 BK17 EC20 EC25 EC30 EC35 EC45 EC55 EC75 EN28 EN48 EXPL G2CA H160 H269 H500 H53 H60 H64 " +
  "KMAX MD52 MD60 MI8 NH90 R22 R44 R66 S61 S64 S76 S92 UH1").split(" "));
const HELI_WORDS = /helicopter|copter|robinson|sikorsky|agusta|enstrom|schweizer|guimbal|kaman|\bbell [245]\d\d|\baw ?1\d\d\b|\b[acmhu]h-\d/i;
// A1 light, A2 small, A3 large, A4 high vortex large (the 757), A5 heavy, A6 high performance,
// A7 rotorcraft; B1 glider, B2 lighter than air, B4 ultralight, hang glider or paraglider, B6 unmanned.
// (B3, parachutists, and B7, space vehicles, are left plain.)
const ICON_OF_CATEGORY = { A1: "light", A2: "bizjet", A3: "airliner", A4: "airliner", A5: "heavy", A6: "fighter", A7: "heli",
  B1: "glider", B2: "balloon", B4: "ultralight", B6: "drone" };
// A super ... D heavy, E the 757, F and G large, H small over 15,500 lb, I small under it
const ICON_OF_CWT = { A: "heavy", B: "heavy", C: "heavy", D: "heavy", E: "airliner", F: "airliner", G: "airliner", H: "bizjet", I: "light" };
export function iconKind(a) {
  if (KIND_OF_TYPE[a.type]) return KIND_OF_TYPE[a.type];
  const said = a.desc && KIND_OF_WORDS.find(([, re]) => re.test(a.desc));
  if (said) return said[0];
  const known = T[a.type];
  if (known) return ICON_OF_SHAPE[known[0]] || null;
  if (HELI_TYPES.has(a.type) || HELI_WORDS.test(a.desc || "")) return "heli";
  return ICON_OF_CATEGORY[a.category] || ICON_OF_CWT[a.cwt] || null;
}
