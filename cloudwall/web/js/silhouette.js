// Side elevations of aircraft, drawn to scale from each family's real dimensions.
// Profiles (profiles.js) are in metres: stations s run aft from the nose tip and heights z
// run up from the keel. Fuselage outlines are given in fuselage heights (D) so that a
// family's stretches share one nose and tail. The drawing faces right.
import { profileFor } from "./profiles.js";

const tan = (deg) => Math.tan((deg * Math.PI) / 180);
const lerp = (a, b, t) => a + (b - a) * t;
// half-thickness of a section at chord fraction x, per unit thickness ratio (NACA 4-digit)
const half = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

let uid = 0;

class Sketch {
  constructor(L) {
    this.L = L;
    this.out = [];
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
  }
  xy(s, z) {
    const x = this.L - s, y = -z, b = this.box;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
    return [x, y];
  }
  // A smooth path through [s, z, flags] points. Flag "l" draws a straight line to the next
  // point; "c" makes a corner. Curves leave a straight neighbour along it, so a nose
  // blends into the cabin without bulging.
  curve(pts, closed = true) {
    const n = pts.length, P = pts.map(([s, z]) => this.xy(s, z));
    const at = (i) => (closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
    const flag = (i) => pts[at(i)][2] || "";
    const straight = (i) => (closed || (i >= 0 && i < n - 1)) && flag(i).includes("l");
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
    const tangent = (i) => {
      if (flag(i).includes("c") || (!closed && (i === 0 || i === n - 1))) return null;
      const a = straight(i - 1), b = straight(i);
      if (a && b) return null;
      if (a) return unit(P[at(i - 1)], P[at(i)]);
      if (b) return unit(P[at(i)], P[at(i + 1)]);
      return unit(P[at(i - 1)], P[at(i + 1)]);
    };
    const f = (v) => +v.toFixed(2);
    let d = `M${f(P[0][0])},${f(P[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = P[i], b = P[at(i + 1)];
      if (straight(i)) { d += `L${f(b[0])},${f(b[1])}`; continue; }
      const k = Math.hypot(b[0] - a[0], b[1] - a[1]) / 3, chord = unit(a, b);
      const ta = tangent(i) || chord, tb = tangent(at(i + 1)) || chord;
      d += `C${f(a[0] + ta[0] * k)},${f(a[1] + ta[1] * k)} ${f(b[0] - tb[0] * k)},${f(b[1] - tb[1] * k)} ${f(b[0])},${f(b[1])}`;
    }
    return d + (closed ? "Z" : "");
  }
  path(cls, d, extra = "") { this.out.push(`<path class="${cls}" d="${d}"${extra}/>`); return d; }
  smooth(cls, pts, closed = true, extra = "") { return this.path(cls, this.curve(pts, closed), extra); }
  poly(cls, pts, closed = true) {
    return this.path(cls, "M" + pts.map(([s, z]) => this.xy(s, z).map((v) => +v.toFixed(2)).join(",")).join("L") + (closed ? "Z" : ""));
  }
  ellipse(cls, s, z, rx, ry) {
    const [x, y] = this.xy(s, z);
    this.xy(s - rx, z - ry); this.xy(s + rx, z + ry);
    this.out.push(`<ellipse class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${rx.toFixed(3)}" ry="${ry.toFixed(3)}"/>`);
  }
}

// ---------- fuselage ----------

// The outline as one closed loop: nose tip, crown, tail, keel (with the wing-to-body fairing
// bulging under it), back to the nose.
function hull(f, fair) {
  const D = f.D, L = f.L, pts = [];
  if (f.body) return f.body.map(([s, z, fl]) => [s * D, z * D, fl]);
  const { nose, tail } = f;
  pts.push([0, nose.tip * D, nose.tipFlag]);
  nose.top.forEach(([s, z, fl], i, a) => pts.push([s * D, z * D, i === a.length - 1 ? "l" : fl]));
  tail.top.forEach(([s, z, fl], i, a) => pts.push([L - s * D, z * D, i === a.length - 1 ? "cl" : fl]));
  const bot = tail.bot.map(([s, z, fl]) => [L - s * D, z * D, fl]).reverse();
  bot[0][2] = "c";
  bot[bot.length - 1][2] = "l";
  pts.push(...bot);
  if (fair) {
    const [a, b, depth] = fair;
    pts.push([b, 0], [lerp(a, b, 0.5), -depth], [a, 0, "l"]);
  }
  nose.bot.slice().reverse().forEach(([s, z, fl]) => pts.push([s * D, z * D, fl]));
  return pts;
}

// Height of the outline's upper (or lower) edge at station s, by straight interpolation.
function edge(pts, upper) {
  const tipI = pts.reduce((m, p, i) => (p[0] < pts[m][0] ? i : m), 0);
  const tailI = pts.reduce((m, p, i) => (p[0] > pts[m][0] ? i : m), 0);
  const line = [];
  for (let i = tipI; ; i = (i + 1) % pts.length) { line.push(pts[i]); if (i === tailI) break; }
  const top = line[Math.floor(line.length / 2)][1] > pts[tipI][1];
  let seq = line;
  if (top !== upper) { seq = []; for (let i = tailI; ; i = (i + 1) % pts.length) { seq.push(pts[i]); if (i === tipI) break; } seq.reverse(); }
  return (s) => {
    for (let i = 1; i < seq.length; i++) {
      const [s0, z0] = seq[i - 1], [s1, z1] = seq[i];
      if (s >= Math.min(s0, s1) && s <= Math.max(s0, s1) && s1 !== s0) return lerp(z0, z1, (s - s0) / (s1 - s0));
    }
    return seq[s < seq[0][0] ? 0 : seq.length - 1][1];
  };
}

// ---------- lifting surfaces ----------

// Planform of one wing (or tailplane half): the section at fraction e of the exposed span,
// placed back by the sweep and up by the dihedral.
function planform(w) {
  const y0 = w.root, y1 = w.span / 2, sw = tan(w.sweep), dh = tan(w.dih || 0);
  const [ek, ck] = w.kink || [0, w.cr];
  return (e) => {
    const y = lerp(y0, y1, e);
    let le = w.le + (y - y0) * sw;
    let c = ek && e < ek ? lerp(w.cr, ck, e / ek) : lerp(ck, w.ct, ek ? (e - ek) / (1 - ek) : e);
    if (w.rake && e > w.rake[0]) {
      // raked tip: the leading edge sweeps harder while the trailing edge carries on
      const te = le + c, yr = lerp(y0, y1, w.rake[0]);
      le += (y - yr) * (tan(w.rake[1]) - sw);
      c = Math.max(w.ct * 0.35, te - le + (y - yr) * (w.rake[2] || 0));
    }
    let z = w.z + (y - y0) * dh;
    if (w.bend) z += w.bend * e * e;   // in-flight flex: the tips ride up
    return { y, le, c, z, e, t: lerp(w.t ? w.t[0] : 0.14, w.t ? w.t[1] : 0.1, e), inc: lerp(w.inc || 0, 0, e) };
  };
}

const upper = (q, x) => q.z + (0.25 - x) * q.c * q.inc * 0.01745 + q.c * (0.06 * x * (1 - x) * (q.t > 0.11 ? 1 : 0.5) + q.t * half(x));
const lower = (q, x) => q.z + (0.25 - x) * q.c * q.inc * 0.01745 + q.c * (0.03 * x * (1 - x) - 0.8 * q.t * half(x));

// The surface seen from the side is the union of all its sections.
function envelope(sec, n = 70, m = 150) {
  const S = [];
  for (let i = 0; i <= n; i++) S.push(sec(i / n));
  const s0 = Math.min(...S.map((q) => q.le)), s1 = Math.max(...S.map((q) => q.le + q.c));
  const up = [], lo = [];
  for (let j = 0; j <= m; j++) {
    // denser near the ends so leading and trailing edges stay round
    const t = 0.5 - 0.5 * Math.cos((Math.PI * j) / m), s = lerp(s0, s1, t);
    let u = -Infinity, l = Infinity;
    for (const q of S) {
      const x = (s - q.le) / q.c;
      if (x < 0 || x > 1) continue;
      u = Math.max(u, upper(q, x));
      l = Math.min(l, lower(q, x));
    }
    if (u > -Infinity) { up.push([s, u, "l"]); lo.push([s, l, "l"]); }
  }
  return [...up, ...lo.reverse()];
}

function surface(sk, cls, w) {
  const sec = planform(w);
  sk.poly(cls, envelope(sec));
  return sec;
}

// Wingtip devices at the tip section q. Heights and chords in metres; sweep of the
// leading edge in degrees.
function winglet(sk, q, t) {
  const le = q.le, c = q.c, z = upper(q, 0.3), sw = tan(t.sweep ?? 40);
  if (t.type === "fence") {
    // Airbus wingtip fence: an arrowhead above and below the tip
    sk.poly("wl", [[le - c * 0.15, z - 0.02], [le + c * 0.62, z + t.h], [le + c * 1.02, z + t.h - 0.04], [le + c * 0.98, z],
      [le + c * 0.98, z - t.lo], [le + c * 0.6, z - t.lo + 0.04], [le - c * 0.15, z - 0.12]]);
    return;
  }
  const base = t.base ?? 0.92;          // share of the tip chord the device's root covers
  const tc = t.top ?? c * 0.3;           // chord at the top
  const r0 = le + c * (1 - base), r1 = le + c * 0.995;
  const tl = r0 + t.h * sw, blend = t.blend ?? 0;   // blend: radius of the curved root, metres
  if (t.lo) {
    // lower blade (737 MAX split scimitar, MD-11)
    const lz = lower(q, 0.55), lsw = tan(t.loSweep ?? 30);
    sk.smooth("wl", [[le + c * 0.3, lz + 0.05, "c"], [le + c * 0.3 + t.lo * lsw, lz - t.lo, "c"], [le + c * 0.3 + t.lo * lsw + (t.loTip ?? 0.3), lz - t.lo, "c"], [r1, lz + 0.02, "c"]]);
  }
  const pts = [[r0 - blend * 0.8, z - 0.04, "c"]];
  if (blend) pts.push([r0 + blend * sw * 0.6, z + blend, "l"]);
  else pts[0][2] = "cl";
  pts.push([tl, z + t.h, "c"], [tl + tc, z + t.h, "cl"], [r1, z - 0.02, "c"]);
  sk.smooth("wl", pts);
}

// ---------- engines ----------

// A turbofan nacelle, inlet face at station s0, centreline at height zc.
function fan(sk, s0, zc, n) {
  const Ln = n.len, R = n.dia / 2, long = n.style === "long", S = (u) => s0 + u * Ln;
  const fx = n.fx ?? (long ? 0.86 : 0.6), ex = long ? 0.62 : 0.86, lo = n.style === "flat" ? 0.86 : 1, cx = n.cx ?? 0.82;
  if (!long) {
    // core cowl and plug behind the fan nozzle
    sk.poly("core", [[S(fx - 0.08), zc + 0.6 * R], [S(cx), zc + 0.44 * R], [S(cx), zc + 0.33 * R], [S(1), zc + 0.03 * R],
      [S(1), zc - 0.03 * R], [S(cx), zc - 0.33 * R], [S(cx), zc - 0.44 * R], [S(fx - 0.08), zc - 0.6 * R * lo]]);
    sk.poly("plug", [[S(cx), zc + 0.33 * R], [S(1), zc + 0.03 * R], [S(1), zc - 0.03 * R], [S(cx), zc - 0.33 * R]]);
  } else {
    const pr = n.plug ?? 0.45;   // radius of the exhaust cone at the nozzle, share of R
    sk.poly("plug", [[S(fx), zc + pr * R], [S(1), zc + 0.05 * R], [S(1), zc - 0.05 * R], [S(fx), zc - pr * R]]);
  }
  const exit = [];
  if (n.chev) {
    // chevrons: a saw-tooth fan nozzle
    const k = 7;
    for (let i = 0; i <= 2 * k; i++) exit.push([S(fx) - (i % 2 ? 0.045 * Ln : 0), zc + ex * R * lerp(1, -lo, i / (2 * k)), "c"]);
  } else exit.push([S(fx), zc + ex * R, "c"], [S(fx), zc - ex * R * lo, "c"]);
  sk.smooth("nac", [
    [S(0), zc + 0.8 * R], [S(0.07), zc + 0.97 * R], [S(0.3), zc + R],
    ...(long ? [[S(0.6), zc + 0.93 * R]] : []), ...exit,
    ...(long ? [[S(0.6), zc - 0.93 * R * lo]] : []),
    [S(0.3), zc - R * lo], [S(0.07), zc - 0.95 * R * lo], [S(0), zc - 0.78 * R * lo, "l"],
  ]);
  // the inlet seen slightly from ahead, and the cowl seams
  sk.ellipse("inlet", S(0.012), zc + 0.01 * R, 0.07 * R, 0.79 * R * (1 + lo) / 2);
  if (!long && !n.plain) {
    sk.poly("hl", [[S(0.24), zc + R * 0.99], [S(0.24), zc - R * lo * 0.99]], false);
    sk.poly("hl", [[S(fx * 0.72), zc + R * 0.96], [S(fx * 0.72), zc - R * lo * 0.96]], false);
  }
}

function pylon(sk, q, s0, zc, n) {
  const R = n.dia / 2, Ln = n.len;
  const top = (x) => lower(q, x) + 0.05;
  const front = n.pyFront ?? 0.18, aft = n.pyAft ?? 0.95;
  sk.poly("pyl", [[s0 + front * Ln, zc + R * 0.9], [q.le - (n.pyLead ?? 0.2), top(0) - 0.1], [q.le + 0.35 * q.c, top(0.35)],
    [q.le + (n.pyTe ?? 0.75) * q.c, top(n.pyTe ?? 0.75)], [s0 + aft * Ln, zc + R * (n.style === "long" ? 0.55 : 0.4)], [s0 + 0.5 * Ln, zc + R * 0.8]]);
}

// A propeller seen edge-on: a faint disc with two blades.
function prop(sk, s, z, d, n = 4) {
  sk.ellipse("disc", s, z, Math.min(0.22, d * 0.05), d / 2);
  const w = Math.min(0.16, d * 0.04);
  for (const sgn of [1, -1]) {
    sk.smooth("blade", [[s, z, "c"], [s - w, z + sgn * d * 0.18], [s - w * 0.6, z + sgn * d * 0.47], [s, z + sgn * d / 2, "c"], [s + w * 0.4, z + sgn * d * 0.3]]);
  }
  if (n > 2) sk.poly("blade", [[s - w * 0.6, z - 0.04 * d], [s + w * 0.6, z - 0.04 * d], [s + w * 0.6, z + 0.04 * d], [s - w * 0.6, z + 0.04 * d]]);
}

// A wing-mounted turboprop nacelle; spinner tip at s0, centreline at zc.
function propNacelle(sk, s0, zc, n, q) {
  const Ln = n.len, R = n.dia / 2, S = (u) => s0 + u * Ln, sp = n.spinner ?? 0.1;
  const topZ = n.over ? Math.max(zc + R, upper(q, 0.2) + n.over) : zc + R;
  sk.smooth("nac", [
    [S(0), zc, "c"], [S(sp * 0.55), zc + R * 0.42], [S(sp), zc + R * 0.55, "c"],
    [S(sp + 0.04), zc + R * 0.8], [S(0.3), topZ], [S(0.62), topZ - R * 0.05], [S(1), zc + R * (n.tailZ ?? 0.15), "c"],
    [S(0.75), zc - R * 0.55], [S(0.4), zc - R * (n.belly ?? 1)], [S(sp + 0.06), zc - R * 0.8], [S(sp), zc - R * 0.55, "c"],
    [S(sp * 0.55), zc - R * 0.42],
  ]);
  sk.poly("hl", [[S(sp), zc + R * 0.55], [S(sp), zc - R * 0.55]], false);
  if (n.exhaust) sk.ellipse("inlet", S(n.exhaust), zc + R * 0.35, R * 0.18, R * 0.12);
  prop(sk, S(sp * 0.75), zc, n.prop, n.blades);
}

// Shrink a convex pane by a frame width, keeping its flags.
function inset(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [a, b] = [pts[i], pts[(i + 1) % n]]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * sgn, nz = (dx / l) * sgn;
    return [[a[0] + nx * d, a[1] + nz * d], [dx, dz]];
  });
  return pts.map((p, i) => {
    const [p1, d1] = lines[(i - 1 + n) % n], [p2, d2] = lines[i];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return [p2[0], p2[1], p[2]];
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return [p1[0] + d1[0] * t, p1[1] + d1[1] * t, p[2]];
  });
}

