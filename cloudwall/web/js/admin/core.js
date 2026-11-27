// What every page of the control board shares: the board's data (from /api/admin/, app/admin.py),
// reading and saving settings, saying things (the toast), the restart that new settings wait for,
// and the small helpers for writing pages. Nothing is decided here that the server decides.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/** One element from HTML. */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// -- numbers and times, said the way people say them ----------------------------------------------
export const num = (n, d = 0) => n == null || Number.isNaN(+n) ? "–" : (+n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
export function ago(t) {
  if (!t) return "never";
  const s = Date.now() / 1000 - t;
  if (s < 0) return "just now";
  return s < 45 ? "just now" : s < 5400 ? `${Math.round(s / 60) || 1} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}
export const lasted = (s) => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h` : `${Math.round(s / 86400)} days`;
export const bytes = (b) => b == null ? "–" : b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} kB` : `${b} B`;
export const when = (t) => new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
export const day = (t) => new Date(t * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const plural = (n, one, many = /aircraft$/.test(one) ? one : one + "s") => `${num(n)} ${n === 1 ? one : many}`;

// -- the board's data ------------------------------------------------------------------------------
export const S = { who: null, overview: null, settings: null, catalogue: null, doctor: null, sky: null, secretsSaved: new Set() };
export const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, fn);
export const emit = (name) => bus.dispatchEvent(new Event(name));

let signedOut = () => {};
export const whenSignedOut = (fn) => { signedOut = fn; };

export async function call(path, body, method) {
  const r = await fetch(`api/admin/${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin",
  });
  const got = (r.headers.get("Content-Type") || "").includes("json") ? await r.json() : null;
  if (r.status === 401) { signedOut(got || {}); throw new Error("signed out"); }
  if (!r.ok) throw new Error((got && got.error) || `the board's server said ${r.status}`);
  return got;
}

/** The board's own picture of the sky (the same /api/state the screens use). */
export async function sky() {
  try { S.sky = await (await fetch("api/state", { credentials: "same-origin" })).json(); } catch { /* the pages say so */ }
  return S.sky;
}

export async function loadOverview() { S.overview = await call("overview"); emit("overview"); return S.overview; }
export async function loadSettings() { S.settings = await call("settings"); emit("settings"); return S.settings; }

// -- settings ------------------------------------------------------------------------------------------
/** A setting as the board knows it: its description (core/schema.py), what's saved and what's running. */
export function setting(section, key) {
  const sec = S.settings?.sections.find((s) => s.name === section);
  const s = sec?.settings.find((x) => x.key === key);
  if (!s) return null;
  const running = S.settings.running?.[section]?.[key];
  const waiting = s.secret ? S.secretsSaved.has(`${section}.${key}`) : JSON.stringify(running) !== JSON.stringify(s.value);
  return { ...s, section, sectionLabel: sec.label, page: sec.page, running, waiting, live: (S.settings.live || []).includes(section) };
}
export const value = (section, key) => setting(section, key)?.value;

/** Every saved setting CloudWall isn't yet running with. */
export function waiting() {
  const out = [];
  for (const sec of S.settings?.sections || []) for (const s of sec.settings) {
    const st = setting(sec.name, s.key);
    if (st?.waiting) out.push(st);
  }
  return out;
}

export async function save(section, key, v) {
  const got = await call("settings", { section, key, value: v });
  const st = setting(section, key);
  if (st?.secret) S.secretsSaved.add(`${section}.${key}`);
  await loadSettings();
  return got;
}

// -- saying things --------------------------------------------------------------------------------------
/** Say something for a few seconds; with `action` ({label, fn}), a button to act on it (Undo). */
export function toast(text, bad, action) {
  const t = $("#toast");
  t.textContent = text; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  if (action) {
    const b = el(`<button type="button" class="toast-act">${esc(action.label)}</button>`);
    b.onclick = async () => { t.hidden = true; try { await action.fn(); } catch (e) { if (e.message !== "signed out") toast(e.message, true); } };
    t.append(b);
  }
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 9000 : action ? 8000 : 4500);
}

