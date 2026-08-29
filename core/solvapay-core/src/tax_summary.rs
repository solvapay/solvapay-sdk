//! Buyer-facing tax-summary copy (DEV-723).
//!
//! Presentation-only — labels, row visibility, and treatment notes for checkout
//! summaries. A zero tax amount is formatted as money by the caller (`$0`),
//! never as `Free`. Included-vs-excluded is carried by the rows: the subtotal
//! reads `Subtotal (excl. VAT)` whenever a VAT row is shown.

/// Reverse-charge explanatory note shown under the VAT row.
pub const REVERSE_CHARGE_NOTE: &str =
    "VAT reverse charge applies — you are responsible for reporting VAT in your jurisdiction.";

/// Note when the seller is not collecting tax (`not_collecting` / `not_supported`).
pub const TAX_NOT_COLLECTED_NOTE: &str = "Tax is not collected on this purchase.";

/// Reverse-charge note constant.
///
/// # Returns
///
/// Owned [`REVERSE_CHARGE_NOTE`] copy.
#[crate::solvapay_export(
    id = "REVERSE_CHARGE_NOTE",
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 4
)]
pub fn reverse_charge_note() -> String {
    REVERSE_CHARGE_NOTE.to_owned()
}

/// Tax-not-collected note constant.
///
/// # Returns
///
/// Owned [`TAX_NOT_COLLECTED_NOTE`] copy.
#[crate::solvapay_export(
    id = "TAX_NOT_COLLECTED_NOTE",
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 5
)]
pub fn tax_not_collected_note() -> String {
    TAX_NOT_COLLECTED_NOTE.to_owned()
}

fn treatment_key(treatment: Option<&str>) -> Option<&str> {
    treatment.map(str::trim).filter(|value| !value.is_empty())
}

/// Whether a VAT amount row should render for `treatment`.
///
/// The row is shown whenever VAT was considered — including zero-rated and
/// reverse charge — and hidden only when no tax was assessed
/// (`not_collecting` / `not_supported`).
///
/// # Arguments
///
/// * `treatment` - Tax-breakdown treatment, or `None` when unknown
///
/// # Returns
///
/// `false` for `not_collecting` and `not_supported`; `true` otherwise
/// (including `None`).
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 0
)]
pub fn should_show_tax_row(treatment: Option<&str>) -> bool {
    !matches!(
        treatment_key(treatment),
        Some("not_collecting" | "not_supported")
    )
}

/// Subtotal row label: `Subtotal (excl. VAT)` whenever a VAT row shows.
///
/// # Arguments
///
/// * `treatment` - Tax-breakdown treatment, or `None` when unknown
///
/// # Returns
///
/// `"Subtotal (excl. VAT)"` when [`should_show_tax_row`] is true, otherwise
/// `"Subtotal"`.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 1
)]
pub fn format_subtotal_label(treatment: Option<&str>) -> String {
    if should_show_tax_row(treatment) {
        "Subtotal (excl. VAT)".to_owned()
    } else {
        "Subtotal".to_owned()
    }
}

/// VAT row label. Reverse charge is named; otherwise a bare rate, never
/// `incl.` / `excl.`.
///
/// `tax_rate` may be a fraction (`0.25`) or a whole percent (`25`). A rate of
/// `0` falls through to bare `"VAT"`.
///
/// # Arguments
///
/// * `treatment` - Tax-breakdown treatment
/// * `tax_rate` - Rate as a 0–1 fraction or a whole percent
///
/// # Returns
///
/// `"VAT (reverse charge)"`, `"VAT (N%)"`, or `"VAT"`.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 2
)]
pub fn format_vat_summary_label(treatment: Option<&str>, tax_rate: f64) -> String {
    if treatment_key(treatment) == Some("reverse_charge") {
        return "VAT (reverse charge)".to_owned();
    }

    if tax_rate > 0.0 {
        let rate_percent = if tax_rate <= 1.0 {
            (tax_rate * 100.0).round()
        } else {
            tax_rate
        };
        return format!("VAT ({rate_percent}%)");
    }

    "VAT".to_owned()
}

