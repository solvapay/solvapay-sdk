//! WASM [`FetchTransport`] backed by the host `fetch` API (`wasm-bindgen` / `web-sys`).
//!
//! Resolves `fetch` from [`js_sys::global`] so the same code path works in browsers,
//! Cloudflare Workers, and Node ≥18 (no `window` dependency).

use js_sys::Uint8Array;
use solvapay_core::SdkError;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Headers, Request, RequestInit, Response};

use crate::http::{HttpRequest, HttpResponse};
use crate::transport::{BoxFuture, Transport};

/// Fetch-backed [`Transport`] for `wasm32-unknown-unknown`.
///
/// Stateless — each [`Transport::send`] builds a `Request` and awaits the host
/// `fetch` promise. Request bodies are buffered (`Uint8Array`); streaming is
/// intentionally unsupported (Workers/browser surface parity).
#[derive(Debug, Default, Clone, Copy)]
pub struct FetchTransport;

impl FetchTransport {
    /// Creates a new Fetch transport.
    ///
    /// # Returns
    ///
    /// A ready transport (construction cannot fail).
    pub fn new() -> Self {
        Self
    }
}

impl Transport for FetchTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        Box::pin(async move { send_with_fetch(req).await })
    }
}

/// Builds a Fetch `Request`, awaits the host `fetch`, and maps to [`HttpResponse`].
///
/// # Arguments
///
/// * `req` - Absolute-URL request with optional headers and body.
///
/// # Returns
///
/// Status + body bytes for any HTTP status, or [`SdkError::Transport`] for
/// request-build / network failures.
async fn send_with_fetch(req: HttpRequest) -> Result<HttpResponse, SdkError> {
    let request = build_request(&req)?;
    let response = invoke_fetch(&request).await?;
    read_response(response).await
}

/// Converts [`HttpRequest`] into a `web_sys::Request`.
///
/// # Arguments
///
/// * `req` - Method, absolute URL, headers, optional buffered body.
///
/// # Returns
///
/// A ready `Request`, or [`SdkError::Transport`] with `retryable: false` when
/// the URL / headers / body cannot be constructed.
fn build_request(req: &HttpRequest) -> Result<Request, SdkError> {
    let opts = RequestInit::new();
    opts.set_method(req.method.as_str());

    let headers =
        Headers::new().map_err(|err| map_js_error("failed to create Headers", &err, false))?;
    for (name, value) in &req.headers {
        headers.set(name.as_str(), value).map_err(|err| {
            map_js_error(
                &format!("invalid header {}: {value}", name.as_str()),
                &err,
                false,
            )
        })?;
    }
    opts.set_headers(&headers);

    if let Some(body) = &req.body {
        let bytes = Uint8Array::from(body.as_slice());
        opts.set_body(&bytes);
    }

    Request::new_with_str_and_init(&req.url, &opts)
        .map_err(|err| map_js_error(&format!("invalid request URL {}", req.url), &err, false))
}

/// Invokes `globalThis.fetch(request)` and awaits the resulting `Response`.
///
/// # Arguments
///
/// * `request` - Built Fetch request.
///
/// # Returns
///
/// A `Response`, or [`SdkError::Transport`] with `retryable: true` when fetch
/// rejects (network / DNS / connection refused).
async fn invoke_fetch(request: &Request) -> Result<Response, SdkError> {
    let promise = global_fetch(request)?;
    let value = JsFuture::from(promise)
        .await
        .map_err(|err| map_js_error("fetch failed", &err, true))?;
    value
        .dyn_into::<Response>()
        .map_err(|err| map_js_error("fetch result is not a Response", &err, false))
}

/// Resolves `fetch` from [`js_sys::global`] and calls it with `request`.
///
/// # Arguments
///
/// * `request` - Built Fetch request.
///
/// # Returns
///
/// The `Promise` returned by the host `fetch`, or a non-retryable transport
/// error when `fetch` is missing / not callable.
fn global_fetch(request: &Request) -> Result<js_sys::Promise, SdkError> {
    let global = js_sys::global();
    let fetch = js_sys::Reflect::get(&global, &JsValue::from_str("fetch"))
        .map_err(|err| map_js_error("global.fetch is missing", &err, false))?;
    let fetch_fn = fetch
        .dyn_into::<js_sys::Function>()
        .map_err(|err| map_js_error("global.fetch is not a function", &err, false))?;
    let result = fetch_fn
        .call1(&global, request)
        .map_err(|err| map_js_error("global.fetch threw", &err, true))?;
    result
        .dyn_into::<js_sys::Promise>()
        .map_err(|err| map_js_error("global.fetch did not return a Promise", &err, false))
}

/// Reads status + body bytes from a Fetch `Response`.
///
/// # Arguments
///
/// * `response` - Settled Fetch response (any HTTP status).
///
/// # Returns
///
/// [`HttpResponse`], or a retryable transport error when the body cannot be read.
async fn read_response(response: Response) -> Result<HttpResponse, SdkError> {
    let status = response.status();
    let buffer_promise = response
        .array_buffer()
        .map_err(|err| map_js_error("response.array_buffer() failed", &err, true))?;
    let buffer = JsFuture::from(buffer_promise)
        .await
        .map_err(|err| map_js_error("response.array_buffer() rejected", &err, true))?;
    let array = Uint8Array::new(&buffer);
    let body = array.to_vec();
    Ok(HttpResponse { status, body })
}

/// Maps a JS failure value into [`SdkError::Transport`].
///
/// # Arguments
///
/// * `context` - Short Rust-side description of the failure site.
/// * `err` - Underlying `JsValue` rejection / throw.
/// * `retryable` - Whether a retry may help.
///
/// # Returns
///
/// Always [`SdkError::Transport`].
fn map_js_error(context: &str, err: &JsValue, retryable: bool) -> SdkError {
    let detail = js_error_message(err);
    SdkError::transport(format!("transport error: {context}: {detail}"), retryable)
}

/// Best-effort stringification of a `JsValue` error.
///
/// # Arguments
///
/// * `err` - JS error / rejection value.
///
/// # Returns
///
/// `Error.message` when present, otherwise `String(err)`.
fn js_error_message(err: &JsValue) -> String {
    if let Some(s) = err.as_string() {
        return s;
    }
    if let Ok(msg) = js_sys::Reflect::get(err, &JsValue::from_str("message")) {
        if let Some(s) = msg.as_string() {
            return s;
        }
    }
    format!("{err:?}")
}
