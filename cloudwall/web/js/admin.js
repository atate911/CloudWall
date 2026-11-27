// The control board (/admin): every part of CloudWall at a glance, and every setting, problem and
// action one step down. The Overview is an annunciator panel: a lamp for each part, dark when all is
// well, lit amber or red when not; each lit lamp's problem is set out below it as a checklist, the way
// a pilot's quick-reference handbook sets out a non-normal procedure: the condition, what it means,
// then the steps, each with what CloudWall can do about it (repair, ask what it needs, check again).
// The other pages are the settings, grouped by what they're about, with help on hover (or for every
// setting, with Help on), the rarely-needed ones behind "More settings".
// All data comes from /api/admin/ (app/admin.py); nothing is decided here that the server decides.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (t) => { if (!t) return "never"; const s = Date.now() / 1000 - t; return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const lasted = (s) => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
const mb = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;
const when = (t) => new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

async function call(path, body, method) {
  const r = await fetch(`api/admin/${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin",
  });
  const got = (r.headers.get("Content-Type") || "").includes("json") ? await r.json() : null;
  if (r.status === 401) { showSignIn(got || {}); throw new Error("signed out"); }
  if (!r.ok) throw new Error((got && got.error) || `${r.status}`);
  return got;
}

function toast(text, bad) {
  const t = $("toast");
  t.textContent = text; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 9000 : 5000);
}

// -- pages -----------------------------------------------------------------------------------
const PAGES = [
  ["overview", "Overview"], ["places", "Places"], ["positions", "Positions"], ["routes", "Routes"], ["maps", "Maps"],
  ["screens", "Screens"], ["access", "Access"], ["storage", "Storage and backups"], ["health", "Health"], ["system", "System"],
  [null], ["log", "Log"],
];
// what each lamp on the annunciator watches, and which page it opens
const LAMPS = [
  ["positions", "Positions", ["feeds", "running: feeds"], "positions"],
  ["receiver", "Your receiver", ["receiver", "running: receiver", "tunnel"], "positions"],
  ["storage", "Logbook and disk", ["storage", "running: storage", "cache", "backup"], "storage"],
  ["settings", "Settings", ["settings", "running: settings", "files"], "system"],
  ["routes", "Paid routes", ["routes", "running: routes"], "routes"],
  ["clock", "Clock", ["clock", "running: clock"], "system"],
  ["service", "Service", ["service", "running: service", "install", "server", "system"], "system"],
  ["access", "Access", ["access", "running: access", "caddy"], "access"],
  ["display", "Screens", ["display", "running: display", "weather", "running: weather", "home", "running: home"], "screens"],
];

let state = { page: "overview", settings: null, overview: null, doctor: null, who: null, logAfter: 0 };

function nav() {
  const open = state.overview?.health?.open || [];
  const counts = {};
  for (const f of open) for (const [, , parts, page] of LAMPS) if (parts.includes(f.part)) {
    counts[page] = counts[page] || { n: 0, fail: false }; counts[page].n++; counts[page].fail ||= f.state === "fail";
  }
  $("nav").innerHTML = PAGES.map(([id, label]) => id === null ? "<hr>" :
    `<a href="#${id}" class="${state.page === id ? "on" : ""}">${esc(label)}${counts[id] ? `<span class="count${counts[id].fail ? " fail" : ""}" title="${counts[id].n} problem(s)">${counts[id].n}</span>` : ""}</a>`).join("");
}

async function go() {
  state.page = (location.hash || "#overview").slice(1);
  nav();
  const main = $("main");
  try {
    if (!state.overview || state.page === "overview") state.overview = await call("overview");
    paintTop();
    nav();
    const draw = { overview: drawOverview, log: drawLog, health: drawHealth, system: drawSystem, storage: drawStorage,
                   access: drawAccess, places: drawPlaces, positions: drawPositions, routes: drawRoutes }[state.page];
    main.innerHTML = "";
    if (draw) await draw(main);
    if (!["overview", "log", "health", "system"].includes(state.page)) await drawSettings(main, state.page);
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e.message !== "signed out") main.innerHTML = `<p class="bad-load">The board couldn't load: ${esc(e.message)}. <button class="btn quiet" onclick="location.reload()">Try again</button></p>`;
  }
}

function paintTop() {
  const h = state.overview?.health;
  const pill = $("state");
  if (!h) { pill.hidden = true; return; }
  const words = { ok: "All well", warn: `${h.problems} worth a look`, fail: h.major ? "Not working" : `${h.problems} to fix` };
  pill.hidden = false; pill.className = `pill ${h.worst}`; pill.textContent = words[h.worst] || h.worst;
  pill.title = h.major ? `${h.major_title}: ${h.major}` : "How CloudWall's check of itself stands";
}

// -- overview: the annunciator and the checklists -----------------------------------------------
function lampState(id, parts, findings, o) {
  const mine = findings.filter((f) => parts.includes(f.part) && (f.state === "warn" || f.state === "fail"));
  if (mine.some((f) => f.state === "fail")) return ["fail", mine];
  if (mine.length) return ["warn", mine];
  // nothing wrong: dark, with its green mark when there is something there to be working
  const p = o.places[0] || {};
  const there = { positions: p.status?.ok, receiver: !!p.feeds?.["your receiver"], storage: true, settings: true,
                  routes: !!o.provider, clock: true, service: true, access: true, display: true }[id];
  return [there ? "ok" : "off", mine];
}

