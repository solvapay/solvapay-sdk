//! axum adapter, CORS, and HTTP env validation.

use std::collections::BTreeMap;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::middleware::{from_fn, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use solvapay::Client;
use solvapay_mcp::{McpHttpRequest, McpHttpResponse, McpHttpServer};

use crate::clock::system_now;
use crate::error::ExampleError;
use crate::session::SessionStore;
use crate::sources::SharedSource;
use crate::tools::register_tools;

/// CORS expose list from the Ruby bitcoin-analytics example.
pub const CORS_EXPOSE: &str = "WWW-Authenticate, Mcp-Session-Id";
/// CORS methods from the Ruby bitcoin-analytics example.
pub const CORS_ALLOW_METHODS: &str = "GET, POST, DELETE, OPTIONS";
/// Default CORS request headers from the Ruby bitcoin-analytics example.
pub const CORS_DEFAULT_ALLOW_HEADERS: &str =
    "authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name";

/// Shared host for the axum router.
#[derive(Clone)]
pub struct AppState {
    /// Engine-backed MCP host.
    pub host: Arc<McpHttpServer>,
}

/// Fail loudly when `MCP_PUBLIC_BASE_URL` is missing or blank.
///
/// # Errors
///
/// When the variable is unset or empty.
pub fn require_public_base_url(value: Option<String>) -> Result<String, ExampleError> {
    match value {
        Some(raw) if !raw.trim().is_empty() => Ok(raw.trim().to_owned()),
        _ => Err(ExampleError::new("MCP_PUBLIC_BASE_URL is required")),
    }
}

/// Required non-empty environment variable.
///
/// # Errors
///
/// When unset or blank.
pub fn require_env(name: &str) -> Result<String, ExampleError> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        _ => Err(ExampleError::new(format!("{name} is required"))),
    }
}

/// CORS router: `/mcp` plus a fallback so OAuth discovery and `/oauth/*` reach the host.
pub fn router(host: Arc<McpHttpServer>) -> Router {
    Router::new()
        .route("/mcp", any(forward_to_host))
        .fallback(forward_to_host)
        .layer(from_fn(cors_middleware))
        .with_state(AppState { host })
}

/// Bind `MCP_HOST`/`MCP_PORT` and serve.
///
/// # Errors
///
/// Env, bind, or serve failures.
pub async fn serve_http(source: SharedSource) -> Result<(), ExampleError> {
    let public_base_url = require_public_base_url(std::env::var("MCP_PUBLIC_BASE_URL").ok())?;
    let secret = require_env("SOLVAPAY_SECRET_KEY")?;
    let product = require_env("SOLVAPAY_PRODUCT")?;
    let mut config = solvapay::Config {
        api_key: secret,
        ..solvapay::Config::default()
    };
    let api_base = std::env::var("SOLVAPAY_API_BASE_URL")
        .ok()
        .map(|base| base.trim().to_owned())
        .filter(|base| !base.is_empty())
        .unwrap_or_else(|| "http://localhost:3010".to_owned());
    config.api_base_url = Some(api_base);
    let client = Client::new(config)
        .map_err(|e| ExampleError::new(format!("SolvaPay client: {}", e.message())))?;
    let mut server = McpHttpServer::new(
        client,
        solvapay_mcp::McpHttpConfig {
            product_ref: product.clone(),
            public_base_url: public_base_url.clone(),
            resource_uri: None,
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
            hs256_secret: std::env::var("SOLVAPAY_MCP_HS256_SECRET").ok(),
            jwks_json: None,
        },
    );
    register_tools(
        &mut server,
        &product,
        source,
        Arc::new(SessionStore::new()),
        system_now(),
    )
    .map_err(|e| ExampleError::new(e.to_string()))?;
    let addr = listen_addr(
        std::env::var("MCP_HOST").ok(),
        std::env::var("MCP_PORT").ok(),
    )?;
    let app = router(Arc::new(server));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| ExampleError::new(format!("bind {addr}: {e}")))?;
    eprintln!("guerrillamail-mcp public origin: {public_base_url}");
    eprintln!("guerrillamail-mcp MCP endpoint: {public_base_url}/mcp");
    eprintln!("guerrillamail-mcp product: {product}");
    eprintln!("listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .map_err(|e| ExampleError::new(format!("serve: {e}")))
}

