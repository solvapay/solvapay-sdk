from __future__ import annotations

import logging

_LOGGER = logging.getLogger("solvapay")
_logged = False


def mcp_config_log_message(api_base_url: str, product_ref: str, public_base_url: str) -> str:
    from solvapay_mcp.core import call

    value = call(
        "mcpConfigLog",
        {
            "apiBaseUrl": api_base_url,
            "productRef": product_ref,
            "publicBaseUrl": public_base_url,
        },
    )
    if not isinstance(value, dict) or not isinstance(value.get("message"), str):
        raise TypeError("mcpConfigLog did not return a message")
    return str(value["message"])


def log_mcp_config_once(api_base_url: str, product_ref: str, public_base_url: str) -> None:
    global _logged
    if _logged:
        return
    _logged = True
    _LOGGER.warning(mcp_config_log_message(api_base_url, product_ref, public_base_url))


def reset_mcp_config_log_for_tests() -> None:
    global _logged
    _logged = False
