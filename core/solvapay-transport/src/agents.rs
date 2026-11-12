//! Agent payment ops on [`crate::SolvaPayClient`].
//!
//! The I/O half of SolvaPay agent payments for merchants: SolvaPay's agent
//! endpoints, called with the merchant's secret key, and the composites built
//! on them (who is calling, one paid call start to finish, the HTTP gate, the
//! MCP route). Every decision comes from `solvapay_core::agents`; this file
//! sends the requests, keeps the two short caches and runs the wait loop.
//!
//! The agent endpoints are not part of the published OpenAPI contract, so
//! these ops take and return plain JSON checked field by field.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use solvapay_core::agents::{
    agent_call_step, agent_canonical_resource, agent_complete_body, agent_credential_kind,
    agent_gate_result, agent_key_result, agent_mcp_route_step, agent_secret_key_environment,
    parse_agent_response_typed,
};
use solvapay_core::SdkError;
use solvapay_mcp_core::{verify_agent_token, AgentTokenInput};

use crate::client::{encode_path_segment, SolvaPayClient};
use crate::http::Method;
use crate::mcp::FetchJwksParams;
use crate::shell::{Idempotency, ShellRequest};

/// Agent key verification endpoint.
const KEY_VERIFICATIONS_PATH: &str = "/v1/sdk/agent/keys/verifications";
/// Authorize endpoint. A repeat of the merchant's request id continues the same call.
const CALLS_PATH: &str = "/v1/sdk/agent/calls";
/// Usage report endpoint.
const USAGE_REPORTS_PATH: &str = "/v1/sdk/agent/usage-reports";

/// Arguments for [`SolvaPayClient::agent_verify_key`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVerifyKeyParams {
    /// The agent key as presented (`agk_…`).
    pub agent_key: String,
}

/// Arguments for [`SolvaPayClient::agent_authorize`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthorizeParams {
    /// The agent token or key the call came with. SolvaPay verifies it again.
    pub agent_token: String,
    /// The merchant's id for the call. A repeat continues the same call.
    pub request_id: String,
    /// The merchant's label for what is used, at most 200 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
    /// What this call may cost: `{ amount, currency }`.
    pub estimate: Value,
    /// `sha256:` over the call's prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_hash: Option<String>,
    /// The prompt carries a tool result marked as an error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_error: Option<bool>,
    /// The end of the prompt, only when the agent token allows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_excerpt: Option<String>,
    /// Seconds this request may hold while the owner decides, 0 to 55.
    #[serde(default)]
    pub wait: u32,
}

/// Arguments for [`SolvaPayClient::agent_complete`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompleteParams {
    /// The call reference authorize returned.
    pub call_ref: String,
    /// The status the upstream answered with.
    pub status: Value,
    /// The cost the upstream reported as `{ amount, currency }` with a string amount, or null.
    #[serde(default)]
    pub cost: Option<Value>,
    /// Set when the answer broke before it finished, with why.
    #[serde(default)]
    pub interrupted: Option<String>,
}

/// Arguments for [`SolvaPayClient::agent_report_usage`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReportUsageParams {
    /// The merchant's id for the report. A repeat returns the first report's results.
    pub report_id: String,
    /// The customer the usage is for.
    pub customer_ref: String,
    /// Where the merchant read its usage.
    pub source: String,
    /// `{ from, to }` in ISO 8601, `[from, to)`, in decision times.
    pub window: Value,
    /// The currency every cost is in.
    pub currency: String,
    /// `{ callRef, cost }` for each call of the window.
    #[serde(default)]
    pub calls: Vec<Value>,
    /// `{ at, cost }` for usage without a decision.
    #[serde(default)]
    pub untagged: Vec<Value>,
}

/// Arguments for [`SolvaPayClient::agent_identify`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdentifyParams {
    /// The key the caller presented (bearer token or API key header).
    pub presented_key: String,
    /// SolvaPay's agent token issuer, e.g. `https://api.solvapay.com/v1/agent`.
    pub issuer: String,
    /// This merchant's provider reference.
    pub provider_ref: String,
    /// This server's OAuth resource, accepted as a token audience.
    #[serde(default)]
    pub resource: Option<String>,
    /// Explicit JWKS document. Default: fetched from `<issuer>/jwks.json` and cached.
    #[serde(default)]
    pub jwks_json: Option<Value>,
    /// Whether agent keys are accepted. Default `true`.
    #[serde(default)]
    pub accept_agent_keys: Option<bool>,
    /// The merchant's environment. Default: read from the secret key prefix.
    #[serde(default)]
    pub environment: Option<String>,
}

