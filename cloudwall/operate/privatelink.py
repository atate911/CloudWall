"""`cloudwall --private-link [new|show|off|url]`: makes a key, writes it into the config file,
restarts the service and prints the links. What the key does to requests is serve/access.py's.
"""
import os
import socket
import subprocess

from ..core import config, keys

def write_key(path, key):
    """Set (or, with key "", clear) `[server] key` in the config file at `path`."""
    config.write_setting(path, "server", "key", key)


def lan_address():
    """This machine's home-network address (nothing is sent: a UDP socket only picks its route),
    or its name when it has none."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostname()


def links(key, host, port):
    """The addresses to open, as [(what, address)]."""
    here = lan_address() if host in ("0.0.0.0", "::", "") else host
    k = f"/k/{key}" if key else ""
    return [("On the home network (a PC, a phone)", f"http://{here}:{port}{k}/"),
            ("The wall panel", f"http://{here}:{port}{k}/kiosk"),
            ("From outside the house", f"https://<your address>{k}/  (through your tunnel or reverse proxy)")]


def restart_service():
    """True when restarted, False when it isn't a service (or this user isn't root), None when
    systemd isn't there to ask."""
    quiet = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    try:
        if not os.path.exists("/etc/systemd/system/cloudwall.service") or os.geteuid() != 0:
            return False
        return subprocess.run(["systemctl", "restart", "cloudwall"], timeout=30, **quiet).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


def private_link(path, what):
    """what: "", new, show, off, or url (prints only the panel's local address; deploy/kiosk.sh asks for it)."""
    try:
        cfg = config.load(path)
    except ValueError as e:
        raise SystemExit(f"cloudwall: {config.find(path)}: {e}")
    key, port, host = cfg["server"]["key"], cfg["server"]["port"], cfg["server"]["host"]
    if what == "url":
        print(f"http://localhost:{port}" + (f"/k/{key}" if key else ""))
        return
    file = config.find(path)
    if what in ("new", "off") or (what == "" and not key):
        if file is None:                         # start one from the example
            file, _ = config.init(path)
        key = keys.new_key() if what != "off" else ""
        try:
            write_key(file, key)
        except (OSError, ValueError) as e:
            raise SystemExit(f"cloudwall: {e}")
        print(f"{'Private link made' if key else 'Private link taken away'}: [server] key in {file} "
              f"{'set to ' + key if key else 'cleared'}.")
        restarted = restart_service()
        print("CloudWall's service restarted, so it takes effect now." if restarted
              else "Restart CloudWall (sudo systemctl restart cloudwall) for it to take effect." if restarted is False
              else "Restart CloudWall for it to take effect.")
        if key and what == "new":
            print("Any link made before stops working: open the new one on each screen.")
    if not key:
        print("\nCloudWall is open to whoever can reach it, as on a home network:")
    else:
        print(f"\nCloudWall answers only under /k/{key}/. Open these once on each screen and keep them as a\n"
              "bookmark or favourite (the key works typed with or without its hyphens):")
    for label, url in links(key, host, port):
        if key or not label.startswith("From outside"):
            print(f"  {label + ':':<38} {url}")
    if key:
        print("\nThe wall panel started by deploy/kiosk.sh finds the key by itself.")
