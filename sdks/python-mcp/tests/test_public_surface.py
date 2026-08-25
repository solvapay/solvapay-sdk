from __future__ import annotations

import inspect

import mcp
from solvapay_mcp import ResponseContext, register_payable_tool


def test_register_payable_tool_is_keyword_only() -> None:
    sig = inspect.signature(register_payable_tool)
    assert list(sig.parameters)[:2] == ["server", "name"]
    names = set(sig.parameters)
    for required in {
        "solvapay",
        "product",
        "handler",
        "title",
        "description",
        "input_schema",
        "get_customer_ref",
    }:
        assert required in names
        assert sig.parameters[required].kind is inspect.Parameter.KEYWORD_ONLY


def test_response_context_public_members() -> None:
    for name in ("respond", "gate", "emit", "customer", "product"):
        assert hasattr(ResponseContext, name) or name in ResponseContext.__annotations__


def test_mcp_sdk_major_is_v2() -> None:
    version = getattr(mcp, "__version__", None)
    if version is None:
        from importlib.metadata import version as dist_version

        version = dist_version("mcp")
    major = int(str(version).split(".", 1)[0])
    assert major == 2
