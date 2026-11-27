// The house: where the sky is watched from. Its distances are set on the map where they reach (drag
// a ring), its position by clicking where it is (or taking the receiver's), and the airport is read
// out by name. The values set once and seldom touched again (the ground's height, the ceiling for
// "overhead", a ZIP code instead of coordinates) wait under a shade. Other places watched follow.
import { el, esc, S, sky, value, save, call, toast, num, plural, house, loadOverview } from "../core.js";
import { icon } from "../icons.js";
import { houseMap } from "../map.js";
import { distBrg } from "../draw.js";
import { head, pageTroubles } from "../parts.js";
import { stepper, text, shade, group } from "../controls.js";

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const coord = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;

async function moveHouse(lat, lon) {
  await save("home", "lat", lat);
  await save("home", "lon", lon);
  toast("The house's new position is saved: CloudWall uses it once it restarts.");
}

function placesList() {
  const box = el(`<div class="places"></div>`);
  const paint = () => {
    const list = S.overview.places || [];
    box.innerHTML = `<ul class="place-list">${list.map((p, i) => `<li>
        <span class="place-ico">${icon(i ? "places" : "home")}</span>
        <span class="place-who"><b>${esc(p.name)}</b><span>${esc(p.airport || "")}${p.status?.ok ? `, ${plural(p.aircraft, "aircraft")} now` : ""}, ${plural(p.today || 0, "flyover")} today</span></span>
        ${p.added ? `<button class="btn small quiet" data-rm="${esc(p.id)}">Remove</button>` : `<span class="dim small">${i ? "in the settings file" : "the house"}</span>`}</li>`).join("")}</ul>
      <form class="place-add"><label>Watch another place <span class="dim">a cabin, a parent's house: its own logbook and screens</span>
        <span class="place-add-row"><input name="q" placeholder="A US ZIP code, or latitude, longitude" required><input name="name" placeholder="Its name"><button class="btn small">Add it</button></span></label>
        <p class="place-found dim small" hidden></p></form>`;
    const form = box.querySelector("form"), found = box.querySelector(".place-found");
    form.q.oninput = async () => {
      clearTimeout(form.timer);
      form.timer = setTimeout(async () => {
        const q = form.q.value.trim();
        if (q.length < 5) { found.hidden = true; return; }
        try {
          const r = await fetch(`api/locate?q=${encodeURIComponent(q)}`);
          const got = await r.json();
          found.hidden = false;
          found.textContent = r.ok ? `${got.name || coord(got.lat, got.lon)}${got.auto ? `; its airport: ${got.auto.icao || got.auto}` : ""}` : got.error;
        } catch { found.hidden = true; }
      }, 400);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch("api/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: form.q.value, name: form.name.value }) });
      const got = await r.json();
      if (!r.ok) return toast(got.error, true);
      toast(`Watching ${got.place.name} now`); await loadOverview(); paint();
    };
    box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
      if (!confirm("Stop watching this place? Its logbook stays on disk.")) return;
      const r = await fetch(`api/places?id=${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" });
      if (!r.ok) return toast((await r.json()).error, true);
      toast("Place removed"); await loadOverview(); paint();
    });
  };
  paint();
  return box;
}

export default {
  id: "places", title: "The house", icon: "places",
  live() {
    const r = value("tracking", "radius_nm"), ap = S.sky?.airport?.icao || house()?.airport;
    return r ? `${num(r, 1)} nm around${ap ? `, near ${ap}` : ""}` : "";
  },
  async draw(page) {
    const st = S.sky || await sky();
    const home = st?.home || { lat: value("home", "lat"), lon: value("home", "lon") };
    const ap = st?.airport;
    page.append(head("The house", "Where the sky is watched from: how far out the wall looks, and what counts as overhead."));
    const t = pageTroubles("places");
    if (t) page.append(t);

    const hero = el(`<section class="house-hero">
      <div class="house-map"></div>
      <aside class="house-side">
        <div class="fact-block"><span class="fact-label">Position</span><b class="fact-big">${home?.lat != null ? coord(home.lat, home.lon) : "Not set"}</b>
          <div class="fact-acts"><button class="btn small quiet" data-move>${icon("pin")} Move it on the map</button><button class="btn small quiet" data-rx>${icon("receiver")} Use the receiver's</button></div>
          <p class="pick-ask" hidden></p></div>
        <div class="fact-block"><span class="fact-label">Airport</span><b class="fact-big">${esc(ap?.icao || value("airport", "icao") || "auto")}</b>
          <span class="fact-sub">${esc(ap?.name || "")}${ap?.lat != null && home?.lat != null ? `, ${num(distBrg(home, ap)[0], 1)} nm away` : ""}${value("airport", "icao") === "auto" ? " (the nearest, chosen by itself)" : ""}</span></div>
        <div class="rings-set"></div>
      </aside></section>`);
    page.append(hero);

    const radius = value("tracking", "radius_nm"), overhead = value("tracking", "overhead_nm");
    const syncStepper = (key, nm) => { const i = page.querySelector(`[data-setting="tracking.${key}"] input`); if (i) { i.value = String(nm); i.size = Math.max(2, i.value.length); } };
    const map = houseMap({
      lat: home.lat, lon: home.lon, layer: dark() ? "dark" : "light", airport: ap,
      fit: Math.max(radius * 2.35, 6),
      rings: [
        { id: "track", nm: radius, cls: "track", label: "Tracking", min: 3, max: 60, step: 0.5, handleAt: 128, onDrag: (nm) => syncStepper("radius_nm", nm), onDrop: (nm) => page.querySelector('[data-setting="tracking.radius_nm"]').commit(nm) },
        { id: "over", nm: overhead, cls: "over", label: "Overhead", min: 0.5, max: 15, step: 0.5, handleAt: 52, onDrag: (nm) => syncStepper("overhead_nm", nm), onDrop: (nm) => page.querySelector('[data-setting="tracking.overhead_nm"]').commit(nm) },
      ],
      onPick: (lat, lon) => {
        const askEl = hero.querySelector(".pick-ask");
        askEl.hidden = false;
        askEl.innerHTML = `Move the house to <b>${coord(lat, lon)}</b>, ${num(distBrg(home, { lat, lon })[0], 1)} nm from where it is? <button class="btn small" data-yes>Move it</button> <button class="btn small quiet" data-no>Cancel</button>`;
        askEl.querySelector("[data-yes]").onclick = async () => { askEl.hidden = true; try { await moveHouse(lat, lon); } catch (e) { toast(e.message, true); } };
        askEl.querySelector("[data-no]").onclick = () => { askEl.hidden = true; };
      },
    });
    hero.querySelector(".house-map").append(map);
    const legend = el(`<div class="map-legend"><span class="lg track">Tracking radius: what the wall, the flight card and the logbook look at</span><span class="lg over">Overhead: closer than this takes over the screen and is logged</span><span class="dim">Drag a ring's handle to change it</span></div>`);
    hero.querySelector(".house-map").append(legend);

    hero.querySelector("[data-move]").onclick = () => { map.pick(true); toast("Click where the house is on the map"); };
    hero.querySelector("[data-rx]").onclick = async () => {
      try {
        const r = S.receiver?.receiver?.lat != null ? S.receiver : await call("receiver");
        S.receiver = r;
        if (r.receiver?.lat == null) return toast("The receiver doesn't say where it is (or isn't connected)", true);
        const lat = +r.receiver.lat.toFixed(4), lon = +r.receiver.lon.toFixed(4);
        if (!confirm(`Use the receiver's position, ${coord(lat, lon)} (${num(distBrg(home, { lat, lon })[0], 2)} nm from the house's now)?`)) return;
        await moveHouse(lat, lon);
      } catch (e) { if (e.message !== "signed out") toast(e.message, true); }
    };

    const rings = hero.querySelector(".rings-set");
    rings.append(
      stepper("tracking", "radius_nm", { label: "Tracking radius", step: 0.5, min: 3, max: 60, presets: [[10], [15], [20], [30]], cls: "ring-track", preview: (v) => map.setRing("track", v), says: (v) => `The wall shows and logs aircraft within ${num(v, 1)} nm.` }),
      stepper("tracking", "overhead_nm", { label: "Overhead within", step: 0.5, min: 0.5, max: 15, cls: "ring-over", preview: (v) => map.setRing("over", v), says: (v) => `Closer than ${num(v, 1)} nm and below ${num(value("tracking", "max_overhead_alt_ft"))} ft counts as overhead.` }),
    );

    const traffic = () => map.aircraft((S.sky?.aircraft || []).map((a) => ({ ...a, hero: S.sky.hero && a.hex === S.sky.hero.hex })));
    traffic();
    const timer = setInterval(async () => { if (!map.isConnected) return clearInterval(timer); if (!document.hidden) { await sky(); traffic(); } }, 5000);

    page.append(shade("Set once", () => [
      `called “${value("home", "name") || "Home"}”`,
      `airport ${value("airport", "icao")}`,
      value("home", "elevation_ft") ? `ground at ${num(value("home", "elevation_ft"))} ft` : "ground height from the airport",
      `overhead below ${num(value("tracking", "max_overhead_alt_ft"))} ft`,
    ].join("; "), [
      text("home", "name", { label: "Its name" }),
      text("airport", "icao", { label: "The airport", format: (v) => v === "auto" ? "auto: the nearest" : v, help: "Its ICAO code (KPDX), or auto for the nearest large airport within 30 nm. Arrivals, departures, runways in use and the weather come from it." }),
      stepper("home", "elevation_ft", { label: "Ground height", step: 10, min: -1500, max: 15000, says: (v) => v ? `Aircraft heights above the house are worked out from ${num(v)} ft.` : "Left out: the airport's height is used." }),
      stepper("tracking", "max_overhead_alt_ft", { label: "Overhead below", step: 1000, min: 1000, max: 60000, presets: [[18000, "18,000"], [45000, "45,000"]], says: (v) => `Higher than ${num(v)} ft, an aircraft passing over isn't counted.` }),
      text("home", "zip", { label: "ZIP code instead", help: "Only used when latitude and longitude are left out: the centre of the ZIP code's area." }),
    ]));

    page.append(group("Other places", "Each place watched keeps its own logbook, and any screen can switch to it.", [placesList()]));
  },
};
