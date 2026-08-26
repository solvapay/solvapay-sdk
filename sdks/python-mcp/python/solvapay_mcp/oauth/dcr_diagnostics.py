from __future__ import annotations

import logging
import re

_LOGGER = logging.getLogger("solvapay")


def dcr_failure_diagnostic(
    *,
    product_ref: str,
    api_base_url: str,
    status: int,
    body_text: str = "",
) -> str:
    looks_like_unresolved_product = bool(
        re.search(r"invalid identifier", body_text, re.IGNORECASE)
        or (
            re.search(r"product_ref", body_text, re.IGNORECASE)
            and re.search(r"mcp_server_id", body_text, re.IGNORECASE)
        )
    )
    if looks_like_unresolved_product:
        hint = (
            "The platform could not resolve this productRef "
            "(often a wrong/missing product or API base URL mismatch). "
            'A 400 "Invalid identifier" here means the product did not resolve '
            "— not that the DCR body was malformed. "
            "Run `npx solvapay doctor` or check SOLVAPAY_PRODUCT_REF / SOLVAPAY_API_BASE_URL."
        )
    else:
        hint = (
            "Upstream DCR rejected the registration. "
            "Check SOLVAPAY_PRODUCT_REF and SOLVAPAY_API_BASE_URL "
            "(or run `npx solvapay doctor`)."
        )
    return (
        f"[solvapay] OAuth DCR failed ({status}) productRef={product_ref} "
        f"apiBaseUrl={api_base_url}. {hint}"
    )


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
