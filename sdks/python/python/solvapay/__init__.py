"""SolvaPay Python SDK — idiomatic facade over the compiled `_solvapay` module."""

from __future__ import annotations

from importlib import metadata
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import Any

from solvapay.errors import PaywallError, SolvaPayError
from solvapay.facade import ApiClient, SolvaPay, create_solvapay
from solvapay.results import PayableAllowResult, PayableGateResult, PayablePaywallResult
from solvapay.retry import with_retry, with_retry_blocking

try:
    from solvapay._solvapay import (
        SolvaPayClient,
        native_build_info,
        verify_webhook,
        version,
    )
except ImportError:  # pragma: no cover
    SolvaPayClient = None  # type: ignore[misc, assignment]
    native_build_info = None  # type: ignore[assignment]
    version = None  # type: ignore[assignment]
    verify_webhook = None  # type: ignore[assignment]


def _check_version_skew() -> None:
    """Raise when the installed dist version disagrees with the native module (§7.7)."""
    if version is None:
        return
    try:
        dist_version = metadata.version("solvapay")
    except metadata.PackageNotFoundError:
        return
    native_version = version()
    if dist_version != native_version:
        err = SolvaPayError(
            f"solvapay version skew: package={dist_version!r} native={native_version!r}"
        )
        setattr(err, "code", "version_skew")
        raise err


_check_version_skew()

__all__ = [
    "ApiClient",
    "PayableAllowResult",
    "PayableGateResult",
    "PayablePaywallResult",
    "PaywallError",
    "SolvaPay",
    "SolvaPayClient",
    "SolvaPayError",
    "create_solvapay",
    "native_build_info",
    "version",
    "verify_webhook",
    "with_retry",
    "with_retry_blocking",
]


def _load_generated_helpers() -> Any:
    path = Path(__file__).resolve().parent / "helpers.generated.py"
    spec = spec_from_file_location("solvapay._helpers_generated", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load generated helpers from {path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_generated_helpers = _load_generated_helpers()
for _name in dir(_generated_helpers):
    if _name.startswith("_"):
        continue
    globals()[_name] = getattr(_generated_helpers, _name)
    __all__.append(_name)
for _name in getattr(_generated_helpers, "_CONSTANT_IDS", ()):
    if _name not in __all__:
        __all__.append(_name)


def __getattr__(name: str) -> Any:
    """Forward generated lazy constants (PEP 562)."""
    return getattr(_generated_helpers, name)
