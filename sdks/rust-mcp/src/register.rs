//! `register_payable_tool` and the payable decision sequence.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use rmcp::model::Tool;
use rmcp::model::{CallToolResult, JsonObject};
use serde_json::{json, Map, Value};
use solvapay::{
    run_generated_payable_loop, Allow, Client, GateOpts, GateOutcome, PayableDriverHost,
    PayableGateEffect, PayableHandlerEffect, SdkError,
};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use solvapay_core::mcp::compile_string_field_input_schema;
use solvapay_core::{
    build_customer_snapshot, resolve_customer_ref as resolve_customer_ref_op, PaywallGate,
};
use solvapay_dto::error_templates::paywall::PAYMENT_REQUIRED;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use solvapay_mcp_core::union_payable_output_schema;
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
    /// Bearer / hook produced no customer identity.
    #[error("customer_ref missing from MCP auth context")]
    MissingCustomerRef,
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
    /// Optional JSON Schema for `structuredContent`.
    pub output_schema: Option<Value>,
    /// Meter / usage type (default `"requests"`).
    pub usage_type: Option<String>,
}

/// Boxed future returned by a payable handler.
///
/// Native targets require `Send` (tokio); `wasm32-unknown-unknown` futures are `!Send`.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub type PayableFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
/// Boxed future returned by a payable handler on wasm (`!Send`).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub type PayableFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

/// Merchant handler.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub type PayableHandler = Arc<
    dyn Fn(
            JsonObject,
            ResponseContext,
        ) -> PayableFuture<'static, Result<PayableResponse, PayableError>>
        + Send
        + Sync,
>;
/// Merchant handler on wasm (isolate-local, `!Send`).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub type PayableHandler = Arc<
    dyn Fn(
        JsonObject,
        ResponseContext,
    ) -> PayableFuture<'static, Result<PayableResponse, PayableError>>,
>;

/// Optional customer-ref hook.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub type GetCustomerRef = Arc<dyn Fn(&JsonObject) -> Result<String, PayableError> + Send + Sync>;
/// Optional customer-ref hook on wasm (`!Send`).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub type GetCustomerRef = Arc<dyn Fn(&JsonObject) -> Result<String, PayableError>>;

