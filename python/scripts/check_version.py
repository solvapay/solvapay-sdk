"""Fails when pyproject.toml's version differs from python/package.json's.

python/package.json is the version source: a changeset bumps it, and
`pnpm changeset:version` copies it here. Run from python/:
    uv run python scripts/check_version.py          # check
    uv run python scripts/check_version.py --write  # set pyproject.toml to package.json's version
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyproject.toml"
VERSION_SOURCE = ROOT / "package.json"
VERSION_LINE = re.compile(r'^version = "([^"]+)"$', re.M)


def main() -> None:
    source = json.loads(VERSION_SOURCE.read_text())["version"]
    text = PYPROJECT.read_text()
    match = VERSION_LINE.search(text)
    if not match:
        raise SystemExit("pyproject.toml has no version line")
    if "--write" in sys.argv:
        PYPROJECT.write_text(VERSION_LINE.sub(f'version = "{source}"', text, count=1))
        print(f"pyproject.toml version set to {source}")
        return
    if match.group(1) != source:
        raise SystemExit(
            f"python/pyproject.toml is {match.group(1)} but python/package.json is {source}. "
            "Run: uv run python scripts/check_version.py --write"
        )
    print(f"pyproject.toml and package.json are both {source}")


if __name__ == "__main__":
    main()
