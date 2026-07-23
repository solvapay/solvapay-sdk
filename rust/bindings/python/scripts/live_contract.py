#!/usr/bin/env python3
"""Step 42 — live Python contract driver (stdlib-only).

Mirrors `.github/workflows/shadow.yml` / `pnpm shadow:run`, but drives the
Python native client only against a real backend.

Env:
  SOLVAPAY_SHADOW_BASE_URL   required
  SOLVAPAY_SHADOW_API_KEY    required
  SOLVAPAY_SHADOW_ENABLE_STRIPE  optional (`true` / `1`) to run requires:stripe
  SOLVAPAY_LIVE_OUT          optional report path (default: contract/shadow/output/python-live-report.json)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from solvapay._native import unwrap_envelope
from solvapay._solvapay import SolvaPayClient
from solvapay.errors import PaywallError, SolvaPayError

REPO_ROOT = Path(__file__).resolve().parents[4]  # rust/bindings/python/scripts → repo
DEFAULT_OUT = REPO_ROOT / "contract" / "shadow" / "output" / "python-live-report.json"

Requires = Literal["stripe", "activePurchase"]


@dataclass(frozen=True)
class Scenario:
    id: str
    op: str
    args: dict[str, Any]
    requires: Requires | None = None
    expect_error: bool = False
    skip_reason: str | None = None


# Port of contract/shadow/scenarios.ts — keep dependency order (setup first, deletes last).
SCENARIOS: list[Scenario] = [
    Scenario("getMerchant", "getMerchant", {}),
    Scenario("getPlatformConfig", "getPlatformConfig", {}),
    Scenario(
        "createProduct",
        "createProduct",
        {"name": "Shadow Product Scenario {sideTag}", "config": {}, "metadata": {}},
    ),
    Scenario("listProducts", "listProducts", {}),
    Scenario("getProduct", "getProduct", {"productRef": "{productRef}"}),
    Scenario(
        "updateProduct",
        "updateProduct",
        {"productRef": "{productRef}", "name": "Shadow Product Updated {sideTag}"},
    ),
    Scenario(
        "cloneProduct",
        "cloneProduct",
        {"productRef": "{productRef}", "name": "Shadow Product Clone {sideTag}"},
        # Sandbox currently rejects clone without providerId (structured 500).
        # Dual-side shadow treats matching errors as IDENTICAL; single-side live
        # asserts the structured error path instead of success.
        expect_error=True,
    ),
    Scenario(
        "bootstrapMcpProduct",
        "bootstrapMcpProduct",
        {"originUrl": "https://mcp.shadow.example.com", "metadata": {}},
        # Unreachable origin — intentional error-shape probe (TS catalog comment).
        expect_error=True,
    ),
    Scenario(
        "configureMcpPlans",
        "configureMcpPlans",
        {"productRef": "{productRef}", "plans": []},
        # Setup product is not MCP — backend returns NOT_MCP_PRODUCT.
        expect_error=True,
    ),
    Scenario(
        "createPlan",
        "createPlan",
        {
            "productRef": "{productRef}",
            "name": "Shadow Plan",
            "type": "recurring",
            "billingCycle": "monthly",
            "price": 1000,
            "currency": "usd",
        },
    ),
    Scenario("listPlans", "listPlans", {"productRef": "{productRef}"}),
    Scenario(
        "updatePlan",
        "updatePlan",
        {"productRef": "{productRef}", "planRef": "{planRef}", "name": "Shadow Plan Updated"},
    ),
    Scenario(
        "createCustomer",
        "createCustomer",
        {"email": "shadow-create-{sideTag}@example.com"},
    ),
    Scenario("getCustomer", "getCustomer", {"customerRef": "{customerRef}"}),
    Scenario(
        "updateCustomer",
        "updateCustomer",
        {"customerRef": "{customerRef}", "name": "Shadow Customer"},
    ),
    Scenario("assignCredits", "assignCredits", {"customerRef": "{customerRef}", "credits": 25}),
    Scenario("getCustomerBalance", "getCustomerBalance", {"customerRef": "{customerRef}"}),
    Scenario(
        "getUserInfo",
        "getUserInfo",
        {"customerRef": "{customerRef}", "productRef": "{productRef}"},
    ),
    Scenario(
        "checkLimits",
        "checkLimits",
        {"customerRef": "{customerRef}", "productRef": "{productRef}"},
    ),
    Scenario(
        "trackUsage",
        "trackUsage",
        {"customerRef": "{customerRef}", "actionType": "api_call", "units": 1},
    ),
    Scenario(
        "trackUsageBulk",
        "trackUsageBulk",
        {
            "events": [
                {"customerRef": "{customerRef}", "actionType": "api_call", "units": 1},
            ]
        },
    ),
    Scenario(
        "createCheckoutSession",
        "createCheckoutSession",
        {"productRef": "{productRef}", "customerRef": "{customerRef}"},
    ),
    Scenario(
        "createCustomerSession",
        "createCustomerSession",
        {"customerRef": "{customerRef}"},
    ),
    Scenario(
        "activatePlan",
        "activatePlan",
        {
            "customerRef": "{customerRef}",
            "productRef": "{productRef}",
            "planRef": "{planRef}",
        },
    ),
    Scenario(
        "createPaymentIntent",
        "createPaymentIntent",
        {
            "productRef": "{productRef}",
            "planRef": "{planRef}",
            "customerRef": "{customerRef}",
        },
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "createTopupPaymentIntent",
        "createTopupPaymentIntent",
        {
            "customerRef": "{customerRef}",
            "productRef": "{productRef}",
            "amount": 500,
            "currency": "USD",
        },
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "processPaymentIntent",
        "processPaymentIntent",
        {
            "processorPaymentId": "{paymentIntentId}",
            "customerRef": "{customerRef}",
        },
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "attachBusinessDetails",
        "attachBusinessDetails",
        {
            "paymentIntentId": "{paymentIntentId}",
            "businessName": "Shadow Co",
            "country": "US",
        },
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "cancelPurchase",
        "cancelPurchase",
        {"purchaseRef": "{purchaseRef}"},
        requires="activePurchase",
        skip_reason="requires: activePurchase",
    ),
    Scenario(
        "reactivatePurchase",
        "reactivatePurchase",
        {"purchaseRef": "{purchaseRef}"},
        requires="activePurchase",
        skip_reason="requires: activePurchase",
    ),
    Scenario(
        "getPaymentMethod",
        "getPaymentMethod",
        {"customerRef": "{customerRef}"},
        requires="stripe",
        skip_reason="requires: stripe (Stripe customer)",
    ),
    Scenario(
        "getAutoRecharge",
        "getAutoRecharge",
        {"customerRef": "{customerRef}"},
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "saveAutoRecharge",
        "saveAutoRecharge",
        {
            "customerRef": "{customerRef}",
            "enabled": True,
            "threshold": 100,
            "topupAmount": 500,
        },
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "disableAutoRecharge",
        "disableAutoRecharge",
        {"customerRef": "{customerRef}"},
        requires="stripe",
        skip_reason="requires: stripe",
    ),
    Scenario(
        "getProduct-bogus",
        "getProduct",
        {"productRef": "prd_shadow_does_not_exist_zzzz"},
        expect_error=True,
    ),
    Scenario(
        "getCustomer-bogus",
        "getCustomer",
        {"customerRef": "cus_shadow_does_not_exist_zzzz"},
        expect_error=True,
    ),
    Scenario(
        "deletePlan",
        "deletePlan",
        {"productRef": "{productRef}", "planRef": "{planRef}"},
    ),
    Scenario(
        "deleteProduct",
        "deleteProduct",
        {"productRef": "{productRef}"},
    ),
]

VOLATILE_KEYS = {
    "id",
    "reference",
    "createdAt",
    "updatedAt",
    "created",
    "updated",
    "idempotencyKey",
    "clientSecret",
    "secret",
    "token",
    "url",
    "checkoutUrl",
    "sessionUrl",
}
VOLATILE_SUFFIXES = ("At", "Url", "Ref", "Id", "Secret", "Token")


def camel_to_snake(value: str) -> str:
    out: list[str] = []
    for index, char in enumerate(value):
        if char.isupper() and index > 0 and (value[index - 1].islower() or value[index - 1].isdigit()):
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def resolve_args(template: dict[str, Any], refs: dict[str, str]) -> dict[str, Any]:
    def walk(value: Any) -> Any:
        if isinstance(value, str):
            out = value
            for key, replacement in refs.items():
                out = out.replace("{" + key + "}", replacement)
            return out
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            return {k: walk(v) for k, v in value.items()}
        return value

    return walk(template)  # type: ignore[return-value]


def extract_ref(value: Any, keys: list[str]) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    for nest in ("product", "plan", "customer"):
        nested = value.get(nest)
        found = extract_ref(nested, keys)
        if found:
            return found
    return None


def normalize(value: Any) -> Any:
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, child in value.items():
            if key in VOLATILE_KEYS or any(key.endswith(suffix) for suffix in VOLATILE_SUFFIXES):
                continue
            if child is None:
                continue
            out[key] = normalize(child)
        return out
    return value


def invoke(client: SolvaPayClient, op: str, args: dict[str, Any]) -> dict[str, Any]:
    snake = camel_to_snake(op)
    method = getattr(client, f"{snake}_blocking")
    try:
        value = unwrap_envelope(method(json.dumps(args)))
        return {"ok": True, "value": value}
    except (SolvaPayError, PaywallError) as exc:
        return {
            "ok": False,
            "error": {
                "name": type(exc).__name__,
                "message": str(exc),
                "status": getattr(exc, "status", None),
                "code": getattr(exc, "code", None),
            },
        }


def is_structured_error(outcome: dict[str, Any]) -> bool:
    """True when the client returned a SolvaPay/Paywall error observation."""
    if outcome.get("ok") is not False:
        return False
    error = outcome.get("error")
    if not isinstance(error, dict):
        return False
    message = error.get("message")
    return isinstance(message, str) and bool(message)


def score_scenario(scenario: Scenario, outcome: dict[str, Any]) -> str:
    """Score one live scenario.

    Success-path scenarios must return ok. Intentional error probes
    (`expect_error`) must return a structured SDK error — matching dual-side
    shadow, where identical error shapes count as IDENTICAL.
    """
    if scenario.expect_error:
        return "IDENTICAL" if is_structured_error(outcome) else "DIVERGED"
    return "IDENTICAL" if outcome.get("ok") is True else "DIVERGED"


def setup_side(client: SolvaPayClient, run_id: str) -> dict[str, str]:
    side_tag = f"py-{run_id}"
    email = f"shadow-{side_tag}@example.com"
    product = invoke(
        client,
        "createProduct",
        {"name": f"Shadow Product {side_tag}", "config": {}, "metadata": {}},
    )
    if not product["ok"]:
        raise RuntimeError(f"setup createProduct failed: {product}")
    product_ref = extract_ref(product["value"], ["reference", "productRef"])
    if not product_ref:
        raise RuntimeError(f"setup missing productRef: {product}")

    plan = invoke(
        client,
        "createPlan",
        {
            "productRef": product_ref,
            "name": f"Shadow Plan {side_tag}",
            "type": "recurring",
            "billingCycle": "monthly",
            "price": 1000,
            "currency": "usd",
        },
    )
    if not plan["ok"]:
        raise RuntimeError(f"setup createPlan failed: {plan}")
    plan_ref = extract_ref(plan["value"], ["reference", "planRef"])
    if not plan_ref:
        raise RuntimeError(f"setup missing planRef: {plan}")

    customer = invoke(client, "createCustomer", {"email": email})
    if not customer["ok"]:
        raise RuntimeError(f"setup createCustomer failed: {customer}")
    customer_ref = extract_ref(customer["value"], ["customerRef", "reference"])
    if not customer_ref:
        raise RuntimeError(f"setup missing customerRef: {customer}")

    return {
        "productRef": product_ref,
        "planRef": plan_ref,
        "customerRef": customer_ref,
        "email": email,
        "sideTag": side_tag,
        "purchaseRef": "pur_missing_shadow",
        "paymentIntentId": "pi_missing_shadow",
    }


def main() -> int:
    base_url = os.environ.get("SOLVAPAY_SHADOW_BASE_URL")
    api_key = os.environ.get("SOLVAPAY_SHADOW_API_KEY")
    if not base_url or not api_key:
        print(
            "SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required",
            file=sys.stderr,
        )
        return 2

    enable_stripe = os.environ.get("SOLVAPAY_SHADOW_ENABLE_STRIPE", "").lower() in {
        "1",
        "true",
        "yes",
    }
    out_path = Path(os.environ.get("SOLVAPAY_LIVE_OUT", str(DEFAULT_OUT)))
    out_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    client = SolvaPayClient(api_key, base_url)
    run_id = uuid.uuid4().hex[:8]
    refs = setup_side(client, run_id)

    results: list[dict[str, Any]] = []
    failures = 0
    for scenario in SCENARIOS:
        if scenario.requires == "stripe" and not enable_stripe:
            results.append(
                {
                    "op": scenario.op,
                    "scenarioId": scenario.id,
                    "status": "SKIPPED",
                    "reason": scenario.skip_reason or "requires: stripe",
                }
            )
            continue
        if scenario.requires == "activePurchase":
            results.append(
                {
                    "op": scenario.op,
                    "scenarioId": scenario.id,
                    "status": "SKIPPED",
                    "reason": scenario.skip_reason or "requires: activePurchase",
                }
            )
            continue

        args = resolve_args(scenario.args, refs)
        try:
            outcome = invoke(client, scenario.op, args)
        except Exception as exc:  # noqa: BLE001 — report and continue
            failures += 1
            results.append(
                {
                    "op": scenario.op,
                    "scenarioId": scenario.id,
                    "status": "ERROR",
                    "error": str(exc),
                }
            )
            continue

        status = score_scenario(scenario, outcome)
        if status == "DIVERGED":
            failures += 1
        results.append(
            {
                "op": scenario.op,
                "scenarioId": scenario.id,
                "status": status,
                "normalized": normalize(outcome),
            }
        )

        # Capture newly created refs when present.
        if outcome.get("ok") is True and isinstance(outcome.get("value"), dict):
            if scenario.op == "createProduct":
                ref = extract_ref(outcome["value"], ["reference", "productRef"])
                if ref:
                    refs["productRef"] = ref
            if scenario.op == "createPlan":
                ref = extract_ref(outcome["value"], ["reference", "planRef"])
                if ref:
                    refs["planRef"] = ref
            if scenario.op == "createCustomer":
                ref = extract_ref(outcome["value"], ["customerRef", "reference"])
                if ref:
                    refs["customerRef"] = ref

    finished = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report = {
        "startedAt": started,
        "finishedAt": finished,
        "baseUrl": base_url,
        "mode": "live",
        "side": "python",
        "results": results,
    }
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    identical = sum(1 for r in results if r["status"] == "IDENTICAL")
    skipped = sum(1 for r in results if r["status"] == "SKIPPED")
    print(
        f"python live contract: identical={identical} skipped={skipped} "
        f"failed={failures} report={out_path}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
