//! Business-details validation, tax-ID helpers, and tax-behavior resolution.
//!
//! Parity target: `packages/core/src/business-details.ts`. No `regex` crate —
//! per-country tax-ID patterns are hand-rolled matchers (step 9).

use serde::{Deserialize, Serialize};

/// Tax ID type discriminants (Stripe-aligned).
pub const TAX_ID_TYPES: [&str; 3] = ["eu_vat", "gb_vat", "us_ein"];

/// Stripe tax-ID type for a supported business country (parity with `TaxIdType` in TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaxIdType {
    /// EU VAT ID (`eu_vat`).
    EuVat,
    /// UK VAT number (`gb_vat`).
    GbVat,
    /// US employer identification number (`us_ein`).
    UsEin,
}

/// Static metadata and validator for one supported business country.
#[derive(Debug, Clone, Copy)]
struct CountryEntry {
    /// ISO 3166-1 alpha-2 code (uppercase).
    code: &'static str,
    /// English display name for country select options.
    display_name: &'static str,
    /// Stripe tax-ID type assigned to this country.
    tax_id_type: TaxIdType,
    /// Example tax ID for helper text (must pass [`CountryEntry::matcher`]).
    example: &'static str,
    /// Hand-rolled pattern check (parity with `TAX_ID_REGEX_BY_COUNTRY` in TS).
    matcher: fn(&str) -> bool,
}

/// Catalog of supported business countries, matchers, and tax-ID metadata.
const COUNTRIES: &[CountryEntry] = &[
    CountryEntry {
        code: "AT",
        display_name: "Austria",
        tax_id_type: TaxIdType::EuVat,
        example: "ATU12345678",
        matcher: match_at,
    },
    CountryEntry {
        code: "BE",
        display_name: "Belgium",
        tax_id_type: TaxIdType::EuVat,
        example: "BE0123456789",
        matcher: match_be,
    },
    CountryEntry {
        code: "BG",
        display_name: "Bulgaria",
        tax_id_type: TaxIdType::EuVat,
        example: "BG0123456789",
        matcher: match_bg,
    },
    CountryEntry {
        code: "HR",
        display_name: "Croatia",
        tax_id_type: TaxIdType::EuVat,
        example: "HR12345678912",
        matcher: match_hr,
    },
    CountryEntry {
        code: "CY",
        display_name: "Cyprus",
        tax_id_type: TaxIdType::EuVat,
        example: "CY12345678Z",
        matcher: match_cy,
    },
    CountryEntry {
        code: "CZ",
        display_name: "Czechia",
        tax_id_type: TaxIdType::EuVat,
        example: "CZ1234567890",
        matcher: match_cz,
    },
    CountryEntry {
        code: "DK",
        display_name: "Denmark",
        tax_id_type: TaxIdType::EuVat,
        example: "DK12345678",
        matcher: match_dk,
    },
    CountryEntry {
        code: "EE",
        display_name: "Estonia",
        tax_id_type: TaxIdType::EuVat,
        example: "EE123456789",
        matcher: match_ee,
    },
    CountryEntry {
        code: "FI",
        display_name: "Finland",
        tax_id_type: TaxIdType::EuVat,
        example: "FI12345678",
        matcher: match_fi,
    },
    CountryEntry {
        code: "FR",
        display_name: "France",
        tax_id_type: TaxIdType::EuVat,
        example: "FRAB123456789",
        matcher: match_fr,
    },
    CountryEntry {
        code: "DE",
        display_name: "Germany",
        tax_id_type: TaxIdType::EuVat,
        example: "DE123456789",
        matcher: match_de,
    },
    CountryEntry {
        code: "GR",
        display_name: "Greece",
        tax_id_type: TaxIdType::EuVat,
        example: "EL123456789",
        matcher: match_gr,
    },
    CountryEntry {
        code: "HU",
        display_name: "Hungary",
        tax_id_type: TaxIdType::EuVat,
        example: "HU12345678",
        matcher: match_hu,
    },
    CountryEntry {
        code: "IE",
        display_name: "Ireland",
        tax_id_type: TaxIdType::EuVat,
        example: "IE1234567AB",
        matcher: match_ie,
    },
    CountryEntry {
        code: "IT",
        display_name: "Italy",
        tax_id_type: TaxIdType::EuVat,
        example: "IT12345678912",
        matcher: match_it,
    },
    CountryEntry {
        code: "LV",
        display_name: "Latvia",
        tax_id_type: TaxIdType::EuVat,
        example: "LV12345678912",
        matcher: match_lv,
    },
    CountryEntry {
        code: "LT",
        display_name: "Lithuania",
        tax_id_type: TaxIdType::EuVat,
        example: "LT123456789",
        matcher: match_lt,
    },
    CountryEntry {
        code: "LU",
        display_name: "Luxembourg",
        tax_id_type: TaxIdType::EuVat,
        example: "LU12345678",
        matcher: match_lu,
    },
    CountryEntry {
        code: "MT",
        display_name: "Malta",
        tax_id_type: TaxIdType::EuVat,
        example: "MT12345678",
        matcher: match_mt,
    },
    CountryEntry {
        code: "NL",
        display_name: "Netherlands",
        tax_id_type: TaxIdType::EuVat,
        example: "NL123456789B12",
        matcher: match_nl,
    },
    CountryEntry {
        code: "PL",
        display_name: "Poland",
        tax_id_type: TaxIdType::EuVat,
        example: "PL1234567890",
        matcher: match_pl,
    },
    CountryEntry {
        code: "PT",
        display_name: "Portugal",
        tax_id_type: TaxIdType::EuVat,
        example: "PT123456789",
        matcher: match_pt,
    },
    CountryEntry {
        code: "RO",
        display_name: "Romania",
        tax_id_type: TaxIdType::EuVat,
        example: "RO1234567891",
        matcher: match_ro,
    },
    CountryEntry {
        code: "SK",
        display_name: "Slovakia",
        tax_id_type: TaxIdType::EuVat,
        example: "SK1234567891",
        matcher: match_sk,
    },
    CountryEntry {
        code: "SI",
        display_name: "Slovenia",
        tax_id_type: TaxIdType::EuVat,
        example: "SI12345678",
        matcher: match_si,
    },
    CountryEntry {
        code: "ES",
        display_name: "Spain",
        tax_id_type: TaxIdType::EuVat,
        example: "ESA1234567Z",
        matcher: match_es,
    },
    CountryEntry {
        code: "SE",
        display_name: "Sweden",
        tax_id_type: TaxIdType::EuVat,
        example: "SE123456789123",
        matcher: match_se,
    },
    CountryEntry {
        code: "GB",
        display_name: "United Kingdom",
        tax_id_type: TaxIdType::GbVat,
        example: "GB123456789",
        matcher: match_gb,
    },
    CountryEntry {
        code: "US",
        display_name: "United States of America",
        tax_id_type: TaxIdType::UsEin,
        example: "12-3456789",
        matcher: match_us,
    },
];

