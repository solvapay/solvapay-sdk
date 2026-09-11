//! OAuth request/response JSON (`mcpOauthRequest`).

use serde_json::{json, Value};
use solvapay_core::SdkError;
use solvapay_mcp_core::{
    mcp_dcr_diagnostics, mcp_normalize_oauth_error, mcp_oauth_discovery, DcrDiagnosticsInput,
    OauthDiscoveryInput, OauthDiscoveryKind,
};

use super::{http_json_response, native_cors_headers, proxy_customer_auth, McpOauthRequestParams};
use crate::client::SolvaPayClient;
use crate::http::Method;
use crate::shell::encode_query_component;

fn path_only(path: &str) -> &str {
    path.split('?').next().unwrap_or(path)
}

fn query_suffix(path: &str) -> &str {
    path.split_once('?').map(|(_, q)| q).unwrap_or("")
}

pub(super) async fn handle(
    client: &SolvaPayClient,
    params: &McpOauthRequestParams,
) -> Result<Value, SdkError> {
    let method = params.method.to_ascii_uppercase();
    let path = path_only(&params.path);
    let origin = params.headers.get("origin").map(String::as_str);
    let cors = native_cors_headers(origin);

    if method == "OPTIONS" {
        let mut extra = cors;
        extra.push((
            "access-control-allow-methods".to_owned(),
            "GET, POST, OPTIONS".to_owned(),
        ));
        extra.push((
            "access-control-allow-headers".to_owned(),
            params
                .headers
                .get("access-control-request-headers")
                .cloned()
                .unwrap_or_else(|| "authorization, content-type".to_owned()),
        ));
        extra.push(("access-control-max-age".to_owned(), "600".to_owned()));
        let mut headers = serde_json::Map::new();
        for (k, v) in extra {
            headers.insert(k, Value::String(v));
        }
        return Ok(json!({
            "status": 204,
            "headers": headers,
            "body": null
        }));
    }

    if path == "/.well-known/openid-configuration" {
        if method != "GET" {
            return Ok(http_json_response(
                405,
                json!({ "error": "method_not_allowed" }),
                cors,
            ));
        }
        let mut headers = serde_json::Map::new();
        for (k, v) in cors {
            headers.insert(k, Value::String(v));
        }
        return Ok(json!({ "status": 404, "headers": headers, "body": null }));
    }

    if path == "/.well-known/oauth-protected-resource"
        || path.starts_with("/.well-known/oauth-protected-resource/")
    {
        if method != "GET" {
            return Ok(http_json_response(
                405,
                json!({ "error": "method_not_allowed" }),
                cors,
            ));
        }
        let body = mcp_oauth_discovery(&OauthDiscoveryInput {
            kind: OauthDiscoveryKind::ProtectedResource,
            public_base_url: params.config.public_base_url.clone(),
            mcp_path: params.config.mcp_path.clone(),
            paths: params.config.oauth_paths.clone(),
        });
        return Ok(http_json_response(200, body, cors));
    }

    if path == "/.well-known/oauth-authorization-server" {
        if method != "GET" {
            return Ok(http_json_response(
                405,
                json!({ "error": "method_not_allowed" }),
                cors,
            ));
        }
        let body = mcp_oauth_discovery(&OauthDiscoveryInput {
            kind: OauthDiscoveryKind::AuthorizationServer,
            public_base_url: params.config.public_base_url.clone(),
            mcp_path: params.config.mcp_path.clone(),
            paths: params.config.oauth_paths.clone(),
        });
        return Ok(http_json_response(200, body, cors));
    }

    if path == "/oauth/authorize" || path.ends_with("/oauth/authorize") {
        let qs = query_suffix(&params.path);
        let mut location = format!("{}/v1/customer/auth/authorize", client.shell().base_url());
        if !qs.is_empty() {
            location = format!("{location}?{qs}");
        }
        let mut headers = serde_json::Map::new();
        headers.insert("location".to_owned(), Value::String(location));
        for (k, v) in cors {
            headers.insert(k, Value::String(v));
        }
        return Ok(json!({ "status": 302, "headers": headers, "body": null }));
    }

    if method != "POST" {
        return Ok(http_json_response(
            405,
            json!({ "error": "method_not_allowed" }),
            cors,
        ));
    }

    if path == "/oauth/register" || path.ends_with("/oauth/register") {
        let encoded = encode_query_component(&params.config.product_ref);
        let upstream = format!("/v1/customer/auth/register?product_ref={encoded}");
        let response = match proxy_customer_auth(
            client,
            Method::Post,
            &upstream,
            &params.headers,
            &params.body,
        )
        .await
        {
            Ok(response) => response,
            Err(_) => {
                return Ok(http_json_response(
                    502,
                    json!({ "error": "upstream_unreachable" }),
                    cors,
                ))
            }
        };
        if !(200..300).contains(&response.status) {
            let text = String::from_utf8_lossy(&response.body).into_owned();
            let _ = mcp_dcr_diagnostics(&DcrDiagnosticsInput {
                product_ref: params.config.product_ref.clone(),
                api_base_url: client.shell().base_url().to_owned(),
                status: i64::from(response.status),
                body_text: text,
            });
        }
        return Ok(upstream_to_json(response, cors, false));
    }

    if path == "/oauth/token" || path.ends_with("/oauth/token") {
        return proxy_tokenish(client, "/v1/customer/auth/token", params, cors).await;
    }
    if path == "/oauth/revoke" || path.ends_with("/oauth/revoke") {
        return proxy_tokenish(client, "/v1/customer/auth/revoke", params, cors).await;
    }

    Ok(http_json_response(
        404,
        json!({ "error": "not_found" }),
        cors,
    ))
}

async fn proxy_tokenish(
    client: &SolvaPayClient,
    upstream_path: &str,
    params: &McpOauthRequestParams,
    cors: Vec<(String, String)>,
) -> Result<Value, SdkError> {
    let response = match proxy_customer_auth(
        client,
        Method::Post,
        upstream_path,
        &params.headers,
        &params.body,
    )
    .await
    {
        Ok(response) => response,
        Err(_) => {
            return Ok(http_json_response(
                502,
                json!({ "error": "upstream_unreachable" }),
                cors,
            ))
        }
    };
    Ok(upstream_to_json(response, cors, true))
}

fn upstream_to_json(
    response: crate::http::HttpResponse,
    cors: Vec<(String, String)>,
    oauth_normalize: bool,
) -> Value {
    let text = String::from_utf8_lossy(&response.body).into_owned();
    if response.status == 204 && text.is_empty() {
        let mut headers = serde_json::Map::new();
        for (k, v) in cors {
            headers.insert(k, Value::String(v));
        }
        return json!({ "status": 204, "headers": headers, "body": null });
    }
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::String(text.clone()));
    let body =
        if oauth_normalize && !(200..300).contains(&response.status) && response.status != 204 {
            mcp_normalize_oauth_error(&parsed, &text, i64::from(response.status))
        } else {
            parsed
        };
    http_json_response(response.status, body, cors)
}
