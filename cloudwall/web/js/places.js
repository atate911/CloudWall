// The place this screen shows, in the header, and the desktop's menu of places: switching to
// another, setting one up by ZIP code or coordinates, removing one set up that way.
import { $, esc, store } from "./util.js";

let current = () => null;       // the page's state, as app.js has it now

// The place in the header: its airport's code, and with several places its name too. On the
// desktop it opens a menu of the places, to switch this screen to another (it starts afresh on
// it), to set up a new one by ZIP code or coordinates, or to remove one set up that way.
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
    `<button class="pm-add" id="pm-add" role="menuitem">Set a location…</button>`;
  m.hidden = false;
  $("station").setAttribute("aria-expanded", "true");
}
$("station").addEventListener("click", () => ($("place-menu").hidden ? openPlaceMenu() : closePlaceMenu()));
$("place-menu").addEventListener("click", async (e) => {
  if (e.target.closest("#pm-add")) { closePlaceMenu(); return openLocation(); }
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

// Setting a location: a ZIP code or coordinates, then the airport: the closest major one by
// default, or another of the airline airports nearby. Shows where it is as it's typed.
let locTimer = null, locFound = null;
// The places routes answer 200, or 400 with a message, so a 404 means the server doesn't have
// them: it is still running code from before an update that this page, read fresh from disk,
// comes from.
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

// Once, as the page starts: current() gives the state the menu is drawn from.
export function placeMenu(getState) { current = getState; }
