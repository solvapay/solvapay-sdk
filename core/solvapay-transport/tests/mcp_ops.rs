//! Wiremock-backed MCP composite ops on [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::Arc;

use serde_json::{json, Value};
use solvapay_mcp_core::{EngineConfig, McpAuthMode};
use solvapay_transport::{
    ClientShell, McpBootstrapParams, McpDispatchParams, McpOauthConfig, McpOauthRequestParams,
    McpReadResourceParams, McpResolveAuthParams, McpToolConfig, ReqwestTransport, SharedTransport,
    SolvaPayClient,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> SolvaPayClient {
    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("reqwest"));
    SolvaPayClient::new(ClientShell::new(transport, "sk_test_fixture").with_base_url(server.uri()))
}

#[tokio::test]
async fn mcp_bootstrap_unauthenticated_matches_widget_placeholders() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/platform-config"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "stripePublishableKey": "pk_test"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/merchant"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "displayName": "Acme"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/products/prd_demo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "name": "Demo" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/products/prd_demo/plans"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "plans": [{ "name": "Pro" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/checkout-sessions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "checkoutUrl": "https://checkout.example/s",
            "sessionId": "cs_1"
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .mcp_bootstrap(McpBootstrapParams {
            view: "account".to_owned(),
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            customer_ref: None,
        })
        .await
        .expect("bootstrap");

    assert_eq!(got["view"], "account");
    assert_eq!(got["productRef"], "prd_demo");
    assert_eq!(got["stripePublishableKey"], "pk_test");
    assert_eq!(got["returnUrl"], "https://app.example.com");
    assert_eq!(got["merchant"]["displayName"], "Acme");
    assert_eq!(got["product"]["name"], "Demo");
    assert_eq!(got["plans"][0]["name"], "Pro");
    assert_eq!(got["customer"], Value::Null);
    // A checkout session belongs to a customer record, so there is none to
    // mint for an anonymous caller: the backend would reject the ref.
    assert_eq!(got["checkoutUrl"], Value::Null);
    assert_eq!(got["portalUrl"], Value::Null);
    let requests = server.received_requests().await.expect("recording on");
    assert!(
        requests
            .iter()
            .all(|r| r.url.path() != "/v1/sdk/checkout-sessions"),
        "anonymous bootstrap must not mint a checkout session"
    );
    assert_eq!(got["autoRechargeUrl"], Value::Null);
    assert!(got["merchant"].get("identityDisplay").is_some());
    assert!(got["taxIdFields"]["DE"]["label"].is_string());
}

#[tokio::test]
async fn mcp_read_resource_overview() {
    let server = MockServer::start().await;
    let got = client(&server)
        .mcp_read_resource(McpReadResourceParams {
            uri: "docs://solvapay/overview.md".to_owned(),
            config: McpToolConfig {
                product_ref: "prd_demo".to_owned(),
                public_base_url: "https://app.example.com".to_owned(),
                resource_uri: None,
                views: None,
                mcp_path: None,
            },
            customer_ref: None,
        })
        .await
        .expect("overview");
    assert_eq!(got["uri"], "docs://solvapay/overview.md");
    assert_eq!(got["mimeType"], "text/markdown");
    assert!(got["body"].as_str().unwrap().contains("SolvaPay"));
}

#[tokio::test]
async fn mcp_dispatch_errors_on_widget_resource_read() {
    let server = MockServer::start().await;
    let err = client(&server)
        .mcp_dispatch(McpDispatchParams {
            rpc: json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": { "uri": "ui://widget.html" }
            }),
            config: EngineConfig {
                product_ref: "prd_demo".to_owned(),
                public_base_url: "https://app.example.com".to_owned(),
                resource_uri: "ui://widget.html".to_owned(),
                views: None,
                payable_tools: Vec::new(),
                auth_mode: Some(McpAuthMode::ToolsCall),
                mcp_path: None,
                hide_audiences: None,
                user_agent: None,
                csp: None,
                api_base_url: None,
                branding: None,
                jwks_json: None,
                hs256_secret: None,
                expected_issuer: None,
                expected_audience: None,
                now_unix_secs: None,
                pre_verified_customer_ref: None,
            },
            auth_header: None,
            mcp_protocol_version_header: None,
        })
        .await
        .expect_err("widget URI must fail in mcpDispatch");
    let message = err.message();
    assert!(
        message.contains("ui://widget.html") && message.contains("host"),
        "{message}"
    );
}

