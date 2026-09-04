from __future__ import annotations

import logging

_LOGGER = logging.getLogger("solvapay")


def dcr_failure_diagnostic(
    *,
    product_ref: str,
    api_base_url: str,
    status: int,
    body_text: str = "",
) -> str:
    from solvapay_mcp.core import call

    value = call(
        "mcpDcrDiagnostics",
        {
            "productRef": product_ref,
            "apiBaseUrl": api_base_url,
            "status": status,
            "bodyText": body_text,
        },
    )
    if not isinstance(value, dict) or not isinstance(value.get("message"), str):
        raise TypeError("mcpDcrDiagnostics did not return a message")
    return str(value["message"])


def log_dcr_failure_diagnostic(
    *,
    product_ref: str,
    api_base_url: str,
    status: int,
    body_text: str = "",
) -> None:
    _LOGGER.warning(
        dcr_failure_diagnostic(
            product_ref=product_ref,
            api_base_url=api_base_url,
            status=status,
            body_text=body_text,
        )
    )
