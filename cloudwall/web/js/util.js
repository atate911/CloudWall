// Small shared helpers: DOM, formatting, geometry, sun position.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;
export const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export const ident = (a) => a.flight_no || a.callsign || a.reg || a.hex.toUpperCase();
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
export function angularSeparation(a, b) {
  const c = Math.sin(a.el * RAD) * Math.sin(b.el * RAD) + Math.cos(a.el * RAD) * Math.cos(b.el * RAD) * Math.cos((a.az - b.az) * RAD);
  return Math.acos(clamp(c, -1, 1)) / RAD;
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

export function mix(c1, c2, t) { // "#rrggbb" colours
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1)).toString(16).padStart(2, "0")).join("");
}
export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem("cloudwall." + key);
    localStorage.setItem("cloudwall." + key, value);
  } catch (e) { /* private mode: settings just don't persist */ }
  return value;
}

// "AERO MAINTENANCE INC" -> "Aero Maintenance Inc"; leaves mixed-case names alone.
const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "USA", "US", "FAA", "II", "III", "IV", "PDX", "CO.", "DBA"]);
export function tidyName(name) {
  if (!name || name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name.toLowerCase().replace(/[a-z0-9.&'-]+/g, (w) =>
    KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase()
      : (w[0].toUpperCase() + w.slice(1)).replace(/^(O'|Mc)([a-z])/, (m, p, c) => p + c.toUpperCase()));
}
