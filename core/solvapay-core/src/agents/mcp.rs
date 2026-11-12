//! An MCP server paid by SolvaPay agents: the routing and the refusal shape.
//!
//! Requests on the MCP path whose bearer token comes from SolvaPay's agent
//! issuer are verified and served for that agent. Every other request is left
//! to the merchant's own handler. With OAuth on, a host lists tools and runs
//! free ones before its user signs in, and a paid call is what sends it there.

use serde_json::{json, Value};

use super::identity::is_agent_key;
use super::oauth::{agent_protected_resource, canonical_resource, challenge_headers};
use super::str_field;
use crate::jwt_util::decode_jwt_payload_unverified;

/// JSON-RPC error code for a request that needs an agent.
const UNAUTHORIZED_CODE: i64 = -32001;

/// A refusal as an MCP tool error.
///
/// The text is the sentence for the agent's human, and
/// `structuredContent.refusal.reason` says which refusal it was, so an agent
/// can act on it without parsing the text.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 167
)]
#[must_use]
pub fn agent_refusal_tool_result(refused: &Value) -> Value {
    let reason = refused.get("reason").cloned().unwrap_or(Value::Null);
    let message = refused.get("message").cloned().unwrap_or(Value::Null);
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": message }],
        "structuredContent": { "refusal": { "reason": reason, "message": message } },
    })
}

/// The single token of an `Authorization: Bearer <token>` header.
fn bearer_token(authorization: &str) -> Option<&str> {
    let mut parts = authorization.split_whitespace();
    let scheme = parts.next()?;
    let token = parts.next()?;
    let starts_with_scheme = authorization
        .get(..scheme.len())
        .is_some_and(|head| head == scheme);
    if !scheme.eq_ignore_ascii_case("bearer") || !starts_with_scheme || parts.next().is_some() {
        return None;
    }
    // No trailing whitespace: the token runs to the end of the header.
    authorization.ends_with(token).then_some(token)
}

/// Whether the header opens with `Bearer` and whitespace, whatever follows.
fn has_bearer_scheme(authorization: &str) -> bool {
    let Some(head) = authorization.get(..6) else {
        return false;
    };
    head.eq_ignore_ascii_case("bearer")
        && authorization[6..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
}

/// The bearer token, when it is an agent key or SolvaPay's agent issuer signed it.
///
/// Read unverified, only to route.
fn agent_bearer<'a>(authorization: &'a str, issuer: &str) -> Option<&'a str> {
    let token = bearer_token(authorization)?;
    if is_agent_key(token) {
        return Some(token);
    }
    let claims = decode_jwt_payload_unverified(token)?;
    (claims.get("iss").and_then(Value::as_str) == Some(issuer)).then_some(token)
}

/// The `tools/call` requests in a JSON-RPC body: one, or a batch.
fn tool_calls(method: &str, body: &Value) -> Vec<(Value, String)> {
    if method != "POST" {
        return Vec::new();
    }
    let single = [body.clone()];
    let messages: &[Value] = body.as_array().map_or(&single, Vec::as_slice);
    messages
        .iter()
        .filter(|message| message.get("method").and_then(Value::as_str) == Some("tools/call"))
        .filter_map(|message| {
            let name = message.get("params")?.get("name")?.as_str()?;
            Some((
                message.get("id").cloned().unwrap_or(Value::Null),
                name.to_owned(),
            ))
        })
        .collect()
}

/// The JSON-RPC id of a single request, for an error the host can match to it.
fn json_rpc_id(body: &Value) -> Value {
    body.as_object()
        .and_then(|object| object.get("id"))
        .cloned()
        .unwrap_or(Value::Null)
}

/// `{ kind: "response", … }` carrying a JSON body.
fn response(status: u16, headers: Value, body: Value) -> Value {
    json!({ "kind": "response", "status": status, "headers": headers, "body": body })
}

/// A 401 JSON-RPC error with the challenge: the host signs the owner in and retries.
fn auth_challenge(resource: &Value, description: &str, id: Value) -> Value {
    let mut headers = match challenge_headers(resource, description) {
        Ok(headers) => headers,
        Err(message) => return json!({ "kind": "error", "message": message }),
    };
    if let Some(map) = headers.as_object_mut() {
        map.insert("Content-Type".to_owned(), json!("application/json"));
    }
    response(
        401,
        headers,
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": UNAUTHORIZED_CODE, "message": description },
        }),
    )
}

/// 401 for a token that did not verify, 403 for one from the other environment.
fn token_rejected(reason: &str) -> Value {
    let status = if reason == "environment_mismatch" {
        403
    } else {
        401
    };
    response(
        status,
        json!({
            "WWW-Authenticate":
                format!("Bearer error=\"invalid_token\", error_description=\"{reason}\""),
            "Content-Type": "application/json",
        }),
        json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": {
                "code": UNAUTHORIZED_CODE,
                "message": format!("The agent token was not accepted ({reason})."),
            },
        }),
    )
}

