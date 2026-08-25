//! `register_payable_tool` and the payable decision sequence.

use std::sync::Arc;
use std::time::Instant;

use futures::future::BoxFuture;
use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::model::{CallToolResult, ContentBlock, JsonObject, Tool};
use serde_json::{json, Map, Value};
use solvapay::{Client, GateOpts, GateOutcome, SdkError, TrackOpts};
use solvapay_core::PaywallGate;
use thiserror::Error;

use crate::layer2::{assert_response_result, build_payable_tool_result, format_gate};
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
    let started = Instant::now();
    let customer_ref = resolve_customer_ref(&args, get_customer_ref.as_ref())?;
    let outcome = client
        .gate(
            &customer_ref,
            GateOpts {
                product: product.clone(),
                usage_type: usage_type.clone(),
            },
        )
        .await?;
    match outcome {
        GateOutcome::Paywall(gate) => {
            let message = if gate.message.is_empty() {
                "Payment required".to_owned()
            } else {
                gate.message.clone()
            };
            format_gate(&message, &gate)
        }
        GateOutcome::Allow(allow) => {
            let snap = allow.customer();
            let ctx = ResponseContext::new(
                CustomerView::from(snap),
                ProductView {
                    reference: product.clone(),
                    name: product.clone(),
                },
                product.clone(),
            );
            match handler(args, ctx).await {
                Err(PayableError::Gate { message, gate }) => format_gate(&message, &gate),
                Err(PayableError::Handler(msg)) => {
                    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                    allow
                        .track_fail(
                            &msg,
                            TrackOpts {
                                duration: Some(elapsed.max(0.0)),
                                metadata: None,
                            },
                        )
                        .await?;
                    Ok(error_tool_result(&msg)?)
                }
                Err(PayableError::Sdk(err)) => Err(PayableError::Sdk(err)),
                Ok(response) => {
                    let envelope_value = serde_json::to_value(&response.0).map_err(|e| {
                        PayableError::Handler(format!("serialize response envelope: {e}"))
                    })?;
                    assert_response_result(&envelope_value)?;
                    let result = build_payable_tool_result(&response.0)?;
                    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                    allow
                        .track_success(TrackOpts {
                            duration: Some(elapsed.max(0.0)),
                            metadata: None,
                        })
                        .await?;
                    Ok(result)
                }
            }
        }
    }
}

/// MCP `isError: true` body used when the merchant handler fails.
fn error_tool_result(message: &str) -> Result<CallToolResult, PayableError> {
    let mut body = serde_json::Map::new();
    body.insert("success".to_owned(), json!(false));
    body.insert("error".to_owned(), json!(message));
    let text = serde_json::to_string_pretty(&Value::Object(body))
        .map_err(|e| PayableError::Handler(format!("serialize handler error: {e}")))?;
    Ok(CallToolResult::error(vec![ContentBlock::text(text)]))
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
