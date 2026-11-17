// Side-profile aircraft drawings, generated from a few proportions per shape.
// Nose points right. Drawn in a 200 x 64 box with the ground line at y = 58.

function fuselage(x0, x1, yc, h, nose, tail) {
  const t = yc - h / 2, b = yc + h / 2;
  return `M${x0},${t + h * 0.12} L${x1 - nose},${t} Q${x1 - nose * 0.25},${t} ${x1},${yc + h * 0.12} Q${x1 - nose * 0.3},${b} ${x1 - nose},${b} L${x0 + tail},${b} Z`;
}
const poly = (pts, cls = "") => `<polygon class="${cls}" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
const pod = (x, y, w, h, cls = "pod") => `<rect class="${cls}" x="${x}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}"/>`;

function jet({ h, wingX, rear = false, tTail = false, engines = 1, finH = 2.1, high = false, props = false }) {
  const x0 = 6, x1 = 194, L = x1 - x0, yc = 34, top = yc - h / 2, bot = yc + h / 2;
  let s = "";
  // fin and tailplane
  const finTop = top - h * finH;
  s += poly([[x0 + L * 0.17, top + 1], [x0 + L * 0.06, finTop], [x0 + L * 0.005, finTop], [x0 + L * 0.03, top + h * 0.2]]);
  const tpY = tTail ? finTop + 1 : yc - h * 0.15;
  s += poly([[x0 + L * 0.1, tpY], [x0 - 1, tpY - 1.2], [x0 - 1, tpY + 0.6], [x0 + L * 0.02, tpY + 1.8]], "wing");
  s += `<path d="${fuselage(x0, x1, yc, h, L * 0.1, L * 0.2)}"/>`;
  const wx = x0 + L * wingX, wy = high ? top + 1 : bot - h * 0.22;
  // engines sit below (or, for high wings, on) the wing
  for (let i = 0; i < engines && !rear; i++) {
    const ex = wx - L * 0.02 - i * L * 0.1, ey = high ? wy + h * 0.25 : bot + h * 0.32;
    s += pod(ex, ey, L * (props ? 0.1 : 0.085), h * (props ? 0.42 : 0.5));
    if (props) s += `<line class="prop" x1="${ex + L * 0.1 + 1}" y1="${ey - h * 1.05}" x2="${ex + L * 0.1 + 1}" y2="${ey + h * 1.05}"/>`;
  }
  if (rear) s += pod(x0 + L * 0.2, yc - h * 0.38, L * 0.1, h * 0.55);
  s += poly([[wx + L * 0.08, wy], [wx - L * 0.14, wy - (high ? 0.5 : 1.5)], [wx - L * 0.19, wy - (high ? 0 : 1)], [wx - L * 0.04, wy + 2]], "wing");
  // cockpit glass
  if (h >= 14) s += `<line class="windows" x1="${x0 + L * 0.2}" y1="${yc - h * 0.12}" x2="${x1 - L * 0.12}" y2="${yc - h * 0.12}"/>`;
  s += `<path class="glass" d="M${x1 - L * 0.075},${top + h * 0.2} L${x1 - L * 0.035},${top + h * 0.42} L${x1 - L * 0.085},${top + h * 0.42} Z"/>`;
  return s;
}

function piston() {
  const yc = 36, h = 13;
  return `${poly([[40, 30], [22, 14], [12, 14], [20, 31]])}
    ${poly([[36, 31], [8, 29.5], [8, 31.5], [24, 33.5]], "wing")}
    <path d="M10,${yc - 4} L96,${yc - h / 2 - 3} Q150,${yc - h / 2 - 3} 168,${yc - 2} L182,${yc - 1} L182,${yc + 5} L150,${yc + h / 2} L92,${yc + h / 2} Z"/>
    <path class="glass" d="M104,${yc - 9} L132,${yc - 9} L142,${yc - 2} L100,${yc - 2} Z"/>
    ${poly([[92, 23.5], [150, 23.5], [150, 27], [92, 27.5]], "wing")}
    <line class="strut" x1="128" y1="27" x2="118" y2="${yc + 5}"/>
    <line class="strut" x1="120" y1="${yc + 6}" x2="112" y2="55"/><circle cx="112" cy="55" r="3.2"/>
    <line class="strut" x1="165" y1="${yc + 4}" x2="168" y2="55"/><circle cx="168" cy="55" r="3"/>
    <line class="prop" x1="184" y1="14" x2="184" y2="56"/>`;
}

function heli() {
  return `<path d="M96,22 Q150,20 168,36 Q172,48 150,50 L104,50 Q88,46 90,34 Z"/>
    <path class="glass" d="M134,26 Q156,28 164,38 L138,38 Z"/>
    <path d="M94,30 L22,26 L22,31 L92,40 Z"/>
    ${poly([[30, 27], [16, 10], [10, 10], [20, 30]])}
    <circle class="prop-disc" cx="16" cy="18" r="9"/>
    <rect x="124" y="13" width="5" height="9"/>
    <line class="prop" x1="34" y1="12" x2="196" y2="12"/>
    <line class="strut" x1="108" y1="50" x2="104" y2="57"/><line class="strut" x1="150" y1="50" x2="154" y2="57"/>
    <line class="strut" x1="92" y1="57" x2="166" y2="57"/>`;
}

const SHAPES = {
  narrow: () => jet({ h: 17, wingX: 0.52, finH: 1.45 }),
  wide: () => jet({ h: 20, wingX: 0.52, finH: 1.2 }),
  quad: () => jet({ h: 21, wingX: 0.55, engines: 2, finH: 1.1 }),
  regional: () => jet({ h: 14, wingX: 0.46, rear: true, tTail: true, finH: 1.6 }),
  bizjet: () => jet({ h: 17, wingX: 0.45, rear: true, tTail: true, finH: 1.3 }),
  turboprop: () => jet({ h: 16, wingX: 0.56, high: true, props: true, tTail: true, finH: 1.45 }),
  piston, heli,
};

export function silhouette(shape) {
  return `<svg class="sil" viewBox="0 0 200 64" aria-hidden="true">${(SHAPES[shape] || SHAPES.narrow)()}</svg>`;
}
// Share of the available width a given aircraft should fill, so a 777 dwarfs a Cessna
// while the Cessna stays recognisable.
export const silhouetteScale = (lengthM) => 0.3 + 0.7 * Math.sqrt(Math.min(1, Math.max(0, (lengthM - 6) / 70)));
