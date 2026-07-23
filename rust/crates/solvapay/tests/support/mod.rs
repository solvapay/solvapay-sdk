//! Shared Group A + B + C fixture dispatch / assertion helpers.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items,
    clippy::result_large_err,
    dead_code
)]

use std::collections::BTreeMap;

use fixture_runner::{Fixture, FixtureExpect};
use serde::de::DeserializeOwned;
use serde_json::Value;
use solvapay::Client;
use solvapay_core::SdkError;
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

/// Group A `input.fn` names covered by step 22.
pub const GROUP_A_FNS: &[&str] = &[
    "createCustomer",
    "updateCustomer",
    "getCustomer",
    "assignCredits",
    "getCustomerBalance",
    "getUserInfo",
    "createCheckoutSession",
    "createCustomerSession",
    "getMerchant",
    "getPlatformConfig",
];

/// Expected inventory: 28 wire fixtures + `get-customer-missing-params`.
pub const GROUP_A_FIXTURE_COUNT: usize = 29;

/// Group B `input.fn` names covered by step 23.
pub const GROUP_B_FNS: &[&str] = &[
    "createPaymentIntent",
    "createTopupPaymentIntent",
    "processPaymentIntent",
    "attachBusinessDetails",
    "activatePlan",
];

/// Expected inventory: 19 wire fixtures (all Group B fixtures have wire).
pub const GROUP_B_FIXTURE_COUNT: usize = 19;

/// Group C `input.fn` names covered by step 24.
pub const GROUP_C_FNS: &[&str] = &[
    "checkLimits",
    "trackUsage",
    "trackUsageBulk",
    "getProduct",
    "listProducts",
    "createProduct",
    "updateProduct",
    "deleteProduct",
    "cloneProduct",
    "bootstrapMcpProduct",
    "configureMcpPlans",
    "listPlans",
    "createPlan",
    "updatePlan",
    "deletePlan",
    "cancelPurchase",
    "reactivatePurchase",
    "getPaymentMethod",
    "getAutoRecharge",
    "saveAutoRecharge",
    "disableAutoRecharge",
];

/// Expected inventory: 56 wire fixtures (all Group C fixtures have wire).
pub const GROUP_C_FIXTURE_COUNT: usize = 56;

pub fn is_group_a_fixture(fixture: &Fixture) -> bool {
    GROUP_A_FNS.contains(&fixture.input.fn_name.as_str())
}

pub fn is_group_b_fixture(fixture: &Fixture) -> bool {
    GROUP_B_FNS.contains(&fixture.input.fn_name.as_str())
}

pub fn is_group_c_fixture(fixture: &Fixture) -> bool {
    GROUP_C_FNS.contains(&fixture.input.fn_name.as_str())
}

/// Invokes the typed Group A method for a fixture and returns JSON / Api error.
pub async fn dispatch_group_a(client: &Client, fixture: &Fixture) -> Result<Value, SdkError> {
    let args = &fixture.input.args;
    match fixture.input.fn_name.as_str() {
        "createCustomer" => {
            let params: CreateCustomerRequest = parse_args(args)?;
            serialize_result(client.create_customer(params).await?)
        }
        "updateCustomer" => {
            let customer_ref = args
                .get("customerRef")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SdkError::transport("updateCustomer fixture missing customerRef", false)
                })?
                .to_owned();
            let mut body = args.clone();
            body.remove("customerRef");
            let params: UpdateCustomerParams = parse_args(&body)?;
            serialize_result(client.update_customer(&customer_ref, params).await?)
        }
        "getCustomer" => {
            let params: GetCustomerParams = parse_args(args)?;
            serialize_result(client.get_customer(params).await?)
        }
        "assignCredits" => {
            let params: AssignCreditsRequest = parse_args(args)?;
            serialize_result(client.assign_credits(params).await?)
        }
        "getCustomerBalance" => {
            let params: GetCustomerBalanceParams = parse_args(args)?;
            serialize_result(client.get_customer_balance(params).await?)
        }
        "getUserInfo" => {
            let params: GetUserInfoParams = parse_args(args)?;
            serialize_result(client.get_user_info(params).await?)
        }
        "createCheckoutSession" => {
            let params: CreateCheckoutSessionRequest = parse_args(args)?;
            serialize_result(client.create_checkout_session(params).await?)
        }
        "createCustomerSession" => {
            let params: CreateCustomerSessionRequest = parse_args(args)?;
            serialize_result(client.create_customer_session(params).await?)
        }
        "getMerchant" => serialize_result(client.get_merchant().await?),
        "getPlatformConfig" => serialize_result(client.get_platform_config().await?),
        other => Err(SdkError::transport(
            format!("unsupported Group A fixture fn: {other}"),
            false,
        )),
    }
}

