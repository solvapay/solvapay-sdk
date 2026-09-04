use std::sync::{Arc, Mutex};

use serde_json::Value;
use solvapay::transport::transport::{BoxFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::SdkError;

pub struct MockTransport {
    limits: Value,
    usages: Mutex<Vec<Value>>,
}

impl MockTransport {
    pub fn new(limits: Value) -> Arc<Self> {
        Arc::new(Self {
            limits,
            usages: Mutex::new(Vec::new()),
        })
    }

    pub fn usages(&self) -> Vec<Value> {
        self.usages.lock().expect("lock").clone()
    }
}

impl Transport for MockTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        Box::pin(async move {
            if req.method == Method::Post && req.url.contains("/v1/sdk/limits") {
                return Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&self.limits).expect("limits json"),
                });
            }
            if req.method == Method::Post && req.url.contains("/v1/sdk/usages") {
                let payload: Value =
                    serde_json::from_slice(req.body.as_ref().expect("body")).expect("usage json");
                self.usages.lock().expect("lock").push(payload);
                return Ok(HttpResponse {
                    status: 200,
                    body: br#"{"reference":"usg_test","outcome":"success"}"#.to_vec(),
                });
            }
            Err(SdkError::transport(
                format!("unexpected request {:?} {}", req.method, req.url),
                false,
            ))
        })
    }
}

pub fn project_usage(calls: &[Value]) -> Vec<Value> {
    calls
        .iter()
        .map(|call| {
            let meta = call
                .get("metadata")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            assert!(call.get("duration").is_some(), "missing duration");
            assert!(call.get("timestamp").is_some(), "missing timestamp");
            assert!(meta.get("requestId").is_some(), "missing requestId");
            serde_json::json!({
                "outcome": call.get("outcome"),
                "actionType": call.get("actionType"),
                "units": call.get("units"),
                "productRef": call.get("productRef"),
                "customerRef": call.get("customerRef"),
                "metadata": { "action": meta.get("action") },
            })
        })
        .collect()
}
