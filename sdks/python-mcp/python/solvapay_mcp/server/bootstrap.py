from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from solvapay.facade import SolvaPay

from solvapay_mcp.register import get_request_customer_ref
from solvapay_mcp.server.helpers import (
    DeferredApiClient,
    check_purchase_core,
    enrich_purchase,
    get_customer_balance_core,
    get_merchant_core,
    get_payment_method_core,
    get_platform_config_core,
    get_product_core,
    get_usage_core,
    list_plans_core,
)
from solvapay_mcp.server.native import is_error_result

GetCustomerRefFn = Callable[[], str | None]


def _provider_not_found_message() -> str:
    return "\n".join(
        [
            "Provider account not found on this SolvaPay deployment.",
            "",
            "The Worker secret key authenticates against SolvaPay, but no merchant",
            "record exists for it. This usually means the secret key was created",
            "manually (without running `solvapay init`) or the merchant was deleted.",
            "",
            "To recover:",
            "  1. Run `npx solvapay init` in the project root. It will create the",
            "     merchant on the backend and write a valid secret key to `.env`.",
            "  2. Redeploy with `npm run deploy` to push the corrected secret to",
            "     the Worker.",
            "",
            "No tool calls will succeed until the merchant exists.",
        ]
    )


class BootstrapLookupError(RuntimeError):
    def __init__(self, details: str, status: int) -> None:
        super().__init__(details)
        self.details = details
        self.status = status


def _ok_or_null(result: object) -> object | None:
    return None if is_error_result(result) else result


async def _wrap_error(awaitable: Awaitable[object]) -> object:
    try:
        return await awaitable
    except Exception as err:
        return {"error": str(err), "status": 500}


def create_build_bootstrap_payload(
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    get_customer_ref: GetCustomerRefFn | None = None,
) -> Callable[[str], Awaitable[dict[str, object]]]:
    client = DeferredApiClient(solvapay)
    resolve_ref = get_customer_ref or get_request_customer_ref

    async def build(view: str) -> dict[str, object]:
        customer_ref = resolve_ref()

        async def unauthenticated() -> dict[str, object]:
            return {"error": "unauthenticated", "status": 401}

        (
            platform,
            merchant_result,
            product_result,
            plans_result,
            purchase_result,
            payment_method_result,
            balance_result,
            usage_result,
        ) = await asyncio.gather(
            get_platform_config_core(client),
            get_merchant_core(client),
            get_product_core(client, product_ref),
            _wrap_error(list_plans_core(client, product_ref)),
            _wrap_error(check_purchase_core(client, customer_ref))
            if customer_ref
            else unauthenticated(),
            _wrap_error(get_payment_method_core(client, customer_ref))
            if customer_ref
            else unauthenticated(),
            _wrap_error(get_customer_balance_core(client, customer_ref))
            if customer_ref
            else unauthenticated(),
            _wrap_error(get_usage_core(client, customer_ref, product_ref))
            if customer_ref
            else unauthenticated(),
        )

        if is_error_result(merchant_result) and isinstance(merchant_result, dict):
            status = merchant_result.get("status")
            details = (
                _provider_not_found_message()
                if status == 404
                else f"bootstrap: merchant lookup failed: {merchant_result.get('error')}"
            )
            raise BootstrapLookupError(details, int(status) if isinstance(status, int) else 500)
        if is_error_result(product_result) and isinstance(product_result, dict):
            status = product_result.get("status")
            details = f"bootstrap: product lookup failed: {product_result.get('error')}"
            raise BootstrapLookupError(details, int(status) if isinstance(status, int) else 500)

        plans: list[object] = []
        if not is_error_result(plans_result) and isinstance(plans_result, dict):
            raw_plans = plans_result.get("plans")
            if isinstance(raw_plans, list):
                plans = raw_plans

        purchase = _ok_or_null(purchase_result)
        enriched_purchase = None
        if isinstance(purchase, dict):
            raw_purchases = purchase.get("purchases")
            mapped = [
                enrich_purchase(dict(item)) if isinstance(item, dict) else item
                for item in raw_purchases
            ] if isinstance(raw_purchases, list) else []
            enriched_purchase = {**purchase, "purchases": mapped}

        publishable = None
        if isinstance(platform, dict):
            key = platform.get("stripePublishableKey")
            if isinstance(key, str):
                publishable = key

        customer: dict[str, object] | None = None
        if customer_ref:
            customer = {
                "ref": customer_ref,
                "purchase": enriched_purchase,
                "paymentMethod": _ok_or_null(payment_method_result),
                "balance": _ok_or_null(balance_result),
                "usage": _ok_or_null(usage_result),
            }

        return {
            "view": view,
            "productRef": product_ref,
            "stripePublishableKey": publishable,
            "returnUrl": public_base_url,
            "merchant": merchant_result,
            "product": product_result,
            "plans": plans,
            "customer": customer,
        }

    return build
