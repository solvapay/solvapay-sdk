//! Synchronous client when the `blocking` feature is enabled (`tokio` current-thread runtime).

#![allow(clippy::missing_docs_in_private_items)]

use std::sync::OnceLock;

use solvapay_core::SdkError;
use solvapay_transport::{ClientShell, SharedTransport};

use crate::client::Client;
use crate::config::Config;
use crate::gate::{Allow, GateOpts, GateOutcome, Payable, TrackOpts};

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        // Infallible for current-thread builder on supported platforms; abort if not.
        match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => std::process::abort(),
        }
    })
}

/// Blocking SolvaPay client — wraps [`Client`] via `block_on`.
pub struct BlockingClient {
    inner: Client,
}

impl BlockingClient {
    /// Builds a blocking client with the default native HTTP transport.
    ///
    /// # Errors
    ///
    /// Returns [`SdkError::Transport`] when the HTTP client fails to initialize.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(config: Config) -> Result<Self, SdkError> {
        Ok(Self {
            inner: Client::new(config)?,
        })
    }

    /// Builds a blocking client over an injected transport.
    pub fn with_transport(transport: SharedTransport, config: Config) -> Self {
        Self {
            inner: Client::with_transport(transport, config),
        }
    }

    /// Builds a blocking client from a preconfigured [`ClientShell`].
    pub fn with_shell(shell: ClientShell, config: Config) -> Self {
        Self {
            inner: Client::with_shell(shell, config),
        }
    }

    /// Paywall gate (blocking).
    pub fn gate(&self, customer_ref: &str, opts: GateOpts) -> Result<GateOutcome, SdkError> {
        runtime().block_on(self.inner.gate(customer_ref, opts))
    }

    /// Product-scoped gate helper (blocking).
    pub fn payable(&self, product: impl Into<String>, usage_type: impl Into<String>) -> Payable {
        self.inner.payable(product, usage_type)
    }
}

#[path = "blocking_generated.rs"]
mod blocking_generated;

impl Allow {
    /// Records success usage (blocking).
    pub fn track_success_blocking(&self, opts: TrackOpts) -> Result<(), SdkError> {
        runtime().block_on(self.track_success(opts))
    }

    /// Records failed usage (blocking).
    pub fn track_fail_blocking(
        &self,
        error: impl std::fmt::Display,
        opts: TrackOpts,
    ) -> Result<(), SdkError> {
        runtime().block_on(self.track_fail(error, opts))
    }
}

impl Payable {
    /// Gate call (blocking).
    pub fn gate_blocking(&self, customer_ref: &str) -> Result<GateOutcome, SdkError> {
        runtime().block_on(self.gate(customer_ref))
    }
}
