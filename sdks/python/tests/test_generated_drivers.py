"""Generated gate driver loop is host-I/O only."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import Any

DRIVERS = Path(__file__).resolve().parents[1] / "python" / "solvapay" / "drivers.generated.py"


def _load_drivers():
    spec = spec_from_file_location("solvapay._drivers_generated_test", DRIVERS)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_driver_loop_corpus_is_complete() -> None:
    root = Path(__file__).resolve().parents[3] / "contract" / "fixtures" / "driver-loop"
    files = sorted(path.name for path in root.glob("*.json"))
    assert len(files) == 8, files


def test_generated_gate_loop_cache_hit_allow() -> None:
    drivers = _load_drivers()
    events: list[object] = []

    class Host:
        def ensure_customer(self, customer_ref: str) -> str:
            raise AssertionError("ensure should not run")

        def read_limits_cache(self, key: str) -> dict[str, Any] | None:
            return {
                "remaining": 5,
                "limits": {"withinLimits": True, "remaining": 5},
                "timestampMs": 1000,
            }

        def check_limits(self, action: dict[str, Any]) -> object:
            raise AssertionError("checkLimits should not run")

        def apply_cache(self, cache: object) -> None:
            events.append("cache")

        def now_ms(self) -> int:
            return 1010

    steps = [
        {
            "state": {"product": "prd_1"},
            "action": {"kind": "readLimitsCache", "key": "cus_1:prd_1:requests"},
        },
        {
            "state": {"product": "prd_1"},
            "action": {"kind": "allow", "customerRef": "cus_1", "limits": {"remaining": 4}},
        },
    ]
    index = 0

    def gate_next(_state: object, event: object) -> dict[str, Any]:
        nonlocal index
        events.append(event)
        step = steps[index]
        index += 1
        return step

    out = drivers.run_generated_gate_loop(
        gate_next,
        Host(),
        {"kind": "start", "customerRef": "cus_1", "product": "prd_1"},
    )
    assert out["action"]["kind"] == "allow"
    assert events[0] == {"kind": "start", "customerRef": "cus_1", "product": "prd_1"}
    assert "cache" in events


def test_generated_payable_loop_run_gate_invoke_done() -> None:
    drivers = _load_drivers()
    tracked: list[object] = []

    class Host:
        def run_gate(self, action: dict[str, object]) -> dict[str, object]:
            assert action["kind"] == "runGate"
            return {"kind": "allow", "customerRef": "cus_1", "limits": {"remaining": 4}}

        def invoke_handler(self, action: dict[str, object]) -> dict[str, object]:
            assert action["kind"] == "invokeHandler"
            return {"kind": "ok", "envelope": {"value": True}}

        def track_usage(self, request: object) -> None:
            tracked.append(request)

        def now_ms(self) -> int:
            return 50

        def random_unit(self) -> float:
            return 0.25

    steps = [
        {
            "state": {},
            "action": {
                "kind": "runGate",
                "customerRef": "cus_1",
                "product": "prd",
                "usageType": "requests",
            },
        },
        {"state": {}, "action": {"kind": "invokeHandler", "customerRef": "cus_1", "limits": {}}},
        {
            "state": {},
            "action": {
                "kind": "done",
                "result": {"ok": True},
                "track": {"request": {"units": 1}},
            },
        },
    ]
    index = 0

    def payable_next(_state: object, _event: object) -> dict[str, object]:
        nonlocal index
        step = steps[index]
        index += 1
        return step

    out = drivers.run_generated_payable_loop(
        payable_next,
        Host(),
        {"kind": "start", "customerRef": "cus_1"},
    )
    assert out == {"ok": True}
    assert tracked == [{"units": 1}]


if __name__ == "__main__":
    test_generated_gate_loop_cache_hit_allow()
    test_generated_payable_loop_run_gate_invoke_done()
    print("ok")
