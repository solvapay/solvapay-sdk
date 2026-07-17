//! Shadow-mode Rust invoker library (step 25).
//!
//! Dispatches camelCase operation names onto [`SolvaPayClient`], wrapping the
//! transport in [`RecordingTransport`] so wire exchanges can be dumped on
//! divergence. Arg-decoding mirrors `solvapay-transport` fixture support
//! (duplicated here because test support is not a linkable crate).

#![allow(clippy::missing_docs_in_private_items)]
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use solvapay_core::SdkError;
use solvapay_dto::error_templates::OPERATION_NAMES;
use solvapay_dto::{
    ActivatePlanDto, AssignCreditsRequest, AttachBusinessDetailsParams, CancelPurchaseParams,
    CheckLimitsRequest, CloneProductOverrides, ConfigureMcpPlansDto, CreateCheckoutSessionRequest,
    CreateCustomerRequest, CreateCustomerSessionRequest, CreatePaymentIntentParams,
    CreatePlanParams, CreateProductRequest, CreateTopupPaymentIntentParams,
    DisableAutoRechargeParams, GetAutoRechargeParams, GetCustomerBalanceParams, GetCustomerParams,
    GetPaymentMethodParams, GetUserInfoParams, McpBootstrapDto, ProcessPaymentIntentParams,
    ReactivatePurchaseParams, SaveAutoRechargeParams, TrackUsageBulkRequest, TrackUsageRequest,
    UpdateCustomerParams, UpdatePlanRequest, UpdateProductRequest,
};
use solvapay_transport::{
    BoxFuture, ClientShell, HttpRequest, HttpResponse, ReqwestTransport, SharedTransport,
    SolvaPayClient, Transport,
};

/// One recorded HTTP exchange.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireExchange {
    /// HTTP method.
    pub method: String,
    /// Absolute request URL.
    pub url: String,
    /// Request headers (name → value).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub request_headers: BTreeMap<String, String>,
    /// Parsed JSON body when possible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<Value>,
    /// Response status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Response body (parsed JSON or raw string).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body: Option<Value>,
}

/// Transport wrapper that records every [`Transport::send`].
pub struct RecordingTransport {
    inner: SharedTransport,
    exchanges: Arc<Mutex<Vec<WireExchange>>>,
}

impl RecordingTransport {
    /// Wraps `inner` and shares an exchange buffer.
    pub fn new(inner: SharedTransport) -> (Self, Arc<Mutex<Vec<WireExchange>>>) {
        let exchanges = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                inner,
                exchanges: Arc::clone(&exchanges),
            },
            exchanges,
        )
    }
}

impl Transport for RecordingTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let method = req.method.as_str().to_owned();
        let url = req.url.clone();
        let request_headers: BTreeMap<String, String> = req
            .headers
            .iter()
            .map(|(k, v)| (k.as_str().to_owned(), v.clone()))
            .collect();
        let request_body = req.body.as_ref().map(|bytes| parse_body_bytes(bytes));
        let exchanges = Arc::clone(&self.exchanges);
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            let result = inner.send(req).await;
            match &result {
                Ok(resp) => {
                    let response_body = parse_body_bytes(&resp.body);
                    if let Ok(mut guard) = exchanges.lock() {
                        guard.push(WireExchange {
                            method,
                            url,
                            request_headers,
                            request_body,
                            status: Some(resp.status),
                            response_body: Some(response_body),
                        });
                    }
                }
                Err(_) => {
                    if let Ok(mut guard) = exchanges.lock() {
                        guard.push(WireExchange {
                            method,
                            url,
                            request_headers,
                            request_body,
                            status: None,
                            response_body: None,
                        });
                    }
                }
            }
            result
        })
    }
}

fn parse_body_bytes(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        return Value::Null;
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) => v,
        Err(_) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// stdin request envelope.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeRequest {
    /// CamelCase operation id (manifest / `OPERATION_NAMES`).
    #[serde(rename = "fn")]
    pub fn_name: String,
    /// Argument object (path params + body fields).
    #[serde(default, rename = "argsJson")]
    pub args_json: Value,
    /// API origin.
    pub base_url: String,
    /// Secret API key.
    pub api_key: String,
}

