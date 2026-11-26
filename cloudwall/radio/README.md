# The airband radio (incubating)

Hearing aircraft and ATC through a software-defined radio, for a Radio tab to come. Nothing in
CloudWall uses this package yet: it is being built and tried on real hardware on its own first.

## What the hardware does

Voice ATC is AM, 118.000–136.975 MHz: 19 MHz of band, channels 25 kHz apart in the US. A receiver
digitises one slice of it at a time, as wide as its sample rate less the edges where its filters
roll off:

| Receiver | Slice it hears | Share of the airband | Cost | Notes |
|---|---|---|---|---|
| RTL-SDR dongle | ~2.0 MHz (2.4 MS/s) | ~11% | ~$30 | 8-bit; overloads near strong FM/pager transmitters |
| Two RTL-SDR dongles | 2 × ~2.0 MHz, anywhere | ~21% | ~$60 | two antennas, or one through a splitter |
| Airspy Mini | ~5 MHz (6 MS/s) | ~27% | ~$130 | 12-bit, much better selectivity and dynamic range |
| Airspy R2 | ~8.5 MHz (10 MS/s) | ~45% | ~$200 | the most a Pi 4 can likely demodulate; a Pi 5 to be safe |

Every channel inside a slice can be heard at once: RTLSDR-Airband's *multichannel* mode, with
nothing missed. A channel outside the slice can only be *scanned*: hop to it, listen for a carrier,
move on. Scanning clips the start of each call and misses anything said elsewhere meanwhile.

Two things hold whatever the receiver:

- **One receiver, one program.** The dongle is held by whichever program opened it, so with one
  dongle every use below is a mode, taken in turn, never two at once.
- **Line of sight.** From a house, aircraft in the air come in clearly from far away; the
  controllers' side, transmitted from the airport or a hilltop, may not, and ground, clearance and
  ATIS are often out of reach. What can be heard has to be found out on the roof, not assumed.

## What to do with one antenna and one dongle, in order

1. **Hear one slice at once.** `plan.py` picks the 2 MHz slice holding the most worth of the home
   airport's channels (tower and approach first, then centre, CTAF, ground, guard, clearance, ATIS),
   keeping the dongle's DC spike off every channel. `airband.py` writes RTLSDR-Airband's config for
   it; each channel's audio arrives on a UDP port of its own, only while its squelch is open.
2. **A log of calls.** `segment.py` cuts each channel's audio into calls at the gaps (start, end,
   level, WAV); `listen.py` runs it on the UDP streams. This is the transmission log the Radio tab
   will show, and what a screen will play. Cheap on a Pi, useful at once, and everything after
   builds on it.
3. **Or scan instead.** For a home airport whose channels are spread over more than 2 MHz, the
   alternative mode: one dongle scanning the whole list, each call written to its own file named
   with its frequency. The choice (parked on the busiest slice, or scanning everything) is a
   setting, and can be switched at a whim.
4. **Guess the channel of an aircraft.** `predict.py`: from where it is and what it is doing, which
   kind of channel it is probably on (ground, tower, approach, departure, centre, CTAF). In parked
   mode it chooses what a screen plays when an aircraft is selected; in scan mode it gives that
   channel priority. This is the first, roughest form of *following* an aircraft.
5. **Who's talking.** Transcribe each call (Whisper; whisper.cpp's small models on a Pi 5, or sent
   to a bigger computer in the house) and match the callsign heard against the dozen aircraft on the
   radar. With so few to choose from, a fuzzy match is enough. Then the radar rings the aircraft
   talking, and the transcript appears on its card and the wall panel.
6. **Learn the sectors.** Each matched call is a fact: this aircraft, here, at this height, on this
   channel. A few days of them map which approach or departure frequency covers which direction and
   height, replacing step 4's rules with what is really so here. Handoffs heard ("contact Portland
   Tower one one eight point seven") name the next channel outright: true following.