/// Look up country metadata by exact uppercase ISO code.
///
/// # Arguments
///
/// * `code` - ISO 3166-1 alpha-2 country code (exact match, uppercase).
///
/// # Returns
///
/// [`Some`] reference to the static [`CountryEntry`] when `code` is in [`COUNTRIES`];
/// [`None`] otherwise.
fn find_country(code: &str) -> Option<&'static CountryEntry> {
    COUNTRIES.iter().find(|c| c.code == code)
}

/// Whether `code` matches a supported business country (exact uppercase ISO code).
///
/// # Arguments
///
/// * `code` - ISO 3166-1 alpha-2 country code to test.
///
/// # Returns
///
/// `true` when `code` is present in [`COUNTRIES`]; `false` otherwise.
fn is_supported_country(code: &str) -> bool {
    find_country(code).is_some()
}

/// Whether `code` is a supported business country (exact uppercase match).
///
/// # Arguments
///
/// * `code` - ISO 3166-1 alpha-2 country code to test.
///
/// # Returns
///
/// `true` when `code` is in the supported business-country catalog; `false` otherwise.
pub fn is_supported_business_country(code: &str) -> bool {
    is_supported_country(code)
}

// --- hand-rolled tax-ID matchers (parity with TAX_ID_REGEX_BY_COUNTRY) ---

/// Returns whether `b` is an ASCII decimal digit (`0`–`9`).
///
/// # Arguments
///
/// * `b` - Byte to test.
///
/// # Returns
///
/// `true` when `b` is in `b'0'..=b'9'`; `false` otherwise.
fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

/// Returns whether `b` is an ASCII uppercase letter (`A`–`Z`).
///
/// # Arguments
///
/// * `b` - Byte to test.
///
/// # Returns
///
/// `true` when `b` is in `b'A'..=b'Z'`; `false` otherwise.
fn is_upper_az(b: u8) -> bool {
    b.is_ascii_uppercase()
}

/// Returns whether `s` begins with the byte sequence `prefix`.
///
/// # Arguments
///
/// * `s` - String tested for the prefix.
/// * `prefix` - Byte sequence that must appear at the start of `s`.
///
/// # Returns
///
/// `true` when `s.as_bytes()` starts with `prefix.as_bytes()`; `false` otherwise.
fn starts_with_prefix(s: &str, prefix: &str) -> bool {
    s.as_bytes().starts_with(prefix.as_bytes())
}

/// Returns whether `bytes` is non-empty and every byte is a digit.
///
/// # Arguments
///
/// * `bytes` - Byte slice where every element must be an ASCII decimal digit.
///
/// # Returns
///
/// `true` when `bytes` has at least one element and all bytes are `0`–`9`;
/// `false` if empty or any byte is non-digit.
fn all_digits(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.iter().copied().all(is_digit)
}

/// Returns whether `n` is within the inclusive range `[lo, hi]`.
///
/// # Arguments
///
/// * `n` - Count to check.
/// * `lo` - Lower bound (inclusive).
/// * `hi` - Upper bound (inclusive).
///
/// # Returns
///
/// `true` when `lo <= n <= hi`; `false` otherwise.
fn digit_count_in(n: usize, lo: usize, hi: usize) -> bool {
    n >= lo && n <= hi
}

