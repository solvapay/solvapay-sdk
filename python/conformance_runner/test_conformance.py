"""Runs the SDK conformance suite (conformance/cases) against this package.

Every case states what the TypeScript SDK, the reference, does. This runner
feeds the same input to the Python SDK and requires the same outcome. A case
whose ``fn`` has no mapping here fails: nothing is skipped.

Results are compared as canonical JSON text, not as Python objects: in Python
``True == 1`` and ``9000 == 9000.0``, which would hide differences on the wire.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from solvapay import SolvaPayError
from solvapay.paywall import build_paywall_gate
from solvapay.webhooks import verify_webhook

CASES_DIR = Path(__file__).resolve().parents[2] / "conformance" / "cases"
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

Operation = Callable[[dict[str, Any], "datetime | None"], Any]

OPERATIONS: dict[str, Operation] = {
    "verifyWebhook": lambda args, clock: verify_webhook(
        body=args["body"], signature=args["signature"], secret=args["secret"], now=clock
    ),
    "buildPaywallGate": lambda args, _clock: build_paywall_gate(args["productRef"], args["limits"]),
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
