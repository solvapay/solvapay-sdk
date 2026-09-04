//! Manual smoke test against a real API (local backend or sandbox).
//!
//! Ignored by default — run with:
//!
//! ```text
//! SOLVAPAY_SMOKE_BASE_URL=http://localhost:3001 \
//! SOLVAPAY_SMOKE_API_KEY=sk_test_... \
//! cargo test -p solvapay-transport --test shell_smoke -- --ignored --nocapture
//! ```
//!
//! Demonstrates auth injection + template error mapping end-to-end (not mocks).

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::json;
use solvapay_core::SdkError;
use solvapay_transport::{
    ClientShell, Idempotency, Method, ReqwestTransport, SharedTransport, ShellRequest,
};

#[tokio::test]
#[ignore = "requires SOLVAPAY_SMOKE_BASE_URL + SOLVAPAY_SMOKE_API_KEY against a live API"]
async fn check_limits_shaped_request_against_live_api() {
    let base = std::env::var("SOLVAPAY_SMOKE_BASE_URL")
        .expect("SOLVAPAY_SMOKE_BASE_URL (e.g. http://localhost:3001)");
    let good_key = std::env::var("SOLVAPAY_SMOKE_API_KEY").expect("SOLVAPAY_SMOKE_API_KEY");

    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("transport"));
    let template = "Check limits failed ({status}): {body}";

    let shell = ClientShell::new(Arc::clone(&transport), &good_key).with_base_url(&base);
    let ok = shell
        .execute(ShellRequest {
            method: Method::Post,
            path: "/v1/sdk/limits".to_owned(),
            query: BTreeMap::new(),
            body: Some(json!({
                "customerRef": "cus_smoke",
                "productRef": "prd_smoke"
            })),
            idempotency: Idempotency::None,
            error_template: template,
        })
        .await;

    match ok {
        Ok(value) => {
            println!("2xx body: {value}");
            assert!(value.is_object() || value.is_array() || value.is_null());
        }
        Err(SdkError::Api {
            message, status, ..
        }) => {
            // Valid key but unknown refs may still 4xx — auth worked if not 401.
            println!("Api error with valid key (auth accepted): status={status:?} {message}");
            assert_ne!(status, Some(401), "valid key must not get 401");
        }
        Err(other) => panic!("unexpected error with valid key: {other:?}"),
    }

    let bad = ClientShell::new(transport, "sk_test_definitely_invalid")
        .with_base_url(&base)
        .execute(ShellRequest {
            method: Method::Post,
            path: "/v1/sdk/limits".to_owned(),
            query: BTreeMap::new(),
            body: Some(json!({
                "customerRef": "cus_smoke",
                "productRef": "prd_smoke"
            })),
            idempotency: Idempotency::None,
            error_template: template,
        })
        .await
        .expect_err("bad key must fail");

    match bad {
        SdkError::Api {
            message, status, ..
        } => {
            println!("bad-key Api error: status={status:?} {message}");
            assert!(
                message.starts_with("Check limits failed ("),
                "template prefix missing: {message}"
            );
            assert!(message.contains("): "), "template shape missing: {message}");
            assert_eq!(status, Some(401));
        }
        other => panic!("expected Api error for bad key, got {other:?}"),
    }
}
