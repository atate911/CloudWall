// The page in a real browser, driven by tests/test_browser.py against a demo server:
//     node tests/browser_smoke.js http://127.0.0.1:5050
// Prints JSON: per scenario, facts about what was drawn, and `errors` (should be empty): anything on
// the console, any request that failed, any request to somewhere other than the server.
const { chromium, devices } = require("playwright");

const BASE = process.argv[2];
const SIZES = { desktop: { viewport: { width: 1600, height: 950 } }, kiosk: { viewport: { width: 1024, height: 600 } }, panel: { viewport: { width: 1280, height: 400 }, hasTouch: true },
  wide: { viewport: { width: 2000, height: 730 } }, phone: { ...devices["iPhone 13"] } };

async function open(browser, size, path, errors, tamper, before) {
  const page = await (await browser.newContext(SIZES[size])).newPage();
  if (before) await before(page);
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  page.on("request", (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob|about):/.test(r.url())) errors.push(`left the machine: ${r.url()}`); });
  if (tamper) {       // the server's own answer, changed on its way to the page
    await page.route("**/api/state*", async (route) => {
      const answer = await route.fetch(), state = await answer.json();
      tamper(state);
      await route.fulfill({ response: answer, body: JSON.stringify(state) });
    });
  }
  await page.goto(BASE + path);
  // the first aircraft is on the scope, or (the wall panel showing its card alone) the card is drawn
  await page.waitForFunction(() => document.querySelector("#s-craft g.craft")
    || (document.body.classList.contains("card-only") && document.querySelector("#hero > .k-body > *, #hero.em-card")), null, { timeout: 15000 });
  return page;
}
// a stand-in map tile, so that the views drawn over real maps fetch nothing from the map provider
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhAGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fakeTiles = (seen) => (page) => page.route("**/tiles/**", (route) => { if (seen) seen.push(route.request().url()); return route.fulfill({ contentType: "image/png", body: PNG }); });
const count = (page, selector) => page.locator(selector).count();
const text = async (page, selector) => ((await count(page, selector)) ? (await page.locator(selector).first().textContent()).trim() : null);
const tab = async (page, name) => { await page.click(`nav button[data-view="${name}"]`); await page.waitForSelector(`#view-${name}.active`); };
// clicked in the page itself: the lists are redrawn with every update, and a row can be replaced mid-click
const clickFirst = (page, selector) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, selector);

