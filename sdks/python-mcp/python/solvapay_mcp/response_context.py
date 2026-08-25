from __future__ import annotations

from collections.abc import Mapping

from solvapay.errors import PaywallError

from solvapay_mcp._layer2 import make_response_result


class ResponseContext:
    """Merchant-facing payable context (`respond` / `gate` / `emit`)."""

    customer: Mapping[str, object]
    product: Mapping[str, object]

    def __init__(
        self,
        *,
        customer: Mapping[str, object],
        product: Mapping[str, object],
        product_ref: str,
    ) -> None:
        self.customer = customer
        self.product = product
        self._product_ref = product_ref
        self._emitted: list[dict[str, object]] = []

    def emit(self, block: Mapping[str, object]) -> None:
        self._emitted.append(dict(block))

    def respond(
        self, data: object, options: Mapping[str, object] | None = None
    ) -> dict[str, object]:
        opts = dict(options) if options is not None else None
        return make_response_result(data, opts, list(self._emitted))

    def gate(self, reason: str | None = None) -> None:
        message = reason if reason else "Payment required"
        raise PaywallError(
            message,
            {
                "kind": "payment_required",
                "product": self._product_ref,
                "checkoutUrl": "",
                "message": message,
            },
        )
