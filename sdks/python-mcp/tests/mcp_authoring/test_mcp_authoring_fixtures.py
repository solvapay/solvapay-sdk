from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest

from solvapay_mcp.register import set_format_gate_override
from tests.mcp_authoring.driver import call_registered_payable
from tests.mcp_authoring.mock_backend import MockBackend, project_usage
from tests.mcp_authoring.repo_paths import lookup_mcp_fixtures
from tests.mcp_authoring.scenario import parse_observation, parse_scenario

MCP_AUTHORING_FIXTURES = [
    "allow/respond-emitted-blocks.json",
    "allow/respond-key-order.json",
    "allow/respond-minimal.json",
    "allow/respond-nudge.json",
    "allow/respond-text-option.json",
    "auth-gate/allow-initialize.json",
    "auth-gate/allow-tools-call-with-bearer.json",
    "auth-gate/challenge-tools-call.json",
    "bootstrap/unauthenticated.json",
    "builtin-tools/activate-plan-no-ref.json",
    "builtin-tools/activate-plan.json",
    "builtin-tools/attach-business-details-unauth.json",
    "builtin-tools/attach-business-details.json",
    "builtin-tools/cancel-renewal-unauth.json",
    "builtin-tools/cancel-renewal.json",
    "builtin-tools/create-checkout-session-unauth.json",
    "builtin-tools/create-checkout-session.json",
    "builtin-tools/create-customer-session-unauth.json",
    "builtin-tools/create-customer-session.json",
    "builtin-tools/create-payment-intent-unauth.json",
    "builtin-tools/create-payment-intent.json",
    "builtin-tools/create-topup-payment-intent-unauth.json",
    "builtin-tools/create-topup-payment-intent.json",
    "builtin-tools/manage-account.json",
    "builtin-tools/process-payment-unauth.json",
    "builtin-tools/process-payment.json",
    "builtin-tools/reactivate-renewal-unauth.json",
    "builtin-tools/reactivate-renewal.json",
    "builtin-tools/topup.json",
    "builtin-tools/upgrade.json",
    "config-log/once.json",
    "csp/default.json",
    "csp/with-api-origin.json",
    "customer-ref/from-hook.json",
    "customer-ref/from-tool-args.json",
    "dcr/generic-reject.json",
    "dcr/unresolved-product.json",
    "descriptors/default-all-views.json",
    "descriptors/views-checkout-only.json",
    "dispatch/challenge.json",
    "dispatch/invoke-handler.json",
    "dispatch/rpc.json",
    "engine/gate-denied.json",
    "engine/initialize.json",
    "engine/invoke-handler.json",
    "engine/tools-list.json",
    "error/handler-throws.json",
    "gate/activation-required.json",
    "gate/handler-invoked.json",
    "gate/payment-required.json",
    "hide-tools/bypass-chatgpt.json",
    "hide-tools/filter-ui-audience.json",
    "narrate/activate-plan.json",
    "narrate/manage-account-active.json",
    "narrate/manage-account.json",
    "narrate/mode-auto.json",
    "narrate/mode-text.json",
    "narrate/mode-ui.json",
    "narrate/placeholder.json",
    "narrate/topup.json",
    "narrate/upgrade.json",
    "oauth-proxy/authorize.json",
    "oauth-proxy/discovery-authorization-server.json",
    "oauth-proxy/discovery-post-405.json",
    "oauth-proxy/discovery-protected-resource.json",
    "oauth-proxy/openid-404.json",
    "oauth-proxy/paths-override.json",
    "oauth-proxy/register-502.json",
    "oauth-proxy/token-502.json",
    "oauth/discovery-authorization-server.json",
    "oauth/discovery-protected-resource-mcp-path.json",
    "oauth/discovery-protected-resource.json",
    "oauth/normalize-nestjs-401.json",
    "oauth/normalize-rfc-passthrough.json",
    "overview/resource.json",
]

REGISTER_PAYABLE_FIXTURES = [
    rel
    for rel in MCP_AUTHORING_FIXTURES
    if rel.startswith(("allow/", "customer-ref/", "error/", "gate/"))
]

