from __future__ import annotations

from collections.abc import Callable
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_path = Path(__file__).resolve().parent / "_layer2.generated.py"
_spec = spec_from_file_location("solvapay_mcp._layer2_generated", _path)
if _spec is None or _spec.loader is None:
    raise ImportError(f"cannot load generated MCP wrappers from {_path}")
_generated = module_from_spec(_spec)
_spec.loader.exec_module(_generated)

for _name in dir(_generated):
    if _name.startswith("_"):
        continue
    globals()[_name] = getattr(_generated, _name)

# Explicit re-exports so mypy sees the public surface (dir() copy is runtime-only).
Layer2Fn = Callable[..., dict[str, object]]
paywall_tool_result: Layer2Fn = _generated.paywall_tool_result
make_response_result: Layer2Fn = _generated.make_response_result
assert_response_result: Layer2Fn = _generated.assert_response_result
build_payable_tool_result: Layer2Fn = _generated.build_payable_tool_result
invoke_payable_next: Layer2Fn = _generated.invoke_payable_next
