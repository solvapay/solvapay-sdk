//! Client golden-fixture replay for the fixture-runner (no HTTP server).
//!
//! [`FixtureTransport`] asserts the outgoing [`HttpRequest`] against `wire.request`
//! and returns `wire.response`. [`block_on_ready`] polls with a noop waker because
//! the stub future is immediately ready.

#![allow(clippy::missing_docs_in_private_items)]
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use solvapay_core::SdkError;
use solvapay_dto::error_templates::OPERATION_NAMES;
use solvapay_dto::{
    ActivatePlanDto, AssignCreditsRequest, AttachBusinessDetailsParams, CancelPurchaseParams,
    CheckLimitsRequest, CloneProductOverrides, ConfigureMcpPlansDto, CreateCheckoutSessionRequest,
    CreateCustomerRequest, CreateCustomerSessionRequest, CreatePaymentIntentParams,
    CreatePlanParams, CreateProductRequest, CreateTopupPaymentIntentParams,
    DisableAutoRechargeParams, GetAutoRechargeParams, GetCreditActivityParams,
    GetCustomerBalanceParams, GetCustomerParams, GetPaymentMethodParams, GetUserInfoParams,
    ListPurchasesParams, McpBootstrapDto, ProcessPaymentIntentParams, ReactivatePurchaseParams,
    SaveAutoRechargeParams, TrackUsageBulkRequest, TrackUsageRequest, UpdateCustomerParams,
    UpdatePlanRequest, UpdateProductRequest,
};
use solvapay_transport::{
    mulberry32, BoxFuture, ClientShell, HttpRequest, HttpResponse, SharedTransport, SolvaPayClient,
    Transport,
};

use crate::bindings::webhook::parse_iso8601_utc_to_unix_secs;
use crate::model::{Fixture, WireExchange, WireRequest, WireResponse};
use crate::runner::BindingError;
use crate::sdk_error::sdk_error_to_observation;

const FIXTURE_API_KEY: &str = "sk_test_fixture";
const VALIDATION_BASE_URL: &str = "http://127.0.0.1:1";

/// Polls `fut` once with [`Waker::noop`].
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the future is pending. The fixture
/// transport must resolve immediately.
pub fn block_on_ready<F: Future>(fut: F) -> Result<F::Output, BindingError> {
    let waker = Waker::noop();
    let mut cx = Context::from_waker(waker);
    let mut fut = std::pin::pin!(fut);
    match fut.as_mut().poll(&mut cx) {
        Poll::Ready(value) => Ok(value),
        Poll::Pending => Err(BindingError::Harness(
            "client replay future returned Pending; FixtureTransport must resolve immediately"
                .to_owned(),
        )),
    }
}

struct FixtureTransport {
    remaining: Mutex<Vec<WireExchange>>,
}

impl FixtureTransport {
    fn new(routes: &[WireExchange]) -> Self {
        Self {
            remaining: Mutex::new(routes.to_vec()),
        }
    }
}

impl Transport for FixtureTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let result = match self.remaining.lock() {
            Ok(mut remaining) => {
                if remaining.is_empty() {
                    Err(SdkError::transport(
                        "FixtureTransport: unexpected extra HTTP request".to_owned(),
                        false,
                    ))
                } else {
                    let expected = remaining.remove(0);
                    assert_wire_request(&req, &expected.request)
                        .map(|()| http_response(&expected.response))
                        .map_err(|message| SdkError::transport(message, false))
                }
            }
            Err(_) => Err(SdkError::transport(
                "FixtureTransport: mutex poisoned".to_owned(),
                false,
            )),
        };
        Box::pin(async move { result })
    }
}

struct RejectTransport;

impl Transport for RejectTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        let url = req.url.clone();
        Box::pin(async move {
            Err(SdkError::transport(
                format!("validation-only client fixture must not send HTTP ({url})"),
                false,
            ))
        })
    }
}

fn http_response(response: &WireResponse) -> HttpResponse {
    let body = match &response.body {
        Value::String(text) => text.as_bytes().to_vec(),
        other => serde_json::to_vec(other).unwrap_or_default(),
    };
    let status = u16::try_from(response.status).unwrap_or(0);
    HttpResponse {
        status,
        body,
        content_type: response.content_type.clone(),
    }
}

fn assert_wire_request(actual: &HttpRequest, expected: &WireRequest) -> Result<(), String> {
    if actual.method.as_str() != expected.method.as_str() {
        return Err(format!(
            "wire.request.method mismatch: expected {}, got {}",
            expected.method.as_str(),
            actual.method.as_str()
        ));
    }
    let (path, query) = split_path_query(&actual.url)?;
    if path != expected.path {
        return Err(format!(
            "wire.request.path mismatch: expected {}, got {path} (url={})",
            expected.path, actual.url
        ));
    }
    if let Some(expected_query) = &expected.query {
        if &query != expected_query {
            return Err(format!(
                "wire.request.query mismatch: expected {expected_query:?}, got {query:?}"
            ));
        }
    }
    if let Some(expected_headers) = &expected.headers {
        let actual_headers: BTreeMap<String, String> = actual
            .headers
            .iter()
            .map(|(name, value)| (name.as_str().to_ascii_lowercase(), value.clone()))
            .collect();
        for (key, value) in expected_headers {
            let actual_value = actual_headers.get(&key.to_ascii_lowercase());
            if actual_value.map(String::as_str) != Some(value.as_str()) {
                return Err(format!(
                    "wire.request.headers[{key}] mismatch: expected {value:?}, got {actual_value:?}"
                ));
            }
        }
    }
    if let Some(expected_body) = &expected.body {
        let actual_body = match &actual.body {
            None => Value::Null,
            Some(bytes) if bytes.is_empty() => Value::Null,
            Some(bytes) => serde_json::from_slice(bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned())),
        };
        if &actual_body != expected_body {
            return Err(format!(
                "wire.request.body mismatch: expected {expected_body}, got {actual_body}"
            ));
        }
    }
    Ok(())
}

