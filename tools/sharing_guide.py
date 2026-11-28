#!/usr/bin/env python3
"""sharing_guide.py: a page on the receiver Pi that sets up data sharing with you, step by step.

Run it ON THE PI (an adsb.im receiver), as root:

    sudo python3 sharing_guide.py               # then open http://<the pi>:8765/ from home
    sudo python3 sharing_guide.py --port 8800   # another port
    sudo python3 sharing_guide.py --read-only   # look, but never change anything

It walks through everything sharing needs, shows each step's state live, and does what it can for
you with a button: choose every community aggregator, turn on FlightAware and have it request a
feeder ID, sign up to Flightradar24 with your email, have RadarBox make a key, enter the keys from
the sites that need an account, set the antenna's height, restart the receiver's autogain, and
restart CloudWall's feed tunnel. It knows the rest of this receiver's setup: the location and
height MLAT needs, the clock, what the receiver hears, and CloudWall's link to it.

How it changes things: exactly as adsb.im's own pages do. It fetches adsb.im's form, changes only
what you asked for, and submits the whole form back (every other setting as it was), so adsb.im's
own code saves the settings and restarts the feeders. Nothing is written to adsb.im's files.

Keys are never shown, only whether one is set. "Copy summary for Claude" gives a short, masked
status to paste into a conversation. Stop it with Ctrl-C. Standard library only.
"""
import argparse
import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ADSBIM = "http://127.0.0.1"
DATA = ["/run/adsb-feeder-ultrafeeder/readsb", "/run/readsb", "http://127.0.0.1:8080/data"]
READ_ONLY = False

# What to tell about the sites that need an account, by adsb.im's name for them. "auto" is what
# adsb.im can do itself when its button is pressed: request an ID or key, or sign up by email.
SITES = {
    "flightaware": {"name": "FlightAware", "order": 1, "signup": "https://flightaware.com/account/join/", "auto": "id",
        "claim": "https://flightaware.com/adsb/piaware/claim", "stats": "https://flightaware.com/adsb/stats/user/",
        "reward": "A free FlightAware Enterprise account, and FlightAware's own MLAT.",
        "how": "Turn it on and this receiver is given a feeder ID. Then, logged in to your FlightAware account in a browser "
               "here at home, open Claim this receiver. Moving a site from an older PiAware instead? Enter that one's "
               "feeder ID, and switch the old device off so two don't feed under one ID."},
    "flightradar": {"name": "Flightradar24", "order": 2, "signup": "https://www.flightradar24.com/share-your-data", "auto": "email",
        "reward": "A free Flightradar24 Business subscription (their website and app; not their separate API).",
        "how": "Enter your email address and adsb.im signs this receiver up and fills in the sharing key; the account "
               "details come by email. Already have a sharing key? Enter that instead."},
    "radarbox": {"name": "RadarBox (AirNav Radar)", "order": 3, "signup": "https://www.radarbox.com/sharing-data", "auto": "key",
        "reward": "A free RadarBox Business plan.",
        "how": "Turn it on and adsb.im makes a sharing key. Then claim the receiver to your RadarBox account on their "
               "sharing page, with the key from adsb.im's data sharing page."},
    "opensky": {"name": "OpenSky", "order": 4, "signup": "https://opensky-network.org/", "auto": "user",
        "reward": "Feeds the research network; your receiver's statistics on your OpenSky account.",
        "how": "Make an OpenSky account, enter its username, and adsb.im requests the serial number."},
    "planefinder": {"name": "Plane Finder", "order": 5, "signup": "https://planefinder.net/sharing", "auto": "",
        "reward": "A free Plane Finder premium account.",
        "how": "Make a share code on Plane Finder's sharing page (it asks for your email and this receiver's "
               "location), then enter it."},
    "adsbhub": {"name": "ADSBHub", "order": 6, "signup": "https://www.adsbhub.org/", "auto": "",
        "reward": "Access to ADSBHub's combined feed.", "how": "Make an account, add a station, and enter its station key."},
    "planewatch": {"name": "Plane.watch", "order": 7, "signup": "https://plane.watch/", "auto": "",
        "reward": "Feeds a community tracker based in Australia.", "how": "Sign up and enter the API key."},
    "radarvirtuel": {"name": "RadarVirtuel", "order": 8, "signup": "https://www.radarvirtuel.com/", "auto": "",
        "reward": "Feeds a community tracker based in France.", "how": "Ask RadarVirtuel for a feeder key and enter it."},
    "1090uk": {"name": "1090MHz UK", "order": 9, "signup": "https://1090mhz.uk/", "auto": "",
        "reward": "Feeds a community tracker based in the UK.", "how": "Sign up and enter the API key."},
    "sdrmap": {"name": "sdrmap", "order": 10, "signup": "https://sdrmap.org/", "auto": "",
        "reward": "Feeds a community map based in Germany.", "how": "Sign up and enter your username and password."},
}
NOT_SITES = re.compile(r"^(mlat_|feed_acars|ais_|uat978|use_gpsd|docker_|sdrplay|telegraf)")


def run(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout or "") + (r.stderr or ""), r.returncode
    except Exception as e:
        return str(e), 1


def mask(text):
    """Nothing secret in what the page shows or the summary gives."""
    text = re.sub(r"-----BEGIN[^-]*-----.*?(-----END[^-]*-----|$)", "[key]", text, flags=re.S)
    text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[email]", text)
    text = re.sub(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "[id]", text)
    text = re.sub(r"\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{12,}\b", "[masked]", text)
    text = re.sub(r"\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b", "[masked]", text)
    return re.sub(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
                  lambda m: m.group(0) if re.match(r"^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)", m.group(0)) else "[ip]", text)


