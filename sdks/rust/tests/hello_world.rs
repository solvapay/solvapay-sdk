//! Integration smoke: mock transport round-trip for `get_merchant` (Step 46 done-when).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use solvapay::transport::transport::{BoxFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::{Client, Config, SdkError};

struct MockTransport {
    responses: Mutex<Vec<Result<HttpResponse, SdkError>>>,
    recorded: Mutex<Vec<HttpRequest>>,
}

impl MockTransport {
    fn new(responses: Vec<Result<HttpResponse, SdkError>>) -> Arc<Self> {
        Arc::new(Self {
            responses: Mutex::new(responses),
            recorded: Mutex::new(Vec::new()),
        })
    }

    fn recorded(&self) -> Vec<HttpRequest> {
        self.recorded.lock().expect("lock").clone()
    }
}

impl Transport for MockTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let recorded = &self.recorded;
        let responses = &self.responses;
        Box::pin(async move {
            recorded.lock().expect("lock").push(req);
            let mut guard = responses.lock().expect("lock");
            if guard.is_empty() {
                Err(SdkError::transport("mock responses exhausted", false))
            } else {
                guard.remove(0)
            }
        })
    }
}

#[tokio::test]
async fn hello_world_get_merchant_round_trips() {
    let mock = MockTransport::new(vec![Ok(HttpResponse {
        status: 200,
        body: br#"{"displayName":"Hello Merchant"}"#.to_vec(),
    })]);
    let client = Client::with_transport(
        mock.clone(),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let merchant = client.get_merchant().await.expect("get_merchant");
    assert_eq!(merchant.display_name.as_deref(), Some("Hello Merchant"));
    let recorded = mock.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].method, Method::Get);
    assert!(recorded[0].url.contains("/v1/sdk/merchant"));
}

#[tokio::test]
async fn empty_api_key_rejected_before_transport() {
    let mock = MockTransport::new(vec![Ok(HttpResponse {
        status: 200,
        body: br#"{"displayName":"unused"}"#.to_vec(),
    })]);
    let client = Client::with_transport(
        mock.clone(),
        Config {
            api_key: String::new(),
            ..Config::default()
        },
    );
    let err = client
        .get_merchant()
        .await
        .expect_err("expected missing apiKey");
    match err {
        SdkError::Api { message, .. } => assert_eq!(message, "Missing apiKey"),
        other => panic!("expected Api Missing apiKey, got {other:?}"),
    }
    assert!(mock.recorded().is_empty(), "transport must not be called");
}
