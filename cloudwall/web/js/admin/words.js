// Settings in words: each value said as a person would say it ("Keep the logbook", not "log"; 15%,
// not 0.15), and the whole setup said in a paragraph, each part of it a link to the setting it
// comes from. The paragraph is how an admin checks the setup at a glance: if a sentence reads
// wrong, the words to click are the ones to change.
import { esc, num, value, setting, S } from "./core.js";

// the few settings shown on another page than their section's
export const APART = { "tracking.poll_seconds": "positions", "tracking.idle_after_seconds": "positions", "tracking.when_idle": "positions", "map.cache_mb": "safekeeping" };

// what each word a setting takes means, said plainly
export const CHOICE = {
  "tracking.when_idle": { log: "Keep the logbook", pause: "Pause" },
  "kiosk.view": { card: "The flight card", radar: "Radar beside the card", map: "Map beside the card", sky: "Sky beside the card" },
  "kiosk.radar": { chart: "A chart", atc: "An ATC screen" },
  "kiosk.density": { simple: "What matters", detailed: "Every aircraft" },
  "flightradar24.mode": { always: "Every airliner coming over", fallback: "Only when the free route looks wrong" },
  "flightaware.mode": { always: "Every airliner coming over", fallback: "Only when the free route looks wrong" },
  "server.host": { "127.0.0.1": "Only this machine", "0.0.0.0": "Every network" },
};
const STYLE = { dark: "Dark streets", light: "Light streets", satellite: "Satellite", streets: "Streets", osm: "OpenStreetMap", sectional: "VFR sectional",
                terminal: "VFR terminal", "ifr-low": "IFR low", "ifr-high": "IFR high", off: "No map" };
for (const k of ["map.style", "map.route", "map.atc"]) CHOICE[k] = STYLE;

/** A setting's value in words. */
export function say(st, v = st.value) {
  const id = `${st.section}.${st.key}`;
  if (st.secret) return v?.set ? "Saved" : "Not set";
  if (v === "" || v === null || v === undefined) return id === "kiosk.quiet" ? "Never quiet" : id === "kiosk.place" ? "The house" : "Not set";
  if (CHOICE[id]?.[v]) return CHOICE[id][v];
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (Array.isArray(v)) return v.length ? v.map(hostOf).join(", then ") : "None";
  if (id === "kiosk.quiet") return v.replace("-", " to ");
  if (id === "kiosk.range_nm" && !+v) return "The tracking radius";
  if (id === "airport.icao" && v === "auto") return "Auto: the nearest";
  if (st.unit === "share") return `${Math.round(v * 100)}%`;
  if (id === "map.opacity") return `${Math.round(v * 100)}%`;
  if (st.key === "port") return String(v);
  if (typeof v === "number") return `${num(v, 4)}${st.unit && st.unit !== "°" ? ` ${st.unit}` : st.unit}`;
  return String(v);
}

export const hostOf = (u) => { try { return /\/data\/aircraft\.json$/.test(u) ? "your receiver" : new URL(String(u).replace(/[{}]/g, "")).hostname; } catch { return String(u); } };

// -- the setup, said in a paragraph ----------------------------------------------------------------------
/** A link to a setting, in the board's blue: its page, opened at it. */
function to(section, key, text) {
  const st = setting(section, key);
  return `<a class="said" href="#${APART[`${section}.${key}`] || st?.page || "settings"}/${section}.${key}">${esc(text)}</a>`;
}

export function setup() {
  if (!S.settings) return "";
  const v = (s, k) => value(s, k), st = (s, k) => setting(s, k);
  const home = S.sky?.home || { lat: v("home", "lat"), lon: v("home", "lon") }, ap = S.sky?.airport;
  const urls = v("source", "urls") || [];
  const fr = v("flightradar24", "api_key")?.set ? "flightradar24" : v("flightaware", "api_key")?.set ? "flightaware" : null;
  const allowance = fr === "flightradar24" ? v(fr, "monthly_credits") : fr ? v(fr, "monthly_limit") : 0;
  const quiet = v("kiosk", "quiet");
  const parts = [
    `<p>${to("home", "name", v("home", "name") || "The house")} is at ${to("home", "lat", home?.lat != null ? `${Math.abs(home.lat).toFixed(3)}° ${home.lat >= 0 ? "N" : "S"}, ${Math.abs(home.lon).toFixed(3)}° ${home.lon >= 0 ? "E" : "W"}` : "no position yet")},
      near ${to("airport", "icao", ap?.icao ? `${ap.icao}${v("airport", "icao") === "auto" ? " (the nearest)" : ""}` : say(st("airport", "icao")))}.
      The wall watches ${to("tracking", "radius_nm", `${num(v("tracking", "radius_nm"), 1)} nm`)} around it;
      closer than ${to("tracking", "overhead_nm", `${num(v("tracking", "overhead_nm"), 1)} nm`)} and below ${to("tracking", "max_overhead_alt_ft", `${num(v("tracking", "max_overhead_alt_ft"))} ft`)} counts as overhead.</p>`,
    `<p>Positions come from ${to("source", "urls", urls.map(hostOf).join(", then ") || "nowhere")}${v("source", "merge") ? `, ${to("source", "merge", "your receiver combined with the public feed")}` : ""},
      asked every ${to("tracking", "poll_seconds", `${v("tracking", "poll_seconds")} s`)}.
      With no screen open, it ${to("tracking", "when_idle", v("tracking", "when_idle") === "log" ? "keeps the logbook" : "pauses")}.
      Routes come from ${fr ? to(fr, "api_key", fr === "flightradar24" ? "Flightradar24" : "FlightAware") + (allowance ? `, ${to(fr, fr === "flightradar24" ? "monthly_credits" : "monthly_limit", `${num(allowance)} a month`)} with ${to(fr, "safety_margin", `${Math.round(v(fr, "safety_margin") * 100)}% held back`)}` : "") : to("flightradar24", "api_key", "the free database")}.</p>`,
    `<p>The wall panel shows ${to("kiosk", "view", say(st("kiosk", "view")).toLowerCase())}${quiet ? `, going quiet ${to("kiosk", "quiet", quiet.replace("-", " to "))}` : `, ${to("kiosk", "quiet", "never going quiet")}`};
      ${v("map", "style") === "off" ? `the radar has ${to("map", "style", "no map under it")}` : `the radar is over ${to("map", "style", say(st("map", "style")).toLowerCase())} at ${to("map", "opacity", `${Math.round(v("map", "opacity") * 100)}%`)}`}.
      The wall is ${to("server", "key", v("server", "key")?.set ? "behind a private link" : "open to anyone who can reach it")},
      and ${to("health", "notify_url", v("health", "notify_url")?.set ? "problems are sent to your phone" : "problems aren't sent anywhere")}.</p>`,
  ];
  return parts.join("");
}