# ------------------------------------------------------------------------------------------ adsb.im's forms
class Form(HTMLParser):
    """A page's forms as a browser sees them: each one's fields in order, its buttons, and the labels
    that name the fields; and the messages adsb.im shows at the top of the page."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms, self.cur, self.labels, self.alerts = [], None, {}, []
        self._label, self._label_a, self._label_text, self._in_a = None, None, "", False
        self._select, self._textarea, self._alert, self._alert_text = None, None, 0, ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.cur = {"method": (a.get("method") or "get").lower(), "action": a.get("action") or "", "fields": []}
            self.forms.append(self.cur)
        elif tag == "div" and "alert" in (a.get("class") or "").split() and "alert-info" not in (a.get("class") or ""):
            self._alert, self._alert_text = 1, ""
        elif tag == "div" and self._alert:
            self._alert += 1
        if tag == "label" and a.get("for"):
            self._label, self._label_a, self._label_text = a["for"], None, ""
        if tag == "a" and self._label is not None and self._label_a is None:
            self._in_a, self._label_a = True, ""
        if self.cur is None:
            return
        f = self.cur["fields"]
        if tag == "input" and a.get("name"):
            t = (a.get("type") or "text").lower()
            if t in ("submit", "button", "image", "reset", "file"):
                if t == "submit":
                    f.append({"kind": "button", "name": a["name"], "value": a.get("value", "")})
                return
            f.append({"kind": t, "name": a["name"], "value": a.get("value", ""), "checked": "checked" in a,
                      "id": a.get("id", ""), "classes": (a.get("class") or "").split()})
        elif tag == "button" and a.get("name") and (a.get("type") or "submit").lower() == "submit":
            f.append({"kind": "button", "name": a["name"], "value": a.get("value", "")})
        elif tag == "select" and a.get("name"):
            self._select = {"kind": "select", "name": a["name"], "value": None}
            f.append(self._select)
        elif tag == "option" and self._select is not None:
            if self._select["value"] is None or "selected" in a:
                self._select["value"] = a.get("value", "")
        elif tag == "textarea" and a.get("name"):
            self._textarea = {"kind": "textarea", "name": a["name"], "value": ""}
            f.append(self._textarea)

    def handle_endtag(self, tag):
        if tag == "form":
            self.cur = None
        elif tag == "select":
            self._select = None
        elif tag == "textarea":
            self._textarea = None
        elif tag == "a" and self._in_a:
            self._in_a = False
        elif tag == "label" and self._label is not None:
            name = (self._label_a or "").strip() or re.split(r"\s{2,}|\n", self._label_text.strip())[0]
            self.labels.setdefault(self._label, name.strip())
            self._label = None
        elif tag == "div" and self._alert:
            self._alert -= 1
            if not self._alert:
                t = " ".join(self._alert_text.split())
                if t:
                    self.alerts.append(t)

    def handle_data(self, data):
        if self._textarea is not None:
            self._textarea["value"] += data
        if self._label is not None:
            self._label_text += data
            if self._in_a:
                self._label_a += data
        if self._alert:
            self._alert_text += data

    def form_with(self, button):
        return next((f for f in self.forms if any(x["kind"] == "button" and x["name"] == button for x in f["fields"])), None)


class Busy(Exception):
    pass


def fetch(path, data=None, timeout=20):
    req = urllib.request.Request(ADSBIM + path, data=data, headers={"User-Agent": "sharing_guide"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def page(path, button):
    """adsb.im's page at path, parsed, with the form that has the given button."""
    try:
        url, html = fetch(path)
    except urllib.error.URLError as e:
        raise Busy(f"adsb.im's web page isn't answering ({e.reason})")
    if "/login" in urllib.parse.urlparse(url).path:
        raise Busy("adsb.im asks for its password: use its own pages (or turn its login off) for this")
    p = Form()
    p.feed(html)
    form = p.form_with(button)
    if form is None:
        raise Busy("adsb.im is busy (restarting its feeders after a change?): try again in a minute")
    return p, form


def submit(path, button, changes, button_value=None):
    """Submit adsb.im's form at path as its page would: every field as it is, checkboxes as 1 or 0
    (adsb.im's page does that with a script, so unticked boxes reach it too), changed only where
    `changes` says, and the given button pressed."""
    if READ_ONLY:
        raise Busy("this guide was started with --read-only")
    p, form = page(path, button)
    pairs, pressed, radios = [], False, set()
    for f in form["fields"]:
        n = f["name"]
        if f["kind"] == "button":
            if n == button and not pressed:
                pairs.append((n, button_value if button_value is not None else f["value"]))
                pressed = True
            continue
        if f["kind"] == "checkbox":
            on = changes[n] if n in changes else f["checked"]
            pairs.append((n, "1" if on else "0"))
        elif f["kind"] == "radio":
            want = changes.get(n)
            if n not in radios and ((want is None and f["checked"]) or (want is not None and f["value"] == want)):
                pairs.append((n, f["value"]))
                radios.add(n)                    # one value per group (adsb.im's None and Individual share one)
        else:
            pairs.append((n, str(changes[n]) if n in changes else (f.get("value") or "")))
    for n, v in changes.items():                 # a field the page doesn't show (adsb.im still takes it)
        if not any(x["name"] == n for x in form["fields"]):
            pairs.append((n, "1" if v is True else "0" if v is False else str(v)))
    body = urllib.parse.urlencode(pairs).encode()
    try:
        fetch(path, data=body, timeout=240)      # a key request can take a while
    except urllib.error.HTTPError as e:
        raise Busy(f"adsb.im didn't take it: HTTP {e.code}")
    except (urllib.error.URLError, TimeoutError, socket.timeout):
        pass                                     # it restarts its feeders; the next check shows how it went


def aggregator_page():
    p, form = page("/aggregators", "aggregators")
    fields = {f["name"]: f for f in form["fields"]}
    community, sites = [], []
    for f in form["fields"]:
        n = f["name"]
        m = re.match(r"^(.+)--ultrafeeder--is_enabled$", n)
        if m and f["kind"] == "checkbox":
            community.append({"id": m.group(1), "name": p.labels.get(n) or m.group(1), "on": f["checked"],
                              "privacy": "privacy" in f["classes"]})
            continue
        m = re.match(r"^([^-]+(?:-[^-]+)*)--is_enabled$", n)
        if m and f["kind"] == "checkbox" and not NOT_SITES.match(m.group(1)):
            sid = m.group(1)
            key, user = fields.get(f"{sid}--key"), fields.get(f"{sid}--user")
            sites.append({"id": sid, "name": SITES.get(sid, {}).get("name") or p.labels.get(n) or sid, "on": f["checked"],
                          "key": bool(key and (key.get("value") or "").strip()), "has_key": bool(key),
                          "user": bool(user and (user.get("value") or "").strip()), "has_user": bool(user),
                          "button": f"{sid}--submit" in fields})
    sites.sort(key=lambda s: SITES.get(s["id"], {}).get("order", 99))
    choice = next((f["value"] for f in form["fields"] if f["name"] == "aggregator_choice" and f["checked"]), "")
    mlat = fields.get("mlat_enable--is_enabled", {}).get("checked")
    privacy = fields.get("mlat_privacy--is_enabled", {}).get("checked")
    return {"community": community, "sites": sites, "choice": choice, "mlat": mlat, "privacy": privacy,
            "alerts": [mask(a) for a in p.alerts][-4:]}


