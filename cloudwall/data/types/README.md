# About each type

What the panel a tap on an aircraft's drawing opens says about its type: a short write-up, a few
facts chosen for that type, and the years it was delivered. One TOML file per family, named for it
(`b737max.toml`, `e175.toml`). `cloudwall/about.py` reads them, and `tests/test_cloudwall.py` holds
every file to this format. `python3 tools/type_notes.py` lists which types have a write-up and which
still need one, the ones seen most over the house first.

A type with no file still opens the panel: its drawing, its usual seats and wake category, and what
the logbook knows of it. A file makes it worth opening. The files are read as CloudWall starts, so
restart it to see a change.

## The file

```toml
name = "Boeing 737 MAX"                       # the family
types = ["B37M", "B38M", "B39M", "B3XM"]      # the ICAO type designators it covers
production = [2017]                           # years delivered: [first] while still built, [first, last] once ended
checked = "2026-11"                           # when its facts were last checked against its sources
sources = [                                   # the pages every fact and number was checked against
  "https://...",
]

text = """
The first paragraph. Lines may be wrapped anywhere; a blank line starts the next paragraph.

The second.
"""

[facts]                                       # in the order shown; only what's worth knowing of this type
"Range" = "6,570 km"
"Max takeoff weight" = "88,300 kg"

[variants.B39M]                               # where one model differs from its family
name = "Boeing 737 MAX 9"
more = """A paragraph added after the family's text."""
# text = """...""" instead replaces the family's text; production and facts work as above,
# a variant's facts going over the family's and adding to them
[variants.B39M.facts]
"Range" = "6,110 km"
```

Seats are left out: they come from `data/seats.csv`, by airline, and the panel adds them, with the
wake category from `data/cwt.csv`. The panel also works out, for the airframe tapped, where its
build year falls in `production`, and how often the type and that airframe have come over.

## How they are written

The write-ups are for enthusiasts, so they say what an enthusiast would tell a friend standing next
to them, not what a spec sheet lists.

- **The shape follows how often it's seen.** A type over the house every day (an E175, a 737) gets
  a dense, data-led write-up: what it is built from and why it looks and performs as it does. A
  rare visitor (a DC-3, a B-17) gets its story. Most sit between.
- **Numbers earn their place.** One that explains something (the MAX's bigger fan, and why the nose
  gear grew) or is notable (a cabin pressurised to 6,000 ft) belongs; length, wingspan and cruise
  speed for their own sake don't. The same goes for the facts strip: three to six that matter for
  this type, not a table every type fills in.
- **Engineering where it explains.** Materials, engines, systems, structure, when they say why the
  aircraft is the way it is.
- **Appearance, when it's distinctive,** in the prose, where it falls naturally: the split winglets,
  the wings that flex up in flight, the engines under the wing where a CRJ has them on the tail. Not
  every type needs it, and never as a tacked-on line.
- **Write it as prose, not a formula.** Let sentences run where the idea needs room; don't clip them
  to sound terse. No set-up lines ("It nearly didn't survive"), no headings, no "which is why"
  chains, and no sentence that only tells you the next one will be interesting.
- **Two paragraphs, three at most.** One good story can be one paragraph.
- **True for years.** Fleet counts, prices and order books go out of date; leave them out, or say
  "as of" with a year. Prefer facts that won't move.
- **Every number checked.** Each fact against a source listed in `sources` (the manufacturer, the
  FAA or EASA type certificate, the operator, reputable aviation press), and `checked` set to the
  month it was done.
