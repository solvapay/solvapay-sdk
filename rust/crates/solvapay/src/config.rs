//! Public configuration for [`crate::Client`].

use solvapay_core::RetryPolicy;

/// Default limits-cache TTL (10 seconds), matching TS / Ruby / Python facades.
pub const DEFAULT_LIMITS_CACHE_TTL_MS: u64 = 10_000;

/// SolvaPay client configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Secret API key (`SOLVAPAY_SECRET_KEY` when using [`Default`]).
    pub api_key: String,
    /// Optional API base URL override (trailing slash normalized by the transport shell).
    pub api_base_url: Option<String>,
    /// HTTP retry policy wired into [`solvapay_transport::ClientShell`].
    pub retry_policy: RetryPolicy,
    /// TTL for the in-process limits cache used by [`crate::Client::gate`].
    pub limits_cache_ttl_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: std::env::var("SOLVAPAY_SECRET_KEY").unwrap_or_default(),
            api_base_url: non_empty_env("SOLVAPAY_API_BASE_URL"),
            retry_policy: RetryPolicy::default(),
            limits_cache_ttl_ms: DEFAULT_LIMITS_CACHE_TTL_MS,
        }
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}