def agg_status(ids):
    """adsb.im's own verdict on each feed it runs: data and MLAT, good / warning / disconnected / ..."""
    out = {}
    for i in ids:
        try:
            _, body = fetch(f"/api/status/{urllib.parse.quote(i)}", timeout=10)
            d = json.loads(body).get("0") or {}
            out[i] = {"beast": d.get("beast", ""), "mlat": d.get("mlat", "")}
        except Exception:
            out[i] = {"beast": "", "mlat": ""}
    return out


# ------------------------------------------------------------------------------------------ the rest of the Pi
def get_json(base, name):
    try:
        if base.startswith("http"):
            with urllib.request.urlopen(f"{base}/{name}", timeout=3) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        with open(f"{base}/{name}") as f:
            return json.load(f)
    except Exception:
        return None


def reception():
    base = next((b for b in DATA if get_json(b, "aircraft.json")), None)
    rec = {"found": bool(base)}
    if not base:
        return rec
    ac = (get_json(base, "aircraft.json") or {}).get("aircraft") or []
    seen = [a for a in ac if (a.get("seen") or 0) <= 60]
    rec.update(aircraft=len(seen), with_pos=sum(1 for a in seen if "lat" in a),
               mlat=sum(1 for a in seen if "lat" in (a.get("mlat") or [])), tisb=sum(1 for a in seen if "lat" in (a.get("tisb") or [])),
               qnh=sum(1 for a in seen if "nav_qnh" in a), wind=sum(1 for a in seen if "ws" in a))
    stats = get_json(base, "stats.json") or {}
    p = stats.get("last15min") or {}
    loc = p.get("local") or {}
    acc = loc.get("accepted")
    accepted = sum(acc) if isinstance(acc, list) else acc if isinstance(acc, (int, float)) else None
    msgs = p.get("messages")
    rec.update(gain=stats.get("gain_db"), noise=loc.get("noise"), signal=loc.get("signal"),
               rate=round(msgs / 900, 1) if isinstance(msgs, (int, float)) else None,
               strong_pct=round(100 * loc["strong_signals"] / accepted, 1) if accepted and isinstance(loc.get("strong_signals"), (int, float)) else None,
               range_nm=round(p["max_distance"] / 1852) if isinstance(p.get("max_distance"), (int, float)) else None,
               range_total_nm=round(((stats.get("total") or {}).get("max_distance") or 0) / 1852) or None)
    return rec


def location():
    try:
        p, form = page("/setup", "submit")
    except Busy:
        return {"set": False, "unknown": True}
    v = {f["name"]: f.get("value", "") for f in form["fields"] if f["kind"] not in ("button", "checkbox", "radio")}
    lat, lon, alt = v.get("lat", ""), v.get("lon", ""), v.get("alt", "")
    dec = lambda s: len(s.split(".")[1]) if "." in s else 0
    try:
        return {"set": bool(lat and lon), "lat": round(float(lat), 3), "lon": round(float(lon), 3),
                "decimals": min(dec(lat), dec(lon)), "alt_m": float(alt) if str(alt).strip() else None}
    except ValueError:
        return {"set": False}


def clock():
    out, _ = run(["timedatectl", "show", "-p", "NTPSynchronized"])
    ch, _ = run(["chronyc", "tracking"])
    off = re.search(r"System time\s*:\s*([\d.]+) seconds", ch)
    return {"synced": "NTPSynchronized=yes" in out, "offset_ms": round(float(off.group(1)) * 1000, 2) if off else None}


def tunnel():
    st, _ = run(["systemctl", "is-active", "adsb-tunnel"])
    st = st.strip()
    if st not in ("active", "inactive", "failed", "activating", "deactivating"):
        return {"state": "none"}
    log, _ = run(["journalctl", "-u", "adsb-tunnel", "-n", "4", "--no-pager", "-o", "cat"])
    return {"state": st, "log": [mask(l)[:200] for l in log.strip().splitlines()[-3:]]}


def collect():
    st = {"time": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "host": socket.gethostname(), "read_only": READ_ONLY,
          "root": os.geteuid() == 0}
    try:
        st["sharing"] = aggregator_page()
        ids = [c["id"] for c in st["sharing"]["community"] if c["on"]] + [s["id"] for s in st["sharing"]["sites"] if s["on"]]
        st["status"] = agg_status(ids)
    except Busy as e:
        st["busy"] = str(e)
    st["location"] = location()
    st["clock"] = clock()
    st["reception"] = reception()
    st["tunnel"] = tunnel()
    return st


_cache = {"at": 0, "data": None}
_lock = threading.Lock()
_action = {"running": None, "result": None}


def status(fresh=False):
    with _lock:
        if fresh or time.time() - _cache["at"] > 8 or _cache["data"] is None:
            try:
                _cache["data"] = collect()
            except Exception as e:
                _cache["data"] = {"error": f"{type(e).__name__}: {e}"}
            _cache["at"] = time.time()
        d = dict(_cache["data"])
        d["action"] = dict(_action)
        return d


