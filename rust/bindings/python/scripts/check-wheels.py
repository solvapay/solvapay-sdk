#!/usr/bin/env python3
"""Pre-publish wheel artifact gate (Step 40 / redesign §7.7 / §10.3).

Hard-fails when any expected abi3 platform family is missing from a directory of
built wheels. Mirrors `rust/bindings/node/scripts/check-artifacts.mjs`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _is_abi3(name: str) -> bool:
    return "abi3" in name and name.endswith(".whl")


def _matchers():
    # Name → predicate over wheel filename (lowercase).
    return [
        (
            "manylinux-x86_64",
            lambda n: "manylinux" in n and "x86_64" in n and "musl" not in n,
        ),
        (
            "manylinux-aarch64",
            lambda n: "manylinux" in n and ("aarch64" in n or "arm64" in n) and "musl" not in n,
        ),
        (
            "musllinux-x86_64",
            lambda n: "musllinux" in n and "x86_64" in n,
        ),
        (
            "macos-universal2",
            lambda n: "macosx" in n and "universal2" in n,
        ),
        (
            "win_amd64",
            lambda n: "win_amd64" in n or "win32" in n,
        ),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path("wheels"),
        help="Directory containing built .whl files",
    )
    args = parser.parse_args()
    wheel_dir: Path = args.dir

    if not wheel_dir.is_dir():
        print(f"check-wheels: HARD FAIL — directory missing: {wheel_dir}", file=sys.stderr)
        return 1

    wheels = [p.name.lower() for p in wheel_dir.rglob("*.whl")]
    present: list[str] = []
    missing: list[str] = []

    for label, pred in _matchers():
        matches = [w for w in wheels if _is_abi3(w) and pred(w)]
        if matches:
            present.append(label)
        else:
            missing.append(label)

    if missing:
        print("check-wheels: HARD FAIL — missing abi3 wheel families:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        print(f"present: {len(present)}/{len(_matchers())}", file=sys.stderr)
        print("found wheels:", file=sys.stderr)
        for w in sorted(wheels) or ["(none)"]:
            print(f"  - {w}", file=sys.stderr)
        return 1

    print(f"check-wheels: OK — {len(present)}/{len(_matchers())} abi3 wheel families present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
