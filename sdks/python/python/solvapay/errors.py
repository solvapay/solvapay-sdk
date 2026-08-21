"""SolvaPay Python error types (hand-written facade surface, Step 41-d)."""

from __future__ import annotations

from collections.abc import Mapping

try:
    from solvapay._solvapay import SolvaPayError as _NativeSolvaPayError
except ImportError:  # pragma: no cover — pure-Python unit tests without extension
    _NativeSolvaPayError = None


if _NativeSolvaPayError is not None:
    SolvaPayError = _NativeSolvaPayError
else:

    class SolvaPayError(Exception):
        """Fallback SolvaPayError used when the native extension is absent."""

        def __init__(
            self,
            message: str,
            *,
            code: str | None = None,
            status: int | None = None,
        ) -> None:
            super().__init__(message)
            self.code = code
            self.status = status


class PaywallError(Exception):
    """Paywall gate outcome carrying structured content (§5.7 / §2.4)."""

    def __init__(
        self, message: str, structured_content: Mapping[str, object] | None = None
    ) -> None:
        super().__init__(message)
        self.name = "PaywallError"
        self.structured_content = dict(structured_content or {})


__all__ = ["SolvaPayError", "PaywallError"]
