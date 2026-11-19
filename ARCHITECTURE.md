# How CloudWall works

A map of the code for whoever changes it next. The README says what CloudWall does and how to
set it up; this says how it is put together and where each thing lives.

## In one paragraph

CloudWall is one Python process (standard library only) and one web page (plain ES modules, no
build step). For each place it watches, the process reads a public ADS-B feed every few seconds,
works out everything a screen needs to show (who is overhead, where it is going, what is nearby),
keeps a logbook in SQLite, and serves the result as JSON. The page asks for that JSON every two
seconds and draws it. All knowledge of aviation data lives in the server; the page only draws, so
every screen (desktop, phone, wall panel) is the same page with a different layout.

```
   public services                      the CloudWall process                      screens
 ───────────────────        ─────────────────────────────────────────────       ─────────────
                             one Place for each place watched
 adsb.fi / adsb.lol ──5 s──▶ poll thread ──▶ Tracker.update() ─┐
                                              │  ▲              │ snapshot()
 adsbdb.com (routes,         Enricher: two    │  │ what is      ▼
   airframes) ◀──on demand── worker threads ◀─┘  │ cached    HTTP server ◀──2 s── /api/state
 planespotters (photos)      (cache first)       │           (a thread a          /api/weather
 Flightradar24 / FlightAware                     │            request)            /api/logbook
   (paid, optional) ◀─────── LiveProvider ───────┘               │                /api/heat
                             (one budget for every place)        ├── /tiles/…  ◀── radar map
 aviationweather.gov ─5 min▶ weather thread ─▶ tracker.weather   ├── /logos/…  ◀── flight card
 tfr.faa.gov ───────15 min─▶ extras thread ──▶ tracker.tfrs      └── web/ (the page itself)
 open-meteo (GFS) ─────1 h─▶      "       ──▶ tracker.contrails
 adsb.fi /mil ───────60 s──▶      "       ──▶ tracker.heard
 Esri / OSM / FAA charts ◀── Charts + Tiles (disk cache, a month)
 pics.avs.io ◀────────────── Logos (disk cache, three months)

 SQLite, one file a place: sightings (the logbook) and cache (lookups, usage counts, heatmap)
```

## The server (`cloudwall/`)

| Module | What it owns |
|---|---|
| `__main__.py` | Start-up: reads the config, builds the stores, the shared charts, logos and paid provider, a `Place` for each place, and the HTTP server. |
| `config.py` | Defaults overlaid with the TOML file; turns `[home]`, `[airport]` and `[[places]]` into one complete config per place (home located, airport filled in from the tables). The file's settings are checked as it is read (`check`): a wrong kind of value is refused by name, an unknown name warned about. |
| `place.py` | `Place`: one watched place and its three threads (positions, weather, extras). `Places`: the set of them, including those added from a screen (`places.json`). `AnyActivity`: "is any screen open at all". Each thread's loop is restarted if it trips on an error nobody foresaw (`_keep_going`). |
| `activity.py` | `Activity`: when a screen last asked for data. Everything that costs a request checks it. |
| `sources.py` | Position feeds: `Feeds` (readsb-style JSON with failover), `normalise()` into CloudWall's aircraft shape, the military "heard nearby" feed, and `Demo` (simulated traffic). |
| `tracker.py` | The core. `update()` turns a list of positions into the board state: distance, bearing, elevation angle, closest approach, on-ground and arriving/departing inference, route checks, the aircraft overhead, emergencies, logbook entries and badges, trails, whole paths and the heatmap. `snapshot()` is what a screen gets. |
| `enrich.py` | `Enricher`: non-blocking lookups. Returns what is cached now and fetches the rest on worker threads: routes and airframes (adsbdb), photos (planespotters), and the paid provider's route. What it holds in memory is bounded, and its workers stop when their place is removed. |
| `live.py`, `flightradar24.py`, `flightaware.py` | The optional paid route providers. `LiveProvider` holds the key, the credit budget (monthly allowance spread over the days left) and the back-off; the two subclasses know each API. |
| `store.py` | SQLite: the `sightings` table (the logbook and its queries) and a `cache` table of JSON values by kind and key. One connection, one lock. `prune()` clears cached values past their use; each logbook notes the place it is kept at (`claim`, `another_places`). |
| `weather.py`, `tfr.py`, `contrails.py` | Fetch and decode METAR/TAF, FAA flight restrictions, and the contrail forecast into plain values and words. |
| `airports.py`, `seats.py`, `wake.py`, `geo.py` | Bundled tables (airports, runways, ZIP codes, airspace, navaids, seats, wake categories) and the geometry helpers. `tools/build_data.py` rebuilds the tables. |
| `tiles.py`, `charts.py`, `logos.py` | Disk-cached proxies: map and chart tiles (only around the watched places), and airline logos. |
| `server.py` | `ThreadingHTTPServer`: the JSON API, the proxies, and the static page. |
| `http.py` | `get_json` / `get_text` with CloudWall's User-Agent. |

