# Coverage3D

A 3D antenna-coverage map for a readsb / adsb.im ADS-B receiver (Raspberry Pi, Debian 13).

It samples the aircraft your receiver decodes, stores them compactly in SQLite, works out your
antenna's coverage by **bearing, distance and altitude**, and serves a web page (port 8090) with
a map you can rotate, tilt and zoom: translucent altitude layers over real terrain, on a labelled
map of your area, with a distance ring every 50 nm so you can say "blocked to the northeast
between 50 and 100 nm".

Stdlib-only Python 3.13 (no pip packages), one process (sampler thread + web server). It only
*reads* readsb's output; it never touches the adsb.im containers.


## Try it first (no receiver needed)

```bash
cd coverage3d          # this directory
python3 -m coverage3d --demo --port 8090
```

Open <http://localhost:8090/>. `--demo` writes 7 days of synthetic traffic (with a Cascades-style
blocked sector and an "antenna moved outside" step three days ago, so Compare mode has something to
show) into `./coverage3d-demo.db` and invents live aircraft. The real database is never touched.

## Install on the Pi

```bash
git clone <this repo> && cd <repo>/coverage3d
ss -ltn | grep -w 8090 || echo "8090 is free"
sudo ./install.sh              # add --airports to also download the OurAirports list
```

`install.sh` is idempotent (run it again to update). It creates the `coverage3d` system user,
`/opt/coverage3d` (code + venv), `/var/lib/coverage3d` (database), `/etc/coverage3d/config.toml`
(kept if it exists; new defaults land in `config.toml.new`) and `coverage3d.service`, then starts
it. It refuses to start if the port is taken. It does not touch Docker.

```bash
journalctl -u coverage3d -f            # logs
sudo systemctl restart coverage3d      # after editing the config
sudoedit /etc/coverage3d/config.toml
```

Open `http://192.168.3.3:8090/` from the LAN. Never forward this port to the internet (see the
tunnel section for remote viewing).

**First start:** if the database is empty, the app imports tar1090's recent history from
`/run/adsb-feeder-ultrafeeder/tar1090/` (see "Importing history") so the map is not empty.
After that it records one position per aircraft per update, batched to disk every 60 s.

