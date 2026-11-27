// Route lookups: where each flight is going and coming from. With a paid provider, the page is its
// allowance, drawn as a fuel gauge (used, left, the reserve held back, where this pace ends the
// month) and each day's use against the day's even share; without one, the choice of provider.
// The plan's figures sit under the picture; what's touched once a year waits under a shade.
import { el, esc, S, setting, value, num, plural, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { fuel, burn } from "../draw.js";
import { head, pageTroubles, reading } from "../parts.js";
import { secret, cards, toggle, stepper, slider, group, custom, advanced } from "../controls.js";

const PROVIDERS = {
  flightradar24: { label: "Flightradar24", allowance: "monthly_credits", unit: "credits", about: "Live routes for airliners, paid in credits from a monthly allowance (the Explorer plan: 30,000).", plan: [[30000, "Explorer 30,000"]] },
  flightaware: { label: "FlightAware AeroAPI", allowance: "monthly_limit", unit: "lookups", about: "Routes from FlightAware's AeroAPI, billed per lookup. Used only when Flightradar24 has no key.", plan: [] },
};
let shown = null;

const active = () => value("flightradar24", "api_key")?.set ? "flightradar24" : value("flightaware", "api_key")?.set ? "flightaware" : null;

/** The day the plan renews, picked from a month's days. */
function billingDay(section) {
  const grid = el(`<div class="days" role="radiogroup">${Array.from({ length: 28 }, (_, i) => `<button type="button" role="radio" data-d="${i + 1}">${i + 1}</button>`).join("")}</div>`);
  grid.render = () => { const v = +setting(section, "billing_day").value; grid.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.d === v))); };
  grid.onclick = (e) => { const b = e.target.closest("button"); if (b) { grid.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); grid.node.commit(+b.dataset.d); } };
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  return custom(section, "billing_day", { label: "Plan renews on day", cls: "is-days", says: (v) => `The allowance starts again on the ${ord(+v)} of each month.` }, grid);
}

