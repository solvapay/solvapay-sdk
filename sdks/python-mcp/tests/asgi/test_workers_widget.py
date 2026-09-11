from __future__ import annotations

import json

import httpx
import pytest

from solvapay_mcp.core import native_available
from solvapay_mcp.workers import build_workers_http_app

WIDGET_HTML = "<html>widget-fixture</html>"
RESOURCE_URI = "ui://cloudflare-workers-mcp/mcp-app.html"
API_BASE = "https://api-dev.solvapay.com"


class NativeSolvaPayModule:
    def solvapayCall(self, payload: str) -> str:
        from solvapay._solvapay import solvapay_call

        raw = solvapay_call(payload)
        if not isinstance(raw, str):
            raise TypeError("solvapay_call did not return JSON text")
        return raw


class RecordingWasmClient:
    def __init__(self, dispatch_envelope: dict[str, object] | None = None) -> None:
        self.dispatch_calls: list[str] = []
        self.track_calls: list[str] = []
        self._dispatch_envelope = dispatch_envelope or {
            "ok": True,
            "value": {
                "kind": "rpc",
                "rpc": {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {"contents": [{"uri": "docs://solvapay/overview.md", "text": "md"}]},
                },
            },
        }

    def mcpDispatch(self, args_json: str) -> str:
        self.dispatch_calls.append(args_json)
        return json.dumps(self._dispatch_envelope)

    def mcpOauthRequest(self, args_json: str) -> str:
        del args_json
        return json.dumps({"ok": True, "value": {"status": 200, "body": {"ok": True}}})

    def checkLimits(self, args_json: str) -> str:
        del args_json
        return json.dumps(
            {
                "ok": True,
                "value": {
                    "withinLimits": True,
                    "remaining": 5,
                    "meterName": "requests",
                    "checkoutUrl": "https://pay.example/x",
                },
            }
        )

    def trackUsage(self, args_json: str) -> str:
        self.track_calls.append(args_json)
        return json.dumps({"ok": True, "value": {"reference": "usg_demo", "outcome": "success"}})


def _app(
    js_client: object,
    *,
    js_module: object | None = None,
    payable_registry: object | None = None,
) -> object:
    return build_workers_http_app(
        js_client,
        js_module=js_module if js_module is not None else NativeSolvaPayModule(),
        widget_html=lambda: WIDGET_HTML,
        api_base_url=API_BASE,
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        resource_uri=RESOURCE_URI,
        payable_registry=payable_registry,
    )


@pytest.mark.skipif(not native_available(), reason="solvapay_call native binding is not installed")
async def test_workers_resources_read_splices_widget_html() -> None:
    client = RecordingWasmClient()
    transport = httpx.ASGITransport(app=_app(client))
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": {"uri": RESOURCE_URI},
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["contents"][0]["text"] == WIDGET_HTML
    csp = body["result"]["contents"][0]["_meta"]["ui"]["csp"]
    assert "resourceDomains" in csp
    assert API_BASE in csp["connectDomains"]
    assert client.dispatch_calls == []


@pytest.mark.skipif(not native_available(), reason="solvapay_call native binding is not installed")
async def test_workers_non_widget_resources_read_falls_through() -> None:
    client = RecordingWasmClient()
    transport = httpx.ASGITransport(app=_app(client))
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "resources/read",
                "params": {"uri": "docs://solvapay/overview.md"},
            },
        )
    assert response.status_code == 200
    assert client.dispatch_calls
    payload = json.loads(client.dispatch_calls[0])
    assert payload["rpc"]["params"]["uri"] == "docs://solvapay/overview.md"
    assert payload["config"]["apiBaseUrl"] == API_BASE
    assert response.json()["result"]["contents"][0]["text"] == "md"


async def test_workers_wasm_error_is_jsonrpc_not_500() -> None:
    client = RecordingWasmClient(
        {
            "ok": False,
            "error": {"message": "dispatch boom", "code": "transport"},
        }
    )
    transport = httpx.ASGITransport(app=_app(client))
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["error"]["code"] == -32603
    assert body["error"]["message"] == "dispatch boom"


def _ok(value: object) -> str:
    return json.dumps({"ok": True, "value": value})


