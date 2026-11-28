// The dividers on the desktop's Overhead view: one between the radar and the traffic list (hides,
// shows and sizes the list), one between the flight card and the radar (sets the card's width,
// remembered per layout). The radar's column is held to its disc on a wide, short screen.
import { $, clamp, store } from "./util.js";

const PAIR = 1.85;            // the radar's and the list's columns together, in the grid's fr (the card has 1.3)
const DEFAULT = 0.85;         // the list's share of them, to begin with
const MIN_LIST = 13;          // the list's narrowest, in rem; dragged to half that, it closes
const MIN_RADAR = 18;         // and the radar's narrowest
const MIN_LEFT = { detailed: 24, simple: 20 };     // the card's narrowest, and Simple's side panel's, in rem
const STEP = 2;               // rem per arrow key
const ANIMATE_MS = 220;       // as the stylesheet's transition
const CARD = 1.3;             // the card's column, in fr
const RADAR_ASPECT = 1.04;    // the radar's drawing at its widest, for its height: the disc, and a little room either side

// Which of style.css's layouts the Overhead view has: "wide", "laptop", "narrow" (all Detailed) or
// "simple"; null where there is no card divider.
const Q = {
  land: matchMedia("(min-aspect-ratio: 1/1)"), wide: matchMedia("(min-width: 1500px)"),
  laptop: matchMedia("(min-width: 1200px)"), simpleWide: matchMedia("(min-width: 1500px) and (min-aspect-ratio: 19/10)"),
};
function layout() {
  const html = document.documentElement.classList;
  if (!html.contains("desk") || html.contains("phone") || !Q.land.matches) return null;
  if (document.body.classList.contains("d-simple")) return Q.simpleWide.matches ? null : "simple";
  return Q.wide.matches ? "wide" : Q.laptop.matches ? "laptop" : "narrow";
}

