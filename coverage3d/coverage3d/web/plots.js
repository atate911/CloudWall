// 2D companion plots drawn on <canvas> (no chart library needed).
import { radioHorizonNm, UNIT_NM, GROUND_COLOR, rgbCss } from "./util.js";

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight || +canvas.getAttribute("height");
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.body);
  return { g, w, h, fg: css.color, muted: css.getPropertyValue("--muted").trim() || "#888", line: css.getPropertyValue("--line").trim() || "#ccc" };
}
const nice = (v, step) => Math.ceil(v / step) * step;

/** Distance (x) against altitude (y): density of every recorded point, with the theoretical horizon curve. */
export function drawVertical(canvas, data, unit) {
  const { g, w, h, fg, muted, line } = setup(canvas);
  g.clearRect(0, 0, w, h);
  const L = 44, R = 8, T = 8, B = 28, pw = w - L - R, ph = h - T - B;
  const cells = data?.cells || [];
  const dStep = data?.dist_nm || 2, aStep = data?.alt_ft || 500;
  const maxD = Math.max(100, nice(Math.max(0, ...cells.map((c) => (c[0] + 1) * dStep)), 50)), maxA = 50000;
  const X = (nm) => L + (nm / maxD) * pw, Y = (ft) => T + ph - (ft / maxA) * ph;
  g.font = "11px system-ui"; g.fillStyle = muted; g.strokeStyle = line; g.lineWidth = 1;
  for (let ft = 0; ft <= maxA; ft += 10000) { g.beginPath(); g.moveTo(L, Y(ft)); g.lineTo(L + pw, Y(ft)); g.stroke(); g.textAlign = "right"; g.fillText((ft / 1000) + "k", L - 4, Y(ft) + 4); }
  const tick = maxD > 200 ? 100 : 50;
  for (let d = 0; d <= maxD; d += tick) { g.textAlign = "center"; g.fillText(Math.round(d * UNIT_NM[unit]), X(d), h - 12); }
  g.textAlign = "center"; g.fillText(`distance (${unit})`, L + pw / 2, h - 1);
  g.save(); g.translate(10, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText("altitude (ft)", 0, 0); g.restore();
  const maxN = Math.max(1, ...cells.map((c) => c[2])), lg = Math.log(1 + maxN);
  const cw = Math.max(1, (dStep / maxD) * pw), ch = Math.max(1, (aStep / maxA) * ph);
  for (const [db, ab, n] of cells) {
    const t = Math.log(1 + n) / lg;
    const c = ab < 0 ? GROUND_COLOR : [30 + 225 * t, 60 + 150 * t, 140 - 100 * t];
    g.fillStyle = rgbCss(c, 0.25 + 0.75 * t);
    g.fillRect(X(db * dStep), ab < 0 ? Y(0) - ch : Y((ab + 1) * aStep), cw + 0.5, ch + 0.5);
  }
  // theoretical radio-horizon: how far a line-of-sight signal could reach at each altitude
  const ant = data?.antenna_ft ?? 88;
  g.strokeStyle = fg; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath();
  for (let ft = 0; ft <= maxA; ft += 250) { const d = radioHorizonNm(ant, ft); (ft ? g.lineTo : g.moveTo).call(g, X(Math.min(d, maxD)), Y(ft)); }
  g.stroke(); g.setLineDash([]);
  g.fillStyle = fg; g.textAlign = "left"; g.fillText("- - radio horizon", L + 6, T + 12);
}

/** Range by bearing for one altitude band (or the best over all bands). Optional compare series B (dashed). */
export function drawPolar(canvas, covA, covB, bandIndex, unit, color) {
  const { g, w, h, fg, muted, line } = setup(canvas);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2 - 22;
  const series = (cov) => {
    if (!cov) return null;
    const out = new Array(cov.n_sectors).fill(0);
    for (const b of cov.bands) if (bandIndex === "all" || String(b.index) === String(bandIndex)) for (const s of b.sectors) out[s.s] = Math.max(out[s.s], s.dist_nm);
    return out;
  };
  const A = series(covA), B = series(covB);
  const maxD = Math.max(50, nice(Math.max(0, ...(A || []), ...(B || [])), 50));
  g.font = "11px system-ui"; g.strokeStyle = line; g.fillStyle = muted; g.lineWidth = 1; g.textAlign = "center";
  for (let r = 50; r <= maxD; r += maxD > 250 ? 100 : 50) { g.beginPath(); g.arc(cx, cy, (r / maxD) * rad, 0, 6.2832); g.stroke(); g.fillText(Math.round(r * UNIT_NM[unit]), cx + Math.sin(0.26) * (r / maxD) * rad + 8, cy - Math.cos(0.26) * (r / maxD) * rad - 2); }
  for (let b = 0; b < 360; b += 30) {
    const a = (b * Math.PI) / 180;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * rad, cy - Math.cos(a) * rad); g.stroke();
    g.fillText(b % 90 === 0 ? "NESW"[b / 90] : String(b).padStart(3, "0"), cx + Math.sin(a) * (rad + 12), cy - Math.cos(a) * (rad + 12) + 4);
  }
  const path = (s, n) => { g.beginPath(); s.forEach((d, i) => { const a = (((i + 0.5) * 360) / n) * Math.PI / 180, r = (d / maxD) * rad; (i ? g.lineTo : g.moveTo).call(g, cx + Math.sin(a) * r, cy - Math.cos(a) * r); }); g.closePath(); };
  if (A) { path(A, A.length); g.fillStyle = rgbCss(color, 0.3); g.fill(); g.strokeStyle = rgbCss(color, 1); g.lineWidth = 2; g.stroke(); }
  if (B) { path(B, B.length); g.setLineDash([5, 4]); g.strokeStyle = rgbCss(color, 1); g.lineWidth = 2; g.stroke(); g.setLineDash([]); }
}
