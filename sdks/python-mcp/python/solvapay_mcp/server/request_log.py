from __future__ import annotations

import logging
import sys
from collections.abc import Mapping

_LOGGER = logging.getLogger("solvapay")
_configured = False


def ensure_mcp_request_logging() -> None:
    global _configured
    if _configured:
        return
    _configured = True
    if not _LOGGER.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(message)s"))
        _LOGGER.addHandler(handler)
    _LOGGER.setLevel(logging.INFO)


def log_mcp_tool_call(name: str) -> None:
    ensure_mcp_request_logging()
    _LOGGER.info("[solvapay] tools/call %s", name)


def log_mcp_rpc(rpc: Mapping[str, object]) -> None:
    method = rpc.get("method")
    if method != "tools/call":
        return
    params = rpc.get("params")
    name = params.get("name") if isinstance(params, Mapping) else None
    if isinstance(name, str) and name.strip():
        log_mcp_tool_call(name.strip())
