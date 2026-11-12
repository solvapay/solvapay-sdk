"""Copies the SolvaPay MCP App widget into the Python package.

Builds packages/mcp-app-bundle (one self-contained mcp-app.html, from
@solvapay/react's MCP views) and writes it to src/solvapay/mcp/mcp-app.html,
which the wheel ships and create_solvapay_mcp_server serves as its UI resource.

Run from python/ after `pnpm install` at the repo root:
    uv run python scripts/sync_widget.py
Add --check to fail instead of writing when the committed copy is stale (CI).
Add --no-build to use packages/mcp-app-bundle/dist as it is.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT.parent / "packages" / "mcp-app-bundle"
BUILT = BUNDLE / "dist" / "mcp-app.html"
OUT = ROOT / "src" / "solvapay" / "mcp" / "mcp-app.html"


def build() -> None:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise SystemExit("pnpm is not on PATH: the widget is built with the repo's Node toolchain")
    subprocess.run([pnpm, "--filter", "@solvapay/mcp-app-bundle", "build"], check=True)


def main() -> None:
    check = "--check" in sys.argv
    if "--no-build" not in sys.argv:
        build()
    if not BUILT.is_file():
        raise SystemExit(f"{BUILT} does not exist: build packages/mcp-app-bundle first")
    html = BUILT.read_bytes()
    if check:
        if not OUT.is_file() or OUT.read_bytes() != html:
            raise SystemExit(
                f"{OUT.relative_to(ROOT)} is out of date with packages/mcp-app-bundle. "
                "Run: uv run python scripts/sync_widget.py"
            )
        print("The widget is up to date")
        return
    OUT.write_bytes(html)
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