#[tokio::test]
async fn mcp_oauth_protected_resource_discovery() {
    let server = MockServer::start().await;
    let got = client(&server)
        .mcp_oauth_request(McpOauthRequestParams {
            method: "GET".to_owned(),
            path: "/.well-known/oauth-protected-resource".to_owned(),
            headers: Default::default(),
            body: String::new(),
            config: McpOauthConfig {
                public_base_url: "https://app.example.com".to_owned(),
                mcp_path: Some("/mcp".to_owned()),
                product_ref: "prd_demo".to_owned(),
                oauth_paths: None,
            },
        })
        .await
        .expect("oauth");
    assert_eq!(got["status"], 200);
    assert_eq!(got["body"]["bearer_methods_supported"], json!(["header"]));
    // Matches the oauth-proxy/discovery-protected-resource fixture: mcpPath
    // is part of the RFC 9728 resource identifier.
    assert_eq!(got["body"]["resource"], "https://app.example.com/mcp");
}

#[tokio::test]
async fn mcp_oauth_token_normalizes_upstream_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/customer/auth/token"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401,
            "message": "Unauthorized"
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .mcp_oauth_request(McpOauthRequestParams {
            method: "POST".to_owned(),
            path: "/oauth/token".to_owned(),
            headers: Default::default(),
            body: "grant_type=authorization_code".to_owned(),
            config: McpOauthConfig {
                public_base_url: "https://app.example.com".to_owned(),
                mcp_path: None,
                product_ref: "prd_demo".to_owned(),
                oauth_paths: None,
            },
        })
        .await
        .expect("token");
    assert_eq!(got["status"], 401);
    assert_eq!(got["body"]["error"], "invalid_client");
}

#[tokio::test]
async fn fetch_jwks_is_unauthenticated_get_and_requires_keys() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/.well-known/jwks.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "keys": [{ "kty": "RSA", "kid": "1" }]
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .fetch_jwks(solvapay_transport::FetchJwksParams {
            jwks_url: format!("{}/.well-known/jwks.json", server.uri()),
        })
        .await
        .expect("jwks");
    assert_eq!(got["keys"][0]["kid"], "1");

    let missing = client(&server)
        .fetch_jwks(solvapay_transport::FetchJwksParams {
            jwks_url: format!("{}/missing", server.uri()),
        })
        .await
        .expect_err("missing JWKS must fail");
    assert!(
        missing.message().contains("JWKS fetch failed"),
        "{}",
        missing.message()
    );
}

const HS256_SECRET: &str = "solvapay-mcp-fixture-hs256-secret-32b!!";
/// Signed with [`HS256_SECRET`]; `sub: cus_1`, `jti: jti_shared`.
const VALID_JTI_TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMSIsImlzcyI6Imh0dHBzOi8vbWNwLmV4YW1wbGUuY29tIiwiYXVkIjoiaHR0cHM6Ly9tY3AuZXhhbXBsZS5jb20iLCJleHAiOjQxMDI0NDQ4MDAsImp0aSI6Imp0aV9zaGFyZWQifQ.nb-j3Afl9NIVcN8GunYH7QuWcJzGOduTG-t5ipVvIy0";
/// Same `jti`, `sub: cus_attacker`, and a signature the secret never produced.
const FORGED_JTI_TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfYXR0YWNrZXIiLCJpc3MiOiJodHRwczovL21jcC5leGFtcGxlLmNvbSIsImF1ZCI6Imh0dHBzOi8vbWNwLmV4YW1wbGUuY29tIiwiZXhwIjo0MTAyNDQ0ODAwLCJqdGkiOiJqdGlfc2hhcmVkIn0.Zm9yZ2VkLXNpZ25hdHVyZS1ub3QtZnJvbS10aGUtc2VjcmV0";

