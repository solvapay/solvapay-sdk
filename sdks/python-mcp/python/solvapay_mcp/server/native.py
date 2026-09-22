from __future__ import annotations

import json
from collections.abc import Mapping

from solvapay._native import call_native_sync, unwrap_envelope
from solvapay.errors import SolvaPayError


def native_call(name: str, args: Mapping[str, object] | None = None) -> object:
    return call_native_sync(name, json.dumps(dict(args or {})))


def unwrap_client_envelope(envelope_json: str) -> object:
    return unwrap_envelope(envelope_json)


def is_error_result(value: object) -> bool:
    result = native_call("is_error_result", {"result": value})
    return bool(result)


def handle_route_error(
    error: object,
    operation_name: str,
    default_message: str | None = None,
) -> dict[str, object]:
    if isinstance(error, SolvaPayError):
        mapped = native_call(
            "map_route_error",
            {
                "kind": "solvapay",
                "message": str(error),
                "status": getattr(error, "status", None),
                "operationName": operation_name,
                "defaultMessage": default_message,
            },
        )
    elif isinstance(error, Exception):
        mapped = native_call(
            "map_route_error",
            {
                "kind": "error",
                "message": str(error),
                "operationName": operation_name,
                "defaultMessage": default_message,
            },
        )
    else:
        mapped = native_call(
            "map_route_error",
            {
                "kind": "unknown",
                "message": None,
                "operationName": operation_name,
                "defaultMessage": default_message,
            },
        )
    if not isinstance(mapped, dict):
        raise TypeError("map_route_error returned unexpected value")
    return {str(k): v for k, v in mapped.items()}
