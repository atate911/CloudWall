// Sun and moon for the house: rise and set times, twilight, and the moon's phase.
// Low-precision formulas (after Meeus, as popularised by SunCalc): good to a minute or two,
// plenty for "when does it get dark".
import { sunPosition } from "./util.js";

const RAD = Math.PI / 180, OBL = RAD * 23.4397;
const days = (ms) => ms / 86400000 - 0.5 + 2440588 - 2451545;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  return { ra: ra(L, 0), dec: dec(L, 0) };
}
function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
  return { ra: ra(l, b), dec: dec(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

export function moonPosition(ms, lat, lon) {
  const d = days(ms), c = moonCoords(d), phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - c.ra;
  const el = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
  return { el: el / RAD, az: (az / RAD + 180) % 360 };
}

// phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter; fraction: share of the disc lit
export function moonPhase(ms) {
  const d = days(ms), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (ang < 0 ? -1 : 1)) / Math.PI };
}

export function phaseName(p) {
  if (p < 0.03 || p > 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

// Times today (local midnight to midnight) when an altitude curve crosses a threshold.
function crossings(alt, threshold, from, to, step = 5 * 60000) {
  const up = [], down = [];
  let t0 = from, a0 = alt(from) - threshold;
  for (let t = from + step; t <= to; t += step) {
    const a = alt(t) - threshold;
    if ((a0 < 0) !== (a < 0)) (a > 0 ? up : down).push(t0 + (step * a0) / (a0 - a));
    t0 = t; a0 = a;
  }
  return { up: up[0] ?? null, down: down[0] ?? null };
}

function nextPhase(from, target) {
  // the first hour after `from` when the phase passes `target` (0 = new, 0.5 = full)
  let prev = moonPhase(from).phase;
  for (let t = from + 3600000; t < from + 31 * 86400000; t += 3600000) {
    const p = moonPhase(t).phase;
    if (target === 0 ? p < prev - 0.5 : prev < target && p >= target) return t;
    prev = p;
  }
  return null;
}

export function skyToday(lat, lon, now = Date.now()) {
  // the house's own day, from solar midnight to solar midnight, so sunrise always comes before
  // sunset whatever timezone the screen's clock is set to
  const DAY = 86400000, shift = (((-lon / 15) * 3600000) % DAY + DAY) % DAY;
  const from = Math.floor((now - shift) / DAY) * DAY + shift, to = from + DAY;
  const sunAlt = (t) => sunPosition(t, lat, lon).el, moonAlt = (t) => moonPosition(t, lat, lon).el;
  const sun = crossings(sunAlt, -0.833, from, to), civil = crossings(sunAlt, -6, from, to);
  const moon = crossings(moonAlt, 0.133, from, to), ph = moonPhase(now);
  return {
    sunrise: sun.up, sunset: sun.down, dawn: civil.up, dusk: civil.down,
    daylight: sun.up && sun.down ? sun.down - sun.up : null,
    moonrise: moon.up, moonset: moon.down, moonUp: moonAlt(now) > 0,
    phase: ph.phase, lit: ph.fraction, phaseName: phaseName(ph.phase),
    nextFull: nextPhase(now, 0.5), nextNew: nextPhase(now, 0),
  };
}

// The moon as seen from the northern hemisphere: lit on the right while waxing.
export function moonGlyph(r, phase, fraction) {
  const k = Math.abs(Math.cos(phase * 2 * Math.PI)) * r;
  const gibbous = fraction > 0.5, waning = phase > 0.5;
  const lit = fraction < 0.02 ? "" : fraction > 0.98 ? `<circle r="${r}" class="moon-lit"/>`
    : `<path class="moon-lit" transform="${waning ? "scale(-1,1)" : ""}" d="M0,${-r} A${r},${r} 0 0 1 0,${r} A${k.toFixed(2)},${r} 0 0 ${gibbous ? 1 : 0} 0,${-r} Z"/>`;
  return `<circle r="${r}" class="moon-dark"/>${lit}`;
}
export function moonSvg(size, phase, fraction) {
  return `<svg class="moon" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" role="img" aria-label="Moon, ${Math.round(fraction * 100)}% lit">
    ${moonGlyph(size / 2 - 1, phase, fraction)}</svg>`;
}
