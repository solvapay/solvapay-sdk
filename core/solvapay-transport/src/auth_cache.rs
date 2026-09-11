//! JWKS and bearer-verdict caches owned by [`crate::SolvaPayClient`].
//!
//! TTLs are compared against the shell [`crate::ClockFn`] (epoch ms). Do not
//! use `std::time::Instant` — it is unavailable on `wasm32-unknown-unknown`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;
use solvapay_core::SdkError;

/// JWKS document TTL (10 minutes).
pub(crate) const JWKS_TTL_MS: u64 = 10 * 60 * 1000;
/// Successful-verdict TTL ceiling (60 seconds).
pub(crate) const VERDICT_TTL_CEILING_MS: u64 = 60 * 1000;

/// A successful bearer check, reused until `expires_at_ms`.
#[derive(Clone)]
pub(crate) struct CachedVerdict {
    /// Customer ref taken from the JWT claims.
    pub customer_ref: String,
    /// Decoded JWT payload kept for `authInfo` construction.
    pub claims: Value,
    /// Clock-ms instant after which this verdict must be recomputed.
    expires_at_ms: u64,
}

/// Process-local JWKS documents and successful bearer verdicts.
pub(crate) struct AuthCaches {
    /// JWKS URL → (document, expiry ms).
    jwks: Mutex<HashMap<String, (Value, u64)>>,
    /// JWT `jti` → cached allow verdict.
    verdicts: Mutex<HashMap<String, CachedVerdict>>,
}

impl AuthCaches {
    /// Empty caches.
    pub(crate) fn new() -> Self {
        Self {
            jwks: Mutex::new(HashMap::new()),
            verdicts: Mutex::new(HashMap::new()),
        }
    }

    /// Returns a cached JWKS document when it has not expired.
    pub(crate) fn get_jwks(&self, url: &str, now_ms: u64) -> Result<Option<Value>, SdkError> {
        let guard = self
            .jwks
            .lock()
            .map_err(|_| SdkError::transport("JWKS cache poisoned", false))?;
        Ok(guard
            .get(url)
            .and_then(|(doc, exp)| (*exp > now_ms).then(|| doc.clone())))
    }

    /// Stores a JWKS document with [`JWKS_TTL_MS`].
    pub(crate) fn put_jwks(
        &self,
        url: String,
        document: Value,
        now_ms: u64,
    ) -> Result<(), SdkError> {
        let mut guard = self
            .jwks
            .lock()
            .map_err(|_| SdkError::transport("JWKS cache poisoned", false))?;
        guard.insert(url, (document, now_ms.saturating_add(JWKS_TTL_MS)));
        Ok(())
    }

    /// Returns a cached allow verdict for `jti` when it has not expired.
    pub(crate) fn get_verdict(
        &self,
        jti: &str,
        now_ms: u64,
    ) -> Result<Option<CachedVerdict>, SdkError> {
        let guard = self
            .verdicts
            .lock()
            .map_err(|_| SdkError::transport("auth verdict cache poisoned", false))?;
        Ok(guard
            .get(jti)
            .and_then(|hit| (hit.expires_at_ms > now_ms).then(|| hit.clone())))
    }

    /// Caches an allow verdict, capped by [`VERDICT_TTL_CEILING_MS`] and JWT `exp`.
    pub(crate) fn put_verdict(
        &self,
        jti: String,
        customer_ref: String,
        claims: Value,
        now_ms: u64,
        exp_unix_secs: Option<i64>,
    ) -> Result<(), SdkError> {
        let mut ttl = VERDICT_TTL_CEILING_MS;
        if let Some(exp) = exp_unix_secs {
            let now_secs = i64::try_from(now_ms / 1000).unwrap_or(i64::MAX);
            let remaining_ms = exp.saturating_sub(now_secs).saturating_mul(1000);
            if remaining_ms <= 0 {
                return Ok(());
            }
            ttl = ttl.min(u64::try_from(remaining_ms).unwrap_or(VERDICT_TTL_CEILING_MS));
        }
        let mut guard = self
            .verdicts
            .lock()
            .map_err(|_| SdkError::transport("auth verdict cache poisoned", false))?;
        guard.insert(
            jti,
            CachedVerdict {
                customer_ref,
                claims,
                expires_at_ms: now_ms.saturating_add(ttl),
            },
        );
        Ok(())
    }
}
