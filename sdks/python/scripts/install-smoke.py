#!/usr/bin/env python3
"""Install a published wheel/sdist and execute one real call."""

from __future__ import annotations

import argparse
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index-url", required=True)
    parser.add_argument("--package", default="solvapay")
    parser.add_argument("--version", required=True)
    parser.add_argument("--extra-index-url", default="")
    args = parser.parse_args()

    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        "--index-url",
        args.index_url,
        f"{args.package}=={args.version}",
    ]
    if args.extra_index_url:
        cmd.extend(["--extra-index-url", args.extra_index_url])
    subprocess.check_call(cmd)
    if args.package == "solvapay":
        script = (
            "import solvapay\n"
            "print('install-smoke:', solvapay.version())\n"
            "print('install-smoke-build:', solvapay.native_build_info())\n"
        )
    else:
        script = (
            "import solvapay_mcp\n"
            "print('install-smoke:', getattr(solvapay_mcp, '__version__', 'ok'))\n"
        )
    subprocess.check_call([sys.executable, "-c", script])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
