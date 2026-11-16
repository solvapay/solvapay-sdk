"""What the Python parity servers share: settings from ../.env, and the tool."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

AGENT_ESTIMATE = ("0.01", "USD")
"""What an agent's call to get_quote may cost."""
AGENT_COST = ("0.005", "USD")
"""What it is charged."""


def required(name: str) -> str:
    """A setting from ../.env; a missing one stops the server."""
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set. See examples/mcp-parity/README.md.")
    return value


def quote(symbol: str, server: str = "python") -> dict[str, object]:
    """A made-up price from the symbol, the same in every language."""
    upper = symbol.upper()
    return {
        "symbol": upper,
        "price": 100 + sum(ord(c) for c in upper) % 900,
        "currency": "USD",
        "server": server,
    }
