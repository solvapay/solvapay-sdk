//! Wiremock-backed agent payment ops on [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use serde_json::{json, Value};
use solvapay_transport::{
    AgentAuthorizeParams, AgentBeginCallParams, AgentCompleteParams, AgentFinishCallParams,
    AgentGateParams, AgentIdentifyParams, AgentMcpRouteParams, AgentReportUsageParams,
    AgentVerifyKeyParams, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PROVIDER: &str = "prov_W3TLPNOA";
const AGENT_KEY: &str = "agk_sandbox_TESTKEY0000000000000000000000000000000000";
const START_MS: u64 = 1_700_000_000_000;

/// A client on a clock the test owns. Sleeping advances the clock and returns at once.
fn client_with_key(server: &MockServer, secret_key: &str) -> (SolvaPayClient, Arc<AtomicU64>) {
    let clock = Arc::new(AtomicU64::new(START_MS));
    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("reqwest"));
    let read = Arc::clone(&clock);
    let advance = Arc::clone(&clock);
    let shell = ClientShell::new(transport, secret_key)
        .with_base_url(server.uri())
        .with_clock(Arc::new(move || read.load(Ordering::SeqCst)))
        .with_sleeper(Arc::new(move |duration| {
            let advance = Arc::clone(&advance);
            Box::pin(async move {
                let ms = u64::try_from(duration.as_millis()).unwrap();
                advance.fetch_add(ms, Ordering::SeqCst);
            })
        }));
    (SolvaPayClient::new(shell), clock)
}

fn client(server: &MockServer) -> (SolvaPayClient, Arc<AtomicU64>) {
    client_with_key(server, "sk_sandbox_fixture")
}

fn base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[usize::from(b0 >> 2)] as char);
        out.push(TABLE[usize::from((b0 & 0x03) << 4 | b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(TABLE[usize::from((b1 & 0x0f) << 2 | b2 >> 6)] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[usize::from(b2 & 0x3f)] as char);
        }
    }
    out
}

fn signing_key() -> SigningKey {
    SigningKey::from_slice(&[7_u8; 32]).unwrap()
}

fn jwks(kid: &str) -> Value {
    let point = signing_key().verifying_key().to_encoded_point(false);
    json!({ "keys": [{
        "kty": "EC", "crv": "P-256", "kid": kid, "alg": "ES256", "use": "sig",
        "x": base64url(point.x().unwrap()),
        "y": base64url(point.y().unwrap()),
    }] })
}

fn issuer(server: &MockServer) -> String {
    format!("{}/v1/agent", server.uri())
}

/// An agent token for the test agent, valid at the test clock.
fn agent_token(issuer: &str, kid: &str, overrides: Value) -> String {
    let now = i64::try_from(START_MS / 1000).unwrap();
    let mut claims = json!({
        "iss": issuer, "aud": PROVIDER, "sub": "agt_TESTAGNT",
        "principal": "ppl_ABCDEFGHIJKLMNOP", "scope": "usage", "env": "sandbox",
        "jti": "tok_1", "iat": now, "exp": now + 900,
    });
    for (key, value) in overrides.as_object().unwrap() {
        claims[key] = value.clone();
    }
    let header = base64url(json!({ "alg": "ES256", "kid": kid }).to_string().as_bytes());
    let payload = base64url(claims.to_string().as_bytes());
    let signature: Signature = signing_key().sign(format!("{header}.{payload}").as_bytes());
    format!("{header}.{payload}.{}", base64url(&signature.to_bytes()))
}

fn verified_key() -> Value {
    json!({
        "agentRef": "agt_TESTAGNT",
        "principalRef": "ppl_ABCDEFGHIJKLMNOP",
        "promptExcerpt": false,
        "environment": "sandbox",
    })
}

fn allowed(call_ref: &str) -> Value {
    json!({
        "status": "allowed",
        "callRef": call_ref,
        "reservation": {
            "held": { "amount": "0.25", "currency": "USD" },
            "expiresAt": "2026-01-01T00:30:00.000Z",
        },
    })
}

