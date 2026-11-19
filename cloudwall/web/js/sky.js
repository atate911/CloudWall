// The sun's position, for the switch to the night chart after dusk.
import { sunPosition, store } from "./util.js";

export const sky = { sun: { el: 45, az: 180 }, night: false };

export function updateSky(state) {
  const sun = sky.sun = sunPosition(Date.now(), state.home.lat, state.home.lon);
  const pref = store("night") || "auto";
  sky.night = pref === "on" || (pref === "auto" && sun.el < -6);
  document.body.classList.toggle("night", sky.night);
}
