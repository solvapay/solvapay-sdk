"""Runs the SDK conformance suite (conformance/cases) against this package.

Every case states what the TypeScript SDK, the reference, does. This runner
feeds the same input to the Python SDK and requires the same outcome. A case
whose ``fn`` has no mapping here fails: nothing is skipped.

Results are compared as canonical JSON text, not as Python objects: in Python
``True == 1`` and ``9000 == 9000.0``, which would hide differences on the wire.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
import respx
from mcp.types import CallToolResult

from solvapay import SolvaPayError, create_solvapay
from solvapay.mcp import create_solvapay_mcp_server, narrate_activate_plan, narrated_tool_result
from solvapay.mcp.intent import parse_mode
from solvapay.paywall import build_paywall_gate
from solvapay.webhooks import verify_webhook

CASES_DIR = Path(__file__).resolve().parents[2] / "conformance" / "cases"
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

Operation = Callable[[dict[str, Any], "datetime | None"], Any]


def narrate_account(args: dict[str, Any], clock: datetime | None) -> Any:
    result = narrated_tool_result(
        args["view"], args["payload"], parse_mode(args.get("mode")), now=clock
    )
    dumped = result.model_dump(by_alias=True, exclude_none=True, mode="json")
    return {"content": dumped["content"]}


CONFORMANCE_API = "https://api.conformance.test"
CONFORMANCE_PUBLIC_URL = "https://mcp.conformance.test"


def tool_outcome(result: CallToolResult) -> dict[str, Any]:
    """The result as the cases compare it: a text block holding JSON compares parsed, as
    ``json``, since key order is not part of what the widget reads."""
    dumped = result.model_dump(by_alias=True, exclude_none=True, mode="json")
    content = [
        {"type": "text", "json": json.loads(block["text"])}
        if block.get("type") == "text" and re.match(r"[\[{]", block.get("text", ""))
        else block
        for block in dumped["content"]
    ]
    outcome: dict[str, Any] = {"content": content}
    if "structuredContent" in dumped:
        outcome["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError"):
        outcome["isError"] = True
    return outcome


async def _call_tool(args: dict[str, Any]) -> dict[str, Any]:
    customer = args.get("customerRef")
    mcp = create_solvapay_mcp_server(
        solvapay=create_solvapay(
            api_key="sk_sandbox_conformance",
            api_base_url=CONFORMANCE_API,
            product_ref=args["productRef"],
        ),
        public_base_url=CONFORMANCE_PUBLIC_URL,
        get_customer_ref=lambda _args, _context: customer,
    )
    # Every exchange must be used, and nothing else may be called.
    with respx.mock(assert_all_called=True, assert_all_mocked=True) as router:
        for exchange in args.get("api", []):
            router.route(
                method=exchange["method"],
                scheme="https",
                host=CONFORMANCE_API.removeprefix("https://"),
                path=exchange["path"],
            ).respond(exchange.get("status", 200), json=exchange["body"])
        result = await mcp.server.call_tool(args["tool"], args.get("arguments", {}))
    assert isinstance(result, CallToolResult)
    return tool_outcome(result)


OPERATIONS: dict[str, Operation] = {
    "callTool": lambda args, _clock: asyncio.run(_call_tool(args)),
    "verifyWebhook": lambda args, clock: verify_webhook(
        body=args["body"], signature=args["signature"], secret=args["secret"], now=clock
    ),
    "buildPaywallGate": lambda args, _clock: build_paywall_gate(args["productRef"], args["limits"]),
    "narrateAccount": narrate_account,
    "narrateActivatePlan": lambda args, _clock: narrate_activate_plan(args["result"]),
}


def load_cases() -> list[tuple[str, dict[str, Any]]]:
    cases = []
    for suite_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        for file in sorted(suite_dir.iterdir()):
            where = f"{suite_dir.name}/{file.name}"
            if file.suffix != ".json":
                raise AssertionError(f"{where}: only .json files belong in a suite")
            data = json.loads(file.read_text(encoding="utf-8"))
            problems = []
            if data.get("suite") != suite_dir.name:
                problems.append("suite does not match the folder")
            if data.get("case") != file.stem or not NAME.match(file.stem):
                problems.append("case does not match the file name")
            if not str(data.get("description", "")).strip():
                problems.append("description is missing")
            if "expect" not in data:
                problems.append("expect is missing: record it with the TypeScript runner")
            if problems:
                raise AssertionError(f"{where}: {'; '.join(problems)}")
            cases.append((where, data))
    if not cases:
        raise AssertionError(f"No conformance cases found in {CASES_DIR}")
    return cases


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


def outcome_of(data: dict[str, Any]) -> dict[str, Any]:
    fn = data["input"]["fn"]
    if fn not in OPERATIONS:
        raise AssertionError(f'No Python mapping for fn "{fn}" in {__file__}')
    clock_text = data["input"].get("clock")
    clock = datetime.fromisoformat(clock_text.replace("Z", "+00:00")) if clock_text else None
    try:
        return {"result": OPERATIONS[fn](data["input"]["args"], clock)}
    except SolvaPayError as error:
        return {"error": {"code": error.code}}


CASES = load_cases()


@pytest.mark.parametrize(("where", "data"), CASES, ids=[where for where, _ in CASES])
def test_case(where: str, data: dict[str, Any]) -> None:
    actual = outcome_of(data)
    expected = data["expect"]
    assert canonical(actual) == canonical(expected), (
        f"{where}: {data['description']}\n"
        f"expected: {canonical(expected)}\n"
        f"actual:   {canonical(actual)}"
    )
