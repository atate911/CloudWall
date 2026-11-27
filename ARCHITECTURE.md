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
   public services                      the CloudWall process                         screens
 ───────────────────       ──────────────────────────────────────────────────      ─────────────

                            a Place for each place watched
 adsb.fi / adsb.lol ─5 s──▶ poll thread ──▶ Tracker.update() ──┐
 open-meteo (GFS) ───1 h──▶ extras thread ─▶ contrails         │ state()
                            weather thread, extras thread      ▼
                              │ ask                         HTTP server ◀──2 s── /api/state
                              ▼                             (a thread a          /api/weather
                            Shared: fetched once for          request)           /api/logbook
                            every place                          │               /api/heat
 aviationweather.gov ─────▶   an airport's weather               ├── /tiles/…  ◀── radar map
 tfr.faa.gov ─────────────▶   the country's restrictions         ├── /logos/…  ◀── flight card
 adsb.fi /mil ────────────▶   military heard, no position        └── web/ (the page itself)
 adsbdb.com, planespotters ◀─ Enricher: routes, airframes,
 Flightradar24/FlightAware ◀─   photos, the paid route (one
   (paid, optional)             budget), on two worker threads
 Esri / OSM / FAA charts ◀── Charts + Tiles (disk cache, a month)
 pics.avs.io ◀────────────── Logos (disk cache, three months)

 SQLite, one file a place: its logbook (sightings) and its heatmap.
 The first place's file also holds what all share: cached lookups and the paid provider's usage.
```

## The server (`cloudwall/`)

It is layered, each layer using only those below it:

```
 __main__      start-up: builds everything below and joins it together
 server        HTTP; asks a place for its state, weather report, heatmap and logbook
 place         one watched place: its threads, its weather and airspace, what a screen is given
 tracker       positions into the board        shared    what every place shares
 details  logbook  tracks                      enrich    lookups, cached, never blocking
 sources  weather  tfr  contrails  live/flightradar24/flightaware     the services, one module each
 airlines  aircraft  airports  seats  geo  store  http  activity      tables, sums and storage
