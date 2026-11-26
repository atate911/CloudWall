"""The airband radio: hearing aircraft and ATC through a software-defined radio (incubating).

Nothing in CloudWall imports this package yet. It is the start of the Radio tab, built and tested
on its own until it is ready to be joined to a Place. README.md beside this file says what it is
for, what one receiver can and cannot do, what a second receiver or an Airspy adds, and the order
the work is planned in.

  channels   airband frequencies: parsing (25 kHz and 8.33 kHz), kinds, OurAirports' table
  plan       which frequencies each receiver can hear at once, and which are left to scan
  airband    RTLSDR-Airband's config, written from a plan
  segment    a channel's audio into transmissions (start, end, level, WAV)
  listen     RTLSDR-Airband's UDP audio into the segmenter
  predict    which channel an aircraft is probably on, from where it is and what it is doing

`python3 -m cloudwall.radio --help` runs the pieces from the command line, for trying them on
real hardware before they are part of the app.
"""
