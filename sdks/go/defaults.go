package solvapay

// Frozen contract defaults (`sdk-contract.yaml` `defaults:`).
const (
	DefaultLimitsCacheTTLMs   = 10_000
	DefaultMaxRetries         = 2
	DefaultInitialDelayMs     = 500
	CustomerDedupTTLMs        = 60_000
	CustomerDedupMaxCacheSize = 1000
	AnonymousCustomerRef      = "anonymous"
	RequestIDFormat           = "solvapay_{epochMs}_{random9}"
	UsageActionType           = "api_call"
)
