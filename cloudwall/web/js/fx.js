// Motion and sound: split-flap text, rolling numbers, chimes.
import { store } from "./util.js";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Render `text` as split-flap tiles inside `el`, flipping each tile to its new character.
export function flap(el, text, animate = true) {
  text = String(text ?? "");
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  while (el.children.length > text.length) el.lastChild.remove();
  while (el.children.length < text.length) {
    const t = document.createElement("span");
    t.className = "flap";
    t.textContent = " ";
    el.appendChild(t);
  }
  [...text].forEach((ch, i) => {
    const tile = el.children[i];
    tile.classList.toggle("sp", ch === " ");
    clearTimeout(tile._timer);
    if (!animate || tile.textContent === ch) { tile.textContent = ch; return; }
    let steps = 3 + Math.floor(Math.random() * 3) + Math.min(i, 4);   // later tiles settle a beat later
    const tick = () => {
      tile.textContent = steps > 0 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : ch;
      tile.classList.remove("flip");
      void tile.offsetWidth;                                 // restart the CSS animation
      tile.classList.add("flip");
      if (steps-- > 0) tile._timer = setTimeout(tick, 70);
    };
    tile._timer = setTimeout(tick, i * 40);
  });
}

// Count a number smoothly from what the element shows now to `value`.
export function roll(el, value, format = (v) => Math.round(v).toLocaleString("en-US"), ms = 900) {
  if (value == null) { el.textContent = "–"; el._v = null; return; }
  const from = el._v ?? value, start = performance.now();
  el._target = value;
  if (from === value) { el.textContent = format(value); el._v = value; return; }
  const step = (now) => {
    if (el._target !== value) return;                        // a newer value took over
    const t = Math.min(1, (now - start) / ms), e = 1 - (1 - t) ** 3;
    el._v = from + (value - from) * e;
    el.textContent = format(el._v);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- sound: short synthesised chimes, no audio files ----
let ctx = null;
export const soundOn = () => store("sound") === "on";
export function setSound(on) {
  store("sound", on ? "on" : "off");
  if (on) { chime("arrival"); }
}
function note(freq, at, dur, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}
export function chime(kind) {
  if (!soundOn()) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime + 0.02;
    if (kind === "alert") [0, 0.5, 1].forEach((d) => { note(880, t + d, 0.35, 0.2); note(659.3, t + d + 0.2, 0.35, 0.2); });
    else if (kind === "rare") [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => note(f, t + i * 0.13, 1.1, 0.16));
    else { note(783.99, t, 0.9, 0.14); note(1046.5, t + 0.16, 1.2, 0.12); }   // cabin-style two-tone
  } catch (e) { /* audio not available: stay silent */ }
}
