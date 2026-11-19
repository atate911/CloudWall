// Type plates and the fleet lineup: the side elevations used as type identifiers, with their
// real length beneath them like an engineering drawing's dimension line.
import { drawing, silhouetteScale } from "./silhouette.js";
import { hasProfile } from "./profiles.js";
import { esc, num } from "./util.js";

export const feet = (m) => Math.round(m * 3.28084);

// What a drawing needs of an aircraft, or of a type or flyover from the logbook: its type code,
// its broad shape and length (the server sends these on each record, from its table of types) and
// its model names, which pick a variant that shares a type code (RV-7 or RV-7A, F-15E or F-15EX).
// A record without them, one the server hasn't looked up yet, gets a single-aisle stand-in.
export function typeInfo(a) {
  return { type: a.type, shape: a.shape || "narrow", length: a.length || 36, known: !!a.known,
    name: [a.model, a.type_name || a.name].filter(Boolean).join(" ") };
}

// A side elevation over a dimension line giving the overall length. The figure sizes itself
// inside its nearest size container (a .sil-box): `share` of its width, or as wide as its
// height allows. A type without a drawing of its own is a faint stand-in for its broad shape,
// without a length.
// Options: share (default: the flight card's size-compressed scale), dim (show the length),
// note (a short line under the length).
export function plate(info, { share = silhouetteScale(info.length), dim = true, note = "" } = {}) {
  const d = drawing(info.type, info.shape, info.length, info.name);
  if (!d.svg) return "";
  const known = info.known !== false && hasProfile(info.type), showDim = dim && known;
  const caption = showDim
    ? `<figcaption><div class="dimline"><span><b>${feet(info.length)} ft</b> ${info.length.toFixed(1)} m</span></div>${note ? `<div class="plate-note">${esc(note)}</div>` : ""}</figcaption>`
    : "";
  return `<figure class="plate${known ? "" : " standin"}${showDim ? "" : " nodim"}" style="--w:${share.toFixed(3)};--ar:${(d.w / d.h).toFixed(4)}">${d.svg}${caption}</figure>`;
}

// Lay drawings out at one scale (pixels per metre) in rows, smallest first, filling a box of
// W x H pixels. items: [{ w, h }] in metres. Each drawing takes at least minSlot pixels (room
// for its label), rows are separated by rowGap plus the label height. The scale is capped so
// that the longest drawing spans at most maxShare of the width: a lone airliner shouldn't fill
// the screen. Returns { k, rows } with rows as arrays of indexes into items.
export function lineup(items, W, H, { gap = 18, minSlot = 48, label = 30, rowGap = 10, maxShare = 0.5 } = {}) {
  if (!items.length || W <= 0 || H <= 0) return { k: 0, rows: [] };
  const longest = Math.max(...items.map((i) => i.w));
  const place = (k) => {
    const rows = [];
    let row = [], x = 0;
    items.forEach((it, i) => {
      const slot = Math.max(it.w * k, minSlot);
      if (row.length && x + gap + slot > W) { rows.push(row); row = []; x = 0; }
      x += (row.length ? gap : 0) + slot;
      row.push(i);
    });
    if (row.length) rows.push(row);
    const height = rows.reduce((s, r) => s + Math.max(...r.map((i) => items[i].h * k)) + label, 0) + rowGap * (rows.length - 1);
    return height <= H ? rows : null;
  };
  let lo = 0, hi = (W * maxShare) / longest, best = null;
  if (place(hi)) return { k: hi, rows: place(hi) };
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2, rows = mid > 0 && place(mid);
    if (rows) { lo = mid; best = rows; } else hi = mid;
  }
  return { k: lo, rows: best || [] };
}

// A round length for a scale bar about `px` pixels long at k pixels per metre.
export function scaleBar(k, px = 110) {
  const steps = [2, 5, 10, 20, 25, 50, 100];
  const m = steps.reduce((best, s) => (Math.abs(s * k - px) < Math.abs(best * k - px) ? s : best), steps[0]);
  return { m, px: m * k };
}

// Whether a type gets its own drawing (rather than a stand-in) in plates and lineups.
export const drawn = (info) => info.known !== false && hasProfile(info.type);

// The fleet lineup: every type seen today, side by side at true relative size, on ground lines.
// types: [{ info, n }] already filtered with drawn(). box: the element to fill.
export function renderLineup(box, types) {
  const items = types.map((t) => ({ ...t, ...drawing(t.info.type, t.info.shape, t.info.length, t.info.name) }))
    .filter((t) => t.svg)
    .sort((a, b) => a.info.length - b.info.length);
  const W = box.clientWidth, H = box.clientHeight - 24;   // room for the scale bar
  const { k, rows } = lineup(items, W, H);
  if (!rows.length) { box.innerHTML = ""; return; }
  const bar = scaleBar(k);
  box.innerHTML = rows.map((r) => `<div class="fleet-row">${r.map((i) => {
    const t = items[i];
    return `<figure class="fleet-item" style="width:${Math.max(t.w * k, 48).toFixed(1)}px">
      <div class="fleet-draw" style="width:${(t.w * k).toFixed(1)}px;height:${(t.h * k).toFixed(1)}px">${t.svg}</div>
      <figcaption><code>${esc(t.info.type)}</code>${t.n > 1 ? `<b>×${num(t.n)}</b>` : ""}</figcaption></figure>`;
  }).join("")}</div>`).join("") +
    `<div class="fleet-scale"><i style="width:${bar.px.toFixed(1)}px"></i><span>${bar.m} m · ${feet(bar.m)} ft</span></div>`;
}