/// Explanatory note for a non-standard tax treatment, if any.
///
/// # Arguments
///
/// * `treatment` - Tax-breakdown treatment, or `None` when unknown
///
/// # Returns
///
/// Reverse-charge or not-collected copy, or `None` for `standard` / `none` /
/// missing treatments.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "tax-summary",
    emit_order = 3
)]
pub fn resolve_tax_treatment_note(treatment: Option<&str>) -> Option<String> {
    match treatment_key(treatment) {
        Some("reverse_charge") => Some(REVERSE_CHARGE_NOTE.to_owned()),
        Some("not_collecting" | "not_supported") => Some(TAX_NOT_COLLECTED_NOTE.to_owned()),
        _ => None,
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
    fn should_show_tax_row_is_true_for_standard_none_reverse_charge_and_missing() {
        for treatment in [None, Some("standard"), Some("none"), Some("reverse_charge")] {
            assert!(
                should_show_tax_row(treatment),
                "expected VAT row for {treatment:?}"
            );
        }
    }

    #[test]
    fn should_show_tax_row_is_false_for_not_collecting_and_not_supported() {
        assert!(!should_show_tax_row(Some("not_collecting")));
        assert!(!should_show_tax_row(Some("not_supported")));
    }

    #[test]
    fn format_subtotal_label_is_excl_vat_when_the_vat_row_shows() {
        assert_eq!(
            format_subtotal_label(Some("standard")),
            "Subtotal (excl. VAT)"
        );
        assert_eq!(format_subtotal_label(None), "Subtotal (excl. VAT)");
    }

    #[test]
    fn format_subtotal_label_is_bare_when_no_vat_row() {
        assert_eq!(format_subtotal_label(Some("not_collecting")), "Subtotal");
        assert_eq!(format_subtotal_label(Some("not_supported")), "Subtotal");
    }

    #[test]
    fn format_vat_summary_label_names_reverse_charge() {
        assert_eq!(
            format_vat_summary_label(Some("reverse_charge"), 0.25),
            "VAT (reverse charge)"
        );
    }

    #[test]
    fn format_vat_summary_label_accepts_fraction_and_whole_percent() {
        assert_eq!(
            format_vat_summary_label(Some("standard"), 0.25),
            "VAT (25%)"
        );
        assert_eq!(
            format_vat_summary_label(Some("standard"), 25.0),
            "VAT (25%)"
        );
    }

    #[test]
    fn format_vat_summary_label_is_bare_vat_when_rate_is_zero() {
        assert_eq!(format_vat_summary_label(Some("standard"), 0.0), "VAT");
        assert_eq!(format_vat_summary_label(Some("none"), 0.0), "VAT");
    }

    #[test]
    fn resolve_tax_treatment_note_matches_each_treatment() {
        assert_eq!(
            resolve_tax_treatment_note(Some("reverse_charge")).as_deref(),
            Some(REVERSE_CHARGE_NOTE)
        );
        assert_eq!(
            resolve_tax_treatment_note(Some("not_collecting")).as_deref(),
            Some(TAX_NOT_COLLECTED_NOTE)
        );
        assert_eq!(
            resolve_tax_treatment_note(Some("not_supported")).as_deref(),
            Some(TAX_NOT_COLLECTED_NOTE)
        );
        assert_eq!(resolve_tax_treatment_note(Some("standard")), None);
        assert_eq!(resolve_tax_treatment_note(Some("none")), None);
        assert_eq!(resolve_tax_treatment_note(None), None);
    }

    #[test]
    fn note_constants_match_exported_accessors() {
        assert_eq!(reverse_charge_note(), REVERSE_CHARGE_NOTE);
        assert_eq!(tax_not_collected_note(), TAX_NOT_COLLECTED_NOTE);
    }
}
