from __future__ import annotations

from solvapay_mcp.server.results import (
    narrated_tool_result,
    parse_mode,
    tool_error_result,
    tool_result,
)


def test_parse_mode_defaults_unknown_and_missing_to_ui() -> None:
    assert parse_mode(None) == "ui"
    assert parse_mode("nope") == "ui"
    assert parse_mode("text") == "text"
    assert parse_mode("auto") == "auto"


def test_tool_result_mirrors_json_in_content_and_structured() -> None:
    result = tool_result({"ok": True})
    assert result["content"] == [{"type": "text", "text": '{"ok": true}'}]
    assert result["structuredContent"] == {"ok": True}


def test_tool_error_result_prefers_details() -> None:
    result = tool_error_result({"error": "Unauthorized", "status": 401, "details": "missing ref"})
    assert result["isError"] is True
    assert result["content"] == [{"type": "text", "text": "missing ref"}]
    assert result["structuredContent"]["status"] == 401


def test_narrated_tool_result_ui_mode_keeps_placeholder_and_ui_meta() -> None:
    data = {
        "view": "account",
        "product": {"name": "Acme"},
        "plans": [],
        "customer": None,
        "merchant": {},
        "productRef": "prd_x",
        "returnUrl": "https://x",
        "stripePublishableKey": None,
    }
    result = narrated_tool_result(
        "manage_account",
        data,
        "ui",
        {"ui": {"resourceUri": "ui://x"}, "openai/widgetAccessible": True},
    )
    content = result["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert "Opened your Acme account." in str(content[0]["text"])
    assert content[1]["annotations"] == {"audience": ["assistant"]}
    assert result["_meta"]["ui"]["resourceUri"] == "ui://x"


def test_narrated_tool_result_text_mode_strips_ui_and_appends_links() -> None:
    data = {
        "view": "account",
        "product": {"name": "Acme"},
        "plans": [],
        "customer": None,
        "merchant": {},
        "productRef": "prd_x",
        "returnUrl": "https://x",
        "stripePublishableKey": None,
        "portalUrl": "https://portal.example",
    }
    result = narrated_tool_result(
        "manage_account",
        data,
        "text",
        {"ui": {"resourceUri": "ui://x"}, "openai/widgetAccessible": True},
    )
    assert "ui" not in result["_meta"]
    assert result["_meta"]["openai/widgetAccessible"] is True
    types = [block["type"] for block in result["content"] if isinstance(block, dict)]
    assert "resource_link" in types


def test_narrated_tool_result_auto_keeps_ui_meta() -> None:
    data = {
        "view": "upgrade",
        "product": {"name": "Acme"},
        "plans": [],
        "customer": None,
        "merchant": {},
        "productRef": "prd_x",
        "returnUrl": "https://x",
        "stripePublishableKey": None,
    }
    result = narrated_tool_result(
        "upgrade",
        data,
        "auto",
        {"ui": {"resourceUri": "ui://x"}},
    )
    assert result["_meta"]["ui"]["resourceUri"] == "ui://x"
    assert isinstance(result["content"], list)
    assert result["content"][0]["type"] == "text"
