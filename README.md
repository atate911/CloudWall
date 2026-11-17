# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.fi](https://adsb.fi)
community feed (falling back to [adsb.lol](https://adsb.lol)), routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
weather from aviationweather.gov. Pure Python standard library, no packages to install.

## Screens

- **Overhead** – a flight card for the aircraft closest to overhead: split-flap flight
  number and airport codes, the airline's colours, a photo of the actual airframe, a
  side-profile silhouette scaled to the aircraft's size, live altitude/speed/distance,
  a countdown ring to the closest pass, and a line on whether you can actually see it
  (cloud base, sun glare, night).
- **Sky view / radar** – beside the card, a dome view of the sky with the aircraft's
  path across it (centre is straight up), or a radar scope with trails over a simple map
  of the river and runways. It switches automatically; tap the label to choose.
- **Quiet sky** – when nothing is overhead the card rotates through the next inbound
  aircraft, a heatmap of the day's traffic, the day's records and the last flyover.
  Tap to skip ahead.
- **Board** – departure-board list of everything airborne in range. Tap a row (or a
  blip on the scope) to pin that aircraft to the flight card; tap the card to release.
- **Logbook** – every flyover is logged: type collection, airlines, daily and all-time
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
make config       # writes ~/.config/cloudwall/config.toml; set [home] lat/lon
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
| Logbook database | `~/.local/share/cloudwall/cloudwall.db` (or `[storage] db_path`, or `--db`) |
| Port | 5050 (`[server] port`, or `--port`) |

## Production on dedicated hardware

On the Pi, install the same way and run `make service`. Then start `deploy/kiosk.sh`
from the desktop autostart to open the board full-screen. To drive a display from a
board running elsewhere, set `CLOUDWALL_URL=http://<server>:5050` for the kiosk script.

The layout scales to the screen, from a 4–5" desk panel (800×480) to a wall monitor.

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
- The river and runway map is hand-drawn for PDX (`cloudwall/web/maps/kpdx.json`) and
  approximate; with the real map turned on only its runways and approach lines are
  drawn. For another airport, add a file named after its ICAO code.
- Aircraft photos come from the free airframe database and load directly in the browser.
- Airline logos are fetched by airline code from a public logo service (pics.avs.io) the
  first time each airline appears, cached on disk, and shown on a white tile. Logos are
  the airlines' trademarks, so none are included in this repository; `[logos] enabled =
  false` turns them off, and `url` can point at another source.
- The look is an aeronautical chart: cool chart paper, navy ink, chart blue for traffic and
  magenta only for the aircraft overhead, switching to a night chart after dusk. Type is
  B612, the typeface Airbus designed for cockpit displays, bundled under the SIL Open Font
  License (see `cloudwall/web/fonts/`), so the board looks the same on every machine.
- Tests: `python3 -m unittest discover -s tests`
