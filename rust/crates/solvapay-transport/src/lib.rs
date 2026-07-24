//! SolvaPay HTTP transport layer (steps 19–24).
//!
//! Defines the dyn-compatible [`Transport`] trait, the native
//! [`ReqwestTransport`] (reqwest + rustls), the WASM [`FetchTransport`]
//! (`wasm-bindgen` / `web-sys`), the [`ClientShell`] (auth, idempotency,
//! retry wiring, template error mapping), and the typed [`SolvaPayClient`]
//! (Groups A–C methods).
//!
//! # Error boundary
//!
//! Transport I/O failures are always [`solvapay_core::SdkError::Transport`].
//! Non-OK HTTP statuses are returned as [`HttpResponse`] from the transport;
//! the client shell maps them to [`solvapay_core::SdkError::Api`] via templates.

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
// `SdkError` is intentionally large (paywall gate payload); the §4.4 contract
// returns it by value rather than `Box<SdkError>`.
#![allow(clippy::result_large_err)]

pub mod client;
pub mod http;
pub mod shell;
pub mod transport;

#[cfg(not(target_arch = "wasm32"))]
pub mod reqwest_transport;

// Fetch transport is browser/edge only (`wasm32-unknown-unknown`). The
// `wasm32-wasip1` guest has no Fetch API and supplies its own host-import
// transport (Step 49), so it must not compile `fetch_transport`.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub mod fetch_transport;

pub use client::{encode_path_segment, SolvaPayClient};
pub use http::{HeaderName, HttpRequest, HttpResponse, Method};
pub use shell::{
    encode_query_component, mulberry32, normalize_base_url, random9_from_f64,
    render_idempotency_key, ClientShell, ClockFn, Idempotency, RngFn, SharedTransport,
    ShellRequest, SleeperFn, DEFAULT_BASE_URL,
};
pub use transport::{BoxFuture, Transport};

#[cfg(not(target_arch = "wasm32"))]
pub use reqwest_transport::ReqwestTransport;

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub use fetch_transport::FetchTransport;
