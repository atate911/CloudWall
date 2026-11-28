// Location page: the house on a map (drag a ring to set a distance, click to set its position),
// its airport, the rarely-touched values under a shade, and the other places watched.
import { el, esc, S, sky, value, save, call, toast, num, plural, loadOverview, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { houseMap } from "../map.js";
import { distBrg } from "../draw.js";
import { head, pageTroubles } from "../parts.js";
import { stepper, text, group, line, advanced } from "../controls.js";

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
      <form class="place-add"><label>Add a place
        <span class="place-add-row"><input name="q" placeholder="A US ZIP code, or latitude, longitude" required><input name="name" placeholder="Name"><button class="btn small">Add it</button></span></label>
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
  id: "places", get title() { return TITLES.places; }, icon: "places",
  async draw(page) {
    const st = S.sky || await sky();
    const home = st?.home || { lat: value("home", "lat"), lon: value("home", "lon") };
    const ap = st?.airport;
    page.append(head(TITLES.places, "The house's position, its airport, the tracking range, and other places watched."));
    const t = pageTroubles("places");
    if (t) page.append(t);

    // the map: the house, the airport, the traffic, and the two rings, dragged to change
    const radius = value("tracking", "radius_nm"), overhead = value("tracking", "overhead_nm");
    const syncStepper = (key, nm) => { const i = page.querySelector(`[data-setting="tracking.${key}"] input`); if (i) { i.value = String(nm); i.size = Math.max(2, i.value.length); } };
    const ask = el(`<p class="pick-ask" hidden></p>`);
    const map = houseMap({
      lat: home.lat, lon: home.lon, layer: dark() ? "dark" : "light", airport: ap,
      fit: Math.max(radius * 2.35, 6),
      rings: [
        { id: "track", nm: radius, cls: "track", label: "Tracking", min: 3, max: 60, step: 0.5, handleAt: 128, onDrag: (nm) => syncStepper("radius_nm", nm), onDrop: (nm) => page.querySelector('[data-setting="tracking.radius_nm"]').commit(nm) },
        { id: "over", nm: overhead, cls: "over", label: "Overhead", min: 0.5, max: 15, step: 0.5, handleAt: 52, onDrag: (nm) => syncStepper("overhead_nm", nm), onDrop: (nm) => page.querySelector('[data-setting="tracking.overhead_nm"]').commit(nm) },
      ],
      onPick: (lat, lon) => {
        ask.hidden = false;
        ask.innerHTML = `Move the house to <b>${coord(lat, lon)}</b>, ${num(distBrg(home, { lat, lon })[0], 1)} nm from its position now? <button class="btn small" data-yes>Move it</button> <button class="btn small quiet" data-no>Cancel</button>`;
        ask.querySelector("[data-yes]").onclick = async () => { ask.hidden = true; try { await moveHouse(lat, lon); } catch (e) { toast(e.message, true); } };
        ask.querySelector("[data-no]").onclick = () => { ask.hidden = true; };
      },
    });
    const hero = el(`<section class="house-map"></section>`);
    hero.append(map, el(`<div class="map-legend"><span class="lg track">Tracking radius</span><span class="lg over">Overhead</span><span class="dim">Drag a ring's handle to change it.</span></div>`));
    page.append(hero);
    const traffic = () => map.aircraft((S.sky?.aircraft || []).map((a) => ({ ...a, hero: S.sky.hero && a.hex === S.sky.hero.hex })));
    traffic();
    const timer = setInterval(async () => { if (!map.isConnected) return clearInterval(timer); if (!document.hidden) { await sky(); traffic(); } }, 5000);

    page.append(group("Tracking", "", [
      stepper("tracking", "radius_nm", { label: "Tracking radius", step: 0.5, min: 3, max: 60, presets: [[10], [15], [20], [30]], cls: "ring-track", preview: (v) => map.setRing("track", v), says: (v) => `Aircraft within ${num(v, 1)} nm are shown and logged.` }),
      stepper("tracking", "overhead_nm", { label: "Overhead within", step: 0.5, min: 0.5, max: 15, cls: "ring-over", preview: (v) => map.setRing("over", v), says: (v) => `Closer than ${num(v, 1)} nm takes over the screen and is logged as a flyover.` }),
      stepper("tracking", "max_overhead_alt_ft", { label: "Overhead below", step: 1000, min: 1000, max: 60000, presets: [[18000, "18,000"], [45000, "45,000"]], says: (v) => `Higher than ${num(v)} ft isn't counted as overhead.` }),
    ]));

    const moveB = el(`<button class="btn small quiet" type="button">${icon("pin")} Move it on the map</button>`);
    const rxB = el(`<button class="btn small quiet" type="button">${icon("receiver")} Use the receiver's position</button>`);
    moveB.onclick = () => { map.scrollIntoView({ block: "center", behavior: "smooth" }); map.pick(true); toast("Click where the house is on the map"); };
    rxB.onclick = async () => {
      try {
        const r = S.receiver?.receiver?.lat != null ? S.receiver : await call("receiver");
        S.receiver = r;
        if (r.receiver?.lat == null) return toast("The receiver doesn't report its position, or isn't connected", true);
        const lat = +r.receiver.lat.toFixed(4), lon = +r.receiver.lon.toFixed(4);
        if (!confirm(`Use the receiver's position, ${coord(lat, lon)} (${num(distBrg(home, { lat, lon })[0], 2)} nm from the house's now)?`)) return;
        await moveHouse(lat, lon);
      } catch (e) { if (e.message !== "signed out") toast(e.message, true); }
    };
    const pos = line("Position", `<span class="line-val">${home?.lat != null ? coord(home.lat, home.lon) : "Not set"}</span>`, [moveB, rxB]);
    pos.querySelector(".line-body").append(ask);
    pos.dataset.setting = "home.lat";
    page.append(group("House", "", [
      text("home", "name", { label: "Name" }),
      pos,
      advanced(() => [value("home", "zip") ? `ZIP code ${value("home", "zip")}` : "", value("home", "elevation_ft") != null ? `ground at ${num(value("home", "elevation_ft"))} ft` : "ground height from the airport"].filter(Boolean).join("; "), [
        stepper("home", "elevation_ft", { label: "Ground elevation", step: 10, min: -1500, max: 15000, says: (v) => v != null ? `Heights above the house are worked out from ${num(v)} ft. Empty the box to use the airport's.` : "Not set: the airport's elevation is used." }),
        text("home", "zip", { label: "ZIP code", help: "Only used when latitude and longitude are left out: the centre of the ZIP code's area." }),
      ]),
    ]));

    page.append(group("Airport", "", [
      text("airport", "icao", { label: "Airport", format: (v) => v === "auto" ? "auto (the nearest)" : v, help: "Its ICAO code (KPDX), or auto for the nearest large airport within 30 nm. Arrivals, departures, runways in use and the weather come from it.",
        says: () => ap?.name ? `${esc(ap.name)}${ap.lat != null && home?.lat != null ? `, ${num(distBrg(home, ap)[0], 1)} nm away` : ""}.` : "" }),
    ]));

    page.append(group("Other places", "Each keeps its own logbook", [placesList()]));
  },
};
