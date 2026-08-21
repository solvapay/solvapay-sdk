//! Blocking feature smoke (Step 46) — run with `--features blocking`.

#![cfg(feature = "blocking")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use solvapay::blocking::BlockingClient;
use solvapay::transport::transport::{BoxFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::{Config, SdkError};

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

#[test]
fn blocking_client_round_trips() {
    let mock = MockTransport::new(vec![Ok(HttpResponse {
        status: 200,
        body: br#"{"displayName":"Blocking Co"}"#.to_vec(),
    })]);
    let client = BlockingClient::with_transport(
        mock.clone(),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let merchant = client.get_merchant().expect("merchant");
    assert_eq!(merchant.display_name.as_deref(), Some("Blocking Co"));
    let recorded = mock.recorded.lock().expect("lock");
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].method, Method::Get);
    assert!(recorded[0].url.contains("/v1/sdk/merchant"));
}
