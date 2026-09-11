from __future__ import annotations

import json
from typing import Any


def backend_ref(identity: str) -> str:
    return identity if identity.startswith("cus_") else f"cus_{identity}"


class MockBackend:
    def __init__(self, limits: dict[str, Any]) -> None:
        self.limits = limits
        self.track_usage_calls: list[dict[str, Any]] = []

    async def check_limits(self, args_json: str) -> str:
        return self.check_limits_blocking(args_json)

    def check_limits_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps({"ok": True, "value": self.limits})

    async def track_usage(self, args_json: str) -> str:
        return self.track_usage_blocking(args_json)

    def track_usage_blocking(self, args_json: str) -> str:
        self.track_usage_calls.append(json.loads(args_json))
        return json.dumps({"ok": True, "value": {"ok": True}})

    async def get_customer(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)

    def get_customer_blocking(self, args_json: str) -> str:
        params = json.loads(args_json)
        ref = params.get("customerRef") or params.get("externalRef") or params.get("email") or "new"
        return json.dumps({"ok": True, "value": {"customerRef": backend_ref(str(ref))}})

    async def create_customer(self, args_json: str) -> str:
        return self.create_customer_blocking(args_json)

    def create_customer_blocking(self, args_json: str) -> str:
        params = json.loads(args_json)
        ref = params.get("externalRef") or params.get("email") or "new"
        return json.dumps({"ok": True, "value": {"customerRef": backend_ref(str(ref))}})


def project_usage(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    projected: list[dict[str, Any]] = []
    for call in calls:
        metadata = call.get("metadata") if isinstance(call.get("metadata"), dict) else {}
        if "duration" not in call:
            raise AssertionError("trackUsage call missing duration")
        if "timestamp" not in call:
            raise AssertionError("trackUsage call missing timestamp")
        if "requestId" not in metadata:
            raise AssertionError("trackUsage call missing metadata.requestId")
        projected.append(
            {
                "outcome": call.get("outcome"),
                "actionType": call.get("actionType"),
                "units": call.get("units"),
                "productRef": call.get("productRef"),
                "customerRef": call.get("customerRef"),
                "metadata": {"action": metadata.get("action")},
            }
        )
    return projected
