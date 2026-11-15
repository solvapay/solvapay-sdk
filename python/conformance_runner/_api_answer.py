"""One scripted API answer as the HTTP response the fake API sends."""

from __future__ import annotations

import json
from typing import Any

import httpx


def api_response(exchange: dict[str, Any]) -> httpx.Response:
    """``body`` is sent as JSON; ``rawBody`` (an answer that is not JSON, such as a
    proxy's page) is sent as text/plain, byte for byte."""
    status = exchange.get("status", 200)
    if "rawBody" in exchange:
        return httpx.Response(
            status, content=exchange["rawBody"].encode(), headers={"content-type": "text/plain"}
        )
    return httpx.Response(
        status,
        content=json.dumps(exchange["body"]).encode(),
        headers={"content-type": "application/json"},
    )
