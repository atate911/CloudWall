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

The backdrop follows the real sky (dawn, day, dusk, stars, overcast from the airport's
weather report) and the display turns warm and dim after dark; the `Night` button
forces it on or off. `Sound` turns on a soft chime when an aircraft comes overhead, with
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

The free route lookup goes by flight number and is often stale. With a key for the
official [Flightradar24 API](https://fr24api.flightradar24.com) or
[FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/), CloudWall asks
which flight is actually in the air and also shows its arrival time. Add the key to
your config and restart:

```toml
[flightradar24]        # or [flightaware]
api_key = "your-token"
daily_limit = 100      # hard cap on lookups per day
mode = "fallback"      # or "always"
```

Lookups are billed, so CloudWall is frugal with them:

- only aircraft that are overhead, under four minutes from overhead, or pinned are looked up;
- in `fallback` mode, only when the free route is missing or contradicted by the aircraft's position;
- each flight is looked up once and remembered for 45 minutes, airports for a year;
- it stops at `daily_limit` and uses free routes until midnight. The Logbook shows the day's count;
- a rejected key or exhausted credits pauses lookups for an hour instead of retrying.

Flightradar24 also offers a free sandbox token for testing: set `sandbox = true`. It
returns fixed sample data, so routes will not match what is overhead.

## Notes

- Routes are looked up by callsign and are sometimes stale. CloudWall checks each route
  against where the aircraft actually is and greys it out as "route unverified" when
  they disagree.
- `[source] urls` lists position feeds, tried in order with automatic failover. Any
  readsb-style JSON feed works, so a local ADS-B receiver can replace the public APIs later.
- The river and runway map is hand-drawn for PDX (`cloudwall/web/maps/kpdx.json`) and
  approximate. For another airport, add a file named after its ICAO code; without one
  the scope simply has no backdrop.
- Aircraft photos come from the free airframe database and load directly in the browser.
- The Inter and JetBrains Mono fonts are bundled (SIL Open Font License, see
  `cloudwall/web/fonts/`), so the board looks the same on every machine and needs no
  internet for fonts.
- Tests: `python3 -m unittest discover -s tests`