# ------------------------------------------------------------------------------------------ doing things
def do(action, a):
    """One change, as adsb.im's own pages would make it. Returns what to tell the person."""
    if action == "community_all":
        sh = aggregator_page()
        changes = {f"{c['id']}--ultrafeeder--is_enabled": True for c in sh["community"]}
        changes.update({"aggregator_choice": "all", "mlat_enable--is_enabled": True})
        submit("/aggregators", "aggregators", changes)
        return f"Asked adsb.im to feed all {len(sh['community'])} community aggregators, with MLAT. It restarts the feeders: give it a minute or two."
    if action == "community_one":
        cid, on = str(a.get("id", "")), bool(a.get("on"))
        if not re.fullmatch(r"[\w.-]+", cid):
            raise Busy("no such aggregator")
        name = next((c["name"] for c in aggregator_page()["community"] if c["id"] == cid), cid)
        submit("/aggregators", "aggregators", {f"{cid}--ultrafeeder--is_enabled": on, "aggregator_choice": "individual"})
        return f"{'Turned on' if on else 'Turned off'} {name}. adsb.im restarts the feeders: a minute or two."
    if action == "mlat_privacy":
        submit("/aggregators", "aggregators", {"mlat_privacy--is_enabled": bool(a.get("on"))})
        return "MLAT privacy " + ("on: your site is hidden from the public MLAT maps." if a.get("on") else "off: your site shows at an approximate spot on the public MLAT maps.")
    if action == "site":
        sid = str(a.get("id", ""))
        sh = aggregator_page()
        site = next((s for s in sh["sites"] if s["id"] == sid), None)
        if site is None:
            raise Busy("adsb.im doesn't offer that site")
        if not a.get("on", True):
            submit("/aggregators", "aggregators", {f"{sid}--is_enabled": False})
            return f"Turned off {SITES.get(sid, {}).get('name') or site['name']}."
        key, user = str(a.get("key") or "").strip(), str(a.get("user") or "").strip()
        changes = {f"{sid}--is_enabled": True}
        if site["has_key"] and (key or not site["key"]):
            changes[f"{sid}--key"] = key
        if site["has_user"] and user:
            changes[f"{sid}--user"] = user
        auto = SITES.get(sid, {}).get("auto", "")
        if not key and not site["key"] and site["has_key"] and not (site["button"] and auto in ("id", "key", "user")):
            raise Busy(f"{SITES.get(sid, {}).get('name') or site['name']} needs its key from their site first: sign up there, then enter it")
        if site["button"]:
            # its own button: adsb.im activates it (and requests an ID or key, or signs up, where it can)
            submit("/aggregators", f"{sid}--submit", changes)
        else:
            submit("/aggregators", "aggregators", changes)
        what = {"id": "and asked for a feeder ID", "key": "and asked for a sharing key", "user": "and asked for a serial number",
                "email": "and signed up with your email" if "@" in key else ""}.get(auto, "")
        return f"Turned on {SITES.get(sid, {}).get('name') or site['name']} {what}".strip() + ". adsb.im restarts the feeders: give it a minute or two, then check here."
    if action == "altitude":
        alt = int(round(float(a.get("alt_m"))))
        if not -500 < alt < 9000:
            raise Busy("that height doesn't look right")
        submit("/setup", "submit", {"alt": alt})
        return f"Antenna height set to {alt} m above sea level."
    if action == "reset_autogain":
        # adsb.im's own reset: it tells the decoder to start its autogain afresh, without restarting anything
        if READ_ONLY:
            raise Busy("this guide was started with --read-only")
        page("/aggregators", "aggregators")      # adsb.im is up and not busy
        try:
            fetch("/aggregators", data=urllib.parse.urlencode([("resetgain", "1")]).encode(), timeout=30)
        except urllib.error.HTTPError as e:
            raise Busy(f"adsb.im didn't take it: HTTP {e.code}")
        return "Asked the receiver to start its automatic gain afresh. Give it a few hours to settle, then compare the numbers here."
    if action == "restart_tunnel":
        if READ_ONLY:
            raise Busy("this guide was started with --read-only")
        out, rc = run(["systemctl", "restart", "adsb-tunnel"], timeout=40)
        if rc:
            raise Busy("couldn't restart it: " + mask(out.strip())[:200])
        return "Restarted CloudWall's feed tunnel."
    raise Busy("unknown action")


def act(action, a):
    with _lock:
        if _action["running"]:
            return {"ok": False, "message": "Still working on the last change: one at a time."}
        _action["running"] = action
    try:
        msg = do(action, a)
        res = {"ok": True, "message": msg}
    except Busy as e:
        res = {"ok": False, "message": str(e)}
    except Exception as e:
        res = {"ok": False, "message": f"{type(e).__name__}: {e}"}
    _action.update(running=None, result=res)
    status(fresh=True)
    return res


def summary(st):
    """A short, masked status to paste into a conversation."""
    L, C, R, T = st.get("location") or {}, st.get("clock") or {}, st.get("reception") or {}, st.get("tunnel") or {}
    sh, S = st.get("sharing") or {}, st.get("status") or {}
    out = [f"sharing_guide summary {st.get('time')}"]
    if st.get("busy"):
        out.append(f"adsb.im: {st['busy']}")
    out.append(f"location: {'set' if L.get('set') else 'NOT SET'}, {L.get('decimals')} decimals, antenna {L.get('alt_m')} m ASL")
    out.append(f"clock: {'synced' if C.get('synced') else 'NOT synced'}, offset {C.get('offset_ms')} ms")
    out.append(f"aggregator choice: {sh.get('choice') or '(none)'}; MLAT {'on' if sh.get('mlat') else 'off'}; privacy {'on' if sh.get('privacy') else 'off'}")
    for c in sh.get("community", []):
        if c["on"]:
            s = S.get(c["id"], {})
            out.append(f"  community {c['name']}: data {s.get('beast') or '?'}, mlat {s.get('mlat') or '?'}")
    out.append(f"  community off: {', '.join(c['name'] for c in sh.get('community', []) if not c['on']) or 'none'}")
    for s in sh.get("sites", []):
        st_ = S.get(s["id"], {})
        out.append(f"  site {s['name']}: {'on' if s['on'] else 'off'}, key {'set' if s['key'] else 'empty'}"
                   + (f", data {st_.get('beast') or '?'}, mlat {st_.get('mlat') or '?'}" if s["on"] else ""))
    for a in sh.get("alerts", []):
        out.append(f"adsb.im says: {a[:160]}")
    out.append(f"reception: {R.get('rate')} msg/s, range {R.get('range_nm')} nm (max {R.get('range_total_nm')}), strong {R.get('strong_pct')}%, "
               f"gain {R.get('gain')} dB, noise {R.get('noise')} dBFS; aircraft {R.get('aircraft')} ({R.get('with_pos')} placed, {R.get('mlat')} by MLAT, "
               f"{R.get('tisb')} by TIS-B); carrying altimeter setting {R.get('qnh')}, wind {R.get('wind')}")
    out.append(f"CloudWall tunnel: {T.get('state')}")
    res = (st.get("action") or {}).get("result")
    if res:
        out.append(f"last change: {'ok' if res.get('ok') else 'FAILED'}: {res.get('message')}")
    return mask("\n".join(out))


