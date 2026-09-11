//! Deterministic request-ID / timestamp helpers shared with the transport shell.

/// JS `Math.random().toString(36).substr(2, 9)` fragment from a unit-interval float.
///
/// # Arguments
///
/// * `n` - Float in `[0, 1)` (typically from a host `Math.random` / mulberry32).
///
/// # Returns
///
/// Up to nine base-36 characters.
#[must_use]
pub fn random9_from_f64(n: f64) -> String {
    let full = js_number_to_string_36(n);
    full.chars().skip(2).take(9).collect()
}

/// RFC 3339 UTC with millisecond precision (`2026-08-25T15:04:05.123Z`).
///
/// # Arguments
///
/// * `epoch_ms` - Unix epoch milliseconds (negative values saturate to `0`).
#[must_use]
pub fn iso8601_millis(epoch_ms: i64) -> String {
    let epoch_ms = epoch_ms.max(0) as u64;
    let total_secs = (epoch_ms / 1000) as i64;
    let millis = epoch_ms % 1000;
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let min = (secs_of_day % 3600) / 60;
    let sec = secs_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Approximate JS `Number.prototype.toString(36)` for values in `[0, 1)`.
fn js_number_to_string_36(n: f64) -> String {
    let mut out = String::from("0.");
    let mut x = n.fract().abs();
    for _ in 0..20 {
        x *= 36.0;
        let digit = x.floor() as u32;
        out.push(base36_digit(digit.min(35)));
        x -= f64::from(digit);
        if x <= 0.0 {
            break;
        }
    }
    out
}

/// Maps `0..=35` to a base-36 digit character (`0-9a-z`).
fn base36_digit(n: u32) -> char {
    match n {
        0..=9 => char::from(b'0' + n as u8),
        10..=35 => char::from(b'a' + (n as u8 - 10)),
        _ => '0',
    }
}

/// Howard Hinnant `civil_from_days` (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = i64::from(yoe) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    #[expect(clippy::cast_possible_truncation)]
    (y as i32, m, d)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    #[test]
    fn iso8601_millis_unix_epoch() {
        assert_eq!(iso8601_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601_millis(1_250), "1970-01-01T00:00:01.250Z");
        assert_eq!(
            iso8601_millis(1_704_067_200_123),
            "2024-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn random9_half_is_single_digit() {
        assert_eq!(random9_from_f64(0.5), "i");
    }
}
