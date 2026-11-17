// The backdrop follows the real sky: sun height, cloud cover, night.
import { sunPosition, mix, store, angularSeparation, num } from "./util.js";

// sun elevation (deg) -> [top of sky, horizon]
const KEYS = [
  [-18, "#04060c", "#090d1a"], [-12, "#070b1c", "#1a1d3c"], [-6, "#152048", "#7a4a5c"],
  [-1, "#274a7c", "#e08a5a"], [4, "#3a6ea8", "#f0b877"], [12, "#2f6fb5", "#9cc8ea"], [90, "#1f5fae", "#8fc0e8"],
];
const COVER = { CLR: 0, SKC: 0, CAVOK: 0, FEW: 0.12, SCT: 0.3, BKN: 0.65, OVC: 0.92, OVX: 1 };

export const sky = { sun: { el: 45, az: 180 }, night: false, cover: 0, ceiling: null };

export function updateSky(state) {
  const sun = sky.sun = sunPosition(Date.now(), state.home.lat, state.home.lon);
  const w = state.weather;
  sky.cover = w ? COVER[w.cover] ?? 0 : 0;
  // the "ceiling": lowest broken or overcast layer, in feet
  const decks = ((w && w.clouds) || []).filter((c) => ["BKN", "OVC", "OVX"].includes(c.cover) && c.base != null);
  sky.ceiling = decks.length ? Math.min(...decks.map((c) => c.base)) : null;
  sky.visibility = w ? parseFloat(w.visibility) || null : null;

  let i = KEYS.findIndex((k) => sun.el < k[0]);
  if (i < 0) i = KEYS.length - 1;
  const a = KEYS[Math.max(0, i - 1)], b = KEYS[i], t = i === 0 ? 0 : (sun.el - a[0]) / (b[0] - a[0]);
  let top = mix(a[1], b[1], t), low = mix(a[2], b[2], t);
  // clouds wash the colour out toward grey, lighter by day and darker at night
  const day = Math.min(1, Math.max(0, (sun.el + 6) / 12));
  top = mix(top, mix("#0b0d12", "#66717c", day), sky.cover * 0.85);
  low = mix(low, mix("#14171d", "#a3adb6", day), sky.cover * 0.85);
  const root = document.documentElement.style;
  root.setProperty("--sky-top", top);
  root.setProperty("--sky-low", low);
  root.setProperty("--stars", String(Math.max(0, Math.min(1, (-sun.el - 6) / 8)) * (1 - sky.cover)));

  const pref = store("night") || "auto";
  sky.night = pref === "on" || (pref === "auto" && sun.el < -6);
  document.body.classList.toggle("night", sky.night);
}

// One line on whether the aircraft can actually be seen right now.
export function viewingHint(a) {
  if (a.alt == null || a.elev == null) return "";
  if (sky.visibility && sky.visibility < 3) return `Low visibility (${sky.visibility} mi) — listen for it`;
  if (sky.ceiling != null && a.alt > sky.ceiling + 300) return `Above the ${num(sky.ceiling)} ft cloud deck — probably hidden`;
  if (sky.sun.el > 2 && angularSeparation({ az: a.brg, el: a.elev }, sky.sun) < 12) return "Close to the sun — shield your eyes";
  if (sky.ceiling != null) return `Below the ${num(sky.ceiling)} ft clouds — should be visible`;
  if (sky.sun.el < -6) return sky.cover < 0.4 ? "Clear night — look for its lights" : "Night — look for its lights between clouds";
  return sky.cover < 0.15 ? "Clear sky — easy to spot" : "Scattered cloud — mostly clear view";
}
