from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from solvapay.facade import SolvaPay

from solvapay_mcp.register import get_request_customer_ref
from solvapay_mcp.server.bootstrap import create_build_bootstrap_payload
from solvapay_mcp.server.helpers import (
    activate_plan_core,
    attach_business_details_core,
    cancel_purchase_core,
    create_checkout_session_core,
    create_customer_session_core,
    create_payment_intent_core,
    create_topup_payment_intent_core,
    DeferredApiClient,
    process_payment_intent_core,
    reactivate_purchase_core,
)
from solvapay_mcp.server.native import is_error_result, native_call
from solvapay_mcp.server.overview import (
    SOLVAPAY_BOOTSTRAP_MIME_TYPE,
    SOLVAPAY_BOOTSTRAP_URI,
    SOLVAPAY_OVERVIEW_MARKDOWN,
    SOLVAPAY_OVERVIEW_MIME_TYPE,
    SOLVAPAY_OVERVIEW_URI,
)
from solvapay_mcp.server.results import (
    narrated_tool_result,
    parse_mode,
    preview_json,
    tool_error_result,
    tool_result,
)
from solvapay_mcp.widget import RESOURCE_URI_META_KEY

Handler = Callable[[dict[str, object]], Awaitable[dict[str, object]]]


def _json_schema(
    properties: dict[str, object], required: list[str] | None = None
) -> dict[str, object]:
    schema: dict[str, object] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _str_arg(args: dict[str, object], key: str) -> str | None:
    value = args.get(key)
    return value if isinstance(value, str) and value else None


MODE_SCHEMA = {
    "type": "string",
    "enum": ["ui", "text", "auto"],
}


def _with_legacy_uri(meta: dict[str, object]) -> dict[str, object]:
    ui = meta.get("ui")
    if isinstance(ui, dict) and "resourceUri" in ui and RESOURCE_URI_META_KEY not in meta:
        return {**meta, RESOURCE_URI_META_KEY: ui["resourceUri"]}
    return meta


def _require_customer_ref() -> str | dict[str, object]:
    ref = get_request_customer_ref()
    if not ref:
        return tool_error_result(
            {
                "error": "Unauthorized",
                "status": 401,
                "details": "customer_ref missing from MCP auth context",
            }
        )
    return ref


async def _trace(
    name: str,
    handler: Callable[[], Awaitable[dict[str, object]]],
    on_tool_call: Callable[[str], None] | None,
    on_tool_result: Callable[[str, dict[str, object]], None] | None,
) -> dict[str, object]:
    if on_tool_call:
        on_tool_call(name)
    try:
        result = await handler()
        if on_tool_result:
            on_tool_result(name, result)
        return result
    except Exception as err:
        status = getattr(err, "status", 500)
        details = getattr(err, "details", None)
        if not isinstance(details, str) or not details:
            details = str(err) if isinstance(err, Exception) else preview_json(err)
        if not isinstance(status, int):
            status = 500
        error_result = tool_error_result({"error": str(err), "status": status, "details": details})
        if on_tool_result:
            on_tool_result(name, error_result)
        return error_result