fn waiting() -> Value {
    json!({
        "status": "waiting",
        "callRef": "call_TEST0001",
        "message": "Approval apr_TESTAPR1 for more budget is waiting for your owner.",
        "approval": { "reference": "apr_TESTAPR1", "expiresAt": "2026-01-01T00:15:00.000Z" },
        "retryAfterSeconds": 1,
    })
}

fn begin_params(max_wait_seconds: f64) -> AgentBeginCallParams {
    AgentBeginCallParams {
        request_id: "req_1".to_owned(),
        agent_token: "tok".to_owned(),
        agent: verified_key(),
        item: "model-x".to_owned(),
        estimate: json!({ "amount": "0.25", "currency": "USD" }),
        prompt: None,
        max_wait_seconds,
    }
}

fn identify_params(presented_key: &str, issuer: &str) -> AgentIdentifyParams {
    AgentIdentifyParams {
        presented_key: presented_key.to_owned(),
        issuer: issuer.to_owned(),
        provider_ref: PROVIDER.to_owned(),
        ..AgentIdentifyParams::default()
    }
}

async fn mount_authorize(server: &MockServer, status: u16, body: Value, times: Option<u64>) {
    let mock = Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/calls"))
        .respond_with(ResponseTemplate::new(status).set_body_json(body));
    match times {
        Some(times) => mock.up_to_n_times(times).mount(server).await,
        None => mock.mount(server).await,
    }
}

async fn authorize_bodies(server: &MockServer) -> Vec<Value> {
    server
        .received_requests()
        .await
        .expect("recording on")
        .iter()
        .filter(|request| request.url.path() == "/v1/sdk/agent/calls")
        .map(|request| serde_json::from_slice(&request.body).unwrap())
        .collect()
}

#[tokio::test]
async fn verify_key_reads_the_agent_strictly() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .and(body_json(json!({ "agentKey": AGENT_KEY })))
        .respond_with(ResponseTemplate::new(200).set_body_json(verified_key()))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_verify_key(AgentVerifyKeyParams {
            agent_key: AGENT_KEY.to_owned(),
        })
        .await
        .expect("verify");
    assert_eq!(got, verified_key());
}

#[tokio::test]
async fn verify_key_fails_on_a_misread_answer_and_carries_the_status() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "agentRef": "agt_1" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(401).set_body_string("unknown key"))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let params = AgentVerifyKeyParams {
        agent_key: AGENT_KEY.to_owned(),
    };
    let misread = client.agent_verify_key(params.clone()).await.unwrap_err();
    assert_eq!(misread.message(), "principalRef must be a non-empty string");
    let refused = client.agent_verify_key(params).await.unwrap_err();
    assert_eq!(
        refused.message(),
        "POST /v1/sdk/agent/keys/verifications failed (401): unknown key"
    );
}

#[tokio::test]
async fn authorize_sends_the_body_and_reads_the_answer() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, allowed("call_TEST0001"), None).await;
    let (client, _) = client(&server);
    let got = client
        .agent_authorize(AgentAuthorizeParams {
            agent_token: "tok".to_owned(),
            request_id: "req_1".to_owned(),
            item: Some("model-x".to_owned()),
            estimate: json!({ "amount": "0.25", "currency": "USD" }),
            prompt_hash: Some("sha256:abc".to_owned()),
            tool_error: Some(false),
            prompt_excerpt: None,
            wait: 20,
        })
        .await
        .expect("authorize");
    assert_eq!(got, allowed("call_TEST0001"));
    assert_eq!(
        authorize_bodies(&server).await,
        vec![json!({
            "agentToken": "tok",
            "requestId": "req_1",
            "item": "model-x",
            "estimate": { "amount": "0.25", "currency": "USD" },
            "promptHash": "sha256:abc",
            "toolError": false,
            "wait": 20,
        })]
    );
}

#[tokio::test]
async fn complete_encodes_the_call_ref_and_sends_a_null_cost() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/calls/call%2F1/complete"))
        .and(body_json(
            json!({ "status": 502, "cost": null, "interrupted": "upstream_unreachable" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "callRef": "call/1",
            "settled": false,
            "source": "none",
            "amount": { "amount": "0", "currency": "USD" },
            "duplicate": false,
        })))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_complete(AgentCompleteParams {
            call_ref: "call/1".to_owned(),
            status: json!(502),
            cost: None,
            interrupted: Some("upstream_unreachable".to_owned()),
        })
        .await
        .expect("complete");
    assert_eq!(got["settled"], false);
    assert_eq!(got["source"], "none");
}

