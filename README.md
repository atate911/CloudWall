# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.fi](https://adsb.fi)
community feed (falling back to [adsb.lol](https://adsb.lol)), routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
weather from aviationweather.gov. Pure Python standard library, no packages to install.

## Screens

- **Overhead** – a flight card for the aircraft closest to overhead: the flight number as a
  departure board shows it (with "operated by" for regional partners), the airline's logo,
  the route with distance flown and to go, the departure and arrival times under the airports
  and the flight time between them, altitude and climb or descent rate (with the
  altitude the autopilot is heading for, when it reports one), speed, distance and heading,
  and a photo of the airframe beside when it passes the house, the aircraft type,
  registration and build year, and what the autopilot is doing. The departure time comes from
  a paid route provider (see below); without one, the card shows an estimated arrival only.
  Under the photo sits a type plate: a side elevation of the type, drawn to scale over a
  dimension line with its length. With no photo, the plate fills the frame.
- **Sky view / radar** – beside the card, a dome view of the sky with the aircraft's
  path across it (centre is straight up), or a radar scope with trails over a faint map.
  Each aircraft on the radar shows its altitude in hundreds of feet, with an arrow when it is
  climbing or descending (`035↑`), and a line to where it will be in a minute. Both views have a
  compass bezel with bearings, and on the desktop a key in the corner.
  Auto shows the sky view while something is overhead; the Auto / Radar / Sky switch picks one.
  Along the foot of the radar, Chart / ATC picks its look (ATC draws it like an air traffic
  controller's screen: dark, a grey map, green targets with history dots, leader lines to data blocks
  and a status area with UTC time, altimeter, wind and runways), Tracks turns the trails and
  one-minute lines on or off, and 15 / 20 / 30 sets the range in nm. Past the tracking radius
  (`[tracking] radius_nm`, 15 nm), aircraft are drawn on the radar only: the board, the flight card,
  the logbook and route lookups stay within it, and the longer range is fetched only while a
  screen shows it.
- **Quiet sky** – when nothing is overhead the card rotates through the next inbound
  aircraft (with its drawing, so you know what to look for), a heatmap of the day's traffic,
  today's fleet (every type seen since midnight, side by side at true relative size, from a
  Cessna to a 777), the day's records and the last flyover. Tap to skip ahead.
- **Board** – departure-board list of everything airborne in range. Tap a row (or a
  blip on the scope) to pin that aircraft to the flight card; tap the card to release.
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
make config       # writes ~/.config/cloudwall/config.toml; set [home] lat/lon and [airport] icao
make run
```

The install is editable, so changes to the Python or to `cloudwall/web/` take effect
without reinstalling: restart for Python changes, just reload the browser for the
web files.

To keep it running in the background across logouts and reboots:

```sh
make service      # systemd user service; `make logs` to follow, `make service-remove` to undo
```

`make help` lists every task. Without make: `pip install -e .` then `cloudwall`.

### Where things live

| What | Where |
|---|---|
| Settings | `--config`, `$CLOUDWALL_CONFIG`, `./config.toml`, then `~/.config/cloudwall/config.toml` |
| Logbook database | `~/.local/share/cloudwall/cloudwall.db` (or `[storage] db_path`, or `--db`); each extra place gets its own beside it, such as `cloudwall-cabin.db` |
| Port | 5050 (`[server] port`, or `--port`) |

## Anywhere, and more than one place

CloudWall works at any airport from its ICAO code: set `[airport] icao` and it fills in the rest
from bundled tables, the airport's name, city, position and elevation, its runways (for the radar,
the wind rose and which way it's landing) and the smaller fields nearby. The airport table is
airportsdata (MIT licence), small fields it lacks (Pearson Field, Grove Field and others around
Vancouver) are in `fields.csv`, and the runways come from OurAirports (public domain); rebuild them
with `python3 tools/build_runways.py`. For an airport the tables don't cover, give its `iata`,
`city`, `lat` and `lon` too.

To watch more than one place, such as home and a cabin, add a `[[places]]` entry for each:

```toml
[[places]]
name = "Cabin"
lat = 44.0600
lon = -121.3100
airport = "KRDM"       # the rest is filled in, as for [airport]
elevation_ft = 3600    # optional: the airport's when left out
```

`[home]` with `[airport]` stays the first place. With more than one, the place's name appears
beside "CloudWall" in the header and opens a menu of them; each screen remembers its own, so the
kiosk can show home while a laptop shows the cabin. The kiosk takes its place from `[kiosk] place`
(a place's name), and `?place=` in the address picks one on any screen.

Each place keeps its own logbook, weather, flight restrictions and contrail forecast, and its data
is fetched only while a screen is showing it. A paid route provider is shared: every place's
lookups count against the one budget, so two screens on two places can use it about twice as fast.

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

## Two interfaces

| Address | For | What it shows |
|---|---|---|
| `http://<server>:5050/` | A PC or laptop | Everything: Overhead, Board, Weather and Logbook tabs, the radar and sky switch, sound and night buttons. On screens 1500 px wide and up, the Overhead view adds a live list of nearby flights; click one to follow it. |
| `http://<server>:5050/kiosk` | A 7.5" or 13.3" wall panel | Built to read from across the room: one big card (flight number, airline logo, route, altitude, speed and time until overhead) beside the radar or sky view. No tabs, buttons or small print. When the sky is empty it rotates every 12 seconds between the next flight, the weather with a windsock, and today's count. Tap the card to skip ahead. |

`?mode=kiosk` on any address does the same as `/kiosk`. The kiosk sizes everything from
the screen's height, so the 1024×600 and 1920×1080 panels look the same.

The kiosk has no buttons, so its radar is set in the config file:

```toml
[kiosk]
radar = "atc"      # "chart" (the default) or "atc"
tracks = true      # trails and one-minute lines
range_nm = 30      # 0 for the tracking radius, or 20 or 30
```

The address can override these on any screen: `/kiosk?radar=atc&tracks=off&range=20`.

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

- only airliners heading for the house (from about 10 minutes out), overhead, or pinned are
  looked up, early enough that the right route is on screen when they arrive;
- `mode = "fallback"` saves lookups by asking only when the free route looks wrong;
- each flight is looked up once and remembered for 45 minutes, airports for a year;
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
  CloudWall downloads each tile once, caches it for a
  month next to the logbook, and serves it to the display itself, so the map provider sees
  only your server and an API key never reaches the browser.
- Runways are drawn from the bundled runway table, with extended centrelines for the main
  direction. A hand-drawn map can add rivers and town names: PDX has one
  (`cloudwall/web/maps/kpdx.json`, approximate), drawn when the real map is off and in the ATC
  style. For another airport, add a file named after its ICAO code.
- Aircraft photos come from the free airframe database and load directly in the browser.
- The side elevations are drawn in the browser from measurements, not stored as pictures. Each
  family (`cloudwall/web/js/profiles/`) records its fuselage outline, flight-deck glazing, doors
  and windows, wing planform, nacelles, wingtip devices, fin and tailplane in metres, taken from
  the manufacturers' airport planning manuals (Boeing ACAPs, Airbus and Embraer planning
  documents) where they exist and from published dimensions and 3-view drawings otherwise;
  each family cites its source. Stretches of a family share one nose and tail, so a 737-900 is
  a longer 737-700, not a scaled one. `silhouette.js` turns a profile into the drawing: the
  wing is projected into side view from its sweep and dihedral, nacelles hang on pylons, and so
  on. To add a type, map its ICAO code to a family in the right group file; to add a family,
  measure it the same way. `tests/test_silhouettes.py` checks that every type in `data.js` has
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
- Tests: `python3 -m unittest discover -s tests`
