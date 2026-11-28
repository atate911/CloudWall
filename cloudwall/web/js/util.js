// Small shared helpers: DOM, formatting, geometry, sun position.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;
export const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// The phone layout (app.js sets it from the screen's size): "stack" upright, where the panels take
// their natural height and the page scrolls; "side" turned sideways, card and radar side by side.
export function phone() {
  const c = document.documentElement.classList;
  return c.contains("phone") ? (c.contains("land") ? "side" : "stack") : null;
}

export const ident = (a) => a.flight_no || a.callsign || a.reg || a.hex.toUpperCase();
// Seconds since the positions in a state were reported (app.js stamps each state with _at): what
// to take off a countdown worked out at that moment.
// How old the state's positions are, in seconds: from when the feed reported them.
export const dataAge = (state) => (state && state._at ? Math.max(0, (Date.now() - state._at) / 1000) : 0);
// The same for the countdowns, which stop once the data is 20 s old rather than run on with nothing
// new (the page marks it old): the server's times hold still between updates, so each redraw agrees.
export const COUNT_STOP_S = 20;
export const since = (state) => Math.min(COUNT_STOP_S, dataAge(state));
// The runways in use, in words: "28L / 28R" -> "28L and 28R"; "27C / 27L / 27R" -> "27C, 27L and 27R".
export function runwayList(runways) {
  const r = String(runways || "").split(/\s*\/\s*/).filter(Boolean);
  return r.length > 1 ? `${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}` : r.join("");
}
// A temperature for show: "54°F", or "–" when the report has none (a failed sensor does that),
// which must not come out as 32°F.
export const degF = (c) => (c == null ? "–" : `${Math.round((c * 9) / 5 + 32)}°F`);
export const altText = (a) => (a.on_ground ? "GND" : a.alt == null ? "–" : num(a.alt));

// Where the aircraft will be `dt` seconds from its last report, holding track and speed.
export function projected(a, dt) {
  const d = ((a.gs || 0) * dt) / 3600, t = (a.track || 0) * RAD;
  return { lat: a.lat + (d * Math.cos(t)) / 60, lon: a.lon + (d * Math.sin(t)) / (60 * Math.cos(a.lat * RAD)) };
}
// Nautical miles east (x) and north (y) of home.
export function offset(home, p) {
  return { x: (p.lon - home.lon) * 60 * Math.cos(home.lat * RAD), y: (p.lat - home.lat) * 60 };
}
// Compass bearing and angle above the horizon of a point at `alt` feet, seen from home.
export function azEl(home, p, alt) {
  const o = offset(home, p), dist = Math.hypot(o.x, o.y);
  return {
    az: (Math.atan2(o.x, o.y) / RAD + 360) % 360, dist,
    el: Math.atan2((alt || 0) - (home.elevation_ft || 0), Math.max(dist, 0.01) * 6076.12) / RAD,
  };
}
// Sun azimuth/elevation (degrees). Low-precision almanac formula, good to a fraction of a degree.
export function sunPosition(date, lat, lon) {
  const d = date / 86400000 + 2440587.5 - 2451545;
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra, phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { el: el / RAD, az: (az / RAD + 360) % 360 };
}

export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem("cloudwall." + key);
    localStorage.setItem("cloudwall." + key, value);
  } catch (e) { /* private mode: settings just don't persist */ }
  return value;
}

// Which place this screen shows, when CloudWall watches several: ?place= in the address, else
// the desktop's choice from the place menu. Without either, the kiosk asks for the place its
// settings name and any other screen gets the first. Every API call carries it.
const PAGE = typeof location === "undefined" ? { search: "", pathname: "" } : location;   // no page: the tests' Node
const PARAMS = new URLSearchParams(PAGE.search);
const KIOSK_PAGE = /\/kiosk\/?$/.test(PAGE.pathname) || PARAMS.get("mode") === "kiosk";
export const placeChoice = PARAMS.get("place") || (KIOSK_PAGE ? "" : store("place") || "");
// A request left unanswered is given up after a while: a server that takes the connection and then
// says nothing (a frozen one, or a proxy with nothing behind it) would otherwise hold every poll open.
const API_WAIT_MS = 15000;
export function api(path, opts) {
  const q = placeChoice ? `place=${encodeURIComponent(placeChoice)}` : KIOSK_PAGE ? "kiosk=1" : "";
  const wait = !opts?.signal && typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(API_WAIT_MS) } : null;
  return fetch(q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path, wait ? { ...opts, ...wait } : opts);
}

// Airlines whose logo the server couldn't give: left out of what is drawn for a while, since the lists
// are drawn afresh every couple of seconds and each would ask again (and flash an empty tile).
const noLogo = new Map(), NO_LOGO_MS = 10 * 60 * 1000;
export const logoFailed = (code) => { noLogo.set(String(code), Date.now()); };
export const hasLogo = (code) => !!code && !(Date.now() - (noLogo.get(String(code)) || -Infinity) < NO_LOGO_MS);

// "AERO MAINTENANCE INC" -> "Aero Maintenance Inc"; leaves mixed-case names alone.
const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "USA", "US", "FAA", "II", "III", "IV", "PDX", "CO.", "DBA"]);
export function tidyName(name) {
  if (!name || name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name.toLowerCase().replace(/[a-z0-9.&'-]+/g, (w) =>
    KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase()
      : (w[0].toUpperCase() + w.slice(1)).replace(/^(O'|Mc)([a-z])/, (m, p, c) => p + c.toUpperCase()));
}

// Seats on board, from the bundled table: exact for a known airline layout, "about" for a type's typical count.
export function seatWords(s) {
  if (!s) return null;
  if (s.basis === "cargo") return "Cargo, no passengers";
  const n = s.lo === s.hi ? num(s.n) : s.basis === "airline" ? `${num(s.lo)}–${num(s.hi)}` : `about ${num(s.n)}`;
  return `${n} seat${s.n === 1 ? "" : "s"}`;
}
