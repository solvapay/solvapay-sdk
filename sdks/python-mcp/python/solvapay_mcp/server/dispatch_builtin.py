"""Route SolvaPay builtin tools through `mcp_dispatch` when the native client has it."""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Mapping
from typing import TypeGuard

from solvapay.facade import SolvaPay

from solvapay_mcp.register import get_request_customer_ref
from solvapay_mcp.server.bootstrap import create_build_bootstrap_payload
from solvapay_mcp.server.helpers import (
    DeferredApiClient,
    _invoke,
    activate_plan_core,
    attach_business_details_core,
    cancel_purchase_core,
    create_checkout_session_core,
    create_customer_session_core,
    create_payment_intent_core,
    create_topup_payment_intent_core,
    facade_api_client,
    process_payment_intent_core,
    reactivate_purchase_core,
)
from solvapay_mcp.server.native import is_error_result
from solvapay_mcp.server.results import (
    narrated_tool_result,
    parse_mode,
    tool_error_result,
    tool_result,
)

INTENT_VIEWS = {"upgrade": "checkout", "manage_account": "account", "topup": "topup"}


def _is_record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict)


def _b64url_json(value: object) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _customer_bearer(customer_ref: str) -> str:
    return f"Bearer {_b64url_json({'alg': 'none'})}.{_b64url_json({'sub': customer_ref})}."


def _client_method(client: object, name: str) -> object | None:
    bound = getattr(type(client), name, None)
    if not callable(bound):
        return None
    method: object = getattr(client, name)
    return method


def _str_arg(args: Mapping[str, object], key: str) -> str | None:
    value = args.get(key)
    return value if isinstance(value, str) and value else None


def _as_call_tool_result(value: object) -> dict[str, object]:
    if not _is_record(value) or not isinstance(value.get("content"), list):
        raise RuntimeError("MCP builtin returned a result without content[]")
    return {str(k): v for k, v in value.items()}


def _core_tool_result(result: object) -> dict[str, object]:
    if is_error_result(result) and isinstance(result, dict):
        return tool_error_result(result)
    return tool_result(result)


def _unwrap_dispatch(value: object) -> dict[str, object]:
    if not _is_record(value):
        raise RuntimeError("mcpDispatch returned a non-object envelope")
    kind = value.get("kind")
    if kind == "rpc" and _is_record(value.get("rpc")):
        rpc = value["rpc"]
        assert isinstance(rpc, dict)
        if _is_record(rpc.get("error")):
            error = rpc["error"]
            assert isinstance(error, dict)
            message = error.get("message")
            text = message if isinstance(message, str) else "MCP error"
            return tool_error_result({"error": text, "status": 500})
        return _as_call_tool_result(rpc.get("result"))
    if kind == "challenge":
        status = value.get("status")
        return tool_error_result(
            {
                "error": "Unauthorized",
                "status": status if isinstance(status, int) else 401,
                "details": "customer_ref missing from MCP auth context",
            }
        )
    raise RuntimeError(f"unexpected mcpDispatch kind: {kind!r}")


async def dispatch_solvapay_builtin(
    *,
    solvapay: SolvaPay,
    name: str,
    args: Mapping[str, object],
    product_ref: str,
    public_base_url: str,
    resource_uri: str,
    views: list[str],
) -> dict[str, object]:
    customer_ref = get_request_customer_ref()
    client = facade_api_client(solvapay)
    tool_config: dict[str, object] = {
        "productRef": product_ref,
        "publicBaseUrl": public_base_url,
        "resourceUri": resource_uri,
        "views": list(views),
    }

    if _client_method(client, "mcp_dispatch") is not None:
        auth_header = _customer_bearer(customer_ref) if customer_ref else None
        payload: dict[str, object] = {
            "rpc": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": dict(args)},
            },
            "config": {**tool_config, "payableTools": []},
        }
        if auth_header is not None:
            payload["authHeader"] = auth_header
        envelope = await _invoke(client, "mcp_dispatch", payload)
        return _unwrap_dispatch(envelope)

    if _client_method(client, "mcp_call_builtin_tool") is not None:
        return _as_call_tool_result(
            await _invoke(
                client,
                "mcp_call_builtin_tool",
                {
                    "name": name,
                    "args": dict(args),
                    "config": tool_config,
                    "customerRef": customer_ref,
                },
            )
        )

    return await _dispatch_legacy_builtin(
        solvapay=solvapay,
        name=name,
        args=args,
        product_ref=product_ref,
        public_base_url=public_base_url,
        resource_uri=resource_uri,
        views=views,
        customer_ref=customer_ref,
    )


def _require_customer_ref(customer_ref: str | None) -> str | dict[str, object]:
    if not customer_ref:
        return tool_error_result(
            {
                "error": "Unauthorized",
                "status": 401,
                "details": "customer_ref missing from MCP auth context",
            }
        )
    return customer_ref


