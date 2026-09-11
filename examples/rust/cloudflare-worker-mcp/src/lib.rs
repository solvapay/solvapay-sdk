//! SolvaPay MCP server — Cloudflare Workers (`workers-rs`) entrypoint.

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod http;

#[cfg(target_arch = "wasm32")]
mod fetch_source;

pub use http::{
    apply_browser_cors, lowercase_headers, mcp_request, preflight_response, require_binding,
    CORS_ALLOW_METHODS, CORS_DEFAULT_ALLOW_HEADERS, CORS_EXPOSE,
};

#[cfg(target_arch = "wasm32")]
mod worker_entry {
    //! Isolate fetch handler.

    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::Arc;

    use solvapay::{Client, Config, FetchTransport, SharedTransport};
    use solvapay_example_guerrillamail_mcp::session::SessionStore;
    use solvapay_example_guerrillamail_mcp::sources::{LIVE_AJAX_URL, SharedSource};
    use solvapay_example_guerrillamail_mcp::tools::register_tools;
    use solvapay_mcp::{McpHttpConfig, McpHttpServer};
    use worker::{event, Context, Env, Error, Request, Response, Result};

    use crate::fetch_source::FetchSource;

    use crate::http::{
        apply_browser_cors, lowercase_headers, mcp_request, preflight_response, require_binding,
    };

    thread_local! {
        static SERVER: RefCell<Option<Rc<McpHttpServer>>> = const { RefCell::new(None) };
    }

    fn binding(env: &Env, name: &str) -> Result<String> {
        let from_secret = env.secret(name).ok().map(|value| value.to_string());
        let from_var = env.var(name).ok().map(|value| value.to_string());
        require_binding(name, from_secret.or(from_var)).map_err(Error::RustError)
    }

    fn optional_binding(env: &Env, name: &str) -> Option<String> {
        env.secret(name)
            .ok()
            .map(|value| value.to_string())
            .or_else(|| env.var(name).ok().map(|value| value.to_string()))
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    }

    fn build_server(env: &Env) -> Result<McpHttpServer> {
        let api_key = binding(env, "SOLVAPAY_SECRET_KEY")?;
        let product_ref = binding(env, "SOLVAPAY_PRODUCT_REF")?;
        let public_base_url = binding(env, "MCP_PUBLIC_BASE_URL")?;
        let api_base_url = optional_binding(env, "SOLVAPAY_API_BASE_URL");
        #[allow(clippy::arc_with_non_send_sync)]
        let transport: SharedTransport = std::sync::Arc::new(FetchTransport::new());
        let client = Client::with_transport(
            transport,
            Config {
                api_key,
                api_base_url: api_base_url.clone(),
                ..Config::default()
            },
        );
        let mut server = McpHttpServer::new(
            client,
            McpHttpConfig {
                product_ref: product_ref.clone(),
                public_base_url,
                resource_uri: Some("ui://cloudflare-worker-mcp/mcp-app.html".to_owned()),
                mcp_path: Some("/mcp".to_owned()),
                views: None,
                oauth_paths: None,
                hs256_secret: None,
                jwks_json: None,
                hide_audiences: Some(vec!["ui".to_owned()]),
                api_base_url,
                csp: None,
                branding: None,
            },
        );
        #[allow(clippy::arc_with_non_send_sync)]
        let source: SharedSource = Arc::new(FetchSource::new(LIVE_AJAX_URL));
        register_tools(
            &mut server,
            &product_ref,
            source,
            Arc::new(SessionStore::new()),
            js_date_now(),
        )
        .map_err(|err| Error::RustError(err.to_string()))?;
        Ok(server)
    }

    fn js_date_now() -> solvapay_example_guerrillamail_mcp::clock::UnixNow {
        Arc::new(|| Ok((js_sys::Date::now() / 1000.0) as i64))
    }

    fn cached_server(env: &Env) -> Result<Rc<McpHttpServer>> {
        SERVER.with(|cell| {
            if cell.borrow().is_none() {
                let built = build_server(env)?;
                *cell.borrow_mut() = Some(Rc::new(built));
            }
            cell.borrow()
                .as_ref()
                .cloned()
                .ok_or_else(|| Error::RustError("handler cache missing after init".to_owned()))
        })
    }

    async fn to_mcp_request(mut req: Request) -> Result<solvapay_mcp::McpHttpRequest> {
        let method = req.method().as_ref().to_owned();
        let url = req.url()?;
        let path = format!("{}{}", url.path(), url.query().map(|q| format!("?{q}")).unwrap_or_default());
        let mut pairs = Vec::new();
        let headers = req.headers();
        for (name, value) in headers.entries() {
            pairs.push((name, value));
        }
        let body = req.bytes().await?;
        Ok(mcp_request(method, path, lowercase_headers(pairs), body))
    }

    fn to_worker_response(response: solvapay_mcp::McpHttpResponse) -> Result<Response> {
        let mut out = Response::from_bytes(response.body)?;
        out = out.with_status(response.status);
        let headers = worker::Headers::new();
        for (name, value) in response.headers {
            headers.set(&name, &value)?;
        }
        Ok(out.with_headers(headers))
    }

    #[event(fetch)]
    async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
        let origin = req.headers().get("origin")?;
        if req.method() == worker::Method::Options {
            return to_worker_response(preflight_response(
                origin.as_deref(),
                req.headers()
                    .get("access-control-request-method")?
                    .as_deref(),
                req.headers()
                    .get("access-control-request-headers")?
                    .as_deref(),
            ));
        }
        let server = cached_server(&env)?;
        let mapped = to_mcp_request(req).await?;
        let response = server
            .handle(mapped)
            .await
            .map_err(|err| Error::RustError(err.message().to_owned()))?;
        to_worker_response(apply_browser_cors(origin.as_deref(), response))
    }
}