def build_solvapay_descriptors(
    *,
    solvapay: SolvaPay,
    product_ref: str,
    resource_uri: str,
    public_base_url: str,
    read_html: Callable[[], Awaitable[str]] | None = None,
    html: str | None = None,
    views: list[str] | None = None,
    csp: dict[str, list[str]] | None = None,
    api_base_url: str | None = None,
) -> dict[str, object]:
    from solvapay_mcp.server.csp import merge_csp
    from solvapay_mcp.widget import default_mcp_app_html

    url_error = native_call("validate_public_base_url", {"publicBaseUrl": public_base_url})
    if isinstance(url_error, str) and url_error:
        raise ValueError(url_error)
    native_call(
        "assert_valid_product_ref",
        {"productRef": product_ref, "context": "buildSolvaPayDescriptors"},
    )

    meta_args: dict[str, object] = {"resourceUri": resource_uri}
    if views is not None:
        meta_args["views"] = views
    metadata = native_call("build_tool_descriptor_metadata", meta_args)
    if not isinstance(metadata, list):
        raise TypeError("build_tool_descriptor_metadata returned unexpected value")

    prompt_args: dict[str, object] = {}
    if views is not None:
        prompt_args["views"] = views
    prompt_meta = native_call("build_prompt_descriptor_metadata", prompt_args)
    if not isinstance(prompt_meta, list):
        prompt_meta = []

    names = native_call("MCP_TOOL_NAMES", {})
    if not isinstance(names, dict):
        raise TypeError("MCP_TOOL_NAMES returned unexpected value")
    view_maps = native_call("mcp_view_maps", {})
    tool_for_view = view_maps.get("TOOL_FOR_VIEW") if isinstance(view_maps, dict) else {}
    if not isinstance(tool_for_view, dict):
        tool_for_view = {}

    client = DeferredApiClient(solvapay)
    build_bootstrap = create_build_bootstrap_payload(
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
    )
    enabled_views = set(views or ["checkout", "account", "topup"])

    async def read_widget() -> str:
        if read_html is not None:
            return await read_html()
        if html is not None:
            return html
        return default_mcp_app_html()

    def intent_handler(view: str, tool_name: str, meta: dict[str, object]) -> Handler:
        async def handle(args: dict[str, object]) -> dict[str, object]:
            async def run() -> dict[str, object]:
                mode = parse_mode(args.get("mode"))
                data = await build_bootstrap(view)
                return narrated_tool_result(
                    tool_name,
                    data,
                    mode,
                    {**meta, "openai/widgetSessionId": str(uuid.uuid4())},
                )

            return await _trace(tool_name, run, None, None)

        return handle

    handlers: dict[str, Handler] = {}

    async def handle_checkout(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            effective = _str_arg(args, "productRef") or product_ref
            plan_ref = _str_arg(args, "planRef")
            result = await create_checkout_session_core(
                client,
                customer_ref=auth,
                product_ref=str(effective),
                plan_ref=plan_ref if isinstance(plan_ref, str) else None,
                return_url=public_base_url,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["createCheckoutSession"]), run, None, None)

    async def handle_payment(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
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
                currency=currency if isinstance(currency, str) else None,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["createPayment"]), run, None, None)

    async def handle_process(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            payment_intent_id = str(args.get("paymentIntentId") or "")
            effective = _str_arg(args, "productRef") or product_ref
            plan_ref = _str_arg(args, "planRef")
            result = await process_payment_intent_core(
                client,
                customer_ref=auth,
                payment_intent_id=payment_intent_id,
                product_ref=str(effective),
                plan_ref=plan_ref if isinstance(plan_ref, str) else None,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["processPayment"]), run, None, None)

    async def handle_customer_session(_args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            result = await create_customer_session_core(client, customer_ref=auth)
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["createCustomerSession"]), run, None, None)

    async def handle_topup_payment(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            raw_amount = args.get("amount")
            amount = raw_amount if isinstance(raw_amount, int) else 0
            currency = str(args.get("currency") or "")
            raw_description = args.get("description")
            description = raw_description if isinstance(raw_description, str) else None
            result = await create_topup_payment_intent_core(
                client,
                customer_ref=auth,
                amount=amount,
                currency=currency,
                description=description if isinstance(description, str) else None,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["createTopupPayment"]), run, None, None)

    async def handle_business(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            tax_id_type_raw = args.get("taxIdType")
            tax_id_type: str | None = None
            if isinstance(tax_id_type_raw, str) and tax_id_type_raw in {
                "eu_vat",
                "gb_vat",
                "us_ein",
            }:
                tax_id_type = tax_id_type_raw
            business_name = args.get("businessName")
            country = args.get("country")
            tax_id = args.get("taxId")
            result = await attach_business_details_core(
                client,
                customer_ref=auth,
                payment_intent_id=str(args.get("paymentIntentId") or ""),
                is_business=args.get("isBusiness") is True,
                business_name=business_name if isinstance(business_name, str) else None,
                country=country if isinstance(country, str) else None,
                tax_id=tax_id if isinstance(tax_id, str) else None,
                tax_id_type=tax_id_type,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["attachBusinessDetails"]), run, None, None)

    async def handle_cancel(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            reason = args.get("reason")
            result = await cancel_purchase_core(
                client,
                purchase_ref=str(args.get("purchaseRef") or ""),
                reason=reason if isinstance(reason, str) else None,
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["cancelRenewal"]), run, None, None)

    async def handle_reactivate(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            result = await reactivate_purchase_core(
                client, purchase_ref=str(args.get("purchaseRef") or "")
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["reactivateRenewal"]), run, None, None)

    async def handle_activate(args: dict[str, object]) -> dict[str, object]:
        async def run() -> dict[str, object]:
            plan_ref = _str_arg(args, "planRef")
            mode = parse_mode(args.get("mode"))
            if not plan_ref:
                if "checkout" not in enabled_views:
                    details = (
                        "The checkout view (where the plan picker lives) is not "
                        "enabled on this server. Pass `planRef` to activate a "
                        'specific plan, or re-enable the "checkout" view via the '
                        "`views` option."
                    )
                    return tool_error_result(
                        {
                            "error": "activate_plan requires a planRef on this server",
                            "status": 400,
                            "details": details,
                        }
                    )
                data = await build_bootstrap("checkout")
                return narrated_tool_result(
                    str(names["activatePlan"]),
                    data,
                    mode,
                    {
                        "ui": {"resourceUri": resource_uri},
                        "openai/widgetSessionId": str(uuid.uuid4()),
                    },
                )
            auth = _require_customer_ref()
            if not isinstance(auth, str):
                return auth
            effective = _str_arg(args, "productRef") or product_ref
            result = await activate_plan_core(
                client,
                customer_ref=auth,
                product_ref=str(effective),
                plan_ref=str(plan_ref),
            )
            if is_error_result(result) and isinstance(result, dict):
                return tool_error_result(result)
            return tool_result(result)

        return await _trace(str(names["activatePlan"]), run, None, None)

    transport_handlers = {
        str(names["createCheckoutSession"]): handle_checkout,
        str(names["createPayment"]): handle_payment,
        str(names["processPayment"]): handle_process,
        str(names["createCustomerSession"]): handle_customer_session,
        str(names["createTopupPayment"]): handle_topup_payment,
        str(names["attachBusinessDetails"]): handle_business,
        str(names["cancelRenewal"]): handle_cancel,
        str(names["reactivateRenewal"]): handle_reactivate,
        str(names["activatePlan"]): handle_activate,
    }

    schemas: dict[str, dict[str, object]] = {
        str(names["upgrade"]): _json_schema({"mode": MODE_SCHEMA}),
        str(names["manageAccount"]): _json_schema({"mode": MODE_SCHEMA}),
        str(names["topup"]): _json_schema({"mode": MODE_SCHEMA}),
        str(names["createCheckoutSession"]): _json_schema(
            {"planRef": {"type": "string"}, "productRef": {"type": "string"}}
        ),
        str(names["createPayment"]): _json_schema(
            {
                "planRef": {"type": "string"},
                "productRef": {"type": "string"},
                "currency": {"type": "string"},
            },
            ["planRef", "productRef"],
        ),
        str(names["processPayment"]): _json_schema(
            {
                "paymentIntentId": {"type": "string"},
                "productRef": {"type": "string"},
                "planRef": {"type": "string"},
            },
            ["paymentIntentId", "productRef"],
        ),
        str(names["createCustomerSession"]): _json_schema({}),
        str(names["createTopupPayment"]): _json_schema(
            {
                "amount": {"type": "integer"},
                "currency": {"type": "string"},
                "description": {"type": "string"},
            },
            ["amount", "currency"],
        ),
        str(names["attachBusinessDetails"]): _json_schema(
            {
                "paymentIntentId": {"type": "string"},
                "isBusiness": {"type": "boolean"},
                "businessName": {"type": "string"},
                "country": {"type": "string"},
                "taxId": {"type": "string"},
                "taxIdType": {"type": "string", "enum": ["eu_vat", "gb_vat", "us_ein"]},
            },
            ["paymentIntentId", "isBusiness"],
        ),
        str(names["cancelRenewal"]): _json_schema(
            {"purchaseRef": {"type": "string"}, "reason": {"type": "string"}},
            ["purchaseRef"],
        ),
        str(names["reactivateRenewal"]): _json_schema(
            {"purchaseRef": {"type": "string"}},
            ["purchaseRef"],
        ),
        str(names["activatePlan"]): _json_schema(
            {
                "productRef": {"type": "string"},
                "planRef": {"type": "string"},
                "mode": MODE_SCHEMA,
            }
        ),
    }

    tools: list[dict[str, object]] = []
    for item in metadata:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        raw_meta = item.get("meta")
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        merged_meta = _with_legacy_uri({str(k): v for k, v in meta.items()})
        view = next((v for v, tool in tool_for_view.items() if tool == name), None)
        handler: Handler | None
        if view in ("checkout", "account", "topup"):
            handler = intent_handler(str(view), name, merged_meta)
        else:
            handler = transport_handlers.get(name)
        if handler is None:
            continue
        tools.append(
            {
                "name": name,
                "title": item.get("title"),
                "description": item.get("description"),
                "annotations": item.get("annotations"),
                "icons": item.get("icons"),
                "meta": merged_meta,
                "inputSchema": schemas.get(name, _json_schema({})),
                "handler": handler,
            }
        )
        handlers[name] = handler

    prompts: list[dict[str, object]] = []
    for item in prompt_meta:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")

        async def prompt_handler(args: dict[str, str], prompt_name: str = name) -> str:
            result = native_call(
                "build_prompt_user_message",
                {"promptName": prompt_name, "args": args},
            )
            if isinstance(result, dict):
                messages = result.get("messages")
                if isinstance(messages, list) and messages:
                    first = messages[0]
                    if isinstance(first, dict):
                        content = first.get("content")
                        if isinstance(content, dict) and isinstance(content.get("text"), str):
                            return str(content["text"])
            return ""

        prompts.append({**item, "handler": prompt_handler})

    resolved_csp = merge_csp(csp, api_base_url)
    return {
        "tools": tools,
        "handlers": handlers,
        "prompts": prompts,
        "csp": resolved_csp,
        "resource": {
            "uri": resource_uri,
            "mimeType": "text/html;profile=mcp-app",
            "csp": resolved_csp,
            "readHtml": read_widget,
        },
        "docs": {
            "uri": SOLVAPAY_OVERVIEW_URI,
            "name": "SolvaPay MCP — overview",
            "title": "SolvaPay overview",
            "description": (
                'Agent-facing "start here" doc — explains the five intent tools, dual-audience '
                "fallback, and auth model before any tool is called."
            ),
            "mimeType": SOLVAPAY_OVERVIEW_MIME_TYPE,
            "body": SOLVAPAY_OVERVIEW_MARKDOWN,
        },
        "bootstrap": {
            "uri": SOLVAPAY_BOOTSTRAP_URI,
            "name": "SolvaPay bootstrap",
            "title": "SolvaPay bootstrap",
            "description": (
                "Current merchant/product/plans/customer snapshot for the embedded UI. Widgets "
                "read this idempotently when the host scrubs structuredContent from tool results."
            ),
            "mimeType": SOLVAPAY_BOOTSTRAP_MIME_TYPE,
            "readPayload": lambda: build_bootstrap("account"),
        },
        "buildBootstrapPayload": build_bootstrap,
    }
