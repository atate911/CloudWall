// Shared helpers: geometry (same maths as the backend), colours, units.
export const R_M = 6371008.8, NM_M = 1852, FT_M = 0.3048;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

export function haversineNm(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * R_M * Math.asin(Math.min(1, Math.sqrt(a)))) / NM_M;
}
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
/** Great-circle step from (lat, lon); returns [lon, lat]. */
export function destination(lat, lon, brg, distNm) {
  const d = (distNm * NM_M) / R_M, b = rad(brg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((deg(l2) + 540) % 360) - 180, deg(p2)];
}
/** Theoretical radio horizon (nm): 1.23 * (sqrt(h_antenna_ft) + sqrt(h_ft)). */
export const radioHorizonNm = (antFt, altFt) => 1.23 * (Math.sqrt(Math.max(antFt, 0)) + Math.sqrt(Math.max(altFt, 0)));

// ---- colours
const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  return stops[i].map((v, k) => Math.round(lerp(v, stops[i + 1][k], f)));
}
// low = warm -> high = cool
export const ALT_STOPS = [[228, 87, 46], [243, 167, 18], [168, 194, 86], [41, 168, 171], [61, 90, 153]];
// weak = dark purple -> strong = yellow
export const RSSI_STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
export const GROUND_COLOR = [142, 68, 173];
export const altColor = (ft, maxFt = 45000) => ramp(ALT_STOPS, ft / maxFt);
export const rssiColor = (r) => ramp(RSSI_STOPS, r == null ? 0 : (r + 33) / 30);
export const rgbCss = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const rgbHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

// ---- units
export const UNIT_NM = { nm: 1, mi: 1.150779, km: 1.852 };
export function fmtDist(nm, unit) {
  return `${Math.round(nm * UNIT_NM[unit])} ${unit}`;
}
/** "50 nm · 58 mi · 93 km", the chosen unit first. */
export function ringLabel(nm, unit) {
  const order = [unit, ...["nm", "mi", "km"].filter((u) => u !== unit)];
  return order.map((u) => fmtDist(nm, u)).join(" · ");
}
export const fmtAlt = (ft) => (ft == null ? "–" : Math.round(ft).toLocaleString() + " ft");
export const fmtBrg = (b) => String(Math.round(b) % 360).padStart(3, "0") + "°";
export function fmtTime(t) {
  return new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
export function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
}