# ------------------------------------------------------------------------------------------ the page
PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data sharing setup</title>
<style>
:root { --bg:#eef1ec; --card:#fafaf6; --ink:#17273a; --ink2:#41505f; --dim:#5f6d7b; --rule:#d5dbd2; --accent:#2b5c9c; --accentink:#fff;
  --ok:#1f7a4d; --okbg:#e1f1e7; --todo:#9a5b00; --todobg:#fbecd2; --bad:#b0302e; --badbg:#f8dcdb; --wait:#4a5a6a; --waitbg:#e4e8ec; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1520; --card:#131e2d; --ink:#dce3ea; --ink2:#b4c0cc; --dim:#8696a6; --rule:#26384c;
  --accent:#84a9da; --accentink:#0d1520; --ok:#6fd19c; --okbg:#143326; --todo:#f0b45a; --todobg:#3a2a10; --bad:#f08a86; --badbg:#3a1818; --wait:#a9b6c3; --waitbg:#1f2c3b; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:880px; margin:0 auto; padding:24px 16px 72px; }
h1 { font-size:1.7rem; margin:0 0 4px; letter-spacing:-.01em; }
.sub { color:var(--dim); margin:0 0 16px; font-size:.9rem; }
.top { display:flex; align-items:center; gap:12px; margin:0 0 18px; flex-wrap:wrap; }
.bar { flex:1; min-width:140px; height:8px; border-radius:99px; background:var(--rule); overflow:hidden; }
.bar i { display:block; height:100%; background:var(--ok); transition:width .4s; }
.step { background:var(--card); border:1px solid var(--rule); border-radius:10px; margin:0 0 12px; overflow:hidden; }
.step > header { display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; }
.num { flex:none; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:.9rem; background:var(--waitbg); color:var(--wait); }
.step.done .num { background:var(--okbg); color:var(--ok); } .step.todo .num { background:var(--todobg); color:var(--todo); } .step.bad .num { background:var(--badbg); color:var(--bad); }
.step h2 { font-size:1.05rem; margin:0; flex:1; }
.pill { font-size:.74rem; font-weight:700; padding:3px 9px; border-radius:99px; white-space:nowrap; background:var(--waitbg); color:var(--wait); }
.pill.done { background:var(--okbg); color:var(--ok); } .pill.todo { background:var(--todobg); color:var(--todo); } .pill.bad { background:var(--badbg); color:var(--bad); }
.body { padding:0 16px 16px 56px; display:none; }
.step.open .body { display:block; }
.body p { margin:.4em 0 .7em; color:var(--ink2); }
.now { font-size:.9rem; background:var(--bg); border-radius:8px; padding:10px 12px; margin:10px 0; }
a { color:var(--accent); }
button, .btn { font:inherit; font-size:.88rem; display:inline-block; margin:4px 8px 4px 0; padding:7px 13px; border-radius:8px; cursor:pointer;
  border:1px solid var(--rule); background:var(--card); color:var(--ink); text-decoration:none; }
button.go { background:var(--accent); color:var(--accentink); border-color:var(--accent); font-weight:600; }
button:disabled { opacity:.5; cursor:default; }
.btn:hover, button:hover:not(:disabled) { border-color:var(--accent); }
input[type=text], input[type=email], input[type=number], select { font:inherit; font-size:.9rem; padding:6px 9px; border:1px solid var(--rule); border-radius:7px; background:var(--card); color:var(--ink); }
table { width:100%; border-collapse:collapse; font-size:.9rem; margin:8px 0; }
td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--rule); vertical-align:middle; }
th { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); font-weight:600; }
.y { color:var(--ok); font-weight:700; } .n { color:var(--dim); } .w { color:var(--todo); font-weight:700; } .x { color:var(--bad); font-weight:700; }
.log { display:block; font:.78rem ui-monospace, Menlo, monospace; color:var(--dim); word-break:break-all; margin-top:3px; }
.site { border-top:1px solid var(--rule); padding:14px 0 10px; }
.site:first-child { border-top:0; padding-top:4px; }
.site h3 { margin:0 0 4px; font-size:1rem; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0; }
.calc { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin:8px 0; }
.calc label { font-size:.78rem; color:var(--dim); display:flex; flex-direction:column; gap:2px; }
.calc input, .calc select { width:8.5em; }
.toast { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); max-width:min(92vw, 640px); padding:12px 16px; border-radius:10px;
  background:var(--ink); color:var(--bg); font-size:.92rem; box-shadow:0 6px 24px rgba(0,0,0,.25); display:none; z-index:5; }
