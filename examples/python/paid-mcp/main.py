from __future__ import annotations

import argparse
import json
from typing import Any

from mcp.client import Client
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay
from solvapay_mcp import ResponseContext, register_payable_tool


class _MockClient:
    def __init__(self, *, within_limits: bool) -> None:
        self.within_limits = within_limits
        self.tracked: list[dict[str, Any]] = []

    async def check_limits(self, args_json: str) -> str:
        return self.check_limits_blocking(args_json)

    def check_limits_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps(
            {
                "ok": True,
                "value": {
                    "withinLimits": self.within_limits,
                    "remaining": 5 if self.within_limits else 0,
                    "meterName": "requests",
                    "checkoutUrl": "https://pay.example/x",
                },
            }
        )

    async def track_usage(self, args_json: str) -> str:
        return self.track_usage_blocking(args_json)

    def track_usage_blocking(self, args_json: str) -> str:
        self.tracked.append(json.loads(args_json))
        return json.dumps({"ok": True, "value": {"ok": True}})

    async def get_customer(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)

    def get_customer_blocking(self, args_json: str) -> str:
        params = json.loads(args_json)
        ref = params.get("customerRef") or "cus_demo"
        return json.dumps({"ok": True, "value": {"customerRef": ref}})

    async def create_customer(self, args_json: str) -> str:
        return self.create_customer_blocking(args_json)

    def create_customer_blocking(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)


async def run_echo(*, within_limits: bool, message: str) -> dict[str, Any]:
    client = _MockClient(within_limits=within_limits)
    solvapay = create_solvapay(api_client=client)
    server: Server[Any] = Server("paid-mcp-example")

    async def echo(args: dict[str, Any], ctx: ResponseContext) -> object:
        return ctx.respond({"echo": args.get("text", message)})

    async def customer_ref(_args: dict[str, Any]) -> str:
        return "cus_demo"

    register_payable_tool(
        server,
        "echo_paid",
        solvapay=solvapay,
        product="prd_demo",
        title="Echo paid",
        handler=echo,
        get_customer_ref=customer_ref,
    )
    async with Client(server) as mcp_client:
        result = await mcp_client.call_tool("echo_paid", {"text": message})
    dumped = result.model_dump(by_alias=True, exclude_none=True)
    projected: dict[str, Any] = {"content": dumped["content"]}
    if "structuredContent" in dumped:
        projected["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError") is True:
        projected["isError"] = True
    elif dumped.get("isError") is False:
        projected["isError"] = False
    return projected


def main() -> None:
    parser = argparse.ArgumentParser(description="Paid MCP echo example")
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--message", default="hello")
    args = parser.parse_args()
    import asyncio

    dumped = asyncio.run(run_echo(within_limits=not args.gate, message=args.message))
    print(json.dumps(dumped, indent=2))


if __name__ == "__main__":
    main()