#[tokio::test]
async fn report_usage_posts_the_report_and_reads_the_results() {
    let server = MockServer::start().await;
    let report = json!({
        "reportId": "rep_1",
        "customerRef": "cus_TESTCUST",
        "source": "opper:/v2/analytics/usage",
        "window": { "from": "2026-01-01T00:00:00Z", "to": "2026-01-02T00:00:00Z" },
        "currency": "USD",
        "calls": [{ "callRef": "call_TEST0001", "cost": "0.1" }],
        "untagged": [],
    });
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/usage-reports"))
        .and(body_json(report))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "reference": "urp_TEST0001",
            "currency": "USD",
            "duplicate": false,
            "results": [{ "callRef": "call_TEST0001", "result": "matched", "reported": "0.1" }],
            "untagged": { "total": "0", "beforePolicy": "0", "flagged": false },
        })))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_report_usage(AgentReportUsageParams {
            report_id: "rep_1".to_owned(),
            customer_ref: "cus_TESTCUST".to_owned(),
            source: "opper:/v2/analytics/usage".to_owned(),
            window: json!({ "from": "2026-01-01T00:00:00Z", "to": "2026-01-02T00:00:00Z" }),
            currency: "USD".to_owned(),
            calls: vec![json!({ "callRef": "call_TEST0001", "cost": "0.1" })],
            untagged: Vec::new(),
        })
        .await
        .expect("report");
    assert_eq!(got["reference"], "urp_TEST0001");
    assert_eq!(got["results"][0]["result"], "matched");
    assert_eq!(got["untagged"]["flagged"], false);
}

#[tokio::test]
async fn identify_leaves_a_merchant_key_alone() {
    let server = MockServer::start().await;
    let (client, _) = client(&server);
    let got = client
        .agent_identify(identify_params(
            "sk_live_merchants_own_key",
            &issuer(&server),
        ))
        .await
        .expect("identify");
    assert_eq!(got, json!({ "kind": "not_agent" }));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn identify_verifies_a_token_against_the_issuer_keys_and_caches_them() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/agent/jwks.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(jwks("k1")))
        .mount(&server)
        .await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let token = agent_token(&issuer, "k1", json!({ "px": true }));
    for _ in 0..2 {
        let got = client
            .agent_identify(identify_params(&token, &issuer))
            .await
            .expect("identify");
        assert_eq!(got["kind"], "agent", "{got}");
        assert_eq!(got["agent"]["agentRef"], "agt_TESTAGNT");
        assert_eq!(got["agent"]["promptExcerpt"], true);
        assert_eq!(got["agent"]["environment"], "sandbox");
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn identify_refetches_keys_when_the_issuer_rotated() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/agent/jwks.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(jwks("old")))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/agent/jwks.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(jwks("k2")))
        .mount(&server)
        .await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let got = client
        .agent_identify(identify_params(
            &agent_token(&issuer, "k2", json!({})),
            &issuer,
        ))
        .await
        .expect("identify");
    assert_eq!(got["kind"], "agent", "{got}");
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn identify_rejects_bad_tokens_with_the_reason() {
    let server = MockServer::start().await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let now = i64::try_from(START_MS / 1000).unwrap();
    let cases = [
        (json!({ "exp": now - 60 }), "expired"),
        (json!({ "aud": "prov_OTHER" }), "invalid"),
        (json!({ "env": "live" }), "environment_mismatch"),
    ];
    for (overrides, reason) in cases {
        let mut params = identify_params(&agent_token(&issuer, "k1", overrides), &issuer);
        params.jwks_json = Some(jwks("k1"));
        let got = client.agent_identify(params).await.expect("identify");
        assert_eq!(got["kind"], "rejected", "{got}");
        assert_eq!(got["reason"], reason, "{got}");
    }
}

