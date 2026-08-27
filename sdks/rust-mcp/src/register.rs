//! `register_payable_tool` and the payable decision sequence.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use futures::future::BoxFuture;
use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::model::{CallToolResult, JsonObject, Tool};
use serde_json::{json, Map, Value};
use solvapay::{Allow, Client, GateOpts, GateOutcome, SdkError, TrackOpts};
use solvapay_core::{invoke_payable_next, HelperErrorResult, InvokePayableAction, PaywallGate};
use thiserror::Error;

use crate::layer2::{assert_response_result, format_gate, json_to_call_tool_result};
use crate::response_context::{CustomerView, PayableResponse, ProductView, ResponseContext};

/// Failure from a payable tool invocation.
#[derive(Debug, Error)]
pub enum PayableError {
    /// Handler invoked [`ResponseContext::gate`].
    #[error("{message}")]
    Gate {
        /// Narration / throw message.
        message: String,
        /// Structured paywall gate.
        gate: Box<PaywallGate>,
    },
    /// Merchant handler or envelope failure (tool-level `isError: true`).
    #[error("{0}")]
    Handler(String),
    /// Limits / transport / SDK failure (protocol error, not a tool result).
    #[error("{}", .0.message())]
    Sdk(Box<SdkError>),
}

impl From<SdkError> for PayableError {
    fn from(value: SdkError) -> Self {
        Self::Sdk(Box::new(value))
    }
}

/// Spec for a paywalled MCP tool.
#[derive(Clone)]
pub struct PayableTool {
    /// MCP tool name.
    pub name: String,
    /// Product reference.
    pub product: String,
    /// Optional human-readable title.
    pub title: Option<String>,
    /// Optional description.
    pub description: Option<String>,
    /// Optional JSON Schema field map (`{ "customer_ref": { "type": "string" } }`).
    pub input_schema: Option<Map<String, Value>>,
    /// Meter / usage type (default `"requests"`).
    pub usage_type: Option<String>,
}

/// Merchant handler.
pub type PayableHandler = Arc<
    dyn Fn(JsonObject, ResponseContext) -> BoxFuture<'static, Result<PayableResponse, PayableError>>
        + Send
        + Sync,
>;

/// Optional customer-ref hook.
pub type GetCustomerRef = Arc<dyn Fn(&JsonObject) -> Result<String, PayableError> + Send + Sync>;

/// Register a paywalled tool on an rmcp [`ToolRouter`].
///
/// # Errors
///
/// Returns [`PayableError::Handler`] when the input schema is unsupported.
pub fn register_payable_tool<S: Send + Sync + 'static>(
    router: &mut ToolRouter<S>,
    client: Client,
    tool: PayableTool,
    handler: PayableHandler,
    get_customer_ref: Option<GetCustomerRef>,
) -> Result<(), PayableError> {
    if tool.name.is_empty() {
        return Err(PayableError::Handler("tool name is required".to_owned()));
    }
    if tool.product.is_empty() {
        return Err(PayableError::Handler("product is required".to_owned()));
    }
    let schema = compile_input_schema(tool.input_schema.as_ref())?;
    let description = tool
        .description
        .clone()
        .unwrap_or_else(|| format!("Payable tool {}", tool.name));
    let mut attr = Tool::new(tool.name.clone(), description, Arc::new(schema));
    if let Some(title) = tool.title.clone() {
        attr = attr.with_title(title);
    }
    let usage_type = tool
        .usage_type
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "requests".to_owned());
    let product = tool.product.clone();
    router.add_route(ToolRoute::new_dyn(attr, move |ctx| {
        let client = client.clone();
        let product = product.clone();
        let usage_type = usage_type.clone();
        let handler = Arc::clone(&handler);
        let get_customer_ref = get_customer_ref.clone();
        let args = ctx.arguments.clone().unwrap_or_default();
        Box::pin(async move {
            match invoke_payable(client, product, usage_type, handler, get_customer_ref, args).await
            {
                Ok(result) => Ok(result.into()),
                Err(PayableError::Sdk(err)) => Err(rmcp::ErrorData::internal_error(
                    err.message().to_owned(),
                    None,
                )),
                Err(other) => Err(rmcp::ErrorData::internal_error(other.to_string(), None)),
            }
        })
    }));
    Ok(())
}

