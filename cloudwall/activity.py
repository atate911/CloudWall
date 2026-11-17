"""Is anyone looking? CloudWall only spends API requests while a screen is open."""
import threading
import time


class Activity:
    def __init__(self, idle_after=90):
        self.idle_after = idle_after
        self.last = 0.0                   # no screen has asked yet: start idle
        self._wake = threading.Event()

    def touch(self):
        """A screen asked for data. Wakes the poller at once if it was idle."""
        was_idle = self.idle()
        self.last = time.time()
        if was_idle:
            self._wake.set()

    def idle(self):
        return time.time() - self.last > self.idle_after

    def sleep(self, seconds):
        """Wait up to `seconds`, returning early if a screen appears after a quiet spell."""
        self._wake.wait(seconds)
        self._wake.clear()
