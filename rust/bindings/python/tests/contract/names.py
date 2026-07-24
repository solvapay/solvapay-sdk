"""Name helpers shared by the Python contract suite."""

from __future__ import annotations

import re

_CAMEL_BOUNDARY = re.compile(r"([a-z0-9])([A-Z])")


def camel_to_kebab(value: str) -> str:
    """Mirror TS `camelToKebab` used by the client coverage guard."""
    return _CAMEL_BOUNDARY.sub(r"\1-\2", value).lower()


def camel_to_snake(value: str) -> str:
    """Convert camelCase fixture `fn` names to Python snake_case method names."""
    if value == value.upper() and any(ch.isalpha() for ch in value):
        return value
    return _CAMEL_BOUNDARY.sub(r"\1_\2", value).lower()


def is_success_case(file_stem: str) -> bool:
    """Mirror TS `isSuccessCase` for client fixture filenames."""
    if file_stem.startswith("success") or file_stem.startswith("by-"):
        return True
    return file_stem in {
        "succeeded-recurring",
        "succeeded-one-time",
        "succeeded-bare",
        "processing",
        "timeout",
        "failed",
        "cancelled",
    }


def is_error_case(file_stem: str) -> bool:
    """Mirror TS `isErrorCase` for client fixture filenames."""
    return (
        file_stem.startswith("error")
        or file_stem == "no-match"
        or file_stem == "missing-params"
    )
