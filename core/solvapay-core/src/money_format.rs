//! Locale-independent money formatting for checkout and MCP copy.
//!
//! Replaces `Intl.NumberFormat` in the React layer: grouping is always
//! comma-separated, decimals use `.`, and symbol placement is fixed by the
//! currency table (prefix `$10` / suffix `100 kr`). Digit grouping and
//! `de-DE`-style `10,00 €` are intentionally not reproduced.

use crate::credit_display::{is_zero_decimal_currency, minor_units_per_major};

/// How the currency is shown next to the amount.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CurrencyDisplay {
    /// Local symbol (`$10`, `100 kr`).
    Symbol,
    /// ISO code with a non-breaking space (`USD 10`).
    Code,
}

/// Symbol table entry. `prefix` is ignored when `symbol` equals `code`.
struct CurrencySymbol {
    code: &'static str,
    symbol: &'static str,
    prefix: bool,
}

/// SolvaPay-supported ISO currencies (Stripe FX set) with display symbols.
const CURRENCY_SYMBOLS: &[CurrencySymbol] = &[
    CurrencySymbol {
        code: "USD",
        symbol: "$",
        prefix: true,
    },
    CurrencySymbol {
        code: "EUR",
        symbol: "€",
        prefix: true,
    },
    CurrencySymbol {
        code: "GBP",
        symbol: "£",
        prefix: true,
    },
    CurrencySymbol {
        code: "JPY",
        symbol: "¥",
        prefix: true,
    },
    CurrencySymbol {
        code: "CAD",
        symbol: "C$",
        prefix: true,
    },
    CurrencySymbol {
        code: "AUD",
        symbol: "A$",
        prefix: true,
    },
    CurrencySymbol {
        code: "CHF",
        symbol: "CHF",
        prefix: true,
    },
    CurrencySymbol {
        code: "CNY",
        symbol: "¥",
        prefix: true,
    },
    CurrencySymbol {
        code: "HKD",
        symbol: "HK$",
        prefix: true,
    },
    CurrencySymbol {
        code: "NZD",
        symbol: "NZ$",
        prefix: true,
    },
    CurrencySymbol {
        code: "SEK",
        symbol: "kr",
        prefix: false,
    },
    CurrencySymbol {
        code: "KRW",
        symbol: "₩",
        prefix: true,
    },
    CurrencySymbol {
        code: "SGD",
        symbol: "S$",
        prefix: true,
    },
    CurrencySymbol {
        code: "NOK",
        symbol: "kr",
        prefix: false,
    },
    CurrencySymbol {
        code: "MXN",
        symbol: "$",
        prefix: true,
    },
    CurrencySymbol {
        code: "INR",
        symbol: "₹",
        prefix: true,
    },
    CurrencySymbol {
        code: "RUB",
        symbol: "₽",
        prefix: true,
    },
    CurrencySymbol {
        code: "ZAR",
        symbol: "R",
        prefix: true,
    },
    CurrencySymbol {
        code: "TRY",
        symbol: "₺",
        prefix: true,
    },
    CurrencySymbol {
        code: "BRL",
        symbol: "R$",
        prefix: true,
    },
    CurrencySymbol {
        code: "DKK",
        symbol: "kr",
        prefix: false,
    },
    CurrencySymbol {
        code: "ISK",
        symbol: "kr",
        prefix: false,
    },
    CurrencySymbol {
        code: "PLN",
        symbol: "zł",
        prefix: false,
    },
    CurrencySymbol {
        code: "CZK",
        symbol: "Kč",
        prefix: false,
    },
    CurrencySymbol {
        code: "HUF",
        symbol: "Ft",
        prefix: false,
    },
    CurrencySymbol {
        code: "RON",
        symbol: "lei",
        prefix: false,
    },
    CurrencySymbol {
        code: "THB",
        symbol: "฿",
        prefix: true,
    },
    CurrencySymbol {
        code: "MYR",
        symbol: "RM",
        prefix: true,
    },
    CurrencySymbol {
        code: "PHP",
        symbol: "₱",
        prefix: true,
    },
    CurrencySymbol {
        code: "IDR",
        symbol: "Rp",
        prefix: true,
    },
    CurrencySymbol {
        code: "VND",
        symbol: "₫",
        prefix: true,
    },
    CurrencySymbol {
        code: "TWD",
        symbol: "NT$",
        prefix: true,
    },
    CurrencySymbol {
        code: "ILS",
        symbol: "₪",
        prefix: true,
    },
    CurrencySymbol {
        code: "AED",
        symbol: "د.إ",
        prefix: true,
    },
    CurrencySymbol {
        code: "SAR",
        symbol: "ر.س",
        prefix: true,
    },
    CurrencySymbol {
        code: "CLP",
        symbol: "$",
        prefix: true,
    },
    CurrencySymbol {
        code: "COP",
        symbol: "$",
        prefix: true,
    },
    CurrencySymbol {
        code: "ARS",
        symbol: "$",
        prefix: true,
    },
    CurrencySymbol {
        code: "PEN",
        symbol: "S/",
        prefix: true,
    },
    CurrencySymbol {
        code: "UYU",
        symbol: "$U",
        prefix: true,
    },
    CurrencySymbol {
        code: "EGP",
        symbol: "£",
        prefix: true,
    },
    CurrencySymbol {
        code: "NGN",
        symbol: "₦",
        prefix: true,
    },
    CurrencySymbol {
        code: "KES",
        symbol: "KSh",
        prefix: true,
    },
    CurrencySymbol {
        code: "UGX",
        symbol: "USh",
        prefix: false,
    },
    CurrencySymbol {
        code: "RWF",
        symbol: "RF",
        prefix: false,
    },
    CurrencySymbol {
        code: "BIF",
        symbol: "FBu",
        prefix: false,
    },
    CurrencySymbol {
        code: "DJF",
        symbol: "Fdj",
        prefix: false,
    },
    CurrencySymbol {
        code: "GNF",
        symbol: "FG",
        prefix: false,
    },
    CurrencySymbol {
        code: "KMF",
        symbol: "CF",
        prefix: false,
    },
    CurrencySymbol {
        code: "MGA",
        symbol: "Ar",
        prefix: false,
    },
    CurrencySymbol {
        code: "PYG",
        symbol: "₲",
        prefix: true,
    },
    CurrencySymbol {
        code: "XOF",
        symbol: "CFA",
        prefix: false,
    },
    CurrencySymbol {
        code: "XAF",
        symbol: "FCFA",
        prefix: false,
    },
    CurrencySymbol {
        code: "XPF",
        symbol: "₣",
        prefix: true,
    },
    CurrencySymbol {
        code: "VUV",
        symbol: "Vt",
        prefix: false,
    },
];