```

| Module | What it owns |
|---|---|
| `__main__.py` | Start-up: reads the config, builds the stores, the charts and logos, the paid provider, the `Shared` services, a `Place` for each place, and the HTTP server. |
| `server.py` | `ThreadingHTTPServer`: the JSON API, the tile and logo proxies, and the static page. All it asks of a place is `state()`, `weather_report()`, `heatmap()` and `logbook()`; it adds what is the same for every place (the map, the chart layers, logos). |
| `place.py` | `Place`: one watched place. Its three threads (positions, weather, extras), restarted if one trips on an error nobody foresaw; what they fetch (weather, restrictions, military heard, contrail forecast); and the four things a screen asks for. `Places`: the set of them, including those added from a screen (`places.json`). `AnyActivity`: "is any screen open at all". |
| `shared.py` | `Shared`: what is the same wherever it is asked from, fetched once for every place: the `Enricher`, an airport's weather, the FAA's list of restrictions, the military feed. `once(key, max_age, fetch)` is the whole mechanism. |
| `tracker.py` | The feed's positions into the board: distance, bearing, elevation angle and closest approach from here, the aircraft overhead, the flights screens follow (and carrying one over a gap in the feed), runway flow, radar range, emergencies. `update()` takes an answer from the feed; `snapshot()` is the board as it stands. |
| `details.py` | What is known of an aircraft beyond its position: airframe, photo, airline, seats, its route checked against where it actually is, the paid route when there is one, and whether it is arriving at or leaving the airport. |
| `logbook.py` | Which flyovers are logged: one entry a pass, its badges, back-filling what is learned later. (The rows and the Logbook tab's totals are `store.py`'s.) |
| `tracks.py` | Each aircraft's recent positions and whole path, and the day's heatmap. |
| `situation.py` | The traffic picture: each aircraft arriving, departing, flying locally or passing over; the arrivals' landing order, runway, time to touchdown and gap to the one ahead; what's worth a look; every aircraft's last two minutes of track. |
| `medical.py` | Medical flights: by transponder (lifeguard), operator or callsign, or a helicopter landing at or leaving a hospital's helipad (`data/helipads.csv`); and the helipad a helicopter is landing at, has left or (a medical one) is heading for, said only when no other helipad is on its line, and kept while it stays on course. Run by `situation.describe` for every airborne aircraft. |
| `enrich.py` | `Enricher`: non-blocking lookups, one for the process. Returns what is cached now and fetches the rest on two worker threads: routes and airframes (adsbdb), photos (planespotters), the paid provider's route. What it holds in memory is bounded. |
| `live.py`, `flightradar24.py`, `flightaware.py` | The optional paid route providers. `LiveProvider` holds the key, the credit budget (monthly allowance spread over the days left) and the back-off; the two subclasses know each API. |
| `sources.py` | Position feeds: `Feeds` (readsb-style JSON with failover), `normalise()` into CloudWall's aircraft shape, the military "heard, no position" feed, and `Demo` (simulated traffic). |
| `weather.py`, `tfr.py`, `contrails.py` | Fetch and decode METAR/TAF, FAA flight restrictions, and the contrail forecast into plain values and words. |
| `airlines.py`, `aircraft.py` | The two reference tables everything asks: airlines (`data/airlines.csv`: code, name, freight-only, colours) and aircraft types (`data/types.csv`: shape, length, rarity, radar icon; `data/cwt.csv`: wake category). `aircraft.icon()` also decides which kind of traffic an aircraft is drawn as on the radar. |
| `access.py` | The private link: with `[server] key` set, the server answers only under `/k/<key>/` and goes on as if the prefix weren't there (the page's addresses are all relative, so each carries the key; no cookie). Makes keys that are easy to type and hard to guess, and refuses a weak one in the config. |
| `about.py` | What's worth knowing about a type, for the panel a tap on one opens: a write-up, facts chosen for it and the years it was delivered, written by hand one file per family in `data/types/` (its README sets out the format and how they're written). Read once, at the start; a file with a problem is left out with a warning, and the tests list every problem. `tools/type_notes.py` says which types still want one, the most seen first. |
| `airports.py`, `seats.py`, `geo.py` | The other bundled tables (airports, runways, ZIP codes, airspace, navaids, seats) and the geometry helpers. `tools/build_data.py` rebuilds the generated ones. |
| `store.py` | SQLite: the `sightings` table (the logbook and its queries) and a `cache` table of JSON values by kind and key. One connection, one lock. `prune()` clears cached values past their use; each logbook notes the place it is kept at (`claim`, `another_places`). |
| `tiles.py`, `charts.py`, `logos.py` | Disk-cached proxies: map and chart tiles (only around the watched places, except the route map's world layer at zoom 6 and out), and airline logos. |
| `config.py` | Defaults overlaid with the TOML file; turns `[home]`, `[airport]` and `[[places]]` into one complete config per place. The file's settings are checked as it is read (`check`): a wrong kind of value is refused by name, an unknown name warned about. |
| `activity.py`, `http.py` | `Activity`: when a screen last asked for data; everything that costs a request checks it. `get_json` / `get_text` with CloudWall's User-Agent. |

### What belongs to a place, and what to the process

A place watches one spot, but much of what it shows isn't about that spot, and is fetched once
however many places there are:

| One for each place | One for the process (`shared.py`, `__main__.py`) |
|---|---|
| The position feed's answer, the tracker and its board | Lookups of routes, airframes and photos, and their cache |
| The logbook, the heatmap, trails and paths | The paid route provider and its budget |
| The contrail forecast (it is for a point) | An airport's weather (two places may share an airport) |
| Which flights its screens follow, and how far their radars look | The FAA's list of restrictions and the military feed (each place takes its share) |
| Whether a screen is looking (`Activity`) | Map tiles, chart layers, logos, the reference tables |

So a second place costs a second position feed and nothing else, and a flight two places can
both see is looked up, and paid for, once.

### One update, start to finish

1. `Place._poll` asks the feed for aircraft within `tracker.fetch_radius()` (the tracking radius,
   or further while a screen shows a longer-range radar) and calls
   `Tracker.update(raw, source, idle=..., contrails=...)`: whether a screen is open, and the
   place's contrail forecast, are the two things an update is told from outside.
2. `update` derives geometry for every aircraft and splits them into those within the tracking
   radius and those `beyond` it (radar only). A followed flight the feed left out this time is
   carried on from its last report, moved along its track, for up to 30 s (`_coast`), so a gap in
   the feed doesn't make its screen let go.
3. For the ones that matter (the ten nearest, anything about to pass overhead, emergencies, any
   a screen follows) `Details.fill` asks the `Enricher` for the airframe, photo and route. Nothing
   blocks: a lookup that isn't cached is queued and shows up in a later update. A route is
   checked against where the aircraft actually is (`geo.route_plausible`), and a paid provider's
   route replaces the free one when there is one.
4. Under the tracker's lock: pick the aircraft overhead (highest elevation angle, with
   hysteresis), `Logbook.record` those overhead, `Tracks.remember` where everything is, guess the
   runway flow, mark what each aircraft is doing and put the arrivals in landing order on the
   runways in use (`situation.describe`), give each its last two minutes of track, and swap in the
   new lists.
5. A screen's `GET /api/state` calls `Place.state(pin, range, square)`: the tracker's snapshot
   with that screen's own choice of flight (its pin), plus the place's weather, restrictions,
   military heard and the provider's budget. The server adds the map and chart settings and the
   list of places, and sends one JSON document.

### Threads and locks

Per place: a position poller, a weather thread and an extras thread. For the process: the
`Enricher`'s two workers (routes and airframes; photos), the HTTP server (a thread per request)
and, with a Flightradar24 key, its hourly usage check. All are daemon threads. Building an object
starts none of them and makes no request: `Place.start()` and `LiveProvider.start()` do, and a
removed place's threads all end.

A poll has two ways to fail, and they are told apart: the feed not answering (a warning; the
screen says "offline" after 30 s), and CloudWall failing to work the board out from an answer
(logged with its traceback). Within an update, one aircraft's record that can't be used is left
out and the rest go ahead.

`Store.lock` is always the innermost lock: `Tracker.lock`, `Enricher.lock` and
`LiveProvider.lock` may each be held while the store is used, never the other way round, and
none of those three is taken while another is held. `Shared.once` holds a lock per thing fetched,
around the fetch, so places asking together wait for one answer.
Aircraft dicts are built outside the tracker's lock and never changed after they are swapped in,
so a snapshot can be serialised without holding it.

### Rules the code keeps

- **Only while someone is looking.** `Place.state()` and `weather_report()` touch the place's
  `Activity`; after 90 s without a screen the poller pauses (or slows, with `when_idle = "log"`)
  and weather, extras and paid lookups stop.
- **Paid lookups are rationed.** Only for aircraft overhead, about to be, or followed; once per
  flight (45 minutes) whichever places see it; counted before they are sent; never past the
  day's share of the budget.
- **The display only draws.** Decoding, units and reference facts are the server's: each record
  the page draws carries what it needs (an aircraft's shape and length for its drawing, the kind
  of icon it is on the radar, its airline's colours, its trouble code). The page keeps no tables
  of airlines or aircraft types.
- **One home for each fact.** An airline is a line in `data/airlines.csv`; an aircraft type a
  line in `data/types.csv`. Nothing else lists them.
- **No dependencies.** Python standard library on the server, no framework or bundler in the page.
- **Nothing grows without bound** in a process meant to run for months: finished flyovers leave
  the logbook's working set, lookups in memory are capped, and cached rows past their use are
  cleared every few hours. Only the logbook itself is kept for good.

### HTTP API

[API.md](API.md) lists every key of every answer, and `tests/test_api.py` holds the code to it.
In short:

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
| `cloudwall.db` (the first place) | Its logbook (`sightings`: one row per flyover, with where its closest point was and which way it was flying) and, in `cache`, its heatmap per day, plus what all places share: lookups (`route` 7 days, `aircraft` 30 days, `photo` 1 day, `live_route` 45 minutes, `fa_airport` a year) and the paid provider's usage per day. |
| `cloudwall-<id>.db` (each other place) | Its logbook and its heatmap per day. |
| Both | The place the logbook is kept at. Cached rows past their ages are cleared. |
| `places.json` beside them | Places added from a screen, each with its id. |
| `tiles/`, `logos/` beside them | Downloaded tiles (a month) and logos (three months). |
| Browser `localStorage` (`cloudwall.*`) | This screen's settings: place, scope, radar style, tracks, range, night, sound. |
| Browser `sessionStorage` (`cloudwall.pin`) | The flight this tab follows. |

## The page (`cloudwall/web/`)

One `index.html`, one `style.css`, ES modules in `js/`. The layout (desktop, phone, kiosk) is
chosen by class names on `<html>`; the modules are the same for all three. Type is B612 for words
and B612 Mono for codes (callsigns, airports, type designators, runways, raw reports), all in
sentence case; the rule is stated at the top of `style.css`. The modules are layered too:

```
 app                                         polling, the views, the radar's options, the wiring
 hero  kiosk  emergency  board  logbook  places  weather  scope  about    one display each
 parts  plate  icons  map  fresh  astro  sky  fx  divider          what several of them use
 silhouette  profiles  util                                        drawing and helpers