async def _dispatch_legacy_builtin(
    *,
    solvapay: SolvaPay,
    name: str,
    args: Mapping[str, object],
    product_ref: str,
    public_base_url: str,
    resource_uri: str,
    views: list[str],
    customer_ref: str | None,
) -> dict[str, object]:
    client = DeferredApiClient(solvapay)
    enabled_views = set(views)
    tool_meta = {"ui": {"resourceUri": resource_uri}}
    build_bootstrap = create_build_bootstrap_payload(
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
    )

    view = INTENT_VIEWS.get(name)
    if view is not None:
        data = await build_bootstrap(view)
        if not isinstance(data, dict):
            raise TypeError("bootstrap payload is not an object")
        return narrated_tool_result(
            name,
            data,
            parse_mode(args.get("mode")),
            {**tool_meta, "openai/widgetSessionId": str(uuid.uuid4())},
        )

    if name == "create_checkout_session":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        effective = _str_arg(args, "productRef") or product_ref
        plan_ref = _str_arg(args, "planRef")
        result = await create_checkout_session_core(
            client,
            customer_ref=auth,
            product_ref=str(effective),
            plan_ref=plan_ref,
            return_url=public_base_url,
        )
        return _core_tool_result(result)

    if name == "create_payment_intent":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        plan_ref = str(args.get("planRef") or "")
        effective = _str_arg(args, "productRef") or product_ref
        currency = _str_arg(args, "currency")
        result = await create_payment_intent_core(
            client,
            customer_ref=auth,
            plan_ref=plan_ref,
            product_ref=str(effective),
            currency=currency,
        )
        return _core_tool_result(result)

    if name == "process_payment":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        effective = _str_arg(args, "productRef") or product_ref
        result = await process_payment_intent_core(
            client,
            customer_ref=auth,
            payment_intent_id=str(args.get("paymentIntentId") or ""),
            product_ref=str(effective),
            plan_ref=_str_arg(args, "planRef"),
        )
        return _core_tool_result(result)

    if name == "create_customer_session":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        result = await create_customer_session_core(client, customer_ref=auth)
        return _core_tool_result(result)

    if name == "create_topup_payment_intent":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        raw_amount = args.get("amount")
        amount = raw_amount if isinstance(raw_amount, int) else 0
        result = await create_topup_payment_intent_core(
            client,
            customer_ref=auth,
            amount=amount,
            currency=str(args.get("currency") or ""),
            description=_str_arg(args, "description"),
        )
        return _core_tool_result(result)

    if name == "attach_business_details":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        tax_raw = args.get("taxIdType")
        tax_id_type = tax_raw if tax_raw in {"eu_vat", "gb_vat", "us_ein"} else None
        result = await attach_business_details_core(
            client,
            customer_ref=auth,
            payment_intent_id=str(args.get("paymentIntentId") or ""),
            is_business=args.get("isBusiness") is True,
            business_name=_str_arg(args, "businessName"),
            country=_str_arg(args, "country"),
            tax_id=_str_arg(args, "taxId"),
            tax_id_type=tax_id_type if isinstance(tax_id_type, str) else None,
        )
        return _core_tool_result(result)

    if name == "cancel_renewal":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        result = await cancel_purchase_core(
            client,
            purchase_ref=str(args.get("purchaseRef") or ""),
            reason=_str_arg(args, "reason"),
        )
        return _core_tool_result(result)

    if name == "reactivate_renewal":
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        result = await reactivate_purchase_core(
            client, purchase_ref=str(args.get("purchaseRef") or "")
        )
        return _core_tool_result(result)

    if name == "activate_plan":
        plan_ref = _str_arg(args, "planRef")
        mode = parse_mode(args.get("mode"))
        if not plan_ref:
            if "checkout" not in enabled_views:
                return tool_error_result(
                    {
                        "error": "activate_plan requires a planRef on this server",
                        "status": 400,
                        "details": (
                            "The checkout view (where the plan picker lives) is not "
                            "enabled on this server. Pass `planRef` to activate a "
                            'specific plan, or re-enable the "checkout" view via the '
                            "`views` option."
                        ),
                    }
                )
            data = await build_bootstrap("checkout")
            if not isinstance(data, dict):
                raise TypeError("bootstrap payload is not an object")
            return narrated_tool_result(
                name,
                data,
                mode,
                {**tool_meta, "openai/widgetSessionId": str(uuid.uuid4())},
            )
        auth = _require_customer_ref(customer_ref)
        if not isinstance(auth, str):
            return auth
        effective = _str_arg(args, "productRef") or product_ref
        result = await activate_plan_core(
            client,
            customer_ref=auth,
            product_ref=str(effective),
            plan_ref=str(plan_ref),
        )
        return _core_tool_result(result)

    return tool_error_result({"error": f"Unknown SolvaPay builtin: {name}", "status": 400})
