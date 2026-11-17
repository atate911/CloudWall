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
  C150: ["piston", 7.3], C152: ["piston", 7.3], C172: ["piston", 8.3], C182: ["piston", 8.8], C206: ["piston", 8.6], C208: ["piston", 11.5],
  P28A: ["piston", 7.3], P28B: ["piston", 7.5], PA46: ["piston", 8.8], P46T: ["piston", 9], SR20: ["piston", 7.9], SR22: ["piston", 7.9],
  DA40: ["piston", 8.1], DA42: ["piston", 8.6], BE36: ["piston", 8.4], BE58: ["piston", 9.1], M20P: ["piston", 7.5], RV7: ["piston", 6.2],
  RV12: ["piston", 6], RV14: ["piston", 6.4], CH7B: ["piston", 6.9], ST75: ["piston", 7.6], PC12: ["piston", 14.4], TBM9: ["piston", 10.7],
  R22: ["heli", 8.7], R44: ["heli", 11.7], R66: ["heli", 11.7], EC35: ["heli", 12.2], EC45: ["heli", 13], B407: ["heli", 12.7],
  B06: ["heli", 11.9], AS50: ["heli", 12.9], H60: ["heli", 19.8], H47: ["heli", 30], A139: ["heli", 16.6], S76: ["heli", 16],
  BE20: ["turboprop", 13.3], B350: ["turboprop", 14.2], B190: ["turboprop", 17.6], DH8D: ["turboprop", 32.8], DH8C: ["turboprop", 25.7],
  AT72: ["turboprop", 27.2], AT76: ["turboprop", 27.2], SW4: ["turboprop", 18.1], C130: ["turboprop", 29.8], C30J: ["turboprop", 29.8],
  SF50: ["bizjet", 9.4], E50P: ["bizjet", 12.8], E55P: ["bizjet", 15.6], C25A: ["bizjet", 14.5], C25B: ["bizjet", 15.6], C56X: ["bizjet", 16],
  C680: ["bizjet", 19.4], C68A: ["bizjet", 19], C700: ["bizjet", 22.3], CL30: ["bizjet", 20.9], CL35: ["bizjet", 20.9], CL60: ["bizjet", 20.9],
  PC24: ["bizjet", 16.8], LJ45: ["bizjet", 17.6], LJ75: ["bizjet", 17.6], GLF4: ["bizjet", 26.9], GLF5: ["bizjet", 29.4], GLF6: ["bizjet", 30.4],
  GL5T: ["bizjet", 29.5], GLEX: ["bizjet", 30.3], GL7T: ["bizjet", 33.9], F2TH: ["bizjet", 20.2], F900: ["bizjet", 20.2], H25B: ["bizjet", 15.6],
  G280: ["bizjet", 20.4], E545: ["bizjet", 20.7], E550: ["bizjet", 20.7],
  CRJ2: ["regional", 26.8], CRJ7: ["regional", 32.3], CRJ9: ["regional", 36.24], E135: ["regional", 26.3], E145: ["regional", 29.9],
  MD82: ["regional", 45.1], MD83: ["regional", 45.1], MD88: ["regional", 45.1], B712: ["regional", 37.8],
  E170: ["narrow", 29.9], E75L: ["narrow", 31.7], E75S: ["narrow", 31.7], E190: ["narrow", 36.2], E195: ["narrow", 38.7], E290: ["narrow", 36.33],
  BCS1: ["narrow", 35], BCS3: ["narrow", 38.7], A318: ["narrow", 31.4], A319: ["narrow", 33.8], A19N: ["narrow", 33.8], A320: ["narrow", 37.6],
  A20N: ["narrow", 37.6], A321: ["narrow", 44.5], A21N: ["narrow", 44.5], B734: ["narrow", 36.4], B735: ["narrow", 31], B736: ["narrow", 31.2],
  B737: ["narrow", 33.6], B738: ["narrow", 39.5], B739: ["narrow", 42.1], B37M: ["narrow", 35.6], B38M: ["narrow", 39.5], B39M: ["narrow", 42.2],
  B3XM: ["narrow", 43.8], B752: ["narrow", 47.3], B753: ["narrow", 54.4], P8: ["narrow", 39.5], K35R: ["quad", 41.5],
  B762: ["wide", 48.5], B763: ["wide", 54.9], B764: ["wide", 61.4], B772: ["wide", 63.7], B77L: ["wide", 63.7], B77W: ["wide", 73.9],
  B779: ["wide", 76.7], B788: ["wide", 56.7], B789: ["wide", 62.8], B78X: ["wide", 68.3], A306: ["wide", 54.1], A332: ["wide", 58.8],
  A333: ["wide", 63.7], A338: ["wide", 58.8], A339: ["wide", 63.7], A359: ["wide", 66.8], A35K: ["wide", 73.8], MD11: ["wide", 61.6],
  DC10: ["wide", 55.5], K46: ["wide", 50.5], KC10: ["wide", 55.4],
  A342: ["quad", 59.4], A343: ["quad", 63.7], A345: ["quad", 67.9], A346: ["quad", 75.4], A388: ["quad", 72.7], B741: ["quad", 70.7],
  B742: ["quad", 70.7], B744: ["quad", 70.7], B748: ["quad", 76.3], BLCF: ["quad", 71.7], C17: ["quad", 53], C5M: ["quad", 75.3],
  A124: ["quad", 69.1], IL76: ["quad", 46.6], B52: ["quad", 48.5], E3TF: ["quad", 46.6], E6: ["quad", 46.6],
};
const BY_CATEGORY = { A1: ["piston", 8], A2: ["bizjet", 16], A3: ["narrow", 38], A4: ["narrow", 47], A5: ["wide", 62], A7: ["heli", 12] };

export function typeInfo(a) {
  const known = T[a.type];
  const [shape, length] = known || BY_CATEGORY[a.category] || ["narrow", 36];
  return { type: a.type, shape, length, known: !!known };
}
