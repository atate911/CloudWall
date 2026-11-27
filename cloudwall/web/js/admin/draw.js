// The board's instruments, drawn in SVG from the numbers they show: a dial for a rate, a meter for
// signal against noise, the receiver's reach as a polar plot, the paid allowance as a fuel gauge
// with its reserve, the disk as one bar of what fills it, problems along a week, and the live scope.
// Colours come from the page's own tokens (currentColor and CSS classes), so both themes hold.
import { esc, num, bytes } from "./core.js";

const RAD = Math.PI / 180;
const polarXY = (cx, cy, r, deg) => [cx + r * Math.sin(deg * RAD), cy - r * Math.cos(deg * RAD)];

/** Distance (nm) and bearing (degrees) from a to b. */
export function distBrg(a, b) {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, dλ = (b.lon - a.lon) * RAD;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2)) * 3440.065;
  const y = Math.sin(dλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return [d, (Math.atan2(y, x) / RAD + 360) % 360];
}

function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polarXY(cx, cy, r, a0), [x1, y1] = polarXY(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** A dial: 240 degrees of sweep, coloured zones under the needle's arc, the value large in the middle. */
export function gauge({ value, min = 0, max, unit = "", label = "", zones = [], fmt = (v) => num(v), ticks = 5 }) {
  const A0 = -120, A1 = 120, at = (v) => A0 + (Math.min(max, Math.max(min, v)) - min) / (max - min) * (A1 - A0);
  const known = value != null && !Number.isNaN(+value);
  const zs = zones.map(([a, b, cls]) => `<path class="g-zone ${cls}" d="${arc(60, 60, 47, at(a), at(b))}"/>`).join("");
  const tk = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = min + (max - min) * i / ticks, a = at(v), [x0, y0] = polarXY(60, 60, 41, a), [x1, y1] = polarXY(60, 60, 37, a);
    return `<path class="g-tick" d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}"/>`;
  }).join("");
  const needle = known ? (() => { const a = at(+value), [x, y] = polarXY(60, 60, 47, a); return `<path class="g-val" d="${arc(60, 60, 47, A0, a)}"/><circle class="g-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`; })() : "";
  return `<svg class="gauge" viewBox="0 0 120 104" role="img" aria-label="${esc(label)}: ${known ? esc(fmt(+value)) : "no reading"} ${esc(unit)}">
    <path class="g-track" d="${arc(60, 60, 47, A0, A1)}"/>${zs}${tk}${needle}
    <text class="g-num" x="60" y="64" text-anchor="middle">${known ? esc(fmt(+value)) : "–"}</text>
    <text class="g-unit" x="60" y="77" text-anchor="middle">${esc(unit)}</text>
    <text class="g-end" x="22" y="101" text-anchor="middle">${esc(fmt(min))}</text><text class="g-end" x="98" y="101" text-anchor="middle">${esc(fmt(max))}</text>
  </svg>`;
}

/** Signal against noise, in dBFS on one upright scale: the noise floor as a band, the average signal
 *  as a bar, the loudest as a tick at the top. (0 dBFS is the receiver's limit: everything is below it.) */
export function signalMeter({ signal, noise, peak }) {
  const lo = -45, hi = 0, H = 150, y = (v) => 8 + (hi - Math.min(hi, Math.max(lo, v))) / (hi - lo) * H;
  const marks = [0, -10, -20, -30, -40].map((v) => `<text class="sm-mark" x="30" y="${y(v) + 3.5}" text-anchor="end">${v}</text><path class="sm-tick" d="M34 ${y(v)}h6"/>`).join("");
  const has = (v) => v != null && !Number.isNaN(+v);
  return `<svg class="signal" viewBox="0 0 150 168" role="img" aria-label="Signal ${has(signal) ? signal.toFixed(1) : "unknown"} dBFS, noise ${has(noise) ? noise.toFixed(1) : "unknown"} dBFS">
    ${marks}<rect class="sm-track" x="44" y="8" width="26" height="${H}" rx="5"/>
    ${has(noise) ? `<rect class="sm-noise" x="44" y="${y(noise)}" width="26" height="${8 + H - y(noise)}" rx="5"/>` : ""}
    ${has(signal) ? `<rect class="sm-signal" x="50" y="${y(signal)}" width="14" height="${8 + H - y(signal)}" rx="3"/>` : ""}
    ${has(peak) ? `<path class="sm-peak" d="M40 ${y(peak)}h34"/><text class="sm-lab" x="80" y="${y(peak) + 4}">loudest ${peak.toFixed(1)}</text>` : ""}
    ${has(signal) ? `<text class="sm-lab strong" x="80" y="${Math.min(y(signal) + 4, 140)}">signal ${signal.toFixed(1)}</text>` : ""}
    ${has(noise) ? `<text class="sm-lab" x="80" y="${Math.min(y(noise) + 14, 162)}">noise ${noise.toFixed(1)}</text>` : ""}
  </svg>`;
}

