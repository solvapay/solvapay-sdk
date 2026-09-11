from __future__ import annotations

from solvapay_mcp.oauth.free_methods import is_free_mcp_method, requires_bearer_auth


def test_tools_call_requires_auth() -> None:
    assert is_free_mcp_method("tools/call") is False


def test_initialize_and_tools_list_are_free() -> None:
    assert is_free_mcp_method("initialize") is True
    assert is_free_mcp_method("tools/list") is True
    assert is_free_mcp_method("resources/list") is True


def test_requires_bearer_auth_tools_call_in_both_modes() -> None:
    assert requires_bearer_auth("tools/call", "tools-call") is True
    assert requires_bearer_auth("tools/call", "all") is True


def test_requires_bearer_auth_initialize_depends_on_mode() -> None:
    assert requires_bearer_auth("initialize", "tools-call") is False
    assert requires_bearer_auth("initialize", "all") is True