7. **Other uses of the same dongle and antenna, as modes taken in turn:**
   - **ACARS / VDL2** (129–137 MHz, the same antenna): airliners' text messages, with gate and
     takeoff times and tail-to-flight pairings that could check or fill in the routes. Needs its
     own decoder (acarsdec, dumpvdl2) holding the dongle, so it is a mode, not a channel.
   - **NOAA Weather Radio** (162.400–162.550 MHz FM, the same antenna): the local forecast and
     warnings, for the Weather tab.
   - **Discovery:** sweep the band for a day, log where carriers appear and how often, and suggest
     the channel list from what is really heard here, not just what is published.

Not for this antenna: ADS-B on 1090 MHz (its own antenna, and a dongle to itself) and military UHF
(225–400 MHz AM, which would hear the jets the board now lists as "heard, with no position"; a
VHF airband antenna is poor there).

## What a second dongle adds

- **Two slices at once.** `make_plan` gives the second dongle the slice adding most of what the first
  leaves out. For most airports tower and approach go on one, ground, ATIS and centre on the other.
- **Or one parked, one scanning** (`--scan`): the busiest slice heard in full, the rest scanned.
- **Or one parked, one on another job** at the same time: ACARS/VDL2 all day, or ADS-B on 1090
  MHz with its own antenna, which makes positions CloudWall's own (no feed, a second's lag) and
  lets it hear what the feeds filter out.
- A splitter feeds both from the one antenna (with a few dB lost), so a second antenna isn't needed
  for airband.

## What an Airspy adds

- **A slice big enough for an airport.** An Airspy R2's 8.5 MHz usually holds all of a large
  airport's tower, ground, clearance, ATIS and nearest approach channels: the scanner becomes a
  receiver that misses nothing that matters here.
- **Better reception of the same signals:** 12 bits and real filtering, so weak aircraft beside a
  strong local transmitter come through, where a dongle overloads.
- **The cost is CPU:** demodulating 10 MS/s is the heaviest job here; a Pi 5, or a Pi 4 at the lower
  rate (6 MS/s, about 5 MHz). RTLSDR-Airband drives it through SoapySDR; the config this package
  writes already covers it (`--receiver airspy-r2`).
- With an Airspy for airband, the dongle is free for ADS-B, ACARS or NOAA weather all the time.

## How it fits together

```
  receiver ──▶ rtl_airband (config written by airband.py from plan.py's plan)
                 │ multichannel: each channel's audio, UDP to 127.0.0.1:6001…
                 │ scan:         each call a file named with its frequency
                 ▼
               listen.py ──▶ segment.py ──▶ a call: channel, start, end, level, WAV
                                              │
          (to come)   a store of calls ◀──────┤──▶ transcription (a worker, optional)
                      /api/radio for the tab   └──▶ predict.py / matching to the tracker's aircraft
```

RTLSDR-Airband does the radio work, in C, because pure Python can't keep up with millions of
samples a second; CloudWall stays standard-library only and does everything from the audio on.

## Trying it

With the dongle and antenna on the Pi, RTLSDR-Airband built and installed, and OurAirports'
[airport-frequencies.csv](https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv)
downloaded:

```bash
python3 -m cloudwall.radio plan KPDX KVUO --frequencies airport-frequencies.csv --config rtl_airband.conf
```

```bash
rtl_airband -f -c rtl_airband.conf
```

```bash
python3 -m cloudwall.radio listen KPDX KVUO --frequencies airport-frequencies.csv --save calls/
```

`listen` makes the same plan as `plan`, so the ports match, and prints a line a call.

## To find out on the real hardware

- RTLSDR-Airband's option names (written for version 5): `udp_stream`'s fields and its audio format
  (taken to be 8 kHz mono float32), and the file output's `split_on_transmission` and `include_freq`.
- The clean share of each receiver's slice (taken as 85%) and the gain that suits the antenna.
- The dongle's frequency error (`--ppm`), and how wide the squelch gaps between calls really are.
- Which of the home airport's channels can be heard from the house at all.

## Then, in the app

A `[radio]` section in the config (receivers, airports, mode); a thread on the Place running the
listener; calls kept in the store with their channel and the aircraft matched to them;
`/api/radio` and an audio endpoint; and the Radio tab: the channel list with activity lights, tap
to listen, several at once to scan, the call log with playback, and, when an aircraft is selected,
its probable channel.
