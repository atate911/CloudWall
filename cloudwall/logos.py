"""Airline logos for the flight card, fetched on demand and cached on disk.

Logos are trademarks of their airlines, so none are shipped with CloudWall: each
is downloaded the first time that airline appears, by its two-letter IATA code,
and kept for a few months.
"""
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .http import UA

log = logging.getLogger("cloudwall.logos")
MAX_AGE = 90 * 86400
MISSING_AGE = 7 * 86400
CODE = re.compile(r"^[A-Z0-9]{2}$")

# ICAO airline code (the start of a callsign) -> IATA code used to fetch the logo.
# Covers what's common around PDX and major long-haul visitors; anything else uses
# the code from the route database when it has one.
ICAO_TO_IATA = {
    "ASA": "AS", "QXE": "AS", "SKW": "OO", "SWA": "WN", "DAL": "DL", "UAL": "UA", "AAL": "AA",
    "ENY": "MQ", "RPA": "YX", "ASH": "YV", "JBU": "B6", "NKS": "NK", "FFT": "F9", "HAL": "HA",
    "AAY": "G4", "SCX": "SY", "FDX": "FX", "UPS": "5X", "ABX": "GB", "ATN": "8C", "GTI": "5Y",
    "CKS": "K4", "PAC": "PO", "AMF": "", "BAW": "BA", "DLH": "LH", "ICE": "FI", "ACA": "AC",
    "JZA": "QK", "ROU": "RV", "WJA": "WS", "WEN": "WR", "VOI": "Y4", "AMX": "AM", "VIV": "VB",
    "KLM": "KL", "AFR": "AF", "ANA": "NH", "JAL": "JL", "KAL": "KE", "AAR": "OZ", "UAE": "EK",
    "QTR": "QR", "CPA": "CX", "EVA": "BR", "SIA": "SQ", "CAL": "CI", "VIR": "VS", "TAP": "TP",
    "FIN": "AY", "SAS": "SK", "CFG": "DE", "QFA": "QF", "ANZ": "NZ", "FJI": "FJ", "PAL": "PR",
    "CES": "MU", "CSN": "CZ", "CCA": "CA", "THY": "TK", "IBE": "IB", "AZA": "AZ", "SWR": "LX",
    "AUA": "OS", "EIN": "EI", "LOT": "LO", "ETH": "ET", "ETD": "EY", "GJS": "G7", "CPZ": "OH",
    "EDV": "9E", "PDT": "PT", "JIA": "OH", "SCE": "YR", "MXY": "MX", "VXP": "XP", "BRZ": "",
}
# Brands that fly under another airline's name and have no logo of their own.
SAME_AS = {"QX": "AS"}


def iata_for(callsign, route_iata=None):
    """The IATA code to show a logo for, or None."""
    m = re.match(r"^([A-Z]{3})\d", callsign or "")
    code = (ICAO_TO_IATA.get(m.group(1)) if m else None)
    if code is None:
        code = route_iata if m else None     # only trust the database for airline-style callsigns
    code = SAME_AS.get(code or "", code)
    return code if code and CODE.match(code) else None


class Logos:
    def __init__(self, cfg, cache_dir):
        c = cfg.get("logos", {})
        self.url = c.get("url") or "https://pics.avs.io/240/80/{iata}@2x.png"
        self.enabled = bool(c.get("enabled", True)) and bool(self.url)
        self.dir = Path(cache_dir)
        self.lock = threading.Lock()

    def get(self, code):
        """PNG bytes for an airline's logo, or None if there isn't one."""
        if not self.enabled or not CODE.match(code or ""):
            return None
        path, missing = self.dir / f"{code}.png", self.dir / f"{code}.missing"
        now = time.time()
        if missing.exists() and now - missing.stat().st_mtime < MISSING_AGE:
            return None
        if not (path.exists() and now - path.stat().st_mtime < MAX_AGE):
            try:
                req = urllib.request.Request(self.url.format(iata=code), headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=10) as r:
                    data = r.read()
                if not data.startswith(b"\x89PNG"):
                    raise ValueError("not a PNG")
                with self.lock:
                    self.dir.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".tmp")
                    tmp.write_bytes(data)
                    tmp.replace(path)
                    missing.unlink(missing_ok=True)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.dir.mkdir(parents=True, exist_ok=True)
                    missing.touch()
                    return None
                log.warning("logo %s unavailable: %s", code, e)
            except Exception as e:
                log.warning("logo %s unavailable: %s", code, e)
        return path.read_bytes() if path.exists() else None