/// stdout response envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeResponse {
    /// Success flag.
    pub ok: bool,
    /// Success value when `ok`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    /// Structured error observation when `!ok`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorObservation>,
    /// Recorded wire exchanges.
    #[serde(default)]
    pub wire: Vec<WireExchange>,
}

/// §6.4-style error observation for the TS harness.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorObservation {
    /// Exception name (`SolvaPayError` / `PaywallError`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Human message.
    pub message: String,
    /// `Api` / `Paywall` / `Webhook` / `Transport`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Optional machine code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Optional HTTP status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
}

/// CamelCase names covered by [`dispatch`].
pub fn dispatch_operation_names() -> &'static [&'static str] {
    DISPATCH_FNS
}

const DISPATCH_FNS: &[&str] = &[
    "activatePlan",
    "assignCredits",
    "attachBusinessDetails",
    "bootstrapMcpProduct",
    "cancelPurchase",
    "checkLimits",
    "cloneProduct",
    "configureMcpPlans",
    "createCheckoutSession",
    "createCustomer",
    "createCustomerSession",
    "createPaymentIntent",
    "createPlan",
    "createProduct",
    "createTopupPaymentIntent",
    "deletePlan",
    "deleteProduct",
    "disableAutoRecharge",
    "getAutoRecharge",
    "getCustomer",
    "getCustomerBalance",
    "getMerchant",
    "getPaymentMethod",
    "getPlatformConfig",
    "getProduct",
    "getUserInfo",
    "listPlans",
    "listProducts",
    "processPaymentIntent",
    "reactivatePurchase",
    "saveAutoRecharge",
    "trackUsage",
    "trackUsageBulk",
    "updateCustomer",
    "updatePlan",
    "updateProduct",
];

/// Returns whether the dispatch table covers every `OPERATION_NAMES` entry.
pub fn dispatch_covers_all_operations() -> bool {
    let expected: std::collections::BTreeSet<&str> = OPERATION_NAMES.iter().copied().collect();
    let actual: std::collections::BTreeSet<&str> = DISPATCH_FNS.iter().copied().collect();
    expected == actual
}

/// Client plus shared wire-exchange buffer.
pub type RecordingClient = (SolvaPayClient, Arc<Mutex<Vec<WireExchange>>>);

/// Build a recording client against `base_url` / `api_key`.
pub fn build_recording_client(base_url: &str, api_key: &str) -> Result<RecordingClient, SdkError> {
    let transport = ReqwestTransport::new()?;
    let shared: SharedTransport = Arc::new(transport);
    let (recording, exchanges) = RecordingTransport::new(shared);
    let recording_shared: SharedTransport = Arc::new(recording);
    let shell = ClientShell::new(recording_shared, api_key).with_base_url(base_url);
    Ok((SolvaPayClient::new(shell), exchanges))
}

/// Invoke one operation and return the JSON envelope (incl. wire).
pub async fn invoke(request: InvokeRequest) -> InvokeResponse {
    let (client, exchanges) = match build_recording_client(&request.base_url, &request.api_key) {
        Ok(pair) => pair,
        Err(err) => {
            return InvokeResponse {
                ok: false,
                value: None,
                error: Some(sdk_error_to_observation(err)),
                wire: Vec::new(),
            };
        }
    };

    let outcome = dispatch(&client, &request.fn_name, &request.args_json).await;
    let wire = exchanges.lock().map(|g| g.clone()).unwrap_or_default();
    match outcome {
        Ok(value) => InvokeResponse {
            ok: true,
            value: Some(value),
            error: None,
            wire,
        },
        Err(err) => InvokeResponse {
            ok: false,
            value: None,
            error: Some(sdk_error_to_observation(err)),
            wire,
        },
    }
}

