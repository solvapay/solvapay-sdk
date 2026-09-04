//! Verbatim / non-IR fixture bindings that the registry emitter cannot derive.

use serde_json::Value;
use solvapay_core::{
    assert_valid_product_ref, evaluate_product_readiness, map_route_error,
    project_payment_intent_result, project_usage_snapshot, require_product_ref,
    resolve_authenticated_user, resolve_return_url, select_active_purchases, AuthResolutionInput,
    PaymentIntentSource, ProductReadinessInput, RouteErrorInput, RouteErrorKind,
};

use super::webhook::parse_iso8601_utc_to_unix_secs;
use crate::model::FixtureInput;
use crate::runner::{args_object, require_string_arg, BindingError};
use crate::sdk_error::sdk_error_to_observation;

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

/// Binding for `projectUsageSnapshot`.
pub fn invoke_project_usage_snapshot(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let purchase = match args.get("activePurchase") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v),
    };
    let limits = match args.get("limits") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v),
    };
    serde_json::to_value(project_usage_snapshot(purchase, limits))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `mapRouteError`.
pub fn invoke_map_route_error(input: &FixtureInput) -> Result<Value, BindingError> {
    let kind = match require_string_arg(input, "kind")?.as_str() {
        "solvapay" => RouteErrorKind::SolvaPay,
        "paywall" => RouteErrorKind::Paywall,
        "error" => RouteErrorKind::Error,
        "unknown" => RouteErrorKind::Unknown,
        other => {
            return Err(BindingError::Harness(format!(
                "args.kind must be 'solvapay' | 'paywall' | 'error' | 'unknown', got {other:?}"
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

/// Binding for `requireProductRef`.
pub fn invoke_require_product_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let metadata_product = optional_string_arg(input, "metadataProduct")?;
    let env_product = optional_string_arg(input, "envProduct")?;
    match require_product_ref(metadata_product.as_deref(), env_product.as_deref()) {
        Ok(value) => Ok(Value::String(value)),
        Err(err) => Err(BindingError::Sdk(sdk_error_to_observation(err))),
    }
}

/// Binding for `evaluateProductReadiness`.
pub fn invoke_evaluate_product_readiness(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let product: ProductReadinessInput =
        serde_json::from_value(args).map_err(|e| BindingError::Harness(e.to_string()))?;
    serde_json::to_value(evaluate_product_readiness(&product))
        .map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `assertValidProductRef`.
pub fn invoke_assert_valid_product_ref(input: &FixtureInput) -> Result<Value, BindingError> {
    let product_ref = require_string_arg(input, "productRef")?;
    let context = require_string_arg(input, "context")?;
    match assert_valid_product_ref(&product_ref, &context) {
        Ok(()) => Ok(Value::Null),
        Err(err) => Err(BindingError::Sdk(sdk_error_to_observation(err))),
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
