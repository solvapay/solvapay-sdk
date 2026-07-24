//! Default `solvapay-core` bindings for the golden-fixture corpus.

mod balance_poll;
mod error_model;
mod helpers;
mod mcp_descriptors;
mod mcp_payload;
mod paywall_gate;
mod paywall_payload;
mod paywall_state;
mod retry;
mod webhook;

use serde_json::{Map, Value};
use solvapay_core::{
    credits_to_display_minor_units, derive_tax_id_type, get_business_country_options,
    get_seller_tax_identifier_display_label, get_tax_id_example, get_tax_id_field_label,
    get_tax_id_helper_text, is_zero_decimal_currency, minor_units_per_major,
    resolve_seller_identity_display, resolve_tax_behavior,
    seller_tax_identifier_display_label_by_type, validate_business_details, BusinessDetailsInput,
    CreditsToDisplayInput, SellerIdentityInput,
};

use crate::model::FixtureInput;
use crate::runner::{args_object, require_string_arg, Binding, BindingError, BindingRegistry};

/// Builds the default [`BindingRegistry`] with step-9/11/12/13 core bindings (`id: "core"`).
///
/// Registers all `solvapay-core` functions exercised by the golden-fixture corpus,
/// including `verifyWebhook` and paywall state helpers.
///
/// # Returns
///
/// A fully populated registry ready for [`crate::run_suite`].
pub fn create_default_registry() -> BindingRegistry {
    let mut registry = BindingRegistry::new();

    registry.register(
        "validateBusinessDetails",
        Binding {
            id: "core",
            invoke: Box::new(invoke_validate_business_details),
        },
    );

    registry.register(
        "deriveTaxIdType",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let country = require_string_arg(input, "country")?;
                let tax_type = derive_tax_id_type(&country)
                    .ok_or_else(|| format!("unsupported country: {country}"))?;
                serde_json::to_value(tax_type).map_err(|e| BindingError::Harness(e.to_string()))
            }),
        },
    );

    registry.register(
        "resolveTaxBehavior",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let behavior = require_string_arg(input, "behavior")?;
                let currency = require_string_arg(input, "currency")?;
                let resolved = resolve_tax_behavior(&behavior, &currency)
                    .ok_or_else(|| format!("unsupported tax behavior: {behavior}"))?;
                Ok(Value::String(resolved.to_owned()))
            }),
        },
    );

    registry.register(
        "getTaxIdExample",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let country = require_string_arg(input, "country")?;
                let example = get_tax_id_example(&country)
                    .ok_or_else(|| format!("unsupported country: {country}"))?;
                Ok(Value::String(example.to_owned()))
            }),
        },
    );

    registry.register(
        "getTaxIdFieldLabel",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let country = require_string_arg(input, "country")?;
                let label = get_tax_id_field_label(&country)
                    .ok_or_else(|| format!("unsupported country: {country}"))?;
                Ok(Value::String(label.to_owned()))
            }),
        },
    );

    registry.register(
        "getTaxIdHelperText",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let country = require_string_arg(input, "country")?;
                let text = get_tax_id_helper_text(&country)
                    .ok_or_else(|| format!("unsupported country: {country}"))?;
                Ok(Value::String(text))
            }),
        },
    );

    registry.register(
        "getBusinessCountryOptions",
        Binding {
            id: "core",
            invoke: Box::new(|_input| {
                serde_json::to_value(get_business_country_options())
                    .map_err(|e| BindingError::Harness(e.to_string()))
            }),
        },
    );

    registry.register(
        "minorUnitsPerMajor",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let currency = require_string_arg(input, "currency")?;
                Ok(Value::from(minor_units_per_major(&currency)))
            }),
        },
    );

    registry.register(
        "isZeroDecimalCurrency",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let currency = require_string_arg(input, "currency")?;
                Ok(Value::Bool(is_zero_decimal_currency(&currency)))
            }),
        },
    );

    registry.register(
        "creditsToDisplayMinorUnits",
        Binding {
            id: "core",
            invoke: Box::new(invoke_credits_to_display_minor_units),
        },
    );

    registry.register(
        "SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE",
        Binding {
            id: "core",
            invoke: Box::new(|_input| {
                let mut map = Map::new();
                for (key, label) in seller_tax_identifier_display_label_by_type() {
                    map.insert((*key).to_owned(), Value::String((*label).to_owned()));
                }
                Ok(Value::Object(map))
            }),
        },
    );

    registry.register(
        "getSellerTaxIdentifierDisplayLabel",
        Binding {
            id: "core",
            invoke: Box::new(|input| {
                let country = optional_string_arg(input, "country")?;
                Ok(Value::String(get_seller_tax_identifier_display_label(
                    country.as_deref(),
                )))
            }),
        },
    );

    registry.register(
        "resolveSellerIdentityDisplay",
        Binding {
            id: "core",
            invoke: Box::new(invoke_resolve_seller_identity_display),
        },
    );

    registry.register(
        "withRetry",
        Binding {
            id: "core",
            invoke: Box::new(retry::invoke_with_retry),
        },
    );

    registry.register(
        "pollBalanceUntilIncreased",
        Binding {
            id: "core",
            invoke: Box::new(balance_poll::invoke_poll_balance_until_increased),
        },
    );

    registry.register(
        "TOPUP_BALANCE_POLL_DELAYS_MS",
        Binding {
            id: "core",
            invoke: Box::new(balance_poll::invoke_topup_delays),
        },
    );

    registry.register(
        "BALANCE_RECONCILE_DELAYS_MS",
        Binding {
            id: "core",
            invoke: Box::new(balance_poll::invoke_reconcile_delays),
        },
    );

    registry.register(
        "verifyWebhook",
        Binding {
            id: "core",
            invoke: Box::new(webhook::invoke_verify_webhook),
        },
    );

    registry.register(
        "constructSdkError",
        Binding {
            id: "core",
            invoke: Box::new(error_model::invoke_construct_sdk_error),
        },
    );

    registry.register(
        "classifyPaywallState",
        Binding {
            id: "core",
            invoke: Box::new(paywall_state::invoke_classify_paywall_state),
        },
    );

    registry.register(
        "buildGateMessage",
        Binding {
            id: "core",
            invoke: Box::new(paywall_state::invoke_build_gate_message),
        },
    );

    registry.register(
        "buildNudgeMessage",
        Binding {
            id: "core",
            invoke: Box::new(paywall_state::invoke_build_nudge_message),
        },
    );

    registry.register(
        "buildPaywallGate",
        Binding {
            id: "core",
            invoke: Box::new(paywall_gate::invoke_build_paywall_gate),
        },
    );

    registry.register(
        "paywallErrorToClientPayload",
        Binding {
            id: "core",
            invoke: Box::new(paywall_payload::invoke_paywall_error_to_client_payload),
        },
    );

    registry.register(
        "paywallToolResult",
        Binding {
            id: "core",
            invoke: Box::new(mcp_payload::invoke_paywall_tool_result),
        },
    );
    registry.register(
        "makeResponseResult",
        Binding {
            id: "core",
            invoke: Box::new(mcp_payload::invoke_make_response_result),
        },
    );
    registry.register(
        "assertResponseResult",
        Binding {
            id: "core",
            invoke: Box::new(mcp_payload::invoke_assert_response_result),
        },
    );

    registry.register(
        "MCP_TOOL_NAMES",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_mcp_tool_names),
        },
    );
    registry.register(
        "mcpViewMaps",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_mcp_view_maps),
        },
    );
    registry.register(
        "deriveIcons",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_derive_icons),
        },
    );
    registry.register(
        "buildToolDescriptorMetadata",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_build_tool_descriptor_metadata),
        },
    );
    registry.register(
        "buildPromptDescriptorMetadata",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_build_prompt_descriptor_metadata),
        },
    );
    registry.register(
        "buildPromptUserMessage",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_build_prompt_user_message),
        },
    );
    registry.register(
        "validatePublicBaseUrl",
        Binding {
            id: "core",
            invoke: Box::new(mcp_descriptors::invoke_validate_public_base_url),
        },
    );

    registry.register(
        "resolveAuthenticatedUser",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_resolve_authenticated_user),
        },
    );
    registry.register(
        "classifyCustomerRef",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_classify_customer_ref),
        },
    );
    registry.register(
        "coerceCustomerOptions",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_coerce_customer_options),
        },
    );
    registry.register(
        "buildCreateCustomerParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_build_create_customer_params),
        },
    );
    registry.register(
        "extractBackendCustomerRef",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_extract_backend_customer_ref),
        },
    );
    registry.register(
        "classifyLookupError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_classify_lookup_error),
        },
    );
    registry.register(
        "classifyCreateError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_classify_create_error),
        },
    );
    registry.register(
        "isEmailConflict",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_is_email_conflict),
        },
    );
    registry.register(
        "validateActivatePlanParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_activate_plan_params),
        },
    );
    registry.register(
        "validateCreatePaymentIntentParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_create_payment_intent_params),
        },
    );
    registry.register(
        "validateTopupPaymentIntentParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_topup_payment_intent_params),
        },
    );
    registry.register(
        "validateProcessPaymentIntentParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_process_payment_intent_params),
        },
    );
    registry.register(
        "validateAttachBusinessDetailsParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_attach_business_details_params),
        },
    );
    registry.register(
        "attachBusinessDetailsValidationError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_attach_business_details_validation_error),
        },
    );
    registry.register(
        "projectPaymentIntentResult",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_project_payment_intent_result),
        },
    );
    registry.register(
        "projectTopupProcessOutcome",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_project_topup_process_outcome),
        },
    );
    registry.register(
        "validateCheckoutSessionParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_checkout_session_params),
        },
    );
    registry.register(
        "resolveReturnUrl",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_resolve_return_url),
        },
    );
    registry.register(
        "selectActivePurchases",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_select_active_purchases),
        },
    );
    registry.register(
        "isCachedCustomerRefValid",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_is_cached_customer_ref_valid),
        },
    );
    registry.register(
        "resolvePurchaseCustomerRef",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_resolve_purchase_customer_ref),
        },
    );
    registry.register(
        "validatePurchaseRef",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_purchase_ref),
        },
    );
    registry.register(
        "normalizeCancelResponse",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_normalize_cancel_response),
        },
    );
    registry.register(
        "normalizeReactivateResponse",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_normalize_reactivate_response),
        },
    );
    registry.register(
        "classifyCancelError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_classify_cancel_error),
        },
    );
    registry.register(
        "classifyReactivateError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_classify_reactivate_error),
        },
    );
    registry.register(
        "projectUsageSnapshot",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_project_usage_snapshot),
        },
    );
    registry.register(
        "resolveCheckLimitsParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_resolve_check_limits_params),
        },
    );
    registry.register(
        "validateListPlansParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_list_plans_params),
        },
    );
    registry.register(
        "mapRouteError",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_map_route_error),
        },
    );
    registry.register(
        "isErrorResult",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_is_error_result),
        },
    );
    registry.register(
        "validateGetProductParams",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_validate_get_product_params),
        },
    );
    registry.register(
        "resolveProductRef",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_resolve_product_ref),
        },
    );
    registry.register(
        "evaluateCachedLimits",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_evaluate_cached_limits),
        },
    );
    registry.register(
        "evaluateFreshLimits",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_evaluate_fresh_limits),
        },
    );
    registry.register(
        "decidePaywallOutcome",
        Binding {
            id: "core",
            invoke: Box::new(helpers::invoke_decide_paywall_outcome),
        },
    );

    registry
}

