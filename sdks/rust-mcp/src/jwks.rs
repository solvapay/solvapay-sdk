//! Facade-only JWKS fetch + 10-minute cache for engine HTTP.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use solvapay::transport::FetchJwksParams;
use solvapay::{Client, SdkError};

/// 10-minute JWKS cache with optional preloaded JSON and fetch skip.
pub(crate) struct JwksCache {
    /// Injected JWKS document; when present, fetch is skipped.
    preloaded: Option<Value>,
    /// When true, never fetch JWKS from the issuer.
    skip_fetch: bool,
    /// Issuer origin used to build `/.well-known/jwks.json`.
    issuer: String,
    /// Cached document plus expiry instant.
    cache: Mutex<Option<(Value, Instant)>>,
}

impl JwksCache {
    /// Build a cache for `public_base_url` with optional preload / skip flags.
    pub(crate) fn new(preloaded: Option<Value>, skip_fetch: bool, public_base_url: String) -> Self {
        Self {
            preloaded,
            skip_fetch,
            issuer: public_base_url.trim_end_matches('/').to_owned(),
            cache: Mutex::new(None),
        }
    }

    /// Return preloaded, cached, or freshly fetched JWKS for this request.
    pub(crate) async fn resolve(
        &self,
        client: &Client,
        auth_header: Option<&str>,
    ) -> Result<Option<Value>, SdkError> {
        if let Some(json) = &self.preloaded {
            return Ok(Some(json.clone()));
        }
        if self.skip_fetch || auth_header.is_none() {
            return Ok(None);
        }
        {
            let guard = self
                .cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some((json, exp)) = guard.as_ref() {
                if Instant::now() < *exp {
                    return Ok(Some(json.clone()));
                }
            }
        }
        let json = client
            .fetch_jwks(FetchJwksParams {
                jwks_url: format!("{}/.well-known/jwks.json", self.issuer),
            })
            .await?;
        let mut guard = self
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = Some((json.clone(), Instant::now() + Duration::from_secs(600)));
        Ok(Some(json))
    }
}
