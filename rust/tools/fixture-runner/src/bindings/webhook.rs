//! Host-side `verifyWebhook` fixture adapter (Step 12).
//!
//! Parses fixture `input.clock` (ISO-8601) to unix seconds on the host (§7.2 forbids
//! chrono in core). Maps [`WebhookError`] → [`SdkError`] → facade observation (§6.4).

use solvapay_core::{verify_webhook, SdkError, WebhookError};

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError};
use crate::sdk_error::sdk_error_to_observation;

/// Binding for `verifyWebhook`.
///
/// Reads `body`, `signature`, and `secret` args plus required `input.clock`, invokes
/// [`verify_webhook`], and maps domain errors to structured observations.
///
/// # Arguments
///
/// * `input` - Fixture input with string args and ISO-8601 `clock`.
///
/// # Returns
///
/// Parsed JSON event value on success.
///
/// # Errors
///
/// - [`BindingError::Harness`] when required args/clock are missing or malformed
/// - [`BindingError::Sdk`] when verification fails ([`WebhookError`])
pub(super) fn invoke_verify_webhook(
    input: &FixtureInput,
) -> Result<serde_json::Value, BindingError> {
    let body = require_string_arg(input, "body")?;
    let signature = require_string_arg(input, "signature")?;
    let secret = require_string_arg(input, "secret")?;
    let clock = input.clock.as_deref().ok_or_else(|| {
        BindingError::Harness("input.clock is required for verifyWebhook".to_owned())
    })?;
    let now_unix_secs = parse_iso8601_utc_to_unix_secs(clock).ok_or_else(|| {
        BindingError::Harness(format!(
            "input.clock must be YYYY-MM-DDTHH:MM:SSZ, got {clock:?}"
        ))
    })?;

    verify_webhook(&body, &signature, &secret, now_unix_secs).map_err(webhook_error_to_observation)
}

/// Maps a core [`WebhookError`] through [`SdkError`] to a fixture observation.
///
/// Uses the shared §6.4 helper — do not re-encode webhook failures here.
///
/// # Arguments
///
/// * `error` - Domain webhook verification failure.
///
/// # Returns
///
/// [`BindingError::Sdk`] with `name`, `kind`, `code`, and frozen `message`.
fn webhook_error_to_observation(error: WebhookError) -> BindingError {
    let sdk: SdkError = error.into();
    BindingError::Sdk(sdk_error_to_observation(sdk))
}

/// Parses `YYYY-MM-DDTHH:MM:SSZ` to unix seconds (host-side; no chrono in core).
///
/// Accepts exactly the fixture clock shape used by webhook-verification cases.
/// Uses Howard Hinnant's days-from-civil algorithm for the date portion.
///
/// # Arguments
///
/// * `clock` - ISO-8601 UTC timestamp ending in `Z` (no fractional seconds).
///
/// # Returns
///
/// Unix seconds on success; `None` when the string shape or calendar fields are invalid.
pub(crate) fn parse_iso8601_utc_to_unix_secs(clock: &str) -> Option<i64> {
    // YYYY-MM-DDTHH:MM:SSZ  → 20 characters
    if clock.len() != 20 || !clock.is_ascii() {
        return None;
    }
    let bytes = clock.as_bytes();
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return None;
    }

    let year = parse_fixed_u32(&clock[0..4])?;
    let month = parse_fixed_u32(&clock[5..7])?;
    let day = parse_fixed_u32(&clock[8..10])?;
    let hour = parse_fixed_u32(&clock[11..13])?;
    let minute = parse_fixed_u32(&clock[14..16])?;
    let second = parse_fixed_u32(&clock[17..19])?;

    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)?
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }

    let days = days_from_civil(i32::try_from(year).ok()?, month, day)?;
    // Unix epoch is 1970-01-01 = civil day 719_468 in Hinnant's epoch.
    let days_since_epoch = i64::from(days) - 719_468;
    let secs = days_since_epoch
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600)?
        .checked_add(i64::from(minute) * 60)?
        .checked_add(i64::from(second))?;
    Some(secs)
}

/// Parses an ASCII digit substring into `u32`.
///
/// # Arguments
///
/// * `digits` - Non-empty slice of ASCII digit characters.
///
/// # Returns
///
/// Parsed value, or `None` when any character is not an ASCII digit.
fn parse_fixed_u32(digits: &str) -> Option<u32> {
    if digits.is_empty() {
        return None;
    }
    let mut value = 0u32;
    for byte in digits.bytes() {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value.checked_mul(10)?.checked_add(u32::from(byte - b'0'))?;
    }
    Some(value)
}

/// Returns the number of days in `month` of `year`, accounting for leap years.
///
/// # Arguments
///
/// * `year` - Gregorian year.
/// * `month` - Month number 1–12.
///
/// # Returns
///
/// Day count for that month, or `None` when `month` is out of range.
fn days_in_month(year: u32, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 => Some(if is_leap_year(year) { 29 } else { 28 }),
        _ => None,
    }
}

/// Gregorian leap-year test.
///
/// # Arguments
///
/// * `year` - Gregorian year.
///
/// # Returns
///
/// `true` when February has 29 days.
fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Howard Hinnant's civil-from-days inverse: days since civil 0000-03-01.
///
/// # Arguments
///
/// * `year` - Gregorian year (may be negative in the general algorithm; fixtures use ≥ 1970).
/// * `month` - Month 1–12.
/// * `day` - Day of month starting at 1.
///
/// # Returns
///
/// Serial day count used with epoch offset 719_468 for unix conversion, or `None`
/// on overflow.
fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i32> {
    let month = i32::try_from(month).ok()?;
    let day = i32::try_from(day).ok()?;
    let year = if month <= 2 {
        year.checked_sub(1)?
    } else {
        year
    };
    let era = if year >= 0 {
        year
    } else {
        year.checked_sub(399)?
    } / 400;
    let yoe = year.checked_sub(era.checked_mul(400)?)?;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era.checked_mul(146_097)?.checked_add(doe)
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
    fn parses_fixture_clock() {
        assert_eq!(
            parse_iso8601_utc_to_unix_secs("2026-07-01T00:00:00Z"),
            Some(1_782_864_000)
        );
    }

    #[test]
    fn rejects_bad_clock_shape() {
        assert_eq!(parse_iso8601_utc_to_unix_secs("2026-07-01"), None);
        assert_eq!(parse_iso8601_utc_to_unix_secs("2026-07-01T00:00:00"), None);
        assert_eq!(parse_iso8601_utc_to_unix_secs(""), None);
    }
}
