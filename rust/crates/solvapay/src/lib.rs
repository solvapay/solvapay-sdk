//! SolvaPay Rust SDK (Step 46 facade).
//!
//! Idiomatic async-first API over [`solvapay_transport`] and [`solvapay_core`]:
//! typed HTTP methods, paywall [`Client::gate`] ergonomics (§2.4), and an optional
//! `blocking` module. Semantic decisions (limits, gate copy) stay in core; this
//! crate owns config, transport wiring, and host-side cache / dedup plumbing only.

#![cfg_attr(docsrs, feature(doc_cfg))]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
#![allow(clippy::result_large_err)]

mod client;
mod config;
mod gate;

#[cfg(all(feature = "blocking", not(target_arch = "wasm32")))]
pub mod blocking;

pub use client::Client;
pub use config::{Config, DEFAULT_LIMITS_CACHE_TTL_MS};
pub use gate::{Allow, GateOpts, GateOutcome, Payable, TrackOpts};

// --- Transport re-exports (public surface for integrators) ---
pub use solvapay_transport::{
    ClientShell, HttpRequest, HttpResponse, Method, SharedTransport, SolvaPayClient, Transport,
};

/// Full transport crate re-export (advanced injection / custom stacks).
pub use solvapay_transport as transport;

#[cfg(not(target_arch = "wasm32"))]
pub use solvapay_transport::ReqwestTransport;

#[cfg(target_arch = "wasm32")]
pub use solvapay_transport::FetchTransport;

// --- Core re-exports ---
pub use solvapay_core::{
    decide_paywall_outcome, evaluate_cached_limits, evaluate_fresh_limits, resolve_product_ref,
    PaywallGate, PaywallOutcome, RetryPolicy, SdkError,
};
pub use solvapay_dto::SdkMerchantResponseDto;

#[cfg(test)]
mod re_exports {
    #![allow(clippy::missing_docs_in_private_items)]

    use super::{Client, ClientShell, Config, RetryPolicy, SdkError, SolvaPayClient, Transport};

    /// Compile-time guard that the Step 46 public surface is wired (46.1).
    #[test]
    fn re_exports_present() {
        fn _client(_: Client) {}
        fn _config(_: Config) {}
        fn _sdk_error(_: SdkError) {}
        fn _retry(_: RetryPolicy) {}
        fn _typed_client(_: SolvaPayClient) {}
        fn _transport(_: &dyn Transport) {}
        fn _shell(_: ClientShell) {}
    }
}