#[tokio::test]
async fn identify_accepts_the_oauth_resource_as_audience() {
    let server = MockServer::start().await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let token = agent_token(
        &issuer,
        "k1",
        json!({ "aud": "https://mcp.example.com/mcp", "cid": "oac_1" }),
    );
    let mut params = identify_params(&token, &issuer);
    params.jwks_json = Some(jwks("k1"));
    params.resource = Some("HTTPS://mcp.example.com/mcp/".to_owned());
    let got = client.agent_identify(params).await.expect("identify");
    assert_eq!(got["agent"]["clientId"], "oac_1", "{got}");
}

#[tokio::test]
async fn identify_treats_unreachable_keys_as_an_invalid_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/agent/jwks.json"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let got = client
        .agent_identify(identify_params(
            &agent_token(&issuer, "k1", json!({})),
            &issuer,
        ))
        .await
        .expect("identify");
    assert_eq!(got["kind"], "rejected");
    assert_eq!(got["reason"], "invalid");
}

#[tokio::test]
async fn identify_asks_solvapay_about_a_key_once_per_thirty_seconds() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(verified_key()))
        .mount(&server)
        .await;
    let (client, clock) = client(&server);
    let params = identify_params(AGENT_KEY, &issuer(&server));
    for _ in 0..2 {
        let got = client
            .agent_identify(params.clone())
            .await
            .expect("identify");
        assert_eq!(got["kind"], "agent");
        assert_eq!(got["agent"]["agentRef"], "agt_TESTAGNT");
        assert!(got["agent"].get("tokenId").is_none());
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    clock.fetch_add(30_000, Ordering::SeqCst);
    client.agent_identify(params).await.expect("identify");
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn identify_rejects_an_unknown_key_and_reuses_the_rejection() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(401).set_body_string("unknown"))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let params = identify_params(AGENT_KEY, &issuer(&server));
    for _ in 0..2 {
        let got = client
            .agent_identify(params.clone())
            .await
            .expect("identify");
        assert_eq!(got["kind"], "rejected");
        assert_eq!(got["reason"], "invalid");
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn identify_reads_the_other_environment_from_a_403_or_the_secret_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(
            ResponseTemplate::new(403).set_body_string("{\"code\":\"environment_mismatch\"}"),
        )
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_identify(identify_params(AGENT_KEY, &issuer(&server)))
        .await
        .expect("identify");
    assert_eq!(got["reason"], "environment_mismatch");

    let live_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(verified_key()))
        .mount(&live_server)
        .await;
    let (live_client, _) = client_with_key(&live_server, "sk_live_fixture");
    let got = live_client
        .agent_identify(identify_params(AGENT_KEY, &issuer(&live_server)))
        .await
        .expect("identify");
    assert_eq!(got["reason"], "environment_mismatch");
    assert_eq!(
        got["detail"],
        "This agent spends in sandbox, and this secret key is for live"
    );
}

#[tokio::test]
async fn identify_fails_when_solvapay_is_out_of_reach_and_does_not_cache_it() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/keys/verifications"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let params = identify_params(AGENT_KEY, &issuer(&server));
    assert!(client.agent_identify(params.clone()).await.is_err());
    assert!(client.agent_identify(params).await.is_err());
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn begin_call_allows_and_sends_no_excerpt_without_opt_in() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, allowed("call_TEST0001"), None).await;
    let (client, _) = client(&server);
    let mut params = begin_params(0.0);
    params.prompt =
        Some(json!({ "promptHash": "sha256:abc", "toolError": true, "excerpt": "the end" }));
    let got = client.agent_begin_call(params).await.expect("begin");
    assert_eq!(got["kind"], "allow");
    assert_eq!(got["callRef"], "call_TEST0001");
    assert_eq!(got["item"], "model-x");
    assert_eq!(got["reservation"]["held"]["amount"], "0.25");
    let bodies = authorize_bodies(&server).await;
    assert_eq!(bodies.len(), 1);
    assert_eq!(bodies[0]["promptHash"], "sha256:abc");
    assert_eq!(bodies[0]["toolError"], true);
    assert!(bodies[0].get("promptExcerpt").is_none());
    assert_eq!(bodies[0]["wait"], 0);
}

