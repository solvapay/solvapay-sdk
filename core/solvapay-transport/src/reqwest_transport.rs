//! Native [`ReqwestTransport`] backed by `reqwest` + rustls (no OpenSSL).

use reqwest::header::{HeaderName as ReqwestHeaderName, HeaderValue};
use reqwest::Client;
use solvapay_core::SdkError;

use crate::http::{HeaderName, HttpRequest, HttpResponse, Method};
use crate::transport::{BoxFuture, Transport};

/// `reqwest`/rustls implementation of [`Transport`].
///
/// Constructed once; clones share the underlying connection pool via [`Client`].
#[derive(Debug, Clone)]
pub struct ReqwestTransport {
    /// Shared reqwest client (rustls TLS).
    client: Client,
}

impl ReqwestTransport {
    /// Builds a rustls-backed [`reqwest::Client`] and wraps it.
    ///
    /// # Returns
    ///
    /// A ready transport, or [`SdkError::Transport`] with `retryable: false` when
    /// the client builder fails.
    pub fn new() -> Result<Self, SdkError> {
        match Client::builder().use_rustls_tls().build() {
            Ok(client) => Ok(Self { client }),
            Err(err) => Err(SdkError::transport(
                format!("failed to build HTTP client: {err}"),
                false,
            )),
        }
    }
}

impl Transport for ReqwestTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let client = self.client.clone();
        Box::pin(async move { send_with_client(&client, req).await })
    }
}

/// Executes one request on `client` and maps the result to [`HttpResponse`] /
/// [`SdkError::Transport`].
///
/// # Arguments
///
/// * `client` - Shared reqwest client.
/// * `req` - Absolute-URL request with optional headers and body.
///
/// # Returns
///
/// Status + body bytes for any HTTP status, or a transport error for I/O failure.
async fn send_with_client(client: &Client, req: HttpRequest) -> Result<HttpResponse, SdkError> {
    let mut builder = client.request(to_reqwest_method(req.method), &req.url);

    for (name, value) in req.headers {
        builder = builder.header(to_reqwest_header_name(&name)?, to_header_value(&value)?);
    }

    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(map_reqwest_error)?;
    let status = response.status().as_u16();
    let body = response.bytes().await.map_err(map_reqwest_error)?.to_vec();

    Ok(HttpResponse { status, body })
}

/// Maps [`Method`] to [`reqwest::Method`].
///
/// # Arguments
///
/// * `method` - Transport method enum.
///
/// # Returns
///
/// The corresponding reqwest method constant.
fn to_reqwest_method(method: Method) -> reqwest::Method {
    match method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
        Method::Put => reqwest::Method::PUT,
        Method::Patch => reqwest::Method::PATCH,
        Method::Delete => reqwest::Method::DELETE,
    }
}

/// Converts a validated [`HeaderName`] into a reqwest header name.
///
/// # Arguments
///
/// * `name` - Lowercase validated header token.
///
/// # Returns
///
/// A reqwest header name, or [`SdkError::Transport`] with `retryable: false`.
fn to_reqwest_header_name(name: &HeaderName) -> Result<ReqwestHeaderName, SdkError> {
    ReqwestHeaderName::from_bytes(name.as_str().as_bytes()).map_err(|err| {
        SdkError::transport(
            format!("invalid header name {}: {err}", name.as_str()),
            false,
        )
    })
}

/// Parses a header value for reqwest.
///
/// # Arguments
///
/// * `value` - Header value string.
///
/// # Returns
///
/// A [`HeaderValue`], or [`SdkError::Transport`] with `retryable: false`.
fn to_header_value(value: &str) -> Result<HeaderValue, SdkError> {
    HeaderValue::from_str(value)
        .map_err(|err| SdkError::transport(format!("invalid header value: {err}"), false))
}

/// Maps a [`reqwest::Error`] into [`SdkError::Transport`] with retryability.
///
/// Connect / timeout / request I/O failures are retryable; builder / invalid-URL
/// failures are not.
///
/// # Arguments
///
/// * `err` - Underlying reqwest error.
///
/// # Returns
///
/// Always [`SdkError::Transport`] (never another [`SdkError`] variant).
fn map_reqwest_error(err: reqwest::Error) -> SdkError {
    let retryable = !err.is_builder() && (err.is_connect() || err.is_timeout() || err.is_request());
    SdkError::transport(format!("transport error: {err}"), retryable)
}
