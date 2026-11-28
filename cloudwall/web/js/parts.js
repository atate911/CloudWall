// Parts shared by several displays: how a flight number, an airline or a landing is said.
import { esc, num, ident } from "./util.js";

export function showLogo(tile, img, state, code, nameEl) {
  tile.hidden = true;
  if (nameEl) nameEl.hidden = false;
  if (!state.logos || !code) return;
  img.onload = () => { tile.hidden = false; if (nameEl) nameEl.hidden = true; };
  img.onerror = () => { tile.hidden = true; if (nameEl) nameEl.hidden = false; };
  img.src = `logos/${encodeURIComponent(code)}`;
}

function badgeClass(b) {
  if (b === "MEDICAL") return "med";
  if (/EMERGENCY|HIJACK|RADIO|MILITARY/.test(b)) return "hot";
  if (/^NEW/.test(b)) return "new";
  if (/RARE/.test(b)) return "rare";
  return "";
}
// "NEW TYPE" -> "New type"
const tagWords = (b) => b.charAt(0) + b.slice(1).toLowerCase();
const MED_GLYPH = `<svg viewBox="-2 -2 4 4" aria-hidden="true"><path d="M-.5,-1.75H.5V-.5H1.75V.5H.5V1.75H-.5V.5H-1.75V-.5H-.5Z"/></svg>`;
export const badges = (list) => (list || []).map((b) => `<span class="badge ${badgeClass(b)}">${b === "MEDICAL" ? MED_GLYPH : ""}${esc(tagWords(b))}</span>`).join("");

// "AS508" -> "AS 508"
export function boardFlight(f) {
  const m = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(f || "");
  return m && /[A-Z]/.test(m[1]) ? `${m[1]} ${m[2]}` : f;
}

// The airport an inferred arrival or departure belongs to: PDX, or Pearson / Troutdale for light aircraft.
export function localPlace(a, state) {
  const f = a.local_field;
  return f ? { iata: f.code, city: f.name, name: f.name } : { iata: state.airport.iata, city: state.airport.city, name: state.airport.iata };
}
export function localWords(a, state) {
  const p = localPlace(a, state);
  return a.local === "arriving" ? `Landing at ${p.name}` : a.local === "departing" ? `Just left ${p.name}`
    : a.local === "local" ? `Flying near ${p.name}` : "";
}

// the database's long variants ("737NG 890/W") are trimmed to the model
export function shortType(name) {
  if (!name) return "";
  return name.length > 24 ? name.split(/[\s/]/).slice(0, 3).join(" ") : name;
}

const REC = [["highest", "Highest", (v) => num(v) + " ft"], ["lowest", "Lowest", (v) => num(v) + " ft"], ["fastest", "Fastest", (v) => num(v) + " kt"],
  ["closest", "Closest pass", (v) => v.toFixed(2) + " nm"], ["furthest_origin", "Furthest origin", (v) => num(v) + " nm"]];
export function recordsHtml(title, r) {
  return (title ? `<h2>${title}</h2>` : "") + REC.map(([k, label, f]) => {
    const x = r[k];
    return `<div class="rec"><span>${label}</span><span>${x ? `<b>${f(x.value)}</b> <span class="dim">${esc(x.flight || x.callsign || "")} ${esc(k === "furthest_origin" ? x.origin : x.type || "")}</span>` : '<span class="dim">—</span>'}</span></div>`;
  }).join("");
}

// "F15" -> "F-15"
export const milType = (code) => (/^[A-Z]{1,2}\d{1,3}[A-Z]?$/.test(code || "") ? code.replace(/^([A-Z]+)(\d)/, "$1-$2") : code || "military aircraft");

export function heardGroups(heard) {
  const by = new Map();
  for (const a of heard) {
    const k = a.desc || milType(a.type), g = by.get(k) || { name: k, type: milType(a.type), n: 0, alts: [] };
    g.n++; if (a.alt != null) g.alts.push(a.alt); by.set(k, g);
  }
  return [...by.values()];
}

// "Delta Air Lines" and flight DL178 make "Delta 178"; without an airline, the kind of aircraft.
const KIND_WORDS = { light: "Small plane", twin: "Small plane", ultralight: "Small plane", seaplane: "Seaplane", glider: "Glider",
  turboprop: "Propeller plane", bizjet: "Private jet", heli: "Helicopter", gyro: "Gyrocopter", fighter: "Military jet",
  tandem: "Military helicopter", tiltrotor: "Military aircraft", balloon: "Balloon", airship: "Airship", drone: "Drone" };
export function plainName(a) {
  if (a.medical) return a.icon === "heli" || a.icon === "tandem" ? "Medical helicopter" : "Air ambulance";
  if (a.airline) {
    const short = a.airline.replace(/\s+(Air ?Lines|Airlines|Airways|Air|Aviation)$/i, "");
    const num = /^[A-Z0-9]{2,3}?(\d{1,4}[A-Z]?)$/.exec((a.flight || ident(a) || "").replace(/\s/g, ""));
    return num ? `${short} ${num[1]}` : short;
  }
  return KIND_WORDS[a.icon] || (a.type_name ? a.type_name.replace(/\s+\(.*\)$/, "") : "Plane");
}