function gaugeHero(pr) {
  const monthly = pr.monthly_limit, left = pr.period_budget != null ? Math.max(0, pr.period_budget - pr.period_used) : null;
  const renews = pr.resets ? new Date(pr.resets + "T00:00") : null;
  const days = renews ? Math.max(0, Math.ceil((renews - Date.now()) / 864e5)) : null;
  return el(`<section class="glass fuel-hero">
    <div class="fuel-top">
      ${reading(num(pr.period_used ?? pr.used_today), pr.period_budget != null ? `${esc(pr.unit)} used this month, of ${num(pr.period_budget)} to spend` : `${esc(pr.unit)} used today`, { cls: "big" })}
      ${left != null ? reading(num(left), `left to spend${days != null ? `, ${plural(days, "day")} to go` : ""}`) : ""}
      ${reading(`${num(pr.used_today)}<small>/${pr.daily_limit != null ? num(pr.daily_limit) : "∞"}</small>`, "today, of today's share")}
    </div>
    ${monthly ? fuel({ budget: pr.period_budget, used: pr.period_used, monthly, today: pr.used_today, todayCap: pr.daily_limit, starts: pr.starts, resets: pr.resets }) : `<p class="dim">Set your plan's monthly allowance below to see it here as a gauge.</p>`}
    <div class="fuel-key"><span class="k used">Used</span><span class="k today">Today's share</span><span class="k reserve">Held back, never spent</span><span class="k proj">Where this pace ends the period</span></div>
    ${burn(pr.days || [], pr.daily_limit)}
    ${pr.problem ? `<p class="fuel-problem">${icon("problems")} ${esc(pr.problem)}</p>` : ""}
    ${renews ? `<p class="dim small">Renews ${renews.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}. Each day's share is what's left, spread evenly over the days to go.</p>` : ""}
  </section>`);
}

/** Without a paid provider: what routes come from now, and the two to choose from, each connected
 *  where it's described. */
function chooseHero(page) {
  const hero = el(`<section class="glass choose-hero">
    <div class="choose-now">${icon("routes", "big-ico")}<div><b>Routes come from the free database</b><p>A database of flight numbers: usually right for airlines, sometimes a day or a season stale, and nothing for flights it doesn't know. A paid provider gives the exact route, live, for the airliners heading over the house; CloudWall spends it only while a screen is open.</p></div></div>
    <div class="choose-two"></div></section>`);
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const card = el(`<div class="choose-card"><b>${esc(p.label)}</b><p>${esc(p.about)}</p></div>`);
    card.append(secret(name, "api_key", { label: "Its key", setLabel: "Connected", unsetLabel: "Not connected", add: "Connect", saved: () => page.redraw() }));
    hero.querySelector(".choose-two").append(card);
  }
  return hero;
}

export default {
  id: "routes", get title() { return TITLES.routes; }, icon: "routes",
  async draw(page) {
    page.redraw = async () => { const fresh = el(`<div class="page page-routes"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const pr = S.overview.provider, act = active();
    shown = shown || act || "flightradar24";
    page.append(head(TITLES.routes, "Flight routes: from the free flight-number database, or exact and live from a paid provider."));
    const t = pageTroubles("routes");
    if (t) page.append(t);
    if (!act) { page.append(chooseHero(page)); return; }
    page.append(pr ? gaugeHero(pr) : el(`<section class="glass choose-hero"><div class="choose-now">${icon("restart", "big-ico")}<div><b>${esc(PROVIDERS[act].label)} is connected</b><p>Its key is saved. Once CloudWall restarts and starts using it, its allowance shows here as a gauge.</p></div></div></section>`));

    // the provider: one tab each, the one in use marked
    const tabs = el(`<div class="seg provider-tabs" role="tablist">${Object.entries(PROVIDERS).map(([n, p]) =>
      `<button type="button" role="tab" data-p="${n}" aria-selected="${n === shown}">${esc(p.label)}${value(n, "api_key")?.set ? ` <span class="dot ok" title="Connected"></span>` : ""}</button>`).join("")}</div>`);
    const keyRow = el(`<div class="provider-key"></div>`);
    const showKey = () => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === shown)));
      const p = PROVIDERS[shown];
      keyRow.replaceChildren(el(`<p class="prov-about">${esc(p.about)}</p>`),
        secret(shown, "api_key", { label: "API key", setLabel: "Connected", unsetLabel: "Not connected", add: "Connect", replace: "Replace the key", removeAsk: `Disconnect ${p.label}? Routes go back to the free database.`, saved: () => page.redraw() }));
    };
    tabs.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { shown = b.dataset.p; showKey(); } };
    showKey();
    page.append(group("Provider", `${PROVIDERS[act].label} in use${act === "flightradar24" ? "; FlightAware only without a Flightradar24 key" : ""}`, [tabs, keyRow]));

    const p = PROVIDERS[act];
    page.append(group("Allowance", "", [
      stepper(act, p.allowance, { label: "Monthly allowance", step: 1000, min: 0, unitLabel: p.unit, presets: p.plan.length ? p.plan : null, says: (v) => v ? `${num(v)} ${p.unit} a month.` : `No monthly figure: at most ${act === "flightaware" ? 30 : 300} a day.` }),
      billingDay(act),
      slider(act, "safety_margin", { label: "Held back", min: 0, max: 50, step: 5, scale: 100, format: (v) => `${v}%`, says: (v) => `${Math.round(v * 100)}% of the allowance is never spent, so a busy month can't run it out.` }),
      advanced(() => value(act, "daily_limit") ? `at most ${num(value(act, "daily_limit"))} a day` : "no daily cap", [
        stepper(act, "daily_limit", { label: "Daily cap", step: 10, min: 0, says: (v) => v ? `Never more than ${num(v)} in a day.` : "No cap beyond each day's even share of what's left." }),
      ]),
    ]));

    page.append(group("Lookups", "Spent only while a screen is open, on aircraft heading for the house", [
      cards(act, "mode", { label: "Which flights", options: [
        { value: "always", title: "Every airliner coming over", body: "The exact route for each. Recommended: the free database is often stale.", icon: "routes" },
        { value: "fallback", title: "Only when the free route looks wrong", body: "Spends far less; a stale route that looks plausible goes unchecked.", icon: "check" },
      ] }),
      toggle(act, "general_aviation", { label: "Private aircraft too", on: "Private aircraft are looked up as well; most have no route on file.", off: "Only airline flights are looked up." }),
      act === "flightradar24" ? advanced(() => value(act, "sandbox") ? "SANDBOX ON: every route is sample data" : "sandbox off", [
        toggle(act, "sandbox", { label: "Sandbox", on: "Every route is Flightradar24's sample data, free. Only with a sandbox key; never with a real one.", off: "Real lookups." }),
      ]) : null,
    ]));
  },
};
