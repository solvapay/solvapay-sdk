"""Step 42 — load-time facade ↔ native version skew guard (§7.7)."""

from __future__ import annotations

import importlib
import sys
from typing import Any

import pytest

import solvapay


def test_installed_version_matches_native() -> None:
    assert solvapay.version is not None
    assert solvapay.version() == "0.1.0"
    info = solvapay.native_build_info()
    assert info is not None
    assert '"version":"0.1.0"' in info


def test_version_skew_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import solvapay as sp

    assert sp.version is not None
    real_version = sp.version

    monkeypatch.setattr(sp, "version", lambda: "9.9.9")
    # Re-run the guard against the monkeypatched native version.
    from importlib import metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "0.1.0")

    with pytest.raises(sp.SolvaPayError) as exc_info:
        sp._check_version_skew()  # type: ignore[attr-defined]
    assert getattr(exc_info.value, "code", None) == "version_skew"

    monkeypatch.setattr(sp, "version", real_version)


def test_reimport_does_not_skew_under_matching_versions() -> None:
    # Ensure a clean import path still succeeds when versions match.
    mods = [name for name in sys.modules if name == "solvapay" or name.startswith("solvapay.")]
    saved: dict[str, Any] = {name: sys.modules[name] for name in mods}
    try:
        for name in mods:
            del sys.modules[name]
        importlib.invalidate_caches()
        reloaded = importlib.import_module("solvapay")
        assert reloaded.version() == "0.1.0"
    finally:
        sys.modules.update(saved)