/// Binding for `validateBusinessDetails`.
///
/// Deserializes fixture args to [`BusinessDetailsInput`] and serializes the validation result.
///
/// # Arguments
///
/// * `input` - Fixture input block with `args` shaped as `BusinessDetailsInput` JSON.
///
/// # Returns
///
/// JSON value of the validation result on success.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when deserialization or serialization fails.
fn invoke_validate_business_details(input: &FixtureInput) -> Result<Value, BindingError> {
    let args = args_object(input);
    let parsed: BusinessDetailsInput = serde_json::from_value(args)
        .map_err(|e| BindingError::Harness(format!("invalid BusinessDetailsInput: {e}")))?;
    let result = validate_business_details(&parsed);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `creditsToDisplayMinorUnits`.
///
/// Maps core output to JSON, using `null` when the core function returns `None`.
///
/// # Arguments
///
/// * `input` - Fixture input with required numeric `credits`, `creditsPerMinorUnit`, `displayExchangeRate`, and string `displayCurrency` args.
///
/// # Returns
///
/// JSON number on success, or JSON `null` when conversion is undefined.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when required args are missing or invalid.
fn invoke_credits_to_display_minor_units(input: &FixtureInput) -> Result<Value, BindingError> {
    let credits = require_number_arg(input, "credits")?;
    let credits_per_minor_unit = require_number_arg(input, "creditsPerMinorUnit")?;
    let display_exchange_rate = require_number_arg(input, "displayExchangeRate")?;
    let display_currency = require_string_arg(input, "displayCurrency")?;
    let result = credits_to_display_minor_units(&CreditsToDisplayInput {
        credits,
        credits_per_minor_unit,
        display_exchange_rate,
        display_currency,
    });
    match result {
        Some(n) => Ok(Value::from(n)),
        None => Ok(Value::Null),
    }
}

/// Binding for `resolveSellerIdentityDisplay`.
///
/// Maps optional string fixture args into [`SellerIdentityInput`] and serializes the display result.
///
/// # Arguments
///
/// * `input` - Fixture input with optional string args `country`, `vatNumber`, `taxId`, and `companyNumber`.
///
/// # Returns
///
/// JSON value of the resolved seller identity display.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when arg types are invalid or serialization fails.
fn invoke_resolve_seller_identity_display(input: &FixtureInput) -> Result<Value, BindingError> {
    let parsed = SellerIdentityInput {
        country: optional_string_arg(input, "country")?,
        vat_number: optional_string_arg(input, "vatNumber")?,
        tax_id: optional_string_arg(input, "taxId")?,
        company_number: optional_string_arg(input, "companyNumber")?,
    };
    let result = resolve_seller_identity_display(&parsed);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Reads a required numeric argument from `input.args`.
///
/// # Arguments
///
/// * `input` - Fixture input block containing the `args` map.
/// * `key` - Argument name (e.g. `"credits"`).
///
/// # Returns
///
/// The finite `f64` value.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the key is missing, not a number, or not finite.
fn require_number_arg(input: &FixtureInput, key: &str) -> Result<f64, BindingError> {
    match input.args.get(key) {
        Some(Value::Number(n)) => n
            .as_f64()
            .ok_or_else(|| BindingError::Harness(format!("args.{key} must be a finite number"))),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a number"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}

/// Reads an optional string argument from `input.args`.
///
/// # Arguments
///
/// * `input` - Fixture input block containing the `args` map.
/// * `key` - Argument name.
///
/// # Returns
///
/// `None` when the key is absent or JSON `null`; `Some(string)` when present as a string.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when the value is neither a string nor JSON `null`.
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
