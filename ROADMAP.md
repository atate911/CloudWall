# CloudWall roadmap: one coherent system

The agreed plan for reorganising CloudWall and everything built around it. Each stage below
lands as its own pull request; this file is updated as stages are finished (see "Progress").

## Context

CloudWall grew by side-quest. The core app is solid (201 tests pass), but around it sit a
separate coverage app, an unwired radio package, a root-run settings page with no sign-in, four
overlapping receiver scripts and a hand-assembled tunnel, some on unmerged branches. State
lives in home directories and generated unit files; nothing is backed up or versioned; a
rebuild repeats a seven-step, two-terminal procedure whose known mistakes fill a README section.

Goal: one program, one install, one settings interface, one data layout on both machines;
layers with defined seams so new radios, decoders and AI processing plug in; fault-tolerant;
explained to its owner in plain words. Existing problems are fixed on the way.

Owner's decisions: server on the VPS, receiver at home; full restructure by layer; two access
levels (owner, viewers); room for more radios/decoders and transcripts/AI; help built in.

Kept: Python standard library only; no build step in the page; the display only draws;
external programs (adsb.im, rtl_airband, ssh, Caddy) are driven and supervised, never imported.

## 1. Target architecture

### Layers (one package; one-way imports enforced by a test)

```
 app/      start-up, Place, Shared, Activity: joins the layers for a role
 serve/    HTTP server, route table, access; static files stay in cloudwall/web/
 operate/  install, link, doctor, backup, settings API         share/  aggregator setup, masked report
 picture/  tracker, details, situation, medical, coverage binning, radio channels/plan/predict
 sense/    raw readsb reader, receiver facts, airband driver   gather/ feeds, enrich, providers,
 memory/   logbook, tracks+heat, coverage, radio calls                 weather, tfr, contrails, tiles
 core/     settings schema, store, http, disk cache, geo, supervisor, health, paths
 data/     reference tables (airports, runways, frequencies, types, airlines, peaks, places)
```

(`serve/`, not `web/`: `cloudwall/web/` is the static folder, and everything in it is served.)

### Roles, same program

- **wall** (VPS): gather, picture, memory, serve. Every screen talks to it.
- **station** (Pi): sense, coverage sampling, radio listening. Records locally whether or not
  the link is up; exposes one loopback, read-only HTTP port, including `/data/aircraft.json`
  at tar1090's path so Pi and VPS can be switched over independently.
- **panel**: a kiosk browser pointed at a wall.
- The wall pulls from the station. Transport: loopback, LAN, or the existing reverse SSH
  tunnel, generated from settings. (Pull kept over push: it works today, adds no
  internet-facing write endpoint, needs no TLS or DNS, and the wall sets the rate.)
- Each module switches on or off; wall-only on public feeds stays the default.

### Three classes of work (replaces "only while someone is looking")

| Class | Examples | Runs |
|---|---|---|
| Sense | own receiver, coverage, radio | always |
| Free gather | public feed, routes, airframes, weather | watched; slowly when unwatched, so the logbook stays complete (today's `when_idle = "log"`) |
| Paid | Flightradar24, FlightAware | only while watched, and only for the owner's follows unless allowed |

Store-and-forward covers what the station itself produces (coverage points, radio calls). The
logbook is built on the wall from live data; gaps during a link outage are filled from the
public feed, not replayed.

### Seams for growth (kept as small as will work)

- **Module list:** a literal list of modules, each declaring settings, health checks, routes,
  storage migrations and help. Setup, Overview, doctor and Help read it. No discovery.
- **Route table** replacing the if-chain in `server.py:127-190`.
- **Sensor interface** (start, stop, health, settings): extracted when radio lands in stage 7,
  from a real example; UAT, ACARS/VDL2 and NOAA then follow it.
- **Work queue:** the table is the queue (`WHERE transcript IS NULL`). First job: logbook
  back-fill; then call transcription. A Worker interface when there is a second kind.
- An extension guide ("adding a sensor / source / view / worker") in the docs.

## 2. Each layer, revised

**core**
- Settings schema: per setting type, default, range/choices, unit, label, help, `secret`.
  Generates validation, the config file and the Setup form. Grows from `config.DEFAULTS`,
  `OPTIONAL`, `check` (`cloudwall/config.py`); place completion (`config.py:202-261`) moves out.
- One settings file, `/etc/cloudwall/config.toml`, edited by hand or by Setup; Setup rewrites it
  whole from the schema, each setting's help as its comment (hand-written comments are not
  kept). Secrets, `map.url` included, in a 0600 file, write-only from the page.
- Apply = validate, keep the previous file as `.good`, write, restart (the page already shows a
  restart). Invalid file: start from `.good` and say so; `StartLimitBurst` on the unit.
- Stores: `shared.db` (lookups, the paid-usage ledger as a real table, sessions),
  `place-<id>.db` (sightings, heat), `coverage.db`, `radio.db`. Numbered migrations, integrity
  check, a corrupt file set aside rather than fatal. Coverage3D's connection pattern
  (`coverage3d/coverage3d/store.py:82-117`) where there are several writers.
- One `fetch` (retry, backoff, size cap) replacing `http.py`, `tiles.py:106`, `logos.py:40`, and
  the single point tests patch.
- One size-bounded `DiskCache` for `tiles.py` and `logos.py`.
- One `geo`: main's, plus Coverage3D's refracted elevation, `destination`, radio horizon.
- One supervisor lifted from `Place._keep_going` (`place.py:106`), feeding a health registry.

**sense**
- One raw readsb reader (URL or file, one discovery list) keeping `rssi`, `nac_p`, `seen_pos`,
  `alt_geom` and the source type as `src`. `sources.normalise()` and Coverage both consume it.
  No recording until the Pi's clock is synchronised.
