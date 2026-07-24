"""ISO-8601 fixture clock parsing (host-side; mirrors fixture-runner)."""

from __future__ import annotations

from datetime import datetime, timezone


def parse_iso8601_utc_to_unix_secs(clock: str) -> int:
    """Parse `YYYY-MM-DDTHH:MM:SSZ` to unix seconds."""
    if len(clock) != 20 or not clock.endswith("Z"):
        raise ValueError(f"input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock!r}")
    dt = datetime.strptime(clock, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def parse_iso8601_utc_to_unix_ms(clock: str) -> int:
    return parse_iso8601_utc_to_unix_secs(clock) * 1000
