//! Offline mock-transport coverage for the get-merchant example (Step 48).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use solvapay::transport::transport::{BoxFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::{Client, Config, SdkError};
use solvapay_example_get_merchant::run;

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
async fn example_run_prints_get_merchant_fields() {
    let mock = MockTransport::new(vec![Ok(HttpResponse {
        status: 200,
        body: br#"{"displayName":"Example Merchant","defaultCurrency":"usd"}"#.to_vec(),
    })]);
    let client = Client::with_transport(
        mock.clone(),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let merchant = run(&client).await.expect("run");
    assert_eq!(merchant.display_name.as_deref(), Some("Example Merchant"));
    assert_eq!(merchant.default_currency.as_deref(), Some("usd"));
    let recorded = mock.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].method, Method::Get);
    assert!(recorded[0].url.contains("/v1/sdk/merchant"));
}
