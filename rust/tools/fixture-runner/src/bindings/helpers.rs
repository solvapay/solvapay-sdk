//! Step 26/27/29/30/31 helper-core fixture bindings.

use serde_json::Value;
use solvapay_core::{
    attach_business_details_validation_error, build_create_customer_params, classify_cancel_error,
    classify_create_error, classify_customer_ref, classify_lookup_error, classify_reactivate_error,
    coerce_customer_options, extract_backend_customer_ref, is_cached_customer_ref_valid,
    is_email_conflict, is_error_result, map_route_error, normalize_cancel_response,
    normalize_reactivate_response, project_payment_intent_result, project_topup_process_outcome,
    project_usage_snapshot, resolve_authenticated_user, resolve_check_limits_params,
    resolve_purchase_customer_ref, resolve_return_url, select_active_purchases,
    validate_activate_plan_params, validate_attach_business_details_params,
    validate_checkout_session_params, validate_create_payment_intent_params,
    validate_get_product_params, validate_list_plans_params,
    validate_process_payment_intent_params, validate_purchase_ref,
    validate_topup_payment_intent_params, AuthResolutionInput, PaymentIntentSource,
    RouteErrorInput, RouteErrorKind,
};

use super::webhook::parse_iso8601_utc_to_unix_secs;
use crate::model::FixtureInput;
use crate::runner::{args_object, require_string_arg, BindingError};