class ScriptedPayableModule:
    def __init__(self, *, paywall: bool = False) -> None:
        self.paywall = paywall

    def resolveCustomerRef(self, args_json: str) -> str:
        args = json.loads(args_json)
        return _ok(args.get("argsCustomerRef") or "cus_1")

    def buildCustomerSnapshot(self, args_json: str) -> str:
        args = json.loads(args_json)
        return _ok(
            {
                "customer_ref": args.get("customerRef"),
                "throttled": False,
                "overage": False,
            }
        )

    def makeResponseResult(self, args_json: str) -> str:
        args = json.loads(args_json)
        return _ok({"__solvapayResponse": True, "data": args.get("data")})

    def assertResponseResult(self, args_json: str) -> str:
        args = json.loads(args_json)
        return _ok(args.get("value"))

    def evaluateClaimedLimits(self, args_json: str) -> str:
        args = json.loads(args_json)
        return _ok(
            {
                "withinLimits": args.get("withinLimits"),
                "remaining": args.get("remaining"),
            }
        )

    def gateNext(self, args_json: str) -> str:
        args = json.loads(args_json)
        event = args.get("event") or {}
        if event.get("kind") != "start":
            raise AssertionError(event)
        if self.paywall:
            return _ok(
                {
                    "state": {},
                    "action": {
                        "kind": "gate",
                        "customerRef": "cus_1",
                        "limits": {},
                        "gate": {"message": "Payment required", "checkoutUrl": "https://pay.example"},
                    },
                }
            )
        return _ok(
            {
                "state": {},
                "action": {
                    "kind": "allow",
                    "customerRef": "cus_1",
                    "requestId": "req_1",
                    "limits": {"withinLimits": True, "remaining": 5},
                },
            }
        )

    def invokePayableNext(self, args_json: str) -> str:
        args = json.loads(args_json)
        event = args.get("event") or {}
        kind = event.get("kind")
        if kind == "start":
            return _ok(
                {
                    "state": {"s": 1},
                    "action": {
                        "kind": "runGate",
                        "customerRef": "cus_1",
                        "product": "prd_demo",
                        "usageType": "requests",
                    },
                }
            )
        if kind == "gateAllow":
            return _ok(
                {
                    "state": {"s": 2},
                    "action": {
                        "kind": "invokeHandler",
                        "customerRef": "cus_1",
                        "limits": {"withinLimits": True, "remaining": 5},
                    },
                }
            )
        if kind == "gatePaywall":
            return _ok(
                {
                    "state": {"s": 3},
                    "action": {
                        "kind": "done",
                        "result": {
                            "isError": True,
                            "content": [{"type": "text", "text": event.get("message")}],
                        },
                    },
                }
            )
        if kind == "handlerOk":
            return _ok(
                {
                    "state": {"s": 4},
                    "action": {
                        "kind": "done",
                        "result": {"structuredContent": {"ok": True}},
                        "track": {"request": {"customerRef": "cus_1", "productRef": "prd_demo"}},
                    },
                }
            )
        if kind == "handlerErr":
            return _ok(
                {
                    "state": {"s": 5},
                    "action": {
                        "kind": "done",
                        "result": {
                            "isError": True,
                            "content": [{"type": "text", "text": event.get("message")}],
                        },
                    },
                }
            )
        raise AssertionError(kind)

    def solvapayCall(self, payload: str) -> str:
        data = json.loads(payload)
        if data.get("op") == "mcpResume":
            envelope = data["args"]["handlerEnvelope"]
            return _ok({"rpc": {"jsonrpc": "2.0", "id": 9, "result": envelope}})
        if data.get("op") == "mcpWidgetResource":
            return json.dumps({"ok": True, "value": None})
        raise AssertionError(data.get("op"))


def _echo_registry(*, boom: bool = False):
    from solvapay_mcp.workers_payable import WorkersPayableRegistry, register_workers_payable

    registry = WorkersPayableRegistry()

    async def echo(args: dict[str, object], ctx: object) -> object:
        if boom:
            raise RuntimeError("handler exploded")
        return ctx.respond({"echo": args})

    register_workers_payable(
        registry,
        "echo_paid",
        product="prd_demo",
        handler=echo,
    )
    return registry


def _invoke_client() -> RecordingWasmClient:
    return RecordingWasmClient(
        {
            "ok": True,
            "value": {
                "kind": "invokeHandler",
                "tool": "echo_paid",
                "token": "tok",
                "args": {"hello": "world"},
                "customerRef": "cus_1",
            },
        }
    )


async def test_workers_invoke_handler_allow() -> None:
    client = _invoke_client()
    transport = httpx.ASGITransport(
        app=_app(client, js_module=ScriptedPayableModule(), payable_registry=_echo_registry())
    )
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {"name": "echo_paid", "arguments": {"hello": "world"}},
            },
        )
    assert response.status_code == 200
    assert response.json()["result"]["structuredContent"] == {"ok": True}
    assert client.track_calls


async def test_workers_invoke_handler_paywall_gate() -> None:
    client = _invoke_client()
    transport = httpx.ASGITransport(
        app=_app(
            client,
            js_module=ScriptedPayableModule(paywall=True),
            payable_registry=_echo_registry(),
        )
    )
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {"name": "echo_paid", "arguments": {}},
            },
        )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is True
    assert client.track_calls == []


async def test_workers_invoke_handler_error() -> None:
    client = _invoke_client()
    transport = httpx.ASGITransport(
        app=_app(
            client,
            js_module=ScriptedPayableModule(),
            payable_registry=_echo_registry(boom=True),
        )
    )
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {"name": "echo_paid", "arguments": {}},
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["isError"] is True
    assert "handler exploded" in body["result"]["content"][0]["text"]
