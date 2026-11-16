"""Errors raised by the SolvaPay SDK."""

from __future__ import annotations

from typing import Any


class SolvaPayError(Exception):
    """Every error the SDK raises.

    Branch on ``code`` (a stable identifier) and ``status`` (the HTTP status,
    when the error came from the API), never on the message, which is for
    people and may change.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        status: int | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.body = body

    def __repr__(self) -> str:
        return (
            f"SolvaPayError(code={self.code!r}, status={self.status!r}, message={self.message!r})"
        )
