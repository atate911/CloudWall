// The divider between the radar and the traffic list, on the desktop's widest layout (1500 px
// and up). Its arrow hides or shows the list; dragging it gives the radar more or less room.
// The flight card keeps its width either way: whatever the list gives up goes to the radar.
// Each screen remembers its own setting. On a wide, short screen the radar's disc is only as wide
// as its panel is tall, so its column is held to that and the card and the list share what's left.
import { $, clamp, store } from "./util.js";

const PAIR = 1.85;            // the radar's and the list's columns together, in the grid's fr (the card has 1.3)
const DEFAULT = 0.85;         // the list's share of them, to begin with
const MIN_LIST = 13;          // the list's narrowest, in rem; dragged to half that, it closes
const MIN_RADAR = 18;         // and the radar's narrowest
const STEP = 2;               // rem per arrow key
const ANIMATE_MS = 220;       // as the stylesheet's transition
const CARD = 1.3;             // the card's column, in fr
const RADAR_ASPECT = 1.04;    // the radar's drawing at its widest, for its height: the disc, and a little room either side

export function nearbyDivider(shown) {
  const grid = $("view-now"), bar = $("pane-split"), btn = $("ps-toggle");
  let share = clamp(+store("nearbyShare") || DEFAULT, 0.1, PAIR - 0.1), open = store("nearby") !== "closed", hideTimer = null, drawn = false;
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
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
  // hold the radar's column to its disc: the drawing is as tall as the panel less its button rows
  // above and below, and when the column would be wider than that (and a little), the card and the
  // list grow in step until it isn't
  function fit(m) {
    const r = PAIR - m, scope = $("scope"), sc = getComputedStyle(scope);
    const want = (scope.clientHeight - parseFloat(sc.paddingTop) - parseFloat(sc.paddingBottom)) * RADAR_ASPECT + parseFloat(sc.paddingLeft) + parseFloat(sc.paddingRight);
    const style = getComputedStyle(grid), gaps = parseFloat(style.columnGap) || 0;
    const fixed = [...grid.children].filter((e) => e.classList.contains("pane-split")).reduce((w, e) => w + e.offsetWidth, 0) + rem() * 1.4;
    const room = grid.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) - fixed - gaps * 4;
    let f = 1;
    if (want > 0 && room > 0 && (r / (CARD + r + m)) * room > want) f = (r * room / want - r) / (CARD + m);
    grid.style.setProperty("--card-w", `${(CARD * f).toFixed(3)}fr`);
    if (f !== 1) grid.style.setProperty("--mb-w", `${(m * f).toFixed(3)}fr`);
  }
  // again whenever the room changes: the window, or the strip above growing a line (the panel's height)
  const refit = new ResizeObserver(() => { if (!grid.classList.contains("dragging")) fit(open ? share : 0); });
  refit.observe(grid);
  refit.observe($("scope"));

  function save() {
    store("nearby", open ? "open" : "closed");
    store("nearbyShare", share.toFixed(3));
  }
  // the list `px` wide, kept between its narrowest and the radar's; well short of its narrowest, closed
  function setList(px) {
    const r = rem(), room = pairPx();
    if (px < (MIN_LIST * r) / 2 || room <= 0) { open = false; return; }
    open = true;
    share = (PAIR * clamp(px, MIN_LIST * r, Math.max(MIN_LIST * r, room - MIN_RADAR * r))) / room;
  }

  btn.addEventListener("click", () => { open = !open; apply(true); save(); });
  // drag the divider; from closed, drag it left to open the list
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
  // double-click: back to the usual width
  bar.addEventListener("dblclick", (e) => {
    if (e.target.closest("#ps-toggle")) return;
    open = true; share = DEFAULT; apply(true); save();
  });
  // from the keyboard: arrows move the divider, Enter hides or shows the list
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
  apply(false);
}