/// Austria tax-ID matcher: `ATU` + 8 digits (`/^ATU\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `ATU` followed by exactly 8 digits; `false` otherwise.
fn match_at(s: &str) -> bool {
    // /^ATU\d{8}$/
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "ATU") && all_digits(&b[3..])
}

/// Belgium tax-ID matcher: `BE` + `0` or `1` + 9 digits (`/^BE[01]\d{9}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `BE`, then `0` or `1`, then exactly 9 digits; `false` otherwise.
fn match_be(s: &str) -> bool {
    // /^BE[01]\d{9}$/
    let b = s.as_bytes();
    b.len() == 12
        && starts_with_prefix(s, "BE")
        && (b[2] == b'0' || b[2] == b'1')
        && all_digits(&b[3..])
}

/// Bulgaria tax-ID matcher: `BG` + 9–10 digits (`/^BG\d{9,10}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `BG` followed by 9 or 10 digits; `false` otherwise.
fn match_bg(s: &str) -> bool {
    // /^BG\d{9,10}$/
    let b = s.as_bytes();
    starts_with_prefix(s, "BG") && digit_count_in(b.len() - 2, 9, 10) && all_digits(&b[2..])
}

/// Croatia tax-ID matcher: `HR` + 11 digits (`/^HR\d{11}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `HR` followed by exactly 11 digits; `false` otherwise.
fn match_hr(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 13 && starts_with_prefix(s, "HR") && all_digits(&b[2..])
}

/// Cyprus tax-ID matcher: `CY` + 8 digits + one uppercase letter (`/^CY\d{8}[A-Z]$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `CY`, 8 digits, then one `A`–`Z` letter; `false` otherwise.
fn match_cy(s: &str) -> bool {
    // /^CY\d{8}[A-Z]$/
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "CY") && all_digits(&b[2..10]) && is_upper_az(b[10])
}

/// Czechia tax-ID matcher: `CZ` + 8–10 digits (`/^CZ\d{8,10}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `CZ` followed by 8, 9, or 10 digits; `false` otherwise.
fn match_cz(s: &str) -> bool {
    let b = s.as_bytes();
    starts_with_prefix(s, "CZ") && digit_count_in(b.len() - 2, 8, 10) && all_digits(&b[2..])
}

/// Denmark tax-ID matcher: `DK` + 8 digits (`/^DK\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `DK` followed by exactly 8 digits; `false` otherwise.
fn match_dk(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "DK") && all_digits(&b[2..])
}

/// Estonia tax-ID matcher: `EE` + 9 digits (`/^EE\d{9}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `EE` followed by exactly 9 digits; `false` otherwise.
fn match_ee(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "EE") && all_digits(&b[2..])
}

/// Finland tax-ID matcher: `FI` + 8 digits (`/^FI\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `FI` followed by exactly 8 digits; `false` otherwise.
fn match_fi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "FI") && all_digits(&b[2..])
}

/// France VAT key character: digit or uppercase A–Z excluding `I` and `O` (`[A-HJ-NP-Z0-9]`).
///
/// # Arguments
///
/// * `b` - Single byte to test as a France VAT key character.
///
/// # Returns
///
/// `true` when `b` is a digit or uppercase `A`–`Z` except `I` and `O`; `false` otherwise.
fn match_fr_key_char(b: u8) -> bool {
    // [A-HJ-NP-Z0-9] — excludes I and O
    is_digit(b) || (is_upper_az(b) && b != b'I' && b != b'O')
}

/// France tax-ID matcher: `FR` + two key chars + 9 digits (`/^FR[A-HJ-NP-Z0-9]{2}\d{9}$/`).
///
/// Key characters are digits or uppercase `A`–`Z` excluding `I` and `O`.
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `FR`, two valid key chars, then exactly 9 digits; `false` otherwise.
fn match_fr(s: &str) -> bool {
    // /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/
    let b = s.as_bytes();
    b.len() == 13
        && starts_with_prefix(s, "FR")
        && match_fr_key_char(b[2])
        && match_fr_key_char(b[3])
        && all_digits(&b[4..])
}

/// Germany tax-ID matcher: `DE` + 9 digits (`/^DE\d{9}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `DE` followed by exactly 9 digits; `false` otherwise.
fn match_de(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "DE") && all_digits(&b[2..])
}

/// Greece tax-ID matcher: `EL` + 9 digits (`/^EL\d{9}$/`).
///
/// Greece uses the `EL` prefix, not `GR`.
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `EL` followed by exactly 9 digits; `false` otherwise.
fn match_gr(s: &str) -> bool {
    // Greece uses EL prefix
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "EL") && all_digits(&b[2..])
}

/// Hungary tax-ID matcher: `HU` + 8 digits (`/^HU\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `HU` followed by exactly 8 digits; `false` otherwise.
fn match_hu(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "HU") && all_digits(&b[2..])
}

