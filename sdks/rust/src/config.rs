//! Public configuration for [`crate::Client`].

use solvapay_core::{RetryPolicy, SdkError};

#[allow(dead_code)]
#[path = "defaults_generated.rs"]
mod defaults_generated;

#[allow(unused_imports)]
pub use defaults_generated::{
    ANONYMOUS_CUSTOMER_REF, CUSTOMER_DEDUP_MAX_CACHE_SIZE, CUSTOMER_DEDUP_TTL_MS,
    DEFAULT_INITIAL_DELAY_MS, DEFAULT_LIMITS_CACHE_TTL_MS, DEFAULT_MAX_RETRIES,
    GO_CONTEXT_FIRST_PARAM, PAYMENT_IDEMPOTENCY_KEY_FORMAT, REQUEST_ID_FORMAT, RETRY_BACKOFF,
    TOPUP_IDEMPOTENCY_KEY_FORMAT, USAGE_ACTION_TYPE, WEBHOOK_TOLERANCE_SEC,
};

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
            api_key: String::new(),
            api_base_url: None,
            retry_policy: RetryPolicy::default(),
            limits_cache_ttl_ms: DEFAULT_LIMITS_CACHE_TTL_MS,
        }
    }
}

impl Config {
    /// Read `SOLVAPAY_SECRET_KEY` and optional `SOLVAPAY_API_BASE_URL`.
    ///
    /// # Errors
    ///
    /// [`SdkError::Api`] with code `missing_api_key` when the secret is unset or blank.
    pub fn from_env() -> Result<Self, SdkError> {
        let api_key = non_empty_env("SOLVAPAY_SECRET_KEY").ok_or_else(|| SdkError::Api {
            message: "SOLVAPAY_SECRET_KEY is required".to_owned(),
            status: None,
            code: Some("missing_api_key".to_owned()),
        })?;
        Ok(Self {
            api_key,
            api_base_url: non_empty_env("SOLVAPAY_API_BASE_URL"),
            retry_policy: RetryPolicy::default(),
            limits_cache_ttl_ms: DEFAULT_LIMITS_CACHE_TTL_MS,
        })
    }
}

/// Reads a non-empty environment variable, or `None` when unset/blank.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}