### One update, start to finish

1. `Place._poll` asks the feed for aircraft within `tracker.fetch_radius()` (the tracking radius,
   or further while a screen shows a longer-range radar) and calls `Tracker.update(raw)`.
2. `update` derives geometry for every aircraft, splits them into those within the tracking
   radius and those `beyond` it (radar only), then enriches the ones that matter: the ten
   nearest, anything about to pass overhead, emergencies, and any a screen follows. A followed
   flight the feed left out this time is carried on from its last report, moved along its
   track, for up to 30 s (`_coast`), so a gap in the feed doesn't make its screen let go.
3. `_enrich` asks the `Enricher` for the airframe, photo and route. Nothing blocks: a lookup that
   isn't cached is queued and shows up in a later update. A route is checked against where the
   aircraft actually is (`geo.route_plausible`), and a paid provider's route replaces the free
   one when there is one.
4. Under the tracker's lock: pick the aircraft overhead (highest elevation angle, with
   hysteresis), log overhead aircraft to the logbook, remember trails and paths, guess the
   runway flow, and swap in the new lists.
5. A screen's `GET /api/state` calls `snapshot(pin)`, which adds that screen's own choice of
   flight (its pin), the weather, restrictions and budget, and returns one JSON document.

### Threads and locks

Per place: one position poller, one weather thread, one extras thread, two `Enricher` workers
(routes and airframes; photos). Shared: the HTTP server (a thread per request) and, with a
Flightradar24 key, its hourly usage check. All are daemon threads. Building an object starts
none of them and makes no request: `Place.start()` and `LiveProvider.start()` do, and a removed
place's threads all end.

A poll has two ways to fail, and they are told apart: the feed not answering (a warning; the
screen says "offline" after 30 s), and CloudWall failing to work the board out from an answer
(logged with its traceback). Within an update, one aircraft's record that can't be used is left
out and the rest go ahead.

`Store.lock` is always the innermost lock: `Tracker.lock`, `Enricher.lock` and
`LiveProvider.lock` may each be held while the store is used, never the other way round, and
none of those three is taken while another is held.
Aircraft dicts are built outside the tracker's lock and never changed after they are swapped in,
so a snapshot can be serialised without holding it.

### Rules the code keeps

- **Only while someone is looking.** `/api/state` and `/api/weather` touch the place's
  `Activity`; after 90 s without a screen the poller pauses (or slows, with `when_idle = "log"`)
  and weather, extras and paid lookups stop.
- **Paid lookups are rationed.** Only for aircraft overhead, about to be, or followed; once per
  flight (45 minutes); counted before they are sent; never past the day's share of the budget.
- **The display only draws.** Decoding, units and wording of data happen in Python; the page
  gets values ready to show.
- **No dependencies.** Python standard library on the server, no framework or bundler in the page.
- **Nothing grows without bound** in a process meant to run for months: finished flyovers leave
  `Tracker.active`, lookups in memory are capped, and cached rows past their use are cleared
  every few hours. Only the logbook itself is kept for good.

### HTTP API

| Request | Returns |
|---|---|
| `GET /api/state?place=&range=&square=1&pin=` (`kiosk=1` instead of `place` for the wall panel) | Everything a screen shows for one place. `range`/`square` say how far its radar looks; `pin` is the flight it follows. |
| `GET /api/weather` | Decoded METAR, 24 h of history, TAF, contrail levels, restrictions. |
| `GET /api/logbook`, `GET /api/heat` | Logbook totals, records and recent flyovers; today's heatmap grid. |
| `GET /api/locate?q=` | Where a ZIP code or coordinates are, and the airline airports nearby. |
| `POST /api/places`, `DELETE /api/places?id=` | Add a place from a screen; remove one added that way. |
| `GET /tiles/<layer>/z/x/y`, `GET /logos/<IATA>` | Cached map/chart tile; cached airline logo. |
| `GET /`, `/kiosk`, other paths | The page (`web/index.html`) and its files. |

