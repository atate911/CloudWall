"""Which channels each receiver hears at once, and which are left to scan.

A receiver digitises one slice of spectrum at a time, as wide as its sample rate less the edges,
where its filters roll off. Every channel inside the slice can be heard at once (RTLSDR-Airband's
"multichannel" mode); a channel outside it can only be visited, by hopping to it and listening for
a carrier ("scan" mode), which misses the start of a call and anything said on another channel
meanwhile.

The airband is 19 MHz wide. An RTL-SDR dongle hears about 2 MHz of it; two dongles two slices;
an Airspy Mini about 5 MHz, an Airspy R2 about 8.5 MHz. With several receivers the slices are
chosen one at a time, each where it adds the most channel worth not already covered (a greedy
cover, which is all a handful of slices and a few dozen channels needs). What no slice reaches is
the scan list, given to whichever receiver is told to scan.

The centre of a slice is kept off any channel: a receiver's own DC spike sits there.
"""
from dataclasses import dataclass, field

# Receivers RTLSDR-Airband can drive, with the sample rate it is usually run at and the share of
# it that is clean enough to listen in. These are starting values, to be checked on the real
# hardware: the waterfall shows where the edges fall off.
DEVICES = {
    "rtlsdr": {"sample_rate": 2_400_000, "usable": 0.85, "airband": {"type": "rtlsdr"}},
    "airspy-mini": {"sample_rate": 6_000_000, "usable": 0.85,
                    "airband": {"type": "soapysdr", "device_string": "driver=airspy"}},
    "airspy-r2": {"sample_rate": 10_000_000, "usable": 0.85,
                  "airband": {"type": "soapysdr", "device_string": "driver=airspy"}},
}

HALF_RASTER = 12_500          # a centre this far from the 25 kHz raster is between channels
DC_CLEAR = 10_000             # and no channel may be closer to it than this


@dataclass(frozen=True)
class Receiver:
    kind: str = "rtlsdr"      # a key of DEVICES
    index: int = 0            # which one of that kind (RTLSDR-Airband's device index or serial)
    sample_rate: int = 0      # 0: the kind's

    @property
    def rate(self):
        return self.sample_rate or DEVICES[self.kind]["sample_rate"]

    @property
    def usable(self):
        return int(self.rate * DEVICES[self.kind]["usable"])


@dataclass
class Slice:
    receiver: Receiver
    center: int
    channels: list = field(default_factory=list)

    @property
    def lo(self):
        return self.center - self.receiver.usable // 2

    @property
    def hi(self):
        return self.center + self.receiver.usable // 2

    def covers(self, freq):
        return self.lo <= freq <= self.hi and abs(freq - self.center) >= DC_CLEAR


@dataclass
class Plan:
    slices: list              # one for each receiver given a slice, best first
    scan: list                # the channels no slice covers, most worth first
    scanner: Receiver = None  # the receiver told to scan them, if any

    @property
    def heard(self):
        return [c for s in self.slices for c in s.channels]


def _snap(center):
    """The nearest point between two 25 kHz channels."""
    return round((center - HALF_RASTER) / 25_000) * 25_000 + HALF_RASTER


def best_slice(channels, receiver):
    """The slice for `receiver` holding the most channel worth, or None for no channels.

    Candidates are the slices with a channel at their low edge (any better slice can be slid down
    until one is), each centre then snapped between channels and nudged by 25 kHz if that still
    leaves a channel on its DC spike."""
    best, best_score = None, 0
    for c in channels:
        for nudge in (0, 25_000, -25_000):
            s = Slice(receiver, _snap(c.freq + receiver.usable // 2) + nudge)
            inside = [ch for ch in channels if s.covers(ch.freq)]
            if any(abs(ch.freq - s.center) < DC_CLEAR for ch in channels if s.lo <= ch.freq <= s.hi):
                continue
            score = sum(ch.worth for ch in inside)
            if score > best_score:
                s.channels, best, best_score = inside, s, score
    return best


def make_plan(channels, receivers, scanner=None):
    """Give each receiver in `receivers` the slice that adds most; the rest of `channels` to scan.

    `scanner` is a receiver kept out of `receivers` to hop through what is left (one dongle can
    instead be given both jobs only in turn, so with a single receiver the choice is parked or
    scanning, made by the caller)."""
    left = sorted(channels, key=lambda c: c.freq)
    slices = []
    for r in receivers:
        s = best_slice(left, r)
        if s is None:
            break
        slices.append(s)
        taken = {c.freq for c in s.channels}
        left = [c for c in left if c.freq not in taken]
    scan = sorted(left, key=lambda c: (-c.worth, c.freq))
    return Plan(slices, scan, scanner)


def describe(plan):
    """The plan in lines of text, for the command line."""
    out = []
    for s in plan.slices:
        r = s.receiver
        out.append(f"{r.kind} #{r.index}: {s.lo / 1e6:.3f}-{s.hi / 1e6:.3f} MHz, centre {s.center / 1e6:.4f}, "
                   f"{len(s.channels)} channels heard at once")
        out += [f"    {c.mhz}  {c.name}" for c in s.channels]
    if plan.scan:
        who = f"{plan.scanner.kind} #{plan.scanner.index}" if plan.scanner else "nobody (no receiver left to scan)"
        out.append(f"Scanned by {who}: {len(plan.scan)} channels")
        out += [f"    {c.mhz}  {c.name}" for c in plan.scan]
    return "\n".join(out)
