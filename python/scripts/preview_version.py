"""Prints the version of a dev preview: the next release, as a PEP 440 dev build.

The next release is python/package.json's version bumped by the largest pending
changeset that names @solvapay/python, the same bump `changeset version` will
make. With none pending it is the next patch, so a preview made after a release
still sorts after it. A preview of 0.1.0 is 0.1.0.dev<build>, which sorts before
0.1.0 and after every earlier release, and `pip install solvapay` without
`--pre` never picks it.

Run from python/:
    uv run python scripts/preview_version.py <build number>
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_SOURCE = ROOT / "package.json"
CHANGESETS = ROOT.parent / ".changeset"
PACKAGE = "@solvapay/python"
BUMPS = ("patch", "minor", "major")
RELEASE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
ENTRY = re.compile(r"""^\s*['"]?([^'":]+)['"]?\s*:\s*(patch|minor|major)\s*$""")


def pending_bump() -> str | None:
    """The largest bump a pending changeset gives @solvapay/python, if any."""
    largest: str | None = None
    for path in sorted(CHANGESETS.glob("*.md")):
        if path.name == "README.md":
            continue
        parts = path.read_text().split("---")
        if len(parts) < 3:
            raise SystemExit(f"{path}: no changeset frontmatter")
        for line in parts[1].splitlines():
            match = ENTRY.match(line)
            if match and match.group(1) == PACKAGE:
                bump = match.group(2)
                if largest is None or BUMPS.index(bump) > BUMPS.index(largest):
                    largest = bump
    return largest


def next_release(current: str, bump: str) -> str:
    match = RELEASE.match(current)
    if not match:
        raise SystemExit(f"python/package.json version {current!r} is not MAJOR.MINOR.PATCH")
    major, minor, patch = (int(part) for part in match.groups())
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        raise SystemExit("usage: preview_version.py <build number>")
    current = json.loads(VERSION_SOURCE.read_text())["version"]
    print(f"{next_release(current, pending_bump() or 'patch')}.dev{sys.argv[1]}")


if __name__ == "__main__":
    main()