/// Arguments for [`SolvaPayClient::agent_begin_call`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBeginCallParams {
    /// The merchant's id for the call.
    pub request_id: String,
    /// The token or key as presented.
    pub agent_token: String,
    /// The verified agent, as `agentIdentify` returned it.
    pub agent: Value,
    /// The merchant's label for what is used.
    pub item: String,
    /// What this call may cost: `{ amount, currency }`.
    pub estimate: Value,
    /// Prompt facts from `agentPromptFacts`, or null.
    #[serde(default)]
    pub prompt: Option<Value>,
    /// How long the call may wait for its owner's answer. 0 refuses at once.
    #[serde(default)]
    pub max_wait_seconds: f64,
}

/// Arguments for [`SolvaPayClient::agent_finish_call`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFinishCallParams {
    /// The call reference the allowed call carried.
    pub call_ref: String,
    /// The status the upstream answered with.
    #[serde(default)]
    pub status: Option<Value>,
    /// The cost the upstream reported as `{ amount, currency }` with a number amount, or null.
    #[serde(default)]
    pub cost: Option<Value>,
    /// Set when the answer to the caller broke before it finished.
    #[serde(default)]
    pub interrupted: Option<String>,
    /// Set instead of the rest when the call never reached the upstream: nothing is charged.
    #[serde(default)]
    pub release: Option<String>,
}

/// Arguments for [`SolvaPayClient::agent_gate`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGateParams {
    /// The key the caller presented.
    pub presented_key: String,
    /// The merchant's id for the call.
    pub request_id: String,
    /// The merchant's label for what the call buys.
    pub item: String,
    /// What the call may cost: `{ amount, currency }`.
    pub estimate: Value,
    /// Prompt facts from `agentPromptFacts`, or null.
    #[serde(default)]
    pub prompt: Option<Value>,
    /// How long the call may wait for its owner's answer.
    #[serde(default)]
    pub max_wait_seconds: f64,
    /// SolvaPay's agent token issuer.
    pub issuer: String,
    /// This merchant's provider reference.
    pub provider_ref: String,
    /// Explicit JWKS document.
    #[serde(default)]
    pub jwks_json: Option<Value>,
    /// Whether agent keys are accepted. Default `true`.
    #[serde(default)]
    pub accept_agent_keys: Option<bool>,
    /// The merchant's environment. Default: read from the secret key prefix.
    #[serde(default)]
    pub environment: Option<String>,
    /// Turns the OAuth challenge on: `{ resource, authorizationServer, … }`.
    #[serde(default)]
    pub protected_resource: Option<Value>,
}

/// Arguments for [`SolvaPayClient::agent_mcp_route`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpRouteParams {
    /// HTTP method of the request.
    pub method: String,
    /// Path of the request, without the query.
    pub path: String,
    /// `Authorization` header, when present.
    #[serde(default)]
    pub authorization: Option<String>,
    /// The parsed JSON-RPC body, or null when it did not parse.
    #[serde(default)]
    pub body: Option<Value>,
    /// SolvaPay's agent token issuer. Only its tokens are routed to the agent server.
    pub issuer: String,
    /// This merchant's provider reference.
    pub provider_ref: String,
    /// The MCP endpoint's path, e.g. `/mcp`.
    pub mcp_path: String,
    /// Server name, shown in the OAuth metadata.
    pub server_name: String,
    /// Turns OAuth sign-in on: `{ resource, authorizationServer?, documentation?, metadataPath? }`.
    #[serde(default)]
    pub protected_resource: Option<Value>,
    /// With OAuth on: `true` (default) lets a host run free tools before sign-in.
    #[serde(default)]
    pub lazy_auth: Option<bool>,
    /// Names of the paid tools.
    #[serde(default)]
    pub paid_tools: Vec<String>,
    /// Explicit JWKS document.
    #[serde(default)]
    pub jwks_json: Option<Value>,
    /// Whether agent keys are accepted. Default `true`.
    #[serde(default)]
    pub accept_agent_keys: Option<bool>,
    /// The merchant's environment. Default: read from the secret key prefix.
    #[serde(default)]
    pub environment: Option<String>,
}

/// HTTP status carried by an API error.
fn status_of(error: &SdkError) -> Option<u16> {
    match error {
        SdkError::Api { status, .. } => *status,
        _ => None,
    }
}

