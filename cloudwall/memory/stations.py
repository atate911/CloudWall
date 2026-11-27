"""The stations joined to this wall: the machines with antennas (a Pi with the ADS-B stick, another
with the VHF ones, or one with both) that report how they are and take their settings from here.

A station joins with a code made on the control board (single use, half an hour), and is given a
key of its own; from then on it reports to the wall over HTTPS every minute (app/station.py), with
its key, and each answer carries the settings the board holds for it: its name, what each of its
USB sticks is for (ADS-B, the VHF radio, or spare), and the radio's channels. Nothing on the wall
reaches into the station: the station asks, so it works from behind a home router, and any number
of them work the same way.

Kept in stations.json beside the logbooks, readable by the service only. Keys are kept only as
their hash: the file is no use to anyone who reads it.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

CODE_S = 30 * 60            # a join code lasts half an hour
JOBS = ("adsb", "vhf", "spare")


def _hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


class Stations:
    def __init__(self, path=None, clock=time.time):
        self.path = Path(path) if path else None
        self.clock = clock
        self.lock = threading.Lock()
        self.data = {"codes": {}, "stations": {}}
        if self.path and self.path.exists():
            try:
                got = json.loads(self.path.read_text())
                if isinstance(got, dict):
                    self.data.update({k: got.get(k, {}) for k in ("codes", "stations")})
            except (OSError, ValueError):
                pass            # unreadable: start empty (stations join again); the file is kept as .bad
                try:
                    self.path.replace(self.path.with_suffix(".bad"))
                except OSError:
                    pass

    def _save(self):
        if not self.path:
            return
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
        with os.fdopen(fd, "w") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, self.path)

    # -- joining --------------------------------------------------------------------------------
    def code(self):
        """A new join code, and when it stops working."""
        with self.lock:
            now = self.clock()
            self.data["codes"] = {h: t for h, t in self.data["codes"].items() if t > now}
            words = secrets.token_hex(4)
            code = f"cw-{words[:4]}-{words[4:]}"
            self.data["codes"][_hash(code)] = now + CODE_S
            self._save()
            return code, now + CODE_S

    def join(self, code, name="", host=""):
        """A station joining with a code: (its id, its key). The code is used up."""
        with self.lock:
            now = self.clock()
            h = _hash(str(code).strip().lower())
            if self.data["codes"].get(h, 0) <= now:
                raise ValueError("that join code isn't known, or has run out: make a new one on the control board")
            del self.data["codes"][h]
            sid = "st-" + secrets.token_hex(4)
            key = secrets.token_urlsafe(32)
            clean = re.sub(r"[^\w .'-]", "", str(name or host or "Station"))[:40].strip() or "Station"
            self.data["stations"][sid] = {"name": clean, "host": str(host)[:64], "key": _hash(key), "joined": now,
                                          "seen": None, "facts": None, "applied": None,
                                          "desired": {"name": clean, "jobs": {}}}
            self._save()
            return sid, key

    def authorized(self, sid, key):
        st = self.data["stations"].get(sid)
        return bool(st and key and hmac.compare_digest(st["key"], _hash(str(key))))

    # -- reporting ------------------------------------------------------------------------------
    def report(self, sid, facts, applied=None, address=None):
        """A station's report: kept; returns the settings held here for it."""
        with self.lock:
            st = self.data["stations"][sid]
            st.update(seen=self.clock(), facts=facts if isinstance(facts, dict) else None,
                      applied=applied if isinstance(applied, dict) else None, address=address)
            # a stick seen for the first time is given a job: ADS-B, for one stick on a machine that runs an
            # ADS-B decoder; spare otherwise, until the board gives it one
            jobs = st["desired"].setdefault("jobs", {})
            f = facts or {}
            decoding = bool(f.get("decoder") or any(u in (f.get("units") or {}) for u in ("readsb", "dump1090-fa", "dump1090-mutability")))
            for s in f.get("sdr") or []:
                key = s.get("serial") or s.get("id")
                if key and key not in jobs:
                    jobs[key] = "adsb" if decoding and "adsb" not in jobs.values() else "spare"
            self._save()
            return dict(st["desired"])

    # -- the board's side -------------------------------------------------------------------------
    def update(self, sid, name=None, jobs=None):
        with self.lock:
            st = self.data["stations"].get(sid)
            if not st:
                raise ValueError("no such station")
            if name is not None:
                clean = re.sub(r"[^\w .'-]", "", str(name))[:40].strip()
                if not clean:
                    raise ValueError("a station needs a name")
                st["name"] = st["desired"]["name"] = clean
            if jobs is not None:
                if not isinstance(jobs, dict) or any(j not in JOBS for j in jobs.values()):
                    raise ValueError(f"each stick's job is one of {', '.join(JOBS)}")
                st["desired"].setdefault("jobs", {}).update({str(k)[:64]: v for k, v in jobs.items()})
            self._save()
            return self.public(sid)

    def remove(self, sid):
        with self.lock:
            if self.data["stations"].pop(sid, None) is None:
                raise ValueError("no such station")
            self._save()

    def public(self, sid):
        """A station as the board shows it: everything but its key's hash."""
        st = self.data["stations"].get(sid)
        return None if st is None else {"id": sid, **{k: v for k, v in st.items() if k != "key"}}

    def all(self):
        return [self.public(sid) for sid in sorted(self.data["stations"], key=lambda s: self.data["stations"][s]["joined"])]

    def vhf(self):
        """Every stick given to the VHF radio, on every station: [(station, serial)]."""
        return [(st, serial) for st in self.all() for serial, job in (st["desired"].get("jobs") or {}).items() if job == "vhf"]