/// Register a paywalled tool on an rmcp [`ToolRouter`].
///
/// Unavailable on `wasm32-unknown-unknown`: rmcp's default `ToolRoute::new_dyn`
/// requires `Send` futures, and the wasm `Client` (Fetch + isolate clock) is
/// not `Send`. Workers should register payables on [`crate::McpHttpServer`].
///
/// # Errors
///
/// Returns [`PayableError::Handler`] when the input schema is unsupported.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
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
    let description = solvapay_mcp_core::append_paid_tool_description(tool.description.as_deref());
    let mut attr = Tool::new(tool.name.clone(), description, Arc::new(schema));
    if let Some(title) = tool.title.clone() {
        attr = attr.with_title(title);
    }
    if let Some(output_schema) = &tool.output_schema {
        let unioned = union_payable_output_schema(output_schema);
        let obj = unioned.as_object().cloned().ok_or_else(|| {
            PayableError::Handler("unioned outputSchema must be a JSON object".to_owned())
        })?;
        attr = attr.with_raw_output_schema(Arc::new(obj));
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
        let sources = customer_ref_sources_from_extensions(&ctx.request_context.extensions);
        Box::pin(async move {
            match invoke_payable(
                client,
                product,
                usage_type,
                handler,
                get_customer_ref,
                args,
                sources,
            )
            .await
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
    sources: CustomerRefSources,
) -> Result<CallToolResult, PayableError> {
    let started_ms = now_ms();
    let customer_ref = resolve_customer_ref(&args, get_customer_ref.as_ref(), &sources)?;
    let host = PayableLoopHost {
        client,
        product,
        handler,
        args,
    };
    let result = run_generated_payable_loop(
        &host,
        json!({
            "kind": "start",
            "customerRef": customer_ref,
            "product": host.product,
            "usageType": usage_type,
            "startedMs": started_ms,
        }),
    )
    .await
    .map_err(|err| PayableError::Sdk(Box::new(err)))?;
    json_to_call_tool_result(result)
}

/// Host I/O for the generated invoke-payable loop.
struct PayableLoopHost {
    /// SolvaPay client used for gate and usage.
    client: Client,
    /// Product reference for the payable tool.
    product: String,
    /// Integrator handler invoked after an allow.
    handler: PayableHandler,
    /// Tool arguments passed through to the handler.
    args: JsonObject,
}

impl PayableDriverHost for PayableLoopHost {
    fn now_ms(&self) -> i64 {
        now_ms()
    }

    fn random_unit(&self) -> f64 {
        random_unit()
    }

    async fn run_gate(
        &self,
        customer_ref: &str,
        product: &str,
        usage_type: &str,
    ) -> Result<PayableGateEffect, SdkError> {
        let outcome = self
            .client
            .gate(
                customer_ref,
                GateOpts {
                    product: product.to_owned(),
                    usage_type: usage_type.to_owned(),
                },
            )
            .await?;
        match outcome {
            GateOutcome::Paywall(gate) => {
                let message = paywall_message(&gate);
                if paywall_override_active() {
                    let result = format_gate(&message, &gate).map_err(payable_to_sdk)?;
                    return Ok(PayableGateEffect::Early(call_tool_to_value(&result)?));
                }
                Ok(PayableGateEffect::Paywall {
                    gate: serde_json::to_value(gate).map_err(|err| {
                        SdkError::transport(format!("serialize paywall gate: {err}"), false)
                    })?,
                    message,
                })
            }
            GateOutcome::Allow(allow) => {
                let snap = allow.customer();
                Ok(PayableGateEffect::Allow {
                    customer_ref: snap.customer_ref,
                    limits: allow_limits_value(&allow),
                })
            }
        }
    }

    async fn invoke_handler(
        &self,
        customer_ref: &str,
        limits: Value,
    ) -> Result<PayableHandlerEffect, SdkError> {
        let ctx = ResponseContext::new(
            CustomerView::from(solvapay::CustomerSnapshot::from(build_customer_snapshot(
                customer_ref,
                Some(&limits),
            ))),
            ProductView {
                reference: self.product.clone(),
                name: self.product.clone(),
            },
            self.product.clone(),
            Some(limits),
        );
        match (self.handler)(self.args.clone(), ctx).await {
            Err(PayableError::Gate { message, gate }) => {
                if paywall_override_active() {
                    let result = format_gate(&message, &gate).map_err(payable_to_sdk)?;
                    return Ok(PayableHandlerEffect::Early(call_tool_to_value(&result)?));
                }
                Ok(PayableHandlerEffect::Paywall {
                    gate: serde_json::to_value(*gate).map_err(|err| {
                        SdkError::transport(format!("serialize handler gate: {err}"), false)
                    })?,
                    message,
                })
            }
            Err(PayableError::Handler(msg)) => Ok(PayableHandlerEffect::Err { message: msg }),
            Err(PayableError::Sdk(err)) => Err(*err),
            Err(PayableError::MissingCustomerRef) => Err(SdkError::transport(
                "customer_ref missing from MCP auth context",
                false,
            )),
            Ok(response) => {
                let envelope_value = serde_json::to_value(&response.0).map_err(|err| {
                    SdkError::transport(format!("serialize response envelope: {err}"), false)
                })?;
                assert_response_result(&envelope_value).map_err(payable_to_sdk)?;
                Ok(PayableHandlerEffect::Ok {
                    envelope: envelope_value,
                })
            }
        }
    }

    async fn track_usage(&self, request: Value) -> Result<(), SdkError> {
        let params: solvapay_dto::TrackUsageRequest =
            serde_json::from_value(request).map_err(|err| {
                SdkError::transport(format!("invoke_payable track.request: {err}"), false)
            })?;
        self.client.track_usage(params).await?;
        Ok(())
    }
}

/// Collapse a payable error into a transport [`SdkError`].
fn payable_to_sdk(err: PayableError) -> SdkError {
    match err {
        PayableError::Sdk(err) => *err,
        other => SdkError::transport(other.to_string(), false),
    }
}

/// Serialize an MCP call-tool result to JSON.
fn call_tool_to_value(result: &CallToolResult) -> Result<Value, SdkError> {
    serde_json::to_value(result)
        .map_err(|err| SdkError::transport(format!("serialize call tool result: {err}"), false))
}

/// Host clock as unix milliseconds.
fn now_ms() -> i64 {
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    {
        js_sys::Date::now() as i64
    }
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64)
    }
}

