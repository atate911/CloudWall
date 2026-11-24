"""CloudWall on the internet behind Caddy, set up in one go: `cloudwall --public <name>`.

Caddy serves the name over HTTPS (its certificate fetched and renewed by itself) and hands every
request to CloudWall on this machine. A password asked by Caddy (basic_auth) is a login prompt
on every screen, and a car's browser that starts afresh each time asks it every time; CloudWall's
private link (access.py) does the same job from inside the address, so a bookmark opens it with
nothing typed. So the site's block in the Caddyfile is left as it was except for basic_auth,
which is commented out (with a note saying why, so it reads back), and a block is added for the
name when there is none.

The Caddyfile is read line by line, as far as this needs: a site block is a line at the top level
naming its addresses, then `{`, up to the `}` that closes it; a file with a single site may leave
the braces out. Braces in placeholders ({host}, {$ENV}) open and close on the same line, so
counting braces line by line keeps the depth.
"""
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .access import as_root

CADDYFILE = Path(os.environ.get("CLOUDWALL_CADDYFILE") or "/etc/caddy/Caddyfile")    # where Caddy's packages put it
AUTH = ("basic_auth", "basicauth")              # the directive's name, and its name before Caddy 2.8
NOTE = "# Taken out by cloudwall --public: CloudWall's private link keeps it private, with nothing to type."
LOCAL = re.compile(r"^(https?://)?(localhost|127\.0\.0\.1|\[::1\])?(:\d+)?$")     # ":5050" is this machine too


def code(line):
    """The line without its comment: `#` starts one at the start of a word, outside quotes."""
    quoted, prev = False, " "
    for i, c in enumerate(line):
        if c == '"' and prev != "\\":
            quoted = not quoted
        elif c == "#" and not quoted and prev in " \t":
            return line[:i]
        prev = c
    return line


def depth_change(line):
    c = code(line)
    return c.count("{") - c.count("}")


def addresses(line):
    """The names a site block's first line is for, bare: no scheme, port or path, lower case."""
    names = []
    for a in re.split(r"[\s,]+", code(line).replace("{", " ").strip()):
        a = re.sub(r"^[a-z]+://", "", a.lower()).split("/")[0]
        names.append(re.sub(r":\d*$", "", a))
    return [n for n in names if n]


def find_site(lines, name):
    """(first, last) line of the site block for `name`, or None: last is its closing brace's line,
    or the file's last line for a single site written without braces."""
    depth = 0
    for i, line in enumerate(lines):
        c = code(line).strip()
        if depth == 0 and c and not c.startswith(("{", "(", "}")) and name in addresses(line):
            if not c.endswith("{"):
                return i, len(lines) - 1
            d = 0
            for j in range(i, len(lines)):
                d += depth_change(lines[j])
                if d <= 0:
                    return i, j
            return i, len(lines) - 1
        depth += depth_change(line)
    return None


@dataclass
class Plan:
    text: str                         # the Caddyfile as it will be
    changed: bool                     # whether that's any different
    added: bool = False               # a block written for the name, there being none
    removed: int = 0                  # basic_auth directives commented out
    upstreams: list = field(default_factory=list)    # where the block sends requests

    @property
    def local(self):
        """Caddy hands CloudWall its requests on this machine, so CloudWall need listen nowhere else."""
        return bool(self.upstreams) and all(LOCAL.match(u) for u in self.upstreams)


def plan(text, name, port):
    """What the Caddyfile `text` becomes with `name` served by CloudWall (on `port` of this
    machine) and nothing asked for by Caddy itself. A ValueError when the block for the name
    sends its requests somewhere other than CloudWall: that is for a person to sort out."""
    lines = text.splitlines()
    site = find_site(lines, name)
    if site is None:
        block = f"{name} {{\n\treverse_proxy 127.0.0.1:{port}\n}}\n"
        new = text.rstrip("\n") + ("\n\n" if text.strip() else "") + block
        return Plan(new, True, added=True, upstreams=[f"127.0.0.1:{port}"])
    first, last = site
    out, removed, upstreams, i = lines[:first + 1], 0, [], first + 1
    while i <= last:
        line = lines[i]
        words = code(line).split()
        if words and words[0] in AUTH:
            indent = line[:len(line) - len(line.lstrip())]
            out.append(indent + NOTE)
            d, j = 0, i
            while True:                                     # the directive, and its block of users if it has one
                out.append(indent + "# " + lines[j].strip())
                d += depth_change(lines[j])
                if d <= 0 or j >= last:
                    break
                j += 1
            removed += 1
            i = j + 1
            continue
        if words and words[0] in ("reverse_proxy", "to"):              # `to` names them inside reverse_proxy { }
            args = [w for w in words[1:] if w != "{"]
            upstreams += [w for w in args if not w.startswith(("/", "@", "*"))]
        out.append(line)
        i += 1
    out += lines[last + 1:]
    if not any(re.search(rf":{port}$", u) for u in upstreams):
        sent = ", ".join(upstreams) or "nowhere (it has no reverse_proxy)"
        raise ValueError(f"Caddy's block for {name} sends its requests to {sent}, not to CloudWall on port {port}. "
                         f"Give it the line  reverse_proxy 127.0.0.1:{port}  and run this again.")
    new = "\n".join(out) + ("\n" if text.endswith("\n") else "")
    return Plan(new, removed > 0, removed=removed, upstreams=upstreams)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kw)


