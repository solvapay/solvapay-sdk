"""Pins the conformance cases this package passes.

``conformance/cases.lock`` fingerprints every case; only the TypeScript
runner's ``record`` writes it. ``python/conformance.lock`` is the copy this
package has adopted: the runner runs the cases whose fingerprint matches it and
lists newer or changed ones as not yet adopted.

Run from python/ once every case passes, to adopt the current cases:
    uv run python scripts/pin_conformance.py
Add --check to fail instead when the pin is behind (the publish workflow does:
a release must pass every case of the commit it is built from).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT.parent / "conformance" / "cases.lock"
PIN = ROOT / "conformance.lock"


def main() -> None:
    if not LOCK.is_file():
        raise SystemExit(f"{LOCK} does not exist: run the TypeScript runner's record")
    lock = LOCK.read_bytes()
    if "--check" in sys.argv:
        if not PIN.is_file() or PIN.read_bytes() != lock:
            raise SystemExit(
                "python/conformance.lock is behind conformance/cases.lock: newer cases are not "
                "adopted. Make them pass, then run: uv run python scripts/pin_conformance.py"
            )
        print("The pin matches conformance/cases.lock")
        return
    PIN.write_bytes(lock)
    print(f"Pinned {PIN.relative_to(ROOT)} to conformance/cases.lock")


if __name__ == "__main__":
    main()
