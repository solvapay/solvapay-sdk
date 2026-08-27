from __future__ import annotations

from collections.abc import Callable, Mapping

from solvapay_mcp.core import call

NarratorOutput = dict[str, object]


def _as_mapping(value: object) -> dict[str, object] | None:
    if isinstance(value, Mapping):
        return {str(k): v for k, v in value.items()}
    return None


def _as_narrator_output(value: object) -> NarratorOutput:
    mapping = _as_mapping(value)
    if mapping is None:
        raise TypeError("mcpNarrate returned a non-object narrator envelope")
    text = mapping.get("text")
    result: NarratorOutput = {"text": text if isinstance(text, str) else ""}
    links = mapping.get("links")
    if isinstance(links, list) and links:
        result["links"] = links
    return result


def _narrate(tool: str, data: Mapping[str, object]) -> NarratorOutput:
    return _as_narrator_output(call("mcpNarrate", {"tool": tool, "payload": dict(data)}))


def narrate_manage_account(data: Mapping[str, object]) -> NarratorOutput:
    return _narrate("manage_account", data)


def narrate_upgrade(data: Mapping[str, object]) -> NarratorOutput:
    return _narrate("upgrade", data)


def narrate_topup(data: Mapping[str, object]) -> NarratorOutput:
    return _narrate("topup", data)


def narrate_activate_plan(data: Mapping[str, object]) -> NarratorOutput:
    return _narrate("activate_plan", data)


NARRATORS: dict[str, Callable[[Mapping[str, object]], NarratorOutput]] = {
    "upgrade": narrate_upgrade,
    "manage_account": narrate_manage_account,
    "topup": narrate_topup,
    "activate_plan": narrate_activate_plan,
}


def ui_placeholder(tool: str, data: Mapping[str, object]) -> str:
    result = _as_narrator_output(
        call("mcpNarrate", {"tool": tool, "payload": dict(data), "kind": "placeholder"})
    )
    text = result.get("text")
    return text if isinstance(text, str) else ""


def balance_summary(customer: Mapping[str, object] | None) -> str | None:
    result = _as_narrator_output(
        call(
            "mcpNarrate",
            {
                "tool": "manage_account",
                "payload": dict(customer) if customer is not None else {},
                "kind": "balanceSummary",
            },
        )
    )
    text = result.get("text")
    return text if isinstance(text, str) and text else None