fn resolve_auth_params(token: &str) -> McpResolveAuthParams {
    McpResolveAuthParams {
        rpc_method: Some("tools/call".to_owned()),
        auth_header: Some(format!("Bearer {token}")),
        auth_mode: Some(McpAuthMode::ToolsCall),
        public_base_url: "https://mcp.example.com".to_owned(),
        mcp_path: None,
        json_rpc_id: Some(json!(1)),
        hs256_secret: Some(HS256_SECRET.to_owned()),
        jwks_json: None,
    }
}

/// Regression: the verdict cache was keyed by the token's unverified `jti`, so
/// a forged token that copied a cached `jti` was allowed for up to 60 seconds
/// as the customer of the genuine token.
#[tokio::test]
async fn forged_token_reusing_a_cached_jti_is_rejected() {
    let server = MockServer::start().await;
    let sp = client(&server);

    let first = sp
        .mcp_resolve_auth(resolve_auth_params(VALID_JTI_TOKEN))
        .await
        .expect("valid token resolves");
    assert_eq!(first["kind"], "allow", "{first}");
    assert_eq!(first["customerRef"], "cus_1", "{first}");

    let forged = sp
        .mcp_resolve_auth(resolve_auth_params(FORGED_JTI_TOKEN))
        .await
        .expect("forged token resolves to a verdict");
    assert_ne!(
        forged["kind"], "allow",
        "forged token must not be allowed: {forged}"
    );
    assert!(
        forged.get("customerRef").is_none_or(Value::is_null),
        "{forged}"
    );

    // The genuine token is still served, now from the cache.
    let again = sp
        .mcp_resolve_auth(resolve_auth_params(VALID_JTI_TOKEN))
        .await
        .expect("valid token resolves again");
    assert_eq!(again["kind"], "allow", "{again}");
    assert_eq!(again["customerRef"], "cus_1", "{again}");
}

/// A cached verdict is bound to the audience it was verified against.
#[tokio::test]
async fn cached_verdict_does_not_cross_audiences() {
    let server = MockServer::start().await;
    let sp = client(&server);

    let first = sp
        .mcp_resolve_auth(resolve_auth_params(VALID_JTI_TOKEN))
        .await
        .expect("valid token resolves");
    assert_eq!(first["kind"], "allow", "{first}");

    let mut other = resolve_auth_params(VALID_JTI_TOKEN);
    other.public_base_url = "https://other.example.com".to_owned();
    let crossed = sp
        .mcp_resolve_auth(other)
        .await
        .expect("token resolves to a verdict");
    assert_ne!(crossed["kind"], "allow", "{crossed}");
}

/// Mounts the product-side stubs every bootstrap needs.
async fn mount_product_stubs(server: &MockServer) {
    for (route, body) in [
        (
            "/v1/sdk/platform-config",
            json!({ "stripePublishableKey": "pk_test" }),
        ),
        ("/v1/sdk/merchant", json!({ "displayName": "Acme" })),
        ("/v1/sdk/products/prd_demo", json!({ "name": "Demo" })),
        (
            "/v1/sdk/products/prd_demo/plans",
            json!({ "plans": [{ "reference": "pln_pro", "name": "Pro" }] }),
        ),
    ] {
        Mock::given(method("GET"))
            .and(path(route))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }
}

/// Mounts the customer-side stubs for `cus_1` with the given purchases and limits.
async fn mount_customer_stubs(server: &MockServer, customer: Value, limits: Value) {
    for (verb, route, body) in [
        ("GET", "/v1/sdk/customers/cus_1", customer),
        ("GET", "/v1/sdk/payment-method", json!({ "kind": "none" })),
        (
            "GET",
            "/v1/sdk/customers/cus_1/balance",
            json!({
                "credits": 0,
                "customerRef": "cus_1",
                "creditsPerMinorUnit": 100,
                "displayCurrency": "USD",
                "displayExchangeRate": 1
            }),
        ),
        ("POST", "/v1/sdk/limits", limits),
        (
            "POST",
            "/v1/sdk/checkout-sessions",
            json!({ "checkoutUrl": "https://checkout.example/s", "sessionId": "cs_1" }),
        ),
        (
            "POST",
            "/v1/sdk/customers/customer-sessions",
            json!({ "customerUrl": "https://portal.example/s", "sessionId": "ps_1" }),
        ),
    ] {
        Mock::given(method(verb))
            .and(path(route))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }
}