/// Dispatch `fn_name` + `args` onto a typed client (library entry for tests).
pub async fn dispatch(
    client: &SolvaPayClient,
    fn_name: &str,
    args: &Value,
) -> Result<Value, SdkError> {
    let map = args_as_map(args)?;
    match fn_name {
        "createCustomer" => {
            let params: CreateCustomerRequest = parse_args(&map)?;
            serialize_result(client.create_customer(params).await?)
        }
        "updateCustomer" => {
            let customer_ref = require_str(&map, "customerRef")?;
            let mut body = map.clone();
            body.remove("customerRef");
            let params: UpdateCustomerParams = parse_args(&body)?;
            serialize_result(client.update_customer(&customer_ref, params).await?)
        }
        "getCustomer" => {
            let params: GetCustomerParams = parse_args(&map)?;
            serialize_result(client.get_customer(params).await?)
        }
        "assignCredits" => {
            let params: AssignCreditsRequest = parse_args(&map)?;
            serialize_result(client.assign_credits(params).await?)
        }
        "getCustomerBalance" => {
            let params: GetCustomerBalanceParams = parse_args(&map)?;
            serialize_result(client.get_customer_balance(params).await?)
        }
        "getUserInfo" => {
            let params: GetUserInfoParams = parse_args(&map)?;
            serialize_result(client.get_user_info(params).await?)
        }
        "createCheckoutSession" => {
            let params: CreateCheckoutSessionRequest = parse_args(&map)?;
            serialize_result(client.create_checkout_session(params).await?)
        }
        "createCustomerSession" => {
            let params: CreateCustomerSessionRequest = parse_args(&map)?;
            serialize_result(client.create_customer_session(params).await?)
        }
        "getMerchant" => serialize_result(client.get_merchant().await?),
        "getPlatformConfig" => serialize_result(client.get_platform_config().await?),
        "createPaymentIntent" => {
            let params: CreatePaymentIntentParams = parse_args(&map)?;
            serialize_result(client.create_payment_intent(params).await?)
        }
        "createTopupPaymentIntent" => {
            let params: CreateTopupPaymentIntentParams = parse_args(&map)?;
            serialize_result(client.create_topup_payment_intent(params).await?)
        }
        "processPaymentIntent" => {
            let params: ProcessPaymentIntentParams = parse_args(&map)?;
            serialize_result(client.process_payment_intent(params).await?)
        }
        "attachBusinessDetails" => {
            let params: AttachBusinessDetailsParams = parse_args(&map)?;
            client.attach_business_details(params).await
        }
        "activatePlan" => {
            let params: ActivatePlanDto = parse_args(&map)?;
            serialize_result(client.activate_plan(params).await?)
        }
        "checkLimits" => {
            let params: CheckLimitsRequest = parse_args(&map)?;
            client.check_limits(params).await
        }
        "trackUsage" => {
            let params: TrackUsageRequest = parse_args(&map)?;
            client.track_usage(params).await
        }
        "trackUsageBulk" => {
            let params: TrackUsageBulkRequest = parse_args(&map)?;
            client.track_usage_bulk(params).await
        }
        "getProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            client.get_product(&product_ref).await
        }
        "listProducts" => client.list_products().await,
        "createProduct" => {
            let params: CreateProductRequest = parse_args(&map)?;
            client.create_product(params).await
        }
        "updateProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let params: UpdateProductRequest = parse_args(&body)?;
            client.update_product(&product_ref, params).await
        }
        "deleteProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            client.delete_product(&product_ref).await?;
            Ok(Value::Null)
        }
        "cloneProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let overrides: CloneProductOverrides = parse_args(&body)?;
            serialize_result(client.clone_product(&product_ref, Some(overrides)).await?)
        }
        "bootstrapMcpProduct" => {
            let params: McpBootstrapDto = parse_args(&map)?;
            client.bootstrap_mcp_product(params).await
        }
        "configureMcpPlans" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let params: ConfigureMcpPlansDto = parse_args(&body)?;
            client.configure_mcp_plans(&product_ref, params).await
        }
        "listPlans" => {
            let product_ref = require_str(&map, "productRef")?;
            client.list_plans(&product_ref).await
        }
        "createPlan" => {
            let params: CreatePlanParams = parse_args(&map)?;
            client.create_plan(params).await
        }
        "updatePlan" => {
            let product_ref = require_str(&map, "productRef")?;
            let plan_ref = require_str(&map, "planRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            body.remove("planRef");
            let params: UpdatePlanRequest = parse_args(&body)?;
            client.update_plan(&product_ref, &plan_ref, params).await
        }
        "deletePlan" => {
            let product_ref = require_str(&map, "productRef")?;
            let plan_ref = require_str(&map, "planRef")?;
            client.delete_plan(&product_ref, &plan_ref).await?;
            Ok(Value::Null)
        }
        "cancelPurchase" => {
            let params: CancelPurchaseParams = parse_args(&map)?;
            client.cancel_purchase(params).await
        }
        "reactivatePurchase" => {
            let params: ReactivatePurchaseParams = parse_args(&map)?;
            client.reactivate_purchase(params).await
        }
        "getPaymentMethod" => {
            let params: GetPaymentMethodParams = parse_args(&map)?;
            client.get_payment_method(params).await
        }
        "getAutoRecharge" => {
            let params: GetAutoRechargeParams = parse_args(&map)?;
            client.get_auto_recharge(params).await
        }
        "saveAutoRecharge" => {
            let params: SaveAutoRechargeParams = parse_args(&map)?;
            client.save_auto_recharge(params).await
        }
        "disableAutoRecharge" => {
            let params: DisableAutoRechargeParams = parse_args(&map)?;
            client.disable_auto_recharge(params).await
        }
        other => Err(SdkError::transport(
            format!("unsupported shadow-invoker fn: {other}"),
            false,
        )),
    }
}

