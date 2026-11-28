// The control board (/admin): the rail with each part's state, page routing, sign-in, and the dock
// of saved settings waiting for a restart.
import { $, el, esc, S, call, on, leavePage, toast, waiting, restart, loadOverview, loadSettings, whenSignedOut, plural, pageState, save, TITLES } from "./core.js";
import { say } from "./words.js";
import { icon } from "./icons.js";
import { finder, reveal } from "./finder.js";
import home from "./pages/home.js";
import receiver from "./pages/receiver.js";
import positions from "./pages/positions.js";
import places from "./pages/places.js";
import routes from "./pages/routes.js";
import look from "./pages/look.js";
import access from "./pages/access.js";
import safekeeping from "./pages/safekeeping.js";
import health from "./pages/health.js";
import server from "./pages/server.js";
import settings from "./pages/settings.js";

// null: a gap in the rail
const RAIL = [home, null, receiver, positions, places, routes, look, access, safekeeping, null, health, settings, server];
const PAGES = RAIL.filter(Boolean);
// the old pages' addresses, for bookmarks
const MOVED = { overview: "home", maps: "look", screens: "look", storage: "safekeeping", system: "server", log: "server", problems: "health" };

let current = null;

function rail() {
  const nav = $("#nav");
  nav.innerHTML = RAIL.map((p) => {
    if (!p) return `<hr>`;
    const st = p.id === "settings" ? ((S.settings?.strays || []).length + (S.settings?.left_out || []).length ? "warn" : "") : pageState(p.id);
    return `<a href="#${p.id}" class="${current?.id === p.id ? "on" : ""} ${st}" ${current?.id === p.id ? 'aria-current="page"' : ""}>
      ${icon(p.icon)}<span class="nav-name">${esc(TITLES[p.id])}</span>${st ? `<i class="nav-mark ${st}" title="${st === "fail" ? "Something here has stopped working" : "Something here needs a look"}"></i>` : ""}</a>`;
  }).join("");
  $("#version").textContent = S.overview ? `CloudWall ${S.overview.version}` : "";
}

// Saved settings waiting for a restart, each with an Undo
function dock() {
  const list = waiting();
  const d = $("#dock");
  d.hidden = !list.length;
  if (!list.length) { $("#dock-list").hidden = true; return; }
  const names = list.map((s) => s.label.toLowerCase());
  $("#dock-text").innerHTML = `<b>${plural(list.length, "change")} waiting for a restart</b> <span>${esc(names.slice(0, 2).join(", "))}${names.length > 2 ? ` and ${names.length - 2} more` : ""}${S.overview?.under_systemd ? "" : ": restart CloudWall by hand to use them"}</span><span class="dock-more">Review</span>`;
  $("#dock-restart").hidden = !S.overview?.under_systemd;
  $("#dock-list").innerHTML = `<ul>${list.map((st, i) => `<li><span class="dl-what"><b>${esc(st.label)}</b><small>${esc(st.sectionLabel)}</small></span>
      <span class="dl-change">${st.secret ? "replaced" : `<s>${esc(say(st, st.running))}</s> <span aria-hidden="true">to</span> <b>${esc(say(st))}</b>`}</span>
      ${st.secret ? "" : `<button class="btn small quiet" data-undo="${i}" title="Put back ${esc(say(st, st.running))}, which CloudWall is running with">Undo</button>`}</li>`).join("")}</ul>`;
  $("#dock-list").onclick = async (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b) return;
    const st = list[+b.dataset.undo];
    b.disabled = true;
    try { await save(st.section, st.key, st.running); toast(`${st.label}: back to ${say(st, st.running)}`); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); b.disabled = false; }
  };
}

async function go() {
  const [want, target] = (location.hash || "#home").slice(1).split("/");
  if (MOVED[want]) { location.replace(`#${MOVED[want]}`); return; }
  const page = PAGES.find((p) => p.id === want) || home;
  const changed = current !== page;
  current = page;
  rail();
  const main = $("#main");
  try {
    if (!S.overview) await loadOverview();
    if (!S.settings) await loadSettings();
    const fresh = el(`<div class="page page-${page.id}"></div>`);
    leavePage();
    await page.draw(fresh);
    main.replaceChildren(fresh);
    document.title = `${TITLES[page.id]}: CloudWall control board`;
    if (changed && !target) { main.focus({ preventScroll: true }); scrollTo({ top: 0 }); }
    rail(); dock();
    if (target) requestAnimationFrame(() => reveal(target));
  } catch (e) {
    if (e.message === "signed out") return;
    console.warn(e);
    main.replaceChildren(el(`<div class="page"><div class="empty bad"><h1>The board couldn't load this page</h1><p>${esc(e.message)}</p><p><button class="btn" onclick="location.reload()">Try again</button></p></div></div>`));
  }
}

function signIn(who) {
  current = null;
  $("#nav").innerHTML = ""; $("#signout").hidden = true; $("#dock").hidden = true;
  document.body.classList.add("signed-out");
  const main = $("#main");
  main.replaceChildren(el(who.owner_set === false
    ? `<div class="signin"><div class="signin-card">${icon("lock", "signin-ico")}<h1>Set an owner password first</h1>
       <p>CloudWall can only be changed from the machine it runs on until its owner has a password.</p>
       <p>At the machine, run <code>sudo cloudwall owner</code>, then sign in here. Or open this page in a browser on that machine.</p></div></div>`
    : `<div class="signin"><form class="signin-card" id="signin">${icon("lock", "signin-ico")}<h1>Sign in to the control board</h1>
       <p class="dim">As CloudWall's owner.</p>
       <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required autofocus>
       <button class="btn wide">Sign in</button>
       <p class="dim small">Forgotten it? Set a new one at the machine: <code>sudo cloudwall owner</code></p></form></div>`));
  const f = $("#signin");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { await call("signin", { password: $("#password").value }); document.body.classList.remove("signed-out"); start(); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
}
whenSignedOut(signIn);

async function start() {
  try { S.who = await call("whoami"); } catch { return; }
  if (S.who.role !== "owner") return signIn(S.who);
  document.body.classList.remove("signed-out");
  $("#signout").hidden = !S.who.owner_set;
  try { S.catalogue = await call("catalogue"); } catch { /* the problems go without their repair names */ }
  await go();
  clearInterval(start.timer);
  start.timer = setInterval(async () => {          // the rail and the open page keep up by themselves
    if (document.hidden) return;
    try { await loadOverview(); rail(); current?.tick?.(); } catch { /* said on the next action */ }
  }, 30000);
}

on("settings", () => { dock(); rail(); });
on("overview", () => rail());
on("page", () => go());
document.querySelector(".rail nav").before(finder());
$("#signout").onclick = async () => { await call("signout", {}); location.reload(); };
$("#dock-restart").onclick = restart;
$("#dock-text").onclick = () => {
  const l = $("#dock-list"), open = l.hidden;
  l.hidden = !open; $("#dock-text").setAttribute("aria-expanded", String(open));
};
// show every setting's explanation under it (remembered in localStorage)
const explain = (on) => { document.body.classList.toggle("explain", on); $("#explain").checked = on; try { localStorage.setItem("cloudwall.explain", on ? "1" : ""); } catch { /* fine */ } };
$("#explain").onchange = (e) => explain(e.target.checked);
try { explain(!!localStorage.getItem("cloudwall.explain")); } catch { /* fine */ }
addEventListener("hashchange", go);
start();