#[tokio::test]
async fn begin_call_sends_the_excerpt_when_the_owner_opted_in() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, allowed("call_TEST0001"), None).await;
    let (client, _) = client(&server);
    let mut params = begin_params(0.0);
    params.agent["promptExcerpt"] = json!(true);
    params.prompt =
        Some(json!({ "promptHash": "sha256:abc", "toolError": false, "excerpt": "the end" }));
    client.agent_begin_call(params).await.expect("begin");
    assert_eq!(
        authorize_bodies(&server).await[0]["promptExcerpt"],
        "the end"
    );
}

#[tokio::test]
async fn begin_call_waits_for_the_owner_then_allows() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, waiting(), Some(2)).await;
    mount_authorize(&server, 200, allowed("call_TEST0001"), None).await;
    let (client, clock) = client(&server);
    let got = client
        .agent_begin_call(begin_params(120.0))
        .await
        .expect("begin");
    assert_eq!(got["kind"], "allow");
    // Two waiting answers, one second of sleep after each.
    assert_eq!(clock.load(Ordering::SeqCst), START_MS + 2000);
    let waits: Vec<Value> = authorize_bodies(&server)
        .await
        .iter()
        .map(|body| body["wait"].clone())
        .collect();
    assert_eq!(waits, vec![json!(55), json!(55), json!(55)]);
}

#[tokio::test]
async fn begin_call_refuses_with_ask_when_the_merchant_does_not_wait() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, waiting(), None).await;
    let (client, clock) = client(&server);
    let got = client
        .agent_begin_call(begin_params(0.0))
        .await
        .expect("begin");
    assert_eq!(got["kind"], "refused");
    assert_eq!(got["reason"], "ask");
    assert_eq!(
        got["message"],
        "Approval apr_TESTAPR1 for more budget is waiting for your owner."
    );
    assert_eq!(got["log"]["approvalRef"], "apr_TESTAPR1");
    assert_eq!(clock.load(Ordering::SeqCst), START_MS);
    assert_eq!(authorize_bodies(&server).await.len(), 1);
}

#[tokio::test]
async fn begin_call_times_out_when_the_owner_never_answers() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, waiting(), None).await;
    let (client, clock) = client(&server);
    let got = client
        .agent_begin_call(begin_params(3.0))
        .await
        .expect("begin");
    assert_eq!(got["reason"], "approval_timed_out");
    assert_eq!(clock.load(Ordering::SeqCst), START_MS + 3000);
    let waits: Vec<Value> = authorize_bodies(&server)
        .await
        .iter()
        .map(|body| body["wait"].clone())
        .collect();
    assert_eq!(waits, vec![json!(3), json!(2), json!(1), json!(0)]);
}

#[tokio::test]
async fn begin_call_passes_solvapays_refusal_through() {
    let server = MockServer::start().await;
    mount_authorize(
        &server,
        200,
        json!({
            "status": "refused",
            "callRef": "call_TEST0001",
            "reason": "deny",
            "message": "This call could cost about $0.31, over the per-call cap of $0.25.",
        }),
        None,
    )
    .await;
    let (client, _) = client(&server);
    let got = client
        .agent_begin_call(begin_params(60.0))
        .await
        .expect("begin");
    assert_eq!(got["reason"], "deny");
    assert_eq!(
        got["message"],
        "This call could cost about $0.31, over the per-call cap of $0.25."
    );
}

#[tokio::test]
async fn begin_call_never_lets_a_call_through_on_failure() {
    for (status, reason) in [
        (401, "agent_not_accepted"),
        (403, "agent_not_accepted"),
        (500, "unavailable"),
    ] {
        let server = MockServer::start().await;
        mount_authorize(&server, status, json!({ "error": "x" }), None).await;
        let (client, _) = client(&server);
        let got = client
            .agent_begin_call(begin_params(60.0))
            .await
            .expect("begin");
        assert_eq!(got["kind"], "refused", "{status}");
        assert_eq!(got["reason"], reason, "{status}");
        assert_eq!(got["log"]["status"], status);
        assert_eq!(authorize_bodies(&server).await.len(), 1, "{status}");
    }
    // A 200 that does not read is not an allow.
    let server = MockServer::start().await;
    mount_authorize(
        &server,
        200,
        json!({ "status": "allowed", "callRef": "call_1" }),
        None,
    )
    .await;
    let (client, _) = client(&server);
    let got = client
        .agent_begin_call(begin_params(0.0))
        .await
        .expect("begin");
    assert_eq!(got["reason"], "unavailable");
}