/// Ireland tax-ID matcher: `IE` + 7 digits + `A`–`W` + optional `A`–`I` (`/^IE\d{7}[A-W][A-I]?$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `IE`, 7 digits, one letter `A`–`W`, and optionally a second letter `A`–`I`;
/// `false` otherwise.
fn match_ie(s: &str) -> bool {
    // /^IE\d{7}[A-W][A-I]?$/
    let b = s.as_bytes();
    if b.len() < 10 || !starts_with_prefix(s, "IE") {
        return false;
    }
    if !all_digits(&b[2..9]) {
        return false;
    }
    if !(b'A'..=b'W').contains(&b[9]) {
        return false;
    }
    match b.len() {
        10 => true,
        11 => matches!(b[10], b'A'..=b'I'),
        _ => false,
    }
}

/// Italy tax-ID matcher: `IT` + 11 digits (`/^IT\d{11}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `IT` followed by exactly 11 digits; `false` otherwise.
fn match_it(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 13 && starts_with_prefix(s, "IT") && all_digits(&b[2..])
}

/// Latvia tax-ID matcher: `LV` + 11 digits (`/^LV\d{11}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `LV` followed by exactly 11 digits; `false` otherwise.
fn match_lv(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 13 && starts_with_prefix(s, "LV") && all_digits(&b[2..])
}

/// Lithuania tax-ID matcher: `LT` + 9 or 12 digits (`/^LT(\d{9}|\d{12})$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `LT` followed by exactly 9 or 12 digits; `false` otherwise.
fn match_lt(s: &str) -> bool {
    // /^LT(\d{9}|\d{12})$/
    let b = s.as_bytes();
    if !starts_with_prefix(s, "LT") {
        return false;
    }
    let digits = &b[2..];
    (digits.len() == 9 || digits.len() == 12) && all_digits(digits)
}

/// Luxembourg tax-ID matcher: `LU` + 8 digits (`/^LU\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `LU` followed by exactly 8 digits; `false` otherwise.
fn match_lu(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "LU") && all_digits(&b[2..])
}

/// Malta tax-ID matcher: `MT` + 8 digits (`/^MT\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `MT` followed by exactly 8 digits; `false` otherwise.
fn match_mt(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "MT") && all_digits(&b[2..])
}

/// Netherlands tax-ID matcher: `NL` + 9 digits + `B` + 2 digits (`/^NL\d{9}B\d{2}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `NL`, 9 digits, literal `B`, then 2 digits; `false` otherwise.
fn match_nl(s: &str) -> bool {
    // /^NL\d{9}B\d{2}$/
    let b = s.as_bytes();
    b.len() == 14
        && starts_with_prefix(s, "NL")
        && all_digits(&b[2..11])
        && b[11] == b'B'
        && all_digits(&b[12..])
}

/// Poland tax-ID matcher: `PL` + 10 digits (`/^PL\d{10}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `PL` followed by exactly 10 digits; `false` otherwise.
fn match_pl(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 12 && starts_with_prefix(s, "PL") && all_digits(&b[2..])
}

/// Portugal tax-ID matcher: `PT` + 9 digits (`/^PT\d{9}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `PT` followed by exactly 9 digits; `false` otherwise.
fn match_pt(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 11 && starts_with_prefix(s, "PT") && all_digits(&b[2..])
}

/// Romania tax-ID matcher: `RO` + 2–10 digits (`/^RO\d{2,10}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `RO` followed by 2 to 10 digits; `false` otherwise.
fn match_ro(s: &str) -> bool {
    // /^RO\d{2,10}$/
    let b = s.as_bytes();
    starts_with_prefix(s, "RO") && digit_count_in(b.len() - 2, 2, 10) && all_digits(&b[2..])
}

/// Slovakia tax-ID matcher: `SK` + 10 digits (`/^SK\d{10}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `SK` followed by exactly 10 digits; `false` otherwise.
fn match_sk(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 12 && starts_with_prefix(s, "SK") && all_digits(&b[2..])
}

/// Slovenia tax-ID matcher: `SI` + 8 digits (`/^SI\d{8}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `SI` followed by exactly 8 digits; `false` otherwise.
fn match_si(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && starts_with_prefix(s, "SI") && all_digits(&b[2..])
}

/// Spain tax-ID matcher: `ES` + alphanumeric + 7 digits + alphanumeric (`/^ES[A-Z0-9]\d{7}[A-Z0-9]$/`).
///
/// The first and last characters after `ES` may be a digit or uppercase letter.
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `ES`, one alphanumeric key char, 7 digits, then one alphanumeric key char;
/// `false` otherwise.
fn match_es(s: &str) -> bool {
    // /^ES[A-Z0-9]\d{7}[A-Z0-9]$/
    let b = s.as_bytes();
    b.len() == 11
        && starts_with_prefix(s, "ES")
        && (is_digit(b[2]) || is_upper_az(b[2]))
        && all_digits(&b[3..10])
        && (is_digit(b[10]) || is_upper_az(b[10]))
}