/// Resolve the listen address. Blank/unset host is `127.0.0.1`; port defaults to `3030`.
///
/// # Errors
///
/// When the host/port pair does not resolve.
pub fn listen_addr(host: Option<String>, port: Option<String>) -> Result<SocketAddr, ExampleError> {
    let host = match host {
        Some(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => "127.0.0.1".to_owned(),
    };
    let port = match port {
        Some(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => "3030".to_owned(),
    };
    format!("{host}:{port}")
        .to_socket_addrs()
        .map_err(|e| ExampleError::new(format!("invalid MCP_HOST/MCP_PORT: {e}")))?
        .next()
        .ok_or_else(|| {
            ExampleError::new(format!("MCP_HOST/MCP_PORT did not resolve: {host}:{port}"))
        })
}

/// OPTIONS short-circuits; other responses get expose/origin headers.
async fn cors_middleware(req: Request<Body>, next: Next) -> Response {
    let origin = header_string(req.headers(), header::ORIGIN);
    let requested = header_string(req.headers(), header::ACCESS_CONTROL_REQUEST_HEADERS);
    if req.method() == Method::OPTIONS {
        return options_response(origin.as_deref(), requested.as_deref());
    }
    let mut response = next.run(req).await;
    apply_cors(response.headers_mut(), origin.as_deref(), None);
    response
}

/// CORS headers for a preflight response (Ruby example shape).
#[must_use]
pub fn options_response(origin: Option<&str>, requested_headers: Option<&str>) -> Response {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers, origin, Some(requested_headers));
    (StatusCode::NO_CONTENT, headers).into_response()
}

/// Stamp CORS headers. `preflight` is `Some` only for OPTIONS.
fn apply_cors(headers: &mut HeaderMap, origin: Option<&str>, preflight: Option<Option<&str>>) {
    insert_header(headers, "access-control-expose-headers", CORS_EXPOSE);
    if let Some(origin) = origin.filter(|o| !o.is_empty()) {
        insert_header(headers, "access-control-allow-origin", origin);
        insert_header(headers, "vary", "Origin");
    }
    if let Some(requested) = preflight {
        insert_header(headers, "access-control-allow-methods", CORS_ALLOW_METHODS);
        let allow = requested
            .filter(|s| !s.is_empty())
            .unwrap_or(CORS_DEFAULT_ALLOW_HEADERS);
        insert_header(headers, "access-control-allow-headers", allow);
        insert_header(headers, "access-control-max-age", "600");
    }
}

/// Insert a header when both name and value are valid.
fn insert_header(headers: &mut HeaderMap, name: &str, value: &str) {
    let Ok(name) = HeaderName::from_bytes(name.as_bytes()) else {
        return;
    };
    if let Ok(value) = HeaderValue::from_str(value) {
        headers.insert(name, value);
    }
}

/// Read a header as UTF-8 text.
fn header_string(headers: &HeaderMap, name: axum::http::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned)
}

/// Forward any path to [`McpHttpServer::handle`].
async fn forward_to_host(State(state): State<AppState>, req: Request<Body>) -> Response {
    match dispatch(&state.host, req).await {
        Ok(response) => mcp_to_axum(response),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.message().to_owned()).into_response(),
    }
}

/// Convert then dispatch. Transport failures become 500s at the handler.
async fn dispatch(
    host: &McpHttpServer,
    req: Request<Body>,
) -> Result<McpHttpResponse, ExampleError> {
    let mapped = to_mcp_request(req).await?;
    host.handle(mapped)
        .await
        .map_err(|e| ExampleError::new(e.message().to_owned()))
}

/// Convert an axum request into the facade request.
///
/// # Errors
///
/// When the body cannot be read.
pub async fn to_mcp_request(req: Request<Body>) -> Result<McpHttpRequest, ExampleError> {
    let method = req.method().as_str().to_owned();
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| req.uri().path().to_owned());
    let mut headers = BTreeMap::new();
    for (name, value) in req.headers() {
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_ascii_lowercase(), text.to_owned());
        }
    }
    let body = to_bytes(req.into_body(), 2 * 1024 * 1024)
        .await
        .map_err(|e| ExampleError::new(format!("read request body: {e}")))?
        .to_vec();
    Ok(McpHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

/// Map the facade response onto axum types.
fn mcp_to_axum(response: McpHttpResponse) -> Response {
    let status = StatusCode::from_u16(response.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut headers = HeaderMap::new();
    for (name, value) in response.headers {
        insert_header(&mut headers, &name, &value);
    }
    (status, headers, response.body).into_response()
}

#[cfg(test)]
#[allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]
mod tests {
    use super::*;

    #[test]
    fn missing_public_base_url_fails_loudly() {
        let err = require_public_base_url(None).expect_err("required");
        assert!(err.message().contains("MCP_PUBLIC_BASE_URL"));
        let err = require_public_base_url(Some("   ".to_owned())).expect_err("blank");
        assert!(err.message().contains("MCP_PUBLIC_BASE_URL"));
    }

    #[test]
    fn options_uses_ruby_cors_headers() {
        let response = options_response(
            Some("http://localhost:6274"),
            Some("authorization, content-type"),
        );
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "http://localhost:6274"
        );
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-methods")
                .unwrap(),
            CORS_ALLOW_METHODS
        );
        assert_eq!(
            response
                .headers()
                .get("access-control-expose-headers")
                .unwrap(),
            CORS_EXPOSE
        );
        assert_eq!(
            response.headers().get("access-control-max-age").unwrap(),
            "600"
        );
    }
}
