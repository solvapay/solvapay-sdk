"""Panic-probe FFI containment — language-level error, not process abort."""

from __future__ import annotations

import os

import solvapay


def test_panic_probe_raises_language_error() -> None:
    probe = getattr(solvapay, "panic_probe", None)
    if probe is None:
        native = getattr(solvapay, "_solvapay", None)
        probe = getattr(native, "panic_probe", None) if native is not None else None
    if probe is None:
        if os.environ.get("SOLVAPAY_REQUIRE_PANIC_PROBE") == "1":
            raise AssertionError("panic_probe is missing — rebuild with --features panic-probe")
        return
    try:
        probe()
    except Exception as exc:
        message = str(exc)
        code = getattr(exc, "code", None)
        assert "SOLVAPAY_PANIC_PROBE" in message or code == "internal_error"
        return
    raise AssertionError("panic_probe must raise")
