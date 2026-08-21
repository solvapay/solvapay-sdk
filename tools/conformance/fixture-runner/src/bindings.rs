//! Hand-written fixture-runner bindings (verbatim / non-IR residue).
//!
//! Generated wrap invoke bodies and the registration table live in
//! [`crate::registry`].

pub(crate) mod balance_poll;
pub(crate) mod error_model;
pub(crate) mod helpers;
pub(crate) mod mcp_descriptors;
pub(crate) mod mcp_payload;
pub(crate) mod retry;
pub(crate) mod webhook;

use serde_json::{Map, Value};
use solvapay_core::{
    credits_to_display_minor_units, derive_tax_id_type, get_tax_id_example, get_tax_id_field_label,
    get_tax_id_helper_text, minor_units_per_major, resolve_seller_identity_display,
    resolve_tax_behavior, seller_tax_identifier_display_label_by_type, validate_business_details,
    BusinessDetailsInput, CreditsToDisplayInput, SellerIdentityInput,
};

use crate::model::FixtureInput;
use crate::runner::{args_object, require_string_arg, BindingError};

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
pub(crate) fn invoke_validate_business_details(input: &FixtureInput) -> Result<Value, BindingError> {
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
pub(crate) fn invoke_credits_to_display_minor_units(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
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
pub(crate) fn invoke_resolve_seller_identity_display(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let parsed = SellerIdentityInput {
        country: optional_string_arg(input, "country")?,
        vat_number: optional_string_arg(input, "vatNumber")?,
        tax_id: optional_string_arg(input, "taxId")?,
        company_number: optional_string_arg(input, "companyNumber")?,
    };
    let result = resolve_seller_identity_display(&parsed);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `deriveTaxIdType`.
pub(crate) fn invoke_derive_tax_id_type(input: &FixtureInput) -> Result<Value, BindingError> {
    let country = require_string_arg(input, "country")?;
    let tax_type = derive_tax_id_type(&country)
        .ok_or_else(|| format!("unsupported country: {country}"))?;
    serde_json::to_value(tax_type).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `resolveTaxBehavior`.
pub(crate) fn invoke_resolve_tax_behavior(input: &FixtureInput) -> Result<Value, BindingError> {
    let behavior = require_string_arg(input, "behavior")?;
    let currency = require_string_arg(input, "currency")?;
    let resolved = resolve_tax_behavior(&behavior, &currency)
        .ok_or_else(|| format!("unsupported tax behavior: {behavior}"))?;
    Ok(Value::String(resolved.to_owned()))
}

/// Binding for `getTaxIdExample`.
pub(crate) fn invoke_get_tax_id_example(input: &FixtureInput) -> Result<Value, BindingError> {
    let country = require_string_arg(input, "country")?;
    let example = get_tax_id_example(&country)
        .ok_or_else(|| format!("unsupported country: {country}"))?;
    Ok(Value::String(example.to_owned()))
}

/// Binding for `getTaxIdFieldLabel`.
pub(crate) fn invoke_get_tax_id_field_label(input: &FixtureInput) -> Result<Value, BindingError> {
    let country = require_string_arg(input, "country")?;
    let label = get_tax_id_field_label(&country)
        .ok_or_else(|| format!("unsupported country: {country}"))?;
    Ok(Value::String(label.to_owned()))
}

/// Binding for `getTaxIdHelperText`.
pub(crate) fn invoke_get_tax_id_helper_text(input: &FixtureInput) -> Result<Value, BindingError> {
    let country = require_string_arg(input, "country")?;
    let text = get_tax_id_helper_text(&country)
        .ok_or_else(|| format!("unsupported country: {country}"))?;
    Ok(Value::String(text))
}

/// Binding for `minorUnitsPerMajor`.
pub(crate) fn invoke_minor_units_per_major(input: &FixtureInput) -> Result<Value, BindingError> {
    let currency = require_string_arg(input, "currency")?;
    Ok(Value::from(minor_units_per_major(&currency)))
}

/// Binding for `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`.
pub(crate) fn invoke_seller_tax_identifier_display_label_by_type(
    _input: &FixtureInput,
) -> Result<Value, BindingError> {
    let mut map = Map::new();
    for (key, label) in seller_tax_identifier_display_label_by_type() {
        map.insert((*key).to_owned(), Value::String((*label).to_owned()));
    }
    Ok(Value::Object(map))
}

/// Reads a required numeric argument from `input.args`.
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
