# CloudWall: notes for an AI session

A self-hosted flight-tracking wall display. A Python server polls ADS-B feeds, works out "the
board" for each watched place, and serves a no-build web page. `coverage3d/` is a separate
companion program that runs on the receiver Pi.

## Rules that are decisions, not accidents

- **Python standard library only** at runtime, and **no build step** for the page (plain ES
  modules). Don't add dependencies; `eslint` and `pyflakes` are CI-only.
- **The display only draws.** Anything worked out (categories, words, landing order) is worked
  out in the server and sent; the page formats it.
- **Layers import downward only** (`tests/test_layers.py` enforces it): `core` < `reference` <
  `gather`/`memory` < `picture` < `serve`/`operate` < `app`. The middle three don't import each
  other.
- **Words shown to the owner are plain sentences** saying what happened and what to do; every
  known problem lives once in `core/troubles.py`.
- **Comments are kept short on purpose**: only a non-obvious why. Don't add narration.

## Where things are

| For | Look in |
|---|---|
| Settings: defaults, types, ranges, reading and writing the file | `cloudwall/core/config.py`; the words for each in `core/schema.py` |
| A place's threads (feed, weather, extras) and its state | `cloudwall/app/place.py` |
| Positions into the board | `cloudwall/picture/tracker.py`, `details.py`, `situation.py` |
| Feeds, weather, TFRs, tiles, paid route lookups | `cloudwall/gather/` |
| Logbook table and queries | `cloudwall/memory/store.py`, `logbook.py` |
| HTTP routes | `cloudwall/serve/server.py`; the control board's API in `cloudwall/app/admin.py` |
| Install, upgrade, doctor, backup, the root helper | `cloudwall/operate/` |
| The wall page | `cloudwall/web/index.html`, `css/`, `js/` (`app.js` is the entry; `scope.js` the radar) |
| The control board | `cloudwall/web/admin.html`, `admin.css`, `js/admin/` |
| Aircraft side-view drawings (large data tables) | `cloudwall/web/js/profiles/`; format in `js/profiles.js` |

`ARCHITECTURE.md` has the fuller map; `ROADMAP.md` what is planned and what was removed.

## Things that must stay in step

- **`API.md` is enforced**: `tests/test_api.py` fails if the server sends a key the document
  doesn't list, or the reverse. Change both together.
- **A new setting** needs: its default in `config.DEFAULTS` (or `OPTIONAL`), any range in
  `BETWEEN`/`CHOICES`, and its words in `schema.py`. A test fails if the schema lacks one.
- **A new problem code** needs an entry in `troubles.CATALOGUE` with steps to fix it.
- **Logbook schema changes** are numbered migrations in `memory/store.py`.

## Checking a change

```
python3 -m unittest discover -s tests                         # ~80 s, no network needed
CLOUDWALL_BROWSER_TESTS=1 python3 -m unittest discover -s tests   # also drives the page in Chromium
(cd coverage3d && python3 -m unittest discover -s tests)
python3 -m pyflakes cloudwall tests tools coverage3d
npx eslint cloudwall/web/js coverage3d/coverage3d/web           # catches a forgotten import
python3 -m cloudwall --demo --port 5050                       # simulated traffic, to look at it
```

Run the browser tests after anything under `cloudwall/web/`: `node --check` does not catch a
missing import, and a broken module leaves the page blank. Tests are split by area
(`tests/test_feeds.py`, `test_tracker.py`, `test_weather.py`, ...); shared helpers and the guard
that keeps tests off the network are in `tests/support.py`.

## What cannot be checked from a cloud session

Install, upgrade, rollback, restore and the root helper act on a real machine with systemd; the
unit tests run them against a pretend root folder, and the workflow's rehearsal job runs them for
real on the CI runner. The receiver Pi and the tunnel can only be checked by the owner.
