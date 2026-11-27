"""Setting up the private link from the command line: `cloudwall --private-link [new|show|off|url]`
makes a key (keys.py), writes it into the config file, restarts the service and prints the links.
What the key does to requests is access.py's.
"""
import os
import re
import socket
import subprocess
import tomllib
from pathlib import Path

from . import config, keys

KEY_LINE = re.compile(r"^\s*key\s*=")
SECTION = re.compile(r"^\s*\[")


def write_key(path, key):
    """Set (or, with key "", clear) `[server] key` in the config file at `path`, leaving every other
    line as it was: the key's line replaced where there is one, added under [server] where there
    isn't, and a [server] section added where there's none. The file must still read as TOML after,
    or it is left as it was."""
    path = Path(path)
    text = path.read_text() if path.exists() else ""
    lines = text.splitlines()
    line = f'key = "{key}"'
    head = next((i for i, l in enumerate(lines) if re.match(r"^\s*\[server\]\s*(#.*)?$", l)), None)
    if head is None:
        lines += ([""] if lines and lines[-1].strip() else []) + ["[server]", line]
    else:
        end = next((i for i in range(head + 1, len(lines)) if SECTION.match(lines[i])), len(lines))
        at = next((i for i in range(head + 1, end) if KEY_LINE.match(lines[i])), None)
        if at is not None:
            lines[at] = line
        else:
            # after the section's last setting, ahead of the comments and blank lines before the next one
            last = max((i for i in range(head, end) if lines[i].strip() and not lines[i].lstrip().startswith("#")), default=head)
            lines.insert(last + 1, line)
    new = "\n".join(lines) + "\n"
    try:
        got = tomllib.loads(new).get("server", {}).get("key")
    except tomllib.TOMLDecodeError as e:
        raise ValueError(f"{path} would no longer read as TOML: {e}") from None
    if got != key:
        raise ValueError(f"{path}: couldn't set [server] key (it reads {got!r})")
    path.parent.mkdir(parents=True, exist_ok=True)
    # written whole and then put in place, so a crash halfway never leaves half a config; and not
    # readable by other users, since the file now holds a key (its group keeps what it had)
    mode = (path.stat().st_mode & 0o770) if path.exists() else 0o600
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as f:
        f.write(new)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def lan_address():
    """This machine's address on the home network, for the links it prints: the one it would send
    from (nothing is sent: a UDP socket only picks its route), or its name when it has none."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostname()


def links(key, host, port):
    """The addresses to open, as [(what, address)], for a server listening on host:port."""
    here = lan_address() if host in ("0.0.0.0", "::", "") else host
    k = f"/k/{key}" if key else ""
    return [("On the home network (a PC, a phone)", f"http://{here}:{port}{k}/"),
            ("The wall panel", f"http://{here}:{port}{k}/kiosk"),
            ("From outside the house", f"https://<your address>{k}/  (through your tunnel or reverse proxy)")]


def restart_service():
    """Restart CloudWall's systemd user service (`make service`) if it is running, so a new key
    takes effect. True when restarted, False when it isn't running as one, or None when systemd
    isn't there to ask."""
    try:
        quiet = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if subprocess.run(["systemctl", "--user", "is-active", "--quiet", "cloudwall"], timeout=10, **quiet).returncode != 0:
            return False
        return subprocess.run(["systemctl", "--user", "restart", "cloudwall"], timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


def private_link(path, what):
    """`cloudwall --private-link [new|show|off|url]`: the private link set up, shown or taken away,
    without editing the config file by hand. `url` prints only the wall panel's own address on this
    machine (deploy/kiosk.sh asks for it)."""
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
        if file is None:                         # no config file yet: start one from the example
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
              else "Restart CloudWall (make restart, or stop and start it) for it to take effect." if restarted is False
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
