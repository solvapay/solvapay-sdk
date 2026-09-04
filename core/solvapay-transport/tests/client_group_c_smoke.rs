//! Read-only Group C typed-client smoke test against a live API.
//!
//! Ignored by default — run with:
//!
//! ```text
//! SOLVAPAY_SMOKE_BASE_URL=http://localhost:3001 \
//! SOLVAPAY_SMOKE_API_KEY=sk_test_... \
//! cargo test -p solvapay-transport --test client_group_c_smoke -- --ignored --nocapture
//! ```
//!
//! Calls only `list_products`, `list_plans` (first product when available), and
//! `get_payment_method` (no mutations).

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::Arc;

use solvapay_core::SdkError;
use solvapay_dto::GetPaymentMethodParams;
use solvapay_transport::{ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient};

#[tokio::test]
#[ignore = "requires SOLVAPAY_SMOKE_BASE_URL + SOLVAPAY_SMOKE_API_KEY against a live API"]
async fn typed_group_c_read_only_against_live_api() {
    let base = std::env::var("SOLVAPAY_SMOKE_BASE_URL")
        .expect("SOLVAPAY_SMOKE_BASE_URL (e.g. http://localhost:3001)");
    let api_key = std::env::var("SOLVAPAY_SMOKE_API_KEY").expect("SOLVAPAY_SMOKE_API_KEY");

    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("transport"));
    let client = SolvaPayClient::new(ClientShell::new(transport, &api_key).with_base_url(&base));

    let product_ref = match client.list_products().await {
        Ok(products) => {
            println!("list_products ok: {products}");
            products
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("reference"))
                .and_then(|v| v.as_str())
                .map(str::to_owned)
        }
        Err(SdkError::Api {
            message, status, ..
        }) => {
            println!("list_products Api error (auth may still be ok): status={status:?} {message}");
            assert_ne!(
                status,
                Some(401),
                "valid key must not get 401 on list_products"
            );
            None
        }
        Err(other) => panic!("unexpected list_products error: {other:?}"),
    };

    if let Some(product_ref) = product_ref {
        match client.list_plans(&product_ref).await {
            Ok(plans) => {
                println!("list_plans ok: {plans}");
            }
            Err(SdkError::Api {
                message, status, ..
            }) => {
                println!("list_plans Api error: status={status:?} {message}");
                assert_ne!(
                    status,
                    Some(401),
                    "valid key must not get 401 on list_plans"
                );
            }
            Err(other) => panic!("unexpected list_plans error: {other:?}"),
        }
    } else {
        println!("list_plans skipped (no product reference from list_products)");
    }

    let customer_ref = std::env::var("SOLVAPAY_SMOKE_CUSTOMER_REF").unwrap_or_default();
    if customer_ref.is_empty() {
        println!("get_payment_method skipped (set SOLVAPAY_SMOKE_CUSTOMER_REF to exercise)");
        return;
    }

    match client
        .get_payment_method(GetPaymentMethodParams {
            customer_ref: customer_ref.clone(),
        })
        .await
    {
        Ok(method) => {
            println!("get_payment_method ok: {method}");
        }
        Err(SdkError::Api {
            message, status, ..
        }) => {
            println!("get_payment_method Api error: status={status:?} {message}");
            assert_ne!(
                status,
                Some(401),
                "valid key must not get 401 on get_payment_method"
            );
        }
        Err(other) => panic!("unexpected get_payment_method error: {other:?}"),
    }
}
