# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.fi](https://adsb.fi)
community feed (falling back to [adsb.lol](https://adsb.lol)), routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
airframe photos from [planespotters.net](https://www.planespotters.net), weather from aviationweather.gov. Pure Python standard library, no packages to install.

## Screens

- **Overhead** – a flight card for the aircraft closest to overhead: the flight number as a
  departure board shows it (with "operated by" for regional partners), the airline's logo,
  the route with distance flown and to go, the departure and arrival times under the airports
  and the flight time between them, altitude and climb or descent rate (with the
  altitude the autopilot is heading for, when it reports one), speed, distance and heading,
  and a photo of the airframe beside when it passes the house, the aircraft type,
  registration and build year, and what the autopilot is doing. The departure time comes from
  a paid route provider (see below); without one, the card shows an estimated arrival only.
  The photo is of that very airframe (planespotters.net files photos by airframe, so a tail
  number that once belonged to another aircraft doesn't bring up its pictures), credited to its
  photographer in its bottom right corner, with a link to the photo's page there.
  Under the photo sits a type plate: a side elevation of the type, drawn to scale over a
  dimension line with its length. With no photo, the plate fills the frame.
- **Sky view / radar** – beside the card, a dome view of the sky with the aircraft's
  path across it (centre is straight up), or a radar scope over a faint street map.
  Each aircraft on the radar shows its altitude in hundreds of feet, with an arrow when it is
  climbing or descending (`035↑`) and a line to where it will be in a minute. Only the selected
  aircraft (the one overhead, or one you tap) shows where it has been, so a busy sky stays
  readable: its whole track since it came in range or took off, as flight-tracking sites draw it,
  in magenta, strongest near the ground and fading with height in steps at 2,000, 5,000, 10,000,
  18,000 and 28,000 ft. CloudWall keeps every aircraft's track, so one you tap shows all of it at
  once. Both views have a compass bezel with bearings, and on the desktop a key in the corner.
  Auto shows the sky view while something is overhead; the Auto / Radar / Sky switch picks one.
  Along the foot of the radar, Chart / ATC picks its look (ATC draws it as a controller's STARS
  screen; see [The ATC radar](#the-atc-radar)), Tracks turns the tracks and one-minute lines on
  or off, and 15 / 20 / 30 sets the range in nm. Past the tracking radius
  (`[tracking] radius_nm`, 15 nm), aircraft are drawn on the radar only: the board, the flight card,
  the logbook and route lookups stay within it, and the longer range is fetched only while a
  screen shows it.
- **Quiet sky** – when nothing is overhead the card rotates through the next inbound
  aircraft (with its drawing, so you know what to look for), a heatmap of the day's traffic,
  today's fleet (every type seen since midnight, side by side at true relative size, from a
  Cessna to a 777), the day's records and the last flyover. Tap to skip ahead.
- **Board** – departure-board list of everything airborne in range. Tap a row (or a
  blip on the scope) to pin that aircraft to the flight card; tap the card to release.
  A pin belongs to the screen it was made on: following a flight on your phone leaves the
  wall panel and everyone else's screens showing what's overhead. It holds through a reload
  of the page and lets go when the flight leaves the area. If the feed loses a followed flight
  for a few seconds, as it does with low aircraft, CloudWall carries it on along its track for
  up to half a minute rather than letting go. The chime still sounds for a new aircraft overhead
  while you're following another.
- **Weather** – aviation weather for the airport from aviationweather.gov: flight category,
  a plain-English summary, temperature and dew point, humidity, altimeter, density
  altitude and sunset; a windsock seen from above at the middle of a compass of the
  runways (fully out at 15 kt, swinging in gusts) with headwind and crosswind for the
  best runway; cloud layers drawn by coverage with the ceiling marked; the last 24 hours
  of reports as charts (touch one to read that report); and the TAF forecast as a
  timeline. A compact version joins the quiet-sky rotation.
- **Logbook** – every flyover is logged: a drawn type collection (each type with its count
  and first sighting; a new one is marked on the flight card), airlines, daily and all-time
  records (highest, lowest, fastest, closest, furthest origin), flyovers by hour.

The display switches to its night chart, dim and dark, when the sun sets at your house;
the `Night` button forces it on or off. `Sound` turns on a soft chime when an aircraft comes overhead, with
a different one for rare, military or emergency traffic.

Badges mark the interesting ones: `NEW TYPE`, `NEW AIRLINE`, `RARE TYPE`, `HEAVY`,
`HELICOPTER`, `MILITARY`, repeat visitors (`3rd VISIT`) and emergency squawks.

## Install (Linux dev server)

Needs Python 3.11+ with the `venv` module and `make`.

```sh
git clone https://github.com/atate911/CloudWall.git && cd CloudWall
make install      # creates .venv and installs CloudWall in editable mode
make demo         # simulated traffic, works offline
```

Open `http://<server>:5050`. For real traffic:

```sh
make config       # writes ~/.config/cloudwall/config.toml; set [home] lat/lon or zip
make run
```

CloudWall checks the file as it starts. A setting it can't use (text where a number belongs,
say) stops it with a line naming the setting; a name it doesn't know, most often a typo, gets a
warning in the log and is otherwise ignored.

The install is editable, so changes to the Python or to `cloudwall/web/` take effect
without reinstalling: restart for Python changes, just reload the browser for the
web files.

After an update (`git pull`), restart CloudWall: `make restart` for the service below, or stop
`make run` and start it again. Until then the server keeps running the old code while browsers
load the new pages, so anything new on both sides (such as setting a location) can't work; the
header says **Updated: restart CloudWall** while that's so.

To keep it running in the background across logouts and reboots:

```sh
make service      # systemd user service; `make logs` to follow, `make service-remove` to undo
```

`make help` lists every task. Without make: `pip install -e .` then `cloudwall`.

### Where things live

| What | Where |
|---|---|
| Settings | `--config`, `$CLOUDWALL_CONFIG`, `./config.toml`, then `~/.config/cloudwall/config.toml` |
| Logbook database | `~/.local/share/cloudwall/cloudwall.db` (or `[storage] db_path`, or `--db`); each extra place gets its own beside it, such as `cloudwall-cabin.db`, and places set up on the desktop are in `places.json` there |
| Port | 5050 (`[server] port`, or `--port`) |

## Locations

Home is set by GPS coordinates, `[home] lat` and `lon` (the default is east Vancouver, WA, under
PDX's 28L/28R final), or by a US ZIP code, `[home] zip = "98683"`, which places it at the centre of
that ZIP code's area. Its airport is the closest major one unless `[airport] icao` names another:
the nearest large airport within 30 nm, else the nearest with airline service, so PDX for anywhere
in Vancouver, Redmond for Bend.

From the airport's code CloudWall fills in the rest from bundled tables: its name, city, position
and elevation, its runways (for the radar, the wind rose and which way it's landing) and the
smaller fields nearby. The tables: airports from airportsdata (MIT licence); small fields it lacks,
such as Pearson Field and Grove Field around Vancouver, in `cloudwall/data/fields.csv`; runways
and which airports have airline service from OurAirports (public domain); ZIP codes from the
Census Bureau's 2025 ZIP code areas (public domain); aircraft types' wake categories, for the
ATC radar's data blocks, from openScope's aircraft data (MIT licence); Class B, C and D airspace
and the VOR and TACAN stations, for the ATC radar's video map, from the FAA's NASR data (public
domain) as packaged by the `@squawk/airspace-data` and `@squawk/navaid-data` npm packages (MIT).
`python3 tools/build_data.py` rebuilds them.
For an airport the tables don't cover, give its `iata`, `city`, `lat` and `lon` too.

**More places.** Add a `[[places]]` entry for each, by coordinates or ZIP code:

```toml
[[places]]
name = "Cabin"
zip = "97702"          # or lat = 44.0600 and lon = -121.3100
airport = "KRDM"       # optional: the closest major airport when left out
elevation_ft = 3600    # optional: the airport's when left out
```

On the desktop, the airport code beside "CloudWall" in the header opens a menu of the places.
"Set a location…" there takes a ZIP code or coordinates, shows where that is and the airline
airports near it, and keeps the closest major airport unless you choose another; the screen then
shows the new place. Places set up this way are saved beside the logbook (`places.json`) and can
be removed from the same menu; those in the config file stay. A removed place's logbook stays on
disk: set the same place up again and it carries on in it, while a different place given the
same name starts one of its own. Each screen remembers its own place, so the kiosk can show home
while a laptop shows the cabin.

The kiosk has no menu: it shows `[kiosk] place` (a place's name, the first when empty), and
`?place=` in the address picks one on any screen.

Each place keeps its own logbook, and its data is fetched only while a screen is showing it. What
isn't particular to a place is fetched once for all of them: a flight in range of two places is
looked up once (and, with a paid route provider, paid for once, from the one budget), two places
with the same airport share its weather, and the FAA's list of flight restrictions is downloaded
once however many places there are. A second place costs a second position feed and little else.

## Seats on board

Each flight card shows its seats, estimated from the operator and aircraft type with a bundled
table (`cloudwall/data/seats.csv`, no lookups or credits). Where an airline flies one layout
the card shows that number ("178 seats"). Where it flies several, it shows the range ("160–172 seats").
For other airlines it shows a typical count for the type ("about 166 seats"). Cargo flights count as
none. The Logbook totals the seats that flew over today and all time. Edit the CSV to add an
airline's layout; rows for a specific airline win over the typical ones.

## Emergencies, military jets, airspace and the sky

- **Emergencies.** An aircraft within range squawking 7700 (emergency), 7600 (radio failure) or
  7500 (hijack code) takes over the screen and turns it red, with an alert sound when sound is on.
  It must hold the code for two updates, so a code set by mistake for a second doesn't trigger it. On the
  desktop, "Hide for this flight" puts it back to normal and the red header chip brings it back; the
  kiosk stays red until the code is cleared.
- **Military jets.** Military aircraft that the network can place show on the radar like any
  other. Many fighters send altitude but no position. When receivers near Portland hear one,
  CloudWall shows "Heard nearby, no position" on the radar and Board, plus an idle slide.
- **Flight restrictions (TFRs).** The FAA's temporary flight restrictions within 30 nm are drawn on the
  radar, listed on the Weather tab with times, altitudes and the full notice, and shown on an idle
  slide while one is active. Drone-only restrictions are listed but don't interrupt the board.
- **Small fields nearby.** Around Vancouver that's Pearson Field, Grove Field in Camas, Troutdale,
  Scappoose and Hillsboro, whichever are within the tracking radius of home. Light aircraft low
  over one are labelled "Landing at Pearson Field" and so on, instead of being taken for PDX
  traffic, and each is drawn on the radar as a sectional chart draws it: a circle with its runways
  inside. Fields the airport table lacks are listed in `cloudwall/data/fields.csv`; add your own
  there, or list them under `[airport] others`.
- **Sun, moon and contrails.** The Weather tab shows first light, sunrise, sunset, last light, the
  moon's phase, rise and set, and a contrail forecast by altitude from the GFS weather model's
  upper-air temperature and humidity. The moon appears on the sky view when it's up, and a flight card
  says when the aircraft is likely leaving a contrail.

These use free services (adsb.fi, tfr.faa.gov, api.open-meteo.com) and pause when no screen is open.
Turn any of them off in `[extras]`.

## Production on dedicated hardware

On the Pi, install the same way and run `make service`. Then start `deploy/kiosk.sh`
from the desktop autostart to open the board full-screen. To drive a display from a
board running elsewhere, set `CLOUDWALL_URL=http://<server>:5050` for the kiosk script.

## Three layouts

| Address | For | What it shows |
|---|---|---|
| `http://<server>:5050/` | A PC or laptop | Everything: Overhead, Board, Weather and Logbook tabs, the radar and sky switch, sound and night buttons. On screens 1500 px wide and up, the Overhead view adds a live list of nearby flights; click one to follow it. The arrow on the divider between the radar and the list hides or shows the list, and dragging the divider gives the radar more or less room (double-click it for the usual width); the flight card keeps its size, and each screen remembers its setting. |
| `http://<server>:5050/` on a phone | A phone in the hand | The same tabs and switches, laid out for a phone. Upright, the page scrolls: the flight card at full width, then a square radar with its switches above and below it, the tabs along the foot and the status line held at the top. The Board becomes a two-line list (flight, route and when it's overhead; airline, type, altitude and speed), and Weather and Logbook stack into one column. Turned sideways, the card and radar sit side by side. Tapping a blip on the radar brings its flight card into view. |
| `http://<server>:5050/kiosk` | A 7.5" or 13.3" wall panel | Built to read from across the room: one big card (flight number, airline logo, route, altitude, speed and time until overhead) beside the radar or sky view. No tabs, buttons or small print. When the sky is empty it rotates every 12 seconds between the next flight, the weather with a windsock, and today's count. Tap the card to skip ahead. Tap a blip to show that flight; it goes back to what's overhead after 90 seconds untouched, or when the card is tapped. |

The phone layout is chosen by screen size (up to 700 px wide, or 500 px tall when turned sideways),
so it follows the phone as it turns and also suits a narrow desktop window. `?mode=phone` forces it and
`?mode=desktop` keeps it off.

`?mode=kiosk` on any address does the same as `/kiosk`. The kiosk sizes everything from
the screen's height, so the 1024×600 and 1920×1080 panels look the same.

The kiosk has no buttons, so its radar is set in the config file:

```toml
[kiosk]
radar = "atc"      # "chart" (the default) or "atc"
tracks = true      # the selected aircraft's track, and one-minute lines
range_nm = 30      # 0 for the tracking radius, or 20 or 30
```

The address can override these on any screen: `/kiosk?radar=atc&tracks=off&range=20`.

## The ATC radar

The ATC style draws the radar as a terminal controller sees it on STARS, the FAA's terminal
radar display, following its conventions (layouts, symbols, colours and timings as described
by the FAA's STARS documentation and the open-source [vice](https://github.com/mmp/vice) STARS
simulator). Like a real one, it has no chart underneath: a controller's screen is black, with
line maps ("video maps") of what the controller needs on top:

- **The screen** is square. Its range (15, 20 or 30 nm) is from the centre to the edge, as on
  STARS, so the corners reach about 1.4 times as far; the server fetches traffic out to them. A
  compass runs along the edge, a tick every 5° and the bearing every 10°. Range rings are every
  5 nm. The grey video map has the runways, the final approach courses marked every mile, the
  Class B and C airspace around (Portland's Class C, its surface area and five shelves, each
  marked with its ceiling over its floor in hundreds of feet: `40/SFC`, `40/17`), the airport's
  own Class D if it has one, the VOR and TACAN stations (Battle Ground, Columbia, Newberg) as
  hexagons with their identifiers, the river and the small airfields; flight restrictions are
  outlined in yellow. `[map] atc` can still put an FAA chart underneath (below).
- **Targets** are blue (STARS's fused tracks), each with a position symbol on it. A track with
  a flight plan shows the letter of the position that owns it: here **A** for an arrival at the
  airport, **D** for a departure, **C** for the rest (the en route centre's). A track with no
  flight plan (VFR on code 1200) shows **\*** with a limited data block, its altitude; one
  reporting no altitude shows **+** and no block.
- **Full data blocks**, at the end of a leader line, read:

  ```
  ASA512          callsign
  037 17 F        altitude (hundreds of ft), ground speed (tens of kt), rules, wake category
  ```

  The second line takes turns with the aircraft type (`037 B739`) on STARS's clock: two
  seconds of speed, one of type. The rules letter is `V` for VFR; the wake category is the
  FAA's Consolidated Wake Turbulence group, A (super) to I (small). Emergency codes show in
  red above the callsign: `EM` (7700), `RF` (7600), `HJ` (7500). Blocks are green, and white for
  the aircraft this screen tracks, the one overhead. Leaders point north unless that crowds
  another block, then whichever of the eight directions is clear, as a controller would set
  them; blocks to the left of their leader are right-justified against it.
- **History dots** trail the aircraft this screen tracks (only that one, to keep a busy scope
  clear), five of them 4.5 seconds apart (as near as the feed's updates allow) in fading blues,
  and a white **predicted track line** shows a minute ahead of every target. Tracks turns both
  off.
- **The System Status Area**, top left: the status indicator, UTC time with seconds and the
  altimeter setting, `OK/OK/NA`, the range and line length (`15NM PTL: 1.0`), the airport's
  altimeter from its weather report (`PDX 30.02A`), active emergency codes in red, and a general
  information line with the runways in use and the wind.
- The radar's buttons take on the display control bar's look: dark green, lit when on.

## Better routes with a paid provider (optional)

The free route lookup goes by flight number and is often wrong: it only knows the route
a flight number was last seen on, and airlines reuse flight numbers. With a key for the
official [Flightradar24 API](https://fr24api.flightradar24.com) or
[FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/), CloudWall asks
which flight is actually in the air and also shows its arrival time. Add the key to
your config and restart:

```toml
[flightradar24]        # or [flightaware]
api_key = "your-token"
monthly_credits = 30000  # credits your plan includes per billing period (Explorer: 30000)
safety_margin = 0.15   # held back and never used: plans for 85% of the allowance
billing_day = 1        # day of the month your plan renews
mode = "always"        # live routes for every airliner near the house
```

Flightradar24 routes come from its flight-summary endpoint, which costs 1 credit per
flight (the live-positions endpoint costs 8), and include the actual takeoff time;
airport details come from a bundled airport table (airportsdata, MIT licence) rather than
the 50-credit airport endpoint. CloudWall works out each request's cost from Flightradar24's
price list, and checks its total against Flightradar24's own usage report every hour.
Flightradar24 doesn't offer scheduled departure or arrival times, so arrival times shown
are estimates unless the flight has landed.

Lookups are billed, so CloudWall is frugal with them:

- only airliners heading for the house (from about 10 minutes out), overhead, or pinned on a screen are
  looked up, early enough that the right route is on screen when they arrive;
- `mode = "fallback"` saves lookups by asking only when the free route looks wrong;
- each flight is looked up once and remembered for 45 minutes, airports for a year; a lookup
  that fails, or finds only the flight's previous leg (just after takeoff), is tried again
  after five minutes, not on every update;
- each day may use the budget that's left divided by the days left in the billing period, so
  busy days can borrow from quiet ones but the period's total never exceeds the budget; when
  it's reached, routes come from the free database until the plan renews. `daily_limit` adds
  an optional fixed cap per day. The Logbook shows the day's and the period's usage;
- a rejected key or exhausted credits pauses lookups for an hour instead of retrying.

Flightradar24 also offers a free sandbox token for testing: set `sandbox = true`. It
returns fixed sample data, so routes will not match what is overhead.

## Only while someone is looking

CloudWall makes requests to the flight-data and weather services only while a screen
has the board open (a hidden browser tab doesn't count). After 90 seconds with no screen,
`[tracking] when_idle = "pause"` (the default) stops all requests until a screen asks
again; `"log"` keeps checking the free position feed every 15 seconds so the logbook
stays complete. Either way, no paid route lookups and no weather requests are made while
nobody is looking. With several places this holds for each: a place no screen is showing makes
no requests (or, with `"log"`, only the slow position check).

## Notes

- Routes are looked up by callsign and are sometimes stale. CloudWall checks each route
  against where the aircraft actually is and greys it out as "route unverified" when
  they disagree.
- `[source] urls` lists position feeds, tried in order with automatic failover. Any
  readsb-style JSON feed works, so a local ADS-B receiver can replace the public APIs later.
- The radar sits over a faint real map (Esri's dark grey basemap by default; `[map] style`
  can be `light`, `satellite`, `osm` or `off`, or `url` can point at any raster tile service,
  such as CARTO with your own API key:
  `url = "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=YOUR_CARTO_KEY"`).
  It can also be one of the FAA's aeronautical charts: `sectional` (the VFR Sectional, with its
  airports, airspace and landmarks), `terminal` (the VFR Terminal Area chart, more detailed,
  where there is one: Portland has one; the Sectional elsewhere), `ifr-low` or `ifr-high`.
  The ATC style can have one too, `[map] atc` (none unless set, as on a real controller's
  screen). CloudWall downloads each tile once, caches it for a
  month next to the logbook, and serves it to the display itself, so the map provider sees
  only your server and an API key never reaches the browser.
- The charts are the FAA Aeronautical Information Services' own tiled charts (public domain),
  current to the 56-day chart cycle within a month. `cloudwall/charts.py` keeps every map and
  chart in one place and serves each at `/tiles/<layer>/z/x/y`, so a new use for a chart is a
  layer name in the display.
- Runways are drawn from the bundled runway table, with extended centrelines for the main
  direction. A hand-drawn map can add rivers and town names: PDX has one
  (`cloudwall/web/maps/kpdx.json`, approximate), drawn when the real map is off and in the ATC
  style. For another airport, add a file named after its ICAO code.
- Aircraft photos come from planespotters.net and load directly in the browser.
- The side elevations are drawn in the browser from measurements, not stored as pictures. Each
  family (`cloudwall/web/js/profiles/`) records its fuselage outline, flight-deck glazing, doors
  and windows, wing planform, nacelles, wingtip devices, fin and tailplane in metres, taken from
  the manufacturers' airport planning manuals (Boeing ACAPs, Airbus and Embraer planning
  documents) where they exist and from published dimensions and 3-view drawings otherwise;
  each family cites its source. Stretches of a family share one nose and tail, so a 737-900 is
  a longer 737-700, not a scaled one. `silhouette.js` turns a profile into the drawing: the
  wing is projected into side view from its sweep and dihedral, nacelles hang on pylons, and so
  on. To add a type, give it a line in `cloudwall/data/types.csv` (its shape and length) and map
  its ICAO code to a family in the right group file; to add a family, measure it the same way.
  `tests/test_silhouettes.py` checks that every type in the table has
  a profile and draws cleanly (it needs Node).
- Airline logos are fetched by airline code from a public logo service (pics.avs.io) the
  first time each airline appears, cached on disk, and shown on a white tile. Logos are
  the airlines' trademarks, so none are included in this repository; `[logos] enabled =
  false` turns them off, and `url` can point at another source.
- The look is an aeronautical chart laid out like a set of engineering drawings: cool chart
  paper, navy ink, chart blue for traffic and magenta only for the aircraft overhead, switching
  to a night chart after dusk. Panels are framed as drawing sheets with corner marks, labels are
  lettered in small capitals, type plates sit on a drafting grid with their ICAO type designator,
  the radar and sky view carry a compass bezel, and the clock shows UTC beside local time. Type is
  B612, the typeface Airbus designed for cockpit displays, bundled under the SIL Open Font
  License (see `cloudwall/web/fonts/`), so the board looks the same on every machine.
- Airlines are one table, `cloudwall/data/airlines.csv`: the code a callsign starts with, the code
  its flights are sold under (which its logo and flight numbers go by), its name, whether it flies
  freight only, and its livery's colours for the board. Add a line to teach CloudWall an airline.
- CloudWall has no logins: it is meant for a home network, not the open internet. It refuses
  requests to add or remove places that come from another site's page.
- Tests: `python3 -m unittest discover -s tests` (no network needed; they also run on every pull
  request). [ARCHITECTURE.md](ARCHITECTURE.md) maps the code.
- CloudWall is released under the MIT licence ([LICENSE](LICENSE)). The bundled tables and the
  typeface keep their own licences, beside them in `cloudwall/data/` and `cloudwall/web/fonts/`.