CORE_OP_FIXTURES = [
    rel
    for rel in MCP_AUTHORING_FIXTURES
    if not rel.startswith(
        (
            "allow/",
            "customer-ref/",
            "error/",
            "gate/",
            "bootstrap/",
            "builtin-tools/",
            "oauth-proxy/",
            "dispatch/",
        )
    )
]

ASYNC_OP_FIXTURES = [
    rel
    for rel in MCP_AUTHORING_FIXTURES
    if rel.startswith(("bootstrap/", "builtin-tools/", "oauth-proxy/", "dispatch/"))
]


def _discover(root: Path) -> list[str]:
    files = [p for p in root.rglob("*.json") if p.is_file()]
    rel = [str(p.relative_to(root)).replace("\\", "/") for p in files]
    return sorted(rel)


def _load_fixture(root: Path, rel: str) -> dict[str, object]:
    return json.loads((root / rel).read_text())


def test_discovers_the_frozen_fixture_list() -> None:
    root = lookup_mcp_fixtures()
    assert _discover(root) == MCP_AUTHORING_FIXTURES


@pytest.mark.parametrize("rel", REGISTER_PAYABLE_FIXTURES)
def test_fixture_round_trips_strict_schema(rel: str) -> None:
    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    assert raw["input"]["fn"] == "registerPayable"
    parse_scenario(raw["input"]["args"])
    parse_observation(raw["expect"]["result"])


@pytest.mark.parametrize("rel", REGISTER_PAYABLE_FIXTURES)
@pytest.mark.asyncio
async def test_replays_fixture(rel: str) -> None:
    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    scenario = parse_scenario(raw["input"]["args"])
    observation = parse_observation(raw["expect"]["result"])
    backend = MockBackend(scenario.limits.model_dump(exclude_none=True))
    tool_result = await call_registered_payable(backend, scenario)
    usage = project_usage(backend.track_usage_calls)
    assert tool_result == observation.toolResult.model_dump(by_alias=True, exclude_none=True)
    assert usage == [item.model_dump() for item in observation.usage]


@pytest.mark.parametrize(
    "rel",
    [
        "gate/payment-required.json",
        "gate/activation-required.json",
        "gate/handler-invoked.json",
    ],
)
@pytest.mark.asyncio
async def test_adapter_authored_gate_copy_fails_fixtures(rel: str) -> None:
    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    scenario = parse_scenario(raw["input"]["args"])
    observation = parse_observation(raw["expect"]["result"])
    backend = MockBackend(scenario.limits.model_dump(exclude_none=True))

    def adapter_authored(_message: str, _gate: dict[str, object]) -> dict[str, object]:
        return {
            "content": [{"type": "text", "text": "adapter-authored"}],
            "isError": False,
            "structuredContent": {"kind": "payment_required"},
        }

    set_format_gate_override(adapter_authored)
    try:
        tool_result = await call_registered_payable(backend, scenario)
    finally:
        set_format_gate_override(None)
    assert tool_result["content"] == [{"type": "text", "text": "adapter-authored"}]
    expected = observation.toolResult.model_dump(by_alias=True, exclude_none=True)
    assert tool_result != expected


@pytest.mark.parametrize("rel", CORE_OP_FIXTURES)
def test_replays_core_op(rel: str) -> None:
    from solvapay_mcp.core import call, native_available

    assert native_available(), "solvapay_call native binding is not installed"
    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    fn = raw["input"]["fn"]
    args = raw["input"].get("args") or {}
    expect = raw["expect"]["result"]
    got = call(str(fn), args if isinstance(args, dict) else {})
    if fn == "mcpHandleRequest" and str(rel).endswith("tools-list.json"):
        assert isinstance(got, dict)
        assert got["kind"] == "rpc"
        assert len(got["rpc"]["result"]["tools"]) >= 8
        return
    if fn == "mcpHandleRequest" and str(rel).endswith("invoke-handler.json"):
        assert isinstance(got, dict) and isinstance(expect, dict)
        assert got["kind"] == "invokeHandler"
        assert got["tool"] == expect["tool"]
        assert got["args"] == expect["args"]
        assert got["customerRef"] == expect["customerRef"]
        assert isinstance(got["token"], str) and len(got["token"]) > 8
        return
    assert got == expect


