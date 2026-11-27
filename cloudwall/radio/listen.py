"""RTLSDR-Airband's UDP audio into transmissions.

One socket a channel, all watched by one thread; each packet goes to the segmenter, and each call
it finishes to `on_call`. This is the piece a Place will one day run as a thread of its own; for
now the command line runs it to save calls to a folder.
"""
import selectors
import socket
import time

from .segment import Segmenter, decode


def listen(ports, on_call, stop, segmenter=None, host="127.0.0.1", clock=time.time):
    """Hear every port in `ports` ({port: channel}) until the event `stop` is set.

    `on_call(transmission)` is called on this thread for each finished call, its `channel` the
    value `ports` gives for the port it came in on."""
    seg = segmenter or Segmenter()
    sel = selectors.DefaultSelector()
    socks = []
    try:
        for port, channel in ports.items():
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.bind((host, port))
            s.setblocking(False)
            sel.register(s, selectors.EVENT_READ, channel)
            socks.append(s)
        while not stop.is_set():
            calls = []
            for key, _ in sel.select(timeout=0.2):
                while True:
                    try:
                        payload = key.fileobj.recv(65536)
                    except BlockingIOError:
                        break
                    calls += seg.feed(key.data, clock(), decode(payload))
            calls += seg.flush(clock())
            for tx in calls:
                on_call(tx)
        for tx in seg.flush(float("inf")):
            on_call(tx)
    finally:
        sel.close()
        for s in socks:
            s.close()
