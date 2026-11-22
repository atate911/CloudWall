# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.fi](https://adsb.fi)
community feed (falling back to [adsb.lol](https://adsb.lol)), routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
airframe photos from [planespotters.net](https://www.planespotters.net), weather from aviationweather.gov. Pure Python standard library, no packages to install.

## Screens

Every screen reads the traffic the same way. Each aircraft is coloured by what it is doing,
**arriving** (blue), **departing** (green), **flying locally** (orange: no flight plan, or to and
from a small field) or **passing over** (slate; the four checked to stand out on the radar by day and
night and to stay apart for colour-blind eyes), arrivals are numbered in landing order, and the
selected aircraft wears a magenta ring. Across the top, a headline ("12 aircraft within 15 nm") and
a phrase for each group, led by its icon and count, say what is going on and are the key to the
colours at once: "3 coming in from the east to land on 28L and 28R, about 2 minutes apart",
"2 climbing out to the northwest", "2 F-15s heard, with no position". Simple says them short
("3 landing at PDX", "2 departing") and leaves the rest to the panel beside it.

**The next few minutes.** Beside the headline, what happens next, on one line of time: who comes
over the house, who lands and when, and a medical helicopter reaching its hospital. Simple says the
next three in words, each counting down ("0:25 AS 2162 over the house · 1:40 AS 2162 lands at
PDX"); Detailed draws them along a ten-minute axis that moves with the clock, each a mark in its
colour (an arrival's landing number, the medical cross) and a label. The wall panel says the next
ones across its header, to read from the room. Something new, worth a look or next over the house,
glows once: a soft ring round it on the radar and its rows in the lists, for about three seconds,
then still, with no sound. When the positions are more than 20 seconds old (the feed has stopped, or
CloudWall isn't answering), the traffic fades, the countdowns stop and the header says how old they
are; at a minute the screen clears. A flight a screen follows that the feed leaves out for a moment
is carried on along its track, faded, its card marked "Position estimated".

**Simple or Detailed.** A switch in the header (on a phone, under the headline) sets how much each
screen draws. *Simple* shows what someone in the house wants to know right now: the next aircraft
over the house, the landing queue with a countdown for each, and what's worth a look (a medical
flight and the hospital it's going to, military traffic, a rare type, a balloon or glider, jets heard
with no position). Beside the countdown, a small picture says where to look: the
house, the sky from the horizon to straight up, and a line of sight to the aircraft at the angle to
raise your eyes by, with which way to face in words ("look northwest, low"). Each row of the landing queue has a line along its foot
that runs down with its countdown, ten minutes across, so landings bunched together or far apart
show at a glance. Its radar numbers the
arrivals, names the selected aircraft and anything worth a look, and leaves the rest unlabelled;
when the sky is empty it shows the flight card's quiet-sky slides. *Detailed* adds everything an
enthusiast reads the situation from: the flight card, every aircraft labelled with its altitude
and its runway or destination, a short fading track behind each, the final approach courses ticked
every mile, a list of every aircraft grouped by what it is doing (arrivals with their runway, time
to touchdown and gap to the one ahead), and a side view along the runways showing who is stacked
over whom, with the 3° approach drawn while the selected aircraft is an arrival: heights to scale
up to 6,000 ft, with the rest of the sky pressed together above a double line (so a flight passing at 36,000 ft sits above one at 14,000), each
aircraft tipped the way it is climbing or descending, the cloud layers at their heights, a dotted
line standing over home, and the selected aircraft on a line to the ground under it. To find an
aircraft from one view in another, point at it: on the radar, in the list, on the side view or on
the timeline, it is ringed on the radar and the side view (and named there) and its row is tinted;
a click on it in the side view selects it, as on the radar. On the wall panel the side view is one
of the quiet-sky slides, enlarged to read from the room, and a tap on an aircraft in it brings up
its card. There Simple and Detailed differ only on the radar, when it shows one: Simple names the
aircraft that matter, Detailed labels every one. The desktop starts Detailed, a phone and the
wall panel Simple; each screen remembers its own choice, `?density=simple` or `detailed` sets it
in the address, and `[kiosk] density` sets the wall panel's.

- **Overhead** – a flight card for the aircraft closest to overhead: the flight number as a
  departure board shows it (with "operated by" for regional partners), the airline's logo,
  the route with distance flown and to go, the departure and arrival times under the airports
  and the flight time between them, altitude and climb or descent rate (with the
  altitude the autopilot is heading for, when it reports one), speed, distance and how high up
  to look ("2.3 mi NW, 13° up"), heading,
  and a photo of the airframe beside when it passes the house, the aircraft type,
  registration and build year, and what the autopilot is doing. The departure time comes from
  a paid route provider (see below); without one, the card shows an estimated arrival only.
  The photo is of that very airframe (planespotters.net files photos by airframe, so a tail
  number that once belonged to another aircraft doesn't bring up its pictures), credited to its
  photographer in its bottom right corner, with a link to the photo's page there.
  Under the photo sits a type plate: a side elevation of the type, drawn to scale over a
  dimension line with its length. With no photo, the plate fills the frame. *About this type*, in
  the plate's corner, opens a page on the type, written for enthusiasts: for the types over the
  house every day, what they're built from and why they look and fly as they do; for the rare
  visitors, their story; a few facts chosen for each type; its seats and wake category; where this
  airframe's build year falls in the type's production run; and how often it and its type have
  come over the house. A type nobody has written about yet still gets its drawing, its seats and
  wake category and what the logbook knows of it. The write-ups are in `cloudwall/data/types/`,
  one file a family, each fact checked against the sources it lists; they are read as CloudWall
  starts, so restart it after changing one.
  Its first line says why it shows this flight ("Overhead now", "Over the house next",
  "Selected"), and the route's codes are joined by a line of how far it has come. On the desktop
  the card fills its column: the route map takes the room the words leave, or, for a flight with
  no route to draw (a light aircraft, a helicopter), the aircraft's drawing does, across the card
  with the facts in a row under it. The map's shape follows the route's: a route running north
  and south gets an upright map beside the facts, in the drawing's place, rather than a short line
  in the middle of a wide strip; one running east and west goes across the card, taking the
  drawing's room too when the card is short; on a phone the map is as tall as its route needs.
  On a short screen the map gives way first, then the drawing.
  On a card wide for its height (the traffic list hidden, or the card's divider dragged out) the
  route sits beside the flight number rather than under it, the facts go in three columns, and each
  figure's cell carries a small picture of it: the aircraft's height since it came in range as a
  line, the house with the angle to raise your eyes by, and its heading on a compass.
  The flight comes before the aircraft: with no map to draw (a light aircraft, a helicopter, a card
  too short for one) the drawing keeps to a sheet's size and beside it is a chart of the aircraft's
  height since it came in range, its highest and lowest marked; and where a card can't show both
  the map and the drawing, the map stays.
- **Radar / Map** – beside the card, a radar scope over a street map, or the Map view: the
  same flights on an everyday map for anyone, satellite photos with roads and place names (or a
  street map), filling the panel, every aircraft labelled in words ("Delta 178", "to Denver ·
  12,000 ft", "Small plane", "Helicopter"), with home and the airport marked and no rings,
  codes or jargon. The wall panel can show it too: `[kiosk] view = "map"`.
  Each aircraft is drawn as its kind, about its size, as flight-tracking maps draw traffic: a light
  aircraft or light twin, a turboprop, a business jet, a regional jet with its engines on the tail,
  an airliner, a heavy with two or four engines, a fighter, a seaplane, a glider, an ultralight, a
  helicopter, a twin-rotor helicopter such as a Chinook, a gyroplane, a tiltrotor, a drone, an
  airship, or a balloon (drawn from the side, upright as it drifts). The kind comes from the
  aircraft's type, or what its description gives away, else what its transponder says it is (its
  ADS-B emitter category), else its wake category; with none of those it is a plain aircraft. A
  Beaver or Caravan on floats shares its type with one on wheels, so it's a seaplane only when its
  description says so. On a small radar, such as the 7.5" kiosk's or a phone's, the icons are
  drawn up to half as large again, so even a light aircraft stays recognizable. (The ATC style
  draws STARS's own targets instead.)
  Each aircraft on the radar shows its altitude in hundreds of feet, with an arrow when it is
  climbing or descending (`035↑`) and a line to where it will be in a minute. Only the selected
  aircraft (the one overhead, or one you tap) shows where it has been, so a busy sky stays
  readable: its whole track since it came in range or took off, as flight-tracking sites draw it,
  in magenta, strongest near the ground and fading with height in steps at 2,000, 5,000, 10,000,
  18,000 and 28,000 ft. CloudWall keeps every aircraft's track, so one you tap shows all of it at
  once. The radar has a compass bezel with bearings, and on the desktop a key in the corner.
  A medical flight carries a white cross on a deep blue square beside its icon (the shape, not
  the blue, sets it apart from the arrivals), on the radar, the Map view, the lists and the
  board, and a MEDICAL tag on its card. CloudWall knows one by its transponder's lifeguard status,
  an air ambulance's operator or callsign (Life Flight Network, Air Methods, MERCY1), or a
  helicopter seen landing at or lifting off from a hospital's helipad. A medical helicopter's
  hospital is named when it's clear: the helipad it's landing at or has just left, or the one it's
  pointed straight at with no other on its line ("heading for Emanuel Hospital, there in about 4
  minutes"; the board counts down to it). Detailed marks the hospital helipads as charts mark
  heliports, an H in a circle; the one in use is drawn in the medical blue with its name, in Simple
  too.
  Labels keep clear of each other, the compass and the edge, and when a busy sky leaves no room,
  the least important go first (an arrival keeps its landing number, in a ring); the map's own
  names (towns, range rings, the airport, airfields) give way instead, fading while an aircraft
  or its label is over them.
  The Radar / Map switch picks the view; an emergency always shows on the radar.
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
  of reports as charts (touch one to read that report); the TAF forecast as a
  timeline; and, under the report on a desk, the day as a bar from midnight to midnight
  (night, twilight and daylight, with a mark for now and the sunrise and sunset under
  where they fall), the moon, contrails and flight restrictions. A compact version joins
  the quiet-sky rotation.
- **Logbook** – every flyover is logged: a drawn type collection (each type with its count
  and first sighting; a new one is marked on the flight card; tap one for its page), airlines, daily and all-time
  records (highest, lowest, fastest, closest, furthest origin), flyovers by hour.

The display switches to its night chart, dim and dark, when the sun sets at your house;
the settings button beside the clock forces it on or off, and turns on `Sound`: a soft chime when an
aircraft comes overhead, with a different one for rare, military or emergency traffic.

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
domain) as packaged by the `@squawk/airspace-data` and `@squawk/navaid-data` npm packages (MIT);
hospital helipads (the US only) from the same NASR data as packaged by `@squawk/airport-data` (MIT),
with the FAA's names tidied, in `cloudwall/data/helipads.csv` (add or rename lines for your area).
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
  upper-air temperature and humidity, and a flight card
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
| `http://<server>:5050/` | A PC or laptop | Everything: Overhead, Board, Weather and Logbook tabs, the radar and sky switch, and the settings menu (sound and night mode). On screens 1200 px wide and up, Detailed adds a live list of every aircraft grouped by what it is doing, with the side view along the runways under it; click a flight to follow it. The arrow on the divider between the radar and the list hides or shows the list, and dragging the divider gives the radar more or less room (double-click it for the usual width); the flight card keeps its size, and each screen remembers its setting. The divider between the flight card and the radar, on any landscape window (Simple's side panel too), sets the card's width the same way: only the radar gives way, the list keeping its width, and each screen remembers it for each layout. On a wide, short window the radar's column keeps to the width of its disc and the card and the list share the rest; when the card is short, its route map moves beside the facts or takes the drawing's room (whichever shows the route bigger), then gives way, then the aircraft drawing does (the facts go into columns), so nothing runs into anything else. Simple on a wide window puts what's worth a look in a third column, past the radar. |
| `http://<server>:5050/` on a phone | A phone in the hand | The same tabs and switches, laid out for a phone. Upright, the page scrolls: the flight card at full width, then a square radar with its switches above and below it, the tabs along the foot and the status line held at the top. The Board becomes a two-line list (flight, route and when it's overhead; airline, type, altitude and speed), and Weather and Logbook stack into one column. Turned sideways, the card and radar sit side by side. Tapping a blip on the radar brings its flight card into view. |
| `http://<server>:5050/kiosk` | A 7.5" or 13.3" wall panel | Made to hang in a room and read from the sofa: one sheet of chart paper with corner marks at the screen's corners, and nothing on it smaller than 4% of the screen's height (about 7 mm on a 13.3" panel), so every word reads from three or four metres away. Across the top, the place, the next thing to happen after the aircraft on the card ("0:45 AS 67 overhead", "1:40 AS 2162 lands") and the clock. Then the aircraft over the house across the whole screen: its flight number beside its airline logo and type (in Simple the headline is what a visitor would call it: an airline's flight by the airline's name beside its logo, anything else by what it is, "Small plane", "Medical helicopter", "Military jet", with its flight number or registration said small beside the type; the header's next events and the "Next overhead" slide name flights the same way, "Alaska 2162 overhead"; Detailed leads with the flight number or registration); where it's going, its own side elevation riding the line between the airports at its place along the way, with when it left, how far it has come and has to go, and when it gets in (with no route, the aircraft drawn beside where it is and which way it's heading); and how high, how fast (in Simple, for whoever is in the room, miles an hour, distances in miles, the cities by name in large type over the route line with the airports' codes small at its ends, and how many it seats beside its type; in Detailed knots, nautical miles and the codes large) and how soon it passes overhead, beside a small picture of the house and the angle to raise your eyes by (once it is here or past, which way to look in words: "look southwest, low"). Along the foot, how many aircraft are about and any heard with no position. `[kiosk] view = "radar"` puts the radar beside the card, with only what reads from across the room (the aircraft and their labels, the runways and the compass points), and `"map"` the Map view. When nothing is overhead, the card turns to slides: the next aircraft over the house, the radar (with the card alone, and anything on it) beside what is on it in words, the side view along the runways while anything is landing or taking off (tap an aircraft in it for its card), the weather with a wind rose, the day so far, a flight restriction, fighters heard. An emergency squawk turns the screen red until it is cleared. |

The phone layout is chosen by screen size (up to 700 px wide, or 500 px tall when turned sideways),
so it follows the phone as it turns and also suits a narrow desktop window. `?mode=phone` forces it and
`?mode=desktop` keeps it off.

`?mode=kiosk` on any address does the same as `/kiosk`. The kiosk sizes everything from
the screen's height, so the 1024×600 and 1920×1080 panels look the same.

The kiosk has no buttons, so what it shows is set in the config file:

```toml
[kiosk]
view = "card"      # "card" (the default): the aircraft overhead across the whole screen;
                   # "radar" puts the radar beside it, "map" the Map view
radar = "atc"      # with the radar: "chart" (the default) or "atc"
tracks = true      # the selected aircraft's track, and one-minute lines
range_nm = 30      # 0 for the tracking radius, or 20 or 30
density = "simple" # the radar's labels: "simple" names the aircraft that matter, "detailed" every one
```

The address can override these on any screen: `/kiosk?view=radar&radar=atc&tracks=off&range=20&density=detailed`.

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
- The radar sits over a real map (Esri's dark grey basemap by default, at `opacity` 0.45; `[map] style`
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
- The flight card draws the flight's route on a real map too: the great circle between its
  airports over Esri's satellite imagery, framed to fit the trip (a hop to Seattle, a coast to
  coast, or Tokyo across the date line), flown part in magenta and the aircraft where it is now.
  Country borders, state and province lines and the places along the way are drawn over it:
  towns and cities of like importance for the map's scale (Natural Earth's own ranking, so a town
  is named only where a map that close would name it), spaced out along the route like the
  stations on a line, then a few others around it to find your way by, each named on the side
  away from the route and never across it. They come from Natural Earth (public domain), bundled
  in `cloudwall/web/maps/world.json`.
  `[map] route` can be `light`, `dark`, `osm`, or `off` for the plain arc. Its tiles come from
  zoom 0 to 6 only, the one map CloudWall serves for the whole world, cached the same way.
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
  to a night chart after dusk. Panels are framed as drawing sheets with corner marks, type plates
  sit on a drafting grid with their ICAO type designator, the radar carries a compass bezel, and
  the clock shows UTC beside local time. Type is B612, the typeface Airbus designed for cockpit
  displays, bundled under the SIL Open Font License (see `cloudwall/web/fonts/`), so the board
  looks the same on every machine. Words, labels included, are set in B612 in sentence case; B612
  Mono is kept for codes read a character at a time: callsigns, airports, type designators,
  runways and weather reports.
- Airlines are one table, `cloudwall/data/airlines.csv`: the code a callsign starts with, the code
  its flights are sold under (which its logo and flight numbers go by), its name, whether it flies
  freight only, and its livery's colours for the board. Add a line to teach CloudWall an airline.
  An aircraft's airline name comes from its callsign too, so the name, logo and flight number
  always agree (SkyWest's flights as SkyWest's, unless a paid route says whose brand it flies
  under); Horizon, which only ever flies as Alaska, shows as Alaska, "operated by Horizon Air".
- CloudWall has no logins: it is meant for a home network, not the open internet. It refuses
  requests to add or remove places that come from another site's page.
- Anything else on your network can read what the screens read: [API.md](API.md) lists every
  answer, key by key (a Home Assistant card or a widget needs only `/api/state`).
- The logbook notes where each flyover's closest point was and which way it was flying, as well as
  how near, high and fast.
- Tests: `python3 -m unittest discover -s tests` (no network needed; they also run on every pull
  request). The ones that walk the page in a browser need Playwright and are skipped without it:
  `npm install --no-save playwright && npx playwright install chromium`.
  [ARCHITECTURE.md](ARCHITECTURE.md) maps the code.
- CloudWall is released under the MIT licence ([LICENSE](LICENSE)). The bundled tables and the
  typeface keep their own licences, beside them in `cloudwall/data/` and `cloudwall/web/fonts/`.
