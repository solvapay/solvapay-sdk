"""Minimal SolvaPay Python SDK example: fetch the merchant profile.

    cp .env.example .env
    python main.py
"""

from __future__ import annotations

import os
import sys

from solvapay._solvapay import SolvaPayClient

from get_merchant import run


def _load_dotenv(path: str = ".env") -> None:
    """Load KEY=VALUE lines from path into the process env (no overrides)."""
    try:
        raw = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> int:
    _load_dotenv()
    api_key = os.environ.get("SOLVAPAY_SECRET_KEY")
    if not api_key:
        print("SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env", file=sys.stderr)
        return 1
    client = SolvaPayClient(api_key, os.environ.get("SOLVAPAY_API_BASE_URL"))
    merchant = run(client)
    print(
        f"merchant displayName={merchant.get('displayName')} "
        f"defaultCurrency={merchant.get('defaultCurrency')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