```

| Module | What it owns |
|---|---|
| `app.js` | The conductor: polls `/api/state`, holds the current `state`, switches views, keeps the radar's options, and wires up every button, the settings menu (sound, night mode) included. It draws nothing itself. |
| `hero.js` | The flight card for the aircraft overhead, and the desktop's quiet-sky slides. On the desktop the card is as tall as its row: one picture (the route map, else the aircraft's drawing) takes the room the words leave. `fitCard` tries the map in its three places (across under the airports, across and taking the drawing's room, or beside the facts in the drawing's place) and keeps the one that draws the route biggest, by `routeScale`, preferring those that keep the drawing; then lets the spacing, the map and the drawing go when the row is short. On a phone the map is as tall as its route needs (`routeHeight`). |
| `kiosk.js` | The wall panel's card (the aircraft overhead with its side elevation on the route line, or the quiet-sky slides) and the count under it. The card has the whole screen unless `[kiosk] view` puts the radar or the Map view beside it; with the card alone the radar comes in only as one of the quiet-sky slides (`body.radar-slide`), and isn't drawn otherwise. The side view along the runways (`profile.js`) is a quiet-sky slide too, drawn in the card, and nothing is under 4% of the screen's height; `test_the_wall_panel` checks that floor. |
| `emergency.js` | The red takeover for 7500/7600/7700. |
| `board.js` | The Board grouped by what each aircraft is doing, its two-line form for a phone, and the traffic list and side view beside the radar. |
| `situation.js` | The traffic picture in words and parts every screen shares: the strip's headline and a phrase for each group that doubles as the key (short in Simple), the grouped list, Simple's side panel (the next aircraft over the house, the landing queue, what's worth a look), and `renderInto`/`keepFocus`, which redraw a part of the page without losing the flap display or the keyboard's place. |
| `profile.js` | The side view along the runways: height against distance along the approach, the arrivals numbered down the 3° glide path. |
| `logbook.js` | The Logbook tab. |
| `about.js` | About a type: the panel opened from the button on the card's drawing and from each type in the Logbook's collection, laid out from `/api/type`, with what is worked out from it in words (where this airframe's build year falls in the type's deliveries, how often the type and the airframe have come over). |
| `places.js` | The place in the header and the desktop's menu of places. |
| `weather.js` | The Weather tab and the weather slide. |
| `timeline.js` | The next few minutes: who comes over the house, who lands, a medical helicopter reaching its hospital, as Simple's line of the next three and Detailed's ten-minute axis (`tickTimeline` moves it every second and keeps its labels apart). |
| `scope.js` | The radar (chart and ATC styles), the Map view (the flights on a satellite or street map, in words) and the Sky view (a dome of the sky above home): a static layer rebuilt on each update and one persistent SVG group per aircraft, moved every frame. Labels are placed on each update (`placeLabels`); every frame, the map's fixed names fade where traffic covers them (`giveWay`). |
| `compass.js` | The phone's compass for the Sky view: the heading from iOS's or Android's orientation events, smoothed, flat or held up. |
| `parts.js` | What several displays are made of: the logo tile, badges (kept in capitals by the server, shown in sentence case), a flight number as boards set it, "Landing at ...", records. |
| `map.js` | The ground under the displays: map tiles around home, the hand-drawn map, runways. |
| `routemap.js` | The flight card's route on a real map: world-layer tiles, borders and places (`maps/world.json`), the great-circle path, the aircraft on it. `frame` fits the path to the box with room for the airport codes and the country round each end; `pickCities` names places by Natural Earth's rank for the map's zoom, those along the route first and spaced along it, then others either side, each on the side away from the route, and none too small to mean anything; `pickRegions` names the states and countries the route crosses, at whichever of their name points has room. A scale bar, a ring at the origin, an arrowhead at the destination and the aircraft turned along the route say how far and which way. |
| `fresh.js` | One copy for the page of what changes slowly (weather, logbook, heatmap), fetched at most once a minute whoever asks. |
| `plate.js`, `silhouette.js`, `profiles.js`, `profiles/*.js` | Aircraft side elevations drawn from measurements, the type plates and the fleet line-up. |
| `icons.js` | The chart-style radar's top-down icons, one for each kind of traffic. Which kind an aircraft is comes on its record. |
| `astro.js`, `sky.js`, `fx.js`, `divider.js`, `util.js` | Sun and moon; day and night; split-flap and rolling-number effects and chimes; the Overhead view's two dividers, beside the card and beside the traffic list (which also hold the radar's column to its disc on a wide, short window, and never let it go narrower than its row of buttons); DOM, formatting and geometry helpers. |

Between updates the page moves aircraft itself: each position is dead-reckoned from the time
the feed reported it (the server's `status.updated`, not the time the page fetched it) and eased
toward each new report. Countdowns use the same clock (`since(state)` in `util.js`).

## Where to add things

- **A data source for positions:** a class with `name` and `fetch(lat, lon, radius_nm)` returning
  `normalise()`d dicts, in `sources.py`.
- **Something fetched now and then for a place (like restrictions):** a job in `Place._extras`
  setting a field on the place, and a key in `Place.state()`. If its answer is the same for every
  place, fetch it through `Shared.once`.
- **A field on the flight card:** set it in `Details.fill`, show it in `hero.js`
  (`renderFacts`) and, if it earns the space, `kiosk.js`.
- **Any key in an answer:** a row in [API.md](API.md), or `tests/test_api.py` fails. Removing one,
  or changing what it means, also raises `API` in `server.py`.
- **An airline:** a line in `data/airlines.csv`.
- **An aircraft type:** a line in `data/types.csv`, its write-up in `data/types/` (a test checks every
  type has one) and its family in the right `profiles/` file;
  `tests/test_silhouettes.py` checks the two agree. Its `icon` column names its radar icon where
  its shape doesn't (a light twin, a seaplane); a new kind of icon is drawn in `icons.js`.
- **A type's write-up:** a file in `data/types/`, as its README says, every fact checked against a
  source it lists; `python3 tools/type_notes.py --todo 10` gives the next ten to write.
- **A chart layer:** an entry in `charts.FAA_LAYERS`; the page asks for it by name.
- **Something several displays say the same way:** `parts.js`, not one of the displays.
- **A setting:** its default in `config.DEFAULTS` (which is also what says what kind of value it
  takes), a line in `config.example.toml`.
- **A folder of files under `web/` or `data/`:** list it in `pyproject.toml`'s package data
  (a test checks this).

## Tests

`python3 -m unittest discover -s tests` runs all of these; `.github/workflows/tests.yml` runs them
on every pull request.

| File | What it holds to account |
|---|---|
| `tests/test_cloudwall.py` | The server, with stubbed feeds and providers. It stays on the machine: `setUpModule` stops any request to another host and fails the run if one was tried. |
| `tests/test_api.py` | The shape of every answer, against [API.md](API.md): a key added, dropped or renamed fails until the reference says so, and a key the reference lists that nothing sends fails too. |
| `tests/test_browser.py`, `tests/browser_smoke.js` | The page, in headless Chromium against the demo: each layout and tab, following a flight, the radar's switches, the quiet-sky slides, an emergency, the server gone. Nothing on the console, nothing fetched from elsewhere. Needs Playwright (`npm install --no-save playwright && npx playwright install chromium`); skipped without it, except in the workflow. |
| `tests/test_silhouettes.py`, `tests/test_icons.py` | The aircraft drawings and the radar's icons, run under Node. |

The displays are drawing code with no unit tests of their own, so the browser test is what says a
change to the page didn't break one: run it after touching anything under `web/`.
`cloudwall --demo` runs the whole thing on simulated traffic. The demo's feed updates every
second where the live one updates every five, so timing between updates is worth checking
against a slower feed too.