/** The receiver's reach: the outline of its farthest positions over a day, as a shape around the
 *  house, with rings every 50 nm and the board's tracking radius drawn small in the middle. */
export function polar({ outline = [], at, radiusNm, maxNow, size = 360 }) {
  const c = size / 2, R = c - 22;
  const pts = at ? outline.map((p) => distBrg(at, { lat: p[0], lon: p[1] })) : [];
  const far = Math.max(50, maxNow || 0, ...pts.map((p) => p[0]));
  const scaleNm = Math.ceil(far / 50) * 50, k = R / scaleNm;
  const rings = [];
  for (let n = 50; n <= scaleNm; n += 50) rings.push(n);
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => { const [x, y] = polarXY(c, c, R, d); return `<path class="p-spoke" d="M${c} ${c}L${x.toFixed(1)} ${y.toFixed(1)}"/>`; }).join("");
  const shape = pts.length > 2 ? `<path class="p-reach" d="${pts.sort((a, b) => a[1] - b[1]).map(([d, b], i) => { const [x, y] = polarXY(c, c, d * k, b); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join("")}Z"/>` : "";
  // each ring's distance written where it crosses the south-east spoke, clear of the north
  const ringEls = rings.map((n) => { const [x, y] = polarXY(c, c, n * k, 135); return `<circle class="p-ring" cx="${c}" cy="${c}" r="${(n * k).toFixed(1)}"/><text class="p-ring-lab" x="${(x + 3).toFixed(1)}" y="${(y + 11).toFixed(1)}">${n}</text>`; }).join("") +
    (rings.length ? (() => { const n = rings[rings.length - 1], [x, y] = polarXY(c, c, n * k, 135); return `<text class="p-ring-lab" x="${(x + 3).toFixed(1)}" y="${(y + 23).toFixed(1)}">nm</text>`; })() : "");
  const card = [["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([t, d]) => { const [x, y] = polarXY(c, c, R + 12, d); return `<text class="p-card" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${t}</text>`; }).join("");
  const track = radiusNm ? `<circle class="p-track" cx="${c}" cy="${c}" r="${Math.max(3, radiusNm * k).toFixed(1)}"/>` : "";
  const now = maxNow ? `<circle class="p-now" cx="${c}" cy="${c}" r="${(maxNow * k).toFixed(1)}"/>` : "";
  return `<svg class="polar" viewBox="0 0 ${size} ${size}" role="img" aria-label="How far the receiver hears: ${pts.length ? Math.round(Math.max(...pts.map((p) => p[0]))) + " nm at the farthest today" : "no outline yet"}">
    ${spokes}${ringEls}${shape}${now}${track}<circle class="p-home" cx="${c}" cy="${c}" r="3.5"/>${card}</svg>`;
}

/** The paid allowance as a fuel gauge: what's been used, what's left to use, the reserve never
 *  touched, where today's even share ends, and where this rate of use would leave the month.
 *  Drawn 1000 wide, about the size it's shown, so its words are the page's size. */
export function fuel({ budget, used, monthly, today, todayCap, starts, resets }) {
  if (!monthly) return "";
  const W = 1000, top = 26, h = 34, x = (v) => 4 + Math.min(1, Math.max(0, v / monthly)) * (W - 8);
  const reserveAt = x(budget);
  const days = starts && resets ? Math.max(1, Math.round((Date.parse(resets) - Date.parse(starts)) / 864e5)) : 30;
  const gone = starts ? Math.max(1, (Date.now() - Date.parse(starts)) / 864e5) : 1;
  const projected = used / gone * days, over = projected > budget;
  return `<svg class="fuel" viewBox="0 0 ${W} ${top + h + 26}" role="img" aria-label="${num(used)} of ${num(budget)} used this period; ${num(monthly - budget)} held back; at this pace, ${num(projected)} by the end">
    <defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v7" class="f-hatch"/></pattern></defs>
    <rect class="f-tank" x="4" y="${top}" width="${W - 8}" height="${h}" rx="9"/>
    <rect class="f-reserve" x="${reserveAt}" y="${top}" width="${W - 4 - reserveAt}" height="${h}" fill="url(#hatch)"/>
    <rect class="f-used" x="4" y="${top}" width="${Math.max(0, x(used) - 4)}" height="${h}" rx="9"/>
    ${todayCap != null ? `<rect class="f-today" x="${x(used - today)}" y="${top}" width="${Math.max(2, x(used - today + todayCap) - x(used - today))}" height="${h}"/>` : ""}
    <path class="f-line" d="M${reserveAt} ${top - 6}v${h + 12}"/>
    <text class="f-lab" x="${reserveAt - 8}" y="${top - 9}" text-anchor="end">reserve held back from ${num(budget)}</text>
    ${projected > 0 ? `<path class="f-proj ${over ? "over" : ""}" d="M${x(Math.min(projected, monthly))} ${top - 4}v${h + 8}"/>
      <text class="f-lab ${over ? "over" : "proj"}" x="${x(Math.min(projected, monthly))}" y="${top + h + 20}" text-anchor="${x(projected) > W - 160 ? "end" : "middle"}">this pace: ${num(projected)} by renewal</text>` : ""}
    <text class="f-lab" x="4" y="${top + h + 20}">0</text>
    <text class="f-lab" x="${W - 4}" y="${top - 9}" text-anchor="end">${num(monthly)}</text>
  </svg>`;
}

/** Each day's use, as bars against today's even share. */
export function burn(days = [], share) {
  if (!days.length) return "";
  const W = 1000, H = 120, base = H - 20, max = Math.max(1, share || 0, ...days.map((d) => d[1])) * 1.08, n = Math.max(days.length, 14), bw = (W - 8) / n;
  const y = (v) => base - v / max * (base - 6);
  const bars = days.map(([d, v], i) => `<rect class="b-bar ${i === days.length - 1 ? "today" : ""}" x="${4 + i * bw + 2}" y="${y(v)}" width="${Math.max(3, bw - 4)}" height="${Math.max(v ? 2 : 0, base - y(v))}" rx="3"><title>${d}: ${num(v)}</title></rect>`).join("");
  const line = share ? `<path class="b-share" d="M4 ${y(share)}H${W - 4}"/><text class="b-lab" x="4" y="${y(share) - 6}">today's share, ${num(share)}</text>` : "";
  const date = (iso) => new Date(iso + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" });
  return `<svg class="burn" viewBox="0 0 ${W} ${H}" role="img" aria-label="Use each day this period">${bars}${line}
    <text class="b-lab" x="4" y="${H - 3}">${date(days[0][0])}</text><text class="b-lab" x="${4 + (days.length - 0.5) * bw}" y="${H - 3}" text-anchor="${days.length > n - 2 ? "end" : "middle"}">today</text></svg>`;
}

/** The disk as one bar: each part's share, then what's free. parts: [{label, bytes, cls}] */
export function diskBar(parts, total) {
  const known = parts.filter((p) => p.bytes > 0);
  return `<div class="disk" role="img" aria-label="${known.map((p) => `${p.label} ${bytes(p.bytes)}`).join(", ")}">
    <div class="disk-bar">${known.map((p) => `<span class="disk-seg ${p.cls}" style="flex-grow:${p.bytes}" title="${esc(p.label)}: ${bytes(p.bytes)}"></span>`).join("")}</div>
    <ul class="disk-key">${known.map((p) => `<li class="${p.cls}"><i></i><b>${bytes(p.bytes)}</b> ${esc(p.label)}</li>`).join("")}</ul>
  </div>`;
}

/** Problems over the last week: one lane per part, a bar from each problem's start to its end. */
export function timeline(incidents = [], days = 7) {
  const now = Date.now() / 1000, t0 = now - days * 86400, W = 760, L = 120;
  const parts = [...new Set(incidents.filter((i) => (i.ended || now) > t0).map((i) => (i.part || "other").replace(/^running: /, "")))].slice(0, 8);
  const H = 30 + Math.max(1, parts.length) * 28;
  const x = (t) => L + (Math.max(t0, t) - t0) / (now - t0) * (W - L - 8);
  const grid = Array.from({ length: days + 1 }, (_, i) => {
    const t = t0 + i * 86400, xx = x(t);
    return `<path class="t-grid" d="M${xx} 4V${H - 22}"/>${i < days ? `<text class="t-lab" x="${xx + 4}" y="${H - 4}">${new Date(t * 1000).toLocaleDateString([], { weekday: "short" })}</text>` : ""}`;
  }).join("");
  const lanes = parts.map((p, li) => {
    const y = 8 + li * 28;
    const bars = incidents.filter((i) => (i.part || "other").replace(/^running: /, "") === p && (i.ended || now) > t0).map((i) => {
      const x0 = x(i.started), x1 = Math.max(x0 + 6, x(i.ended || now));
      return `<rect class="t-bar ${i.ended ? "" : "open"} ${i.major ? "major" : ""} ${i.state}" x="${x0}" y="${y}" width="${x1 - x0}" height="18" rx="6"><title>${esc(i.summary)}</title></rect>`;
    }).join("");
    return `<text class="t-part" x="${L - 10}" y="${y + 14}" text-anchor="end">${esc(p)}</text>${bars}`;
  }).join("");
  return `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Problems over the last ${days} days">${grid}${lanes || `<text class="t-none" x="${(W + L) / 2}" y="${H / 2}" text-anchor="middle">Nothing in the last ${days} days</text>`}<path class="t-now" d="M${W - 8} 2V${H - 22}"/></svg>`;
}

// -- the live scope ------------------------------------------------------------------------------------
/** The board's own picture of the sky around the house on a small radar, with a slow sweep (still,
 *  for anyone who asks for less motion): aircraft within the tracking radius, the one overhead in
 *  magenta as on the wall, the airport as a square. `get()` returns the latest /api/state. */
export function scope(canvas, get) {
  const ctx = canvas.getContext("2d"), t0 = performance.now();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = null;
  const draw = (now) => {
    if (!canvas.isConnected) return;
    const dpr = devicePixelRatio || 1, size = canvas.clientWidth || 200;
    if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2, R = c - 4, css = getComputedStyle(canvas);
    const phos = css.getPropertyValue("--phosphor").trim() || "#7fe0a0", mag = css.getPropertyValue("--overhead-lit").trim() || "#ff86d3";
    ctx.clearRect(0, 0, size, size);
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.clip();
    ctx.fillStyle = css.getPropertyValue("--scope-face").trim() || "#07150f"; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = phos; ctx.lineWidth = 1;
    for (const k of [1 / 3, 2 / 3, 1]) { ctx.globalAlpha = .2; ctx.beginPath(); ctx.arc(c, c, R * k - .5, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = .1; ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.stroke();
    const st = get();
    const sweep = still ? null : ((now - t0) / 4200 * 2 * Math.PI) % (2 * Math.PI);
    if (sweep !== null && ctx.createConicGradient) {
      const g = ctx.createConicGradient(sweep - Math.PI / 2 - 1.1, c, c);
      g.addColorStop(0, "transparent"); g.addColorStop(0.175, phos); g.addColorStop(0.1751, "transparent");
      ctx.globalAlpha = .18; ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    }
    if (st?.home && st.tracking) {
      const radius = st.tracking.radius_nm, k = R / radius, ap = st.airport;
      if (ap?.lat != null) {
        const [d, b] = distBrg(st.home, ap);
        if (d < radius) { const [x, y] = polarXY(c, c, d * k, b); ctx.globalAlpha = .65; ctx.strokeStyle = phos; ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }
      }
      ctx.globalAlpha = .35; ctx.setLineDash([2, 3]); ctx.strokeStyle = mag; ctx.beginPath(); ctx.arc(c, c, st.tracking.overhead_nm * k, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      for (const a of st.aircraft || []) {
        if (a.on_ground || a.dist > radius) continue;
        const [x, y] = polarXY(c, c, a.dist * k, a.brg);
        const hero = st.hero && a.hex === st.hero.hex;
        let glow = 1;
        if (sweep !== null) { const behind = ((sweep - a.brg * RAD) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); glow = .5 + .5 * Math.max(0, 1 - behind / 4); }
        ctx.globalAlpha = glow; ctx.fillStyle = ctx.strokeStyle = hero ? mag : phos; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(x, y, hero ? 3.6 : 2.4, 0, 7); ctx.fill();
        if (a.track != null) { const [tx, ty] = polarXY(x, y, hero ? 11 : 8, a.track); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke(); }
        if (hero) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = phos; ctx.beginPath(); ctx.arc(c, c, 2, 0, 7); ctx.fill();
    ctx.restore();
    frame = still ? null : requestAnimationFrame(draw);
  };
  if (still) { draw(performance.now()); const t = setInterval(() => { if (!canvas.isConnected) clearInterval(t); else draw(performance.now()); }, 5000); }
  else frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}