#[tokio::test]
async fn finish_call_completes_at_the_reported_cost() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/calls/call_TEST0001/complete"))
        .and(body_json(
            json!({ "status": 200, "cost": { "amount": "0.1", "currency": "USD" } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "callRef": "call_TEST0001",
            "settled": true,
            "source": "reported",
            "amount": { "amount": "0.1", "currency": "USD" },
            "duplicate": false,
        })))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_finish_call(AgentFinishCallParams {
            call_ref: "call_TEST0001".to_owned(),
            status: Some(json!(200)),
            cost: Some(json!({ "amount": 0.1, "currency": "USD" })),
            interrupted: None,
            release: None,
        })
        .await
        .expect("finish");
    assert_eq!(got["completed"]["source"], "reported");
    assert_eq!(got["failure"], Value::Null);
}

#[tokio::test]
async fn finish_call_releases_and_reports_a_failure_instead_of_failing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sdk/agent/calls/call_TEST0001/complete"))
        .and(body_json(
            json!({ "status": 502, "cost": null, "interrupted": "upstream_unreachable" }),
        ))
        .respond_with(ResponseTemplate::new(500).set_body_string("down"))
        .mount(&server)
        .await;
    let (client, _) = client(&server);
    let got = client
        .agent_finish_call(AgentFinishCallParams {
            call_ref: "call_TEST0001".to_owned(),
            status: None,
            cost: None,
            interrupted: None,
            release: Some("upstream_unreachable".to_owned()),
        })
        .await
        .expect("finish");
    assert_eq!(got["completed"], Value::Null);
    assert_eq!(got["failure"]["status"], 500);
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

fn gate_params(presented_key: &str, issuer: &str) -> AgentGateParams {
    AgentGateParams {
        presented_key: presented_key.to_owned(),
        request_id: "req_1".to_owned(),
        item: "model-x".to_owned(),
        estimate: json!({ "amount": "0.25", "currency": "USD" }),
        prompt: None,
        max_wait_seconds: 0.0,
        issuer: issuer.to_owned(),
        provider_ref: PROVIDER.to_owned(),
        jwks_json: Some(jwks("k1")),
        accept_agent_keys: None,
        environment: None,
        protected_resource: None,
    }
}

#[tokio::test]
async fn gate_leaves_other_keys_alone_and_allows_a_verified_agent() {
    let server = MockServer::start().await;
    mount_authorize(&server, 200, allowed("call_TEST0001"), None).await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let other = client
        .agent_gate(gate_params("sk_live_merchants_own_key", &issuer))
        .await
        .expect("gate");
    assert_eq!(other, json!({ "kind": "not_agent" }));

    let token = agent_token(&issuer, "k1", json!({}));
    let got = client
        .agent_gate(gate_params(&token, &issuer))
        .await
        .expect("gate");
    assert_eq!(got["kind"], "allowed", "{got}");
    assert_eq!(got["allowed"]["callRef"], "call_TEST0001");
    assert_eq!(got["agent"]["agentRef"], "agt_TESTAGNT");
    // SolvaPay verifies the presented token again.
    assert_eq!(authorize_bodies(&server).await[0]["agentToken"], token);
}

#[tokio::test]
async fn gate_rejects_a_bad_token_with_a_challenge_when_oauth_is_on() {
    let server = MockServer::start().await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let mut params = gate_params(
        &agent_token(&issuer, "k1", json!({ "scope": "admin" })),
        &issuer,
    );
    params.protected_resource = Some(json!({
        "resource": "https://api.example.com/v1",
        "authorizationServer": issuer,
    }));
    let got = client.agent_gate(params).await.expect("gate");
    assert_eq!(got["kind"], "rejected");
    assert_eq!(got["status"], 401);
    assert_eq!(got["detail"], "scope is not usage");
    assert!(got["challenge"]["WWW-Authenticate"]
        .as_str()
        .unwrap()
        .contains(
            "resource_metadata=\"https://api.example.com/.well-known/oauth-protected-resource/v1\""
        ));
    assert!(authorize_bodies(&server).await.is_empty());
}