export function paneDividers(shown) {
  const grid = $("view-now"), bar = $("pane-split"), btn = $("ps-toggle"), cbar = $("card-split");
  let share = clamp(+store("nearbyShare") || DEFAULT, 0.1, PAIR - 0.1), open = store("nearby") !== "closed", hideTimer = null, drawn = false;
  let lay = null, left = null;      // the layout, and the card's width in it as a % of the row (null: as the stylesheet has it)
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // MIN_RADAR, or as wide as the row of buttons along its foot, which can't wrap
  function minRadar() {
    const tools = document.querySelector("#scope .scope-tools"), shown = tools ? [...tools.children].filter((c) => c.offsetWidth) : [];
    const gap = tools ? parseFloat(getComputedStyle(tools).columnGap) || 0 : 0;
    return Math.max(MIN_RADAR * rem(), shown.reduce((w, c) => w + c.offsetWidth, 0) + gap * Math.max(0, shown.length - 1) + 0.8 * rem());
  }
  // the room the radar and the list share, in px: from the radar's left edge to the grid's right, less the divider
  const pairPx = () => grid.getBoundingClientRect().right - $("scope").getBoundingClientRect().left - bar.offsetWidth;

  function apply(animate) {
    clearTimeout(hideTimer);
    grid.classList.toggle("animate", animate);
    const m = open ? share : 0;
    grid.style.setProperty("--mb-w", `${m.toFixed(3)}fr`);
    grid.style.setProperty("--scope-w", `${(PAIR - m).toFixed(3)}fr`);
    fit(m);
    // closing, the list stays drawn while its column narrows, then goes
    if (open || !animate) grid.classList.toggle("nearby-closed", !open);
    else hideTimer = setTimeout(() => grid.classList.add("nearby-closed"), ANIMATE_MS);
    btn.setAttribute("aria-expanded", String(open));
    btn.title = open ? "Hide the traffic list" : "Show the traffic list";
    btn.setAttribute("aria-label", btn.title);
    bar.setAttribute("aria-valuenow", String(Math.round((m / PAIR) * 100)));
    bar.setAttribute("aria-valuetext", open ? `Traffic list, ${Math.round((m / PAIR) * 100)}% of the room beside the card` : "Traffic list hidden");
    if (open && !drawn) shown();            // fill it in now rather than at the next update
    drawn = open;
  }
  // hold the radar's column to its disc: when it would be wider, the card and the list grow in step
  function fit(m) {
    const r = PAIR - m, scope = $("scope"), sc = getComputedStyle(scope);
    const want = (scope.clientHeight - parseFloat(sc.paddingTop) - parseFloat(sc.paddingBottom)) * RADAR_ASPECT + parseFloat(sc.paddingLeft) + parseFloat(sc.paddingRight);
    if (left != null && (lay === "wide" || lay === "laptop")) {
      // the card's width is the one dragged to, so the list alone takes up what the radar doesn't need
      grid.style.removeProperty("--card-w");
      const room = pairPx();
      if (m > 0 && want > 0 && room > 0 && (r / PAIR) * room > want) grid.style.setProperty("--mb-w", `${(r * room / want - r).toFixed(3)}fr`);
      return;
    }
    const style = getComputedStyle(grid), gaps = parseFloat(style.columnGap) || 0;
    const fixed = [...grid.children].filter((e) => e.classList.contains("pane-split")).reduce((w, e) => w + e.offsetWidth, 0) + rem() * 1.4;
    const room = grid.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) - fixed - gaps * 4;
    let f = 1;
    if (want > 0 && room > 0 && (r / (CARD + r + m)) * room > want) f = (r * room / want - r) / (CARD + m);
    grid.style.setProperty("--card-w", `${(CARD * f).toFixed(3)}fr`);
    if (f !== 1) grid.style.setProperty("--mb-w", `${(m * f).toFixed(3)}fr`);
  }
  // again whenever the room changes: the window, or the strip above growing a line (the panel's height)
  const refit = new ResizeObserver(() => {
    relayout();
    if (grid.classList.contains("dragging")) return;
    keepRadar();
    fit(open ? share : 0);
  });
  refit.observe(grid);
  refit.observe($("scope"));

  function save() {
    store("nearby", open ? "open" : "closed");
    store("nearbyShare", share.toFixed(3));
  }
  // well short of its narrowest, closed
  function setList(px) {
    const r = rem(), room = pairPx();
    if (px < (MIN_LIST * r) / 2 || room <= 0) { open = false; return; }
    open = true;
    share = (PAIR * clamp(px, MIN_LIST * r, Math.max(MIN_LIST * r, room - minRadar()))) / room;
  }

  btn.addEventListener("click", () => { open = !open; apply(true); save(); });
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("#ps-toggle")) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const right = grid.getBoundingClientRect().right, grab = e.clientX - bar.getBoundingClientRect().left;
    grid.classList.add("dragging");
    const move = (ev) => { setList(right - (ev.clientX - grab) - bar.offsetWidth); apply(false); };
    const done = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", done);
      bar.removeEventListener("pointercancel", done);
      grid.classList.remove("dragging");
      save();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", done);
    bar.addEventListener("pointercancel", done);
  });
  bar.addEventListener("dblclick", (e) => {
    if (e.target.closest("#ps-toggle")) return;
    open = true; share = DEFAULT; apply(true); save();
  });
  bar.addEventListener("keydown", (e) => {
    if (e.target !== bar) return;
    if (e.key === "Enter" || e.key === " ") { open = !open; apply(true); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const r = rem(), w = open ? (share / PAIR) * pairPx() : 0;      // where it's going, not where an animation has it
      if (e.key === "ArrowLeft") setList(open ? w + STEP * r : MIN_LIST * r);      // from closed: open at its narrowest
      else if (w - STEP * r < MIN_LIST * r - 1) open = false;                       // past its narrowest: closed
      else setList(w - STEP * r);
      apply(true);
    } else return;
    e.preventDefault();
    save();
  });

  // ---- the card's divider ----
  const box = () => {
    const r = grid.getBoundingClientRect(), st = getComputedStyle(grid);
    return { left: r.left + parseFloat(st.paddingLeft), width: grid.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) };
  };
  const leftPx = () => cbar.getBoundingClientRect().left - box().left;
  const minLeft = () => MIN_LEFT[lay === "simple" ? "simple" : "detailed"] * rem();
  const listW = () => ((lay === "wide" || lay === "laptop") && open ? $("mini-board").getBoundingClientRect().width : 0);
  function showLeft() {
    if (left == null || !lay) grid.style.removeProperty("--left-w");
    else grid.style.setProperty("--left-w", `${left.toFixed(2)}%`);
    const what = lay === "simple" ? "the side panel" : "the flight card";
    cbar.title = `Drag to give ${what} more or less room. Double-click for the usual width.`;
    cbar.setAttribute("aria-label", `Width of ${what}`);
    if (lay) cbar.setAttribute("aria-valuenow", String(Math.round((leftPx() / box().width) * 100)));
  }
  // on a layout change: the card's width as it was last left in this one
  function relayout() {
    const now = layout();
    if (now === lay) return;
    lay = now;
    const saved = lay ? +store(`cardWidth.${lay}`) : 0;
    left = saved > 0 && saved < 100 ? saved : null;
    showLeft();
  }
  // a window narrowed: the card gives way before the radar goes below its narrowest
  function keepRadar() {
    if (left == null || !lay) return;
    const short = minRadar() - $("scope").getBoundingClientRect().width;
    if (short > 1) {
      left = (Math.max(minLeft(), leftPx() - short) / box().width) * 100;
      showLeft();
    }
  }
  function setLeft(px, max, list) {
    left = (clamp(px, minLeft(), Math.max(minLeft(), max)) / box().width) * 100;
    showLeft();
    if (list) { setList(list); apply(false); } else fit(open ? share : 0);
  }
  // the widest it can go: as far as leaves the radar its narrowest, the list keeping its width
  const most = () => leftPx() + $("scope").getBoundingClientRect().width - minRadar();
  cbar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !lay) return;
    e.preventDefault();
    cbar.setPointerCapture(e.pointerId);
    const grab = e.clientX - cbar.getBoundingClientRect().left, list = listW(), max = most(), x0 = box().left;
    grid.classList.add("dragging");
    cbar.classList.add("held");
    const move = (ev) => setLeft(ev.clientX - grab - x0, max, list);
    const done = () => {
      cbar.removeEventListener("pointermove", move);
      cbar.removeEventListener("pointerup", done);
      cbar.removeEventListener("pointercancel", done);
      grid.classList.remove("dragging");
      cbar.classList.remove("held");
      if (left != null) store(`cardWidth.${lay}`, left.toFixed(2));
      if (list) save();
    };
    cbar.addEventListener("pointermove", move);
    cbar.addEventListener("pointerup", done);
    cbar.addEventListener("pointercancel", done);
  });
  cbar.addEventListener("dblclick", () => {
    if (!lay) return;
    const list = listW();
    left = null;
    store(`cardWidth.${lay}`, "");
    showLeft();
    if (list) setList(list);
    apply(true);
  });
  cbar.addEventListener("keydown", (e) => {
    if (!lay || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const list = listW();
    setLeft(leftPx() + (e.key === "ArrowLeft" ? -1 : 1) * STEP * rem(), most(), list);
    store(`cardWidth.${lay}`, left.toFixed(2));
    if (list) save();
  });
  // Simple and Detailed switch the layout without the window changing size
  new MutationObserver(relayout).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(relayout).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  relayout();
  apply(false);
}
