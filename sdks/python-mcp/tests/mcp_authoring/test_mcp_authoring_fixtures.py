from __future__ import annotations

import json
from pathlib import Path

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
    "customer-ref/from-hook.json",
    "customer-ref/from-tool-args.json",
    "error/handler-throws.json",
    "gate/activation-required.json",
    "gate/handler-invoked.json",
    "gate/payment-required.json",
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


@pytest.mark.parametrize("rel", MCP_AUTHORING_FIXTURES)
def test_fixture_round_trips_strict_schema(rel: str) -> None:
    raw = _load_fixture(lookup_mcp_fixtures(), rel)
    assert raw["input"]["fn"] == "registerPayable"
    parse_scenario(raw["input"]["args"])
    parse_observation(raw["expect"]["result"])


@pytest.mark.parametrize("rel", MCP_AUTHORING_FIXTURES)
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