/// Sweden tax-ID matcher: `SE` + 12 digits (`/^SE\d{12}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `SE` followed by exactly 12 digits; `false` otherwise.
fn match_se(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 14 && starts_with_prefix(s, "SE") && all_digits(&b[2..])
}

/// United Kingdom tax-ID matcher: `GB` + 9 or 12 digits, or `GBGD`/`GBHA` + 3 digits (`/^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is `GB` followed by 9 digits, 12 digits, `GD` + 3 digits, or `HA` + 3 digits;
/// `false` otherwise.
fn match_gb(s: &str) -> bool {
    // /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/
    let b = s.as_bytes();
    if !starts_with_prefix(s, "GB") {
        return false;
    }
    let rest = &b[2..];
    if rest.len() == 9 && all_digits(rest) {
        return true;
    }
    if rest.len() == 12 && all_digits(rest) {
        return true;
    }
    if rest.len() == 5 && rest.starts_with(b"GD") && all_digits(&rest[2..]) {
        return true;
    }
    if rest.len() == 5 && rest.starts_with(b"HA") && all_digits(&rest[2..]) {
        return true;
    }
    false
}

/// United States tax-ID matcher: 9 digits, optionally with a hyphen after the first two (`/^\d{2}-?\d{7}$/`).
///
/// # Arguments
///
/// * `s` - Normalized tax ID (trimmed, no internal whitespace, uppercase).
///
/// # Returns
///
/// `true` when `s` is 9 consecutive digits or `XX-XXXXXXX` (2 digits, optional hyphen, 7 digits);
/// `false` otherwise.
fn match_us(s: &str) -> bool {
    // /^\d{2}-?\d{7}$/
    let b = s.as_bytes();
    if b.len() == 9 && all_digits(b) {
        return true;
    }
    if b.len() == 10 && all_digits(&b[0..2]) && b[2] == b'-' && all_digits(&b[3..]) {
        return true;
    }
    false
}

/// Trim, strip internal whitespace, and uppercase a tax ID for matching and storage.
///
/// # Arguments
///
/// * `tax_id` - Raw tax-ID string from user input.
///
/// # Returns
///
/// A new [`String`] with leading/trailing whitespace removed, all internal whitespace
/// stripped, and characters uppercased (Unicode-aware for non-ASCII letters).
fn normalize_tax_id(tax_id: &str) -> String {
    tax_id
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

/// Run the country matcher on a normalized tax ID.
///
/// # Arguments
///
/// * `country` - [`CountryEntry`] whose hand-rolled matcher is applied.
/// * `tax_id` - Raw tax ID (normalized internally via [`normalize_tax_id`]).
///
/// # Returns
///
/// `true` when the normalized `tax_id` matches `country`'s pattern; `false` otherwise.
fn is_valid_tax_id_for_country(country: &CountryEntry, tax_id: &str) -> bool {
    let normalized = normalize_tax_id(tax_id);
    (country.matcher)(&normalized)
}

/// Sorted `{ value, label }` options (localeCompare by English label).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusinessCountryOption {
    /// ISO 3166-1 alpha-2 country code.
    pub value: String,
    /// English display label for the country select.
    pub label: String,
}

/// Input shape for [`validate_business_details`] (parity with `BusinessDetailsInput` in TS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessDetailsInput {
    /// Whether the purchaser is buying as a business.
    pub is_business: bool,
    /// Legal business name (trimmed when present).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_name: Option<String>,
    /// Business country ISO code (required when `is_business` is true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// Billing country for non-business purchases (tax calculation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_country: Option<String>,
    /// Customer display name (max 100 characters).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
    /// Tax ID to validate against the business country matcher.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id: Option<String>,
    /// Explicit tax-ID type override (normally derived from country).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id_type: Option<TaxIdType>,
}

/// Normalized business-details output (absent fields omitted in JSON).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessDetails {
    /// Whether the purchaser is buying as a business.
    pub is_business: bool,
    /// Uppercase business country ISO code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// Trimmed business name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_name: Option<String>,
    /// Normalized uppercase tax ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id: Option<String>,
    /// Derived or supplied Stripe tax-ID type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_id_type: Option<TaxIdType>,
    /// Uppercase billing country for non-business purchases.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_country: Option<String>,
    /// Trimmed customer display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
}

/// Contract issue shape — React form errors must not change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusinessDetailsValidationIssue {
    /// Field path segments (e.g. `["taxId"]`).
    pub path: Vec<String>,
    /// User-facing validation message (Zod parity).
    pub message: String,
}

/// Validation failure payload returned by [`validate_business_details`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusinessDetailsValidationError {
    /// One or more field-level validation issues.
    pub issues: Vec<BusinessDetailsValidationIssue>,
}

/// Result of [`validate_business_details`] (untagged JSON: `{ success, data }` or `{ success, error }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ValidateBusinessDetailsResult {
    /// Validation passed; `data` holds normalized fields.
    Success {
        /// Always `true` on success (contract tag for untagged JSON).
        success: bool,
        /// Normalized business-details payload.
        data: BusinessDetails,
    },
    /// Validation failed; `error` lists field issues.
    Failure {
        /// Always `false` on failure (contract tag for untagged JSON).
        success: bool,
        /// Field-level validation errors.
        error: BusinessDetailsValidationError,
    },
}

