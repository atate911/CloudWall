// Route lookups: where each flight is going and coming from. With a paid provider, the page is its
// allowance, drawn as a fuel gauge (used, left, the reserve held back, where this pace ends the
// month) and each day's use against the day's even share; without one, the choice of provider.
// The plan's figures sit under the picture; what's touched once a year waits under a shade.
import { el, esc, S, setting, value, num, plural } from "../core.js";
import { icon } from "../icons.js";
import { fuel, burn } from "../draw.js";
import { head, pageTroubles, reading } from "../parts.js";
import { secret, cards, toggle, stepper, slider, shade, group, custom } from "../controls.js";

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
  return custom(section, "billing_day", { label: "Your plan renews on the", cls: "is-days", says: (v) => `The allowance starts again on the ${ord(+v)} of each month.` }, grid);
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

function provider(name, page) {
  const p = PROVIDERS[name];
  const kids = [
    secret(name, "api_key", { label: `${p.label} key`, setLabel: "Connected", unsetLabel: "Not connected", add: "Connect", replace: "Replace the key", removeAsk: `Disconnect ${p.label}? Routes go back to the free database.`, saved: () => page.redraw() }),
  ];
  if (setting(name, "api_key").value?.set) {
    kids.push(
      stepper(name, p.allowance, { label: "Monthly allowance", step: 1000, min: 0, unitLabel: p.unit, presets: p.plan.length ? p.plan : null, says: (v) => v ? `${num(v)} ${p.unit} a month, of which ${Math.round(value(name, "safety_margin") * 100)}% is held back.` : `No monthly figure: at most ${name === "flightaware" ? 30 : 300} a day.` }),
      billingDay(name),
    );
  }
  return group(null, null, [el(`<p class="prov-about">${esc(p.about)}</p>`), ...kids], { cls: `provider ${name}` });
}

export default {
  id: "routes", title: "Route lookups", icon: "routes",
  live() {
    const pr = S.overview?.provider;
    if (!pr) return "free database";
    return pr.period_budget != null ? `${num(pr.period_used)} of ${num(pr.period_budget)} this month` : `${num(pr.used_today)} ${pr.unit} today`;
  },
  async draw(page) {
    page.redraw = async () => { const fresh = el(`<div class="page page-routes"></div>`); await this.draw(fresh); page.replaceWith(fresh); };
    const pr = S.overview.provider, act = active();
    shown = shown || act || "flightradar24";
    page.append(head("Route lookups", "Where each flight is coming from and going to: free from a database of flight numbers, or exact and live from a paid provider."));
    const t = pageTroubles("routes");
    if (t) page.append(t);
    if (!act) { page.append(chooseHero(page)); return; }
    page.append(pr ? gaugeHero(pr) : el(`<section class="glass choose-hero"><div class="choose-now">${icon("restart", "big-ico")}<div><b>${esc(PROVIDERS[act].label)} is connected</b><p>Its key is saved. Once CloudWall restarts and starts using it, its allowance shows here as a gauge.</p></div></div></section>`));

    const tabs = el(`<div class="seg big provider-tabs" role="tablist">${Object.entries(PROVIDERS).map(([n, p]) =>
      `<button type="button" role="tab" data-p="${n}" aria-selected="${n === shown}">${esc(p.label)}${value(n, "api_key")?.set ? ` <span class="dot ok" title="Connected"></span>` : ""}</button>`).join("")}</div>`);
    const body = el(`<div></div>`);
    const show = () => { tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === shown))); body.replaceChildren(provider(shown, page)); };
    tabs.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { shown = b.dataset.p; show(); } };
    show();
    page.append(group("The provider", `${PROVIDERS[act].label} is in use.${act === "flightaware" ? "" : " FlightAware is used only without a Flightradar24 key."}`, [tabs, body]));

    const name = act;
    {
      page.append(group("When to look up", "Lookups are only ever spent while a screen is open, on aircraft heading for the house.", [
        cards(name, "mode", { label: "Which flights", options: [
          { value: "always", title: "Every airliner coming over", body: "The exact route for each one. Recommended: the free database is wrong often enough to notice.", icon: "routes" },
          { value: "fallback", title: "Only when the free route looks wrong", body: "Spends far less; a stale route that looks plausible goes unchecked.", icon: "check" },
        ] }),
        toggle(name, "general_aviation", { label: "Private aircraft too", on: "Private aircraft are looked up as well. Most have no route on file, so this mostly spends.", off: "Only airline flights are looked up." }),
      ]));
      page.append(shade("Limits and testing", () => [
        `${Math.round(value(name, "safety_margin") * 100)}% held back`,
        value(name, "daily_limit") ? `at most ${num(value(name, "daily_limit"))} a day` : "no daily cap",
        name === "flightradar24" && value(name, "sandbox") ? "SANDBOX ON" : "",
      ].filter(Boolean).join("; "), [
        slider(name, "safety_margin", { label: "Held back", min: 0, max: 50, step: 5, scale: 100, format: (v) => `${v}%`, says: (v) => `${Math.round(v * 100)}% of the allowance is never spent, so a busy month can't run it out.` }),
        stepper(name, "daily_limit", { label: "Daily cap", step: 10, min: 0, says: (v) => v ? `Never more than ${num(v)} in a day, whatever is left.` : "No cap beyond the day's even share." }),
        name === "flightradar24" ? toggle(name, "sandbox", { label: "Sandbox", on: "Every route is Flightradar24's sample data, free. Only with a sandbox key: never leave on with a real one.", off: "Real lookups." }) : null,
      ].filter(Boolean)));
    }
  },
};
