"""Fails when the Python package version differs from @solvapay/server's.

The two ship together: a spec change releases both. Run from python/:
    uv run python scripts/check_version.py          # check
    uv run python scripts/check_version.py --write  # set pyproject.toml to the server's version
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyproject.toml"
SERVER_PACKAGE = ROOT.parent / "packages" / "server" / "package.json"
VERSION_LINE = re.compile(r'^version = "([^"]+)"$', re.M)


def main() -> None:
    server = json.loads(SERVER_PACKAGE.read_text())["version"]
    text = PYPROJECT.read_text()
    match = VERSION_LINE.search(text)
    if not match:
        raise SystemExit("pyproject.toml has no version line")
    if "--write" in sys.argv:
        PYPROJECT.write_text(VERSION_LINE.sub(f'version = "{server}"', text, count=1))
        print(f"pyproject.toml version set to {server}")
        return
    if match.group(1) != server:
        raise SystemExit(
            f"python/pyproject.toml is {match.group(1)} but @solvapay/server is {server}. "
            "Run: uv run python scripts/check_version.py --write"
        )
    print(f"Python and @solvapay/server are both {server}")


if __name__ == "__main__":
    main()