async function drawOverview(main) {
  const o = state.overview, h = o.health || { open: [], findings: [] };
  const findings = [...(h.findings || []), ...(state.doctor?.findings || [])];
  const open = dedupe([...(h.open || []), ...(state.doctor?.findings || []).filter((f) => f.state === "warn" || f.state === "fail")]);
  const place = o.places[0];
  main.innerHTML = `
    <h1>${o.demo ? "Simulated traffic" : esc(place?.name || "CloudWall")}</h1>
    <p class="lede">${summaryLine(o, open)}</p>
    <section class="glareshield" aria-label="Every part of CloudWall">
      <figure class="scope" title="The sky around ${esc(place?.name || "the house")} now, from the board's own data">
        <canvas id="scope" aria-label="Radar: the aircraft around the house now" role="img"></canvas>
        <figcaption id="scope-say"></figcaption>
      </figure>
      <div class="panel-right">
        <div class="masters">${master("warning", "Master warning", open.filter((f) => f.major && f.state === "fail"))}${master("caution", "Master caution", open.filter((f) => !(f.major && f.state === "fail")))}</div>
        <div class="annunciator">
        ${LAMPS.map(([id, label, parts, page]) => {
          const [st, mine] = lampState(id, parts, findings, o);
          return `<a class="lamp ${st}" href="#${page}" title="${esc(mine.map((f) => f.summary).join("\n") || label + ": " + ({ ok: "working", off: "not set up, or nothing to check" }[st] || ""))}">
            <span class="lamp-name">${esc(label)}</span><span class="lamp-say">${esc(lampWords(id, st, mine, o))}</span></a>`;
        }).join("")}
        </div>
      </div>
    </section>
    <section id="checklists">${open.length ? "" : `<p class="all-well">Nothing needs doing. CloudWall checks itself every 30 seconds; <button class="link" id="run-doctor">check the whole machine now</button>.</p>`}</section>
    ${o.places.map(placeSheet).join("")}
    <h2>Lately</h2>
    ${incidentTable(o.incidents)}`;
  main.querySelectorAll(".master").forEach((b) => b.onclick = () => acknowledge(b));
  scope(main.querySelector("#scope"), main.querySelector("#scope-say"));
  const box = main.querySelector("#checklists");
  open.sort((a, b) => (b.major - a.major) || (a.state === "fail" ? -1 : 1)).forEach((f) => box.appendChild(checklist(f)));
  main.querySelector("#run-doctor")?.addEventListener("click", runDoctor);
  if (open.length) {
    const more = document.createElement("p");
    more.className = "dim";
    more.innerHTML = `<button class="link">Check the whole machine again</button> (the settings, the service, the feeds, backups, the tunnel and Caddy)`;
    more.querySelector("button").onclick = runDoctor;
    box.appendChild(more);
  }
}

// The master lights: lit while any problem of theirs is open, flashing until it has been seen (a click
// says so, remembered in this browser), as a cockpit's master caution is pressed to say "seen".
function acked() { try { return new Set(JSON.parse(localStorage.getItem("cloudwall.adminSeen") || "[]")); } catch { return new Set(); } }
function master(kind, label, list) {
  const keys = list.map((f) => (f.code || "") + "|" + f.summary), seen = acked();
  const fresh = keys.some((k) => !seen.has(k));
  return `<button class="master ${kind}${list.length ? " lit" : ""}${fresh ? " fresh" : ""}" data-keys="${esc(JSON.stringify(keys))}"
    ${list.length ? "" : "disabled"} title="${list.length ? `${list.length} open${fresh ? ": press to say you've seen it" : ""}` : "Nothing"}">${esc(label)}</button>`;
}
function acknowledge(b) {
  const seen = acked();
  for (const k of JSON.parse(b.dataset.keys || "[]")) seen.add(k);
  try { localStorage.setItem("cloudwall.adminSeen", JSON.stringify([...seen].slice(-200))); } catch { /* fine */ }
  b.classList.remove("fresh");
}

