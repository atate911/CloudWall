# What CloudWall's server answers

Everything a screen draws comes from a handful of JSON answers. CloudWall's own page reads them,
and so can anything else on your network: a Home Assistant card, a widget, a script. This is what
is in each, key by key.

`tests/test_api.py` reads the tables below and checks them against what the server really sends:
a key added, dropped or renamed in the code fails the tests until this file says so. So the tables
are what the server does, not what it once did.

**A private link.** With `[server] key` set (see the README), every address below is under
`/k/<key>/` (`/k/<key>/api/state`), and a request anywhere else is answered 401 and nothing more.

**What can change.** A key may be added at any time, so ignore the ones you don't know. Taking a
key away, or changing what one means, raises `api` in `/api/state` (it is `1` now).

**Units.** Altitudes are feet, speeds knots, distances nautical miles, rates of climb feet a
minute, bearings and tracks degrees true, temperatures °C, times seconds since 1970 (UTC).
`null` means not known.

**Which place.** Every `/api/...` request can carry `?place=<id>` (the ids are in `places`
below); without it the answer is for the first place. `?kiosk=1` instead asks for the place the
wall panel is set to show.

## `GET /api/state`

The board as it stands, for one place. Asking counts as a screen looking at that place: its data
is fetched only while something asks (see "Only while someone is looking" in the README).

| Parameter | Meaning |
|---|---|
| `range` | How far out the asker's radar shows, in nm (one of `ranges`). The feed is asked that far while something keeps asking; left out, the tracking radius. |
| `square=1` | The radar is the ATC style's square, whose corners reach 1.4 times as far. |
| `reach=` | The Map view, a rectangle the shape of its panel: how many times `range` its corners reach (1 to 3). |
| `pin` | The `hex` of a flight this screen follows: it takes `hero` for this request only. |