/// Invokes the typed Group B method for a fixture and returns JSON / Api error.
pub async fn dispatch_group_b(client: &Client, fixture: &Fixture) -> Result<Value, SdkError> {
    let args = &fixture.input.args;
    match fixture.input.fn_name.as_str() {
        "createPaymentIntent" => {
            let params: CreatePaymentIntentParams = parse_args(args)?;
            serialize_result(client.create_payment_intent(params).await?)
        }
        "createTopupPaymentIntent" => {
            let params: CreateTopupPaymentIntentParams = parse_args(args)?;
            serialize_result(client.create_topup_payment_intent(params).await?)
        }
        "processPaymentIntent" => {
            let params: ProcessPaymentIntentParams = parse_args(args)?;
            serialize_result(client.process_payment_intent(params).await?)
        }
        "attachBusinessDetails" => {
            let params: AttachBusinessDetailsParams = parse_args(args)?;
            client.attach_business_details(params).await
        }
        "activatePlan" => {
            let params: ActivatePlanDto = parse_args(args)?;
            serialize_result(client.activate_plan(params).await?)
        }
        other => Err(SdkError::transport(
            format!("unsupported Group B fixture fn: {other}"),
            false,
        )),
    }
}

/// Invokes the typed Group C method for a fixture and returns JSON / Api error.
pub async fn dispatch_group_c(client: &Client, fixture: &Fixture) -> Result<Value, SdkError> {
    let args = &fixture.input.args;
    match fixture.input.fn_name.as_str() {
        "checkLimits" => {
            let params: CheckLimitsRequest = parse_args(args)?;
            client.check_limits(params).await
        }
        "trackUsage" => {
            let params: TrackUsageRequest = parse_args(args)?;
            client.track_usage(params).await
        }
        "trackUsageBulk" => {
            let params: TrackUsageBulkRequest = parse_args(args)?;
            client.track_usage_bulk(params).await
        }
        "getProduct" => {
            let product_ref = require_str(args, "productRef")?;
            client.get_product(&product_ref).await
        }
        "listProducts" => client.list_products().await,
        "createProduct" => {
            let params: CreateProductRequest = parse_args(args)?;
            client.create_product(params).await
        }
        "updateProduct" => {
            let product_ref = require_str(args, "productRef")?;
            let mut body = args.clone();
            body.remove("productRef");
            let params: UpdateProductRequest = parse_args(&body)?;
            client.update_product(&product_ref, params).await
        }
        "deleteProduct" => {
            let product_ref = require_str(args, "productRef")?;
            client.delete_product(&product_ref).await?;
            Ok(Value::Null)
        }
        "cloneProduct" => {
            let product_ref = require_str(args, "productRef")?;
            let mut body = args.clone();
            body.remove("productRef");
            let overrides: CloneProductOverrides = parse_args(&body)?;
            serialize_result(client.clone_product(&product_ref, Some(overrides)).await?)
        }
        "bootstrapMcpProduct" => {
            let params: McpBootstrapDto = parse_args(args)?;
            client.bootstrap_mcp_product(params).await
        }
        "configureMcpPlans" => {
            let product_ref = require_str(args, "productRef")?;
            let mut body = args.clone();
            body.remove("productRef");
            let params: ConfigureMcpPlansDto = parse_args(&body)?;
            client.configure_mcp_plans(&product_ref, params).await
        }
        "listPlans" => {
            let product_ref = require_str(args, "productRef")?;
            client.list_plans(&product_ref).await
        }
        "createPlan" => {
            let params: CreatePlanParams = parse_args(args)?;
            client.create_plan(params).await
        }
        "updatePlan" => {
            let product_ref = require_str(args, "productRef")?;
            let plan_ref = require_str(args, "planRef")?;
            let mut body = args.clone();
            body.remove("productRef");
            body.remove("planRef");
            let params: UpdatePlanRequest = parse_args(&body)?;
            client.update_plan(&product_ref, &plan_ref, params).await
        }
        "deletePlan" => {
            let product_ref = require_str(args, "productRef")?;
            let plan_ref = require_str(args, "planRef")?;
            client.delete_plan(&product_ref, &plan_ref).await?;
            Ok(Value::Null)
        }
        "cancelPurchase" => {
            let params: CancelPurchaseParams = parse_args(args)?;
            client.cancel_purchase(params).await
        }
        "reactivatePurchase" => {
            let params: ReactivatePurchaseParams = parse_args(args)?;
            client.reactivate_purchase(params).await
        }
        "getPaymentMethod" => {
            let params: GetPaymentMethodParams = parse_args(args)?;
            client.get_payment_method(params).await
        }
        "getAutoRecharge" => {
            let params: GetAutoRechargeParams = parse_args(args)?;
            client.get_auto_recharge(params).await
        }
        "saveAutoRecharge" => {
            let params: SaveAutoRechargeParams = parse_args(args)?;
            client.save_auto_recharge(params).await
        }
        "disableAutoRecharge" => {
            let params: DisableAutoRechargeParams = parse_args(args)?;
            client.disable_auto_recharge(params).await
        }
        other => Err(SdkError::transport(
            format!("unsupported Group C fixture fn: {other}"),
            false,
        )),
    }
}