/// Maps [`SdkError`] → JSON observation (same shape as fixture-runner).
pub fn sdk_error_to_observation(error: SdkError) -> ErrorObservation {
    match error {
        SdkError::Api {
            message,
            status,
            code,
        } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Api".to_owned()),
            code,
            status: status.map(i64::from),
        },
        SdkError::Paywall { message, .. } => ErrorObservation {
            name: Some("PaywallError".to_owned()),
            message,
            kind: Some("Paywall".to_owned()),
            code: None,
            status: None,
        },
        SdkError::Webhook { message, code } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Webhook".to_owned()),
            code: Some(code.as_str().to_owned()),
            status: None,
        },
        SdkError::Transport { message, retryable } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Transport".to_owned()),
            code: Some(if retryable {
                "retryable".to_owned()
            } else {
                "non_retryable".to_owned()
            }),
            status: None,
        },
    }
}

fn args_as_map(args: &Value) -> Result<Map<String, Value>, SdkError> {
    match args {
        Value::Object(map) => Ok(map.clone()),
        Value::Null => Ok(Map::new()),
        other => Err(SdkError::transport(
            format!("argsJson must be an object, got {other}"),
            false,
        )),
    }
}

fn require_str(args: &Map<String, Value>, key: &str) -> Result<String, SdkError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| SdkError::transport(format!("missing {key}"), false))
}

fn parse_args<T: DeserializeOwned>(args: &Map<String, Value>) -> Result<T, SdkError> {
    serde_json::from_value(Value::Object(args.clone()))
        .map_err(|err| SdkError::transport(format!("parse args: {err}"), false))
}

fn serialize_result<T: serde::Serialize>(value: T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize result: {err}"), false))
}

#[cfg(test)]
mod coverage_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use solvapay_dto::error_templates::OPERATION_NAMES;
    use std::collections::BTreeSet;

    #[test]
    fn dispatch_table_matches_operation_names() {
        let expected: BTreeSet<&str> = OPERATION_NAMES.iter().copied().collect();
        let actual: BTreeSet<&str> = DISPATCH_FNS.iter().copied().collect();
        assert_eq!(
            expected, actual,
            "DISPATCH_FNS must equal error_templates::OPERATION_NAMES"
        );
        assert!(dispatch_covers_all_operations());
        assert_eq!(DISPATCH_FNS.len(), 36);
    }
}