.toast.bad { background:var(--bad); color:#fff; }
.banner { padding:12px 14px; border-radius:8px; margin:0 0 14px; background:var(--todobg); color:var(--todo); font-size:.92rem; }
footer { color:var(--dim); font-size:.8rem; margin-top:24px; }
@media (max-width:560px) { .body { padding-left:16px; } h1 { font-size:1.4rem; } }
</style></head>
<body><main>
<h1>Data sharing setup</h1>
<p class="sub" id="sub">Reading this receiver...</p>
<div class="top"><div class="bar"><i id="bar" style="width:0"></i></div><span id="count"></span>
  <button id="copy" title="A short status with nothing secret in it, to paste into a conversation with Claude">Copy summary for Claude</button></div>
<div id="banner"></div>
<div id="steps"></div>
<footer>Changes go through adsb.im's own pages, exactly as if you had made them there: it saves them and restarts the feeders. Keys are never shown here.
  The page checks the receiver again every 20 seconds.</footer>
</main>
<div class="toast" id="toast"></div>
<script>
const META = __SITES__;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const adsbim = (p) => `${location.protocol}//${location.hostname}${p}`;
let open = new Set(); try { open = new Set(JSON.parse(localStorage.getItem("open") || "[]")); } catch (e) {}
let data = null, first = !open.size, busy = false;

const good = (v) => v === "good";
const verdict = (v) => !v || v === "." ? '<span class="n">checking</span>' : v === "good" ? '<span class="y">good</span>'
  : ["warning", "starting", "unknown"].includes(v) ? `<span class="w">${esc(v)}</span>` : v === "disabled" ? '<span class="n">off</span>' : `<span class="x">${esc(v.replace("_", " "))}</span>`;
const link = (p, t) => `<a class="btn" href="${adsbim(p)}" target="_blank" rel="noopener">${esc(t)}</a>`;
const ext = (u, t) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`;
const can = () => !data.read_only && !data.busy && !busy;

function steps() {
  const L = data.location || {}, C = data.clock || {}, R = data.reception || {}, T = data.tunnel || {};
  const SH = data.sharing || { community: [], sites: [] }, ST = data.status || {};
  const out = [];
  // location and antenna height
  const decOk = L.set && L.decimals >= 4;
  out.push({ id: "loc", title: "Location and antenna height", state: L.unknown ? "wait" : !L.set ? "bad" : !decOk ? "todo" : "done",
    pill: L.unknown ? "adsb.im busy" : !L.set ? "Not set" : !decOk ? "Too rough" : "Set",
    body: `<p>MLAT works out positions from tiny differences in when receivers hear the same signal, so each receiver's spot must be exact: latitude and
      longitude to 5 decimal places (about 1 m), and the <b>antenna's</b> height above sea level: the ground's elevation plus how high the antenna is mounted.</p>
      <div class="now">Now: ${L.set ? `${L.lat}, ${L.lon} (rounded here; ${L.decimals} decimals entered ${decOk ? '<span class="y">good</span>' : '<span class="w">enter 5</span>'}),
        antenna <b>${L.alt_m ?? "?"} m</b> above sea level` : L.unknown ? "adsb.im is busy: checking again shortly" : '<span class="x">no location</span>'}</div>
      <p>Is the height the antenna's, not just the ground's? Find your ground elevation (Google Earth shows it at the bottom of the screen, or the USGS
      <a href="https://apps.nationalmap.gov/viewer/" target="_blank" rel="noopener">National Map</a>), add the antenna's height above the ground, and set it here.</p>
      <div class="calc"><label>Ground elevation<input id="g" type="number" step="0.1" inputmode="decimal"></label>
        <label>Antenna above ground<input id="h" type="number" step="0.1" inputmode="decimal"></label>
        <label>Units<select id="u"><option value="m">metres</option><option value="ft">feet</option></select></label>
        <label>Antenna above sea level<b id="res" style="padding:6px 0">-</b></label>
        <button class="go" id="setalt" disabled>Set it in adsb.im</button></div>
      ${link("/setup", "adsb.im: basic setup")}` });
  // clock
  out.push({ id: "clock", title: "Clock", state: C.synced ? "done" : "bad", pill: C.synced ? "Synchronised" : "Not synchronised",
    body: `<p>MLAT also needs the clock right. The Pi sets it from the internet; nothing to do unless this is red.</p>
      <div class="now">${C.synced ? '<span class="y">Synchronised</span>' : '<span class="x">Not synchronised</span>'}${C.offset_ms != null ? `, ${C.offset_ms} ms from internet time` : ""}</div>` });
  // community aggregators
  const com = SH.community || [], on = com.filter((c) => c.on), allOn = com.length && on.length === com.length;
  const comGood = on.filter((c) => ST[c.id] && good(ST[c.id].beast)).length;
  out.push({ id: "community", title: "Community aggregators (free, with MLAT)", state: !on.length ? "todo" : comGood ? "done" : "wait",
    pill: !on.length ? "None yet" : `${on.length} on, ${comGood} feeding`,
    body: `<p>Free sites run by enthusiasts: no account or key, and each runs its own MLAT network. adsb.fi and adsb.lol are the ones CloudWall reads,
      so feeding them improves CloudWall's picture around your house too. Their MLAT results come back into this receiver, and so into CloudWall.</p>
      <div class="row"><button class="go" data-do="community_all" ${allOn || !can() ? "disabled" : ""}>${allOn ? "All are on" : `Feed all ${com.length}, with MLAT`}</button>
        <label><input type="checkbox" id="priv" ${SH.privacy ? "checked" : ""} ${can() ? "" : "disabled"}> Hide my site from the public MLAT maps</label></div>
      <table><tr><th>Aggregator</th><th>On</th><th>Data</th><th>MLAT</th><th></th></tr>
      ${com.map((c) => { const s = ST[c.id] || {}; return `<tr><td>${esc(c.name)}</td><td>${c.on ? '<span class="y">yes</span>' : '<span class="n">no</span>'}</td>
        <td>${c.on ? verdict(s.beast) : ""}</td><td>${c.on ? verdict(s.mlat) : ""}</td>
        <td><button data-do="community_one" data-id="${esc(c.id)}" data-on="${c.on ? "" : "1"}" ${can() ? "" : "disabled"}>${c.on ? "Turn off" : "Turn on"}</button></td></tr>`; }).join("")}</table>
      ${link("/aggregators", "adsb.im: data sharing")}` });
  // the sites with accounts
  const sites = SH.sites || [];
  const siteState = (s) => { const v = ST[s.id] || {}; return !s.on ? "todo" : good(v.beast) ? "done" : ["", ".", "unknown", "starting"].includes(v.beast || "") ? "wait" : "bad"; };
  const sitePill = (s) => { const v = ST[s.id] || {}; return !s.on ? "Off" : good(v.beast) ? (good(v.mlat) ? "Feeding, MLAT good" : "Feeding") : v.beast ? v.beast.replace("_", " ") : "Starting"; };
  const siteCard = (s) => {
    const m = META[s.id] || {}, v = ST[s.id] || {}, auto = m.auto || "";
    const field = auto === "email" ? `<input type="email" id="k-${s.id}" placeholder="${s.key ? "key set (or a new email / key)" : "your email, or a sharing key"}" size="30">`
      : auto === "user" ? `<input type="text" id="u-${s.id}" placeholder="${s.user ? "username set" : "your OpenSky username"}" size="24">`
      : auto === "id" ? `<input type="text" id="k-${s.id}" placeholder="${s.key ? "feeder ID set" : "blank: request one"}" size="30">`
      : auto === "key" ? "" : `${s.has_user ? `<input type="text" id="u-${s.id}" placeholder="${s.user ? "username set" : "username"}" size="18">` : ""}
          <input type="text" id="k-${s.id}" placeholder="${s.key ? "key set (or enter a new one)" : "key from their site"}" size="28">`;
    const label = s.on ? "Update" : auto === "id" ? "Turn on and get a feeder ID" : auto === "key" ? "Turn on and make a key" : auto === "email" ? "Turn on" : "Turn on";
    return `<p>${esc(m.reward || "")}</p><p>${esc(m.how || "Sign up on their site and enter the key it gives you.")}</p>
      <div class="now">Switched on ${s.on ? '<span class="y">yes</span>' : '<span class="n">no</span>'} · key ${s.key ? '<span class="y">set</span>' : '<span class="n">not set</span>'}
        ${s.on ? ` · data ${verdict(v.beast)} · MLAT ${verdict(v.mlat)}` : ""}</div>
      <div class="row">${field}<button class="go" data-do="site" data-id="${s.id}" ${can() ? "" : "disabled"}>${label}</button>
        ${s.on ? `<button data-do="site" data-id="${s.id}" data-off="1" ${can() ? "" : "disabled"}>Turn off</button>` : ""}</div>
      <div class="row">${m.signup ? ext(m.signup, `${s.name}: sign up`) : ""}${m.claim ? ext(m.claim, "Claim this receiver") : ""}${m.stats ? ext(m.stats, "Your feeder stats") : ""}
        ${s.id === "flightaware" ? link("/fa-status/", "This receiver's PiAware page") : ""}</div>`;
  };
  for (const s of sites.filter((x) => ["flightaware", "flightradar"].includes(x.id)))
    out.push({ id: s.id, title: s.name, state: siteState(s), pill: sitePill(s), body: siteCard(s) });
  const rest = sites.filter((x) => !["flightaware", "flightradar"].includes(x.id)), restOn = rest.filter((s) => s.on);
  out.push({ id: "others", title: "Other sites (optional)", state: !restOn.length ? "wait" : restOn.every((s) => siteState(s) === "done") ? "done" : "todo",
    pill: restOn.length ? `${restOn.length} on` : "Optional",
    body: `<p>Each wants a free account and most give a premium account back. Any or none: they don't depend on each other.</p>` +
      rest.map((s) => `<div class="site"><h3>${esc(s.name)} <span class="pill ${siteState(s)}">${esc(sitePill(s))}</span></h3>${siteCard(s)}</div>`).join("") });
  // MLAT
  const mlatFeeds = [...on.map((c) => c.id), ...sites.filter((s) => s.on).map((s) => s.id)].filter((i) => ST[i] && good(ST[i].mlat)).length;
  out.push({ id: "mlat", title: "MLAT working", state: R.mlat > 0 ? "done" : mlatFeeds ? "wait" : "todo",
    pill: R.mlat > 0 ? `${R.mlat} placed by MLAT now` : mlatFeeds ? `${mlatFeeds} networks synced` : "Waiting",
    body: `<p>Once a network with MLAT is fed, it takes 15 to 30 minutes to synchronise with the receivers around you. Then aircraft without ADS-B
      (older transponders, many small planes) appear with positions worked out by MLAT, here and in CloudWall.</p>
      <div class="now">${mlatFeeds} MLAT networks report good sync · <b>${R.mlat ?? 0}</b> aircraft placed by MLAT right now,
        ${R.tisb ?? 0} by the FAA's TIS-B rebroadcast, out of ${R.with_pos ?? 0} with positions. ${!SH.mlat ? '<br><span class="w">MLAT is switched off in adsb.im: "Feed all" turns it on.</span>' : ""}</div>` });
  // reception
  const hot = R.strong_pct != null && R.strong_pct > 5;
  out.push({ id: "rx", title: "Reception", state: !R.found ? "bad" : hot ? "todo" : "done", pill: !R.found ? "No data" : hot ? "Gain too high?" : "Looks healthy",
    body: `<p>How well the antenna hears. Too much gain overloads the receiver: nearby aircraft drown out distant ones and range drops.
      About 1 to 5% of messages very loud (above -3 dBFS) is the usual aim.</p>
      <div class="now">Last 15 minutes: <b>${R.rate ?? "?"}</b> messages a second · farthest <b>${R.range_nm ?? "?"} nm</b> (best since start ${R.range_total_nm ?? "?"} nm)
        · very loud <b class="${hot ? "w" : ""}">${R.strong_pct ?? "?"}%</b> · gain ${R.gain ?? "?"} dB · noise ${R.noise ?? "?"} dBFS · ${R.aircraft ?? "?"} aircraft in the last minute</div>
      ${hot ? `<p>The receiver uses automatic gain. If this stays high, start the automatic gain afresh; if it's still high after a few hours, set a lower
        fixed gain in adsb.im's SDR settings. Moving the antenna higher and away from other electronics helps most of all.</p>` : ""}
      <div class="row"><button data-do="reset_autogain" ${can() ? "" : "disabled"}>Restart automatic gain</button>${link("/sdr_setup", "adsb.im: SDR settings")}</div>` });
  // CloudWall
  out.push({ id: "cw", title: "CloudWall's link to this receiver", state: T.state === "active" ? "done" : T.state === "none" ? "wait" : "bad",
    pill: T.state === "active" ? "Connected" : T.state === "none" ? "Not set up on this Pi" : T.state,
    body: `<p>CloudWall reads this receiver through its feed tunnel (deploy/feed-tunnel in CloudWall's repository). Sharing with the sites above doesn't
      change it; the MLAT positions the aggregators send back reach CloudWall through it too.</p>
      <div class="now">Tunnel service <code>adsb-tunnel</code>: <b>${esc(T.state)}</b>${(T.log || []).map((l) => `<span class="log">${esc(l)}</span>`).join("")}</div>
      ${T.state !== "none" ? `<button data-do="restart_tunnel" ${!data.read_only && !busy ? "" : "disabled"}>Restart the tunnel</button>` : ""}` });
  return out;
}

function render() {
  if (!data) return;
  if (data.error) { $("steps").innerHTML = `<div class="banner">Couldn't read the receiver: ${esc(data.error)}</div>`; return; }
  $("sub").textContent = `${data.host} · checked ${data.time}${data.read_only ? " · read-only" : ""}${data.root ? "" : " · not running as root: some checks may be missing"}`;
  const alerts = ((data.sharing || {}).alerts || []).map((a) => `<div class="banner">adsb.im says: ${esc(a)}</div>`).join("");
  $("banner").innerHTML = (data.busy ? `<div class="banner">${esc(data.busy)}</div>` : "") + (data.action && data.action.running ? `<div class="banner">Working on it...</div>` : "") + alerts;
  const list = steps(), done = list.filter((s) => s.state === "done").length;
  $("bar").style.width = `${(100 * done) / list.length}%`;
  $("count").textContent = `${done} of ${list.length} done`;
  if (first) { list.forEach((s) => { if (s.state !== "done") open.add(s.id); }); first = false; }
  const keep = {};
  document.querySelectorAll("#steps input[type=text], #steps input[type=email], #steps input[type=number], #steps select").forEach((e) => { keep[e.id] = e.value; });
  const focus = document.activeElement && document.activeElement.id;
  $("steps").innerHTML = list.map((s, i) => `<section class="step ${s.state}${open.has(s.id) ? " open" : ""}" data-id="${s.id}">
    <header><span class="num">${s.state === "done" ? "&#10003;" : i + 1}</span><h2>${esc(s.title)}</h2><span class="pill ${s.state}">${esc(s.pill)}</span></header>
    <div class="body">${s.body}</div></section>`).join("");
  for (const [k, v] of Object.entries(keep)) if ($(k)) $(k).value = v;
  if (focus && $(focus)) $(focus).focus();
  calc();
}
function calc() {
  if (!$("g")) return;
  const g = parseFloat($("g").value), h = parseFloat($("h").value), ft = $("u").value === "ft";
  const m = isNaN(g) || isNaN(h) ? null : Math.round((g + h) * (ft ? 0.3048 : 1));
  $("res").textContent = m == null ? "-" : `${m} m`;
  $("setalt").disabled = m == null || !can();
  $("setalt").dataset.alt = m ?? "";
}
function toast(msg, bad) {
  const t = $("toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.style.display = "block";
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, bad ? 12000 : 8000);
}
async function act(action, args, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  busy = true; render(); toast("Working on it... adsb.im may take a minute.");
  try {
    const r = await fetch("api/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Sharing-Guide": "1" }, body: JSON.stringify({ action, ...args }) });
    const res = await r.json(); toast(res.message, !res.ok);
  } catch (e) { toast("Lost touch with the guide: is it still running?", true); }
  busy = false; refresh();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-do]");
  if (b) {
    const d = b.dataset.do, id = b.dataset.id;
    if (d === "community_all") return act(d, {}, "Feed every community aggregator listed, with MLAT? adsb.im restarts its feeders to do it.");
    if (d === "community_one") return act(d, { id, on: !!b.dataset.on });
    if (d === "reset_autogain") return act(d, {}, "Start the receiver's automatic gain afresh?");
    if (d === "restart_tunnel") return act(d, {}, "Restart CloudWall's feed tunnel?");
    if (d === "site") {
      if (b.dataset.off) return act(d, { id, on: false }, "Turn this site off?");
      const k = $(`k-${id}`), u = $(`u-${id}`);
      return act(d, { id, on: true, key: k ? k.value.trim() : "", user: u ? u.value.trim() : "" });
    }
  }
  if (e.target.id === "setalt") return act("altitude", { alt_m: e.target.dataset.alt }, `Set the antenna's height to ${e.target.dataset.alt} m above sea level in adsb.im?`);
  if (e.target.id === "copy") return copySummary();
  const hd = e.target.closest(".step > header");
  if (hd) {
    const sec = hd.parentElement, id = sec.dataset.id;
    sec.classList.toggle("open");
    sec.classList.contains("open") ? open.add(id) : open.delete(id);
    try { localStorage.setItem("open", JSON.stringify([...open])); } catch (err) {}
  }
});
document.addEventListener("change", (e) => { if (e.target.id === "priv") act("mlat_privacy", { on: e.target.checked }); });
document.addEventListener("input", (e) => { if (["g", "h", "u"].includes(e.target.id)) calc(); });
async function copySummary() {
  const text = await (await fetch("api/summary", { cache: "no-store" })).text();
  try { await navigator.clipboard.writeText(text); toast("Copied: paste it into the conversation."); }
  catch (e) {   // plain http: no clipboard access; show it to copy by hand
    const w = window.open("", "_blank"); w.document.write(`<pre style="white-space:pre-wrap;font:14px monospace;padding:16px">${esc(text)}</pre>`);
  }
}
async function refresh() {
  if (busy) return;
  try { data = await (await fetch("api/status", { cache: "no-store" })).json(); render(); }
  catch (e) { $("sub").textContent = "Lost touch with the guide: is sharing_guide.py still running on the Pi?"; }
}
refresh(); setInterval(refresh, 20000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        b = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            meta = {k: {x: v[x] for x in ("signup", "auto", "claim", "stats", "reward", "how") if x in v} for k, v in SITES.items()}
            return self._send(200, PAGE.replace("__SITES__", json.dumps(meta)), "text/html; charset=utf-8")
        if path == "/api/status":
            return self._send(200, json.dumps(status()), "application/json")
        if path == "/api/summary":
            return self._send(200, summary(status()), "text/plain; charset=utf-8")
        return self._send(404, "not found", "text/plain")

    def do_POST(self):
        # only this page may make changes: a custom header can't be sent by another site's page without
        # a CORS preflight, which this server never grants
        if self.path.split("?")[0] != "/api/action" or self.headers.get("X-Sharing-Guide") != "1":
            return self._send(403, "forbidden", "text/plain")
        # (and only under an address, not a name: a page elsewhere can point a name of its own at this machine)
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        if not re.fullmatch(r"[0-9a-fA-F:.]+|localhost|[\w-]+(\.local|\.lan|\.home\.arpa)?", host):
            return self._send(403, "forbidden: open this page by the Pi's address", "text/plain")
        try:
            n = max(0, min(int(self.headers.get("Content-Length") or 0), 10000))
            a = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(a, dict):
                raise ValueError("not an object")
        except ValueError:
            return self._send(400, "bad request", "text/plain")
        return self._send(200, json.dumps(act(str(a.get("action", "")), a)), "application/json")

    def do_OPTIONS(self):
        return self._send(403, "forbidden", "text/plain")

    def log_message(self, *args):
        pass


def main():
    global READ_ONLY, ADSBIM
    ap = argparse.ArgumentParser(description="A page that sets up data sharing on an adsb.im receiver, step by step.")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="0.0.0.0", help="address to listen on (default: every network on this Pi)")
    ap.add_argument("--read-only", action="store_true", help="show everything, change nothing")
    ap.add_argument("--adsbim", default=ADSBIM, help="adsb.im's address on this Pi (default http://127.0.0.1)")
    a = ap.parse_args()
    READ_ONLY, ADSBIM = a.read_only, a.adsbim.rstrip("/")
    if os.geteuid() != 0:
        print("Note: not running as root, so restarting the tunnel won't work. Use: sudo python3 sharing_guide.py")
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        raise SystemExit(f"Couldn't listen on port {a.port}: {e}. Try another: sudo python3 sharing_guide.py --port 8800")
    ips = [x for x in run(["hostname", "-I"])[0].split() if ":" not in x]
    print("The data sharing guide is running. Open it from a phone or computer at home:")
    for u in [f"http://{socket.gethostname()}.local:{a.port}/"] + [f"http://{ip}:{a.port}/" for ip in ips]:
        print("   ", u)
    print("Leave this window open while you use it; Ctrl-C stops it." + (" (read-only)" if READ_ONLY else ""))
    threading.Thread(target=status, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
