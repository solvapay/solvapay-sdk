from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import pytest

from solvapay_mcp.workers import (
    WasmApiClient,
    WorkersSolvaPayError,
    snake_to_camel,
    unwrap_wasm_envelope,
    wasm_facade_api_client,
)

REPO = Path(__file__).resolve().parents[3]
PYI = REPO / "sdks" / "python" / "python" / "solvapay" / "__init__.pyi"
ASYNC_ARGS_JSON = re.compile(r"async def ([a-z_]+)\(self, args_json: str\) -> str:")


def pyi_async_client_methods() -> list[str]:
    text = PYI.read_text()
    return ASYNC_ARGS_JSON.findall(text)


def test_pyi_surface_is_present() -> None:
    names = pyi_async_client_methods()
    assert "mcp_dispatch" in names
    assert "mcp_oauth_request" in names
    assert "check_limits" in names
    assert len(names) == len(set(names))


def test_snake_to_camel_matches_wasm_bindgen_js_names() -> None:
    assert snake_to_camel("mcp_dispatch") == "mcpDispatch"
    assert snake_to_camel("mcp_oauth_request") == "mcpOauthRequest"
    assert snake_to_camel("mcp_call_builtin_tool") == "mcpCallBuiltinTool"
    assert snake_to_camel("check_limits") == "checkLimits"
    assert snake_to_camel("fetch_jwks") == "fetchJwks"


@pytest.mark.asyncio
async def test_wasm_client_forwards_every_pyi_async_method() -> None:
    seen: dict[str, str] = {}

    class FakeJs:
        def __getattr__(self, name: str) -> object:
            async def _fn(args_json: str) -> str:
                seen[name] = args_json
                return json.dumps({"ok": True, "value": {"via": name}})

            return _fn

    client = wasm_facade_api_client(FakeJs())
    for method in pyi_async_client_methods():
        fn = getattr(client, method)
        raw = await fn('{"x":1}')
        assert json.loads(raw)["ok"] is True
        assert seen[snake_to_camel(method)] == '{"x":1}'


def test_blocking_twins_are_not_exposed() -> None:
    client = WasmApiClient(object())
    with pytest.raises(AttributeError):
        _ = client.mcp_dispatch_blocking


def test_unwrap_ok_and_error() -> None:
    assert unwrap_wasm_envelope('{"ok":true,"value":{"a":1}}') == {"a": 1}
    with pytest.raises(WorkersSolvaPayError, match="nope") as caught:
        unwrap_wasm_envelope('{"ok":false,"error":{"message":"nope","status":402}}')
    assert caught.value.status == 402


def test_module_documents_interim_and_follow_up() -> None:
    import solvapay_mcp.workers as workers_mod

    source = inspect.getsource(workers_mod)
    assert "Interim" in source
    assert "pyodide-emscripten-wheel.md" in source
    assert "facade_api_client" in source
