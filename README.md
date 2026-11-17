# CloudWall

A flight status board for the sky over your house. A Raspberry Pi with a colour
touchscreen shows whatever is flying overhead: flight number, airline, origin and
destination, aircraft type, altitude, speed, heading, and where in the sky to look.

No radio hardware needed: positions come from the free [adsb.lol](https://adsb.lol)
community feed, routes and airframe details from [adsbdb.com](https://www.adsbdb.com),
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

## Run it

```sh
python3 -m cloudwall --demo        # simulated traffic, works offline
```

Open <http://localhost:8080>. For real traffic:

```sh
cp config.example.toml config.toml   # set [home] lat/lon to your house
python3 -m cloudwall
```

Needs Python 3.11+ (Raspberry Pi OS Bookworm or later).

## On the Pi

1. Clone to `/home/pi/CloudWall` and create `config.toml`.
2. `sudo cp deploy/cloudwall.service /etc/systemd/system/ && sudo systemctl enable --now cloudwall`
3. Start `deploy/kiosk.sh` from the desktop autostart to open the board full-screen.

The layout scales to the screen, from a 4–5" desk panel (800×480) to a wall monitor.

## Notes

- Routes are looked up by callsign and are sometimes stale. CloudWall checks each route
  against where the aircraft actually is and greys it out as "route unverified" when
  they disagree.
- `[source] url` accepts any readsb-style JSON feed, so a local ADS-B receiver can
  replace the public API later.
- Tests: `python3 -m unittest discover -s tests`
