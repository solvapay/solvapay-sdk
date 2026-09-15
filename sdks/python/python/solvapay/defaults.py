"""Frozen contract defaults (`defaults:` in sdk-contract.yaml)."""

from __future__ import annotations

_CUSTOMER_DEDUP_TTL_MS = 60_000
_CUSTOMER_DEDUP_MAX_CACHE_SIZE = 1000
_ANONYMOUS_CUSTOMER_REF = "anonymous"
_REQUEST_ID_FORMAT = "solvapay_{epochMs}_{random9}"
_USAGE_ACTION_TYPE = "api_call"
_DEFAULT_LIMITS_CACHE_TTL_MS = 10_000
