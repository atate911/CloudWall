// The place this screen shows, in the header, and the desktop's menu of places: switching to
// another, setting one up by ZIP code or coordinates, removing one set up that way.
import { $, esc, store } from "./util.js";

let current = () => null;       // the page's state, as app.js has it now

export function renderPlace(state, KIOSK) {
  const places = state.places || [], here = places.find((p) => p.id === state.place), many = places.length > 1;
  const label = many && here ? `${here.name} · ${state.airport.icao}` : state.airport.icao || "";
  const st = $("station");
  // the label in a span of its own, so a long name can be cut short on a phone and keep its arrow
  if (st.dataset.label !== label) { st.dataset.label = label; st.innerHTML = label ? `<span>${esc(label)}</span>` : ""; }
  st.disabled = KIOSK;
  st.classList.toggle("menu", !KIOSK);
  st.classList.toggle("many", many);
}

function showPlace(id) {
  store("place", id);
  const u = new URL(location.href);
  u.searchParams.delete("place");          // the menu's choice wins over one given in the address
  location.href = u.toString();
}
function closePlaceMenu() { $("place-menu").hidden = true; $("station").setAttribute("aria-expanded", "false"); }
function openPlaceMenu() {
  const m = $("place-menu"), state = current();
  m.innerHTML = (state.places || []).map((p) => `<div class="pm-row">
    <button role="menuitemradio" aria-checked="${p.id === state.place}" data-place="${esc(p.id)}">
      <b>${esc(p.name)}</b><span>${esc(p.icao)}${p.city ? ` · ${esc(p.city)}` : ""}${p.zip && !p.name.includes(p.zip) ? ` · ZIP ${esc(p.zip)}` : ""}</span></button>
    ${p.added ? `<button class="pm-remove" data-remove="${esc(p.id)}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}"></button>` : ""}</div>`).join("") +
    `<button class="pm-add" id="pm-here" role="menuitem">Use my location…</button>` +
    `<button class="pm-add" id="pm-add" role="menuitem">Set a location…</button>`;
  m.hidden = false;
  $("station").setAttribute("aria-expanded", "true");
}
$("station").addEventListener("click", () => ($("place-menu").hidden ? openPlaceMenu() : closePlaceMenu()));
$("place-menu").addEventListener("click", async (e) => {
  if (e.target.closest("#pm-add")) { closePlaceMenu(); return openLocation(); }
  if (e.target.closest("#pm-here")) { closePlaceMenu(); openLocation(); return useMyLocation(); }
  const rm = e.target.closest("button[data-remove]");
  const state = current();
  if (rm) {
    const p = (state.places || []).find((x) => x.id === rm.dataset.remove);
    if (!p || !confirm(`Remove ${p.name}? Its logbook stays on disk.`)) return;
    const r = await placesApi(`api/places?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (r.error) return alert(r.error);
    if (p.id === state.place) return showPlace("");      // this screen was on it: back to the first
    state.places = r.places;
    return openPlaceMenu();
  }
  const b = e.target.closest("button[data-place]");
  if (!b) return;
  if (b.dataset.place === state.place) return closePlaceMenu();
  showPlace(b.dataset.place);
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".brand")) closePlaceMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlaceMenu(); });

// ---------- setting a location ----------
let locTimer = null, locFound = null;
// The places routes answer 200 or 400, so a 404 means the server is still running code from before
// an update that this page (read fresh from disk) comes from.
async function placesApi(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch (e) { return { error: "CloudWall isn't answering" }; }
  if (r.status === 404) return { error: "CloudWall was updated but is still running the old version: restart it, then try again" };
  return r.json().catch(() => ({ error: "CloudWall isn't answering" }));
}
function openLocation() {
  $("loc-form").reset();
  $("loc-where").textContent = ""; $("loc-airports").innerHTML = ""; $("loc-error").textContent = "";
  $("loc-save").disabled = true;
  $("loc-here").hidden = !("geolocation" in navigator) && window.isSecureContext;   // a browser with none at all
  $("loc-here").disabled = false;
  locFound = null;
  $("loc-dialog").showModal();
  $("loc-q").focus();
}
async function lookUpLocation() {
  const q = $("loc-q").value.trim();
  locFound = null;
  $("loc-save").disabled = true;
  if (!q) { $("loc-where").textContent = ""; $("loc-airports").innerHTML = ""; return; }
  const r = await placesApi(`api/locate?q=${encodeURIComponent(q)}`);
  if (q !== $("loc-q").value.trim()) return;            // typed on since
  if (r.error) { $("loc-where").textContent = r.error; $("loc-where").classList.add("bad"); $("loc-airports").innerHTML = ""; return; }
  locFound = r;
  $("loc-where").classList.remove("bad");
  $("loc-where").textContent = `${r.zip ? `ZIP ${r.zip}, ` : ""}${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`;
  const auto = r.airports.find((a) => a.icao === r.auto);
  const opt = (value, html, checked) => `<label class="loc-opt"><input type="radio" name="loc-ap" value="${esc(value)}"${checked ? " checked" : ""}><span>${html}</span></label>`;
  $("loc-airports").innerHTML = `<legend class="label">Airport</legend>` +
    opt("auto", `<b>Closest major airport</b><small>${auto ? `${esc(auto.iata || auto.icao)} · ${esc(auto.name)} · ${auto.dist_nm} nm` : esc(r.auto || "")}</small>`, true) +
    r.airports.filter((a) => a.icao !== r.auto)            // the automatic choice is the first option already
      .map((a) => opt(a.icao, `<b>${esc(a.iata || a.icao)} · ${esc(a.name)}</b><small>${esc(a.city || "")} · ${a.dist_nm} nm${a.size === "large" ? " · large" : ""}</small>`)).join("");
  $("loc-save").disabled = false;
}
// This device's location: a place already set up within HERE_NM of it is shown straight away.
// Browsers give a page its location only over HTTPS (or localhost), so a plain-HTTP screen can't have it.
const HERE_NM = 1;
function nmApart(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.sqrt(h));
}
function hereError(text) {
  $("loc-where").textContent = text;
  $("loc-where").classList.add("bad");
  $("loc-here").disabled = false;
}
function useMyLocation() {
  if (!window.isSecureContext)
    return hereError("Browsers only share their location with pages over HTTPS (or at localhost): type a ZIP code or coordinates instead");
  if (!("geolocation" in navigator)) return hereError("This browser can't tell where it is: type a ZIP code or coordinates instead");
  $("loc-here").disabled = true;
  $("loc-where").classList.remove("bad");
  $("loc-where").textContent = "Finding where this device is…";
  navigator.geolocation.getCurrentPosition((pos) => {
    if (!$("loc-dialog").open) return;                 // closed while it looked
    const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const state = current() || {};
    const near = (state.places || []).filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({ p, nm: nmApart(here, p) })).sort((a, b) => a.nm - b.nm)[0];
    if (near && near.nm <= HERE_NM) {
      $("loc-dialog").close();
      return near.p.id === state.place ? undefined : showPlace(near.p.id);
    }
    $("loc-here").disabled = false;
    $("loc-q").value = `${here.lat.toFixed(4)}, ${here.lon.toFixed(4)}`;
    if (!$("loc-name").value.trim()) $("loc-name").value = "My location";
    lookUpLocation();
  }, (err) => hereError(err.code === err.PERMISSION_DENIED
    ? "Location access was refused: allow it for this page in the browser's settings, or type a ZIP code or coordinates"
    : "Couldn't find where this device is: type a ZIP code or coordinates instead"),
  { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
}
$("loc-here").addEventListener("click", useMyLocation);
$("loc-q").addEventListener("input", () => { clearTimeout(locTimer); locTimer = setTimeout(lookUpLocation, 250); });
$("loc-cancel").addEventListener("click", () => $("loc-dialog").close());
$("loc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!locFound) return;
  const airport = ($("loc-form").querySelector("input[name=loc-ap]:checked") || {}).value || "auto";
  $("loc-save").disabled = true;
  const r = await placesApi("api/places", { method: "POST", body: JSON.stringify({ q: $("loc-q").value.trim(), name: $("loc-name").value.trim(), airport }) });
  if (r.error) { $("loc-error").textContent = r.error; $("loc-save").disabled = false; return; }
  showPlace(r.place.id);                                 // this screen moves to the new place
});

export function placeMenu(getState) { current = getState; }