<!-- shape: state -->
| Key | Present | What it is |
|---|---|---|
| `api` | always | The version of this shape: `1`. |
| `now` | always | The server's clock when it answered. |
| `status` | always | The position feed: `source` (its host), `ok`, `updated` (when positions were last received) and `error` (the last failure's words, or null). |
| `place` | always | The id of the place this answer is for. |
| `places` | always | Every place being watched: `id`, `name`, `icao`, `iata`, `city`, `zip`, `lat` and `lon` (to three decimals, a few hundred feet, so a screen using its own location can find a place already there), and `added` (true if it was set up from a screen, and so can be removed). |
| `home` | always | The place itself: `name`, `lat`, `lon`, `elevation_ft` (and `zip` if it was set by one). |
| `airport` | always | Its airport: `icao`, `iata`, `name`, `city`, `lat`, `lon`, `elevation_ft`; `runways` (each `name`, `ends` as two `[lat, lon]`, `length_ft`); `others`, the small fields nearby (`code`, `icao`, `name`, `city`, `lat`, `lon`, `elevation_ft`, `runways`); `airspace` (Class B, C and its own D: `id`, `class`, `floor`, `ceiling`, `label`, `rings`); `navaids` (`ident`, `name`, `type`, `lat`, `lon`); `helipads`, the hospital helipads out past the radar's longest range (`code`, `name`, `short`, `city`, `lat`, `lon`, `elevation_ft`; the US only). |
| `tracking` | always | The `[tracking]` settings in force: `radius_nm`, `overhead_nm`, `max_overhead_alt_ft`, `poll_seconds`, `when_idle`, `idle_after_seconds`. |
| `ranges` | always | The ranges a radar can ask for, in nm: the tracking radius, then the longer ones. |
| `kiosk` | always | The `[kiosk]` settings: `place`, `view` (`card`, `radar`, `map` or `sky`), `radar`, `tracks`, `range_nm`, `density` (`simple` or `detailed`), `quiet` (the panel's quiet hours, "23:00-06:30", or ""). |
| `aircraft` | always | Every aircraft within the tracking radius, nearest first: [aircraft](#an-aircraft). |
| `beyond` | always | Aircraft in the air past the tracking radius, there only while a longer `range` is asked for. They are for the radar alone: never looked up, never on the card. |
| `hero` | always | The aircraft on the flight card: the one this screen follows, else the one overhead; else null. An [aircraft](#an-aircraft) with its track. |
| `overhead` | always | The `hex` of the aircraft overhead, whatever this screen follows; or null. |
| `pinned` | always | The `hex` asked for with `pin`, if it is within the tracking radius; else null (it has left: stop asking). |
| `next` | always | With no `hero`: the aircraft due overhead soonest, or null. |
| `emergency` | always | Aircraft squawking 7500, 7600 or 7700 for two updates running, nearest first. |
| `flow` | always | Which way the airport is landing, from recent arrivals: `dir` ("west"), `label` ("West flow"), `runways` ("28L / 28R"). Null until one has been seen, and after an hour without. |
| `trail_s` | always | Seconds between positions in a `trail`, as the feed is actually answering. |
| `today` | always | Flyovers logged today. |
| `seats_today` | always | The seats estimated to have been on them. |
| `weather` | always | The airport's latest report in short, or null: `station`, `raw`, `category`, `temp_c`, `wind_dir`, `wind_kt`, `gust_kt`, `visibility`, `cover`, `clouds`. |
| `tfrs` | always | Flight restrictions nearby: [a restriction](#a-flight-restriction). |
| `heard` | always | Military aircraft heard nearby that send no position: an aircraft's [feed keys](#from-the-feed) with `lat` and `lon` null, plus `rough_nm`, how far the receiver that heard it is. |
| `contrails` | always | The contrail forecast in short, or null: `summary`, `persistent` and `short` (each `[from_ft, to_ft]` or null), `at`, `source`. |
| `live_routes` | always | The paid route provider's state, or null without one: `name`, `label`, `enabled`, `mode`, `unit`, `margin`, `used_today`, `daily_limit`, `period_used`, `period_budget`, `monthly_limit`, `resets`, `reported`, `problem`. |
| `basemap` | always | The radar's map: `enabled`, `style`, `attribution`, `opacity`, `zooms`, `reach_nm` (how far from home its tiles are served). |
| `charts` | always | The chart layers the server can serve as tiles: `map`, `atc` (or null) and `layers` by name, among them `world`, the flight card's route map, served everywhere at zooms 0 to 6 (absent when `[map] route` is off). |
| `logos` | always | Whether airline logos are served at `/logos/<IATA>`. |
| `restart` | always | True when the server's code has changed on disk since it started: it wants restarting. |

### An aircraft

One record for each aircraft, built up in three steps. Every record has the first two groups.

#### From the feed

<!-- shape: aircraft.feed -->
| Key | Present | What it is |
|---|---|---|
| `hex` | always | Its ICAO 24-bit address, lower case: what identifies it. |
| `callsign` | always | What it is transmitting ("ASA512", "N751SP"), or null. |
| `reg` | always | Its registration, or null. (Filled in from the airframe lookup when the feed has none.) |
| `type` | always | Its ICAO type designator ("B739"), or null. |
| `desc` | always | The feed's description of the type ("Boeing 737-990ER"), or null. |
| `category` | always | Its ADS-B emitter category ("A3"), or null. |
| `alt` | always | Barometric altitude; 0 when it says it is on the ground. |
| `alt_gps` | always | Geometric altitude. |
| `on_ground` | always | True on the ground: by its own word, or because it is slow at about field level. |
| `gs` | always | Ground speed. |
| `track` | always | The way it is going over the ground (its heading, where the feed has only that). |
| `vrate` | always | Rate of climb; negative descending. |
| `lat` | always | Latitude. |
| `lon` | always | Longitude. |
| `squawk` | always | Its transponder code, as text ("1200"). |
| `emergency_status` | always | The transponder's own emergency status when it sends one ("general", "nordo", "unlawful", ...), or null. |
| `military` | always | True for a military aircraft. |
| `private_owner` | always | True when the owner has asked not to be identified (LADD, PIA): `owner` is then null. |
| `year` | always | The year it was built. |
| `owner_op` | always | Its owner or operator, as the feed has it. |
| `target_alt` | always | The altitude selected on its autopilot. |
| `modes` | always | What its autopilot says it is doing: any of "autopilot", "approach", "lnav", "vnav", "althold", "tcas". |

#### Worked out for every aircraft

<!-- shape: aircraft.derived -->
| Key | Present | What it is |
|---|---|---|
| `dist` | always | How far it is from home. |
| `brg` | always | Its bearing from home. |
| `compass` | always | That bearing as one of sixteen points ("NNW"). |
| `elev` | always | How high above the horizon to look for it, in degrees; null without an altitude. |
| `cpa_s` | always | Seconds until it is closest to home, if it holds its track and speed; 0 when it is already going away. |
| `cpa_nm` | always | How close that will be. |
| `phase` | always | "ground", "climbing", "descending" or "level". |
| `cwt` | always | Its type's wake category, "A" (super) to "I" (small), or null. |
| `emergency` | always | The badge for a trouble code it is showing ("EMERGENCY 7700"), or null. |
| `spc` | with a trouble code | The code itself: "7500", "7600" or "7700", by its squawk or its transponder's status. |
| `icon` | when its kind is known | Which kind of traffic the radar draws it as: "light", "twin", "turboprop", "bizjet", "regional", "airliner", "heavy", "quad", "fighter", "heli", "tandem", "tiltrotor", "gyro", "glider", "seaplane", "ultralight", "drone", "airship" or "balloon". |
| `colors` | for an airline CloudWall has colours for | Its livery: `[main, accent]`, each "#rrggbb". |
| `contrail` | in the air, within the tracking radius | "persistent" or "short" if it is likely leaving a contrail, else null. |
| `activity` | in the air | What it is doing: "arr" (arriving at the place's airport), "dep" (departing it), "loc" (flying locally: no flight plan, or to and from a small field nearby) or "pass" (passing over). Every screen colours it by this. |
| `notable` | when it is worth a look | Why: "emergency", "medical", "military", "rare" (a rare type) or "unusual" (a balloon, airship, glider, gyrocopter or twin-rotor helicopter). |
| `medical` | for a medical flight | True: its transponder's lifeguard status, an air ambulance's operator or callsign, or a helicopter landing at or lifting off from a hospital's helipad (one with nothing medical in its name must be seen right at the helipad on two updates running). |
| `hospital` | when a helicopter's hospital is clear | The helipad it is landing at, has just lifted off from or (a medical one) is heading for: `code`, `name`, `short`, `city`, `lat`, `lon`, `state` ("landing", "left" or "heading"), `dist_nm`, and `eta_s` (seconds to get there, from `now`) unless it has left. |
| `tail` | in the air | Its last two minutes as reported, `[lat, lon]` oldest first, at most 16 points: the radar's short track behind it. |
| `coasting` | while the feed has lost it | A followed flight the feed left out is carried on along its track for up to 30 s: since when. Its position is then an estimate. |

#### Looked up, for the aircraft that matter

The ten nearest, any due overhead within ten minutes, any a screen follows and any in an emergency
are looked up; the rest have none of these keys. A lookup never holds an answer up, so its result
appears a few seconds after the aircraft does.

<!-- shape: aircraft.details -->
| Key | Present | What it is |
|---|---|---|
| `shape` | always | Its type's broad shape, for its drawing: "piston", "heli", "turboprop", "bizjet", "regional", "narrow", "wide", "quad" or "fighter". |
| `length` | always | Its type's overall length in metres. |
| `known` | always | False when `shape` and `length` are a guess from its emitter category, not from the table of types. |
| `airline_iata` | always | The code its airline's logo is served under (`/logos/AS`), or null. |
| `seats` | always | Seats on board, estimated: `n`, `lo`, `hi` and `basis` ("airline", "type" or "cargo"); or null. |
| `flight_no` | always | Its flight number as a departure board shows it ("AS512"), or null. |
| `local` | always | "arriving" at or "departing" the place's airport or a small field nearby, "local" (low over a small field), or null. An aircraft that isn't looked up gets it too, from how it is flying near the airport. |
| `local_inferred` | when `local` isn't from its route | True if `local` was made out from how it is flying; false if there was nothing to go on. |
| `local_field` | at a small field | The field: `code`, `name`, `city`. |
| `landing_est` | arriving with no believable route | When it should land. |
| `type_name` | when anything names the type | The type in words ("Boeing 737-990ER"). |
| `model` | once its airframe is found | The registry's name for the model, which tells variants apart. |
| `owner` | once its airframe is found, or the feed names one | Its registered owner; null for a `private_owner`. |
| `age` | when its year is known | Years since it was built. |
| `airline` | for an airline's flight | The airline's name: the one a passenger would book with. |
| `operated_by` | when another airline flies it | The airline operating the flight for `airline`. |
| `photo` | once a credited photo is found | A photo of this airframe: its address. |
| `photo_link` | with `photo` | The photo's page at planespotters.net. |
| `photo_by` | with `photo` | Its photographer. A photo must be shown with this credit and that link. |
| `route` | once a route is found | [A route](#a-route). |
| `route_pending` | while a paid route is on its way | True: the free route, which may be out of date, is held back for the second or two it takes. |

#### Only sometimes

<!-- shape: aircraft.other -->
| Key | Present | What it is |
|---|---|---|
| `badges` | once it has come overhead | What is notable about the flyover: "NEW TYPE", "NEW AIRLINE", "RARE TYPE", "HEAVY", "HELICOPTER", "MILITARY", "MEDICAL", "3rd VISIT", an emergency. |
| `emergency_code` | in `emergency` | "7500", "7600" or "7700". |
| `emergency_title` | in `emergency` | "Emergency", "Radio failure" or "Hijack code". |
| `emergency_meaning` | in `emergency` | A sentence on what the code means. |
| `emergency_since` | in `emergency` | When it was first seen showing the code. |
| `seq` | arriving at the place's airport | Its place in the landing order, from 1. |
| `rwy` | with `seq` | The runway it is lining up for: one in use when the flow is known, else the one whose approach suits it best. |
| `lands_s` | with `seq` | Seconds until it lands, about: along the final approach when it is on it, else by way of joining it 6 nm out. |
| `gap_s` | with `seq` | Seconds after the one ahead of it lands; null for the first. |
| `path` | on `hero` | Where it has been since it came in range: `[lat, lon, altitude in hundreds of feet]`, a point each time it moved 0.15 nm or 300 ft. |
| `trail` | on `hero` | Its last positions as reported, `[lat, lon]`, `trail_s` apart. |

### A route

<!-- shape: route -->
| Key | Present | What it is |
|---|---|---|
| `flight` | always | The flight number ("AS512"). |
| `airline` | always | The airline's name, or null. |
| `origin` | always | Where it left: `iata`, `city`, `name`, `lat`, `lon` (any may be null). |
| `dest` | always | Where it is going, likewise. |
| `plausible` | always | False when the route doesn't fit where the aircraft is: the database is out of date for this flight number. Show such a route as doubtful, or not at all. |
| `flown_nm` | always | Distance from the origin. |
| `left_nm` | always | Distance to the destination. |
| `progress` | always | How far along it is, 0 to 1; null when an end's position isn't known. |
| `eta_est` | always | CloudWall's own estimate of when it lands, from distance and speed; null on the ground or too slow to say. |
| `airline_iata` | from the free database | The airline's code. |
| `source` | from a paid provider | "flightradar24" or "flightaware": the route is of the flight actually in the air. |
| `source_label` | from a paid provider | The provider's name for showing. |
| `departed` | from a paid provider | When it took off. |
| `eta` | from a paid provider | When the provider expects it in (FlightAware), else null. |
| `landed` | from Flightradar24 | When it landed, else null. |
| `arrival_delay_s` | from a paid provider | How late it is running (FlightAware), else null. |
| `status` | from a paid provider | The provider's words for its state (FlightAware), else null. |
| `progress_percent` | from a paid provider | The provider's own figure (FlightAware), else null. |
| `route_nm` | from a paid provider | The length of the route (FlightAware), else null. |
| `operating_as` | from Flightradar24 | The airline flying it, by ICAO code. |
| `painted_as` | from Flightradar24 | The airline it is flown for. |

### A flight restriction

<!-- shape: tfr -->
| Key | Present | What it is |
|---|---|---|
| `id` | always | Its NOTAM number ("6/7769"). |
| `name` | always | What it is called, or where it is. |
| `kind` | always | What kind, in words ("Security", "Space launch or recovery"). |
| `dist_nm` | always | How far its nearest edge is from home; 0 inside it. |
| `shapes` | always | Its outlines: each a list of `[lat, lon]`. |
| `active` | always | True if it is in force now, false if it starts later. |
| `title` | always | Its title in the FAA's list. |
| `modified` | always | When the FAA last changed it, as the FAA writes it. |
| `code` | once its notice is read | The regulation it is issued under ("99.7", "91.137(a)(1)", "44812"). |
| `drones_only` | once its notice is read | True when it restricts unmanned aircraft only. |
| `start` | once its notice is read | When it begins, or null. |
| `end` | once its notice is read | When it ends, or null. |
| `floor` | once its notice is read | Its lower limit: `ft` and `text` ("the surface"); or null. |
| `ceiling` | once its notice is read | Its upper limit, likewise. |
| `text` | once its notice is read | The notice in full. |

## `GET /api/weather`

The airport's weather in full, with the contrail forecast level by level and the restrictions
again. Asking counts as a screen looking. Empty of weather until the first report has arrived.

<!-- shape: weather -->
| Key | Present | What it is |
|---|---|---|
| `station` | once a report has arrived | The airport's ICAO code. |
| `name` | once a report has arrived | The station's name. |
| `elevation_ft` | once a report has arrived | Its elevation. |
| `fetched` | once a report has arrived | When this was fetched. |
| `now` | once a report has arrived | The latest [report](#a-weather-report). |
| `history` | once a report has arrived | The last 24 hours of reports, oldest first. |
| `taf` | once a report has arrived | The forecast, or null: `raw`, `issued`, `from`, `to` and `periods` (each `from`, `to`, `change`, `probability`, `wind`, `visibility`, `clouds`, `ceiling`, `category`, `weather`, `wind_shear`). |
| `contrails` | always | The forecast in full, or null: as `contrails` in the state, plus `levels` (each `hpa`, `ft`, `temp_c`, `rhi`, `threshold_c`, `state`). |
| `tfrs` | always | As `tfrs` in the state. |

### A weather report

<!-- shape: metar -->
| Key | Present | What it is |
|---|---|---|
| `time` | always | When it was observed. |
| `raw` | always | The METAR as issued. |
| `special` | always | True for a special report (SPECI). |
| `category` | always | "VFR", "MVFR", "IFR" or "LIFR". |
| `wind` | always | `dir` (degrees, or null when variable or calm), `variable`, `speed` and `gust` in knots. |
| `visibility` | always | Statute miles. |
| `visibility_plus` | always | True when that is "more than". |
| `clouds` | always | Each layer: `cover` ("FEW", "SCT", "BKN", "OVC"), `base` in feet, `oktas`. |
| `ceiling` | always | The lowest broken or overcast layer's base, or null. |
| `cover` | always | The sky's overall cover. |
| `temp_c` | always | Temperature; null when the sensor is out. |
| `dew_c` | always | Dew point. |
| `humidity` | always | Relative humidity, per cent. |
| `altimeter_inhg` | always | Altimeter setting in inches of mercury. |
| `altimeter_hpa` | always | And in hectopascals. |
| `density_alt` | always | Density altitude at the field. |
| `weather` | always | The weather in words ("light rain, mist"); empty when there is none. |
| `weather_raw` | always | As coded ("-RA BR"), or null. |

## `GET /api/logbook`

<!-- shape: logbook -->
| Key | Present | What it is |
|---|---|---|
| `today` | always | Flyovers logged today. |
| `total` | always | And in all. |
| `seats_today` | always | `seats` (the estimate's sum), `known` (flyovers it covers), `flights`. |
| `seats_total` | always | The same, for all time. |
| `types` | always | Each type ever logged, most seen first: `type`, `name`, `model`, `n`, `first`, and its `shape`, `length` and `known` as on an aircraft. |
| `types_today` | always | Today's, likewise (without `first`). |
| `airlines` | always | Each airline logged: `icao`, `name`, `n`. |
| `hours` | always | Today's flyovers by hour of the day: `hour`, `n`. |
| `records_today` | always | Today's `highest`, `lowest`, `fastest`, `closest` and `furthest_origin`: each `value`, `callsign`, `flight`, `type`, `origin`, `dest`, `ts`; or null. |
| `records_all` | always | The same, for all time. |
| `recent` | always | The last 40 flyovers, newest first: [a flyover](#a-flyover). |

### A flyover

One for each pass overhead, however long it took.

<!-- shape: flyover -->
| Key | Present | What it is |
|---|---|---|
| `id` | always | Its number in the logbook. |
| `ts` | always | When it came overhead. |
| `day` | always | That day, local time ("2026-11-19"). |
| `hex` | always | The aircraft. |
| `callsign` | always | What it was transmitting. |
| `reg` | always | Its registration. |
| `type` | always | Its type designator. |
| `type_name` | always | The type in words. |
| `model` | always | The registry's name for the model. |
| `airline_icao` | always | Its airline's ICAO code, for an airline's flight. |
| `airline` | always | The airline's name. |
| `flight` | always | Its flight number. |
| `origin` | always | Where it came from, by code: filled in once a believable route is known. |
| `dest` | always | Where it was going. |
| `origin_nm` | always | How far away the origin is. |
| `min_dist_nm` | always | How close it came. |
| `alt_ft` | always | Its altitude at that closest point. |
| `gs` | always | Its ground speed there. |
| `lat` | always | Where that point was; null in entries from before this was kept. |
| `lon` | always | Likewise. |
| `track` | always | Which way it was flying there. |
| `vrate` | always | Its rate of climb there. |
| `seats` | always | Seats on board, estimated. |
| `badges` | always | What was notable about it, as on an aircraft. |
| `photo` | always | A photo of the airframe, if one was found. |
| `photo_by` | always | Its photographer. |
| `photo_link` | always | Its page. |
| `shape` | always | Its type's shape, as on an aircraft. |
| `length` | always | Its type's length. |
| `known` | always | Whether those are from the table of types. |

## `GET /api/type`

About one aircraft type, for the panel a tap on its drawing opens: its write-up and the facts chosen
for it (from `cloudwall/data/types/`; empty for a type nobody has written about yet), what is needed
to draw it, and what this place's logbook knows of it.

| Parameter | Meaning |
|---|---|
| `type` | Its ICAO type designator ("B39M"). 400 with `error` if it isn't one. |
| `hex` | Optional: the airframe tapped, for `airframe`. |

<!-- shape: type -->
| Key | Present | What it is |
|---|---|---|
| `type` | always | The type designator, upper case. |
| `name` | always | Its name ("Boeing 737 MAX 9"): the write-up's, else the one it was last logged under; or null. |
| `family` | always | The family the write-up covers ("Boeing 737 MAX"), or null without one. |
| `text` | always | The write-up, as paragraphs of plain text; empty without one. |
| `facts` | always | The facts chosen for the type, in order: each `[label, value]`, both text ("Range", "6,570 km"). |
| `production` | always | The years it was delivered, `[first, last]`, last null while it is still built; or null. |
| `shape` | always | Its shape, as on an aircraft. |
| `length` | always | Its length. |
| `known` | always | Whether those are from the table of types. |
| `icon` | always | The kind of traffic the radar draws it as, as on an aircraft, or null. |
| `cwt` | always | Its wake category, as on an aircraft, or null. |
| `seats` | always | Its usual seats in North America, as `seats` on an aircraft (with `basis` "type"), or null. |
| `seen` | always | The type in this place's logbook: [its sightings](#a-types-sightings). |
| `airframe` | always | With `hex`: that airframe in the logbook, `n` (times it has come over) and `first` (when first, or null). Without, null. |

### A type's sightings

<!-- shape: type.seen -->
| Key | Present | What it is |
|---|---|---|
| `n` | always | Flyovers of the type logged. |
| `of` | always | Flyovers of every type logged. |
| `first` | always | When it was first logged, or null. |
| `last` | always | And last. |
| `airframes` | always | How many different airframes. |
| `rank` | always | Its place among the types logged by flyovers, 1 the most often (equal counts share a place); null if never logged. |
| `types` | always | How many types have been logged. |
| `airlines` | always | The airlines that have flown it over most, at most three: `icao`, `name`, `n`. |

## The rest

| Request | Answer |
|---|---|
| `GET /api/heat` | Today's traffic as a grid over the tracking radius: `grid` (cells a side, north up: 240, an eighth of a nm at 15 nm), `radius_nm`, `aircraft` (how many flew within it today), and `cells`, each `[x, y, count]` counted from the north-west corner, the count being how many times aircraft crossed that cell (each one's path is drawn as a line between its reports). |
| `GET /api/locate?q=` | Where a US ZIP code ("98683") or coordinates ("45.63, -122.66") are: `lat`, `lon`, `zip`; `auto`, the airport CloudWall would choose; and `airports`, the airline airports nearest (`icao`, `iata`, `name`, `city`, `size`, `dist_nm`). 400 with `error` when it is neither. |
| `POST /api/places` | Set up a place: a JSON body with `q` (as for locate), and optionally `name` and `airport` (an ICAO code; "auto" when left out). Answers `place`, its summary as in `places`; 400 with `error` in words fit to show. Refused (403) from another site's page. |
| `DELETE /api/places?id=` | Remove a place set up that way (not one from the config file). Answers `places`. |
| `GET /tiles/<layer>/<z>/<x>/<y>` | A map or chart tile around a watched place, cached; `/tiles/<z>/<x>/<y>` is the radar's own map. 404 outside the area or where the layer has none. |
| `GET /logos/<IATA>` | An airline's logo as a PNG, cached; 404 when there isn't one. |