def _default_bootstrap_stubs() -> list[dict[str, object]]:
    return [
        {
            "method": "GET",
            "path": "/v1/sdk/platform-config",
            "status": 200,
            "body": {"stripePublishableKey": "pk_test"},
        },
        {"method": "GET", "path": "/v1/sdk/merchant", "status": 200, "body": {"displayName": "Acme"}},
        {"method": "GET", "path": "/v1/sdk/products/prd_demo", "status": 200, "body": {"name": "Demo"}},
        {
            "method": "GET",
            "path": "/v1/sdk/products/prd_demo/plans",
            "status": 200,
            "body": {"plans": [{"name": "Pro"}]},
        },
    ]


class _StubServer:
    def __init__(self, stubs: list[dict[str, object]]) -> None:
        routes = {(str(s.get("method") or "GET"), str(s["path"])): s for s in stubs}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                self._serve("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._serve("POST")

            def _serve(self, method: str) -> None:
                path = self.path.split("?", 1)[0]
                stub = routes.get((method, path))
                if stub is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.dumps(stub.get("body") or {}).encode()
                self.send_response(int(stub.get("status") or 200))
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self._httpd.server_address[1]}"
        self._thread = Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


def _assert_async(rel: str, fn: str, got: object, expect: object) -> None:
    if fn == "mcpOauthRequest":
        assert isinstance(got, dict) and isinstance(expect, dict)
        assert got.get("status") == expect.get("status")
        assert got.get("body") == expect.get("body")
        if "authorize" in rel:
            headers = got.get("headers") if isinstance(got.get("headers"), dict) else {}
            loc = str(headers.get("location") or "")
            assert loc.endswith("/v1/customer/auth/authorize?client_id=abc"), loc
            return
        want_headers = expect.get("headers")
        if isinstance(want_headers, dict):
            got_headers = got.get("headers")
            assert isinstance(got_headers, dict)
            for key, value in want_headers.items():
                assert got_headers.get(key) == value
        return
    if fn == "mcpDispatch" and rel.endswith("invoke-handler.json"):
        assert isinstance(got, dict) and isinstance(expect, dict)
        assert got.get("kind") == expect.get("kind")
        assert got.get("tool") == expect.get("tool")
        assert got.get("args") == expect.get("args")
        assert got.get("customerRef") == expect.get("customerRef")
        assert isinstance(got.get("token"), str) and len(str(got.get("token"))) > 8
        return
    assert got == expect


@pytest.mark.parametrize("rel", ASYNC_OP_FIXTURES)
def test_replays_async_op(rel: str) -> None:
    from solvapay._native import unwrap_envelope
    from solvapay._solvapay import SolvaPayClient

    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    input_block = raw["input"] if isinstance(raw["input"], dict) else {}
    fn = str(input_block.get("fn"))
    args = input_block.get("args") if isinstance(input_block.get("args"), dict) else {}
    expect = raw["expect"]["result"] if isinstance(raw["expect"], dict) else None
    unreachable = (
        isinstance(expect, dict)
        and expect.get("status") == 502
        and isinstance(expect.get("body"), dict)
        and expect["body"].get("error") == "upstream_unreachable"
    )
    stubs = raw.get("http") if isinstance(raw.get("http"), list) else []
    if fn == "mcpBootstrap" and not stubs:
        stubs = _default_bootstrap_stubs()
    server: _StubServer | None = None
    base = "http://127.0.0.1:1"
    if not unreachable:
        server = _StubServer([s for s in stubs if isinstance(s, dict)])
        base = server.url
    try:
        client = SolvaPayClient("sk_test_fixture", base)
        method = {
            "mcpCallBuiltinTool": client.mcp_call_builtin_tool_blocking,
            "mcpOauthRequest": client.mcp_oauth_request_blocking,
            "mcpDispatch": client.mcp_dispatch_blocking,
            "mcpBootstrap": client.mcp_bootstrap_blocking,
        }[fn]
        got = unwrap_envelope(method(json.dumps(args)))
        _assert_async(rel, fn, got, expect)
    finally:
        if server is not None:
            server.close()
