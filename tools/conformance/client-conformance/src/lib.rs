//! Native [`SolvaPayClient`] replay over real HTTP (wiremock + reqwest).
//!
//! Operation dispatch lives in [`fixture_runner::client_replay`]. This crate
//! keeps [`RecordingTransport`] and the reqwest recording client.

#![allow(clippy::missing_docs_in_private_items)]
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use solvapay_core::SdkError;
use solvapay_transport::{
    BoxFuture, ClientShell, HttpRequest, HttpResponse, ReqwestTransport, SharedTransport,
    SolvaPayClient, Transport,
};

pub use fixture_runner::client_replay::{
    dispatch, dispatch_covers_all_operations, dispatch_operation_names,
};
pub use fixture_runner::sdk_error_to_observation;

/// One recorded HTTP exchange.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireExchange {
    /// HTTP method.
    pub method: String,
    /// Absolute request URL.
    pub url: String,
    /// Request headers (name → value).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub request_headers: BTreeMap<String, String>,
    /// Parsed JSON body when possible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<Value>,
    /// Response status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Response body (parsed JSON or raw string).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body: Option<Value>,
}

/// Transport wrapper that records every [`Transport::send`].
pub struct RecordingTransport {
    inner: SharedTransport,
    exchanges: Arc<Mutex<Vec<WireExchange>>>,
}

impl RecordingTransport {
    /// Wraps `inner` and shares an exchange buffer.
    pub fn new(inner: SharedTransport) -> (Self, Arc<Mutex<Vec<WireExchange>>>) {
        let exchanges = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                inner,
                exchanges: Arc::clone(&exchanges),
            },
            exchanges,
        )
    }
}

impl Transport for RecordingTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let method = req.method.as_str().to_owned();
        let url = req.url.clone();
        let request_headers: BTreeMap<String, String> = req
            .headers
            .iter()
            .map(|(k, v)| (k.as_str().to_owned(), v.clone()))
            .collect();
        let request_body = req.body.as_ref().map(|bytes| parse_body_bytes(bytes));
        let exchanges = Arc::clone(&self.exchanges);
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            let result = inner.send(req).await;
            match &result {
                Ok(resp) => {
                    let response_body = parse_body_bytes(&resp.body);
                    if let Ok(mut guard) = exchanges.lock() {
                        guard.push(WireExchange {
                            method,
                            url,
                            request_headers,
                            request_body,
                            status: Some(resp.status),
                            response_body: Some(response_body),
                        });
                    }
                }
                Err(_) => {
                    if let Ok(mut guard) = exchanges.lock() {
                        guard.push(WireExchange {
                            method,
                            url,
                            request_headers,
                            request_body,
                            status: None,
                            response_body: None,
                        });
                    }
                }
            }
            result
        })
    }
}

fn parse_body_bytes(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        return Value::Null;
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) => v,
        Err(_) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// Client plus shared wire-exchange buffer.
pub type RecordingClient = (SolvaPayClient, Arc<Mutex<Vec<WireExchange>>>);

/// Build a recording client against `base_url` / `api_key`.
pub fn build_recording_client(base_url: &str, api_key: &str) -> Result<RecordingClient, SdkError> {
    let transport = ReqwestTransport::new()?;
    let shared: SharedTransport = Arc::new(transport);
    let (recording, exchanges) = RecordingTransport::new(shared);
    let recording_shared: SharedTransport = Arc::new(recording);
    let shell = ClientShell::new(recording_shared, api_key).with_base_url(base_url);
    Ok((SolvaPayClient::new(shell), exchanges))
}

#[cfg(test)]
mod coverage_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    #[test]
    fn dispatch_table_matches_operation_names() {
        assert!(dispatch_covers_all_operations());
        assert_eq!(dispatch_operation_names().len(), 38);
    }
}
