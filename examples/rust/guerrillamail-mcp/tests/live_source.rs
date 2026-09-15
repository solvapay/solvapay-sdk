//! LiveSource against wiremock (never guerrillamail.com).
#![allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]

use serde_json::json;
use solvapay_example_guerrillamail_mcp::sources::{
    LiveSource, Source, SourceRequest, DEFAULT_AGENT, DEFAULT_IP,
};
use wiremock::matchers::{method, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn live_source_round_trips_sid_token_and_required_params() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(query_param("f", "get_email_address"))
        .and(query_param("ip", DEFAULT_IP))
        .and(query_param("agent", DEFAULT_AGENT))
        .and(query_param("sid_token", "sid_in"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "email_addr": "live@guerrillamailblock.com",
            "email_timestamp": 1700000000,
            "sid_token": "sid_out"
        })))
        .mount(&server)
        .await;

    let source = LiveSource::with_base_url(server.uri()).unwrap();
    let response = source
        .call(SourceRequest {
            function: "get_email_address".to_owned(),
            params: Vec::new(),
            sid_token: Some("sid_in".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(response.sid_token().as_deref(), Some("sid_out"));
    assert_eq!(response.body["email_addr"], "live@guerrillamailblock.com");
}

#[tokio::test]
async fn live_source_times_out_instead_of_hanging() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(20)))
        .mount(&server)
        .await;

    let source = LiveSource::with_base_url(server.uri()).unwrap();
    let started = std::time::Instant::now();
    let err = source
        .call(SourceRequest {
            function: "get_email_address".to_owned(),
            params: Vec::new(),
            sid_token: None,
        })
        .await
        .expect_err("timeout");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(12),
        "elapsed {:?}",
        started.elapsed()
    );
    assert!(
        err.message().contains("get_email_address"),
        "{}",
        err.message()
    );
}