const SCENARIOS = {
  // the desktop: the Overhead view, then each tab
  async desktop(browser, errors) {
    const page = await open(browser, "desktop", "/", errors), out = {};
    out.layout = await page.evaluate(() => document.documentElement.className);
    out.place = await text(page, "#station");
    await page.waitForFunction(() => document.getElementById("clock").textContent.trim(), null, { timeout: 5000 });   // it ticks once a second
    out.clock = await text(page, "#clock");
    out.card = await page.evaluate(() => document.getElementById("hero").className);
    out.onScope = await count(page, "#s-craft g.craft");
    out.nearby = await count(page, "#mini-board .tr[data-hex]");
    out.strip = await text(page, "#strip h1");
    out.groups = await count(page, "#mini-board .gh");
    out.profile = await count(page, "#mini-board svg.profile");
    out.phrases = await count(page, "#strip .pic .ph");
    // the demo's air ambulance: its cross on the radar, the hospital helipads, the one it's heading for named
    out.medical = await page.evaluate(() => ({
      badges: [...document.querySelectorAll("#s-craft g.craft .med")].filter((g) => g.style.display !== "none").length,
      helipads: document.querySelectorAll("#s-static .helipad").length,
      named: [...document.querySelectorAll("#s-static .helipad-label")].map((t) => t.textContent),
      listed: document.querySelectorAll("#mini-board .tr .ci.med").length,
    }));
    // the keyboard's place: a row of the list with the focus keeps it through the list's redraws
    out.focus = await page.evaluate(async () => {
      const row = document.querySelector("#mini-board .tr[data-hex]");
      if (!row) return null;
      row.focus();
      await new Promise((r) => setTimeout(r, 4500));         // two updates from the server
      const f = document.activeElement;
      return { same: !!f && f.matches(".tr") && f.dataset.hex === row.dataset.hex, redrawn: f !== row };
    });
    // the switch to Simple: the side panel in the card's place, numbers for the landing order on the radar
    await page.click('#dens-seg button[data-dens="simple"]');
    await page.waitForFunction(() => document.body.classList.contains("d-simple"));
    await page.waitForTimeout(2500);
    out.medicalNote = await page.evaluate(() => [...document.querySelectorAll("#side .ss-note .n-row")].filter((r) => r.querySelector(".ci.med")).map((r) => r.querySelector("b").textContent));
    out.simple = { side: await page.evaluate(() => getComputedStyle(document.getElementById("side")).display !== "none" || document.body.classList.contains("sky-quiet")),
      card: await page.evaluate(() => getComputedStyle(document.getElementById("hero")).display !== "none"),
      radar: await page.evaluate(() => document.getElementById("radar").classList.contains("simple")) };
    await page.click('#dens-seg button[data-dens="detailed"]');
    await tab(page, "board");
    await page.waitForSelector("table.board tbody tr[data-hex]");
    out.boardRows = await count(page, "table.board tbody tr[data-hex]");
    out.heardRows = await count(page, "table.board tbody.heard tr");
    await tab(page, "wx");
    await page.waitForSelector(".wx-head h1");
    out.weather = { headline: await text(page, ".wx-head h1"), charts: await count(page, ".hchart"), rose: await count(page, "#fig-wind svg.rose"),
      clouds: await count(page, "#fig-clouds svg"), forecast: await count(page, ".taf-list li"), panels: await count(page, ".wx-more h2"),
      restrictions: await count(page, ".tfr-item") };
    await tab(page, "log");
    await page.waitForSelector("#log .stats");
    out.logbook = { stats: await count(page, "#log .stat"), hours: await count(page, "#log .hours i") };
    await page.close();
    return out;
  },

  // following a flight from the board, and letting it go
  async follow(browser, errors) {
    const page = await open(browser, "desktop", "/", errors), out = {};
    await tab(page, "board");
    await page.waitForSelector("table.board tbody tr[data-hex]");
    out.picked = await page.evaluate(() => { const r = [...document.querySelectorAll("table.board tbody tr[data-hex]")].pop(); r.click(); return r.dataset.hex; });
    await page.waitForFunction(() => document.getElementById("h-pin") && !document.getElementById("h-pin").hidden, null, { timeout: 8000 });
    out.view = await page.evaluate(() => document.querySelector("nav button.active").dataset.view);
    out.followed = await page.evaluate(() => (document.querySelector("#s-craft g.craft.hero") || { dataset: {} }).dataset.hex);
    out.track = await count(page, "#s-trails .trk polyline, #s-trails .hist circle");
    // a tap on its drawing opens the panel about its type, and the flight stays followed
    await page.click("#h-sil .about-btn");
    await page.waitForSelector("#about[open] .ab-here p", { timeout: 8000 });
    out.about = await page.evaluate(() => ({ type: document.querySelector("#h-sil .about-btn").dataset.about, name: document.getElementById("ab-title").textContent.trim(),
      lines: document.querySelectorAll("#about .ab-here p").length, pinned: !document.getElementById("h-pin").hidden }));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("about").open, null, { timeout: 3000 });
    await page.click("#hero");
    await page.waitForFunction(() => !document.getElementById("h-pin") || document.getElementById("h-pin").hidden, null, { timeout: 8000 });
    out.released = true;
    await page.close();
    return out;
  },

  // the divider between the card and the radar: dragged, the card widens, the radar gives way and the
  // list beside it keeps its width; the card's width is remembered, and a double-click puts it back
  async cardDivider(browser, errors) {
    const page = await open(browser, "desktop", "/?density=detailed", errors), out = {};
    const widths = () => page.evaluate(() => Object.fromEntries(["hero", "scope", "mini-board"].map((id) => [id, Math.round(document.getElementById(id).getBoundingClientRect().width)])));
    const middle = async () => { const r = await page.locator("#card-split").boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    out.before = await widths();
    const m = await middle();
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m.x + 100, m.y, { steps: 5 });
    await page.mouse.up();
    out.after = await widths();
    await page.reload();
    await page.waitForSelector("#s-craft g.craft", { state: "attached", timeout: 15000 });
    out.reloaded = await widths();
    const m2 = await middle();
    await page.mouse.dblclick(m2.x, m2.y);
    await page.waitForTimeout(400);                       // the columns ease back
    out.reset = await widths();
    // dragged as far as it goes, it stops where the radar's row of buttons still fits
    const m3 = await middle();
    await page.mouse.move(m3.x, m3.y);
    await page.mouse.down();
    await page.mouse.move(m3.x + 900, m3.y, { steps: 8 });
    await page.mouse.up();
    out.toolsFit = await page.evaluate(() => {
      const scope = document.getElementById("scope").getBoundingClientRect();
      return [...document.querySelectorAll("#scope .scope-tools > *")].filter((e) => e.offsetWidth)
        .every((e) => e.getBoundingClientRect().right <= scope.right + 0.5 && e.getBoundingClientRect().left >= scope.left - 0.5);
    });
    await page.close();
    return out;
  },

  // the radar's switches, the night chart, and the place menu
  async controls(browser, errors) {
    const tiles = [], page = await open(browser, "desktop", "/", errors, null, fakeTiles(tiles)), out = {};
    const scope = () => page.evaluate(() => document.getElementById("scope").className);
    out.buttons = await page.evaluate(() => [...document.querySelectorAll("#scope-seg button")].map((b) => b.dataset.mode));
    await page.click('#scope-seg button[data-mode="radar"]');
    await page.waitForFunction(() => !document.getElementById("scope").classList.contains("map"));
    out.icons = await page.evaluate(() => [...document.querySelectorAll("#s-craft path.blip")].every((p) => (p.getAttribute("d") || "").length > 20));
    out.ranges = await count(page, "#range-seg button");
    await page.click('#style-seg button[data-style="atc"]');
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("atc"));
    out.atc = { scope: await scope(), status: await count(page, "#radar text.ssa tspan"), blocks: await count(page, "#s-craft .tag") };
    await page.click('#style-seg button[data-style="chart"]');
    await page.waitForFunction(() => !document.getElementById("scope").classList.contains("atc"));
    // the Map view: the flights on an everyday map, filling the panel, labelled in words
    await page.click('#scope-seg button[data-mode="map"]');
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("map"));
    await page.waitForSelector("#s-craft g.craft .tag", { state: "attached" });
    await page.waitForSelector("#s-base image", { state: "attached" });
    const mapFacts = () => page.evaluate(() => ({
      layers: [...new Set([...document.querySelectorAll("#s-base image")].map((i) => i.getAttribute("href").split("/")[1]))].sort(),
      names: [...document.querySelectorAll("#s-craft .tag")].map((t) => t.textContent).filter(Boolean),
      lines: [...document.querySelectorAll("#s-craft .tag-sub")].map((t) => t.textContent).filter(Boolean),
      box: document.getElementById("radar").getAttribute("viewBox"), home: document.querySelectorAll("#radar .map-home").length,
      note: (document.querySelector("#radar .map-note text") || {}).textContent || "" }));
    out.map = await mapFacts();
    await page.click('#mapstyle-seg button[data-map="streets"]');
    await page.waitForFunction(() => [...document.querySelectorAll("#s-base image")].some((i) => i.getAttribute("href").startsWith("tiles/streets/")));
    out.streets = (await mapFacts()).layers;
    // the Sky view: a dome of the sky above home, no map under it, the radar's options put away
    await page.click('#scope-seg button[data-mode="sky"]');
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("sky") && document.querySelector("#radar .ring.horizon"));
    out.sky = await page.evaluate(() => ({ box: document.getElementById("radar").getAttribute("viewBox"), tiles: document.querySelectorAll("#s-base image").length,
      tools: getComputedStyle(document.querySelector("#scope .scope-tools")).display, legend: (document.querySelector("#radar .legend") || {}).textContent || "" }));
    await page.click('#scope-seg button[data-mode="radar"]');
    await page.waitForFunction(() => document.getElementById("radar").getAttribute("viewBox") === "-112 -112 224 224");
    out.backToRadar = true;
    const night = () => page.evaluate(() => document.body.classList.contains("night"));
    const before = await night(), seen = new Set([before]);
    await page.click("#btn-settings");
    for (const m of ["on", "off", "auto"]) { await page.click(`#settings-menu [data-night="${m}"]`); seen.add(await night()); }
    out.nightChanges = seen.size === 2;
    out.nightPressed = await page.evaluate(() => [...document.querySelectorAll("#settings-menu [aria-pressed=true]")].map((b) => b.dataset.night || "sound-" + b.dataset.sound));
    await page.keyboard.press("Escape");
    out.settingsCloses = await page.evaluate(() => document.getElementById("settings-menu").hidden && document.activeElement.id === "btn-settings");
    await page.click("#station");
    out.places = await count(page, "#place-menu .pm-row");
    await page.click("#pm-add");
    await page.waitForSelector("#loc-dialog[open]");
    await page.fill("#loc-q", "98683");
    await page.waitForFunction(() => !document.getElementById("loc-save").disabled, null, { timeout: 8000 });
    out.located = { where: await text(page, "#loc-where"), airports: await count(page, "#loc-airports input") };
    await page.click("#loc-cancel");
    await page.close();
    return out;
  },

  // the wall panel
  async kiosk(browser, errors) {
    // the smallest lettering on the screen, as a share of its height: the page's own text (the map's
    // credit apart, and a landing number in its ring, which the radar repeats), and the radar's labels
    const smallest = (page) => page.evaluate(() => {
      const H = innerHeight, out = { html: 1, radar: 1, where: "" };
      for (const e of document.querySelectorAll("body *")) {
        if (e.closest("svg, .attrib, .seq") || !e.offsetParent) continue;
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const f = parseFloat(getComputedStyle(e).fontSize) / H;
        if (f < out.html) { out.html = f; out.where = `${e.className || e.tagName}: ${e.textContent.trim().slice(0, 30)}`; }
      }
      const svg = document.getElementById("radar"), k = Math.min(svg.clientWidth, svg.clientHeight) / 224;
      if (!k) return out;                             // the card alone: no radar
      for (const t of svg.querySelectorAll("#s-craft :is(.tag, .tag-sub), .compass, .apt-label")) {
        if (!t.textContent || t.style.display === "none" || getComputedStyle(t).display === "none") continue;
        out.radar = Math.min(out.radar, (parseFloat(getComputedStyle(t).fontSize) * k) / H);
      }
      return out;
    });
    // as it starts: the card across the whole screen and, under it, how many aircraft are about
    let page = await open(browser, "kiosk", "/kiosk", errors);
    const out = {};
    out.layout = await page.evaluate(() => document.documentElement.className);
    out.simple = await page.evaluate(() => document.body.classList.contains("d-simple"));
    out.card = await count(page, "#hero .k-card");
    out.scopeShown = await page.evaluate(() => getComputedStyle(document.getElementById("scope")).display !== "none");
    out.radarDrawn = await count(page, "#s-craft g.craft");                // not drawn while it's off
    out.tabsShown = await page.evaluate(() => getComputedStyle(document.querySelector("nav")).display !== "none");
    out.caption = await page.evaluate(() => [...document.querySelectorAll("#k-cap > *")].map((e) => e.textContent));
    out.smallest = await smallest(page);
    await page.close();
    // [kiosk] view = "radar", Detailed: the same card, the radar beside it with every aircraft labelled,
    // and the same floor
    page = await open(browser, "kiosk", "/kiosk?density=detailed&view=radar", errors);
    out.scope = await page.evaluate(() => document.getElementById("scope").className);
    out.onScope = await count(page, "#s-craft g.craft");
    out.detailedCard = await count(page, "#hero .k-card");
    out.queue = await count(page, "#hero .q-row");
    out.detailedSmallest = await smallest(page);
    // every label shown on the radar has been placed, and inside it (the wall panel's type is large)
    out.labelsInside = await page.evaluate(() => {
      const svg = document.getElementById("radar"), r = svg.getBoundingClientRect(), bad = [];
      for (const t of svg.querySelectorAll("#s-craft :is(.tag, .tag-sub)")) {
        if (t.style.display === "none" || !t.textContent) continue;
        const q = t.getBoundingClientRect();
        if (t.getAttribute("x") == null || q.left < r.left - 2 || q.right > r.right + 2 || q.top < r.top - 2 || q.bottom > r.bottom + 2) bad.push(t.textContent);
      }
      return bad;
    });
    await page.close();
    // an airliner with a route: its own side elevation rides the line between the airports
    page = await open(browser, "kiosk", "/kiosk", errors, (state) => {
      const a = state.aircraft.find((x) => x.route && x.route.plausible && x.known && !x.on_ground);
      if (a) { state.hero = a; state.emergency = []; }
    });
    out.routeCraft = await page.evaluate(() => {
      const line = document.querySelector("#hero .k-line"), c = line && line.querySelector(".k-craft svg");
      if (!c) return null;
      const l = line.getBoundingClientRect(), r = c.getBoundingClientRect();
      return { inside: r.left >= l.left - 1 && r.right <= l.right + 1, share: r.width / l.width };
    });
    await page.close();
    return out;
  },

  // the wall panel set to the Map view ([kiosk] view = "map")
  async kioskMap(browser, errors) {
    const page = await open(browser, "kiosk", "/kiosk", errors, (state) => { state.kiosk.view = "map"; }, fakeTiles()), out = {};
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("map"));
    out.onMap = await count(page, "#s-craft g.craft");
    await page.close();
    return out;
  },

  // the next few minutes, old data, an estimated position, and the wall panel's quiet hours
  async glance(browser, errors) {
    const out = {};
    // Detailed: the ten-minute axis beside the headline; Simple: the next three in words
    let page = await open(browser, "desktop", "/?density=detailed", errors);
    await page.waitForTimeout(1500);
    out.axis = await page.evaluate(() => ({ marks: document.querySelectorAll("#strip .tl.axis .tl-ev").length,
      inside: [...document.querySelectorAll("#strip .tl.axis .tl-ev")].every((e) => { const t = e.closest(".tl-track").getBoundingClientRect(), r = e.getBoundingClientRect(); return r.left >= t.left - 1 && r.left <= t.right + 1; }) }));
    await page.close();
    page = await open(browser, "desktop", "/?density=simple", errors);
    out.line = await page.evaluate(() => [...document.querySelectorAll("#strip .tl.line .tl-e")].map((e) => e.textContent.trim()));
    await page.close();
    page = await open(browser, "kiosk", "/kiosk", errors);
    out.kioskLine = await count(page, "#next-line .tl-e");
    await page.close();
    // the feed stalls: the server answers with the same positions, 25 s old and getting older; the
    // traffic fades, a note says how old, and the countdowns stop (each redraw agreeing)
    let frozen = null, frozenAt = 0;
    page = await open(browser, "desktop", "/", errors, (state) => {
      if (!frozen) { frozen = JSON.stringify(Object.assign(state, { status: { ...state.status, updated: state.now - 25 } })); frozenAt = Date.now(); }
      const again = JSON.parse(frozen);
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, again, { now: again.now + (Date.now() - frozenAt) / 1000 });
    });
    await page.waitForTimeout(1200);
    out.old = await page.evaluate(async () => {
      const t = document.querySelector("#mini-board [data-until]"), was = t && t.textContent;
      await new Promise((r) => setTimeout(r, 4300));         // two more answers from the server
      return { stale: document.body.classList.contains("stale"), note: document.getElementById("link").textContent,
        stopped: !t || t.textContent === was };
    });
    await page.close();
    // a followed flight the feed left out for a moment: faded on the radar, "position estimated" on its card
    page = await open(browser, "desktop", "/", errors, (state) => { if (state.hero) state.hero.coasting = state.now - 12; const a = state.hero && state.aircraft.find((x) => x.hex === state.hero.hex); if (a) a.coasting = state.now - 12; });
    await page.waitForTimeout(1200);
    out.estimated = await page.evaluate(() => ({ chip: document.getElementById("h-est") && !document.getElementById("h-est").hidden ? document.getElementById("h-est").textContent : "",
      faded: !!document.querySelector("#s-craft g.craft.hero.coasting") }));
    await page.close();
    // quiet hours with nothing near: the dim clock; a tap wakes it
    page = await open(browser, "kiosk", "/kiosk?quiet=00:00-23:59", errors, (state) => {
      state.aircraft = state.aircraft.filter((a) => a.dist > 3 && !(a.cpa_s > 0 && a.cpa_s < 90 && a.cpa_nm <= state.tracking.overhead_nm)); });
    await page.waitForTimeout(1500);
    out.hushed = await page.evaluate(() => document.body.classList.contains("hush"));
    await page.mouse.click(500, 300);
    await page.waitForTimeout(500);
    out.woken = await page.evaluate(() => !document.body.classList.contains("hush"));
    await page.close();
    return out;
  },

  // a wide, short window: the card's parts never run into each other or out of it, the radar's
  // column is as wide as its disc, and Simple puts what's worth a look in a third column
  async wide(browser, errors) {
    const out = {};
    let page = await open(browser, "wide", "/?density=detailed", errors);
    await page.evaluate(() => { const r = document.querySelector("#mini-board .tr[data-hex]"); if (r) r.click(); });   // a flight with a route
    await page.waitForTimeout(2500);
    out.card = await page.evaluate(() => {
      const card = document.getElementById("hero").getBoundingClientRect(), parts = [...document.querySelectorAll("#hero > *")].filter((e) => e.offsetHeight);
      const overlaps = [];
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i - 1].getBoundingClientRect(), b = parts[i].getBoundingClientRect();
        if (a.bottom > b.top + 1) overlaps.push(`${parts[i - 1].className} over ${parts[i].className}`);
      }
      const last = parts[parts.length - 1].getBoundingClientRect(), pad = parseFloat(getComputedStyle(document.getElementById("hero")).paddingBottom);
      // and no empty band at its foot: the last part reaches the card's padding
      return { overlaps, inside: last.bottom <= card.bottom + 1, slack: Math.round(card.bottom - pad - last.bottom) };
    });
    out.radar = await page.evaluate(() => { const s = document.getElementById("scope"), r = document.getElementById("radar");
      const pad = parseFloat(getComputedStyle(s).paddingTop) + parseFloat(getComputedStyle(s).paddingBottom);
      return Math.round(s.clientWidth - (s.clientHeight - pad)); });          // spare width beside the disc, px
    await page.close();
    page = await open(browser, "wide", "/?density=simple", errors);
    await page.waitForTimeout(1500);
    out.simple = await page.evaluate(() => { const n = document.getElementById("notes"), s = document.getElementById("scope");
      return { notes: n.offsetWidth > 0 && n.getBoundingClientRect().left > s.getBoundingClientRect().right, rows: n.querySelectorAll(".n-row").length }; });
    await page.close();
    return out;
  },

  // a phone: the page stacked, the board as two lines a flight
  // the Sky view on a phone, turned by its compass: the way it faces at the top
  async compass(browser, errors) {
    const page = await open(browser, "phone", "/", errors, null, (p) => p.addInitScript(() => localStorage.setItem("cloudwall.scope", "sky"))), out = {};
    await page.context().grantPermissions(["accelerometer", "gyroscope", "magnetometer"]);
    await page.$eval("#scope", (e) => e.scrollIntoView());
    await page.waitForSelector("#radar .ring.horizon", { state: "attached" });
    out.before = await page.evaluate(() => document.querySelector("#radar .legend").textContent);
    await page.tap("#btn-compass");
    await page.waitForFunction(() => document.getElementById("btn-compass").getAttribute("aria-pressed") === "true");
    // the phone flat, its top toward the east-northeast (Android's reading: alpha counts anticlockwise)
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: 300, beta: 5, gamma: 0, absolute: true })));
      await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => /Facing/.test(document.querySelector("#radar .legend").textContent));
    out.after = await page.evaluate(() => document.querySelector("#radar .legend tspan").textContent);
    // north, picked out, sits 60° anticlockwise from the top
    out.north = await page.evaluate(() => { const n = document.querySelector("#radar .compass.north"); return Math.round(Math.atan2(+n.getAttribute("x"), -(+n.getAttribute("y") - 2)) * 180 / Math.PI); });
    await page.tap("#btn-compass");
    await page.waitForFunction(() => !/Facing/.test(document.querySelector("#radar .legend").textContent));
    out.off = true;
    return out;
  },

  async phone(browser, errors) {
    const page = await open(browser, "phone", "/", errors), out = {};
    out.layout = await page.evaluate(() => document.documentElement.className);
    await tab(page, "board");
    await page.waitForSelector(".pboard .pb-row[data-hex]");
    out.boardRows = await count(page, ".pboard .pb-row[data-hex]");
    await clickFirst(page, ".pboard .pb-row[data-hex]");
    // a phone starts simple: the side panel above the radar takes the flight that was tapped
    await page.waitForFunction(() => /Selected/.test((document.querySelector("#side .so-head") || {}).textContent || ""), null, { timeout: 8000 });
    out.view = await page.evaluate(() => document.querySelector("nav button.active").dataset.view);
    out.queue = await count(page, "#side .q-row, #side .ss-over");
    await page.close();
    return out;
  },

  // nothing overhead: the quiet-sky slides, on the desktop and the wall panel
  async quiet(browser, errors) {
    const empty = (state) => { state.hero = null; state.overhead = null; state.pinned = null; };
    const out = {};
    for (const [size, path] of [["desktop", "/?density=detailed"], ["kiosk", "/kiosk?density=detailed"]]) {
      const page = await open(browser, size, path, errors, empty), seen = new Set();
      await page.waitForTimeout(2500);                  // the weather and the logbook arrive
      for (let i = 0; i < 10; i++) {
        seen.add(await page.evaluate(() => { const h = document.getElementById("hero"), t = h.querySelector("h1, .k-kicker, .k-big, .label");
          return ((t && t.textContent) || h.className).trim().slice(0, 24); }));
        await page.click("#hero");                       // a tap skips to the next slide
        await page.waitForTimeout(350);
      }
      out[size] = [...seen];
      await page.close();
    }
    // the wall panel's card alone: the radar is one of the slides, beside the slide that says what is on
    // it, and is drawn then and only then
    const page = await open(browser, "kiosk", "/kiosk", errors, empty);
    await page.waitForTimeout(1500);
    out.radarSlide = { seen: false, drawn: 0, hiddenAfter: null };
    for (let i = 0; i < 10 && !out.radarSlide.seen; i++) {
      if (await page.evaluate(() => document.body.classList.contains("radar-slide"))) {
        await page.waitForTimeout(400);
        out.radarSlide = { seen: true, shown: await page.evaluate(() => getComputedStyle(document.getElementById("scope")).display !== "none"),
          drawn: await count(page, "#s-craft g.craft"), words: await page.evaluate(() => (document.querySelector("#hero .k-onradar h1") || {}).textContent || "") };
        await page.click("#hero"); await page.waitForTimeout(400);
        out.radarSlide.hiddenAfter = await page.evaluate(() => getComputedStyle(document.getElementById("scope")).display === "none");
        break;
      }
      await page.click("#hero"); await page.waitForTimeout(350);
    }
    await page.close();
    // the side view along the runways is a slide too, on a touchscreen panel much wider than tall: a
    // tap on an aircraft in it brings up that aircraft's card
    // (the sky kept quiet until the panel follows a flight: then the server's answer is left as it is)
    const panel = await open(browser, "panel", "/kiosk", errors, (state) => { if (!state.pinned) empty(state); });
    await panel.waitForTimeout(1500);
    out.sideSlide = { seen: false };
    for (let i = 0; i < 10 && !out.sideSlide.seen; i++) {
      if (await count(panel, "#hero .k-side svg.profile")) {
        const tap = await panel.evaluate(() => { const e = document.querySelector("#hero .k-side .pf-craft .pf-hit"); if (!e) return null;
          const r = e.getBoundingClientRect(); return { hex: e.parentNode.dataset.hex, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        out.sideSlide = { seen: true, craft: !!tap, fits: await panel.evaluate(() => { const h = document.getElementById("hero"); return h.scrollHeight <= h.clientHeight + 1; }) };
        if (tap) {
          await panel.touchscreen.tap(tap.x, tap.y);
          await panel.waitForSelector("#hero .k-plane", { timeout: 8000 }).catch(() => {});
          out.sideSlide.tapped = await panel.evaluate((hex) => sessionStorage.getItem("cloudwall.pin") === hex && !!document.querySelector("#hero .k-plane"), tap.hex);
        }
        break;
      }
      await panel.click("#hero"); await panel.waitForTimeout(350);
    }
    await panel.close();
    return out;
  },

  // an emergency squawk takes the screen over, and can be put away on the desktop
  async emergency(browser, errors) {
    const squawk = (state) => {
      const a = state.aircraft.find((x) => !x.on_ground);
      if (!a) return;
      Object.assign(a, { squawk: "7700", spc: "7700", emergency: "EMERGENCY 7700", emergency_code: "7700", emergency_title: "Emergency",
        emergency_meaning: "The crew has declared an emergency.", emergency_since: state.now - 75 });
      state.emergency = [a];
    };
    const page = await open(browser, "desktop", "/?radar=atc", errors, squawk), out = {};
    await page.waitForSelector("#hero .em-title");
    out.red = await page.evaluate(() => document.body.classList.contains("emergency"));
    out.title = await text(page, "#hero .em-title");
    out.chip = await text(page, "#em-chip");
    out.onRadar = await page.evaluate(() => [...document.querySelectorAll("#s-craft .tag-top")].map((t) => t.textContent).filter(Boolean));
    await page.click("#em-hide");
    await page.waitForFunction(() => !document.body.classList.contains("emergency"));
    out.hidden = true;
    await page.close();
    return out;
  },

  // the flight card's route on a real map: switched on, with a flight across the Pacific (over the
  // date line) and stand-in tiles, so that nothing is fetched from the map provider
  async routeMap(browser, errors) {
    const tiles = [];
    const pacific = (state) => {
      state.charts.layers.world = { enabled: true, style: "satellite", attribution: "Test imagery", zooms: [0, 6], layer: "world" };
      const a = state.hero || state.aircraft.find((x) => !x.on_ground) || state.aircraft[0];
      Object.assign(a, { local: null, local_inferred: false, route_pending: false, route: { flight: "NH6", airline: "ANA", plausible: true, progress: 0.9,
        origin: { iata: "HND", city: "Tokyo", lat: 35.55, lon: 139.78 }, dest: { iata: "PDX", city: "Portland", lat: 45.59, lon: -122.6 },
        flown_nm: 3900, left_nm: 430 } });
      state.hero = a;
    };
    const page = await open(browser, "desktop", "/", errors, pacific, fakeTiles(tiles)), out = {};
    await page.waitForSelector("#h-map svg.rm .rm-border", { state: "attached" });      // once the borders and cities are in
    out.tiles = tiles.length;
    out.zooms = [...new Set(tiles.map((u) => +u.split("/tiles/world/")[1].split("/")[0]))];
    out.drawn = await page.evaluate(() => {
      const box = document.getElementById("h-map").getBoundingClientRect(), dot = document.querySelector("#h-map .rm-craft").getBoundingClientRect();
      const len = (s) => (document.querySelector(s).getAttribute("d") || "").split("L").length;
      return { height: Math.round(box.height), done: len("#h-map .rm-done"), todo: len("#h-map .rm-todo"),
        craftInside: dot.left >= box.left && dot.right <= box.right && dot.top >= box.top && dot.bottom <= box.bottom,
        codes: [...document.querySelectorAll("#h-map .rm-code")].map((t) => t.textContent),
        borders: (document.querySelector("#h-map .rm-border").getAttribute("d") || "").split("M").length - 1,
        cities: [...document.querySelectorAll("#h-map .rm-place")].map((t) => t.textContent), credit: document.querySelector("#h-map .rm-credit").textContent,
        regions: [...document.querySelectorAll("#h-map .rm-region")].map((t) => t.textContent), scale: document.querySelector("#h-map .rm-scale").textContent,
        // the arrowhead sits at the destination's end of the line, the aircraft's marker is turned along it
        arrowAt: (() => { const a = document.querySelector("#h-map .rm-arrow").getBoundingClientRect(), to = document.querySelector("#h-map .rm-apt.to").getBoundingClientRect(), from = document.querySelector("#h-map .rm-apt.from").getBoundingClientRect();
          const far = (r) => Math.hypot(a.left + a.width / 2 - (r.left + r.width / 2), a.top + a.height / 2 - (r.top + r.height / 2)); return far(to) < 20 && far(from) > 60; })(),
        turned: /rotate\(/.test(document.querySelector("#h-map .rm-craft").getAttribute("transform") || "") };
    });
    await page.close();
    return out;
  },

  // the flight card's head, its airports and its switch
  async cardHead(browser, errors) {
    const apt = (iata, lat, lon) => ({ iata, city: iata, lat, lon });
    const PDX = apt("PDX", 45.59, -122.6), JFK = apt("JFK", 40.64, -73.78);
    const pin = (origin, dest, more) => (state) => {
      state.charts.layers.world = { enabled: true, style: "satellite", attribution: "Test imagery", zooms: [0, 6], layer: "world" };
      state.emergency = [];
      const a = state.hero || state.aircraft.find((x) => !x.on_ground) || state.aircraft[0];
      // the same card whichever of the demo's aircraft is overhead: its words, facts and badges fixed
      Object.assign(a, { local: null, local_inferred: false, route_pending: false, medical: false, hospital: null, type: "B738", type_name: "Boeing 737-800",
        flight_no: "DL178", callsign: "DAL178", reg: "N3765", operated_by: null, badges: [], airline: "Delta Air Lines", airline_iata: "DL", owner: null,
        seats: null, modes: [], contrail: null, year: 2014, age: 12, photo: null, coasting: null, gs: 300, dist: 5, cpa_s: 100, cpa_nm: 1,
        route: { flight: "DL178", airline: "Delta", plausible: true, progress: 0.4, origin, dest, flown_nm: 300, left_nm: 400 } }, more);
      state.hero = a;
    };
    const read = (page) => page.evaluate(() => {
      const el = document.getElementById("hero"), shown = (q) => { const e = el.querySelector(q); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 2; };
      const apts = [...el.querySelectorAll(".route .apt")].map((e) => ({ x: e.querySelector(".flaps").getBoundingClientRect().left, words: e.querySelector("small").textContent.trim() })).sort((a, b) => a.x - b.x);
      return { head: el.querySelector("#h-type").textContent.replace("›", "").trim(), about: (el.querySelector("#h-type [data-about]") || { dataset: {} }).dataset.about || null,
        flight: shown("#h-flight") ? el.querySelector("#h-flight").dataset.text : null, sub: el.querySelector("#h-sub").textContent.trim(),
        facts: [...el.querySelectorAll("#h-facts dt")].map((d) => d.textContent), airports: apts.map((p) => p.words), rev: !!el.querySelector(".route.rev"),
        // the aircraft riding the line between the airports: drawn, and which way it faces (-1: turned to fly leftwards)
        rider: (() => { const r = el.querySelector(".prog .rider"); if (!r || !r.querySelector("svg")) return 0; const m = new DOMMatrix(getComputedStyle(r).transform); return m.a < 0 ? -1 : 1; })(),
        logoRight: (() => { const l = el.querySelector("#h-logo"), h = el.querySelector("#h-type"); return l.hidden ? null : l.getBoundingClientRect().left > h.getBoundingClientRect().left + 40; })(),
        map: shown(".rmap"), drawing: shown("#h-media"), toggle: shown("#h-pic"), on: (el.querySelector("#h-pic .on") || { dataset: {} }).dataset.pic || null, overflow: el.scrollHeight - el.clientHeight };
    });
    const out = {};
    const cases = [["east", "desktop", PDX, JFK, {}], ["west", "desktop", JFK, PDX, { callsign: "DAL21K" }],
      ["private", "desktop", PDX, JFK, { flight_no: null, callsign: "N3765" }], ["untyped", "desktop", PDX, JFK, { type: null, type_name: null }]];
    for (const [name, size, o, d, more] of cases) {
      const page = await open(browser, size, "/?density=detailed", errors, pin(o, d, more), fakeTiles());
      await page.waitForSelector("#h-map svg.rm", { state: "attached" });
      await page.waitForTimeout(500);
      out[name] = await read(page);
      await page.close();
    }
    // a card with room for one picture: the map as it comes, the drawing in its place, and back. How
    // short a window leaves room for only one depends on the browser and its fonts, so the window
    // is made shorter step by step until the card gives a picture up and shows its switch
    const page = await open(browser, "desktop", "/?density=detailed", errors, pin(PDX, JFK, {}), fakeTiles());
    await page.waitForSelector("#h-map svg.rm", { state: "attached" });
    out.switchAt = null;
    for (let h = 950; h >= 420 && !out.switchAt; h -= 25) {
      await page.setViewportSize({ width: 1600, height: h });
      await page.waitForTimeout(300);
      if (await page.locator("#h-pic").isVisible()) out.switchAt = h;
    }
    if (out.switchAt) {
      await page.waitForTimeout(500);
      out.one = await read(page);
      await page.click("#h-pic [data-pic=plate]");
      await page.waitForTimeout(1500);                    // through an update of the card: it stays as set
      out.drawing = await read(page);
      await page.click("#h-pic [data-pic=map]");
      await page.waitForTimeout(300);
      out.back = await read(page);
    }
    // the panel opened from the headline, with what it says of this aircraft and of its type apart
    await page.click("#h-type [data-about]");
    await page.waitForSelector("#about[open] .ab-here p", { timeout: 8000 });
    out.panel = await page.evaluate(() => ({ title: document.getElementById("ab-title").textContent.trim(),
      heads: [...document.querySelectorAll("#about .ab-here h3")].map((h) => h.textContent), lines: document.querySelectorAll("#about .ab-here p").length }));
    await page.close();
    return out;
  },

  // the route map's shape follows the route's; no place's name runs into another, an airport's code, or off the map
  async routeShape(browser, errors) {
    const apt = (iata, lat, lon) => ({ iata, city: iata, lat, lon });
    const SEA = apt("SEA", 47.45, -122.31), LAX = apt("LAX", 33.94, -118.41), PDX = apt("PDX", 45.59, -122.6), JFK = apt("JFK", 40.64, -73.78), DEN = apt("DEN", 39.86, -104.67);
    const BOI = apt("BOI", 43.56, -116.22);
    const pin = (origin, dest) => (state) => {
      state.charts.layers.world = { enabled: true, style: "satellite", attribution: "Test imagery", zooms: [0, 6], layer: "world" };
      state.emergency = [];
      const a = state.hero || state.aircraft.find((x) => !x.on_ground) || state.aircraft[0];
      Object.assign(a, { local: null, local_inferred: false, route_pending: false, medical: false, hospital: null,
        route: { flight: "XX1", airline: "Test", plausible: true, progress: 0.4, origin, dest, flown_nm: 300, left_nm: 400 } });
      state.hero = a;
    };
    const out = {};
    for (const [name, size, o, d] of [["north", "desktop", SEA, LAX], ["east", "desktop", PDX, JFK], ["phoneNorth", "phone", SEA, LAX], ["phoneEast", "phone", DEN, PDX], ["boise", "desktop", BOI, PDX]]) {
      const page = await open(browser, size, "/?density=detailed", errors, pin(o, d), fakeTiles());
      await page.waitForSelector("#h-map svg.rm .rm-border", { state: "attached" });
      await page.waitForTimeout(600);
      out[name] = await page.evaluate(() => {
        const m = document.getElementById("h-map"), box = m.getBoundingClientRect(), path = m.querySelector(".rm-todo").getBoundingClientRect();
        const labels = [...m.querySelectorAll(".rm-place, .rm-code")].map((t) => t.getBoundingClientRect());
        let clash = 0, outside = 0;
        labels.forEach((a, i) => {
          if (a.left < box.left - 1 || a.right > box.right + 1 || a.top < box.top - 1 || a.bottom > box.bottom + 1) outside++;
          for (const b of labels.slice(i + 1)) if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) clash++;
        });
        return { beside: document.getElementById("hero").classList.contains("map-beside"), w: Math.round(box.width), h: Math.round(box.height),
          fillW: +(path.width / box.width).toFixed(2), fillH: +(path.height / box.height).toFixed(2), places: labels.length - 2, clash, outside,
          names: [...m.querySelectorAll(".rm-place")].map((t) => t.textContent), regions: [...m.querySelectorAll(".rm-region")].map((t) => t.textContent) };
      });
      await page.close();
    }
    return out;
  },

  // the control board (/admin)
  async admin(browser, errors) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), out = {};
    // the map pictures' tiles are answered here, not fetched (the tests use no network): the house's map
    // draws its plain chart instead, as it does wherever tiles can't be had
    await page.route("**/tiles/**", (r) => r.fulfill({ status: 404, body: "" }));
    page.on("console", (m) => { if (m.type() === "error" && !/\/tiles\//.test(m.location().url || "")) errors.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    page.on("request", (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob|about):/.test(r.url())) errors.push(`left the machine: ${r.url()}`); });
    await page.goto(BASE + "/admin");
    await page.waitForSelector(".system .node[data-node]");
    out.nodes = await page.$$eval(".system .node", (n) => n.length);
    out.rail = await page.$$eval("#nav a", (a) => a.map((x) => x.getAttribute("href").slice(1)));
    out.railMarked = await page.$$eval("#nav a.warn, #nav a.fail", (a) => a.map((x) => x.getAttribute("href").slice(1)));
    out.troubles = await page.$$eval(".needs .trouble", (t) => t.length);
    out.pages = {};
    for (const p of ["receiver", "positions", "places", "routes", "look", "access", "safekeeping", "health", "settings", "server"]) {
      await page.evaluate((h) => { location.hash = h; }, p);
      await page.waitForSelector(`.page-${p} h1`, { timeout: 8000 });
      out.pages[p] = await page.$$eval(`.page-${p} [data-setting], .page-${p} [data-row]`, (r) => r.length);
    }
    // the tracking radius, by its ring on the map: the handle takes the arrow keys
    await page.evaluate(() => { location.hash = "places"; });
    await page.waitForSelector(".page-places .ring.track .ring-handle");
    out.radiusBefore = await page.$eval('[data-setting="tracking.radius_nm"] input', (i) => i.value);
    await page.focus(".ring.track .ring-handle");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => !document.getElementById("dock").hidden, null, { timeout: 8000 });
    out.radiusAfter = await page.$eval('[data-setting="tracking.radius_nm"] input', (i) => i.value);
    out.dock = await page.$eval("#dock-text", (d) => d.textContent);
    // the finder: a word, Enter, and the setting is shown on its page
    await page.fill(".finder input", "quiet hours");
    await page.keyboard.press("Enter");
    await page.waitForSelector('.page-look [data-setting="kiosk.quiet"].found', { timeout: 8000 });
    out.found = await page.evaluate(() => location.hash);
    // all settings: every line, the setup in words, the stray line moved, the dock's list and Undo
    const r = out.review = {};
    await page.evaluate(() => { location.hash = "settings"; });
    await page.waitForSelector(".page-settings .row");
    r.rows = await page.$$eval(".page-settings .row", (l) => l.length);
    r.said = await page.$eval(".setup-said", (s) => s.textContent.replace(/\s+/g, " "));
    r.strays = await page.$$eval(".strays li code", (l) => l.map((c) => c.textContent.replace(/ =.*/, "")));
    await page.click('.strays button[data-act="move"]');
    await page.waitForFunction(() => !document.querySelector(".strays"), null, { timeout: 8000 });
    r.straysAfter = await page.$$eval(".strays li", (l) => l.length);
    await page.click("#dock-text");
    await page.waitForSelector("#dock-list:not([hidden]) li");
    r.dock = await page.$$eval("#dock-list li", (l) => l.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    await page.click('#dock-list [data-undo="0"]');
    await page.waitForFunction(() => document.querySelectorAll("#dock-list li").length === 1, null, { timeout: 8000 });
    r.dockAfterUndo = await page.$$eval("#dock-list li", (l) => l.length);
    await page.click(".explain-toggle");
    r.explained = await page.evaluate(() => [...document.querySelectorAll(".page-settings .row-key")].every((k) => getComputedStyle(k).display !== "none"));
    await page.close();
    return out;
  },

  // the server stops answering: the page says so
  async offline(browser, errors) {
    const mine = [], page = await open(browser, "desktop", "/", mine), out = {};
    out.chipBefore = await page.evaluate(() => !document.getElementById("link").hidden);
    await page.route("**/api/**", (route) => route.abort());
    await page.waitForFunction(() => !document.getElementById("link").hidden, null, { timeout: 8000 });
    out.chipAfter = await text(page, "#link");
    // and goes on saying so: the once-a-second tick mustn't take the chip away between requests
    out.chipStays = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        if (document.getElementById("link").hidden) return false;
        await new Promise((r) => setTimeout(r, 50));
      }
      return true;
    });
    await page.close();
    // requests that fail are the point of this one: only anything else counts against it
    errors.push(...mine.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)));
    return out;
  },
};

(async () => {
  const browser = await chromium.launch(), report = {};
  await Promise.all(Object.entries(SCENARIOS).map(async ([name, run]) => {
    const errors = [];
    try {
      report[name] = { ...(await run(browser, errors)), errors };
    } catch (e) {
      report[name] = { errors: [...errors, `the scenario stopped: ${String(e && e.message || e).split("\n")[0]}`] };
    }
  }));
  await browser.close();
  console.log(JSON.stringify(report));
})().catch((e) => { console.error(e); process.exit(1); });