fn active_purchase() -> Value {
    json!({
        "reference": "pur_1",
        "status": "active",
        "productRef": "prd_demo",
        "planRef": "pln_pro",
        "planSnapshot": { "reference": "pln_pro", "name": "Pro", "requiresPayment": true },
        "usage": { "periodStart": "2026-07-01T00:00:00Z", "periodEnd": "2026-08-01T00:00:00Z" }
    })
}

fn bootstrap_params(customer_ref: Option<&str>) -> McpBootstrapParams {
    McpBootstrapParams {
        view: "account".to_owned(),
        product_ref: "prd_demo".to_owned(),
        public_base_url: "https://app.example.com".to_owned(),
        customer_ref: customer_ref.map(str::to_owned),
    }
}

/// `anonymous` is the sentinel the payable adapters use when no identity was
/// supplied. The backend has no such customer, so it must not reach any
/// customer-scoped read or a checkout session.
#[tokio::test]
async fn mcp_bootstrap_treats_the_anonymous_sentinel_as_unauthenticated() {
    for sentinel in ["anonymous", " anonymous ", "", "   "] {
        let server = MockServer::start().await;
        mount_product_stubs(&server).await;
        let got = client(&server)
            .mcp_bootstrap(bootstrap_params(Some(sentinel)))
            .await
            .expect("bootstrap");
        assert_eq!(got["customer"], Value::Null, "{sentinel:?}");
        assert_eq!(got["checkoutUrl"], Value::Null, "{sentinel:?}");
        assert_eq!(got["portalUrl"], Value::Null, "{sentinel:?}");
        let requests = server.received_requests().await.expect("recording on");
        for request in &requests {
            let route = request.url.path();
            assert!(
                !route.starts_with("/v1/sdk/customers")
                    && route != "/v1/sdk/limits"
                    && route != "/v1/sdk/checkout-sessions"
                    && route != "/v1/sdk/payment-method",
                "{sentinel:?} reached {route}"
            );
        }
    }
}

#[tokio::test]
async fn mcp_bootstrap_names_the_signed_in_customer_and_carries_limits() {
    let server = MockServer::start().await;
    mount_product_stubs(&server).await;
    mount_customer_stubs(
        &server,
        json!({
            "customerRef": "cus_1",
            "email": "  demo@acme.test ",
            "name": "   ",
            "purchases": [active_purchase()]
        }),
        json!({
            "withinLimits": true,
            "remaining": 40,
            "limit": 100,
            "used": 60,
            "meterName": "requests",
            "planRef": "pln_pro",
            "purchaseRef": "pur_1"
        }),
    )
    .await;

    let got = client(&server)
        .mcp_bootstrap(bootstrap_params(Some("  cus_1 ")))
        .await
        .expect("bootstrap");
    let customer = &got["customer"];
    assert_eq!(customer["ref"], "cus_1");
    assert_eq!(customer["email"], "demo@acme.test");
    assert_eq!(customer["name"], Value::Null, "a blank name is null");
    assert_eq!(customer["limits"]["remaining"], 40);
    assert_eq!(customer["canCall"], true);
    assert_eq!(customer["isCreditBased"], false);
    // Within limits: there is no next action to name.
    assert!(customer.get("nextAction").is_none(), "{customer}");
    // Consumption and the cap come from limits; the period from the purchase.
    assert_eq!(customer["usage"]["used"], 60);
    assert_eq!(customer["usage"]["total"], 100);
    assert_eq!(customer["usage"]["purchaseRef"], "pur_1");
    assert_eq!(customer["usage"]["periodEnd"], "2026-08-01T00:00:00Z");
    assert_eq!(got["checkoutUrl"], "https://checkout.example/s");

    // MCP has no browsable page to return to: the session carries no returnUrl.
    let requests = server.received_requests().await.expect("recording on");
    let checkout = requests
        .iter()
        .find(|r| r.url.path() == "/v1/sdk/checkout-sessions")
        .expect("checkout session minted for a signed-in customer");
    let body: Value = serde_json::from_slice(&checkout.body).expect("json body");
    assert_eq!(body["customerRef"], "cus_1");
    assert!(body.get("returnUrl").is_none_or(Value::is_null), "{body}");
}

