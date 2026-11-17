// Sun position and cloud cover, for the viewing hints, the sun on the sky dome and the
// switch to the night chart after dusk.
import { sunPosition, store, angularSeparation, num } from "./util.js";

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