/// `{ status, error }` for a failed request, for the merchant's own logging.
fn failure_of(error: &SdkError) -> Value {
    json!({ "status": status_of(error), "error": error.message() })
}

/// Serialize a params struct into its camelCase JSON object.
fn to_json<T: Serialize>(value: &T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))
}

/// The canonical form of an OAuth resource.
fn canonical(resource: &str) -> Result<String, SdkError> {
    let result = agent_canonical_resource(resource);
    match result.get("value").and_then(Value::as_str) {
        Some(value) => Ok(value.to_owned()),
        None => Err(SdkError::transport(
            result
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Invalid URL")
                .to_owned(),
            false,
        )),
    }
}

/// Whether `jwks` holds an EC key for the `kid` the token names.
fn jwks_knows_token_key(token: &str, jwks: &Value) -> bool {
    let kid = token
        .split('.')
        .next()
        .and_then(solvapay_core::jwt_util::base64url_decode_to_string)
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(|header| header.get("kid").and_then(Value::as_str).map(str::to_owned));
    let Some(kid) = kid else {
        // No `kid`: every key is a candidate, so a refetch would not help.
        return true;
    };
    jwks.get("keys")
        .and_then(Value::as_array)
        .is_some_and(|keys| {
            keys.iter()
                .any(|key| key.get("kid").and_then(Value::as_str) == Some(kid.as_str()))
        })
}

/// A token verdict or key answer as an identification.
fn identification(result: &Value) -> Value {
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        json!({ "kind": "agent", "agent": result.get("agent").cloned().unwrap_or(Value::Null) })
    } else {
        json!({
            "kind": "rejected",
            "reason": result.get("reason").cloned().unwrap_or(Value::Null),
            "detail": result.get("detail").cloned().unwrap_or(Value::Null),
        })
    }
}

impl SolvaPayClient {
    /// One POST to an agent endpoint, sent once, answered as raw JSON.
    async fn agent_post(&self, path: &str, body: Value) -> Result<Value, SdkError> {
        let response = self
            .shell()
            .execute_raw(ShellRequest {
                method: Method::Post,
                path: path.to_owned(),
                query: std::collections::BTreeMap::new(),
                body: Some(body),
                // No key: a paid write is never replayed on a transport error.
                idempotency: Idempotency::None,
                error_template: "",
            })
            .await?;
        let text = String::from_utf8_lossy(&response.body);
        if !(200..300).contains(&response.status) {
            return Err(SdkError::Api {
                message: format!("POST {path} failed ({}): {text}", response.status),
                status: Some(response.status),
                code: None,
            });
        }
        serde_json::from_str(&text).map_err(|err| {
            SdkError::transport(format!("POST {path} answered invalid JSON: {err}"), false)
        })
    }

    /// One POST to an agent endpoint, read strictly as `kind`.
    async fn agent_call(&self, path: &str, body: Value, kind: &str) -> Result<Value, SdkError> {
        let raw = self.agent_post(path, body).await?;
        parse_agent_response_typed(kind, &raw)
            .map_err(|message| SdkError::transport(message, false))
    }

    /// The merchant's environment: as given, else what the secret key prefix says.
    fn agent_environment(&self, explicit: Option<&str>) -> Option<String> {
        explicit
            .filter(|env| !env.is_empty())
            .map(str::to_owned)
            .or_else(|| agent_secret_key_environment(self.shell().api_key()))
    }