// ---------- the drawing ----------
// The kit handed to a profile's extras/overlays functions:
//   sk          the sketch: sk.smooth(cls, [[s, z, flags]...]), sk.poly(cls, pts, closed), sk.ellipse(cls, s, z, rx, ry)
//   f, D, L     the resolved profile, fuselage height, fuselage length (nose to tail-cone end)
//   top(s)      height of the fuselage's upper edge at station s;  at(s): s < 0 counts from the tail end
//   sec(e)      the wing section at span fraction e {le, c, z, y} (null before the wing is drawn)
//   fan(sk, s0, zc, spec), prop(sk, s, z, d, blades), propNacelle(sk, s0, zc, spec, q), pylon(sk, q, s0, zc, spec)
//   surface(sk, cls, wingSpec) draws a lifting surface and returns its sec(); upper/lower(q, x) section heights
// Classes: hull fin stab wing wl nac pyl core plug inlet glass win door hl ftf disc blade rotor strut skid tire hub pant fen

function draw(f) {
  const L = f.L, D = f.D, sk = new Sketch(L), id = `sil${++uid}`;
  const stretch = L - (f.L0 || L);
  const w = f.wing && { root: f.W / 2, ...f.wing, le: f.wing.le + stretch * (f.fwd ?? 0.5), z: f.wing.z * D };
  const fair = w && f.fair !== 0 ? [w.le - 0.18 * w.cr, w.le + (f.fairAft ?? 1.15) * w.cr, (f.fair ?? 0.05) * D] : null;
  const H = hull(f, fair), top = edge(H, true);
  const at = (s) => (s < 0 ? L + s : s);

  // fin and the centre engine sit behind the near side of the fuselage
  let finTop = null, finAt = null;
  if (f.fin) {
    const t = f.fin, s0 = L - t.le, sw = tan(t.sweep);
    // the fin root sits on the tail cone, or on the centre engine of a trijet
    const zr = t.base != null ? D + t.base : top(s0), zt = D + t.h, root = (s) => (t.base != null ? zr : top(s));
    const tipLE = s0 + (zt - zr) * sw, tipTE = tipLE + t.ct;
    const [fl, fh, straightFillet] = t.fillet || [0, 0];
    const a = s0 - fl, pts = [[a - 0.6, root(a - 0.6) - 0.4, "l"], [a - 0.6, root(a - 0.6) - 0.02, "l"]];
    if (fl) pts.push([a, root(a) - 0.02, straightFillet ? "cl" : ""], [s0 + fh * sw, zr + fh, straightFillet ? "cl" : "l"]);
    else pts.push([s0, zr - 0.02, "l"]);
    if (t.round) {
      // a rounded leading corner: leave the leading edge early and curve onto the tip
      const r = t.round;
      pts.push([tipLE - r * sw, zt - r, ""], [tipLE + r * 0.9, zt, ""]);
    } else pts.push([tipLE, zt, "c"]);
    if (t.cap) pts.push([tipLE + t.ct * 0.5, zt + t.cap]);
    pts.push([tipTE, zt, "cl"], [s0 + t.cr, root(s0 + t.cr) - 0.4, "l"]);
    sk.smooth("fin", pts);
    const r = t.rudder ?? 0.7;
    if (r) sk.poly("hl", [[s0 + t.cr * r, root(s0 + t.cr * r)], [tipLE + t.ct * r, zt - 0.05]], false);
    finTop = zt; finAt = { s0, sw, zr, tipLE };
  }
  if (f.tailEng) {
    const e = f.tailEng, s0 = L - e.s, zc = D + e.z;
    sk.poly("pyl", [[s0 + 0.2 * e.len, zc], [s0 + e.len * 0.95, zc], [s0 + e.len, top(s0 + e.len) - 0.3], [s0 + 0.1 * e.len, top(s0 + 0.1 * e.len) - 0.3]]);
    fan(sk, s0, zc, e);
  }

  // fuselage, with a little roundness from the light above
  const hd = sk.smooth("hull", H);
  sk.path("shade", hd, ` fill="url(#${id})"`);
  // one-off parts a profile draws itself; see kit below
  const kit = { sk, f, D, L, top, at, sec: null, fan, prop, propNacelle, surface, pylon, upper, lower, tan, lerp };
  for (const extra of f.extras || []) extra(kit);

  // doors, cabin windows and the flight deck glazing
  const doors = (f.doors || []).map(([s, wd, kind = "D", anchor, h]) => ({ s: anchor === "w" ? w.le + s : at(s), w: wd, kind, h }));
  const floor = (f.floor ?? 0.36) * D;
  for (const d of doors) {
    const h = d.h || (d.kind === "E" ? 0.95 : d.kind === "C" ? floor - 0.35 : d.kind === "U" ? 1.6 : 1.85);
    const z0 = d.kind === "E" ? floor + 0.42 : d.kind === "C" ? 0.25 : d.kind === "U" ? (f.upper ?? 1.1) * D : floor + 0.05;
    const [x, y] = sk.xy(d.s + d.w / 2, z0 + h);
    sk.out.push(`<rect class="door${d.kind === "C" ? " cargo" : ""}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${d.w}" height="${h.toFixed(2)}" rx="${Math.min(0.2, d.w / 3)}"/>`);
  }
  for (const r of f.win || []) {
    const from = at(r.from), to = at(r.to), p = r.pitch || 0.53, ww = r.w || 0.24, wh = r.h || 0.34, z = r.z * D;
    const deck = doors.filter((dd) => dd.kind !== "C" && (dd.kind === "U") === !!r.upper);
    const spots = [];
    for (let s = from; s <= to + 1e-6; s += p) if (!deck.some((dd) => Math.abs(s - dd.s) < dd.w / 2 + ww / 2 + 0.06)) spots.push(s);
    // overwing exits carry a window of their own
    for (const dd of deck) if (dd.kind === "E" && dd.s > from - p && dd.s < to + p) spots.push(dd.s);
    // each window is a stroked segment with round caps: a tall or a wide stadium
    const tall = wh >= ww, run = Math.abs(wh - ww);
    let d = "";
    for (const s of spots) {
      const [x, y] = sk.xy(s, z);
      d += tall ? `M${x.toFixed(2)},${(y - run / 2).toFixed(2)}v${run.toFixed(2)}` : `M${(x - run / 2).toFixed(2)},${y.toFixed(2)}h${run.toFixed(2)}`;
    }
    if (d) sk.path("win", d, ` stroke-width="${Math.min(ww, wh)}"`);
  }
  for (const pane of f.glass || []) sk.smooth("glass", inset(pane.map(([s, z, fl]) => [s * D, z * D, fl ?? "c"]), f.frame ?? 0.06));
  if (f.mask) sk.smooth("glass mask", f.mask.map(([s, z, fl]) => [s * D, z * D, fl]));

  // tailplane
  if (f.stab) {
    const t = f.stab, z = t.z === "T" ? finTop - (t.drop ?? 0.1) : t.fz != null ? lerp(finAt.zr, finTop, t.fz) : t.z * D;
    surface(sk, "stab", { root: t.root ?? 0.3, ...t, le: L - t.le, z, t: [t.thick ?? 0.1, 0.08] });
    if (t.z === "T" && t.bullet) {
      const [bl, bd] = t.bullet, s0 = finAt.tipLE - bl * 0.25;
      sk.smooth("fin", [[s0, z + 0.05], [s0 + bl * 0.25, z + bd], [s0 + bl, z + bd * 0.6], [s0 + bl * 1.05, z - 0.05, "c"], [s0 + bl * 0.4, z - bd * 0.3]]);
    }
  }

  // wing, its tips, the flap track fairings, then the engines in front of it
  let sec = null;
  if (w) {
    sec = kit.sec = surface(sk, "wing", w);
    for (const spec of f.ftf || []) {
      // a span fraction, or [span fraction, start, end, depth] in shares of the local chord
      const [e, x0, x1, dp] = Array.isArray(spec) ? spec : [spec, 0.62, 1.12, f.ftfDepth ?? 0.045];
      const q = sec(e), s = q.le, c = q.c;
      sk.smooth("ftf", [[s + c * x0, lower(q, x0) + 0.02, "c"], [s + c * lerp(x0, 1, 0.68), lower(q, lerp(x0, 1, 0.68)) - dp * c], [s + c * x1, lower(q, 1) - 0.01 * c, "c"], [s + c * 0.99, lower(q, 0.99) + 0.02, "c"]]);
    }
    if (f.tip) winglet(sk, sec(1), f.tip);
    if (f.struts) for (const [e, s0, z0] of f.struts) {
      const q = sec(e);
      sk.poly("strut", [[at(s0), z0 * D], [q.le + q.c * 0.3, lower(q, 0.3)], [q.le + q.c * 0.42, lower(q, 0.42)], [at(s0) + 0.12, z0 * D]]);
    }
  }
  if (f.eng) {
    const e = f.eng;
    for (const eta of e.at || []) {
      const q = sec(eta), s0 = q.le - e.fwd, zc = q.z - e.drop;
      if (e.kind === "fan") { if (e.pylon !== false) pylon(sk, q, s0, zc, e); fan(sk, s0, zc, e); } else propNacelle(sk, s0, zc, e, q);
    }
    if (e.aft) fan(sk, L - e.aft.s, e.aft.z * D, e);
    if (e.nose) prop(sk, e.nose.s, e.nose.z * D, e.nose.d, e.nose.blades);
  }
  for (const g of f.gear || []) gear(sk, g, D, at);
  if (f.rotor) rotor(sk, f.rotor, at);
  for (const extra of f.overlays || []) extra(kit);

  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop class="g-hi" offset="0"/><stop class="g-mid" offset=".38"/><stop class="g-lo" offset="1"/></linearGradient></defs>`;
  return { inner: defs + sk.out.join(""), box: sk.box, L };
}
export { draw as _draw, profileFor as _profile };

function svg(d) {
  const [x0, y0, x1, y1] = d.box, m = (x1 - x0) * 0.015;
  return `<svg class="sil" viewBox="${(x0 - m).toFixed(2)} ${(y0 - m).toFixed(2)} ${(x1 - x0 + 2 * m).toFixed(2)} ${(y1 - y0 + 2 * m).toFixed(2)}" aria-hidden="true">${d.inner}</svg>`;
}

// Fixed undercarriage: a leg from the airframe to a wheel, with an optional spat.
function gear(sk, g, D, at) {
  const s = at(g.s), r = g.r;
  if (g.skid) {
    const [a, b] = g.skid, z = g.z;
    sk.poly("strut", [[at(a.s), a.z * D], [at(a.s) + 0.05, z + 0.08], [at(a.s) - 0.07, z + 0.08], [at(a.s) - 0.12, a.z * D]]);
    sk.poly("strut", [[at(b.s), b.z * D], [at(b.s) - 0.05, z + 0.08], [at(b.s) + 0.07, z + 0.08], [at(b.s) + 0.12, b.z * D]]);
    sk.smooth("skid", [[at(g.aft), z, "c"], [at(g.fwd) - 0.3, z, "l"], [at(g.fwd), z + 0.12], [at(g.fwd) + 0.12, z + 0.38, "c"],
      [at(g.fwd) + 0.04, z + 0.4, "c"], [at(g.fwd) - 0.08, z + 0.18], [at(g.fwd) - 0.3, z + 0.09, "l"], [at(g.aft), z + 0.09, "c"]]);
    return;
  }
  const ws = at(g.ws ?? g.s), wz = g.wz;
  if (g.leg !== false) sk.poly("strut", [[s - 0.06, g.z * D], [s + 0.06, g.z * D], [ws + 0.05, wz], [ws - 0.05, wz]]);
  sk.ellipse("tire", ws, wz, r, r);
  if (g.pant) sk.smooth("pant", [[ws + r * 1.25, wz + r * 0.1], [ws + r * 0.2, wz + r * 1.05], [ws - r * 1.5, wz + r * 0.35], [ws - r * 1.8, wz + 0.1 * r, "c"], [ws - r * 1.2, wz - r * 0.4], [ws + r * 0.3, wz - r * 0.75]]);
  else sk.ellipse("hub", ws, wz, r * 0.4, r * 0.4);
}

// Main rotor seen from the side: mast, hub and the disc as a thin line; tail rotor disc.
function rotor(sk, r, at) {
  const s = at(r.s), z = r.z, R = r.d / 2;
  sk.poly("strut", [[s - 0.09, z - r.mast], [s + 0.09, z - r.mast], [s + 0.07, z], [s - 0.07, z]]);
  sk.smooth("hub", [[s - 0.35, z - 0.05], [s - 0.1, z + 0.12], [s + 0.12, z + 0.12], [s + 0.35, z - 0.05, "c"], [s, z - 0.18]]);
  sk.smooth("rotor", [[s + R, z - R * 0.025, "c"], [s, z + 0.06], [s - R, z - R * 0.025, "c"], [s, z - 0.02]]);
  if (r.tail) {
    const t = r.tail;
    if (t.fen) sk.ellipse("fen", at(t.s), t.z, t.d / 2 * 0.35, t.d / 2);
    else {
      sk.ellipse("disc", at(t.s), t.z, t.d / 2, t.d / 2);
      sk.poly("blade", [[at(t.s) - 0.05, t.z + t.d / 2], [at(t.s) + 0.05, t.z + t.d / 2], [at(t.s) + 0.05, t.z - t.d / 2], [at(t.s) - 0.05, t.z - t.d / 2]]);
    }
  }
  if (r.aft) {
    const a = r.aft, s2 = at(a.s);
    sk.poly("strut", [[s2 - 0.09, a.z - a.mast], [s2 + 0.09, a.z - a.mast], [s2 + 0.07, a.z], [s2 - 0.07, a.z]]);
    sk.smooth("rotor", [[s2 + R, a.z - R * 0.025, "c"], [s2, a.z + 0.06], [s2 - R, a.z - R * 0.025, "c"], [s2, a.z - 0.02]]);
  }
}

const cache = new Map();
// The drawing for an aircraft type (ICAO code), falling back to a generic family for its
// broad shape; length in metres sets the stretch.
export function silhouette(type, shape, length) {
  const key = `${type}|${shape}|${length}`;
  if (!cache.has(key)) {
    const f = profileFor(type, shape, length);
    cache.set(key, f ? svg(draw(f)) : "");
  }
  return cache.get(key);
}
// Share of the available width a given aircraft should fill, so a 777 dwarfs a Cessna
// while the Cessna stays recognisable.
export const silhouetteScale = (lengthM) => 0.3 + 0.7 * Math.sqrt(Math.min(1, Math.max(0, (lengthM - 6) / 70)));
