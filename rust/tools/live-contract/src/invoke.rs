//! Dispatch camelCase ops onto [`solvapay::blocking::BlockingClient`].

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use solvapay::blocking::BlockingClient;
use solvapay::SdkError;
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

use crate::{err_outcome, extract_ref, ok_outcome};

/// JSON observation for one invoke (`{ok, value|error}`).
pub type Outcome = Value;

/// Invokes one camelCase operation on the public blocking facade client.
pub fn invoke(client: &BlockingClient, op: &str, args: &Value) -> Outcome {
    match dispatch(client, op, args) {
        Ok(value) => ok_outcome(value),
        Err(err) => err_outcome(sdk_error_observation(err)),
    }
}

/// Maps [`SdkError`] → JSON observation (Python/Ruby live-driver parity).
pub fn sdk_error_observation(error: SdkError) -> Value {
    match error {
        SdkError::Api {
            message,
            status,
            code,
        } => serde_json::json!({
            "name": "SolvaPayError",
            "message": message,
            "status": status,
            "code": code,
        }),
        SdkError::Paywall { message, .. } => serde_json::json!({
            "name": "PaywallError",
            "message": message,
            "status": null,
            "code": null,
        }),
        SdkError::Webhook { message, code } => serde_json::json!({
            "name": "SolvaPayError",
            "message": message,
            "status": null,
            "code": code.as_str(),
        }),
        SdkError::Transport { message, .. } => serde_json::json!({
            "name": "SolvaPayError",
            "message": message,
            "status": null,
            "code": null,
        }),
    }
}

/// Creates product / plan / customer fixtures for the live run.
///
/// # Errors
///
/// Returns a human-readable setup failure when any create/extract step fails.
pub fn setup_side(
    client: &BlockingClient,
    run_id: &str,
) -> Result<BTreeMap<String, String>, String> {
    let side_tag = format!("rs-{run_id}");
    let email = format!("shadow-{side_tag}@example.com");

    let product = invoke(
        client,
        "createProduct",
        &serde_json::json!({
            "name": format!("Shadow Product {side_tag}"),
            "config": {},
            "metadata": {}
        }),
    );
    if product.get("ok") != Some(&Value::Bool(true)) {
        return Err(format!("setup createProduct failed: {product}"));
    }
    let product_ref = extract_ref(
        product.get("value").unwrap_or(&Value::Null),
        &["reference", "productRef"],
    )
    .ok_or_else(|| format!("setup missing productRef: {product}"))?;

    let plan = invoke(
        client,
        "createPlan",
        &serde_json::json!({
            "productRef": product_ref,
            "name": format!("Shadow Plan {side_tag}"),
            "type": "recurring",
            "billingCycle": "monthly",
            "price": 1000,
            "currency": "usd"
        }),
    );
    if plan.get("ok") != Some(&Value::Bool(true)) {
        return Err(format!("setup createPlan failed: {plan}"));
    }
    let plan_ref = extract_ref(
        plan.get("value").unwrap_or(&Value::Null),
        &["reference", "planRef"],
    )
    .ok_or_else(|| format!("setup missing planRef: {plan}"))?;

    let customer = invoke(
        client,
        "createCustomer",
        &serde_json::json!({ "email": email }),
    );
    if customer.get("ok") != Some(&Value::Bool(true)) {
        return Err(format!("setup createCustomer failed: {customer}"));
    }
    let customer_ref = extract_ref(
        customer.get("value").unwrap_or(&Value::Null),
        &["customerRef", "reference"],
    )
    .ok_or_else(|| format!("setup missing customerRef: {customer}"))?;

    let mut refs = BTreeMap::new();
    refs.insert("productRef".to_owned(), product_ref);
    refs.insert("planRef".to_owned(), plan_ref);
    refs.insert("customerRef".to_owned(), customer_ref);
    refs.insert("email".to_owned(), email);
    refs.insert("sideTag".to_owned(), side_tag);
    refs.insert("purchaseRef".to_owned(), "pur_missing_shadow".to_owned());
    refs.insert("paymentIntentId".to_owned(), "pi_missing_shadow".to_owned());
    Ok(refs)
}

