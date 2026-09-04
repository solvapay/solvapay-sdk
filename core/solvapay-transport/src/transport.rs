//! Dyn-compatible [`Transport`] trait with the `maybe_async_send` Send discipline.

use std::future::Future;
use std::pin::Pin;

use solvapay_core::SdkError;

use crate::http::{HttpRequest, HttpResponse};

/// Boxed future returned by [`Transport::send`].
///
/// Native targets require `Send` (tokio); `wasm32` futures are `!Send`. This
/// cfg'd alias is the landed equivalent of the §4.4 `#[maybe_async_send]` sketch
/// — one trait definition, dyn-compatible for `Arc<dyn Transport>` (step 21).
#[cfg(not(target_arch = "wasm32"))]
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Boxed future returned by [`Transport::send`] on `wasm32` (`!Send`).
#[cfg(target_arch = "wasm32")]
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

/// Minimal HTTP transport contract satisfied by `ReqwestTransport` (native) and
/// `FetchTransport` (wasm32).
///
/// # Error boundary
///
/// * I/O failures (connect, timeout, TLS, invalid request build) → [`SdkError::Transport`].
/// * Non-OK HTTP statuses are **not** transport errors — return [`HttpResponse`] as-is.
pub trait Transport {
    /// Sends `req` and returns the raw status + body, or a transport [`SdkError`].
    ///
    /// # Arguments
    ///
    /// * `req` - Fully-formed absolute URL request (auth/idempotency already applied by the client shell).
    ///
    /// # Returns
    ///
    /// A future resolving to [`HttpResponse`] or [`SdkError::Transport`].
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>>;
}
