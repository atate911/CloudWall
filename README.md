# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.fi](https://adsb.fi)
community feed (falling back to [adsb.lol](https://adsb.lol)), routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
weather from aviationweather.gov. Pure Python standard library, no packages to install.

## Screens

- **Overhead** – the flight card for the aircraft closest to overhead, next to a live
  radar scope. When nothing is overhead it shows the next inbound aircraft with a
  countdown, the day's count, runway flow at PDX and the current METAR.
- **Board** – departure-board list of everything airborne in range. Tap a row (or a
  blip on the radar) to pin that aircraft to the flight card; tap the card to release.
- **Logbook** – every flyover is logged: type collection, airlines, daily and all-time
  records (highest, lowest, fastest, closest, furthest origin), flyovers by hour.

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
- Tests: `python3 -m unittest discover -s tests`
