#!/usr/bin/env python3
"""Pre-publish wheel artifact gate.

Hard-fails when any expected abi3 platform family is missing, or when a
manylinux wheel does not carry the pinned tag from support-matrix.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
import zipfile

PANIC_PROBE_MARKER = b"SOLVAPAY_PANIC_PROBE"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_matrix() -> dict:
    path = _repo_root() / "contract" / "manifest" / "support-matrix.json"
    if not path.is_file():
        print(f"check-wheels: HARD FAIL — missing {path}", file=sys.stderr)
        raise SystemExit(1)
    return json.loads(path.read_text())


def _is_abi3(name: str) -> bool:
    return "abi3" in name and name.endswith(".whl")


def _matches(name: str, rule: dict) -> bool:
    n = name.lower()
    for part in rule.get("filenameIncludes", []):
        if part.lower() not in n:
            return False
    for part in rule.get("filenameExcludes", []):
        if part.lower() in n:
            return False
    any_of = rule.get("filenameAnyOf", [])
    if any_of and not any(part.lower() in n for part in any_of):
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path("wheels"),
        help="Directory containing built .whl files",
    )
    parser.add_argument(
        "--allow-missing",
        default="",
        help="Comma-separated wheel family ids that may be absent (local previews only)",
    )
    args = parser.parse_args()
    wheel_dir: Path = args.dir
    allow_missing = {item.strip() for item in args.allow_missing.split(",") if item.strip()}
    matrix = _load_matrix()
    python = matrix["python"]
    rules = python["wheels"]
    required_tags = [t.lower() for t in python["manylinuxWheelTags"]]

    if not wheel_dir.is_dir():
        print(f"check-wheels: HARD FAIL — directory missing: {wheel_dir}", file=sys.stderr)
        return 1

    wheels = [p.name.lower() for p in wheel_dir.rglob("*.whl")]
    present: list[str] = []
    missing: list[str] = []

    for rule in rules:
        matches = [w for w in wheels if _is_abi3(w) and _matches(w, rule)]
        if matches:
            present.append(rule["id"])
            if rule.get("manylinux") == python["manylinux"]:
                for match in matches:
                    if not any(tag in match for tag in required_tags):
                        print(
                            "check-wheels: HARD FAIL — manylinux wheel missing pinned tag "
                            f"{python['manylinux']} ({'/'.join(required_tags)}): {match}",
                            file=sys.stderr,
                        )
                        return 1
        elif rule["id"] in allow_missing:
            print(f"check-wheels: skip missing {rule['id']} (--allow-missing)")
        else:
            missing.append(rule["id"])

    probe_hits: list[str] = []
    for wheel in wheel_dir.rglob("*.whl"):
        with zipfile.ZipFile(wheel) as archive:
            for name in archive.namelist():
                if not name.endswith((".so", ".dylib", ".pyd", ".dll")):
                    continue
                if PANIC_PROBE_MARKER in archive.read(name):
                    probe_hits.append(f"{wheel.name}:{name}")
    if probe_hits:
        print("check-wheels: HARD FAIL — panic-probe marker in release artifact:", file=sys.stderr)
        for hit in probe_hits:
            print(f"  - {hit}", file=sys.stderr)
        return 1

    if missing:
        print("check-wheels: HARD FAIL — missing abi3 wheel families:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        print(f"present: {len(present)}/{len(rules)}", file=sys.stderr)
        print("found wheels:", file=sys.stderr)
        for w in sorted(wheels) or ["(none)"]:
            print(f"  - {w}", file=sys.stderr)
        return 1

    print(f"check-wheels: OK — {len(present)}/{len(rules)} abi3 wheel families present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
