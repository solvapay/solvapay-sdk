//! Read-only typed-client smoke test against a live API.
//!
//! Ignored by default — run with:
//!
//! ```text
//! SOLVAPAY_SMOKE_BASE_URL=http://localhost:3001 \
//! SOLVAPAY_SMOKE_API_KEY=sk_test_... \
//! cargo test -p solvapay-transport --test client_group_a_smoke -- --ignored --nocapture
//! ```
//!
//! Calls only `get_merchant` and `get_platform_config` (no customer/credit/session
//! mutations).

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::Arc;

use solvapay_core::SdkError;
use solvapay_transport::{ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient};

#[tokio::test]
#[ignore = "requires SOLVAPAY_SMOKE_BASE_URL + SOLVAPAY_SMOKE_API_KEY against a live API"]
async fn typed_group_a_read_only_against_live_api() {
    let base = std::env::var("SOLVAPAY_SMOKE_BASE_URL")
        .expect("SOLVAPAY_SMOKE_BASE_URL (e.g. http://localhost:3001)");
    let api_key = std::env::var("SOLVAPAY_SMOKE_API_KEY").expect("SOLVAPAY_SMOKE_API_KEY");

    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("transport"));
    let client = SolvaPayClient::new(ClientShell::new(transport, &api_key).with_base_url(&base));

    match client.get_merchant().await {
        Ok(merchant) => {
            println!("get_merchant ok: {merchant:?}");
        }
        Err(SdkError::Api {
            message, status, ..
        }) => {
            println!("get_merchant Api error (auth may still be ok): status={status:?} {message}");
            assert_ne!(
                status,
                Some(401),
                "valid key must not get 401 on get_merchant"
            );
        }
        Err(other) => panic!("unexpected get_merchant error: {other:?}"),
    }

    match client.get_platform_config().await {
        Ok(config) => {
            println!("get_platform_config ok: {config:?}");
        }
        Err(SdkError::Api {
            message, status, ..
        }) => {
            println!(
                "get_platform_config Api error (auth may still be ok): status={status:?} {message}"
            );
            assert_ne!(
                status,
                Some(401),
                "valid key must not get 401 on get_platform_config"
            );
        }
        Err(other) => panic!("unexpected get_platform_config error: {other:?}"),
    }
}
