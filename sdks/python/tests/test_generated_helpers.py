"""Generated portable helpers are re-exported from the package root."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import solvapay


def test_generated_helpers_are_importable_from_package_root() -> None:
    path = Path(solvapay.__file__).resolve().parent / "helpers.generated.py"
    spec = importlib.util.spec_from_file_location("solvapay._helpers_generated_check", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for name in dir(module):
        if name.startswith("_"):
            continue
        assert hasattr(solvapay, name), f"{name} missing from solvapay package"
        assert name in solvapay.__all__, f"{name} missing from solvapay.__all__"

    for name in getattr(module, "_CONSTANT_IDS", ()):
        assert name in solvapay.__all__, f"constant {name} missing from solvapay.__all__"
        assert getattr(solvapay, name) is not None
