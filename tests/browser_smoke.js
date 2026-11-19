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

async function open(browser, size, path, errors, tamper) {
  const page = await (await browser.newContext(SIZES[size])).newPage();
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
    out.nearby = await count(page, "#mini-board .mb-row");
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
    const page = await open(browser, "desktop", "/", errors), out = {};
    const scope = () => page.evaluate(() => document.getElementById("scope").className);
    await page.click('#scope-seg button[data-mode="radar"]');
    await page.waitForFunction(() => !document.getElementById("scope").classList.contains("sky"));
    out.icons = await page.evaluate(() => [...document.querySelectorAll("#s-craft path.blip")].every((p) => (p.getAttribute("d") || "").length > 20));
    out.ranges = await count(page, "#range-seg button");
    await page.click('#style-seg button[data-style="atc"]');
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("atc"));
    out.atc = { scope: await scope(), status: await count(page, "#radar text.ssa tspan"), blocks: await count(page, "#s-craft .tag") };
    await page.click('#style-seg button[data-style="chart"]');
    await page.waitForFunction(() => !document.getElementById("scope").classList.contains("atc"));
    await page.click('#scope-seg button[data-mode="sky"]');
    await page.waitForFunction(() => document.getElementById("scope").classList.contains("sky"));
    out.sky = await count(page, "#radar .dome-bg");
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
    const page = await open(browser, "kiosk", "/kiosk", errors), out = {};
    out.layout = await page.evaluate(() => document.documentElement.className);
    out.card = await count(page, "#hero .k-card");
    out.onScope = await count(page, "#s-craft g.craft");
    out.tabsShown = await page.evaluate(() => getComputedStyle(document.querySelector("nav")).display !== "none");
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
    await page.waitForFunction(() => document.getElementById("h-pin") && !document.getElementById("h-pin").hidden, null, { timeout: 8000 });
    out.view = await page.evaluate(() => document.querySelector("nav button.active").dataset.view);
    await page.close();
    return out;
  },

  // nothing overhead: the quiet-sky slides, on the desktop and the wall panel
  async quiet(browser, errors) {
    const empty = (state) => { state.hero = null; state.overhead = null; state.pinned = null; };
    const out = {};
    for (const [size, path] of [["desktop", "/"], ["kiosk", "/kiosk"]]) {
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

  // the server stops answering: the page says so
  async offline(browser, errors) {
    const mine = [], page = await open(browser, "desktop", "/", mine), out = {};
    out.chipBefore = await page.evaluate(() => !document.getElementById("link").hidden);
    await page.route("**/api/**", (route) => route.abort());
    await page.waitForFunction(() => !document.getElementById("link").hidden, null, { timeout: 8000 });
    out.chipAfter = await text(page, "#link");
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