/// Testable decision sequence (customer ref → gate → handler → usage).
///
/// # Errors
///
/// [`PayableError::Sdk`] when limits/transport fail; other variants are converted
/// into tool results by this function except Sdk which is returned.
pub async fn invoke_payable(
    client: Client,
    product: String,
    usage_type: String,
    handler: PayableHandler,
    get_customer_ref: Option<GetCustomerRef>,
    args: JsonObject,
) -> Result<CallToolResult, PayableError> {
    let started_ms = now_ms();
    let customer_ref = resolve_customer_ref(&args, get_customer_ref.as_ref())?;
    let mut state: Option<Value> = None;
    let mut event = json!({
        "kind": "start",
        "customerRef": customer_ref,
        "product": product,
        "usageType": usage_type,
        "startedMs": started_ms,
    });
    let mut allow_arm: Option<Allow> = None;
    loop {
        let out = invoke_payable_next(state.as_ref(), Some(&event)).map_err(helper_to_payable)?;
        state = Some(serde_json::to_value(&out.state).map_err(|err| {
            PayableError::Handler(format!("serialize invoke_payable state: {err}"))
        })?);
        match out.action {
            InvokePayableAction::RunGate {
                customer_ref: gate_ref,
                product: gate_product,
                usage_type: gate_usage,
            } => {
                let outcome = client
                    .gate(
                        &gate_ref,
                        GateOpts {
                            product: gate_product,
                            usage_type: gate_usage,
                        },
                    )
                    .await?;
                match outcome {
                    GateOutcome::Paywall(gate) => {
                        if paywall_override_active() {
                            let message = paywall_message(&gate);
                            return format_gate(&message, &gate);
                        }
                        let message = paywall_message(&gate);
                        event = json!({
                            "kind": "gatePaywall",
                            "gate": gate,
                            "message": message,
                        });
                    }
                    GateOutcome::Allow(allow) => {
                        let snap = allow.customer();
                        let limits = allow_limits_value(&allow);
                        event = json!({
                            "kind": "gateAllow",
                            "customerRef": snap.customer_ref,
                            "limits": limits,
                        });
                        allow_arm = Some(allow);
                    }
                }
            }
            InvokePayableAction::InvokeHandler {
                customer_ref: handler_ref,
                limits,
            } => {
                let ctx = ResponseContext::new(
                    CustomerView {
                        customer_ref: handler_ref,
                        balance: limits.get("creditBalance").cloned().unwrap_or(json!(0)),
                        remaining: limits.get("remaining").cloned().unwrap_or(Value::Null),
                        within_limits: limits.get("withinLimits").cloned().unwrap_or(json!(true)),
                        plan: limits.get("plan").cloned().unwrap_or(Value::Null),
                    },
                    ProductView {
                        reference: product.clone(),
                        name: product.clone(),
                    },
                    product.clone(),
                );
                match handler(args.clone(), ctx).await {
                    Err(PayableError::Gate { message, gate }) => {
                        if paywall_override_active() {
                            return format_gate(&message, &gate);
                        }
                        event = json!({
                            "kind": "handlerPaywall",
                            "gate": *gate,
                            "message": message,
                        });
                    }
                    Err(PayableError::Handler(msg)) => {
                        event = json!({
                            "kind": "handlerErr",
                            "message": msg,
                            "nowMs": now_ms(),
                        });
                    }
                    Err(PayableError::Sdk(err)) => return Err(PayableError::Sdk(err)),
                    Ok(response) => {
                        let envelope_value = serde_json::to_value(&response.0).map_err(|e| {
                            PayableError::Handler(format!("serialize response envelope: {e}"))
                        })?;
                        assert_response_result(&envelope_value)?;
                        event = json!({
                            "kind": "handlerOk",
                            "envelope": envelope_value,
                            "nowMs": now_ms(),
                        });
                    }
                }
            }
            InvokePayableAction::Done { result, track } => {
                if let Some(track) = track {
                    let allow = allow_arm.as_ref().ok_or_else(|| {
                        PayableError::Handler("invoke_payable track without allow arm".to_owned())
                    })?;
                    let duration = Some(track.duration_ms.max(0.0));
                    if track.outcome == "success" {
                        allow
                            .track_success(TrackOpts {
                                duration,
                                metadata: None,
                            })
                            .await?;
                    } else {
                        allow
                            .track_fail(
                                &track.outcome,
                                TrackOpts {
                                    duration,
                                    metadata: None,
                                },
                            )
                            .await?;
                    }
                }
                return json_to_call_tool_result(result);
            }
        }
    }
}

/// Host clock as unix milliseconds.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Map a helper-error result into [`PayableError`].
fn helper_to_payable(err: HelperErrorResult) -> PayableError {
    PayableError::Sdk(Box::new(SdkError::Api {
        message: err.details.unwrap_or(err.error),
        status: Some(err.status),
        code: None,
    }))
}

/// Paywall copy: gate message, or `"Payment required"` when empty.
fn paywall_message(gate: &PaywallGate) -> String {
    if gate.message.is_empty() {
        "Payment required".to_owned()
    } else {
        gate.message.clone()
    }
}

/// Whether the test-seams `format_gate` override is installed.
fn paywall_override_active() -> bool {
    #[cfg(feature = "test-seams")]
    {
        return crate::layer2::format_gate_override_active();
    }
    #[cfg(not(feature = "test-seams"))]
    false
}

/// Limits snapshot JSON passed into `invoke_payable_next` on the allow path.
fn allow_limits_value(allow: &Allow) -> Value {
    let snap = allow.customer();
    json!({
        "creditBalance": snap.balance,
        "remaining": snap.remaining,
        "withinLimits": snap.within_limits,
        "plan": snap.plan,
    })
}

/// Resolve customer_ref from the hook, `customer_ref` arg, or `"anonymous"`.
fn resolve_customer_ref(
    args: &JsonObject,
    hook: Option<&GetCustomerRef>,
) -> Result<String, PayableError> {
    if let Some(hook) = hook {
        return hook(args);
    }
    match args.get("customer_ref") {
        Some(Value::String(s)) if !s.is_empty() => Ok(s.clone()),
        _ => Ok("anonymous".to_owned()),
    }
}

/// Compile a string-field map into a JSON Schema object.
fn compile_input_schema(fields: Option<&Map<String, Value>>) -> Result<JsonObject, PayableError> {
    let mut schema = JsonObject::new();
    schema.insert("type".to_owned(), json!("object"));
    let Some(fields) = fields else {
        schema.insert("properties".to_owned(), json!({}));
        return Ok(schema);
    };
    let mut properties = JsonObject::new();
    let mut required = Vec::new();
    for (key, spec) in fields {
        let obj = spec.as_object().ok_or_else(|| {
            PayableError::Handler(format!("unsupported inputSchema for field {key}"))
        })?;
        let typ = obj.get("type").and_then(Value::as_str);
        if typ != Some("string") {
            return Err(PayableError::Handler(format!(
                "unsupported inputSchema for field {key}"
            )));
        }
        properties.insert(key.clone(), json!({ "type": "string" }));
        required.push(key.clone());
    }
    schema.insert("properties".to_owned(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_owned(), json!(required));
    }
    Ok(schema)
}