// The scope: the board's own picture of the sky around the house, drawn on a small radar with a slow
// sweep (still, for anyone who asks for reduced motion). Aircraft within the tracking radius, the one
// overhead in magenta as on the board, the airport where it is.
let scopeTimer = null, scopeFrame = null;
function scope(canvas, say) {
  if (!canvas) return;
  clearInterval(scopeTimer); cancelAnimationFrame(scopeFrame);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let st = null;
  const load = async () => {
    try {
      const r = await fetch("api/state", { credentials: "same-origin" });
      st = await r.json();
      const n = st.aircraft.filter((a) => !a.on_ground).length;
      say.textContent = `${n} aircraft within ${st.tracking.radius_nm} nm` + (st.hero ? `; ${st.hero.callsign || st.hero.hex} overhead` : "");
    } catch { say.textContent = "The board's data isn't answering"; }
  };
  load(); scopeTimer = setInterval(() => { if (!document.hidden && document.body.contains(canvas)) load(); else if (!document.body.contains(canvas)) clearInterval(scopeTimer); }, 5000);
  const ctx = canvas.getContext("2d"), t0 = performance.now();
  const draw = (now) => {
    if (!document.body.contains(canvas)) return;
    const dpr = devicePixelRatio || 1, size = canvas.clientWidth;
    if (canvas.width !== size * dpr) { canvas.width = canvas.height = size * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2, R = c - 6, css = getComputedStyle(canvas);
    const phos = css.getPropertyValue("--phosphor").trim() || "#7fe0a0", mag = css.getPropertyValue("--overhead").trim() || "#de80ae";
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = css.getPropertyValue("--scope").trim() || "#0b1a14";
    ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.fill();
    ctx.strokeStyle = phos; ctx.globalAlpha = .22; ctx.lineWidth = 1;
    for (const k of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(c, c, R * k, 0, 7); ctx.stroke(); }
    for (let d = 0; d < 360; d += 30) { const a = d * Math.PI / 180; ctx.beginPath(); ctx.moveTo(c + Math.sin(a) * R * .94, c - Math.cos(a) * R * .94); ctx.lineTo(c + Math.sin(a) * R, c - Math.cos(a) * R); ctx.stroke(); }
    ctx.globalAlpha = .55; ctx.font = `700 ${Math.max(9, size / 26)}px B612, sans-serif`; ctx.fillStyle = phos; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", c, c - R + size / 18);
    const sweep = still ? null : ((now - t0) / 4000 * 2 * Math.PI) % (2 * Math.PI);
    if (sweep !== null) {
      const g = ctx.createConicGradient ? ctx.createConicGradient(sweep - Math.PI / 2 - 0.9, c, c) : null;
      if (g) { g.addColorStop(0, "transparent"); g.addColorStop(0.143, phos); g.addColorStop(0.1431, "transparent");
        ctx.globalAlpha = .16; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, 0, 7); ctx.fill(); }
      ctx.globalAlpha = .7; ctx.strokeStyle = phos; ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.sin(sweep) * R, c - Math.cos(sweep) * R); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = phos; ctx.beginPath(); ctx.arc(c, c, 2.2, 0, 7); ctx.fill();
    if (st) {
      const radius = st.tracking.radius_nm, k = R / radius, ap = st.airport;
      if (ap?.lat != null) {
        const dy = (ap.lat - st.home.lat) * 60, dx = (ap.lon - st.home.lon) * 60 * Math.cos(st.home.lat * Math.PI / 180);
        if (Math.hypot(dx, dy) < radius) { ctx.globalAlpha = .6; ctx.strokeStyle = phos; ctx.strokeRect(c + dx * k - 3, c - dy * k - 3, 6, 6); }
      }
      for (const a of st.aircraft) {
        if (a.on_ground || a.dist > radius) continue;
        const b = a.brg * Math.PI / 180, x = c + Math.sin(b) * a.dist * k, y = c - Math.cos(b) * a.dist * k;
        const hero = st.hero && a.hex === st.hero.hex;
        let glow = 1;
        if (sweep !== null) { const behind = ((sweep - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); glow = .45 + .55 * Math.max(0, 1 - behind / 4); }
        ctx.globalAlpha = glow; ctx.fillStyle = hero ? mag : phos;
        ctx.beginPath(); ctx.arc(x, y, hero ? 3.8 : 2.6, 0, 7); ctx.fill();
        if (hero) { ctx.globalAlpha = 1; ctx.strokeStyle = mag; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, 7); ctx.stroke(); }
        if (a.track != null) { const t = a.track * Math.PI / 180; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(t) * 9, y - Math.cos(t) * 9); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
    if (!still) scopeFrame = requestAnimationFrame(draw);
  };
  if (still) { const tick = () => { draw(performance.now()); }; tick(); setInterval(tick, 5000); } else scopeFrame = requestAnimationFrame(draw);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => { const k = (f.code || "") + "|" + f.summary; if (seen.has(k)) return false; seen.add(k); return true; });
}

function summaryLine(o, open) {
  const p = o.places[0];
  const up = Date.now() / 1000 - o.started;
  const bits = [];
  if (p) bits.push(p.status.ok ? `${p.aircraft} aircraft in range, positions from ${esc(p.status.source)} ${ago(p.status.updated)}` : "no positions arriving");
  if (p) bits.push(`${p.today} flyover${p.today === 1 ? "" : "s"} logged today`);
  bits.push(`running ${lasted(up)}`);
  return bits.join("; ") + (open.length ? "." : ". All well.");
}

function lampWords(id, st, mine, o) {
  if (mine.length) return mine[0].summary.replace(/^[^:]{1,40}: /, "").slice(0, 90);
  const p = o.places[0] || {};
  const rx = p.feeds?.["your receiver"];
  return {
    positions: p.status?.ok ? `${p.aircraft} aircraft, ${ago(p.status.updated)}` : "waiting",
    receiver: rx ? `${rx.count} aircraft, ${rx.lag_s != null ? rx.lag_s.toFixed(1) + " s behind" : ""}` : "none set up",
    storage: o.storage?.disk ? `${mb(o.storage.disk.free)} free` : o.demo ? "kept in memory (demo)" : "",
    settings: o.settings_file ? "read from its file" : "built-in defaults",
    routes: o.provider ? `${o.provider.used_today} of ${o.provider.daily_limit ?? "any"} lookups today` : "free database only",
    clock: "time zone matches the house",
    service: o.under_systemd ? "running as a service" : "running by hand",
    access: o.private_link ? "private link" : "open on this network",
    display: o.demo ? "simulated traffic" : "as set",
  }[id] || "";
}

function checklist(f) {
  // set out like an air traffic controller's flight strip: the state, the condition, how long open
  const el = document.createElement("article");
  el.className = `checklist strip ${f.state}`;
  const steps = f.steps?.length ? f.steps : f.fix ? [f.fix] : [];
  const since = f.since ? lasted(Date.now() / 1000 - f.since) : "just now";
  el.innerHTML = `
    <header class="strip-row">
      <span class="strip-state">${f.major && f.state === "fail" ? "Warning" : "Caution"}</span>
      <h3>${esc(f.summary)}</h3>
      <span class="strip-cell" title="How long it has been open">${since}</span>
      ${f.subtle ? `<span class="strip-cell subtle" title="Nothing on the screens looks wrong, but what they show isn't right">Looks right, isn't</span>` : ""}
      <span class="strip-cell code mono" title="Its name in core/troubles.py">${esc(f.code || f.part)}</span>
    </header>
    <div class="strip-body">
      ${f.detail ? `<p class="means">${esc(f.detail)}</p>` : ""}
      ${f.causes?.length ? `<p class="causes">Usually because ${esc(f.causes.join("; or "))}.</p>` : ""}
      ${steps.length ? `<ol class="steps">${steps.map((s) => `<li>${md(s)}</li>`).join("")}</ol>` : ""}
      <div class="actions"></div>
    </div>`;
  const actions = el.querySelector(".actions");
  const cat = state.catalogue?.troubles?.[f.code];
  if (f.repair && !f.auto) {
    const b = button(`${state.catalogue?.repairs?.[f.repair]?.does || "Repair it"}`.replace(/^./, (c) => c.toUpperCase()), async () => {
      const got = await call("repair", { name: f.repair });
      if (got.request) return waitFor(got.request, b);
      toast(got.said); refresh();
    });
    actions.appendChild(b);
  } else if (f.repair && f.auto) {
    actions.insertAdjacentHTML("beforeend", `<span class="dim">CloudWall repairs this itself.</span>`);
  }
  for (const a of cat?.asks || []) actions.appendChild(askForm(f, a));
  actions.appendChild(button("Check again", runDoctor, "quiet"));
  return el;
}

function md(s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>"); }

function button(label, fn, kind) {
  const b = document.createElement("button");
  b.className = `btn ${kind || ""}`; b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { if (e.message !== "signed out") toast(e.message, true); } finally { b.disabled = false; }
  };
  return b;
}

function askForm(f, a) {
  const form = document.createElement("form");
  form.className = "ask";
  const id = `ask-${f.code}-${a.name}`.replace(/\W/g, "-");
  const input = a.kind === "yes" ? "" :
    `<input id="${id}" type="${a.kind === "secret" ? "password" : "text"}" placeholder="${esc(a.example || "")}" autocomplete="off" required>`;
  form.innerHTML = `<label for="${id}">${esc(a.question)}</label>${input}<button class="btn">${a.kind === "yes" ? "Yes, do it" : "Use this"}</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button"); btn.disabled = true;
    try {
      const got = await call("fix", { code: f.code, name: a.name, value: a.kind === "yes" ? "yes" : form.querySelector("input").value, summary: f.summary });
      if (got.request) return waitFor(got.request, btn);
      toast(got.said); offerRestart(); refresh();
    } catch (err) { if (err.message !== "signed out") toast(err.message, true); } finally { btn.disabled = false; }
  };
  return form;
}