fn split_path_query(url: &str) -> Result<(String, BTreeMap<String, String>), String> {
    let after_scheme = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .ok_or_else(|| format!("absolute URL required, got {url}"))?;
    let path_q = after_scheme
        .find('/')
        .map(|idx| &after_scheme[idx..])
        .unwrap_or("/");
    let (path, query_str) = path_q.split_once('?').unwrap_or((path_q, ""));
    let mut query = BTreeMap::new();
    if !query_str.is_empty() {
        for pair in query_str.split('&') {
            if pair.is_empty() {
                continue;
            }
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            query.insert(percent_decode(k), percent_decode(v));
        }
    }
    Ok((path.to_owned(), query))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Replay one client fixture through [`SolvaPayClient`] + [`FixtureTransport`].
pub fn invoke(fixture: &Fixture) -> Result<Value, BindingError> {
    let transport: SharedTransport = match &fixture.wire {
        Some(wire) => Arc::new(FixtureTransport::new(wire.routes())),
        None => Arc::new(RejectTransport),
    };
    let mut shell = ClientShell::new(transport, FIXTURE_API_KEY).with_base_url(
        fixture
            .wire
            .as_ref()
            .map(|_| "http://fixture.solvapay.test")
            .unwrap_or(VALIDATION_BASE_URL),
    );
    if let Some(clock) = &fixture.input.clock {
        let secs = parse_iso8601_utc_to_unix_secs(clock)
            .ok_or_else(|| BindingError::Harness(format!("unsupported fixture clock: {clock}")))?;
        let ms = u64::try_from(secs)
            .ok()
            .and_then(|s| s.checked_mul(1000))
            .ok_or_else(|| BindingError::Harness(format!("clock overflow: {clock}")))?;
        shell = shell.with_clock(Arc::new(move || ms));
    }
    if let Some(seed) = fixture.input.rng_seed {
        let seed = u32::try_from(seed)
            .map_err(|_| BindingError::Harness(format!("rngSeed out of u32 range: {seed}")))?;
        shell = shell.with_rng(Arc::new(mulberry32(seed)));
    }
    let client = SolvaPayClient::new(shell);
    let args = Value::Object(
        fixture
            .input
            .args
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    let outcome = block_on_ready(dispatch(&client, &fixture.input.fn_name, &args))?;
    match outcome {
        Ok(value) => Ok(value),
        Err(err) => Err(BindingError::Sdk(sdk_error_to_observation(err))),
    }
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
    "getCreditActivity",
    "getCustomer",
    "getCustomerBalance",
    "getMerchant",
    "getPaymentMethod",
    "getPlatformConfig",
    "getProduct",
    "getUserInfo",
    "listPlans",
    "listProducts",
    "listPurchases",
    "processPaymentIntent",
    "reactivatePurchase",
    "saveAutoRecharge",
    "trackUsage",
    "trackUsageBulk",
    "updateCustomer",
    "updatePlan",
    "updateProduct",
];

/// Returns whether the dispatch table covers every routed `OPERATION_NAMES` entry.
pub fn dispatch_covers_all_operations() -> bool {
    let expected: std::collections::BTreeSet<&str> = OPERATION_NAMES
        .iter()
        .copied()
        .filter(|name| !name.starts_with("mcp") && *name != "fetchJwks")
        .collect();
    let actual: std::collections::BTreeSet<&str> = DISPATCH_FNS.iter().copied().collect();
    expected == actual
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
        "listPurchases" => {
            let params: ListPurchasesParams = parse_args(&map)?;
            serialize_result(client.list_purchases(params).await?)
        }
        "getCreditActivity" => {
            let params: GetCreditActivityParams = parse_args(&map)?;
            serialize_result(client.get_credit_activity(params).await?)
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
            format!("unsupported client-conformance fn: {other}"),
            false,
        )),
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
        let expected: BTreeSet<&str> = OPERATION_NAMES
            .iter()
            .copied()
            .filter(|name| !name.starts_with("mcp") && *name != "fetchJwks")
            .collect();
        let actual: BTreeSet<&str> = DISPATCH_FNS.iter().copied().collect();
        assert_eq!(
            expected, actual,
            "DISPATCH_FNS must equal routed error_templates::OPERATION_NAMES"
        );
        assert!(dispatch_covers_all_operations());
        assert_eq!(DISPATCH_FNS.len(), 38);
    }
}
