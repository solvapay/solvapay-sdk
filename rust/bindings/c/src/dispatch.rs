//! Generic `op`-name dispatch for the C ABI scaffold (Step 54).
//!
//! Scaffold allowlist: `getMerchant` only. Full 36-op surface is deferred to a
//! later `Toolchain::C` emitter column (C analog of Go step 50).
//!
//! Op → method mapping mirrors `rust/tools/live-contract/src/invoke.rs`.

use solvapay_core::SdkError;
use solvapay_transport::SolvaPayClient;

use crate::error::{err_envelope, ok_envelope};
use crate::runtime;

/// Dispatches `op` against `client` with JSON `args_json`, returning an envelope string.
///
/// Unknown ops become a non-retryable Transport error envelope.
pub fn dispatch(client: &SolvaPayClient, op: &str, _args_json: &str) -> String {
    match op {
        "getMerchant" => {
            let result = runtime::runtime().block_on(client.get_merchant());
            match result {
                Ok(value) => ok_envelope(&value),
                Err(err) => err_envelope(&err),
            }
        }
        other => err_envelope(&SdkError::transport(format!("unknown op: {other}"), false)),
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use serde_json::Value;
    use solvapay_transport::{ClientShell, SharedTransport, Transport};
    use std::sync::Arc;

    struct NoopTransport;

    impl Transport for NoopTransport {
        fn send(
            &self,
            _request: solvapay_transport::HttpRequest,
        ) -> solvapay_transport::BoxFuture<'_, Result<solvapay_transport::HttpResponse, SdkError>>
        {
            Box::pin(async { Err(SdkError::transport("noop", false)) })
        }
    }

    fn dummy_client() -> SolvaPayClient {
        let transport: SharedTransport = Arc::new(NoopTransport);
        SolvaPayClient::new(ClientShell::new(transport, "sk_test"))
    }

    #[test]
    fn unknown_op_is_transport_error_envelope() {
        let env: Value =
            serde_json::from_str(&dispatch(&dummy_client(), "notARealOp", "{}")).unwrap();
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Transport");
        assert!(env["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unknown op: notARealOp"));
    }
}