async function waitFor(rid, btn) {
  toast("Asked the root helper…");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const got = await call(`requests/${rid}`);
    if (got.done) { toast(got.said, !got.ok); refresh(); return; }
  }
  toast("The root helper hasn't answered: is cloudwall-helper.path running? (sudo systemctl status cloudwall-helper.path)", true);
  if (btn) btn.disabled = false;
}

async function runDoctor() {
  toast("Checking the whole machine (it asks each feed, so it takes a few seconds)…");
  state.doctor = await call("doctor?fresh=1");
  state.overview = await call("overview");
  if (state.page === "overview" || state.page === "health") go();
  const bad = state.doctor.findings.filter((f) => f.state === "warn" || f.state === "fail").length;
  toast(bad ? `${bad} thing(s) found: they're set out on the Overview` : "Checked: all well");
}

async function refresh() { state.overview = await call("overview"); go(); }

function placeSheet(p) {
  const feeds = Object.entries(p.feeds || {});
  if (!feeds.length) {
    return `<h2>${esc(p.name)} <span class="dim">· ${esc(p.airport || "")}</span></h2><div class="sheet"><p>${p.status.ok
      ? `${p.aircraft} aircraft from ${esc(p.status.source || "simulated traffic")}, ${ago(p.status.updated)}.` : "No positions arriving."}
      ${p.watched ? "A screen is watching." : "No screen open."} ${p.today} flyover${p.today === 1 ? "" : "s"} today.</p></div>`;
  }
  return `<h2>${esc(p.name)} <span class="dim">· ${esc(p.airport || "")}</span></h2>
    <div class="sheet"><table>
      <tr><th>Feed</th><th>Answered</th><th class="num">Aircraft</th><th class="num">Moving</th><th class="num">Clock</th><th class="num">Behind</th></tr>
      ${feeds.map(([label, v]) => `<tr><td><span class="dot ${v.down_since ? "fail" : v.ok_at ? "ok" : ""}"></span>${esc(label)} <span class="dim mono">${esc(v.host || "")}</span></td>
        <td>${v.down_since ? `down since ${ago(v.down_since)}: ${esc(v.error)}` : ago(v.ok_at)}</td><td class="num">${v.count}</td><td class="num">${v.moving}</td>
        <td class="num">${v.skew_s == null ? "" : (v.skew_s > 0 ? "+" : "") + v.skew_s.toFixed(1) + " s"}</td><td class="num">${v.lag_s == null ? "" : v.lag_s.toFixed(1) + " s"}</td></tr>`).join("")
        || `<tr><td colspan="6" class="dim">${p.status.source ? esc(p.status.source) : "simulated"}: ${p.aircraft} aircraft</td></tr>`}
    </table>
    <p class="dim">${p.watched ? "A screen is watching." : "No screen open: free feeds are asked slowly or not at all."} ${p.today} flyover${p.today === 1 ? "" : "s"} today. ${p.restarts ? `Its threads restarted ${p.restarts} time(s) today.` : ""}</p></div>`;
}

