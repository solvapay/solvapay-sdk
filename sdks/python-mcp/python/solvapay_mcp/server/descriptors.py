from __future__ import annotations

from collections.abc import Awaitable, Callable

from solvapay.facade import SolvaPay

from solvapay_mcp.server.bootstrap import create_build_bootstrap_payload
from solvapay_mcp.server.dispatch_builtin import dispatch_solvapay_builtin
from solvapay_mcp.server.native import native_call
from solvapay_mcp.server.overview import (
    SOLVAPAY_BOOTSTRAP_MIME_TYPE,
    SOLVAPAY_BOOTSTRAP_URI,
    SOLVAPAY_OVERVIEW_MIME_TYPE,
    SOLVAPAY_OVERVIEW_URI,
    overview_body,
)
from solvapay_mcp.server.results import preview_json, tool_error_result
from solvapay_mcp.widget import RESOURCE_URI_META_KEY

Handler = Callable[[dict[str, object]], Awaitable[dict[str, object]]]


def _json_schema(
    properties: dict[str, object], required: list[str] | None = None
) -> dict[str, object]:
    schema: dict[str, object] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


MODE_SCHEMA = {
    "type": "string",
    "enum": ["ui", "text", "auto"],
}


def _with_legacy_uri(meta: dict[str, object]) -> dict[str, object]:
    ui = meta.get("ui")
    if isinstance(ui, dict) and "resourceUri" in ui and RESOURCE_URI_META_KEY not in meta:
        return {**meta, RESOURCE_URI_META_KEY: ui["resourceUri"]}
    return meta


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
    from solvapay_mcp.core import call
    from solvapay_mcp.widget import default_mcp_app_html

    payload: dict[str, object] = {
        "resourceUri": resource_uri,
        "publicBaseUrl": public_base_url,
        "productRef": product_ref,
    }
    if views is not None:
        payload["views"] = views
    if csp is not None:
        payload["csp"] = csp
    if api_base_url is not None:
        payload["apiBaseUrl"] = api_base_url
    raw_bundle = call("mcpDescriptors", payload)
    if not isinstance(raw_bundle, dict):
        raise TypeError("mcpDescriptors did not return an object")
    descriptor_bundle = raw_bundle
    metadata = raw_bundle.get("tools")
    prompt_meta = raw_bundle.get("prompts")
    if not isinstance(metadata, list):
        raise TypeError("mcpDescriptors.tools is not a list")
    if not isinstance(prompt_meta, list):
        prompt_meta = []

    names = native_call("MCP_TOOL_NAMES", {})
    if not isinstance(names, dict):
        raise TypeError("MCP_TOOL_NAMES returned unexpected value")

    build_bootstrap = create_build_bootstrap_payload(
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
    )
    enabled_views = views or ["checkout", "account", "topup"]

    async def read_widget() -> str:
        if read_html is not None:
            return await read_html()
        if html is not None:
            return html
        return default_mcp_app_html()

    def builtin_handler(tool_name: str) -> Handler:
        async def handle(args: dict[str, object]) -> dict[str, object]:
            async def run() -> dict[str, object]:
                return await dispatch_solvapay_builtin(
                    solvapay=solvapay,
                    name=tool_name,
                    args=args,
                    product_ref=product_ref,
                    public_base_url=public_base_url,
                    resource_uri=resource_uri,
                    views=list(enabled_views),
                )

            return await _trace(tool_name, run, None, None)

        return handle

    handlers: dict[str, Handler] = {}

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
        handler = builtin_handler(name)
        tools.append(
            {
                "name": name,
                "title": item.get("title"),
                "description": item.get("description"),
                "annotations": item.get("annotations"),
                "icons": item.get("icons"),
                "meta": merged_meta,
                "inputSchema": item.get("inputSchema")
                if isinstance(item.get("inputSchema"), dict)
                else schemas.get(name, _json_schema({})),
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

    bundle_csp = descriptor_bundle.get("csp")
    resolved_csp = bundle_csp if isinstance(bundle_csp, dict) else {}
    docs_meta = descriptor_bundle.get("docs")
    bootstrap_meta = descriptor_bundle.get("bootstrap")
    docs = docs_meta if isinstance(docs_meta, dict) else {}
    bootstrap = bootstrap_meta if isinstance(bootstrap_meta, dict) else {}
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
            "uri": docs.get("uri", SOLVAPAY_OVERVIEW_URI),
            "name": docs.get("name", "SolvaPay MCP — overview"),
            "title": docs.get("title", "SolvaPay overview"),
            "description": docs.get(
                "description",
                'Agent-facing "start here" doc — explains the five intent tools, dual-audience '
                "fallback, and auth model before any tool is called.",
            ),
            "mimeType": docs.get("mimeType", SOLVAPAY_OVERVIEW_MIME_TYPE),
            "body": overview_body(),
        },
        "bootstrap": {
            "uri": bootstrap.get("uri", SOLVAPAY_BOOTSTRAP_URI),
            "name": bootstrap.get("name", "SolvaPay bootstrap"),
            "title": bootstrap.get("title", "SolvaPay bootstrap"),
            "description": bootstrap.get(
                "description",
                "Current merchant/product/plans/customer snapshot for the embedded UI. Widgets "
                "read this idempotently when the host scrubs structuredContent from tool results.",
            ),
            "mimeType": bootstrap.get("mimeType", SOLVAPAY_BOOTSTRAP_MIME_TYPE),
            "readPayload": lambda: build_bootstrap("account"),
        },
        "buildBootstrapPayload": build_bootstrap,
    }
