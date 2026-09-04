use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::middleware::{from_fn, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use futures::FutureExt;
use serde_json::{json, Map, Value};
use solvapay::{Client, Config};
use solvapay_mcp::{
    McpHttpConfig, McpHttpRequest, McpHttpResponse, McpHttpServer, PayableHandler, PayableTool,
};

#[derive(Clone)]
struct AppState {
    host: Arc<McpHttpServer>,
}

fn load_dotenv(path: &str) {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || !line.contains('=') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || std::env::var_os(key).is_some() {
            continue;
        }
        std::env::set_var(key, value.trim());
    }
}

fn require_env(name: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => {
            eprintln!("{name} is required");
            std::process::exit(1);
        }
    }
}

fn product_ref() -> String {
    let primary = std::env::var("SOLVAPAY_PRODUCT_REF").ok();
    let alias = std::env::var("SOLVAPAY_PRODUCT").ok();
    match primary.or(alias).map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()) {
        Some(value) => value,
        None => {
            eprintln!("SOLVAPAY_PRODUCT_REF is required — run `npx solvapay init`");
            std::process::exit(1);
        }
    }
}

fn listen_addr() -> SocketAddr {
    let host = std::env::var("MCP_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("MCP_PORT").unwrap_or_else(|_| "3030".into());
    format!("{host}:{port}")
        .parse()
        .unwrap_or_else(|_| "127.0.0.1:3030".parse().expect("fallback addr"))
}

fn placeholder_handler() -> PayableHandler {
    Arc::new(|args, mut ctx| {
        async move {
            let echoed = args
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("hello")
                .to_owned();
            ctx.respond(json!({ "ok": true, "echoed": echoed }), None)
        }
        .boxed()
    })
}

async fn forward(State(state): State<AppState>, req: Request<Body>) -> Response {
    match to_mcp_request(req).await {
        Ok(mapped) => match state.host.handle(mapped).await {
            Ok(response) => mcp_to_axum(response),
            Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.message().to_owned()).into_response(),
        },
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err).into_response(),
    }
}

async fn to_mcp_request(req: Request<Body>) -> Result<McpHttpRequest, String> {
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
        .map_err(|e| format!("read body: {e}"))?
        .to_vec();
    Ok(McpHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn mcp_to_axum(response: McpHttpResponse) -> Response {
    let status = StatusCode::from_u16(response.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut headers = HeaderMap::new();
    for (name, value) in response.headers {
        if let (Ok(n), Ok(v)) = (HeaderName::from_bytes(name.as_bytes()), HeaderValue::from_str(&value))
        {
            headers.insert(n, v);
        }
    }
    (status, headers, response.body).into_response()
}

async fn cors(req: Request<Body>, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned);
    if req.method() == Method::OPTIONS {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(
                "authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name",
            ),
        );
        if let Some(origin) = origin {
            if let Ok(value) = HeaderValue::from_str(&origin) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            }
        }
        return (StatusCode::NO_CONTENT, headers).into_response();
    }
    let mut response = next.run(req).await;
    if let Some(origin) = origin {
        if let Ok(value) = HeaderValue::from_str(&origin) {
            response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        }
    }
    response
}

#[tokio::main]
async fn main() {
    load_dotenv(".env");
    let secret = require_env("SOLVAPAY_SECRET_KEY");
    let product = product_ref();
    let public_base_url = require_env("MCP_PUBLIC_BASE_URL");
    let mut config = Config {
        api_key: secret,
        ..Config::default()
    };
    if let Ok(base) = std::env::var("SOLVAPAY_API_BASE_URL") {
        if !base.trim().is_empty() {
            config.api_base_url = Some(base.trim().to_owned());
        }
    }
    let client = match Client::new(config) {
        Ok(client) => client,
        Err(err) => {
            eprintln!("SolvaPay client: {}", err.message());
            std::process::exit(1);
        }
    };
    let mut server = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: product.clone(),
            public_base_url: public_base_url.clone(),
            resource_uri: None,
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
            hs256_secret: None,
            jwks_json: None,
        },
    );
    let mut fields = Map::new();
    fields.insert("message".into(), json!({ "type": "string" }));
    if let Err(err) = server.register_payable(
        PayableTool {
            name: "__TOOL_NAME__".into(),
            product,
            title: Some("__TOOL_NAME__".into()),
            description: Some("Placeholder paid tool — echoes the input message.".into()),
            input_schema: Some(fields),
            usage_type: None,
        },
        placeholder_handler(),
        None,
    ) {
        eprintln!("{err}");
        std::process::exit(1);
    }

    let addr = listen_addr();
    let app = Router::new()
        .route("/mcp", any(forward))
        .fallback(forward)
        .layer(from_fn(cors))
        .with_state(AppState {
            host: Arc::new(server),
        });
    eprintln!("__SERVER_NAME__ listening on http://{addr}/mcp");
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("bind {addr}: {err}");
            std::process::exit(1);
        }
    };
    if let Err(err) = axum::serve(listener, app).await {
        eprintln!("serve: {err}");
        std::process::exit(1);
    }
}