/// The protected resource with its canonical URL and default authorization server.
fn resolved_resource(input: &Value, issuer: &str) -> Result<Option<Value>, String> {
    let Some(configured) = input.get("protectedResource").and_then(Value::as_object) else {
        return Ok(None);
    };
    let mut resource = configured.clone();
    let raw = configured
        .get("resource")
        .and_then(Value::as_str)
        .unwrap_or_default();
    resource.insert("resource".to_owned(), json!(canonical_resource(raw)?));
    let has_server = configured
        .get("authorizationServer")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.is_empty());
    if !has_server {
        resource.insert("authorizationServer".to_owned(), json!(issuer));
    }
    Ok(Some(Value::Object(resource)))
}

/// A request with no agent token, while OAuth is on.
fn anonymous(input: &Value, resource: &Value, method: &str, authorization: &str) -> Value {
    let body = input.get("body").unwrap_or(&Value::Null);
    let calls = tool_calls(method, body);
    let lazy = input
        .get("lazyAuth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let is_paid = |name: &str| {
        input
            .get("paidTools")
            .and_then(Value::as_array)
            .is_some_and(|names| names.iter().any(|paid| paid.as_str() == Some(name)))
    };
    if calls.iter().any(|(_, name)| !lazy || is_paid(name)) {
        let id = calls.first().map_or(Value::Null, |(id, _)| id.clone());
        return auth_challenge(resource, "Sign in to pay for this tool", id);
    }
    // A bearer that is not ours is the merchant's own auth.
    if has_bearer_scheme(authorization) {
        return json!({ "kind": "pass" });
    }
    json!({ "kind": "anonymous" })
}

