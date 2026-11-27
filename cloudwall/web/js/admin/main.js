// The control board (/admin). The rail names each part of CloudWall in plain words with how it is
// doing right now under its name, so the rail alone answers "is everything all right?"; each page
// opens with a picture of what it looks after and keeps its rare settings behind shades. Saved
// settings wait for a restart, gathered in one dock at the bottom.
import { $, el, esc, S, call, on, toast, waiting, restart, loadOverview, loadSettings, whenSignedOut, plural, pageState } from "./core.js";
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

const PAGES = [home, receiver, positions, places, routes, look, access, safekeeping, health, server];
// the old pages' addresses, for bookmarks
const MOVED = { overview: "home", maps: "look", screens: "look", storage: "safekeeping", system: "server", log: "server", problems: "health" };

let current = null;

function rail() {
  const nav = $("#nav");
  nav.innerHTML = PAGES.map((p) => {
    const st = pageState(p.id);
    let live = "";
    try { live = p.live?.() || ""; } catch { /* the line waits for its data */ }
    return `<a href="#${p.id}" class="${current?.id === p.id ? "on" : ""} ${st}" ${current?.id === p.id ? 'aria-current="page"' : ""}>
      ${icon(p.icon)}<span class="nav-name">${esc(p.title)}</span><span class="nav-live">${esc(live)}</span>${st ? `<i class="nav-mark ${st}" title="${st === "fail" ? "Something has stopped" : "Worth a look"}"></i>` : ""}</a>`;
  }).join("");
  $("#version").textContent = S.overview ? `CloudWall ${S.overview.version}` : "";
}

function dock() {
  const list = waiting();
  const d = $("#dock");
  d.hidden = !list.length;
  if (!list.length) return;
  const names = list.map((s) => s.label.toLowerCase());
  $("#dock-text").innerHTML = `<b>${plural(list.length, "change")} saved</b> <span>${esc(names.slice(0, 3).join(", "))}${names.length > 3 ? ` and ${names.length - 3} more` : ""}: ${S.overview?.under_systemd ? "in use once CloudWall restarts" : "restart CloudWall by hand to use them"}</span>`;
  $("#dock-restart").hidden = !S.overview?.under_systemd;
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
    await page.draw(fresh);
    main.replaceChildren(fresh);
    document.title = `${page.title} · CloudWall control board`;
    if (changed && !target) { main.focus({ preventScroll: true }); scrollTo({ top: 0 }); }
    rail(); dock();
    if (target) requestAnimationFrame(() => reveal(target));
  } catch (e) {
    if (e.message === "signed out") return;
    console.warn(e);
    main.replaceChildren(el(`<div class="page"><div class="empty bad"><h1>The board couldn't load this page</h1><p>${esc(e.message)}</p><p><button class="btn" onclick="location.reload()">Try again</button></p></div></div>`));
  }
}

// -- signing in -----------------------------------------------------------------------------------
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
addEventListener("hashchange", go);
start();
