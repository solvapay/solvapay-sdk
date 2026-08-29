# frozen_string_literal: true

module SolvaPay
  CUSTOMER_CACHE_TTL_MS = 60_000
  CUSTOMER_DEDUP_MAX_CACHE_SIZE = 1000
  ANONYMOUS_CUSTOMER_REF = "anonymous"
  REQUEST_ID_FORMAT = "solvapay_{epochMs}_{random9}"
  USAGE_ACTION_TYPE = "api_call"
  DEFAULT_LIMITS_CACHE_TTL_MS = 10_000
end