fn dispatch(client: &BlockingClient, op: &str, args: &Value) -> Result<Value, SdkError> {
    let map = args_as_map(args)?;
    match op {
        "createCustomer" => {
            let params: CreateCustomerRequest = parse_args(&map)?;
            serialize_result(client.create_customer(params)?)
        }
        "updateCustomer" => {
            let customer_ref = require_str(&map, "customerRef")?;
            let mut body = map.clone();
            body.remove("customerRef");
            let params: UpdateCustomerParams = parse_args(&body)?;
            serialize_result(client.update_customer(&customer_ref, params)?)
        }
        "getCustomer" => {
            let params: GetCustomerParams = parse_args(&map)?;
            serialize_result(client.get_customer(params)?)
        }
        "assignCredits" => {
            let params: AssignCreditsRequest = parse_args(&map)?;
            serialize_result(client.assign_credits(params)?)
        }
        "getCustomerBalance" => {
            let params: GetCustomerBalanceParams = parse_args(&map)?;
            serialize_result(client.get_customer_balance(params)?)
        }
        "getUserInfo" => {
            let params: GetUserInfoParams = parse_args(&map)?;
            serialize_result(client.get_user_info(params)?)
        }
        "createCheckoutSession" => {
            let params: CreateCheckoutSessionRequest = parse_args(&map)?;
            serialize_result(client.create_checkout_session(params)?)
        }
        "createCustomerSession" => {
            let params: CreateCustomerSessionRequest = parse_args(&map)?;
            serialize_result(client.create_customer_session(params)?)
        }
        "getMerchant" => serialize_result(client.get_merchant()?),
        "getPlatformConfig" => serialize_result(client.get_platform_config()?),
        "createPaymentIntent" => {
            let params: CreatePaymentIntentParams = parse_args(&map)?;
            serialize_result(client.create_payment_intent(params)?)
        }
        "createTopupPaymentIntent" => {
            let params: CreateTopupPaymentIntentParams = parse_args(&map)?;
            serialize_result(client.create_topup_payment_intent(params)?)
        }
        "processPaymentIntent" => {
            let params: ProcessPaymentIntentParams = parse_args(&map)?;
            serialize_result(client.process_payment_intent(params)?)
        }
        "attachBusinessDetails" => {
            let params: AttachBusinessDetailsParams = parse_args(&map)?;
            client.attach_business_details(params)
        }
        "activatePlan" => {
            let params: ActivatePlanDto = parse_args(&map)?;
            serialize_result(client.activate_plan(params)?)
        }
        "checkLimits" => {
            let params: CheckLimitsRequest = parse_args(&map)?;
            client.check_limits(params)
        }
        "trackUsage" => {
            let params: TrackUsageRequest = parse_args(&map)?;
            client.track_usage(params)
        }
        "trackUsageBulk" => {
            let params: TrackUsageBulkRequest = parse_args(&map)?;
            client.track_usage_bulk(params)
        }
        "getProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            client.get_product(&product_ref)
        }
        "listProducts" => client.list_products(),
        "createProduct" => {
            let params: CreateProductRequest = parse_args(&map)?;
            client.create_product(params)
        }
        "updateProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let params: UpdateProductRequest = parse_args(&body)?;
            client.update_product(&product_ref, params)
        }
        "deleteProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            client.delete_product(&product_ref)?;
            Ok(Value::Null)
        }
        "cloneProduct" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let overrides: CloneProductOverrides = parse_args(&body)?;
            serialize_result(client.clone_product(&product_ref, Some(overrides))?)
        }
        "bootstrapMcpProduct" => {
            let params: McpBootstrapDto = parse_args(&map)?;
            client.bootstrap_mcp_product(params)
        }
        "configureMcpPlans" => {
            let product_ref = require_str(&map, "productRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            let params: ConfigureMcpPlansDto = parse_args(&body)?;
            client.configure_mcp_plans(&product_ref, params)
        }
        "listPlans" => {
            let product_ref = require_str(&map, "productRef")?;
            client.list_plans(&product_ref)
        }
        "createPlan" => {
            let params: CreatePlanParams = parse_args(&map)?;
            client.create_plan(params)
        }
        "updatePlan" => {
            let product_ref = require_str(&map, "productRef")?;
            let plan_ref = require_str(&map, "planRef")?;
            let mut body = map.clone();
            body.remove("productRef");
            body.remove("planRef");
            let params: UpdatePlanRequest = parse_args(&body)?;
            client.update_plan(&product_ref, &plan_ref, params)
        }
        "deletePlan" => {
            let product_ref = require_str(&map, "productRef")?;
            let plan_ref = require_str(&map, "planRef")?;
            client.delete_plan(&product_ref, &plan_ref)?;
            Ok(Value::Null)
        }
        "cancelPurchase" => {
            let params: CancelPurchaseParams = parse_args(&map)?;
            client.cancel_purchase(params)
        }
        "reactivatePurchase" => {
            let params: ReactivatePurchaseParams = parse_args(&map)?;
            client.reactivate_purchase(params)
        }
        "getPaymentMethod" => {
            let params: GetPaymentMethodParams = parse_args(&map)?;
            client.get_payment_method(params)
        }
        "getAutoRecharge" => {
            let params: GetAutoRechargeParams = parse_args(&map)?;
            client.get_auto_recharge(params)
        }
        "saveAutoRecharge" => {
            let params: SaveAutoRechargeParams = parse_args(&map)?;
            client.save_auto_recharge(params)
        }
        "disableAutoRecharge" => {
            let params: DisableAutoRechargeParams = parse_args(&map)?;
            client.disable_auto_recharge(params)
        }
        other => Err(SdkError::transport(
            format!("unsupported live-contract op: {other}"),
            false,
        )),
    }
}

fn args_as_map(args: &Value) -> Result<Map<String, Value>, SdkError> {
    match args {
        Value::Object(map) => Ok(map.clone()),
        Value::Null => Ok(Map::new()),
        other => Err(SdkError::transport(
            format!("args must be an object, got {other}"),
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