function incidentTable(list) {
  if (!list?.length) return `<p class="dim">No problems recorded yet.</p>`;
  return `<div class="strips">${list.map((i) => `<div class="strip mini ${i.ended ? "ended" : i.state}">
    <span class="strip-state">${i.ended ? "Over" : i.major ? "Warning" : "Caution"}</span>
    <span class="strip-text">${esc(i.summary)}</span>
    <span class="strip-cell">${when(i.started)}</span>
    <span class="strip-cell">${i.ended ? lasted(i.ended - i.started) : "open"}</span></div>`).join("")}</div>`;
}

// -- settings -----------------------------------------------------------------------------------
async function drawSettings(main, page) {
  if (!state.settings) state.settings = await call("settings");
  const sections = state.settings.sections.filter((s) => s.page === page);
  if (!sections.length) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<h2>Settings</h2>`;
  for (const sec of sections) wrap.appendChild(sectionSheet(sec));
  main.appendChild(wrap);
}

function sectionSheet(sec) {
  const el = document.createElement("section");
  el.className = "sheet section";
  const plain = sec.settings.filter((s) => !s.advanced), more = sec.settings.filter((s) => s.advanced);
  el.innerHTML = `<h3>${esc(sec.label)}</h3><p class="about">${esc(sec.about)}</p>`;
  plain.forEach((s) => el.appendChild(settingRow(sec, s)));
  if (more.length) {
    const d = document.createElement("details");
    d.className = "more";
    d.innerHTML = `<summary>More settings (${more.length})</summary>`;
    more.forEach((s) => d.appendChild(settingRow(sec, s)));
    el.appendChild(d);
  }
  return el;
}

function settingRow(sec, s) {
  const row = document.createElement("div");
  row.className = "row";
  const id = `set-${sec.name}-${s.key}`;
  const running = state.settings.running?.[sec.name]?.[s.key];
  const pending = !s.secret && JSON.stringify(running) !== JSON.stringify(s.value);
  const helpText = `${s.help}${s.unit ? ` In ${s.unit}.` : ""}${s.range ? ` From ${s.range[0]} to ${s.range[1]}.` : ""}${!s.secret && s.default !== null && s.default !== undefined ? ` Default: ${fmt(s.default)}.` : ""}`;
  row.title = helpText;
  row.innerHTML = `
    <label class="name" for="${id}">${esc(s.label)}${s.changed && !s.secret ? `<span class="changed" title="Not the default (${esc(fmt(s.default))})">changed</span>` : ""}</label>
    <div class="ctl">${control(id, s)}${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ""}<button class="btn save" hidden>Save</button></div>
    <button class="q" type="button" aria-label="What is this?" aria-expanded="false">?</button>
    <p class="help">${esc(helpText)}${s.costs ? ` <span class="costs">Changing it: ${esc(s.costs)}.</span>` : ""} <span class="mono dim">[${esc(sec.name)}] ${esc(s.key)}</span></p>
    ${pending ? `<p class="running">Saved, not yet in use: CloudWall is running with ${esc(fmt(running))} until it restarts.</p>` : ""}`;
  const q = row.querySelector(".q");
  q.onclick = () => { row.classList.toggle("open"); q.setAttribute("aria-expanded", String(row.classList.contains("open"))); };
  const input = row.querySelector(`#${CSS.escape(id)}`), save = row.querySelector(".save");
  const value = () => input.type === "checkbox" ? input.checked : input.value;
  const changed = () => { save.hidden = false; };
  input.addEventListener("input", changed); input.addEventListener("change", changed);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.tagName !== "TEXTAREA") save.click(); });
  save.onclick = async () => {
    save.disabled = true;
    try {
      const got = await call("settings", { section: sec.name, key: s.key, value: value() });
      toast(got.said); save.hidden = true; state.settings = null; offerRestart();
      if (s.secret) input.value = "";
    } catch (e) { if (e.message !== "signed out") toast(e.message, true); } finally { save.disabled = false; }
  };
  return row;
}

