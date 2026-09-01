//! Facade-only JWKS fetch + 10-minute cache for engine HTTP.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use solvapay::transport::FetchJwksParams;
use solvapay::{Client, SdkError};

pub(crate) struct JwksCache {
    preloaded: Option<Value>,
    skip_fetch: bool,
    issuer: String,
    cache: Mutex<Option<(Value, Instant)>>,
}

impl JwksCache {
    pub(crate) fn new(preloaded: Option<Value>, skip_fetch: bool, public_base_url: String) -> Self {
        Self {
            preloaded,
            skip_fetch,
            issuer: public_base_url.trim_end_matches('/').to_owned(),
            cache: Mutex::new(None),
        }
    }

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
