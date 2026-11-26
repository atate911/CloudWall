"""A channel's audio into transmissions.

RTLSDR-Airband sends a channel's audio only while its squelch is open, so a call is a run of
packets and the silence after it is a gap in their arrival. The segmenter is given the packets as
they come (channel, arrival time, samples) and gives back each call once a gap shows it is over:
when it started and ended, how loud it was, and its audio, ready to be saved as a WAV, played on a
screen or passed on to be transcribed.

The audio is mono 32-bit float at 8 kHz, RTLSDR-Airband's output for AM (to be checked against the
version installed; `rate` is a setting for that reason).
"""
import array
import io
import math
import wave
from dataclasses import dataclass, field

RATE = 8000
GAP_S = 1.0          # this long with nothing heard ends a call (a controller's pause stays inside it)
MIN_S = 0.3          # anything shorter is a squelch blip, not a call
MAX_S = 60.0         # a stuck carrier is cut into pieces this long


@dataclass
class Transmission:
    channel: object                # whatever the caller keys channels by (a Channel, a port)
    start: float                   # seconds since the epoch, when the first packet arrived
    end: float = 0.0
    samples: array.array = field(default_factory=lambda: array.array("f"))
    rate: int = RATE

    @property
    def duration(self):
        return len(self.samples) / self.rate

    @property
    def level_db(self):
        """RMS level below full scale."""
        if not self.samples:
            return -math.inf
        rms = math.sqrt(sum(x * x for x in self.samples) / len(self.samples))
        return 20 * math.log10(rms) if rms > 0 else -math.inf

    def wav(self):
        """The call as a 16-bit mono WAV file's bytes."""
        pcm = array.array("h", (int(max(-1.0, min(1.0, x)) * 32767) for x in self.samples))
        if pcm.itemsize != 2:
            raise RuntimeError("16-bit array type unavailable")
        if array.array("h", [1]).tobytes()[0] != 1:
            pcm.byteswap()                 # WAV is little-endian
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.rate)
            w.writeframes(pcm.tobytes())
        return buf.getvalue()


def decode(payload):
    """A UDP packet's bytes (little-endian float32) into samples."""
    a = array.array("f")
    a.frombytes(payload[: len(payload) // 4 * 4])
    if array.array("h", [1]).tobytes()[0] != 1:
        a.byteswap()
    return a


class Segmenter:
    def __init__(self, rate=RATE, gap_s=GAP_S, min_s=MIN_S, max_s=MAX_S):
        self.rate, self.gap_s, self.min_s, self.max_s = rate, gap_s, min_s, max_s
        self.open = {}                     # channel -> the Transmission being heard on it
        self.last = {}                     # channel -> when its last packet arrived

    def feed(self, channel, t, samples):
        """One packet; returns the calls this packet shows are over (on any channel)."""
        done = self.flush(t)
        tx = self.open.get(channel)
        if tx is None:
            tx = self.open[channel] = Transmission(channel, t, rate=self.rate)
        tx.samples.extend(samples)
        tx.end = t
        self.last[channel] = t
        if tx.duration >= self.max_s:
            done += self._close(channel)
        return done

    def flush(self, now):
        """The calls whose channel has been quiet for the gap by `now`."""
        done = []
        for ch in [ch for ch, t in self.last.items() if now - t >= self.gap_s and ch in self.open]:
            done += self._close(ch)
        return done

    def _close(self, channel):
        tx = self.open.pop(channel)
        return [tx] if tx.duration >= self.min_s else []
