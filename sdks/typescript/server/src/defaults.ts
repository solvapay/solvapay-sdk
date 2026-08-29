/** Frozen contract defaults (`defaults:` in sdk-contract.yaml). */

export const CUSTOMER_DEDUP_TTL_MS = 60_000
export const CUSTOMER_DEDUP_MAX_CACHE_SIZE = 1000
export const ANONYMOUS_CUSTOMER_REF = 'anonymous'
export const REQUEST_ID_FORMAT = 'solvapay_{epochMs}_{random9}'
export const USAGE_ACTION_TYPE = 'api_call'
