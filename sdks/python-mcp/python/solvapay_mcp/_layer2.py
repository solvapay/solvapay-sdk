from __future__ import annotations

import json
from collections.abc import Mapping

from solvapay._native import call_native_sync


def _as_object_map(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError("native call returned unexpected value")
    return {str(k): v for k, v in value.items()}


def _call(name: str, args: Mapping[str, object]) -> object:
    return call_native_sync(name, json.dumps(dict(args)))


def paywall_tool_result(message: str, gate: Mapping[str, object]) -> dict[str, object]:
    return _as_object_map(
        _call(
            "paywall_tool_result",
            {"message": message, "structuredContent": dict(gate)},
        )
    )


def make_response_result(
    data: object,
    options: Mapping[str, object] | None,
    emitted_blocks: list[dict[str, object]],
) -> dict[str, object]:
    args: dict[str, object] = {"data": data}
    if options is not None:
        args["options"] = dict(options)
    if emitted_blocks:
        args["emittedBlocks"] = emitted_blocks
    return _as_object_map(_call("make_response_result", args))


def assert_response_result(value: object) -> dict[str, object]:
    return _as_object_map(_call("assert_response_result", {"value": value}))


def build_payable_tool_result(envelope: Mapping[str, object]) -> dict[str, object]:
    return _as_object_map(
        _call("build_payable_tool_result", {"envelope": dict(envelope)})
    )
