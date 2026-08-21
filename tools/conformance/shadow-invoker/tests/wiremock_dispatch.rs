//! Integration tests: dispatch + RecordingTransport against wiremock.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::Arc;

use serde_json::json;
use shadow_invoker::{dispatch, RecordingTransport};
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client_against(base: &str, transport: SharedTransport) -> SolvaPayClient {
    SolvaPayClient::new(ClientShell::new(transport, "sk_test_shadow").with_base_url(base))
}

#[tokio::test]
async fn group_a_get_merchant_records_wire() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/merchant"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "displayName": "Acme",
            "legalName": "Acme LLC"
        })))
        .mount(&server)
        .await;

    let inner: SharedTransport = Arc::new(solvapay_transport::ReqwestTransport::new().unwrap());
    let (recording, exchanges) = RecordingTransport::new(inner);
    let client = client_against(&server.uri(), Arc::new(recording));

    let value = dispatch(&client, "getMerchant", &json!({})).await.unwrap();
    assert_eq!(value["displayName"], "Acme");
    let wire = exchanges.lock().unwrap().clone();
    assert_eq!(wire.len(), 1);
    assert_eq!(wire[0].method, "GET");
    assert!(wire[0].url.contains("/v1/sdk/merchant"));
    assert_eq!(wire[0].status, Some(200));
}

#[tokio::test]
async fn group_b_create_payment_intent_error_path() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/payment-intents"))
        .respond_with(ResponseTemplate::new(400).set_body_string("bad request"))
        .mount(&server)
        .await;

    let inner: SharedTransport = Arc::new(solvapay_transport::ReqwestTransport::new().unwrap());
    let (recording, exchanges) = RecordingTransport::new(inner);
    let client = client_against(&server.uri(), Arc::new(recording));

    let err = dispatch(
        &client,
        "createPaymentIntent",
        &json!({
            "productRef": "prd_fixture",
            "planRef": "pln_fixture",
            "customerRef": "cus_fixture"
        }),
    )
    .await
    .unwrap_err();
    match err {
        solvapay_core::SdkError::Api { status, .. } => assert_eq!(status, Some(400)),
        other => panic!("expected Api, got {other:?}"),
    }
    let wire = exchanges.lock().unwrap().clone();
    assert_eq!(wire.len(), 1);
    assert_eq!(wire[0].status, Some(400));
}

#[tokio::test]
async fn group_c_delete_product_404_as_success() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/sdk/products/prd_missing"))
        .respond_with(ResponseTemplate::new(404).set_body_string("not found"))
        .mount(&server)
        .await;

    let inner: SharedTransport = Arc::new(solvapay_transport::ReqwestTransport::new().unwrap());
    let (recording, _exchanges) = RecordingTransport::new(inner);
    let client = client_against(&server.uri(), Arc::new(recording));

    let value = dispatch(
        &client,
        "deleteProduct",
        &json!({ "productRef": "prd_missing" }),
    )
    .await
    .unwrap();
    assert!(value.is_null());
}
