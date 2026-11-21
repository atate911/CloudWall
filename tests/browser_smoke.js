// The page in a real browser, driven by tests/test_browser.py against a demo server:
//
//     node tests/browser_smoke.js http://127.0.0.1:5050
//
// Opens each layout (desktop, wall panel, phone), walks the tabs and the controls, forces the
// states that don't come up by themselves in a few seconds (a quiet sky, an emergency, the server
// gone), and prints what it found as JSON: for each scenario some facts about what was drawn, and
// `errors`, which should be empty: anything on the console, any request that failed, and any
// request to somewhere other than the server (the page should talk to nothing else).
//
// Needs Playwright (`npm install --no-save playwright && npx playwright install chromium`). The
// displays have no other tests, so this is what says a change to the page didn't break one.
const { chromium, devices } = require("playwright");

const BASE = process.argv[2];
const SIZES = { desktop: { viewport: { width: 1600, height: 950 } }, kiosk: { viewport: { width: 1024, height: 600 } },
  phone: { ...devices["iPhone 13"] } };

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
  await page.waitForSelector("#s-craft g.craft", { state: "attached", timeout: 15000 });      // the first aircraft is on the scope
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
    await page.click("#hero");
    await page.waitForFunction(() => !document.getElementById("h-pin") || document.getElementById("h-pin").hidden, null, { timeout: 8000 });
    out.released = true;
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
    await page.click('#scope-seg button[data-mode="radar"]');
    await page.waitForFunction(() => document.getElementById("radar").getAttribute("viewBox") === "-112 -112 224 224");
    out.backToRadar = true;
    const night = () => page.evaluate(() => document.body.classList.contains("night"));
    const before = await night(), seen = new Set([before]);
    for (let i = 0; i < 3; i++) { await page.click("#btn-night"); seen.add(await night()); }      // auto, on, off
    out.nightChanges = seen.size === 2;
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
    // simple, as it starts: the counts, the landing queue and the next aircraft over the house beside the radar
    let page = await open(browser, "kiosk", "/kiosk", errors);
    const out = {};
    out.layout = await page.evaluate(() => document.documentElement.className);
    out.scope = await page.evaluate(() => document.getElementById("scope").className);
    out.simple = await page.evaluate(() => document.body.classList.contains("d-simple"));
    out.side = await count(page, "#side .k-sit h1");
    out.onScope = await count(page, "#s-craft g.craft");
    out.tabsShown = await page.evaluate(() => getComputedStyle(document.querySelector("nav")).display !== "none");
    // the demo's fighters heard with no position are said, in the line at the top or worth a look,
    // whatever the side had to leave out to fit; and the side fits
    out.heardSaid = await page.evaluate(() => [...document.querySelectorAll("#side .k-sit .ph")].some((p) => !p.hidden && p.querySelector(".ci.heard"))
      || !!document.querySelector("#side .ss-note .n-row.heard"));
    out.sideFits = await page.evaluate(() => { const s = document.getElementById("side"); return s.scrollHeight <= s.clientHeight + 1; });
    await page.close();
    // detailed: the flight card, the landing queue under it, and the situation over the radar
    page = await open(browser, "kiosk", "/kiosk?density=detailed", errors);
    out.card = await count(page, "#hero .k-card");
    await page.waitForSelector("#hero .k-q .q-row", { timeout: 8000 }).catch(() => {});
    out.queue = await count(page, "#hero .k-q .q-row");
    out.strip = await page.evaluate(() => getComputedStyle(document.getElementById("strip")).display !== "none" && !!document.querySelector("#strip h1"));
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

  // a phone: the page stacked, the board as two lines a flight
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
        cities: [...document.querySelectorAll("#h-map .rm-place")].map((t) => t.textContent), credit: document.querySelector("#h-map .rm-credit").textContent };
    });
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