fn lookup_symbol(code: &str) -> Option<&'static CurrencySymbol> {
    CURRENCY_SYMBOLS
        .iter()
        .find(|entry| entry.code.eq_ignore_ascii_case(code))
}

/// Group the integer part of `major` with comma thousands separators.
///
/// # Arguments
///
/// * `major` - Major-unit amount (may be negative)
/// * `fraction` - Decimal places to emit (`0` omits the point)
///
/// # Returns
///
/// Signed grouped number such as `"1,000"` or `"19.99"`.
pub fn format_grouped_major(major: f64, fraction: usize) -> String {
    let int_part = major.trunc() as i64;
    let digits: Vec<char> = int_part.abs().to_string().chars().collect();
    let mut grouped = String::new();
    for (i, ch) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(*ch);
    }
    let sign = if major.is_sign_negative() { "-" } else { "" };
    if fraction == 0 {
        format!("{sign}{grouped}")
    } else {
        let scale = 10_i64.pow(u32::try_from(fraction).unwrap_or(0));
        let frac = ((major.abs() * scale as f64).round() as i64) % scale;
        format!("{sign}{grouped}.{frac:0width$}", width = fraction)
    }
}

/// Narration-stable formatter: `$`/`€`/`£`/`¥` prefix, otherwise `CODE amount`.
///
/// Preserves byte-parity with the previous `narrate.rs` / transport helpers.
/// Prefer [`format_price`] for buyer-facing checkout.
///
/// # Arguments
///
/// * `major` - Major-unit amount
/// * `currency` - ISO currency code
/// * `fraction` - Decimal places
///
/// # Returns
///
/// Formatted money string.
pub fn format_major_fixed(major: f64, currency: &str, fraction: usize) -> String {
    let formatted = format_grouped_major(major, fraction);
    match currency.to_ascii_uppercase().as_str() {
        "USD" => format!("${formatted}"),
        "EUR" => format!("€{formatted}"),
        "GBP" => format!("£{formatted}"),
        "JPY" => format!("¥{formatted}"),
        other => format!("{other}\u{00a0}{formatted}"),
    }
}

