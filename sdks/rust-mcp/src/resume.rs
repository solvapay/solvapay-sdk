//! Payable `invokeHandler` resume for the engine HTTP adapter.

use rmcp::model::JsonObject;
use serde_json::{json, Map, Value};
use solvapay::{Client, SdkError};

use crate::call_sync;
use crate::http_util::json_response;
use crate::register::{invoke_payable, GetCustomerRef, PayableError, PayableHandler};
use crate::McpHttpResponse;

/// Registered payable tool used to resume an `invokeHandler` wait.
pub(crate) struct PayableSpec {
    /// Product reference billed for this tool.
    pub product: String,
    /// Usage meter name (`usageType`).
    pub usage_type: String,
    /// Integrator handler invoked after the gate allows.
    pub handler: PayableHandler,
    /// Optional customer-ref resolver for this tool.
    pub get_customer_ref: Option<GetCustomerRef>,
}

/// Resume an `invokeHandler` envelope by running the registered payable.
pub(crate) async fn resume_envelope(
    client: Client,
    lookup: impl FnOnce(&str) -> Option<PayableSpec>,
    envelope: &Value,
) -> Result<McpHttpResponse, SdkError> {
    let tool = envelope
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let token = envelope
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| SdkError::transport("invokeHandler missing token", false))?
        .to_owned();
    let spec = lookup(&tool)
        .ok_or_else(|| SdkError::transport(format!("unknown payable tool: {tool}"), false))?;
    resume_payable(client, &spec, envelope, token).await
}

/// Invoke the payable and complete `mcpResume` with the handler envelope.
async fn resume_payable(
    client: Client,
    spec: &PayableSpec,
    envelope: &Value,
    token: String,
) -> Result<McpHttpResponse, SdkError> {
    let mut args: JsonObject = match envelope.get("args") {
        Some(Value::Object(map)) => map.clone(),
        _ => Map::new(),
    };
    if let Some(customer_ref) = envelope.get("customerRef").and_then(Value::as_str) {
        if !args.contains_key("customer_ref") {
            args.insert("customer_ref".to_owned(), json!(customer_ref));
        }
    }
    let result = invoke_payable(
        client,
        spec.product.clone(),
        spec.usage_type.clone(),
        spec.handler.clone(),
        spec.get_customer_ref.clone(),
        args,
    )
    .await
    .map_err(payable_to_sdk)?;
    let handler_envelope = serde_json::to_value(&result)
        .map_err(|err| SdkError::transport(format!("serialize handler result: {err}"), false))?;
    let resumed = call_sync(
        "mcpResume",
        &json!({ "token": token, "handlerEnvelope": handler_envelope }),
    )
    .map_err(|err| SdkError::transport(err, false))?;
    json_response(200, resumed.get("rpc").cloned().unwrap_or(resumed))
}

/// Map a payable-layer error onto `SdkError` for the HTTP adapter.
fn payable_to_sdk(err: PayableError) -> SdkError {
    match err {
        PayableError::Sdk(err) => *err,
        other => SdkError::transport(other.to_string(), false),
    }
}