/// Build a single-field validation issue (Zod path parity).
///
/// # Arguments
///
/// * `path` - Field path key (e.g. `"taxId"`, `"country"`).
/// * `message` - User-facing validation message; accepts any [`Into<String>`].
///
/// # Returns
///
/// A [`BusinessDetailsValidationIssue`] with `path` as a single-element vector and the converted message.
fn issue(path: &str, message: impl Into<String>) -> BusinessDetailsValidationIssue {
    BusinessDetailsValidationIssue {
        path: vec![path.to_owned()],
        message: message.into(),
    }
}

/// Wrap validation issues in a failure result (`success: false`).
///
/// # Arguments
///
/// * `issues` - One or more field-level validation issues.
///
/// # Returns
///
/// [`ValidateBusinessDetailsResult::Failure`] with `success: false` and the given `issues`.
fn failure(issues: Vec<BusinessDetailsValidationIssue>) -> ValidateBusinessDetailsResult {
    ValidateBusinessDetailsResult::Failure {
        success: false,
        error: BusinessDetailsValidationError { issues },
    }
}

/// Wrap normalized data in a success result (`success: true`).
///
/// # Arguments
///
/// * `data` - Normalized business-details payload.
///
/// # Returns
///
/// [`ValidateBusinessDetailsResult::Success`] with `success: true` and the given `data`.
fn success(data: BusinessDetails) -> ValidateBusinessDetailsResult {
    ValidateBusinessDetailsResult::Success {
        success: true,
        data,
    }
}

/// Validate and normalize business / billing details (Zod schema parity).
///
/// When `is_business` is false, validates optional `customer_country` and `customer_name`
/// (max 100 characters) and returns normalized non-business details. When `is_business` is true,
/// requires a supported `country`, optionally validates `tax_id` against the country matcher,
/// and derives `tax_id_type` when a tax ID is present.
///
/// # Arguments
///
/// * `input` - Raw business-details input (parity with TS `BusinessDetailsInput`).
///
/// # Returns
///
/// [`ValidateBusinessDetailsResult::Success`] with normalized [`BusinessDetails`] on valid input;
/// [`ValidateBusinessDetailsResult::Failure`] with field-level issues when validation fails.
pub fn validate_business_details(input: &BusinessDetailsInput) -> ValidateBusinessDetailsResult {
    // Zod `.max(100)` runs before `superRefine` — byte-exact default message.
    if let Some(name) = input.customer_name.as_deref() {
        if name.chars().count() > 100 {
            return failure(vec![issue(
                "customerName",
                "Too big: expected string to have <=100 characters",
            )]);
        }
    }

    if !input.is_business {
        if let Some(cc) = input.customer_country.as_deref() {
            let trimmed = cc.trim();
            if !trimmed.is_empty() {
                let upper = trimmed.to_uppercase();
                if !is_supported_country(&upper) {
                    return failure(vec![issue(
                        "customerCountry",
                        "Billing country is not supported for tax calculation",
                    )]);
                }
            }
        }

        let customer_name = trimmed_nonempty(input.customer_name.as_deref());
        let customer_country = input
            .customer_country
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_uppercase())
            .filter(|s| is_supported_country(s));

        return success(BusinessDetails {
            is_business: false,
            country: None,
            business_name: None,
            tax_id: None,
            tax_id_type: None,
            customer_country,
            customer_name,
        });
    }

    let Some(country_raw) = input.country.as_deref() else {
        return failure(vec![issue("country", "Country is required")]);
    };
    let country_trimmed = country_raw.trim();
    if country_trimmed.is_empty() {
        return failure(vec![issue("country", "Country is required")]);
    }
    let country_upper = country_trimmed.to_uppercase();
    let Some(entry) = find_country(&country_upper) else {
        return failure(vec![issue(
            "country",
            "Country is not supported for business purchases",
        )]);
    };

    if let Some(tax_id) = input.tax_id.as_deref() {
        if !tax_id.trim().is_empty() && !is_valid_tax_id_for_country(entry, tax_id) {
            return failure(vec![issue(
                "taxId",
                format!("Enter a valid tax ID for {country_upper}"),
            )]);
        }
    }

    let business_name = trimmed_nonempty(input.business_name.as_deref());
    let tax_id = input
        .tax_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_tax_id);
    let tax_id_type = tax_id.as_ref().map(|_| entry.tax_id_type);
    let customer_name = trimmed_nonempty(input.customer_name.as_deref());

    success(BusinessDetails {
        is_business: true,
        country: Some(country_upper),
        business_name,
        tax_id,
        tax_id_type,
        customer_country: None,
        customer_name,
    })
}