/// Convert a minor-unit amount to its major-unit equivalent.
///
/// # Arguments
///
/// * `amount_minor` - Minor-unit amount
/// * `currency` - ISO currency code
///
/// # Returns
///
/// `amount_minor` unchanged for zero-decimal currencies; otherwise
/// `amount_minor / 100`.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "money-format",
    emit_order = 1
)]
pub fn to_major_units(amount_minor: f64, currency: &str) -> f64 {
    if is_zero_decimal_currency(currency) {
        amount_minor
    } else {
        amount_minor / 100.0
    }
}

fn resolve_display(currency_display: Option<&str>) -> CurrencyDisplay {
    match currency_display.map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("code") => CurrencyDisplay::Code,
        _ => CurrencyDisplay::Symbol,
    }
}

fn apply_symbol(formatted: &str, currency: &str, display: CurrencyDisplay) -> String {
    let code = currency.to_ascii_uppercase();
    if display == CurrencyDisplay::Code {
        return format!("{code}\u{00a0}{formatted}");
    }
    match lookup_symbol(&code) {
        Some(entry) if entry.symbol == entry.code => {
            format!("{code}\u{00a0}{formatted}")
        }
        Some(entry) if entry.prefix => format!("{}{formatted}", entry.symbol),
        Some(entry) => format!("{formatted}\u{00a0}{}", entry.symbol),
        None => format!("{code}\u{00a0}{formatted}"),
    }
}