/// Binding for `resolveAuthenticatedUser`.
///
/// # Arguments
///
/// * `input` - Fixture args: header/bearer/secret/flags; optional `clock` on input.
///
/// # Returns
///
/// Authenticated user JSON or helper error JSON (`expect.result` shape).
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when args are invalid.
pub fn invoke_resolve_authenticated_user(input: &FixtureInput) -> Result<Value, BindingError> {
    let header_user_id = optional_string_arg(input, "headerUserId")?;
    let authorization_header = optional_string_arg(input, "authorizationHeader")?;
    let jwt_secret = optional_string_arg(input, "jwtSecret")?;
    let strict_mode = require_bool_arg(input, "strictMode")?;
    let include_email = require_bool_arg(input, "includeEmail")?;
    let include_name = require_bool_arg(input, "includeName")?;
    let now_unix_secs = match &input.clock {
        Some(clock) => parse_iso8601_utc_to_unix_secs(clock).ok_or_else(|| {
            BindingError::Harness(format!(
                "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock:?}"
            ))
        })?,
        // Far-past/far-future exp/nbf fixtures do not need an exact boundary clock.
        None => 1_700_000_000,
    };

    let resolved = resolve_authenticated_user(&AuthResolutionInput {
        header_user_id,
        authorization_header,
        jwt_secret,
        strict_mode,
        include_email,
        include_name,
        now_unix_secs,
    });

    match resolved {
        Ok(user) => serde_json::to_value(user).map_err(|e| BindingError::Harness(e.to_string())),
        Err(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `classifyCustomerRef`.
pub fn invoke_classify_customer_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let customer_ref = require_string_arg(input, "customerRef")?;
    serde_json::to_value(classify_customer_ref(&customer_ref))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `coerceCustomerOptions`.
pub fn invoke_coerce_customer_options(input: &FixtureInput) -> Result<Value, BindingError> {
    let email = optional_string_arg(input, "email")?;
    let name = optional_string_arg(input, "name")?;
    serde_json::to_value(coerce_customer_options(email.as_deref(), name.as_deref()))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `buildCreateCustomerParams`.
pub fn invoke_build_create_customer_params(input: &FixtureInput) -> Result<Value, BindingError> {
    let customer_ref = require_string_arg(input, "customerRef")?;
    let external_ref = optional_string_arg(input, "externalRef")?;
    let email = optional_string_arg(input, "email")?;
    let name = optional_string_arg(input, "name")?;
    let clock = input.clock.as_deref().ok_or_else(|| {
        BindingError::Harness("input.clock is required for buildCreateCustomerParams".to_owned())
    })?;
    let now_unix_secs = parse_iso8601_utc_to_unix_secs(clock).ok_or_else(|| {
        BindingError::Harness(format!(
            "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock:?}"
        ))
    })?;
    let now_ms = now_unix_secs.saturating_mul(1000);
    let params = build_create_customer_params(
        &customer_ref,
        external_ref.as_deref(),
        email.as_deref(),
        name.as_deref(),
        now_ms,
    );
    serde_json::to_value(params).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `extractBackendCustomerRef`.
pub fn invoke_extract_backend_customer_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let response = match args.get("response") {
        Some(Value::Object(map)) => map,
        _ => {
            return Err(BindingError::Harness(
                "args.response must be an object".into(),
            ))
        }
    };
    let fallback = require_string_arg(input, "fallback")?;
    Ok(Value::String(extract_backend_customer_ref(
        response, &fallback,
    )))
}

/// Binding for `classifyLookupError`.
pub fn invoke_classify_lookup_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    serde_json::to_value(classify_lookup_error(&message))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `classifyCreateError`.
pub fn invoke_classify_create_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    serde_json::to_value(classify_create_error(&message))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `isEmailConflict`.
pub fn invoke_is_email_conflict(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    Ok(Value::Bool(is_email_conflict(&message)))
}

/// Binding for `validateActivatePlanParams`.
pub fn invoke_validate_activate_plan_params(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = optional_string_arg(input, "productRef")?;
    let plan_ref = optional_string_arg(input, "planRef")?;
    match validate_activate_plan_params(product_ref.as_deref(), plan_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `validateCreatePaymentIntentParams`.
pub fn invoke_validate_create_payment_intent_params(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let plan_ref = optional_string_arg(input, "planRef")?;
    let product_ref = optional_string_arg(input, "productRef")?;
    match validate_create_payment_intent_params(plan_ref.as_deref(), product_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `validateTopupPaymentIntentParams`.
pub fn invoke_validate_topup_payment_intent_params(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let amount = optional_f64_arg(input, "amount")?;
    let currency = optional_string_arg(input, "currency")?;
    match validate_topup_payment_intent_params(amount, currency.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `validateProcessPaymentIntentParams`.
pub fn invoke_validate_process_payment_intent_params(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let payment_intent_id = optional_string_arg(input, "paymentIntentId")?;
    let product_ref = optional_string_arg(input, "productRef")?;
    match validate_process_payment_intent_params(
        payment_intent_id.as_deref(),
        product_ref.as_deref(),
    ) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `validateAttachBusinessDetailsParams`.
pub fn invoke_validate_attach_business_details_params(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let payment_intent_id = optional_string_arg(input, "paymentIntentId")?;
    match validate_attach_business_details_params(payment_intent_id.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `attachBusinessDetailsValidationError`.
pub fn invoke_attach_business_details_validation_error(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let first_issue_message = optional_string_arg(input, "firstIssueMessage")?;
    let err = attach_business_details_validation_error(first_issue_message.as_deref());
    serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `projectPaymentIntentResult`.
pub fn invoke_project_payment_intent_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let processor_payment_id = require_string_arg(input, "processorPaymentId")?;
    let client_secret = require_string_arg(input, "clientSecret")?;
    let publishable_key = require_string_arg(input, "publishableKey")?;
    let customer_ref = require_string_arg(input, "customerRef")?;
    let account_id = optional_string_arg(input, "accountId")?;
    let projected = project_payment_intent_result(
        &PaymentIntentSource {
            processor_payment_id,
            client_secret,
            publishable_key,
            account_id,
        },
        &customer_ref,
    );
    serde_json::to_value(projected).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `projectTopupProcessOutcome`.
pub fn invoke_project_topup_process_outcome(input: &FixtureInput) -> Result<Value, BindingError> {
    let status = optional_string_arg(input, "status")?;
    let message = optional_string_arg(input, "message")?;
    let outcome = project_topup_process_outcome(status.as_deref(), message.as_deref());
    serde_json::to_value(outcome).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `validateCheckoutSessionParams`.
pub fn invoke_validate_checkout_session_params(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let product_ref = optional_string_arg(input, "productRef")?;
    match validate_checkout_session_params(product_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `resolveReturnUrl`.
pub fn invoke_resolve_return_url(input: &FixtureInput) -> Result<Value, BindingError> {
    let body_return_url = optional_string_arg(input, "bodyReturnUrl")?;
    let options_return_url = optional_string_arg(input, "optionsReturnUrl")?;
    let origin = optional_string_arg(input, "origin")?;
    match resolve_return_url(
        body_return_url.as_deref(),
        options_return_url.as_deref(),
        origin.as_deref(),
    ) {
        None => Ok(Value::Null),
        Some(url) => Ok(Value::String(url)),
    }
}

/// Binding for `selectActivePurchases`.
pub fn invoke_select_active_purchases(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let purchases = match args.get("purchases") {
        Some(Value::Array(arr)) => arr.as_slice(),
        _ => {
            return Err(BindingError::Harness(
                "args.purchases must be an array".into(),
            ))
        }
    };
    Ok(Value::Array(select_active_purchases(purchases)))
}

/// Binding for `isCachedCustomerRefValid`.
pub fn invoke_is_cached_customer_ref_valid(input: &FixtureInput) -> Result<Value, BindingError> {
    let external_ref = optional_string_arg(input, "externalRef")?;
    let user_id = require_string_arg(input, "userId")?;
    let customer_ref = optional_string_arg(input, "customerRef")?;
    Ok(Value::Bool(is_cached_customer_ref_valid(
        external_ref.as_deref(),
        &user_id,
        customer_ref.as_deref(),
    )))
}

/// Binding for `resolvePurchaseCustomerRef`.
pub fn invoke_resolve_purchase_customer_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let customer_ref = optional_string_arg(input, "customerRef")?;
    let user_id = require_string_arg(input, "userId")?;
    Ok(Value::String(resolve_purchase_customer_ref(
        customer_ref.as_deref(),
        &user_id,
    )))
}

/// Binding for `validatePurchaseRef`.
pub fn invoke_validate_purchase_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let purchase_ref = optional_string_arg(input, "purchaseRef")?;
    match validate_purchase_ref(purchase_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `normalizeCancelResponse`.
pub fn invoke_normalize_cancel_response(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let response = match args.get("response") {
        Some(v) => v.clone(),
        None => Value::Null,
    };
    match normalize_cancel_response(&response) {
        Ok(v) => Ok(v),
        Err(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `normalizeReactivateResponse`.
pub fn invoke_normalize_reactivate_response(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let response = match args.get("response") {
        Some(v) => v.clone(),
        None => Value::Null,
    };
    match normalize_reactivate_response(&response) {
        Ok(v) => Ok(v),
        Err(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `classifyCancelError`.
pub fn invoke_classify_cancel_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    serde_json::to_value(classify_cancel_error(&message))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `classifyReactivateError`.
pub fn invoke_classify_reactivate_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let message = require_string_arg(input, "message")?;
    serde_json::to_value(classify_reactivate_error(&message))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `projectUsageSnapshot`.
pub fn invoke_project_usage_snapshot(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let purchase = match args.get("activePurchase") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v),
    };
    serde_json::to_value(project_usage_snapshot(purchase))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `resolveCheckLimitsParams`.
pub fn invoke_resolve_check_limits_params(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = optional_string_arg(input, "productRef")?;
    let meter_name = optional_string_arg(input, "meterName")?;
    match resolve_check_limits_params(product_ref.as_deref(), meter_name.as_deref()) {
        Ok(params) => {
            serde_json::to_value(params).map_err(|e| BindingError::Harness(e.to_string()))
        }
        Err(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `validateListPlansParams`.
pub fn invoke_validate_list_plans_params(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = optional_string_arg(input, "productRef")?;
    match validate_list_plans_params(product_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Binding for `mapRouteError`.
pub fn invoke_map_route_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let kind = match require_string_arg(input, "kind")?.as_str() {
        "solvapay" => RouteErrorKind::SolvaPay,
        "error" => RouteErrorKind::Error,
        "unknown" => RouteErrorKind::Unknown,
        other => {
            return Err(BindingError::Harness(format!(
                "args.kind must be 'solvapay' | 'error' | 'unknown', got {other:?}"
            )))
        }
    };
    let message = optional_string_arg(input, "message")?;
    let default_message = optional_string_arg(input, "defaultMessage")?;
    let operation_name = require_string_arg(input, "operationName")?;
    let status = optional_u16_arg(input, "status")?;
    let result = map_route_error(&RouteErrorInput {
        kind,
        message,
        status,
        operation_name,
        default_message,
    });
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `isErrorResult`.
pub fn invoke_is_error_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let value = args.get("result").cloned().unwrap_or(Value::Null);
    Ok(Value::Bool(is_error_result(&value)))
}

/// Binding for `validateGetProductParams`.
pub fn invoke_validate_get_product_params(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = optional_string_arg(input, "productRef")?;
    match validate_get_product_params(product_ref.as_deref()) {
        None => Ok(Value::Null),
        Some(err) => serde_json::to_value(err).map_err(|e| BindingError::Harness(e.to_string())),
    }
}

/// Reads an optional string arg (`null`/absent → `None`).
fn optional_string_arg(input: &FixtureInput, key: &str) -> Result<Option<String>, BindingError> {
    match input.args.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string or null"
        ))),
    }
}

/// Reads a required boolean arg.
fn require_bool_arg(input: &FixtureInput, key: &str) -> Result<bool, BindingError> {
    match input.args.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a boolean"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional f64 arg (`null`/absent → `None`).
fn optional_f64_arg(input: &FixtureInput, key: &str) -> Result<Option<f64>, BindingError> {
    match input.args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a finite number"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}

/// Reads an optional u16 arg (`null`/absent → `None`).
fn optional_u16_arg(input: &FixtureInput, key: &str) -> Result<Option<u16>, BindingError> {
    match input.args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a u16"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number or null"
        ))),
    }
}
