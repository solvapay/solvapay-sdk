"""Strict stubs for SolvaPay error types (Step 42T)."""

from __future__ import annotations

from collections.abc import Mapping

class SolvaPayError(Exception):
    code: str | None
    status: int | None
    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
    ) -> None: ...

class PaywallError(Exception):
    name: str
    structured_content: dict[str, object]
    def __init__(
        self, message: str, structured_content: Mapping[str, object] | None = None
    ) -> None: ...
