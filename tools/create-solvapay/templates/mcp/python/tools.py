from __future__ import annotations

from mcp.server.lowlevel.server import Server
from solvapay.facade import SolvaPay
from solvapay_mcp import ResponseContext, register_payable_tool


def register_tools(server: Server[object], *, solvapay: SolvaPay, product: str) -> None:
    async def placeholder(args: dict[str, object], ctx: ResponseContext) -> object:
        message = args.get("message")
        echoed = message if isinstance(message, str) else "hello"
        return ctx.respond(
            {"ok": True, "echoed": echoed},
            {"text": "__TOOL_NAME__ ran (placeholder). Replace this tool with your business logic."},
        )

    register_payable_tool(
        server,
        "__TOOL_NAME__",
        solvapay=solvapay,
        product=product,
        title="__TOOL_NAME__",
        description=(
            "Placeholder paid tool — echoes the input message so you can verify "
            "the paywall is wired before writing real logic."
        ),
        input_schema={
            "type": "object",
            "properties": {"message": {"type": "string"}},
        },
        handler=placeholder,
    )