- One receiver-facts module replacing the logic repeated in `tools/adsb_check.sh`,
  `feeder_report.sh`, `coverage3d_facts.sh` and `sharing_guide.py`; one `mask()`.
- One `[station]`: position, ground elevation, antenna height, SDR serials and their jobs.
  `[home]` may be "the station".

**gather**
- `sources.py` split: normalise, public feeds, merge, demo. `Merged` gets a timeout
  (`sources.py:203`) and a switch for asking the public feed.
- Provider base for the Flightradar24/FlightAware duplication; `mode` validated;
  `monthly_credits` canonical (alias kept).
- Demo emits raw records upstream of `normalise()`, one simulator for wall and coverage, and
  no longer writes into the real data directory (`__main__.py:122`).

**picture**
- Tracker behaviour unchanged. Logbook and heat writes move out from under the tracker's lock
  and degrade to a health warning on failure (`tracker.py:277-290`).
- `enrich.py:196` prune inside the guard; `tracker.pins` and `TFRs.details` bounded.
- `Places.remove` closes its store and thread pool (`place.py:298`).

**serve / access**
- Owner sign-in: scrypt password, HttpOnly SameSite=Strict cookie, Host check, Origin check on
  writes. Viewers: LAN or the existing private link.
- Owner only: settings, places, secrets, restart. Viewer follows do not spend credits unless a
  setting allows; `range`/`reach` clamped. Key not logged (`__main__.py:182`); files 0600.
- Request timeout; `access.py` split into admission (serve) and file/service changes (operate).

**operate**
- `sudo cloudwall install --role wall|station|panel`: idempotent; converges user `cloudwall`,
  `/opt/cloudwall` (unpacked releases, `current` symlink, run as `python3 -m cloudwall`),
  `/etc/cloudwall`, `/var/lib/cloudwall`, `/var/cache/cloudwall`, hardened system units, the
  tunnel user's sshd `Match` drop-in with `ClientAliveInterval`, an imported Caddy site file.
- `uninstall`, `doctor`, `backup`, `restore`; one-time `migrate-legacy` (stops the old user
  unit, moves `~/.config`, `~/.local/share`, `/etc/adsb-tunnel`, Coverage3D paths).
- Link: settings in the config file, units generated, DNS name not a resolved IP, gzip,
  cursors and caps on history, two-step pairing (the Pi prints one line; the VPS accepts it).
- `--public` re-implemented here on the Caddy site file; the stale Caddy branch is not rebased.
- Backup covers config, secrets, databases, `places.json`, link keys, owner hash, private-link
  key; each machine keeps a copy of the other's through the link. A written rebuild inventory
  for what it cannot hold: adsb.im's own backup (feeder IDs), SDR serials and driver
  blacklist, the pinned rtl_airband build, DNS, firewall, panel autostart.

**share**
- The sharing guide becomes an on-demand owner tool with a one-time token, not a standing
  root web server; "form not found" reported as such, not as "busy".

## 3. Help, built in

- Every setting has a plain explanation, unit, example, safe range and consequence ("uses paid
  credits", "restarts CloudWall"). A test fails if one is missing; the same text is the
  comment in the config file.
- A glossary (ADS-B, MLAT, gain, squelch, ppm, tunnel...) linked wherever a term appears.
- Guided set-ups with a live check at each step: first run, pair a receiver, add a radio,
  share data, go public.
- Every health state says what it means and what to do, identically in Overview and `doctor`.
- A handbook for routine administration (update, back up, restore, rebuild, move to a new
  Pi), one source for the Help tab and `cloudwall help <topic>`.
- A masked support report to paste.

## 4. Stages (each a mergeable PR, tests green, system usable after each)

0. **Gather.** Fast-forward the feeder tools; merge radio and Coverage3D as they are; remove the
   committed station coordinates from Coverage3D's example.
1. **Fix in place** (flat layout, small PRs): key in log, pin/range clamps, DB-error
   isolation, enricher prune, Merged timeout, leaks, tile cache bound, config key drift,
   demo isolation, stale docs.
2. **Seams:** one fetch patch point (`tests/test_cloudwall.py` patches per-module names today),
   one data-path constant, the splits (`config`, `store`, `access`, `sources`), the layer-map
   test on the flat modules, `pyproject` package discovery, recursive `CodeWatch`.
3. **Move** modules into layers: renames only.
4. **Install and operate:** layout, units, install/uninstall/doctor/backup/restore/migrate, Caddy.
5. **Access:** owner sign-in and roles.
6. **Settings:** schema, generated config file, Setup, Overview, Help.
7. **Station**, in four parts: read port; managed Link; receiver facts; sharing tool.
8. **Coverage** folded in; `coverage3d/` and its installer deleted.
9. **Radio:** hardware session first; Sensor interface; calls store; Radio tab; transcription.
10. **Docs** rewritten around the new shape; old scripts deleted.

## 5. Verification

- `python3 -m unittest discover -s tests` green at every stage; new tests: layer rule, schema
  completeness (help included), migrations, roles, install into a temporary root
  (`cloudwall install --root <dir>`), backup/restore round trip.
- `cloudwall --demo` plus the browser smoke test after anything under `web/`.
- On the real machines (not possible from a cloud session; the owner runs these):
  `cloudwall doctor` on both after stages 4 and 7, then a rebuild drill: backup, fresh
  install, restore.
- Stage 9 depends on a session with the real dongle; the radio README lists the assumptions.

## Progress

| Stage | State |
|---|---|
| 0. Gather | Done: feeder tools, radio and Coverage3D merged; station coordinates removed |
| 1. Fix in place | In progress |