There is no authentication: CloudWall is meant for a home network. The two requests that change
anything (`POST` and `DELETE /api/places`) are refused when a browser says they come from another
site's page (`Origin`, `Sec-Fetch-Site`), and a request body over 16 KB isn't read.

### What is stored where

| Where | What |
|---|---|
| `cloudwall.db` (first place), `cloudwall-<id>.db` (each other place) | `sightings`: one row per flyover. `cache`: lookups (`route` 7 days, `aircraft` 30 days, `photo` 1 day, `live_route` 45 minutes, `fa_airport` a year), the paid provider's usage per day (in the first place's file), the heatmap per day, and the place the logbook is kept at. Rows past those ages are cleared. |
| `places.json` beside it | Places added from a screen, each with its id. |
| `tiles/`, `logos/` beside it | Downloaded tiles (a month) and logos (three months). |
| Browser `localStorage` (`cloudwall.*`) | This screen's settings: place, scope, radar style, tracks, range, night, sound. |
| Browser `sessionStorage` (`cloudwall.pin`) | The flight this tab follows. |

## The page (`cloudwall/web/`)

One `index.html`, one `style.css`, ES modules in `js/`. The layout (desktop, phone, kiosk) is
chosen by class names on `<html>`; the modules are the same for all three.

| Module | What it owns |
|---|---|
| `app.js` | The conductor: polls `/api/state`, holds the current `state`, switches views, renders the board and logbook, the place menu, and wires up every button. |
| `hero.js` | The flight card for the aircraft overhead, and the desktop's quiet-sky slides. |
| `kiosk.js` | The wall panel's large card and slides. |
| `scope.js` | The radar (chart and ATC styles) and the sky dome: a static layer rebuilt on each update and one persistent SVG group per aircraft, moved every frame. |
| `weather.js`, `astro.js`, `sky.js` | The Weather tab and slide; sun and moon; day/night. |
| `emergency.js` | The red takeover for 7500/7600/7700. |
| `silhouette.js`, `profiles.js`, `profiles/*.js`, `plate.js`, `data.js` | Aircraft side elevations drawn from measurements, the type plates and fleet line-up, and the type and airline tables. |
| `divider.js` | The divider that hides or resizes the Nearby list beside the radar. |
| `fx.js`, `util.js` | Split-flap and rolling-number effects, chimes; DOM, formatting and geometry helpers. |

Between updates the page moves aircraft itself: each position is dead-reckoned from the time
the feed reported it (the server's `status.updated`, not the time the page fetched it) and eased
toward each new report. Countdowns use the same clock (`since(state)` in `util.js`).

## Where to add things

- **A data source for positions:** a class with `name` and `fetch(lat, lon, radius_nm)` returning
  `normalise()`d dicts, in `sources.py`.
- **Something fetched now and then (like TFRs):** a job in `Place._extras`, a field on the
  tracker, a key in `snapshot()`.
- **A field on the flight card:** set it in `Tracker._enrich`, show it in `hero.js`
  (`renderFacts`) and, if it earns the space, `kiosk.js`.
- **A chart layer:** an entry in `charts.FAA_LAYERS`; the page asks for it by name.
- **An aircraft type:** its length in `data.js` and its family in the right `profiles/` file;
  `tests/test_silhouettes.py` checks the two agree.
- **A setting:** its default in `config.DEFAULTS` (which is also what says what kind of value it
  takes), a line in `config.example.toml`.
- **A folder of files under `web/` or `data/`:** list it in `pyproject.toml`'s package data
  (a test checks this).

## Tests

`python3 -m unittest discover -s tests`. `tests/test_cloudwall.py` covers the server side with
stubbed feeds and providers; `tests/test_silhouettes.py` runs the drawing modules under Node.
The tests stay on the machine: `setUpModule` stops any request to another host and fails the
run if one was tried, and `.github/workflows/tests.yml` runs them on every pull request.
`cloudwall --demo` runs the whole thing on simulated traffic. The demo's feed updates every
second where the live one updates every five, so timing between updates is worth checking
against a slower feed too.