**When you move the antenna outside**, edit `antenna_height_m` in the config (and, if you like,
adsb.im's `FEEDER_ALT_M`), restart, then use **Filters → Compare** with the dates before and after.

## What gets recorded

Every 2 s the app reads `aircraft.json` (first `http://127.0.0.1:8080/data/aircraft.json`, then the
file `/run/adsb-feeder-ultrafeeder/readsb/aircraft.json`) and keeps a position only if:

| rule | default |
|---|---|
| `type` is a direct reception: `adsb_icao`, `adsb_icao_nt`, `adsb_other` (stored as source *ADS-B*) | |
| `mlat` is stored as a separate source (off in the page until ticked); `uat` as *978* | |
| rejected: `adsr_*`, `tisb_*` (rebroadcast by a ground station), `mode_s` (no position, only counted), `unknown`, anything else | |
| has lat/lon and `seen_pos` < 2 s | `max_seen_pos_s` |
| `nac_p` ≥ 5 when `nac_p` is present | `min_nac_p` |
| not a duplicate of the position already stored from the previous poll | |
| distance ≤ 400 nm; altitude between -1,500 and 60,000 ft | |
| no jump implying > 1,000 kt from that aircraft's previous point | `max_speed_kt` |

Per point it stores time, ICAO address, source, lat/lon (×1e5 integers), `alt_baro`, `alt_geom`,
the altitude used, on-ground flag, RSSI, distance, bearing and elevation angle (4/3-earth
refraction). Callsigns are kept in a small `aircraft` table (hex → latest callsign) rather than in
every row. SQLite runs in WAL mode; raw points are deleted after `retention_days` (30), while
**per-day histogram aggregates are kept forever**, so long-term before/after comparisons keep
working after the raw points are gone.

**Altitude.** Coverage uses `alt_geom` (GNSS height) when present, otherwise `alt_baro`; "ground"
means the aircraft is on the ground (its altitude is set to the station's ground elevation and it
goes in a separate *ground* band). Barometric altitude is measured against the standard 29.92 inHg;
it can differ from true altitude by a few hundred feet (on your receiver `alt_geom − alt_baro` ran
from −125 to +450 ft, median +150), which matters at low level and is why `alt_geom` is preferred.

**Bins.** Bearing sectors (default 5°) × altitude bands (default 2,500 ft up to 45,000 ft; the top
band is open-ended) each keep count, max distance, 95th-percentile distance, median RSSI, weakest
RSSI and first/last seen. The 95th percentile (the default) ignores the occasional bad position.
Percentiles and medians are read from 1 nm / 1 dB histograms, so they are accurate to about
±0.5 nm / ±0.5 dB. Bins with fewer than `min_points_per_bin` (3) points are not drawn.

## Reading the page

* **The upside-down wedding cake (default).** Every altitude band is a solid tier from its floor to
  its ceiling, as wide in each direction as the 95th-percentile (or max) distance you hear at that
  altitude. Low tiers are small and warm-coloured, high tiers wide and cool, so the cake widens upward.
  A notch or flat side in a tier is a direction with weak coverage at that altitude; a tier that barely
  extends past the one below it means extra height buys you little there. Tilt to a low angle (or
  Orbit) to see the steps; **Tier height** sets 1,000 / 2,500 / 5,000 / 10,000 ft tiers.
  **Smooth outlines** bridges one- or two-sector gaps and averages neighbouring sectors so thin data
  does not draw spikes (clicking a tier still shows the raw numbers). **Flat sheets** switches to thin
  translucent layers at each band's mid altitude, with optional walls between them.
* **Vertical exaggeration** (1×/2×/5×/10×) stretches altitude only, never the rings. 40,000 ft is tiny
  against a 200 nm-wide map, so the default is 5×. Terrain is not exaggerated.
* **2D map** looks straight down with north up: the ground footprint of every band (thin coloured
  lines) and the rings read like an ordinary map. **3D** tilts back to 60°. **Reset view** frames the
  200 nm ring. **Orbit** rotates slowly.
* **Rings** every 50 nm (true geodesic circles, draped on the terrain), lighter 10 nm rings inside,
  bearing lines every 30° (N, 030, 060, E…), optional shaded 50 nm bands. The unit switch changes only
  the labels ("50 nm · 58 mi · 93 km"); spacing stays 50 nm.
* **Hover or tap** anywhere: distance (nm, mi, km), bearing from the station and the nearest labelled
  place, e.g. "87 nm · 100 mi · 161 km, bearing 352°, near Centralia WA".
* **Ghost rings** (Layers → radio horizon) draw the theoretical line-of-sight range per band,
  `1.23 × (√h_antenna_ft + √h_ft)` nm. The gap between a coverage edge and its ghost ring is what
  terrain, buildings, cable loss or antenna position cost you in that direction.
* **Click** a band: band, bearing range, distance (p95/max), point count, RSSI. Click a point or
  aircraft: callsign, time, altitude, distance, RSSI.
* **Insights tab:** *Vertical coverage* (distance × altitude density of all points with the horizon
  curve, the clearest view of low-altitude coverage), a *polar plot* per band (blocked directions
  stand out), and stats (points, aircraft, range per band, best/worst bearing, message rate, noise
  floor, strong-signal %, gain from `stats.json`).
* **Filters:** time range (1 h … all, or custom dates), **Compare** two date ranges (A solid, B
  dashed outlines), source (ADS-B direct / MLAT / 978), p95 or max, sector width and band height.
* **readsb outline, last 24 h** draws readsb's own `outline.json` (the farthest position per degree
  at that aircraft's altitude) as a 3D line for comparison.
* Settings and the last camera position are remembered in the browser (localStorage).

### Base maps

Default is OpenFreeMap *Liberty* (labelled streets, towns, water, state lines, parks). Also
OpenFreeMap Bright/Positron, Esri Topographic and Street, **Satellite + place labels** (Esri imagery
with a labels overlay on top), **Dark + labels** (Esri Dark Gray base + reference), and *Offline*
when `offline_tiles_dir` is set. Terrain and hillshade come from the free AWS Terrarium tiles.
Coverage layers are drawn *beneath* the basemap's label layers (deck.gl interleaved with MapLibre),
so names stay readable when tilted and rotated; keep opacity about 25–35 %.
Airports (the 12 you named plus a bundled list of about 35; `install.sh --airports` adds every
OurAirports large/medium airport) and the five peaks are labelled on top. Hover places come from a
bundled list of about 40 towns.

Needs internet in the *viewing browser* (not the Pi): CDN scripts (MapLibre 4.7.1, deck.gl 9.0.38),
tiles, terrain and the label fonts. Without the fonts the rings/airport labels cannot draw (the page
says so); everything else keeps working.

## API

All JSON, all `GET`. Time arguments are unix seconds or `YYYY-MM-DD`; `last=<seconds>` means "up to now".

| endpoint | |
|---|---|
| `/api/station` | position, ground elevation, antenna height and altitude |
| `/api/coverage?from=&to=&last=&bands=2500&sector=5&stat=p95&source=adsb,mlat&min=3` | bins per band and sector (cached 60 s) |
| `/api/compare?a_from=&a_to=&b_from=&b_to=` | two coverage results |
| `/api/points?from=&to=&limit=100000&source=` | down-sampled raw points as columns |
| `/api/vertical`, `/api/live`, `/api/stats`, `/api/outline`, `/api/reference`, `/api/aircraft?hex=` | plots, live aircraft, receiver + recorder stats, readsb outline, places, callsign lookup |

## Configuration

`/etc/coverage3d/config.toml`: every setting is in [`config.example.toml`](config.example.toml)
with a comment. A second receiver (e.g. a 978 MHz stick) is added as another `[[source]]`.

## Importing history

On the first start the app imports what tar1090 has in `/run/adsb-feeder-ultrafeeder/tar1090/`
(`history_*.json`, `current_large.gz`, `current_small.gz`), de-duplicated. Manually:

```bash
sudo -u coverage3d /opt/coverage3d/venv/bin/python -m coverage3d --config /etc/coverage3d/config.toml \
    --import /run/adsb-feeder-ultrafeeder/tar1090/
```

Only formats that are certain are supported: files in aircraft.json layout (`history_*.json`,
plain or gzipped; any gz/json whose top level has `now` and a list of aircraft *objects*).
tar1090's compact `chunk_*.gz` use positional arrays whose column order I could not verify, so
they are skipped with a warning rather than guessed. Check with `zcat chunk_*.gz | head -c 2000`
and extend `importer._snapshots_from`. Likewise there is no importer for
`/opt/adsb/config/ultrafeeder/globe_history` (traces/heatmaps) until someone has looked at what is in
it (`sudo find /opt/adsb/config/ultrafeeder/globe_history/2026 -maxdepth 5 | head -60`).
Imported points are recomputed against the *current* station position and height.

## Offline basemap (optional, unverified)

adsb.im keeps tiles in `/usr/local/share/osm_tiles_offline` and `/usr/local/share/openfreemap_offline/mnt`.
I could not inspect their layout. If `osm_tiles_offline` is a plain `{z}/{x}/{y}.png` tree, set
`offline_tiles_dir` to it and an "Offline" entry appears in the basemap list; the app serves it at
`/tiles/{z}/{x}/{y}.png` (the `coverage3d` user must be able to read it). Vector/mbtiles/pmtiles
layouts are not supported.

## Viewing from outside your home (optional; nothing here is automatic)

Your existing `adsb-tunnel.service` forwards the VPS's `127.0.0.1:18080` to the Pi's
`127.0.0.1:8080`. To add this app, add a **second forward to the same `ssh` command** (or a copy of
the unit), for example:

```
-R 127.0.0.1:18090:127.0.0.1:8090
```

and on the VPS allow it in the key's options in `~/.ssh/authorized_keys` (repeat `permitlisten`):

```
permitlisten="127.0.0.1:18080",permitlisten="127.0.0.1:18090" ssh-ed25519 AAAA… 
```

Then `sudo systemctl daemon-reload && sudo systemctl restart adsb-tunnel` on the Pi, and reach the
page on the VPS at `127.0.0.1:18090` (e.g. `ssh -L 8090:127.0.0.1:18090 you@vps`, then
`http://localhost:8090`). Keep the VPS side bound to 127.0.0.1 and put your own authentication in
front of anything public. The app has no login, so never expose port 8090 itself to the internet.
If you only want tunnel access, set `bind = "127.0.0.1"` in the config.

## Troubleshooting

| symptom | check |
|---|---|
| page empty / "readsb feed unavailable" | `journalctl -u coverage3d`; `curl -s localhost:8080/data/aircraft.json \| head -c 200`; the app logs once when the feed goes down and when it returns |
| warning "receiver.json position … from the configured true position" | the decoder has the wrong station position; fix it in adsb.im (distances use the receiver.json position unless `position_source = "config"`) |
| warning about FEEDER_ALT_M | set `antenna_height_m` so ground + antenna matches your real antenna height |
| coverage looks too small at first | it fills as aircraft fly by; give it a day or two, or widen the time range |
| bins look noisy | raise `min_points_per_bin`, or use 10° sectors / 5,000 ft bands in Filters |
| no labels on rings / airports | the browser can't reach `tiles.openfreemap.org` (label fonts) |
| nothing under the polygons | the basemap tiles can't be reached (no internet in the browser), pick another basemap |
| port in use | `ss -ltn`; change `[server] port` |
| memory / CPU | steady state is a few tens of MB; the page's heavy work is in your browser. Untick *Point cloud* on a phone |

## Tests

```bash
cd coverage3d && python3 -m pytest        # or: python3 -m unittest discover -s tests
```

Covers distance, bearing, elevation angle and horizon, binning (sector/band indexes, p95, merging),
the SQL aggregation against a Python reference (including daily aggregates + pruning), the point
filters (source types, nac_p, plausibility, de-duplication, jump check), the importer, the station
checks (including that secrets in `.env` are never logged) and the API with demo data.

## Layout

```
coverage3d/            Python package: config, geo, filters, binning, store, sampler, feeds,
                       station, importer, demo, reference, server, __main__
coverage3d/web/        index.html, app.js, mapview.js, plots.js, util.js, style.css (no build step)
coverage3d/data/       bundled airports, peaks, towns (CSV)
tests/                 unit tests
config.example.toml    documented configuration
coverage3d.service     systemd unit
install.sh             idempotent installer
```

## Honest limitations

* Written and tested without access to your Pi: unit tests, a demo server and a headless-browser smoke
  test of the page (3D layers, walls, plots, hover and click) were run; the install script, the
  systemd unit, the live readsb feed, the OpenFreeMap styles and label fonts and the Esri tile
  services were **not** exercised against the real services.
* Daily aggregates are stored at the coverage resolution in force when they were written
  (`sector_deg/band_ft/max_alt_ft`); after changing it, older days outside the 30-day raw window are
  not available at the new resolution until they match again.
* Compare mode needs both ranges to overlap stored data.
* deck.gl layers sit at sea-level-referenced altitude (like the data); terrain is drawn at 1× real
  height, so at high exaggeration the aircraft stack floats well above the mountains by design.