#[tokio::test]
async fn mcp_bootstrap_leaves_usage_unmeasured_when_limits_fail() {
    let failing = MockServer::start().await;
    mount_product_stubs(&failing).await;
    for (verb, route, body) in [
        (
            "GET",
            "/v1/sdk/customers/cus_1",
            json!({ "customerRef": "cus_1", "purchases": [active_purchase()] }),
        ),
        ("GET", "/v1/sdk/payment-method", json!({ "kind": "none" })),
        (
            "GET",
            "/v1/sdk/customers/cus_1/balance",
            json!({ "credits": 5, "customerRef": "cus_1" }),
        ),
    ] {
        Mock::given(method(verb))
            .and(path(route))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&failing)
            .await;
    }
    Mock::given(method("POST"))
        .and(path("/v1/sdk/limits"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "message": "boom" })))
        .mount(&failing)
        .await;

    let got = client(&failing)
        .mcp_bootstrap(bootstrap_params(Some("cus_1")))
        .await
        .expect("bootstrap survives a failed limits read");
    let customer = &got["customer"];
    assert_eq!(customer["limits"], Value::Null);
    assert!(customer.get("canCall").is_none(), "{customer}");
    assert!(customer.get("nextAction").is_none(), "{customer}");
    // Unknown, never zero: the cap and consumption were not measured.
    assert_eq!(customer["usage"]["used"], Value::Null);
    assert_eq!(customer["usage"]["total"], Value::Null);
    assert_eq!(customer["usage"]["purchaseRef"], "pur_1");
}

/// The bootstrap resource carries the server's default view: the same choice
/// the viewer tool makes when `view` is omitted.
#[tokio::test]
async fn mcp_bootstrap_resource_stamps_the_default_view() {
    let read = |server: &MockServer, customer_ref: Option<&str>| {
        let sp = client(server);
        let customer_ref = customer_ref.map(str::to_owned);
        async move {
            sp.mcp_read_resource(McpReadResourceParams {
                uri: "solvapay://bootstrap.json".to_owned(),
                config: McpToolConfig {
                    product_ref: "prd_demo".to_owned(),
                    public_base_url: "https://app.example.com".to_owned(),
                    resource_uri: None,
                    views: None,
                    mcp_path: None,
                },
                customer_ref,
            })
            .await
            .expect("bootstrap resource")
        }
    };

    // No signed-in customer, so no active plan: checkout.
    let anonymous = MockServer::start().await;
    mount_product_stubs(&anonymous).await;
    assert_eq!(read(&anonymous, None).await["view"], "checkout");

    // Active plan blocked on a top-up gate: topup.
    let blocked = MockServer::start().await;
    mount_product_stubs(&blocked).await;
    mount_customer_stubs(
        &blocked,
        json!({ "customerRef": "cus_1", "purchases": [active_purchase()] }),
        json!({
            "withinLimits": false,
            "remaining": 0,
            "paywallReason": "topup_required",
            "creditBalance": 0,
            "creditsPerUnit": 100,
            "planRef": "pln_pro",
            "purchaseRef": "pur_1"
        }),
    )
    .await;
    let got = read(&blocked, Some("cus_1")).await;
    assert_eq!(got["view"], "topup");
    assert_eq!(got["customer"]["nextAction"], "topup");

    // Active plan, zero credits, within limits: account, not topup.
    let within = MockServer::start().await;
    mount_product_stubs(&within).await;
    mount_customer_stubs(
        &within,
        json!({ "customerRef": "cus_1", "purchases": [active_purchase()] }),
        json!({ "withinLimits": true, "remaining": 5, "planRef": "pln_pro", "purchaseRef": "pur_1" }),
    )
    .await;
    let got = read(&within, Some("cus_1")).await;
    assert_eq!(got["view"], "account");
    assert_eq!(got["customer"]["balance"]["credits"].as_f64(), Some(0.0));
}
