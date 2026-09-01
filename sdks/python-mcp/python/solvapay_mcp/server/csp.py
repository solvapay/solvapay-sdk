from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict

from solvapay_mcp.core import call


class SolvaPayMcpCsp(TypedDict, total=False):
    resourceDomains: list[str]
    connectDomains: list[str]
    frameDomains: list[str]


def merge_csp(
    overrides: Mapping[str, list[str]] | None = None,
    api_base_url: str | None = None,
) -> dict[str, list[str]]:
    payload: dict[str, object] = {}
    if overrides:
        payload["overrides"] = dict(overrides)
    if api_base_url:
        payload["apiBaseUrl"] = api_base_url
    value = call("mcpMergeCsp", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpMergeCsp did not return an object")
    return {
        "resourceDomains": list(value["resourceDomains"]),
        "connectDomains": list(value["connectDomains"]),
        "frameDomains": list(value["frameDomains"]),
    }


class _LazyDefaultCsp(dict[str, list[str]]):
    def _load(self) -> None:
        if not super().__len__():
            self.update(merge_csp(None, None))

    def __getitem__(self, key: str) -> list[str]:
        self._load()
        return super().__getitem__(key)

    def __iter__(self):
        self._load()
        return super().__iter__()

    def __len__(self) -> int:
        self._load()
        return super().__len__()


SOLVAPAY_DEFAULT_CSP: dict[str, list[str]] = _LazyDefaultCsp()