    /// Ask SolvaPay whose an agent key is (`agentVerifyKey`).
    ///
    /// Fails with status 401 for an unknown or revoked key and 403 for another
    /// merchant's or the other environment's.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 50,
        dto_type = "solvapay_transport::AgentVerifyKeyParams"
    )]
    pub async fn agent_verify_key(&self, params: AgentVerifyKeyParams) -> Result<Value, SdkError> {
        self.agent_call(
            KEY_VERIFICATIONS_PATH,
            json!({ "agentKey": params.agent_key }),
            "verifiedAgentKey",
        )
        .await
    }

    /// Ask SolvaPay to authorize one paid call (`agentAuthorize`).
    ///
    /// Answers `allowed` with the reservation, `refused` with why, or
    /// `waiting` while the owner decides. One request holds for at most
    /// `wait` seconds.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 51,
        dto_type = "solvapay_transport::AgentAuthorizeParams"
    )]
    pub async fn agent_authorize(&self, params: AgentAuthorizeParams) -> Result<Value, SdkError> {
        self.agent_call(CALLS_PATH, to_json(&params)?, "authorize")
            .await
    }

    /// Complete a call at how the upstream answered (`agentComplete`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 52,
        dto_type = "solvapay_transport::AgentCompleteParams"
    )]
    pub async fn agent_complete(&self, params: AgentCompleteParams) -> Result<Value, SdkError> {
        let mut body = Map::new();
        body.insert("status".to_owned(), params.status);
        body.insert("cost".to_owned(), params.cost.unwrap_or(Value::Null));
        if let Some(interrupted) = params.interrupted.filter(|reason| !reason.is_empty()) {
            body.insert("interrupted".to_owned(), Value::String(interrupted));
        }
        self.agent_complete_raw(&params.call_ref, Value::Object(body))
            .await
    }

    /// POST the complete body for `call_ref`.
    async fn agent_complete_raw(&self, call_ref: &str, body: Value) -> Result<Value, SdkError> {
        let path = format!("{CALLS_PATH}/{}/complete", encode_path_segment(call_ref));
        self.agent_call(&path, body, "complete").await
    }

    /// Report a window of usage for reconciliation (`agentReportUsage`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 53,
        dto_type = "solvapay_transport::AgentReportUsageParams"
    )]
    pub async fn agent_report_usage(
        &self,
        params: AgentReportUsageParams,
    ) -> Result<Value, SdkError> {
        self.agent_call(USAGE_REPORTS_PATH, to_json(&params)?, "usageReport")
            .await
    }

    /// The issuer's JWKS: explicit, cached, or fetched from `<issuer>/jwks.json`.
    async fn agent_jwks(&self, issuer: &str, refresh: bool) -> Result<Value, SdkError> {
        let url = format!("{}/jwks.json", issuer.trim_end_matches('/'));
        let now_ms = self.shell().now_ms();
        if !refresh {
            if let Some(cached) = self.auth_caches().get_jwks(&url, now_ms)? {
                return Ok(cached);
            }
        }
        let document = self
            .fetch_jwks(FetchJwksParams {
                jwks_url: url.clone(),
            })
            .await?;
        self.auth_caches().put_jwks(url, document.clone(), now_ms)?;
        Ok(document)
    }

    /// Verify an agent token against the issuer's keys.
    async fn agent_token_result(
        &self,
        params: &AgentIdentifyParams,
        environment: Option<&str>,
    ) -> Result<Value, SdkError> {
        let resource = match params.resource.as_deref().filter(|raw| !raw.is_empty()) {
            Some(raw) => Some(canonical(raw)?),
            None => None,
        };
        let now_unix_secs = i64::try_from(self.shell().now_ms() / 1000).unwrap_or(i64::MAX);
        let verify = |jwks: &Value| {
            verify_agent_token(&AgentTokenInput {
                token: &params.presented_key,
                jwks,
                issuer: &params.issuer,
                provider_ref: &params.provider_ref,
                resource: resource.as_deref(),
                now_unix_secs,
                merchant_environment: environment,
            })
        };
        if let Some(explicit) = params
            .jwks_json
            .as_ref()
            .filter(|jwks| jwks.get("keys").is_some_and(Value::is_array))
        {
            return Ok(verify(explicit));
        }
        // Keys out of reach is a token that cannot be verified, not an outage of the call.
        let unreachable = |error: SdkError| json!({ "ok": false, "reason": "invalid", "detail": error.message() });
        let mut jwks = match self.agent_jwks(&params.issuer, false).await {
            Ok(jwks) => jwks,
            Err(error) => return Ok(unreachable(error)),
        };
        // The issuer rotated its key since the document was cached.
        if !jwks_knows_token_key(&params.presented_key, &jwks) {
            jwks = match self.agent_jwks(&params.issuer, true).await {
                Ok(jwks) => jwks,
                Err(error) => return Ok(unreachable(error)),
            };
        }
        Ok(verify(&jwks))
    }

    /// Ask SolvaPay whose an agent key is, reusing each answer for 30 seconds.
    async fn agent_key_answer(
        &self,
        agent_key: &str,
        environment: Option<&str>,
    ) -> Result<Value, SdkError> {
        let now_ms = self.shell().now_ms();
        if let Some(cached) = self.auth_caches().get_agent_key(agent_key, now_ms)? {
            return Ok(cached);
        }
        let outcome = self
            .agent_verify_key(AgentVerifyKeyParams {
                agent_key: agent_key.to_owned(),
            })
            .await;
        let result = match &outcome {
            Ok(verified) => agent_key_result(&json!({
                "verified": verified,
                "merchantEnvironment": environment,
            })),
            Err(error) => agent_key_result(&json!({
                "errorStatus": status_of(error),
                "errorMessage": error.message(),
                "merchantEnvironment": environment,
            })),
        };
        if result.get("rethrow").and_then(Value::as_bool) == Some(true) {
            // SolvaPay out of reach: every paid call would fail the same way.
            return match outcome {
                Err(error) => Err(error),
                Ok(_) => Err(SdkError::transport("agent key verification failed", false)),
            };
        }
        self.auth_caches()
            .put_agent_key(agent_key.to_owned(), result.clone(), now_ms)?;
        Ok(result)
    }

    /// Say who is calling (`agentIdentify`).
    ///
    /// Returns `{ kind: "agent", agent }` for a verified agent token or key,
    /// `{ kind: "rejected", reason, detail }` for one that did not verify
    /// (`expired`, `invalid`, `environment_mismatch`), and
    /// `{ kind: "not_agent" }` for anything else: the merchant's own auth
    /// decides.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 54,
        dto_type = "solvapay_transport::AgentIdentifyParams"
    )]
    pub async fn agent_identify(&self, params: AgentIdentifyParams) -> Result<Value, SdkError> {
        let environment = self.agent_environment(params.environment.as_deref());
        let kind = agent_credential_kind(
            &params.presented_key,
            params.accept_agent_keys.unwrap_or(true),
        );
        let result = match kind.as_str() {
            "agent_key" => {
                self.agent_key_answer(&params.presented_key, environment.as_deref())
                    .await?
            }
            "agent_token" => {
                self.agent_token_result(&params, environment.as_deref())
                    .await?
            }
            _ => return Ok(json!({ "kind": "not_agent" })),
        };
        Ok(identification(&result))
    }

    /// Authorize one paid call, waiting for the owner when they must approve (`agentBeginCall`).
    ///
    /// Returns `{ kind: "allow", callRef, item, estimate, reservation }` or
    /// `{ kind: "refused", reason, message, log }`. SolvaPay out of reach is a
    /// refusal (`unavailable`), never a call let through.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 55,
        dto_type = "solvapay_transport::AgentBeginCallParams"
    )]
    pub async fn agent_begin_call(&self, params: AgentBeginCallParams) -> Result<Value, SdkError> {
        let mut state = Map::new();
        state.insert(
            "call".to_owned(),
            json!({
                "requestId": params.request_id,
                "agentToken": params.agent_token,
                "agent": params.agent,
                "item": params.item,
                "estimate": params.estimate,
                "prompt": params.prompt,
            }),
        );
        state.insert("maxWaitSeconds".to_owned(), json!(params.max_wait_seconds));
        loop {
            state.insert("nowMs".to_owned(), json!(self.shell().now_ms()));
            let step = agent_call_step(&Value::Object(state.clone()));
            match step.get("kind").and_then(Value::as_str) {
                Some("authorize") => {
                    if let Some(deadline) = step.get("deadlineMs") {
                        state.insert("deadlineMs".to_owned(), deadline.clone());
                    }
                    let body = step.get("body").cloned().unwrap_or(Value::Null);
                    match self.agent_post(CALLS_PATH, body).await {
                        Ok(answer) => state.insert("answer".to_owned(), answer),
                        Err(error) => state.insert("failure".to_owned(), failure_of(&error)),
                    };
                }
                Some("sleep") => {
                    let ms = step.get("ms").and_then(Value::as_u64).unwrap_or(0);
                    self.shell()
                        .delay(std::time::Duration::from_millis(ms))
                        .await;
                    state.remove("answer");
                }
                _ => return Ok(step),
            }
        }
    }

    /// Complete an allowed call, or release one that never reached the upstream (`agentFinishCall`).
    ///
    /// Returns `{ completed, failure }`. `completed` is SolvaPay's settlement,
    /// or null when SolvaPay could not be told: `failure` then carries
    /// `{ status, error }` to log, and the call's reservation lapses at the
    /// estimate.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 56,
        dto_type = "solvapay_transport::AgentFinishCallParams"
    )]
    pub async fn agent_finish_call(
        &self,
        params: AgentFinishCallParams,
    ) -> Result<Value, SdkError> {
        let body = match params.release {
            Some(reason) => agent_complete_body(&json!({ "release": reason })),
            None => agent_complete_body(&json!({
                "status": params.status,
                "cost": params.cost,
                "interrupted": params.interrupted,
            })),
        };
        Ok(
            match self.agent_complete_raw(&params.call_ref, body).await {
                Ok(completed) => json!({ "completed": completed, "failure": Value::Null }),
                Err(error) => json!({ "completed": Value::Null, "failure": failure_of(&error) }),
            },
        )
    }

    /// Gate one HTTP call: who is calling, then the paid call (`agentGate`).
    ///
    /// Returns `{ kind: "not_agent" }`, `{ kind: "rejected", status, … }`,
    /// `{ kind: "refused", status, refused, agent, body, … }` or
    /// `{ kind: "allowed", allowed, agent }`. With `protectedResource`, a 401
    /// carries `challenge`: the headers that send a host to sign in.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 57,
        dto_type = "solvapay_transport::AgentGateParams"
    )]
    pub async fn agent_gate(&self, params: AgentGateParams) -> Result<Value, SdkError> {
        let resource = params
            .protected_resource
            .as_ref()
            .and_then(|resource| resource.get("resource"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let identity = self
            .agent_identify(AgentIdentifyParams {
                presented_key: params.presented_key.clone(),
                issuer: params.issuer,
                provider_ref: params.provider_ref,
                resource,
                jwks_json: params.jwks_json,
                accept_agent_keys: params.accept_agent_keys,
                environment: params.environment,
            })
            .await?;
        let mut input = Map::new();
        input.insert("identity".to_owned(), identity.clone());
        if let Some(resource) = params.protected_resource {
            input.insert("protectedResource".to_owned(), resource);
        }
        let first = agent_gate_result(&Value::Object(input.clone()));
        if first.get("kind").and_then(Value::as_str) != Some("begin") {
            return Ok(first);
        }
        let begun = self
            .agent_begin_call(AgentBeginCallParams {
                request_id: params.request_id,
                agent_token: params.presented_key,
                agent: identity.get("agent").cloned().unwrap_or(Value::Null),
                item: params.item,
                estimate: params.estimate,
                prompt: params.prompt,
                max_wait_seconds: params.max_wait_seconds,
            })
            .await?;
        input.insert("begun".to_owned(), begun);
        Ok(agent_gate_result(&Value::Object(input)))
    }

    /// Route one request to a merchant's MCP server (`agentMcpRoute`).
    ///
    /// Returns `{ kind: "pass" }` for the merchant's own handler,
    /// `{ kind: "response", status, headers, body }` to answer as is (the
    /// OAuth metadata, a sign-in challenge, a rejected token),
    /// `{ kind: "anonymous" }` to serve the listing server, or
    /// `{ kind: "agent", agent, agentToken }` to serve the verified agent.
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 58,
        dto_type = "solvapay_transport::AgentMcpRouteParams"
    )]
    pub async fn agent_mcp_route(&self, params: AgentMcpRouteParams) -> Result<Value, SdkError> {
        let mut input = Map::new();
        input.insert("method".to_owned(), json!(params.method));
        input.insert("path".to_owned(), json!(params.path));
        input.insert("authorization".to_owned(), json!(params.authorization));
        input.insert("body".to_owned(), params.body.unwrap_or(Value::Null));
        input.insert("issuer".to_owned(), json!(params.issuer));
        input.insert("mcpPath".to_owned(), json!(params.mcp_path));
        input.insert("serverName".to_owned(), json!(params.server_name));
        input.insert("paidTools".to_owned(), json!(params.paid_tools));
        if let Some(lazy) = params.lazy_auth {
            input.insert("lazyAuth".to_owned(), json!(lazy));
        }
        let resource = params
            .protected_resource
            .as_ref()
            .and_then(|resource| resource.get("resource"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(protected) = params.protected_resource {
            input.insert("protectedResource".to_owned(), protected);
        }
        let routed = agent_mcp_route_step(&Value::Object(input.clone()));
        if routed.get("kind").and_then(Value::as_str) != Some("identify") {
            return Ok(routed);
        }
        let token = routed
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let identity = self
            .agent_identify(AgentIdentifyParams {
                presented_key: token,
                issuer: params.issuer,
                provider_ref: params.provider_ref,
                resource,
                jwks_json: params.jwks_json,
                accept_agent_keys: params.accept_agent_keys,
                environment: params.environment,
            })
            .await?;
        input.insert("identity".to_owned(), identity);
        Ok(agent_mcp_route_step(&Value::Object(input)))
    }
}
