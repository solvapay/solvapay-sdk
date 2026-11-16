"""Business purchase details, checked and normalised as ``@solvapay/core``'s
``validateBusinessDetails`` does (``packages/core/src/business-details.ts``).

The tax-ID tables come from the TypeScript source (``_tax_ids.py``, generated
by ``scripts/tax_ids.mjs``), so both SDKs accept and reject the same input.
"""

from __future__ import annotations

from typing import Any

from ._tax_ids import (
    BUYER_COUNTRIES,
    COUNTRY_TO_TAX_ID_TYPE,
    EU_MEMBER_COUNTRIES,
    EU_VAT_FORMAT_BY_COUNTRY,
    TAX_ID_FORMAT_BY_TYPE,
    TAX_ID_TYPES,
)
from .errors import SolvaPayError

Json = dict[str, Any]

CUSTOMER_NAME_MAX = 100

__all__ = [
    "TAX_ID_TYPES",
    "is_buyer_country",
    "is_valid_tax_id_for_country",
    "normalize_tax_id",
    "validate_business_details",
]


def is_buyer_country(value: str) -> bool:
    """A country Stripe Tax calculates tax for, as a buyer's country."""
    return value.strip().upper() in BUYER_COUNTRIES


def normalize_tax_id(tax_id: str) -> str:
    return "".join(tax_id.strip().upper().split())


def is_valid_tax_id_for_country(country: str, tax_id: str) -> bool:
    tax_id_type = COUNTRY_TO_TAX_ID_TYPE.get(country)
    if tax_id_type is None:
        return False
    normalized = normalize_tax_id(tax_id)
    if tax_id_type == "eu_vat" and country in EU_MEMBER_COUNTRIES:
        return EU_VAT_FORMAT_BY_COUNTRY[country].fullmatch(normalized) is not None
    return TAX_ID_FORMAT_BY_TYPE[tax_id_type].fullmatch(normalized) is not None


def _stripped(value: str | None) -> str:
    return value.strip() if value else ""


def _invalid(message: str) -> SolvaPayError:
    return SolvaPayError(message, code="invalid_business_details", status=400)


def validate_business_details(
    *,
    is_business: bool,
    business_name: str | None = None,
    country: str | None = None,
    customer_country: str | None = None,
    customer_name: str | None = None,
    customer_state: str | None = None,
    customer_postal_code: str | None = None,
    tax_id: str | None = None,
) -> Json:
    """The details to send the API, with camelCase keys.

    Raises ``SolvaPayError`` (code ``invalid_business_details``, status 400)
    with the first problem as its message, the one TypeScript reports.
    """
    if customer_name is not None and len(customer_name) > CUSTOMER_NAME_MAX:
        raise _invalid(f"Too big: expected string to have <={CUSTOMER_NAME_MAX} characters")

    name = _stripped(customer_name)
    address: Json = {}
    if _stripped(customer_state):
        address["customerState"] = _stripped(customer_state)
    if _stripped(customer_postal_code):
        address["customerPostalCode"] = _stripped(customer_postal_code)

    if not is_business:
        billing_country = _stripped(customer_country).upper()
        if billing_country and not is_buyer_country(billing_country):
            raise _invalid("Billing country is not supported for tax calculation")
        if billing_country:
            consumer: Json = {"isBusiness": False, "customerCountry": billing_country}
            if name:
                consumer["customerName"] = name
            return {**consumer, **address}
        return {"isBusiness": False, **({"customerName": name} if name else {})}

    business_country = _stripped(country).upper()
    if not business_country:
        raise _invalid("Country is required")
    if not is_buyer_country(business_country):
        raise _invalid("Country is not supported for business purchases")
    if _stripped(tax_id) and not is_valid_tax_id_for_country(business_country, tax_id or ""):
        raise _invalid(f"Enter a valid tax ID for {business_country}")

    billing_country = _stripped(customer_country).upper()
    details: Json = {
        "isBusiness": True,
        "country": business_country,
        "customerCountry": billing_country
        if billing_country and is_buyer_country(billing_country)
        else business_country,
    }
    if _stripped(business_name):
        details["businessName"] = _stripped(business_name)
    if _stripped(tax_id):
        details["taxId"] = normalize_tax_id(tax_id or "")
        tax_id_type = COUNTRY_TO_TAX_ID_TYPE.get(business_country)
        if tax_id_type:
            details["taxIdType"] = tax_id_type
    if name:
        details["customerName"] = name
    return {**details, **address}
