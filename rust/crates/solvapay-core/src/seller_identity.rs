//! Country-aware seller identity display resolver (Step 10).
//!
//! Presentation-only — maps stored identifiers to labeled rows for seller cards
//! and receipts.

use serde::Serialize;

use crate::business_details::{derive_tax_id_type, is_supported_business_country, TaxIdType};

/// Display labels keyed by tax-ID type (`eu_vat` / `gb_vat` / `us_ein`).
pub const SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: &[(&str, &str)] = &[
    ("eu_vat", "VAT number"),
    ("gb_vat", "VAT number"),
    ("us_ein", "EIN"),
];

/// Fallback label when country is missing or unsupported.
const DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL: &str = "Tax ID";
/// Fixed label for the company-number row.
const COMPANY_NUMBER_LABEL: &str = "Company number";

/// One labeled identity row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SellerIdentityRow {
    /// Human-readable field label (e.g. `"VAT number"`).
    pub label: String,
    /// Stored identifier value to display.
    pub value: String,
}

/// Resolved seller identity rows. Absent rows serialize as JSON `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerIdentityDisplay {
    /// Country-aware tax / VAT / EIN row, if a value is available.
    pub tax_identifier: Option<SellerIdentityRow>,
    /// Company-number row when distinct from the tax identifier.
    pub company_number: Option<SellerIdentityRow>,
}

/// Input for [`resolve_seller_identity_display`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SellerIdentityInput {
    /// Seller country code (trimmed / uppercased when supported).
    pub country: Option<String>,
    /// VAT number (preferred tax value for non-US supported countries).
    pub vat_number: Option<String>,
    /// Generic tax ID (US EIN / fallback when VAT is absent).
    pub tax_id: Option<String>,
    /// Company registration number; also used as US tax value when `tax_id` is empty.
    pub company_number: Option<String>,
}

/// Trim and drop empty / whitespace-only strings.
///
/// # Arguments
///
/// * `value` - Optional raw string from seller input
///
/// # Returns
///
/// Owned trimmed string, or `None` when absent / empty / whitespace-only.
fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Uppercase a country code when it is in the supported business-country set.
///
/// # Arguments
///
/// * `country` - Optional country code (any casing; trimmed first)
///
/// # Returns
///
/// Uppercased supported country code, or `None` when empty / unsupported.
fn to_supported_country(country: Option<&str>) -> Option<String> {
    let normalized = normalize_optional_string(country)?.to_ascii_uppercase();
    if is_supported_business_country(&normalized) {
        Some(normalized)
    } else {
        None
    }
}

/// Display label for a concrete [`TaxIdType`] (`VAT number` / `EIN`).
///
/// # Arguments
///
/// * `tax_type` - Stripe-aligned tax-ID discriminant
///
/// # Returns
///
/// Static label: `"VAT number"` for EU/GB VAT, `"EIN"` for US.
fn label_for_tax_id_type(tax_type: TaxIdType) -> &'static str {
    match tax_type {
        TaxIdType::EuVat => "VAT number",
        TaxIdType::GbVat => "VAT number",
        TaxIdType::UsEin => "EIN",
    }
}

/// Display labels keyed by tax-ID type (`eu_vat` / `gb_vat` / `us_ein`).
///
/// # Returns
///
/// Static slice of `(type_key, label)` pairs matching
/// [`SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`].
pub fn seller_tax_identifier_display_label_by_type() -> &'static [(&'static str, &'static str)] {
    SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE
}

/// Country-aware tax-identifier display label (VAT number / EIN / Tax ID).
///
/// # Arguments
///
/// * `country` - Optional seller country; used to derive [`TaxIdType`] when supported
///
/// # Returns
///
/// Owned label string — country-specific when supported, otherwise `"Tax ID"`.
pub fn get_seller_tax_identifier_display_label(country: Option<&str>) -> String {
    match to_supported_country(country).and_then(|c| derive_tax_id_type(&c)) {
        Some(tax_type) => label_for_tax_id_type(tax_type).to_owned(),
        None => DEFAULT_TAX_IDENTIFIER_DISPLAY_LABEL.to_owned(),
    }
}

/// Resolve labeled tax + company rows for seller display.
///
/// Prefers VAT for supported non-US countries and tax ID (or company number) for US.
/// The company-number row is omitted when it would duplicate the tax-identifier value.
///
/// # Arguments
///
/// * `input` - Raw seller identity fields (see [`SellerIdentityInput`])
///
/// # Returns
///
/// [`SellerIdentityDisplay`] with optional `tax_identifier` and `company_number` rows.
pub fn resolve_seller_identity_display(input: &SellerIdentityInput) -> SellerIdentityDisplay {
    let country = normalize_optional_string(input.country.as_deref());
    let supported_country = to_supported_country(country.as_deref());
    let vat_number = normalize_optional_string(input.vat_number.as_deref());
    let tax_id = normalize_optional_string(input.tax_id.as_deref());
    let company_number = normalize_optional_string(input.company_number.as_deref());

    let tax_value = match supported_country.as_deref() {
        Some("US") => tax_id.clone().or_else(|| company_number.clone()),
        Some(_) => vat_number.or_else(|| tax_id.clone()),
        None => tax_id.clone(),
    };

    let tax_identifier = tax_value.map(|value| SellerIdentityRow {
        label: get_seller_tax_identifier_display_label(country.as_deref()),
        value,
    });

    let company_value = company_number.or_else(|| tax_id.clone());
    let company_number_row = match company_value {
        Some(value) if tax_identifier.as_ref().is_none_or(|row| row.value != value) => {
            Some(SellerIdentityRow {
                label: COMPANY_NUMBER_LABEL.to_owned(),
                value,
            })
        }
        _ => None,
    };

    SellerIdentityDisplay {
        tax_identifier,
        company_number: company_number_row,
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;

    #[test]
    fn label_de_is_vat_number() {
        assert_eq!(
            get_seller_tax_identifier_display_label(Some("DE")),
            "VAT number"
        );
    }

    #[test]
    fn resolve_eu_prefers_vat() {
        let display = resolve_seller_identity_display(&SellerIdentityInput {
            country: Some("DE".into()),
            vat_number: Some("DE123456789".into()),
            tax_id: Some("DE999999999".into()),
            company_number: Some("HRB12345".into()),
        });
        assert_eq!(
            display.tax_identifier,
            Some(SellerIdentityRow {
                label: "VAT number".into(),
                value: "DE123456789".into(),
            })
        );
        assert_eq!(
            display.company_number,
            Some(SellerIdentityRow {
                label: "Company number".into(),
                value: "HRB12345".into(),
            })
        );
    }
}
