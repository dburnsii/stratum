"""Check what git would publish for private things. Run before every push:

    python3 tools/check_private.py

Fails (exit 1) when a file git would publish (tracked or not ignored, apps
included, submodules too) contains:
- any value from .env or app-secrets.env (tokens, secrets, allowlisted
  usernames), ignoring short or generic ones (ports, default URLs)
- any line of .private-patterns (gitignored; one regex per line, e.g. your
  username, email, LAN IPs, hostnames)
Also warns when the commit email git would use isn't a no-reply address.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_KEYS = {"TZ", "COMPOSE_FILE", "STRATUM_PORT", "STRATUM_UID", "STRATUM_GID"}   # settings, not secrets (a time zone name is in many lists)
GENERIC = re.compile(r"^(\d+|true|false|\*|https?://(host\.docker\.internal|localhost|127\.0\.0\.1)(:\d+)?/?|docker-compose\.yml:compose\.apps\.yml)$", re.I)


def env_values(path):
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
            if not m or m[1] in PUBLIC_KEYS:
                continue
            for v in [m[2].strip().strip("'\""), *m[2].split(",")]:
                v = v.strip().strip("'\"")
                if len(v) >= 4 and not GENERIC.match(v):
                    out[v] = m[1]
    return out


def published_files():
    git = ["git", "-C", str(ROOT)]
    files = subprocess.run([*git, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--recurse-submodules"],
                           capture_output=True, text=True)
    if files.returncode:   # --recurse-submodules can't combine with --others on old gits
        files = subprocess.run([*git, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], capture_output=True, text=True, check=True)
    return [ROOT / f for f in files.stdout.split("\0") if f]


def main():
    needles = {re.escape(v): f".env {k}" for path in (ROOT / ".env", ROOT / "app-secrets.env") for v, k in env_values(path).items()}
    pats = ROOT / ".private-patterns"
    if pats.exists():
        for line in pats.read_text().splitlines():
            if line.strip() and not line.startswith("#"):
                needles[line.strip()] = ".private-patterns"
    if not needles:
        print("Nothing to look for: no .env values and no .private-patterns.")
    rx = re.compile("|".join(f"(?P<n{i}>{p})" for i, p in enumerate(needles)), re.I) if needles else None
    why = list(needles.values())
    hits = 0
    files = published_files()
    for f in files:
        if not f.is_file():
            continue
        rel = f.relative_to(ROOT)
        try:
            text = f.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            text = f.read_bytes().decode("latin-1")   # binaries: still look for the strings
        for n, line in enumerate([str(rel), *text.splitlines()]):
            m = rx and rx.search(line)
            if m:
                hits += 1
                i = int(m.lastgroup[1:])
                print(f"{rel}:{n if n else 'name'}: matches {why[i]}")
    email = subprocess.run(["git", "-C", str(ROOT), "config", "user.email"], capture_output=True, text=True).stdout.strip()
    if email and "noreply" not in email:
        print(f"warning: commits would carry your email ({email}). For a no-reply one:\n"
              f"  git config user.email <id>+<user>@users.noreply.github.com   (GitHub → Settings → Emails)")
    print(f"{len(files)} files checked, {hits} private matches.")
    sys.exit(1 if hits else 0)


if __name__ == "__main__":
    main()
