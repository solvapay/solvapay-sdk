//! Credit → fiat display conversion (Step 10).
//!
//! Backend contract: `credits = USD_cents × creditsPerMinorUnit`, and
//! `displayExchangeRate` is USD → display currency.

/// Zero-decimal ISO currency codes (case-insensitive match via lowercase).
const ZERO_DECIMAL: &[&str] = &[
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv",
    "xaf", "xof", "xpf",
];

/// Input for [`credits_to_display_minor_units`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreditsToDisplayInput {
    /// Credit balance to convert.
    pub credits: f64,
    /// Credits per USD cent (`creditsPerMinorUnit` in the backend contract).
    pub credits_per_minor_unit: f64,
    /// USD → display-currency rate; `0.0` is treated as `1.0` (JS `||` parity).
    pub display_exchange_rate: f64,
    /// ISO display currency code (case-insensitive for zero-decimal lookup).
    pub display_currency: String,
}

/// Whether `currency` is a zero-decimal ISO code (case-insensitive).
///
/// # Arguments
///
/// * `currency` - ISO currency code; compared ignore-ascii-case to the zero-decimal list
///
/// # Returns
///
/// `true` when `currency` is in the zero-decimal set (e.g. `"JPY"`), otherwise `false`.
pub fn is_zero_decimal_currency(currency: &str) -> bool {
    ZERO_DECIMAL
        .iter()
        .any(|code| currency.eq_ignore_ascii_case(code))
}

/// Minor units per major unit for `currency` (1 for zero-decimal, else 100).
///
/// # Arguments
///
/// * `currency` - ISO currency code passed to [`is_zero_decimal_currency`]
///
/// # Returns
///
/// `1` for zero-decimal currencies, otherwise `100`.
pub fn minor_units_per_major(currency: &str) -> u32 {
    if is_zero_decimal_currency(currency) {
        1
    } else {
        100
    }
}

/// Fiat value of a credit balance, in minor units of `display_currency`.
///
/// A `display_exchange_rate` of `0.0` is treated as `1.0` (parity with JS `||`).
///
/// # Arguments
///
/// * `input` - Credits, rate factors, and display currency (see [`CreditsToDisplayInput`])
///
/// # Returns
///
/// Rounded minor-unit amount, or `None` when `credits_per_minor_unit <= 0`.
pub fn credits_to_display_minor_units(input: &CreditsToDisplayInput) -> Option<i64> {
    if input.credits_per_minor_unit <= 0.0 {
        return None;
    }
    let rate = if input.display_exchange_rate == 0.0 {
        1.0
    } else {
        input.display_exchange_rate
    };
    let usd_major = input.credits / input.credits_per_minor_unit / 100.0;
    let minor = usd_major * rate * f64::from(minor_units_per_major(&input.display_currency));
    Some(minor.round() as i64)
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
    fn minor_units_usd_is_100() {
        assert_eq!(minor_units_per_major("USD"), 100);
    }

    #[test]
    fn convert_sek_159600() {
        let minor = credits_to_display_minor_units(&CreditsToDisplayInput {
            credits: 159_600.0,
            credits_per_minor_unit: 100.0,
            display_exchange_rate: 9.46,
            display_currency: "SEK".into(),
        });
        assert_eq!(minor, Some(15_098));
    }
}