function fmt(v) {
  if (v === "" || v === null || v === undefined) return "empty";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

function control(id, s) {
  const v = s.value;
  if (s.kind === "secret") return `<input id="${id}" type="password" placeholder="${v?.set ? "set (type to replace)" : "not set"}" autocomplete="new-password">`;
  if (s.kind === "bool") return `<input id="${id}" type="checkbox" ${v ? "checked" : ""}>`;
  if (s.kind === "choice") return `<select id="${id}">${s.choices.map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  if (s.kind === "list") return `<textarea id="${id}" spellcheck="false">${esc((v || []).join("\n"))}</textarea>`;
  if (s.kind === "number") return `<input id="${id}" type="number" step="any" value="${esc(v)}" ${s.range ? `min="${s.range[0]}" max="${s.range[1]}"` : ""}>`;
  return `<input id="${id}" type="text" value="${esc(v)}" placeholder="${esc(s.example || "")}" spellcheck="false">`;
}

function offerRestart() {
  $("restart-bar").hidden = false;
  $("restart-now").hidden = !state.overview?.under_systemd;          // by hand: it can't start itself again
  $("restart-bar").querySelector("span").textContent = state.overview?.under_systemd
    ? "Saved. The new settings take effect when CloudWall restarts."
    : "Saved. CloudWall is running by hand here: stop it and start it again for the new settings.";
}

// -- the pages with more than settings ---------------------------------------------------------------
async function drawPlaces(main) {
  const o = state.overview;
  main.innerHTML = `<h1>Places</h1><p class="lede">The house, and any other place watched (a cabin). Each keeps its own logbook.</p>
    <div class="sheet"><table><tr><th>Place</th><th>Airport</th><th class="num">Aircraft</th><th class="num">Today</th><th></th></tr>
    ${o.places.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.airport)}</td><td class="num">${p.aircraft}</td><td class="num">${p.today}</td>
      <td>${p.added ? `<button class="link" data-remove="${esc(p.id)}">Remove</button>` : `<span class="dim">from the settings file</span>`}</td></tr>`).join("")}</table>
    <form class="ask" id="add-place"><label for="new-place">Add a place: a US ZIP code, or latitude and longitude</label>
      <input id="new-place" type="text" placeholder="97702, or 44.06, -121.31" required><input id="new-name" type="text" placeholder="Name (Cabin)">
      <button class="btn">Add place</button></form></div>`;
  main.querySelector("#add-place").onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch("api/places", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: $("new-place").value, name: $("new-name").value }) });
    const got = await r.json();
    if (!r.ok) return toast(got.error, true);
    toast(`Added ${got.place.name}`); refresh();
  };
  main.querySelectorAll("[data-remove]").forEach((b) => b.onclick = async () => {
    if (!confirm("Remove this place? Its logbook stays on disk.")) return;
    const r = await fetch(`api/places?id=${encodeURIComponent(b.dataset.remove)}`, { method: "DELETE" });
    if (!r.ok) return toast((await r.json()).error, true);
    toast("Place removed"); refresh();
  });
}

async function drawPositions(main) {
  main.innerHTML = `<h1>Positions</h1><p class="lede">Where aircraft positions come from, and how each feed is answering right now.</p>${state.overview.places.map(placeSheet).join("")}`;
}

async function drawRoutes(main) {
  const p = state.overview.provider;
  main.innerHTML = `<h1>Routes</h1><p class="lede">Where a flight is going and coming from. Free from a database of flight numbers (sometimes stale); exact and live from a paid provider, spent only on airliners heading for the house.</p>
    ${p ? `<div class="sheet"><h3>${esc(p.label)}</h3><p>${p.used_today} ${esc(p.unit)} used today of an allowance of ${p.daily_limit ?? "no limit"}${p.period_budget ? `; ${p.period_used} of ${p.period_budget} this period, renewing ${esc(p.resets)}` : ""}.${p.problem ? ` <b>${esc(p.problem)}</b>` : ""}</p>
      ${p.period_budget ? `<meter min="0" max="${p.period_budget}" value="${p.period_used}" low="${p.period_budget * 0.7}" high="${p.period_budget * 0.9}" optimum="0"></meter>` : ""}</div>` : `<p class="dim">No paid provider: routes come from the free database. Add a key below to use one.</p>`}`;
}