/// Host `Math.random()` stand-in for usage request ids.
fn random_unit() -> f64 {
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    {
        js_sys::Math::random()
    }
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        f64::from(nanos % 1_000_000) / 1_000_000.0
    }
}

/// Paywall copy: gate message, or the frozen payment-required template when empty.
fn paywall_message(gate: &PaywallGate) -> String {
    if gate.message.is_empty() {
        PAYMENT_REQUIRED.to_owned()
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
    allow.limits().clone()
}

/// Identity already on the host request, besides the hook and tool arguments.
#[derive(Clone, Default)]
pub struct CustomerRefSources {
    /// Verified bearer subject, when the host has already checked the token.
    pub verified_jwt_sub: Option<String>,
    /// `x-user-id` header, when the transport attached request headers.
    pub header_user_id: Option<String>,
    /// `x-customer-ref` header, when the transport attached request headers.
    pub header_customer_ref: Option<String>,
    /// MCP auth-context or bearer-derived customer ref.
    pub mcp_extra_customer_ref: Option<String>,
}

/// Resolve customer_ref from the hook, host request, and tool arguments.
fn resolve_customer_ref(
    args: &JsonObject,
    hook: Option<&GetCustomerRef>,
    sources: &CustomerRefSources,
) -> Result<String, PayableError> {
    let hook_ref = match hook {
        Some(hook) => Some(hook(args)?),
        None => None,
    };
    let args_auth = args
        .get("auth")
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("customer_ref"))
        .and_then(Value::as_str);
    let args_ref = args.get("customer_ref").and_then(Value::as_str);
    let resolved = resolve_customer_ref_op(
        hook_ref.as_deref(),
        sources.verified_jwt_sub.as_deref(),
        sources.header_user_id.as_deref(),
        sources.header_customer_ref.as_deref(),
        sources.mcp_extra_customer_ref.as_deref(),
        args_auth,
        args_ref,
    );
    if resolved.is_empty() || resolved == "anonymous" {
        return Err(PayableError::MissingCustomerRef);
    }
    Ok(resolved)
}

/// Read `x-user-id` and `x-customer-ref` when rmcp stored `http::request::Parts`.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn customer_ref_sources_from_extensions(
    extensions: &rmcp::model::Extensions,
) -> CustomerRefSources {
    let mut sources = CustomerRefSources::default();
    if let Some(parts) = extensions.get::<http::request::Parts>() {
        sources.header_user_id = header_string(&parts.headers, "x-user-id");
        sources.header_customer_ref = header_string(&parts.headers, "x-customer-ref");
    }
    sources
}

/// First non-empty header value.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn header_string(headers: &http::HeaderMap, name: &str) -> Option<String> {
    let text = headers.get(name)?.to_str().ok()?.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

/// Compile a string-field map into a JSON Schema object.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn compile_input_schema(fields: Option<&Map<String, Value>>) -> Result<JsonObject, PayableError> {
    let value = compile_string_field_input_schema(fields)
        .map_err(|err| PayableError::Handler(err.details.unwrap_or(err.error)))?;
    value.as_object().cloned().ok_or_else(|| {
        PayableError::Handler("compile_string_field_input_schema must return an object".to_owned())
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::{now_ms, random_unit};

    #[test]
    fn now_ms_is_plausible_unix_millis() {
        let now = now_ms();
        assert!(
            now > 1_577_836_800_000,
            "now_ms must be after 2020-01-01 UTC, got {now}"
        );
        assert!(
            now < 4_102_444_800_000,
            "now_ms must be before 2100-01-01 UTC, got {now}"
        );
    }

    #[test]
    fn random_unit_is_in_unit_interval() {
        let value = random_unit();
        assert!(
            (0.0..1.0).contains(&value),
            "random_unit must be in [0, 1), got {value}"
        );
    }
}
