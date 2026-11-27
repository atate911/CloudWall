// Safekeeping: what can't be downloaded again (the logbooks, the settings, the keys) and copies of
// it. The picture is when it was last copied and the copies along a month, with the one action
// that matters most a button beside it; the disk as one bar of what fills it; where things are kept
// waits under a shade.
import { el, esc, S, call, toast, value, button, bytes, ago, when, day, plural, loadOverview, TITLES } from "../core.js";
import { icon } from "../icons.js";
import { diskBar } from "../draw.js";
import { head, pageTroubles, copyable } from "../parts.js";
import { stepper, text, group, line, advanced } from "../controls.js";

function strip(list) {
  const now = Date.now() / 1000, span = 30 * 86400, W = 600;
  const x = (t) => 6 + (1 - (now - t) / span) * (W - 12);
  const weeks = [0, 7, 14, 21, 28].map((d) => `<path class="bk-grid" d="M${x(now - d * 86400)} 6v26"/><text class="bk-lab" x="${x(now - d * 86400)}" y="46" text-anchor="${d ? "middle" : "end"}">${d ? `${d} days ago` : "today"}</text>`).join("");
  const dots = list.filter((b) => now - b.made < span).map((b, i) => `<circle class="bk-dot ${i === 0 ? "newest" : ""}" cx="${x(b.made)}" cy="19" r="${i === 0 ? 7 : 5}"><title>${when(b.made)}: ${bytes(b.size)}</title></circle>`).join("");
  return `<svg class="bk-strip" viewBox="0 0 ${W} 50" role="img" aria-label="${plural(list.length, "backup")} in the last 30 days"><path class="bk-axis" d="M6 19H${W - 6}"/>${weeks}${dots}</svg>`;
}

function fileName(name) {
  const places = S.overview.places || [];
  const m = /^place-(.+)\.db$/.exec(name);
  if (m) return `${places.find((p) => p.id === m[1])?.name || m[1]}'s logbook`;
  if (/health/.test(name)) return "Problems recorded";
  if (/shared|lookup/.test(name)) return "Lookups and sessions";
  return `${places[0]?.name || "The house"}'s logbook`;
}

export default {
  id: "safekeeping", get title() { return TITLES.safekeeping; }, icon: "safekeeping",
  async draw(page) {
    const o = S.overview, st = o.storage, b = await call("backups");
    const last = b.backups[0];
    const stale = !last || Date.now() / 1000 - last.made > 14 * 86400;
    page.append(head(TITLES.safekeeping, "Backups of the settings and logbooks, restoring one, and disk use."));
    const t = pageTroubles("safekeeping");
    if (t) page.append(t);

    const hero = el(`<section class="safe-hero">
      <div class="glass backup-now ${stale ? "stale" : ""}">
        <div class="bk-top"><div>${icon("safekeeping", "big-ico")}</div>
          <div><span class="fact-label">Last backed up</span><b class="fact-huge">${last ? ago(last.made) : "Never"}</b>
          <span class="fact-sub">${last ? `${when(last.made)}, ${bytes(last.size)}: the settings, keys and every logbook` : "Nothing is copied yet: a full disk or a failed card would lose every logbook"}</span></div>
          <div class="bk-act"></div></div>
        ${strip(b.backups)}
      </div>
      <div class="disk-side"><h2>The disk</h2>${st.disk ? `<b class="fact-big">${bytes(st.disk.free)} free</b><span class="fact-sub">of ${bytes(st.disk.total)}</span>` : `<b class="fact-big">${o.demo ? "In memory" : "Unknown"}</b>`}
        <div class="disk-slot"></div></div>
    </section>`);
    hero.querySelector(".bk-act").append(button(`${icon("safekeeping")} Back up now`, async () => {
      const got = await call("backups", {}); toast(got.said.replace(/^./, (c) => c.toUpperCase())); await loadOverview(); page.redraw();
    }, stale ? "" : "quiet"));
    if (st.disk) {
      const logbooks = Object.values(st.files || {}).reduce((a, n) => a + n, 0), cache = st.cache || 0;
      const used = st.disk.total - st.disk.free;
      hero.querySelector(".disk-slot").innerHTML = diskBar([
        { label: "logbooks", bytes: logbooks, cls: "s-log" }, { label: "map tiles and logos", bytes: cache, cls: "s-cache" },
        { label: "everything else", bytes: Math.max(0, used - logbooks - cache), cls: "s-other" }, { label: "free", bytes: st.disk.free, cls: "s-free" },
      ]);
    }
    page.append(hero);
    page.redraw = async () => { const fresh = el(`<div class="page page-safekeeping"></div>`); await this.draw(fresh); page.replaceWith(fresh); };

    const copies = el(`<div class="copies">${b.backups.length ? `<ol class="copy-list">${b.backups.map((x, i) => `<li>
        <span class="copy-when"><b>${day(x.made)}</b> ${new Date(x.made * 1000).toLocaleTimeString([], { timeStyle: "short" })}${i === 0 ? ` <span class="tag">newest</span>` : ""}</span>
        <span class="copy-size">${bytes(x.size)}</span>
        <a class="icon-btn" href="api/admin/backups/${encodeURIComponent(x.name)}" download title="Download ${esc(x.name)}">${icon("download")}<span class="sr">Download</span></a></li>`).join("")}</ol>` : `<p class="dim">None yet. Back up now makes the first, or at the machine: <code>sudo cloudwall backup</code>.</p>`}</div>`);
    page.append(group("Backups", "The last seven are kept; keep a downloaded copy off this disk", [
      line("Kept in", `<code>${esc(b.folder)}</code>`),
      line("Copies", copies),
      line("Restore", copyable(`sudo cloudwall restore ${b.folder}/${last?.name || "<file>"} --yes`)),
    ]));

    const files = Object.entries(st.files || {}).sort((a, z) => z[1] - a[1]), biggest = Math.max(1, ...files.map((f) => f[1]));
    page.append(group("Storage", "", [
      files.length ? line("Logbooks", el(`<ul class="kept">${files.map(([n, size]) => `<li><span><b>${esc(fileName(n))}</b><code>${esc(n)}</code></span><span class="kept-bar"><i style="width:${Math.max(2, size / biggest * 100)}%"></i></span><span>${bytes(size)}</span></li>`).join("")}</ul>`)) : null,
      stepper("map", "cache_mb", { label: "Map tile cache limit", step: 250, min: 100, unitLabel: "MB", presets: [[500], [2000], [5000]], says: (v) => `${bytes(st.cache)} used. Past ${v} MB, the oldest tiles are removed once a day.` }),
      advanced(() => value("storage", "db_path") || value("storage", "cache_dir") ? "folders of your own" : "the install's own folders", [
        text("storage", "db_path", { label: "Logbook file", mono: true, empty: `The install's own: ${st.folder}` }),
        text("storage", "cache_dir", { label: "Cache folder", mono: true, empty: "The install's own" }),
      ]),
    ]));
  },
};