async function drawAccess(main) {
  const o = state.overview, who = state.who;
  main.innerHTML = `<h1>Access</h1><p class="lede">Who can reach CloudWall, and who can change it.</p>
    <div class="sheet"><h3>Private link</h3>
      <p>${o.private_link ? "On: CloudWall answers only at its link, ending in the key." : "Off: anyone who can reach this machine on its port sees the board."}</p>
      <div class="actions"><span id="link-actions"></span></div></div>
    <div class="sheet"><h3>The owner</h3>
      <p>${who.owner_set ? "An owner password is set: changes need it." : "No owner password yet: changes can only be made from this machine. Set one so you can use this board from anywhere."}</p>
      <form class="ask" id="pw"><label for="pw1">${who.owner_set ? "Change" : "Set"} the owner's password (at least 10 characters)</label>
        <input id="pw1" type="password" autocomplete="new-password" required minlength="10"><input id="pw2" type="password" autocomplete="new-password" placeholder="Again" required minlength="10">
        <button class="btn">${who.owner_set ? "Change password" : "Set password"}</button></form></div>`;
  const acts = main.querySelector("#link-actions");
  acts.append(button("Show the link", async () => { const got = await call("private-link", { action: "show" });
    toast(got.key ? `${location.origin}/k/${got.key}/` : "No private link is set"); }, "quiet"));
  acts.append(button(o.private_link ? "Make a new link" : "Make a private link", async () => {
    if (o.private_link && !confirm("Every screen will need the new link. Make it?")) return;
    const got = await call("private-link", { action: "new" }); toast(got.said); offerRestart(); }));
  if (o.private_link) acts.append(button("Turn it off", async () => {
    if (!confirm("Anyone who can reach this machine will see the board. Turn the private link off?")) return;
    const got = await call("private-link", { action: "off" }); toast(got.said); offerRestart(); }, "quiet"));
  main.querySelector("#pw").onsubmit = async (e) => {
    e.preventDefault();
    if ($("pw1").value !== $("pw2").value) return toast("The two passwords don't match", true);
    try { const got = await call("password", { password: $("pw1").value }); toast(got.said); state.who = await call("whoami"); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
}

async function drawStorage(main) {
  const o = state.overview, b = await call("backups");
  main.innerHTML = `<h1>Storage and backups</h1><p class="lede">The logbooks, and copies of everything that can't be downloaded again.</p>
    <div class="sheet"><h3>On disk</h3><p>${o.storage.disk ? `${mb(o.storage.disk.free)} free of ${mb(o.storage.disk.total)}` : ""} in <span class="mono">${esc(o.storage.folder)}</span></p>
      <table><tr><th>File</th><th class="num">Size</th></tr>${Object.entries(o.storage.files).map(([n, s]) => `<tr><td class="mono">${esc(n)}</td><td class="num">${mb(s)}</td></tr>`).join("")}</table></div>
    <div class="sheet"><h3>Backups</h3><p class="dim">Settings and every logbook in one file; the last 7 are kept here. Download one now and then: a backup on the same disk doesn't survive the disk.</p>
      <div class="actions" id="backup-actions"></div>
      <table><tr><th>Backup</th><th>Made</th><th class="num">Size</th><th></th></tr>
      ${b.backups.map((x) => `<tr><td class="mono">${esc(x.name)}</td><td>${when(x.made)}</td><td class="num">${mb(x.size)}</td><td><a href="api/admin/backups/${encodeURIComponent(x.name)}" download>Download</a></td></tr>`).join("") || `<tr><td colspan="4" class="dim">None yet.</td></tr>`}</table>
      <p class="dim">To restore one: <code>sudo cloudwall restore &lt;file&gt; --yes</code> at the machine.</p></div>`;
  main.querySelector("#backup-actions").append(button("Back up now", async () => { const got = await call("backups", {}); toast(got.said); go(); }));
}

async function drawHealth(main) {
  const [inc, cat] = [await call("incidents"), state.catalogue || await call("catalogue")];
  state.catalogue = cat;
  const known = Object.entries(cat.troubles);
  main.innerHTML = `<h1>Health</h1><p class="lede">What CloudWall's check of itself has found, and every problem it knows how to recognise.</p>
    <div class="actions"><span id="doc-btn"></span></div>
    ${state.doctor ? `<h2>The machine, checked ${ago(state.doctor.checked)}</h2><div class="sheet"><table>${state.doctor.findings.map((f) => `<tr><td><span class="dot ${f.state}"></span>${esc(f.part)}</td><td>${esc(f.summary)}</td></tr>`).join("")}</table></div>` : ""}
    <h2>Every problem recorded</h2>${incidentTable(inc.incidents)}
    <h2>Problems CloudWall knows</h2>
    <input type="text" id="find" placeholder="Find a problem (receiver, disk, clock…)" class="find">
    <div id="known">${known.map(([code, t]) => `<details class="known" data-text="${esc((code + " " + t.title + " " + t.means).toLowerCase())}">
      <summary>${esc(t.title)}${t.major ? ` <span class="tag major">major</span>` : ""}${t.subtle ? ` <span class="tag subtle">looks right, isn't</span>` : ""}</summary>
      <p>${esc(t.means)}</p>${t.causes.length ? `<p class="causes">Usually because ${esc(t.causes.join("; or "))}.</p>` : ""}
      <ol class="steps">${t.steps.map((s) => `<li>${md(s)}</li>`).join("")}</ol><p class="dim mono">${esc(code)}</p></details>`).join("")}</div>`;
  main.querySelector("#doc-btn").append(button("Check the whole machine", runDoctor));
  main.querySelector("#find").oninput = (e) => { const q = e.target.value.toLowerCase();
    main.querySelectorAll(".known").forEach((d) => { d.hidden = q && !d.dataset.text.includes(q); }); };
}

async function drawSystem(main) {
  const o = state.overview;
  main.innerHTML = `<h1>System</h1><p class="lede">CloudWall itself: its version, how it runs, and the machine it runs on.</p>
    <div class="sheet"><table>
      <tr><th>Version</th><td>CloudWall ${esc(o.version)}</td></tr>
      <tr><th>Running</th><td>since ${when(o.started)} (${lasted(Date.now() / 1000 - o.started)}), ${o.under_systemd ? "as a service: it starts again by itself" : "by hand: it won't start again by itself"}</td></tr>
      <tr><th>Settings file</th><td class="mono">${esc(o.settings_file || "none: built-in defaults")}</td></tr>
      ${o.settings_problems.length ? `<tr><th>Left out</th><td>${o.settings_problems.map(esc).join("<br>")}</td></tr>` : ""}
      <tr><th>Root helper</th><td>${o.helper ? "installed: repairs that need root can be made from here" : "not installed (sudo cloudwall install sets it up)"}</td></tr>
      <tr><th>Set up here</th><td>${o.installs.map((i) => `${esc(i.kind)} service (${esc(i.user)})${i.active === false ? ", not running" : ""}`).join("; ") || "not as a service"}</td></tr>
    </table><div class="actions" id="sys-actions"></div></div>
    <p class="dim">At the machine: <code>cloudwall doctor</code> checks everything, <code>sudo cloudwall doctor --fix</code> goes through what it finds with you, <code>cloudwall report</code> makes a report to share.</p>`;
  const acts = main.querySelector("#sys-actions");
  acts.append(button("Restart CloudWall", restart, o.under_systemd ? "" : "quiet"));
}

async function restart() {
  if (!confirm("Restart CloudWall now? The screens reconnect by themselves in a few seconds.")) return;
  try { const got = await call("restart", {}); toast(got.said); } catch (e) { return toast(e.message, true); }
  $("restart-bar").hidden = true;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try { await call("whoami"); state.settings = null; toast("CloudWall is back"); return refresh(); } catch { /* still starting */ }
  }
  toast("CloudWall hasn't come back yet: `sudo systemctl status cloudwall` at the machine says why", true);
}

async function drawLog(main) {
  main.innerHTML = `<h1>Log</h1><p class="lede">The last few hundred lines, newest last. The full log: <code>journalctl -u cloudwall</code>.</p>
    <div class="actions"><select id="level"><option value="">Everything</option><option value="warning" selected>Warnings and errors</option><option value="error">Errors only</option></select></div>
    <div class="log" id="log" aria-live="polite"></div>`;
  const box = main.querySelector("#log");
  const load = async () => {
    const got = await call(`log?level=${$("level").value}`);
    box.innerHTML = got.lines.map((l) => `<div class="${esc(l.level)}">${new Date(l.t * 1000).toLocaleTimeString()} ${esc(l.name.replace("cloudwall", "").replace(/^\./, "") || "cloudwall")}: ${esc(l.text)}</div>`).join("") || `<div class="dim">Nothing at this level.</div>`;
    box.scrollTop = box.scrollHeight;
  };
  $("level").onchange = load;
  await load();
  clearInterval(drawLog.timer);
  drawLog.timer = setInterval(() => { if (state.page === "log") load(); else clearInterval(drawLog.timer); }, 5000);
}

// -- signing in -----------------------------------------------------------------------------------
function showSignIn(who) {
  $("nav").innerHTML = ""; $("signout").hidden = true; $("state").hidden = true;
  $("main").innerHTML = who.owner_set === false
    ? `<div class="signin sheet"><h1>The control board</h1><p>No owner password is set yet, so CloudWall can only be changed from the machine it runs on.</p>
       <p>At the machine, run <code>sudo cloudwall owner</code> to set one, then sign in here.</p><p class="dim">Or open this page in a browser on that machine.</p></div>`
    : `<form class="signin sheet" id="signin"><h1>The control board</h1><p class="dim">Sign in as CloudWall's owner.</p>
       <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required autofocus>
       <button class="btn">Sign in</button><p class="dim">Forgotten it? Set a new one at the machine: <code>sudo cloudwall owner</code>.</p></form>`;
  const f = $("signin");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { await call("signin", { password: $("password").value }); start(); }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
}

async function start() {
  try { state.who = await call("whoami"); } catch { return; }
  if (state.who.role !== "owner") return showSignIn(state.who);
  $("signout").hidden = !state.who.owner_set;
  try { state.catalogue = await call("catalogue"); } catch { /* the checklists go without their repair names */ }
  go();
  clearInterval(start.timer);
  start.timer = setInterval(async () => {          // the Overview keeps itself up to date
    if (state.page !== "overview" || document.hidden) return;
    try { state.overview = await call("overview"); paintTop(); nav(); go(); } catch { /* shown on the next action */ }
  }, 30000);
}

$("signout").onclick = async () => { await call("signout", {}); location.reload(); };
$("help-all").onchange = (e) => { document.body.classList.toggle("help-all", e.target.checked); try { localStorage.setItem("cloudwall.adminHelp", e.target.checked ? "1" : ""); } catch { /* fine */ } };
try { if (localStorage.getItem("cloudwall.adminHelp")) { $("help-all").checked = true; document.body.classList.add("help-all"); } } catch { /* fine */ }
$("restart-now").onclick = restart;
window.addEventListener("hashchange", go);
start();