/// Trim a string and return `None` when the result is empty.
///
/// # Arguments
///
/// * `value` - Optional string to trim; `None` passes through.
///
/// # Returns
///
/// [`Some`] owned trimmed string when `value` is present and non-empty after trim;
/// [`None`] when `value` is `None`, empty, or whitespace-only.
fn trimmed_nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Derive tax-ID type from a supported country code.
///
/// # Arguments
///
/// * `country` - ISO 3166-1 alpha-2 country code (exact uppercase match against the
///   supported business-country catalog).
///
/// # Returns
///
/// [`Some`] [`TaxIdType`] for supported countries (`eu_vat`, `gb_vat`, or `us_ein`);
/// [`None`] when `country` is not in the catalog.
pub fn derive_tax_id_type(country: &str) -> Option<TaxIdType> {
    find_country(country).map(|c| c.tax_id_type)
}

/// Example tax ID for a supported country.
///
/// # Arguments
///
/// * `country` - ISO 3166-1 alpha-2 country code (exact uppercase match).
///
/// # Returns
///
/// [`Some`] static example string that passes the country's matcher;
/// [`None`] when `country` is unsupported.
pub fn get_tax_id_example(country: &str) -> Option<&'static str> {
    find_country(country).map(|c| c.example)
}

/// Field label for the country's tax-ID type.
///
/// # Arguments
///
/// * `country` - ISO 3166-1 alpha-2 country code (exact uppercase match).
///
/// # Returns
///
/// [`Some`] UI label (`"VAT ID"`, `"VAT Number"`, or `"EIN (Employer Identification Number)"`);
/// [`None`] when `country` is unsupported or has no derivable tax-ID type.
pub fn get_tax_id_field_label(country: &str) -> Option<&'static str> {
    let tax_type = derive_tax_id_type(country)?;
    Some(match tax_type {
        TaxIdType::EuVat => "VAT ID",
        TaxIdType::GbVat => "VAT Number",
        TaxIdType::UsEin => "EIN (Employer Identification Number)",
    })
}

/// Helper text including the country example.
///
/// # Arguments
///
/// * `country` - ISO 3166-1 alpha-2 country code (exact uppercase match).
///
/// # Returns
///
/// [`Some`] formatted helper string with the country's example tax ID;
/// [`None`] when `country` is unsupported.
pub fn get_tax_id_helper_text(country: &str) -> Option<String> {
    let example = get_tax_id_example(country)?;
    let tax_type = derive_tax_id_type(country)?;
    Some(match tax_type {
        TaxIdType::UsEin => format!("Enter your EIN, e.g. {example}"),
        TaxIdType::GbVat => {
            format!("Enter your full VAT number including the country code, e.g. {example}")
        }
        TaxIdType::EuVat => {
            format!("Enter your full VAT ID including the country code, e.g. {example}")
        }
    })
}

/// Business country select options sorted by English display label.
///
/// # Returns
///
/// A [`Vec`] of [`BusinessCountryOption`] for every supported business country,
/// sorted lexicographically by English `label` (ASCII `localeCompare` parity).
pub fn get_business_country_options() -> Vec<BusinessCountryOption> {
    let mut options: Vec<BusinessCountryOption> = COUNTRIES
        .iter()
        .map(|c| BusinessCountryOption {
            value: c.code.to_owned(),
            label: c.display_name.to_owned(),
        })
        .collect();
    // TS uses `localeCompare` on English labels — ASCII lexicographic order matches.
    options.sort_by(|a, b| a.label.cmp(&b.label));
    options
}

/// Tax behavior input values.
pub const TAX_BEHAVIORS: [&str; 3] = ["auto", "inclusive", "exclusive"];

/// Currencies that resolve `auto` → exclusive.
pub const TAX_EXCLUSIVE_CURRENCIES: [&str; 2] = ["USD", "CAD"];

