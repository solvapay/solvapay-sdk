from __future__ import annotations

from mcp.client import Client
from solvapay.facade import create_solvapay
from tests.server.recording_client import RecordingClient

from mcp.server.apps import APP_MIME_TYPE, EXTENSION_ID
from mcp.server.lowlevel.server import NotificationOptions

from solvapay_mcp.server.csp import SOLVAPAY_DEFAULT_CSP, merge_csp
from solvapay_mcp.server.factory import create_solvapay_mcp_server
from solvapay_mcp.server.native import native_call
from solvapay_mcp.widget import MCP_APP_MIME_TYPE, RESOURCE_URI_META_KEY


def test_merge_csp_includes_api_origin_and_defaults() -> None:
    merged = merge_csp(
        {"connectDomains": ["https://cdn.example"]},
        "https://api.example.com/v1",
    )
    assert "https://js.stripe.com" in merged["resourceDomains"]
    assert "https://cdn.example" in merged["connectDomains"]
    assert "https://api.example.com" in merged["connectDomains"]
    assert merged["frameDomains"] == SOLVAPAY_DEFAULT_CSP["frameDomains"]


def _server():
    client = RecordingClient(
        {
            "get_merchant": {"displayName": "Acme"},
            "get_product": {"reference": "prd_demo", "name": "Demo"},
            "get_platform_config": {},
            "list_plans": [],
        }
    )
    return create_solvapay_mcp_server(
        solvapay=create_solvapay(api_client=client),
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        api_base_url="https://api.example.com",
    )


async def test_tools_list_matches_twelve_solvapay_tools() -> None:
    names = native_call("MCP_TOOL_NAMES", {})
    assert isinstance(names, dict)
    expected = {
        names["createPayment"],
        names["processPayment"],
        names["createTopupPayment"],
        names["cancelRenewal"],
        names["reactivateRenewal"],
        names["activatePlan"],
        names["createCheckoutSession"],
        names["createCustomerSession"],
        names["attachBusinessDetails"],
        names["upgrade"],
        names["manageAccount"],
        names["topup"],
    }
    async with Client(_server()) as client:
        listed = await client.list_tools()
    got = {tool.name for tool in listed.tools}
    assert expected <= got
    upgrade = next(tool for tool in listed.tools if tool.name == names["upgrade"])
    meta = upgrade.meta or {}
    ui = meta.get("ui") if isinstance(meta, dict) else None
    assert isinstance(ui, dict)
    assert ui.get("resourceUri") == "ui://solvapay/mcp-app.html"
    assert meta.get(RESOURCE_URI_META_KEY) == "ui://solvapay/mcp-app.html"
    assert meta.get("openai/outputTemplate") == "ui://solvapay/mcp-app.html"
    payment = next(tool for tool in listed.tools if tool.name == names["createPayment"])
    pay_meta = payment.meta or {}
    pay_ui = pay_meta.get("ui") if isinstance(pay_meta, dict) else None
    assert isinstance(pay_ui, dict)
    assert pay_ui.get("visibility") == ["app"]
    assert pay_meta.get("openai/widgetAccessible") is True
    assert pay_meta.get("audience") == "ui" or (
        isinstance(pay_ui, dict) and pay_meta.get("audience") in ("ui", None)
    )


async def test_resources_and_prompts_surface() -> None:
    async with Client(_server()) as client:
        resources = await client.list_resources()
        prompts = await client.list_prompts()
    uris = {str(item.uri) for item in resources.resources}
    assert "ui://solvapay/mcp-app.html" in uris
    assert "docs://solvapay/overview.md" in uris
    assert "solvapay://bootstrap.json" in uris
    ui = next(item for item in resources.resources if str(item.uri) == "ui://solvapay/mcp-app.html")
    assert ui.mime_type == MCP_APP_MIME_TYPE
    csp = (ui.meta or {}).get("ui", {}).get("csp") if ui.meta else None
    assert isinstance(csp, dict)
    assert "https://js.stripe.com" in csp["resourceDomains"]
    assert "data:" not in csp["connectDomains"]
    assert "data:" not in csp["resourceDomains"]
    prompt_names = {item.name for item in prompts.prompts}
    assert prompt_names == {"upgrade", "manage_account", "topup", "activate_plan"}


async def test_widget_resource_read_returns_mcp_app_html() -> None:
    async with Client(_server()) as client:
        read = await client.read_resource("ui://solvapay/mcp-app.html")
    assert len(read.contents) == 1
    block = read.contents[0]
    assert getattr(block, "mime_type", None) == MCP_APP_MIME_TYPE
    text = getattr(block, "text", None)
    assert isinstance(text, str)
    assert 'id="root"' in text
    assert "<script" in text
    assert "solvapay://bootstrap.json" in text


async def test_upgrade_result_stamps_widget_resource_uri() -> None:
    names = native_call("MCP_TOOL_NAMES", {})
    assert isinstance(names, dict)
    async with Client(_server()) as client:
        result = await client.call_tool(str(names["upgrade"]), {})
    meta = result.meta or {}
    ui = meta.get("ui") if isinstance(meta, dict) else None
    assert isinstance(ui, dict)
    assert ui.get("resourceUri") == "ui://solvapay/mcp-app.html"
    assert meta.get(RESOURCE_URI_META_KEY) == "ui://solvapay/mcp-app.html"
    assert meta.get("openai/outputTemplate") == "ui://solvapay/mcp-app.html"


def test_server_advertises_mcp_apps_extension() -> None:
    caps = _server().get_capabilities(NotificationOptions())
    extensions = caps.extensions or {}
    assert EXTENSION_ID in extensions
    assert APP_MIME_TYPE in (extensions[EXTENSION_ID].get("mimeTypes") or [])
