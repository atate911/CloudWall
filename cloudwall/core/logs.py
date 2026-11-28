"""The last few hundred log lines, kept in memory for the control board's Log page."""
import collections
import logging
import threading

KEEP = 800


class Recent(logging.Handler):
    def __init__(self, keep=KEEP):
        super().__init__(logging.INFO)
        self.lines = collections.deque(maxlen=keep)
        self.lock_ = threading.Lock()
        self.seq = 0

    def emit(self, record):
        try:
            text = record.getMessage()
            if record.exc_info:
                text += "\n" + logging.Formatter().formatException(record.exc_info)
            with self.lock_:
                self.seq += 1
                self.lines.append({"n": self.seq, "t": record.created, "level": record.levelname.lower(),
                                   "name": record.name, "text": text})
        except Exception:
            pass

    def since(self, n=0, level=None):
        order = {"debug": 0, "info": 1, "warning": 2, "error": 3, "critical": 4}
        with self.lock_:
            return [l for l in self.lines if l["n"] > n and (not level or order.get(l["level"], 1) >= order.get(level, 1))]


RECENT = Recent()


def attach():
    root = logging.getLogger()
    if RECENT not in root.handlers:
        root.addHandler(RECENT)
    return RECENT
