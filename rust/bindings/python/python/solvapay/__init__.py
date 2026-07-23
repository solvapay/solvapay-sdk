"""SolvaPay Python SDK — idiomatic facade over the compiled `_solvapay` module."""

from __future__ import annotations

from importlib import metadata

from solvapay.errors import PaywallError, SolvaPayError
from solvapay.facade import ApiClient, SolvaPay, create_solvapay
from solvapay.results import PayableAllowResult, PayableGateResult, PayablePaywallResult

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
]
