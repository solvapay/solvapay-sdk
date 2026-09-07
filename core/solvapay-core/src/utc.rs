//! Locale-independent UTC date formatting for React / MCP tables.

#![allow(clippy::missing_docs_in_private_items)]

/// English UTC month abbreviations.
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Parse an RFC3339 / ISO-8601 UTC timestamp to milliseconds since epoch.
#[must_use]
pub fn rfc3339_utc_ms(iso: &str) -> Option<f64> {
    let trimmed = iso.trim().trim_end_matches('Z');
    let (date, time) = trimmed.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    let (hms, frac) = time.split_once('.').map_or((time, 0.0), |(hms, rest)| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        let millis = digits.parse::<f64>().unwrap_or(0.0) / 10f64.powi(digits.len().min(3) as i32);
        (hms, millis * 1000.0)
    });
    let mut time_parts = hms.split(':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let minute: i64 = time_parts.next()?.parse().ok()?;
    let second: i64 = time_parts.next()?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_before_unix(year, month, day)?;
    Some(((days * 86_400 + hour * 3600 + minute * 60 + second) as f64) * 1000.0 + frac)
}

fn days_before_unix(year: i64, month: i64, day: i64) -> Option<i64> {
    let mut days = 0i64;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    const MDAYS: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        days += MDAYS[(m - 1) as usize];
        if m == 2 && is_leap(year) {
            days += 1;
        }
    }
    Some(days + day - 1)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn ymd_from_epoch_days(mut days: i64) -> Option<(i64, u32, u32)> {
    let mut year = 1970i64;
    loop {
        let length = if is_leap(year) { 366 } else { 365 };
        if days < length {
            break;
        }
        days -= length;
        year += 1;
        if year > 10_000 {
            return None;
        }
    }
    const MDAYS: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (idx, month_len) in MDAYS.iter().enumerate() {
        let extra = i64::from(idx == 1 && is_leap(year));
        let length = month_len + extra;
        if days < length {
            return Some((
                year,
                u32::try_from(idx + 1).ok()?,
                u32::try_from(days + 1).ok()?,
            ));
        }
        days -= length;
    }
    None
}

fn parts_from_iso(iso: &str) -> Option<(i64, u32, u32, u32, u32)> {
    let ms = rfc3339_utc_ms(iso)?;
    let secs = (ms / 1000.0).trunc() as i64;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (year, month, day) = ymd_from_epoch_days(days)?;
    let hour = u32::try_from(tod / 3600).ok()?;
    let minute = u32::try_from((tod % 3600) / 60).ok()?;
    Some((year, month, day, hour, minute))
}

/// `Sep 3, 2026`
#[must_use]
pub fn format_since(iso: &str) -> Option<String> {
    let (year, month, day, _, _) = parts_from_iso(iso)?;
    Some(format!("{}, {year}", month_day(month, day)?))
}

/// `Oct 1`
#[must_use]
#[allow(dead_code)]
pub fn format_short_date(iso: &str) -> Option<String> {
    let (_, month, day, _, _) = parts_from_iso(iso)?;
    month_day(month, day)
}

/// `Sep 5, 14:22`
#[must_use]
pub fn format_credit_when(iso: &str) -> Option<String> {
    let (_, month, day, hour, minute) = parts_from_iso(iso)?;
    Some(format!("{}, {hour:02}:{minute:02}", month_day(month, day)?))
}

fn month_day(month: u32, day: u32) -> Option<String> {
    let name = MONTHS.get((month as usize).checked_sub(1)?)?;
    Some(format!("{name} {day}"))
}
