"""Airband frequencies: what a channel is, how its frequency is written, and where the list comes from.

Frequencies are kept in whole hertz throughout, so a channel can be compared, sorted and written
into a receiver's config without rounding. Voice ATC is AM between 118.000 and 136.975 MHz. In the
US channels are 25 kHz apart; in Europe many are 8.33 kHz apart, and their published "channel name"
is not their frequency: 118.005 is 118.000 MHz on the 8.33 kHz raster, 118.010 is 118.00833, and
118.015 is 118.01667. `parse_mhz` reads both.

The list of an airport's frequencies comes from OurAirports' airport-frequencies.csv (public
domain), whose `type` column is mapped onto a few kinds here.
"""
import csv
import io
from dataclasses import dataclass

AIRBAND_LO = 118_000_000
AIRBAND_HI = 136_975_000
RASTER_25 = 25_000

# OurAirports' type codes, as found in the table, and the kind each is taken for.
KINDS = {
    "TWR": "tower", "TOWER": "tower",
    "GND": "ground", "GROUND": "ground",
    "CLD": "clearance", "DEL": "clearance", "CLNC DEL": "clearance", "PRE TAXI": "clearance",
    "ATIS": "atis", "D-ATIS": "atis",
    "APP": "approach", "A/D": "approach", "APP/DEP": "approach", "A/D/A": "approach", "ARR": "approach", "RADAR": "approach",
    "DEP": "departure",
    "CTR": "center", "CNTR": "center", "ARTCC": "center",
    "CTAF": "ctaf", "MULTICOM": "ctaf",
    "UNIC": "unicom", "UNICOM": "unicom",
    "AWOS": "weather", "ASOS": "weather", "AWIB": "weather",
    "FSS": "fss", "RCO": "fss",
}

# How much hearing each kind is worth, when not every channel fits in a receiver: what an
# aircraft overhead is most likely on, and what is most often busy, first.
WEIGHTS = {
    "tower": 10, "approach": 8, "departure": 8, "center": 6, "ctaf": 5, "ground": 4,
    "guard": 3, "clearance": 3, "atis": 2, "weather": 2, "unicom": 2, "fss": 1, "other": 1,
}

GUARD = 121_500_000          # the emergency frequency, heard everywhere


@dataclass(frozen=True)
class Channel:
    freq: int                  # Hz
    name: str                  # what a screen calls it: "PDX Tower"
    kind: str = "other"        # a key of WEIGHTS
    airport: str = ""          # ICAO ident, empty for one that belongs to no airport (guard)
    weight: float = 0          # 0: the kind's weight

    @property
    def worth(self):
        return self.weight or WEIGHTS.get(self.kind, 1)

    @property
    def mhz(self):
        return format_mhz(self.freq)


def parse_mhz(text):
    """'118.7', '123.775' or an 8.33 kHz channel name ('118.005') into Hz; ValueError if not airband."""
    khz = round(float(text) * 1000)
    block, step = divmod(khz, 25)
    if step not in (0, 5, 10, 15):
        raise ValueError(f"{text} MHz is not on the 25 kHz or 8.33 kHz raster")
    hz = block * RASTER_25 + (round((step // 5 - 1) * 25_000 / 3) if step else 0)
    if not AIRBAND_LO <= hz <= AIRBAND_HI:
        raise ValueError(f"{text} MHz is outside the airband (118.000-136.975)")
    return hz


def format_mhz(hz):
    """Hz into the way a frequency is said: 118700000 -> '118.700', 118008333 -> '118.010'."""
    block, rest = divmod(hz, RASTER_25)
    step = (0, 10, 15)[round(rest * 3 / 25_000)]   # 0 on the 25 kHz raster, else the 8.33 name's last digit
    return f"{(block * 25 + step) / 1000:.3f}"


def kind_of(code):
    return KINDS.get((code or "").strip().upper(), "other")


def from_ourairports(text, idents):
    """The channels of the airports named in `idents`, from airport-frequencies.csv's text.

    Rows that aren't airband voice (a VOR's frequency, a UHF military one) are left out; a frequency
    an airport lists twice is kept once, under its first listing."""
    want = {i.upper() for i in idents}
    seen, out = set(), []
    for r in csv.DictReader(io.StringIO(text)):
        ident = r.get("airport_ident", "").upper()
        if ident not in want:
            continue
        try:
            hz = parse_mhz(r["frequency_mhz"])
        except (ValueError, KeyError):
            continue
        if (ident, hz) in seen:
            continue
        seen.add((ident, hz))
        kind = kind_of(r.get("type"))
        label = (r.get("description") or "").strip() or kind.title()
        out.append(Channel(hz, f"{ident} {label}", kind, ident))
    return sorted(out, key=lambda c: c.freq)


def with_guard(channels):
    if any(c.freq == GUARD for c in channels):
        return list(channels)
    return sorted([*channels, Channel(GUARD, "Guard", "guard")], key=lambda c: c.freq)
