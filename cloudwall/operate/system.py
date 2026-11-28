"""The machine, as the installer sees it: each change made only when it isn't so already, and said.

A System works on the real machine (root "/") or on a folder standing in for one, where users,
ownership and services are only recorded. With dry_run nothing is changed and every change is still said.
"""
import grp
import hashlib
import os
import pwd
import shutil
import subprocess
from pathlib import Path


class System:
    def __init__(self, root="/", dry_run=False, say=print, runner=subprocess.run):
        self.root = Path(root)
        self.real = self.root == Path("/")
        self.dry_run = dry_run
        self.say = say
        self.runner = runner
        self.done = []              # what was changed (or would be), in words
        self.users = set()          # users made away from the real machine

    def path(self, p):
        """Where an absolute path of the machine is under this root."""
        return self.root / str(p).lstrip("/")

    def exists(self, p):
        return self.path(p).exists() or self.path(p).is_symlink()

    def read(self, p):
        try:
            return self.path(p).read_text()
        except OSError:
            return None

    def _did(self, what):
        self.done.append(what)
        self.say(("would " if self.dry_run else "") + what)

    # -- changes --
    def mkdir(self, p, mode=0o755, owner=None, group=None):
        target = self.path(p)
        if not target.is_dir():
            self._did(f"make {p}")
            if not self.dry_run:
                target.mkdir(parents=True, exist_ok=True)
        self._mode(p, mode)
        self.chown(p, owner, group)

    def write(self, p, content, mode=0o644, owner=None, group=None):
        """Write a file atomically, only if it differs. True if it changed."""
        target = self.path(p)
        data = content.encode() if isinstance(content, str) else content
        same = target.exists() and target.read_bytes() == data
        if not same:
            self._did(f"write {p}")
            if not self.dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(target.name + ".cloudwall-tmp")
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                os.chmod(tmp, mode)
                os.replace(tmp, target)
        self._mode(p, mode)
        self.chown(p, owner, group)
        return not same

    def _mode(self, p, mode):
        target = self.path(p)
        if mode is not None and target.exists() and (target.stat().st_mode & 0o7777) != mode:
            self._did(f"set {p} to mode {mode:o}")
            if not self.dry_run:
                os.chmod(target, mode)

    def copy_tree(self, source, p, ignore=("__pycache__", "*.pyc")):
        self._did(f"copy {source} to {p}")
        if not self.dry_run:
            shutil.copytree(source, self.path(p), ignore=shutil.ignore_patterns(*ignore), dirs_exist_ok=True)

    def rename(self, p, to):
        self._did(f"rename {p} to {to}")
        if not self.dry_run:
            self.path(p).rename(self.path(to))

    def symlink(self, target, p):
        """Point the link at p to target, atomically. True if it changed."""
        link = self.path(p)
        if link.is_symlink() and os.readlink(link) == str(target):
            return False
        self._did(f"point {p} at {target}")
        if not self.dry_run:
            tmp = link.with_name(link.name + ".cloudwall-tmp")
            if tmp.is_symlink() or tmp.exists():
                tmp.unlink()
            os.symlink(target, tmp)
            os.replace(tmp, link)
        return True

    def remove(self, p):
        target = self.path(p)
        if target.is_symlink() or target.is_file():
            self._did(f"remove {p}")
            if not self.dry_run:
                target.unlink()
        elif target.is_dir():
            self._did(f"remove {p} and everything in it")
            if not self.dry_run:
                shutil.rmtree(target)

    def chown(self, p, owner=None, group=None):
        if not (owner or group) or not self.real:
            return
        target = self.path(p)
        if not target.exists():
            return
        st = target.stat()
        uid = pwd.getpwnam(owner).pw_uid if owner else -1
        gid = grp.getgrnam(group).gr_gid if group else -1
        if (uid != -1 and st.st_uid != uid) or (gid != -1 and st.st_gid != gid):
            self._did(f"give {p} to {owner or ''}{':' + group if group else ''}")
            if not self.dry_run:
                os.chown(target, uid, gid)

    # -- users and services --
    def user_exists(self, name):
        if not self.real:              # a stand-in folder keeps its users in its own etc/passwd
            passwd = self.read("/etc/passwd") or ""
            return name in self.users or any(l.split(":")[0] == name for l in passwd.splitlines())
        try:
            pwd.getpwnam(name)
            return True
        except KeyError:
            return False

    def add_system_user(self, name, home):
        if self.user_exists(name):
            return
        self.users.add(name)
        if not self.real and not self.dry_run:
            passwd = self.path("/etc/passwd")
            passwd.parent.mkdir(parents=True, exist_ok=True)
            with open(passwd, "a") as f:
                f.write(f"{name}:x:999:999:CloudWall:{home}:/usr/sbin/nologin\n")
        self.run(["useradd", "--system", "--user-group", "--home-dir", home, "--no-create-home",
                  "--shell", "/usr/sbin/nologin", "--comment", "CloudWall", name])

    def run(self, cmd, check=True, quiet=False):
        """Run a command on the real machine; elsewhere, or in a dry run, only say it."""
        if not quiet:
            self._did("run " + " ".join(cmd))
        if self.dry_run or not self.real:
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return self.runner(cmd, check=check, capture_output=True, text=True)

    def ask(self, cmd):
        """A read-only command's result, never said. None where there is no machine to ask."""
        if not self.real:
            return None
        try:
            return self.runner(cmd, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return None


def tree_hash(folder, ignore=("__pycache__",)):
    """A fingerprint of a folder's files (names and contents)."""
    h = hashlib.sha256()
    folder = Path(folder)
    for f in sorted(folder.rglob("*")):
        if f.is_file() and not any(part in ignore for part in f.parts) and f.suffix != ".pyc":
            h.update(str(f.relative_to(folder)).encode() + b"\0" + f.read_bytes())
    return h.hexdigest()