def install(path, text, runner=run):
    """Put `text` in place as the Caddyfile at `path` and have Caddy take it up, as root. It is
    checked by Caddy first (`caddy validate`, next to the file, so its imports resolve the same) and
    the file is left as it was if Caddy won't have it; the one before is kept beside it. Returns
    where that copy is."""
    path = Path(path)
    trial, keep = path.with_name(path.name + ".cloudwall-new"), path.with_name(path.name + ".before-cloudwall")
    if (runner(as_root(["test", "-e", str(keep)])).returncode == 0):
        keep = path.with_name(f"{path.name}.before-cloudwall-{time.strftime('%Y%m%d-%H%M%S')}")
    steps = [(["tee", str(trial)], text),
             (["caddy", "validate", "--config", str(trial), "--adapter", "caddyfile"], None)]
    for cmd, given in steps:
        r = runner(as_root(cmd), input=given)
        if r.returncode:
            runner(as_root(["rm", "-f", str(trial)]))
            why = (r.stderr or r.stdout or "").strip().splitlines()[-6:]
            raise RuntimeError(f"Caddy wouldn't take the new Caddyfile ({' '.join(cmd[:2])}), so it is left as it was:\n  "
                               + "\n  ".join(why))
    for cmd in (["cp", "-p", str(path), str(keep)], ["cp", str(trial), str(path)], ["rm", "-f", str(trial)]):
        r = runner(as_root(cmd))
        if r.returncode:
            raise RuntimeError(f"couldn't {' '.join(cmd)}: {(r.stderr or '').strip()}")
    if runner(["systemctl", "is-active", "--quiet", "caddy"]).returncode == 0:
        r = runner(as_root(["systemctl", "reload", "caddy"]))
    else:
        r = runner(as_root(["caddy", "reload", "--config", str(path), "--adapter", "caddyfile"]))
    if r.returncode:
        raise RuntimeError(f"the Caddyfile is in place (the one before is {keep}), but Caddy didn't reload: "
                           f"{(r.stderr or r.stdout or '').strip()[-400:]}")
    return keep


def fetch(url, timeout=10):
    """(status, headers, body) of a GET, whatever the status; raises OSError when nothing answers."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cloudwall-setup"}), timeout=timeout) as r:
            return r.status, r.headers, r.read(4096)
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(4096)


def check(name, key, fetch=fetch, tries=10, wait=2):
    """Whether the link works from the internet as a car would open it, as (ok, what to say)."""
    page, bare = f"https://{name}/k/{key}/api/state", f"https://{name}/"
    problem = ""
    for attempt in range(tries):
        if attempt:
            time.sleep(wait)
        try:
            status, headers, body = fetch(bare)
            if status == 401 and "basic" in (headers.get("WWW-Authenticate") or "").lower():
                problem = (f"Caddy still asks for its own password at {bare}: it comes from somewhere this "
                           f"didn't change (an import or a snippet in the Caddyfile). Take basic_auth out there.")
                continue
            status, headers, body = fetch(page)
            if status == 200 and b"aircraft" in body:
                return True, f"Checked: {bare} answers with CloudWall, and only with its key."
            problem = f"{page} answered {status}, not CloudWall's data."
        except OSError as e:
            problem = (f"{bare} couldn't be reached from here ({getattr(e, 'reason', e)}). Check that {name}'s "
                       f"DNS points at this server and that ports 80 and 443 are open in its firewall.")
    return False, problem