/** A button that runs `fn`, disabled while it does, saying what went wrong if it fails. */
export function button(label, fn, cls = "") {
  const b = el(`<button class="btn ${cls}" type="button">${label}</button>`);
  b.onclick = async (e) => {
    b.disabled = true;
    try { await fn(e, b); } catch (err) { if (err.message !== "signed out") toast(err.message, true); } finally { b.disabled = false; }
  };
  return b;
}

// -- the restart new settings wait for -------------------------------------------------------------------
export async function restart() {
  if (!S.overview?.under_systemd) return toast("CloudWall is running by hand here: stop it and start it again for the new settings.", true);
  if (!confirm("Restart CloudWall now? The screens reconnect by themselves in a few seconds.")) return;
  try { await call("restart", {}); } catch (e) { return toast(e.message, true); }
  toast("Restarting…");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await call("whoami");
      S.secretsSaved.clear();
      await Promise.all([loadSettings(), loadOverview()]);
      toast("CloudWall is back, with the new settings");
      emit("page");
      return;
    } catch { /* still starting */ }
  }
  toast("CloudWall hasn't come back yet: sudo systemctl status cloudwall at the machine says why", true);
}

// -- the whole machine's check, and the root helper -------------------------------------------------------
export async function runDoctor() {
  toast("Checking the whole machine: it asks each feed, so it takes a few seconds…");
  S.doctor = await call("doctor?fresh=1");
  await loadOverview();
  const bad = S.doctor.findings.filter((f) => f.state === "warn" || f.state === "fail").length;
  toast(bad ? `Checked: ${plural(bad, "thing")} to look at` : "Checked: all well");
  emit("page");
}

export async function waitFor(rid) {
  toast("Asked the root helper…");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const got = await call(`requests/${rid}`);
    if (got.done) { toast(got.said, !got.ok); await loadOverview(); emit("page"); return; }
  }
  toast("The root helper hasn't answered: is cloudwall-helper.path running? (sudo systemctl status cloudwall-helper.path)", true);
}

/** Every open problem: the watcher's and the last whole-machine check's, once each. */
export function problems() {
  const h = S.overview?.health || {};
  const list = [...(h.open || []), ...(S.doctor?.findings || []).filter((f) => f.state === "warn" || f.state === "fail")];
  const seen = new Set();
  return list.filter((f) => { const k = (f.code || "") + "|" + f.summary; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.major - a.major) || (a.state === "fail" ? -1 : b.state === "fail" ? 1 : 0));
}

/** The house's place (the first), and its feed from your own receiver, if there is one. */
export const house = () => S.overview?.places?.[0];
export function ownFeed(p = house()) {
  const feeds = Object.entries(p?.feeds || {});
  return feeds.find(([label]) => /receiver/i.test(label))?.[1] || null;
}

// each page's name: the rail, the page's own title, the finder and All settings all say it this way
export const TITLES = { home: "Overview", stations: "Stations", receiver: "ADS-B", radio: "Radio", positions: "Feeds", places: "Location", routes: "Routes", look: "Display",
                        access: "Access", safekeeping: "Backups", health: "Health", settings: "All settings", server: "System" };

// which of the checks' parts each page looks after, for the rail's marks and each page's problems
export const PARTS = {
  stations: ["receiver", "tunnel"], receiver: ["receiver", "tunnel"], positions: ["feeds"], places: ["home"], routes: ["routes"],
  look: ["display", "weather"], access: ["access", "caddy"], safekeeping: ["storage", "cache", "backup"],
  server: ["service", "install", "server", "system", "settings", "files", "clock"],
};
export const partOf = (f) => (f.part || "").replace(/^running: /, "");
export const problemsOf = (page) => problems().filter((f) => (PARTS[page] || []).includes(partOf(f)));
export function pageState(page) {
  const mine = page === "home" ? problems() : problemsOf(page);
  return mine.some((f) => f.state === "fail") ? "fail" : mine.length ? "warn" : "";
}