/// Format a minor-unit amount as buyer-facing money, optionally with an
/// interval suffix.
///
/// Whole amounts drop trailing zeros (`$10`, not `$10.00`). A zero amount
/// renders as `"Free"` unless `free` is `""`.
///
/// # Arguments
///
/// * `amount_minor` - Amount in minor units
/// * `currency` - ISO currency code (any casing)
/// * `interval` - Recurring interval unit (`month`, `year`)
/// * `interval_count` - How many of `interval` per cycle; `None` means `1`
/// * `free` - Copy used when the amount is 0; `None` defaults to `"Free"`;
///   `Some("")` disables the zero-check
/// * `currency_display` - `"symbol"` (default) or `"code"`
///
/// # Returns
///
/// Formatted price string.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "coreHelper",
    section = "money-format",
    emit_order = 0
)]
pub fn format_price(
    amount_minor: f64,
    currency: &str,
    interval: Option<&str>,
    interval_count: Option<f64>,
    free: Option<&str>,
    currency_display: Option<&str>,
) -> String {
    let free = free.unwrap_or("Free");
    if amount_minor == 0.0 && !free.is_empty() {
        return free.to_owned();
    }

    let natural = if is_zero_decimal_currency(currency) {
        0
    } else {
        2
    };
    let minor_per_major = f64::from(minor_units_per_major(currency));
    let is_whole = if minor_per_major == 0.0 {
        false
    } else {
        (amount_minor % minor_per_major).abs() < f64::EPSILON
    };
    let fraction = if is_whole { 0 } else { natural };
    let major = to_major_units(amount_minor, currency);
    let display = resolve_display(currency_display);
    let formatted = apply_symbol(&format_grouped_major(major, fraction), currency, display);

    let Some(interval) = interval.map(str::trim).filter(|value| !value.is_empty()) else {
        return formatted;
    };
    let count = interval_count.unwrap_or(1.0);
    let suffix = if count > 1.0 {
        format!("{count} {interval}s")
    } else {
        interval.to_owned()
    };
    format!("{formatted} / {suffix}")
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

    fn price(amount_minor: f64, currency: &str) -> String {
        format_price(amount_minor, currency, None, None, None, None)
    }

    #[test]
    fn formats_usd_fractional_minor_units() {
        assert_eq!(price(1999.0, "usd"), "$19.99");
    }

    #[test]
    fn formats_gbp_whole_amount_without_trailing_zeros() {
        assert_eq!(price(500.0, "gbp"), "£5");
    }

    #[test]
    fn sek_symbol_is_suffix_kr_not_icu_locale() {
        // Intl en used `SEK 100`; without ICU we emit the table symbol.
        assert_eq!(price(10000.0, "sek"), "100\u{00a0}kr");
        assert_eq!(price(10050.0, "sek"), "100.50\u{00a0}kr");
        assert_eq!(price(19900.0, "sek"), "199\u{00a0}kr");
    }

    #[test]
    fn handles_case_insensitive_currency_codes() {
        assert_eq!(price(1000.0, "USD"), "$10");
        assert_eq!(price(1000.0, "Usd"), "$10");
    }

    #[test]
    fn currency_display_code_uses_nbsp() {
        assert_eq!(
            format_price(1000.0, "usd", None, None, None, Some("code")),
            "USD\u{00a0}10"
        );
        assert_eq!(
            format_price(5000.0, "gbp", None, None, None, Some("code")),
            "GBP\u{00a0}50"
        );
    }

    #[test]
    fn jpy_is_zero_decimal_with_grouping() {
        assert_eq!(price(1000.0, "jpy"), "¥1,000");
    }

    #[test]
    fn zero_amount_defaults_to_free() {
        assert_eq!(price(0.0, "usd"), "Free");
    }

    #[test]
    fn zero_amount_uses_provided_free_copy() {
        assert_eq!(
            format_price(0.0, "usd", None, None, Some("no charge"), None),
            "no charge"
        );
        assert_eq!(
            format_price(0.0, "usd", None, None, Some("Gratis"), None),
            "Gratis"
        );
    }

    #[test]
    fn empty_free_disables_zero_check() {
        assert_eq!(format_price(0.0, "usd", None, None, Some(""), None), "$0");
    }

    #[test]
    fn interval_suffixes() {
        assert_eq!(
            format_price(999.0, "usd", Some("month"), None, None, None),
            "$9.99 / month"
        );
        assert_eq!(
            format_price(2500.0, "usd", Some("month"), Some(3.0), None, None),
            "$25 / 3 months"
        );
        assert_eq!(
            format_price(9900.0, "usd", Some("year"), None, None, None),
            "$99 / year"
        );
    }

    #[test]
    fn interval_is_omitted_when_amount_is_free() {
        assert_eq!(
            format_price(0.0, "usd", Some("month"), None, None, None),
            "Free"
        );
    }

    #[test]
    fn to_major_units_divides_two_decimal_and_passes_zero_decimal() {
        assert_eq!(to_major_units(1999.0, "usd"), 19.99);
        assert_eq!(to_major_units(500.0, "gbp"), 5.0);
        assert_eq!(to_major_units(1000.0, "jpy"), 1000.0);
        assert_eq!(to_major_units(50000.0, "krw"), 50000.0);
        assert_eq!(to_major_units(1000.0, "JPY"), 1000.0);
        assert_eq!(to_major_units(1000.0, "Usd"), 10.0);
    }

    #[test]
    fn format_major_fixed_keeps_narration_prefix_table() {
        assert_eq!(format_major_fixed(10.0, "usd", 2), "$10.00");
        assert_eq!(format_major_fixed(10.0, "eur", 2), "€10.00");
        assert_eq!(format_major_fixed(10.0, "gbp", 2), "£10.00");
        assert_eq!(format_major_fixed(1000.0, "jpy", 0), "¥1,000");
        assert_eq!(format_major_fixed(10.0, "sek", 2), "SEK\u{00a0}10.00");
    }

    #[test]
    fn de_de_buyers_see_prefix_euro_not_icu_suffix() {
        assert_eq!(price(1000.0, "eur"), "€10");
        assert_eq!(
            format_price(1000.0, "eur", None, None, Some(""), None),
            "€10"
        );
    }
}
