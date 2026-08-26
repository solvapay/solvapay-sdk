from __future__ import annotations

import logging

_LOGGER = logging.getLogger("solvapay")
_logged = False


def log_mcp_config_once(api_base_url: str, product_ref: str, public_base_url: str) -> None:
    global _logged
    if _logged:
        return
    _logged = True
    _LOGGER.warning(
        "[solvapay] mcp config apiBaseUrl=%s productRef=%s publicBaseUrl=%s",
        api_base_url,
        product_ref,
        public_base_url,
    )


def reset_mcp_config_log_for_tests() -> None:
    global _logged
    _logged = False