#[tokio::test]
async fn gate_maps_a_refusal_to_its_status_and_body() {
    let server = MockServer::start().await;
    mount_authorize(
        &server,
        200,
        json!({
            "status": "refused",
            "callRef": "call_TEST0001",
            "reason": "topup_required",
            "message": "Top up to continue.",
        }),
        None,
    )
    .await;
    let issuer = issuer(&server);
    let (client, _) = client(&server);
    let got = client
        .agent_gate(gate_params(&agent_token(&issuer, "k1", json!({})), &issuer))
        .await
        .expect("gate");
    assert_eq!(got["kind"], "refused");
    assert_eq!(got["status"], 402);
    assert_eq!(
        got["body"],
        json!({ "error": { "type": "topup_required", "message": "Top up to continue." } })
    );
}

fn route_params(
    server: &MockServer,
    authorization: Option<String>,
    body: Value,
) -> AgentMcpRouteParams {
    AgentMcpRouteParams {
        method: "POST".to_owned(),
        path: "/mcp".to_owned(),
        authorization,
        body: Some(body),
        issuer: issuer(server),
        provider_ref: PROVIDER.to_owned(),
        mcp_path: "/mcp".to_owned(),
        server_name: "Example".to_owned(),
        protected_resource: Some(json!({ "resource": "https://mcp.example.com/mcp" })),
        lazy_auth: None,
        paid_tools: vec!["paid".to_owned()],
        jwks_json: Some(jwks("k1")),
        accept_agent_keys: None,
        environment: None,
    }
}

#[tokio::test]
async fn mcp_route_serves_a_verified_agent_and_challenges_an_expired_one() {
    let server = MockServer::start().await;
    let (client, _) = client(&server);
    let call =
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "paid" } });
    let token = agent_token(
        &issuer(&server),
        "k1",
        json!({ "aud": "https://mcp.example.com/mcp" }),
    );
    let got = client
        .agent_mcp_route(route_params(
            &server,
            Some(format!("Bearer {token}")),
            call.clone(),
        ))
        .await
        .expect("route");
    assert_eq!(got["kind"], "agent", "{got}");
    assert_eq!(got["agentToken"], token);
    assert_eq!(got["agent"]["agentRef"], "agt_TESTAGNT");

    let now = i64::try_from(START_MS / 1000).unwrap();
    let expired = agent_token(&issuer(&server), "k1", json!({ "exp": now - 60 }));
    let got = client
        .agent_mcp_route(route_params(
            &server,
            Some(format!("Bearer {expired}")),
            call,
        ))
        .await
        .expect("route");
    assert_eq!(got["kind"], "response");
    assert_eq!(got["status"], 401);
    assert_eq!(got["body"]["id"], 4);
    assert_eq!(
        got["body"]["error"]["message"],
        "The sign-in has expired: sign in again"
    );
}

#[tokio::test]
async fn mcp_route_lists_for_anonymous_hosts_and_challenges_paid_calls() {
    let server = MockServer::start().await;
    let (client, _) = client(&server);
    let listing = client
        .agent_mcp_route(route_params(
            &server,
            None,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        ))
        .await
        .expect("route");
    assert_eq!(listing, json!({ "kind": "anonymous" }));
    let paid = client
        .agent_mcp_route(route_params(
            &server,
            None,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "paid" } }),
        ))
        .await
        .expect("route");
    assert_eq!(paid["status"], 401);
    assert_eq!(
        paid["body"]["error"]["message"],
        "Sign in to pay for this tool"
    );
    let mut metadata = route_params(&server, None, Value::Null);
    metadata.method = "GET".to_owned();
    metadata.path = "/.well-known/oauth-protected-resource/mcp".to_owned();
    let got = client.agent_mcp_route(metadata).await.expect("route");
    assert_eq!(got["status"], 200);
    assert_eq!(
        got["body"]["authorization_servers"],
        json!([issuer(&server)])
    );
}