/// Resolve tax behavior for a currency (`auto` → inclusive/exclusive).
///
/// `"auto"` maps USD and CAD to `"exclusive"` and all other currencies to `"inclusive"`.
///
/// # Arguments
///
/// * `behavior` - One of `"auto"`, `"inclusive"`, or `"exclusive"`.
/// * `currency` - ISO currency code (case-insensitive; uppercased for `auto` resolution).
///
/// # Returns
///
/// [`Some`] `"inclusive"` or `"exclusive"` when `behavior` is recognized;
/// [`None`] when `behavior` is not one of the supported values.
pub fn resolve_tax_behavior(behavior: &str, currency: &str) -> Option<&'static str> {
    match behavior {
        "inclusive" => Some("inclusive"),
        "exclusive" => Some("exclusive"),
        "auto" => {
            let normalized = currency.to_uppercase();
            if TAX_EXCLUSIVE_CURRENCIES.contains(&normalized.as_str()) {
                Some("exclusive")
            } else {
                Some("inclusive")
            }
        }
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
    use serde_json::json;

    #[test]
    fn validate_non_business_empty() {
        let result = validate_business_details(&BusinessDetailsInput {
            is_business: false,
            business_name: None,
            country: None,
            customer_country: None,
            customer_name: None,
            tax_id: None,
            tax_id_type: None,
        });
        match result {
            ValidateBusinessDetailsResult::Success { data, .. } => {
                assert!(!data.is_business);
                assert!(data.customer_country.is_none());
            }
            ValidateBusinessDetailsResult::Failure { .. } => panic!("expected success"),
        }
    }

    #[test]
    fn validate_invalid_tax_id_message() {
        let result = validate_business_details(&BusinessDetailsInput {
            is_business: true,
            business_name: None,
            country: Some("DE".into()),
            customer_country: None,
            customer_name: None,
            tax_id: Some("DE12".into()),
            tax_id_type: None,
        });
        match result {
            ValidateBusinessDetailsResult::Failure { error, .. } => {
                assert_eq!(error.issues[0].path, vec!["taxId"]);
                assert_eq!(error.issues[0].message, "Enter a valid tax ID for DE");
            }
            ValidateBusinessDetailsResult::Success { .. } => panic!("expected failure"),
        }
    }

    #[test]
    fn normalize_tax_id_and_country() {
        let result = validate_business_details(&BusinessDetailsInput {
            is_business: true,
            business_name: Some("  Acme  ".into()),
            country: Some(" de ".into()),
            customer_country: None,
            customer_name: None,
            tax_id: Some("de123 456789".into()),
            tax_id_type: None,
        });
        match result {
            ValidateBusinessDetailsResult::Success { data, .. } => {
                assert_eq!(data.country.as_deref(), Some("DE"));
                assert_eq!(data.tax_id.as_deref(), Some("DE123456789"));
                assert_eq!(data.tax_id_type, Some(TaxIdType::EuVat));
                assert_eq!(data.business_name.as_deref(), Some("Acme"));
            }
            ValidateBusinessDetailsResult::Failure { .. } => panic!("expected success"),
        }
    }

    #[test]
    fn customer_name_too_big_zod_message() {
        let result = validate_business_details(&BusinessDetailsInput {
            is_business: false,
            business_name: None,
            country: None,
            customer_country: None,
            customer_name: Some("a".repeat(101)),
            tax_id: None,
            tax_id_type: None,
        });
        match result {
            ValidateBusinessDetailsResult::Failure { error, .. } => {
                assert_eq!(
                    error.issues[0].message,
                    "Too big: expected string to have <=100 characters"
                );
            }
            ValidateBusinessDetailsResult::Success { .. } => panic!("expected failure"),
        }
    }

    #[test]
    fn tax_id_examples_validate_for_all_countries() {
        for entry in COUNTRIES {
            let result = validate_business_details(&BusinessDetailsInput {
                is_business: true,
                business_name: Some("Example Co".into()),
                country: Some(entry.code.into()),
                customer_country: None,
                customer_name: None,
                tax_id: Some(entry.example.into()),
                tax_id_type: None,
            });
            assert!(
                matches!(result, ValidateBusinessDetailsResult::Success { .. }),
                "example for {} should validate",
                entry.code
            );
        }
    }

    #[test]
    fn resolve_tax_behavior_matrix() {
        assert_eq!(resolve_tax_behavior("auto", "USD"), Some("exclusive"));
        assert_eq!(resolve_tax_behavior("auto", "CAD"), Some("exclusive"));
        assert_eq!(resolve_tax_behavior("auto", "EUR"), Some("inclusive"));
        assert_eq!(resolve_tax_behavior("auto", "usd"), Some("exclusive"));
        assert_eq!(resolve_tax_behavior("inclusive", "USD"), Some("inclusive"));
        assert_eq!(resolve_tax_behavior("exclusive", "EUR"), Some("exclusive"));
    }

    #[test]
    fn country_options_sorted_by_label() {
        let options = get_business_country_options();
        assert_eq!(options.len(), COUNTRIES.len());
        let labels: Vec<&str> = options.iter().map(|o| o.label.as_str()).collect();
        let mut sorted = labels.clone();
        sorted.sort();
        assert_eq!(labels, sorted);
        assert_eq!(options[0].value, "AT");
        assert_eq!(options.last().unwrap().value, "US");
    }

    #[test]
    fn derive_and_labels() {
        assert_eq!(derive_tax_id_type("SE"), Some(TaxIdType::EuVat));
        assert_eq!(derive_tax_id_type("GB"), Some(TaxIdType::GbVat));
        assert_eq!(derive_tax_id_type("US"), Some(TaxIdType::UsEin));
        assert_eq!(get_tax_id_example("GR"), Some("EL123456789"));
        assert_eq!(get_tax_id_field_label("SE"), Some("VAT ID"));
        assert!(get_tax_id_helper_text("US").unwrap().contains("12-3456789"));
    }

    #[test]
    fn skip_absent_fields_in_json() {
        let result = validate_business_details(&BusinessDetailsInput {
            is_business: true,
            business_name: None,
            country: Some("SE".into()),
            customer_country: None,
            customer_name: None,
            tax_id: None,
            tax_id_type: None,
        });
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(
            value,
            json!({
                "success": true,
                "data": { "isBusiness": true, "country": "SE" }
            })
        );
    }
}