/// Where one request to a merchant's MCP server goes.
///
/// `input` carries `method`, `path`, `authorization`, the parsed JSON-RPC
/// `body`, `issuer`, `mcpPath`, `serverName`, and with OAuth on
/// `protectedResource`, `lazyAuth` and `paidTools` (the paid tool names). Once
/// a token was identified, add `identity` and step again.
///
/// Returns one of:
/// - `{ kind: "pass" }`: the merchant's own handler answers.
/// - `{ kind: "response", status, headers, body }`: answer with this JSON.
/// - `{ kind: "anonymous" }`: serve the listing server, where only free tools run.
/// - `{ kind: "identify", token }`: verify the token, then step again with `identity`.
/// - `{ kind: "agent", agent, agentToken }`: serve the agent.
/// - `{ kind: "error", message }`: a misconfiguration to raise.
///
/// A `rejected` identity also carries `log` for the merchant's own logging.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 168
)]
#[must_use]
pub fn agent_mcp_route_step(input: &Value) -> Value {
    let method = str_field(input, "method").unwrap_or("GET");
    let path = str_field(input, "path").unwrap_or_default();
    let issuer = str_field(input, "issuer").unwrap_or_default();
    let mcp_path = str_field(input, "mcpPath").unwrap_or_default();
    let authorization = str_field(input, "authorization").unwrap_or_default();

    let resource = match resolved_resource(input, issuer) {
        Ok(resource) => resource,
        Err(message) => return json!({ "kind": "error", "message": message }),
    };

    if let Some(resource) = &resource {
        if method == "GET" {
            let mut described = resource.clone();
            if let (Some(map), Some(name)) = (described.as_object_mut(), input.get("serverName")) {
                map.insert("serverName".to_owned(), name.clone());
            }
            let view = agent_protected_resource(&described);
            let own_path = view.get("path").and_then(Value::as_str);
            let under_mcp = format!("{mcp_path}/.well-known/oauth-protected-resource");
            if own_path == Some(path) || path == under_mcp {
                return response(
                    200,
                    json!({
                        "Cache-Control": "public, max-age=300",
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": "application/json",
                    }),
                    view.get("metadata").cloned().unwrap_or(Value::Null),
                );
            }
        }
    }

    if path != mcp_path {
        return json!({ "kind": "pass" });
    }
    let Some(token) = agent_bearer(authorization, issuer) else {
        return match &resource {
            Some(resource) => anonymous(input, resource, method, authorization),
            None => json!({ "kind": "pass" }),
        };
    };

    let Some(identity) = input
        .get("identity")
        .filter(|identity| identity.is_object())
    else {
        return json!({ "kind": "identify", "token": token });
    };
    match identity.get("kind").and_then(Value::as_str) {
        Some("rejected") => {
            let reason = str_field(identity, "reason").unwrap_or("invalid");
            let log = json!({
                "reason": format!("agent_token_{reason}"),
                "detail": identity.get("detail").cloned().unwrap_or(Value::Null),
            });
            // The other environment is not fixed by signing in again here.
            let mut answer = match &resource {
                Some(resource) if reason != "environment_mismatch" => auth_challenge(
                    resource,
                    if reason == "expired" {
                        "The sign-in has expired: sign in again"
                    } else {
                        "The agent token was not accepted: sign in again"
                    },
                    json_rpc_id(input.get("body").unwrap_or(&Value::Null)),
                ),
                _ => token_rejected(reason),
            };
            if let Some(map) = answer.as_object_mut() {
                map.insert("log".to_owned(), log);
            }
            answer
        }
        Some("agent") => json!({
            "kind": "agent",
            "agent": identity.get("agent").cloned().unwrap_or(Value::Null),
            "agentToken": token,
        }),
        _ => json!({
            "kind": "error",
            "message": if is_agent_key(token) {
                "An agent key reached the agent route, but its agent layer has no verifyAgentKey"
            } else {
                "A token from the agent issuer was not read as one"
            },
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUER: &str = "https://api.solvapay.test/v1/agent";

    /// An unsigned compact token whose payload names `iss`.
    fn token_from(iss: &str) -> String {
        // {"alg":"ES256"} . {"iss":"<iss>"} . sig, base64url without padding.
        let payload = format!("{{\"iss\":\"{iss}\"}}");
        format!(
            "eyJhbGciOiJFUzI1NiJ9.{}.c2ln",
            base64url(payload.as_bytes())
        )
    }

    fn base64url(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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

    fn base(extra: Value) -> Value {
        let mut input = json!({
            "method": "POST",
            "path": "/mcp",
            "issuer": ISSUER,
            "mcpPath": "/mcp",
            "serverName": "Example",
        });
        if let (Some(map), Some(more)) = (input.as_object_mut(), extra.as_object()) {
            for (key, value) in more {
                map.insert(key.clone(), value.clone());
            }
        }
        input
    }

    fn oauth() -> Value {
        json!({ "resource": "https://mcp.example.com/mcp" })
    }

    fn tool_call(name: &str) -> Value {
        json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name } })
    }

    #[test]
    fn refusal_is_a_tool_error_with_a_machine_reason() {
        assert_eq!(
            agent_refusal_tool_result(
                &json!({ "kind": "refused", "reason": "deny", "message": "Over the cap." })
            ),
            json!({
                "isError": true,
                "content": [{ "type": "text", "text": "Over the cap." }],
                "structuredContent": { "refusal": { "reason": "deny", "message": "Over the cap." } },
            })
        );
    }

    #[test]
    fn other_paths_and_other_bearers_pass() {
        assert_eq!(
            agent_mcp_route_step(&base(json!({ "path": "/other" }))),
            json!({ "kind": "pass" })
        );
        assert_eq!(
            agent_mcp_route_step(&base(json!({ "authorization": "Bearer sk_live_merchant" }))),
            json!({ "kind": "pass" })
        );
        let foreign = token_from("https://elsewhere");
        assert_eq!(
            agent_mcp_route_step(&base(
                json!({ "authorization": format!("Bearer {foreign}") })
            )),
            json!({ "kind": "pass" })
        );
    }

    #[test]
    fn agent_tokens_and_keys_are_identified() {
        let token = token_from(ISSUER);
        assert_eq!(
            agent_mcp_route_step(&base(
                json!({ "authorization": format!("bearer  {token}") })
            )),
            json!({ "kind": "identify", "token": token })
        );
        assert_eq!(
            agent_mcp_route_step(&base(json!({ "authorization": "Bearer agk_sandbox_X" }))),
            json!({ "kind": "identify", "token": "agk_sandbox_X" })
        );
    }

    #[test]
    fn identified_agent_is_served() {
        let token = token_from(ISSUER);
        let routed = agent_mcp_route_step(&base(json!({
            "authorization": format!("Bearer {token}"),
            "identity": { "kind": "agent", "agent": { "agentRef": "agt_1" } },
        })));
        assert_eq!(
            routed,
            json!({ "kind": "agent", "agent": { "agentRef": "agt_1" }, "agentToken": token })
        );
    }

    #[test]
    fn rejected_token_without_oauth_is_a_plain_401_or_403() {
        let token = token_from(ISSUER);
        let invalid = agent_mcp_route_step(&base(json!({
            "authorization": format!("Bearer {token}"),
            "identity": { "kind": "rejected", "reason": "invalid", "detail": "sig" },
        })));
        assert_eq!(invalid["status"], 401);
        assert_eq!(
            invalid["headers"]["WWW-Authenticate"],
            "Bearer error=\"invalid_token\", error_description=\"invalid\""
        );
        assert_eq!(
            invalid["body"]["error"]["message"],
            "The agent token was not accepted (invalid)."
        );
        assert_eq!(invalid["log"]["reason"], "agent_token_invalid");
        let other_env = agent_mcp_route_step(&base(json!({
            "authorization": format!("Bearer {token}"),
            "protectedResource": oauth(),
            "identity": { "kind": "rejected", "reason": "environment_mismatch", "detail": "d" },
        })));
        assert_eq!(other_env["status"], 403);
    }

    #[test]
    fn rejected_token_with_oauth_challenges_with_the_request_id() {
        let token = token_from(ISSUER);
        let expired = agent_mcp_route_step(&base(json!({
            "authorization": format!("Bearer {token}"),
            "protectedResource": oauth(),
            "body": tool_call("paid"),
            "identity": { "kind": "rejected", "reason": "expired", "detail": "exp" },
        })));
        assert_eq!(expired["status"], 401);
        assert_eq!(expired["body"]["id"], 7);
        assert_eq!(
            expired["body"]["error"]["message"],
            "The sign-in has expired: sign in again"
        );
        assert!(expired["headers"]["WWW-Authenticate"]
            .as_str()
            .unwrap_or_default()
            .contains("resource_metadata=\"https://mcp.example.com/.well-known/oauth-protected-resource/mcp\""));
    }

    #[test]
    fn metadata_is_served_at_both_paths_with_the_issuer_as_default_server() {
        for path in [
            "/.well-known/oauth-protected-resource/mcp",
            "/mcp/.well-known/oauth-protected-resource",
        ] {
            let routed = agent_mcp_route_step(&base(json!({
                "method": "GET", "path": path, "protectedResource": oauth(),
            })));
            assert_eq!(routed["status"], 200, "{path}");
            assert_eq!(routed["body"]["authorization_servers"], json!([ISSUER]));
            assert_eq!(routed["body"]["resource_name"], "Example");
            assert_eq!(routed["headers"]["Cache-Control"], "public, max-age=300");
        }
        // Without OAuth the path is the merchant's.
        assert_eq!(
            agent_mcp_route_step(&base(json!({
                "method": "GET", "path": "/.well-known/oauth-protected-resource/mcp",
            }))),
            json!({ "kind": "pass" })
        );
    }

    #[test]
    fn anonymous_hosts_list_and_run_free_tools_but_paid_calls_challenge() {
        let listing = agent_mcp_route_step(&base(json!({
            "protectedResource": oauth(),
            "paidTools": ["paid"],
            "body": { "jsonrpc": "2.0", "id": 1, "method": "tools/list" },
        })));
        assert_eq!(listing, json!({ "kind": "anonymous" }));
        let free = agent_mcp_route_step(&base(json!({
            "protectedResource": oauth(), "paidTools": ["paid"], "body": tool_call("free"),
        })));
        assert_eq!(free, json!({ "kind": "anonymous" }));
        let paid = agent_mcp_route_step(&base(json!({
            "protectedResource": oauth(), "paidTools": ["paid"], "body": [tool_call("free"), tool_call("paid")],
        })));
        assert_eq!(paid["status"], 401);
        assert_eq!(paid["body"]["id"], 7);
        assert_eq!(
            paid["body"]["error"]["message"],
            "Sign in to pay for this tool"
        );
    }

    #[test]
    fn eager_auth_challenges_every_tool_call() {
        let routed = agent_mcp_route_step(&base(json!({
            "protectedResource": oauth(), "lazyAuth": false, "body": tool_call("free"),
        })));
        assert_eq!(routed["status"], 401);
    }

    #[test]
    fn anonymous_route_leaves_a_foreign_bearer_to_the_merchant() {
        let routed = agent_mcp_route_step(&base(json!({
            "protectedResource": oauth(),
            "authorization": "Bearer merchant-own-token",
            "body": { "jsonrpc": "2.0", "id": 1, "method": "tools/list" },
        })));
        assert_eq!(routed, json!({ "kind": "pass" }));
    }

    #[test]
    fn unread_identity_is_a_misconfiguration() {
        let routed = agent_mcp_route_step(&base(json!({
            "authorization": "Bearer agk_sandbox_X",
            "identity": { "kind": "not_agent" },
        })));
        assert_eq!(
            routed["message"],
            "An agent key reached the agent route, but its agent layer has no verifyAgentKey"
        );
    }

    #[test]
    fn unusable_resource_is_an_error() {
        let routed = agent_mcp_route_step(&base(
            json!({ "protectedResource": { "resource": "nope" } }),
        ));
        assert_eq!(routed, json!({ "kind": "error", "message": "Invalid URL" }));
    }
}