pub fn assert_expect(
    outcome: Result<Value, SdkError>,
    expect: &FixtureExpect,
) -> Result<(), String> {
    match (outcome, expect) {
        (Ok(actual), FixtureExpect::Result(expected)) => {
            // Typed f64 fields re-serialize as `25.0` while fixtures record `25`.
            if json_eq_numeric(&actual, expected) {
                Ok(())
            } else {
                Err(format!(
                    "result mismatch:\n  got:      {actual}\n  expected: {expected}"
                ))
            }
        }
        (
            Err(SdkError::Api {
                message, status, ..
            }),
            FixtureExpect::Error(err),
        ) => {
            if message != err.message {
                return Err(format!(
                    "error message mismatch: got {message:?}, expected {:?}",
                    err.message
                ));
            }
            let expected_status = err.status.and_then(|s| u16::try_from(s).ok());
            if status != expected_status {
                return Err(format!(
                    "error status mismatch: got {status:?}, expected {expected_status:?}"
                ));
            }
            Ok(())
        }
        (Ok(v), FixtureExpect::Error(err)) => {
            Err(format!("expected error {:?}, got success {v}", err.message))
        }
        (Err(e), FixtureExpect::Result(v)) => Err(format!("expected result {v}, got error {e:?}")),
        (Err(e), FixtureExpect::Error(err)) => {
            Err(format!("expected Api error {:?}, got {e:?}", err.message))
        }
    }
}

pub fn clock_ms_from_iso(iso: &str) -> Result<u64, String> {
    if iso == "2026-07-01T00:00:00Z" {
        return Ok(1_782_864_000_000);
    }
    Err(format!("unsupported fixture clock (extend parser): {iso}"))
}

fn require_str(args: &BTreeMap<String, Value>, key: &str) -> Result<String, SdkError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| SdkError::transport(format!("fixture missing {key}"), false))
}

fn parse_args<T: DeserializeOwned>(args: &BTreeMap<String, Value>) -> Result<T, SdkError> {
    let value = Value::Object(args.clone().into_iter().collect());
    serde_json::from_value(value)
        .map_err(|err| SdkError::transport(format!("parse fixture args: {err}"), false))
}

fn serialize_result<T: serde::Serialize>(value: T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize typed result: {err}"), false))
}

/// Deep equality with numeric coercion (`25` == `25.0`).
fn json_eq_numeric(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) => x == y,
            _ => a == b,
        },
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| json_eq_numeric(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|other| json_eq_numeric(v, other)))
        }
        _ => left == right,
    }
}
