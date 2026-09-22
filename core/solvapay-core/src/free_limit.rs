//! Free-tool allowance helpers (`registerFree` / `freeLimit`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::helper_error::HelperErrorResult;

/// Frozen regex for free-meter names (`/^free-[a-z0-9-]+$/`).
pub const FREE_METER_NAME_PATTERN: &str = r"^free-[a-z0-9-]+$";

/// Default meter when the caller omits `meter`.
const DEFAULT_FREE_METER: &str = "free-requests";

/// Allowance window for a free-capped tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FreeLimitScope {
    /// Rolling window of `window_days` days.
    RollingWindow,
    /// Lifetime cap, never resets.
    Lifetime,
}

/// Author-supplied free-limit input (meter optional; normalized later).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeLimitInput {
    /// Optional meter; defaults to `free-requests`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter: Option<String>,
    /// Positive call cap.
    pub cap: f64,
    /// Window kind.
    pub scope: FreeLimitScope,
    /// Required when [`FreeLimitScope::RollingWindow`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_days: Option<f64>,
}

/// Normalized free-tool allowance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeLimit {
    /// Lowercased meter matching [`FREE_METER_NAME_PATTERN`].
    pub meter: String,
    /// Positive call cap.
    pub cap: f64,
    /// Window kind.
    pub scope: FreeLimitScope,
    /// Present when [`FreeLimitScope::RollingWindow`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_days: Option<f64>,
}

/// Frozen regex source for free-meter names.
///
/// # Returns
///
/// The `^free-[a-z0-9-]+$` pattern string.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "free-limit",
    emit_order = 1
)]
pub fn free_meter_name_pattern() -> String {
    FREE_METER_NAME_PATTERN.to_owned()
}

/// Normalize a free-limit declaration.
///
/// Meter defaults to `free-requests`, is lowercased, and must match
/// [`FREE_METER_NAME_PATTERN`]. `rolling_window` requires `windowDays`.
///
/// # Arguments
///
/// * `limit` - Author-supplied free-limit fields.
///
/// # Errors
///
/// Returns a 400 helper error when the meter is invalid or `windowDays`
/// is missing for a rolling window.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "free-limit",
    emit_order = 2
)]
pub fn normalize_free_limit(limit: &FreeLimitInput) -> Result<FreeLimit, HelperErrorResult> {
    let meter = limit
        .meter
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_FREE_METER)
        .to_ascii_lowercase();
    if !is_valid_free_meter(&meter) {
        return Err(HelperErrorResult::without_details(
            format!("Free allowance meter '{meter}' must match {FREE_METER_NAME_PATTERN}"),
            400,
        ));
    }
    if limit.scope == FreeLimitScope::RollingWindow && limit.window_days.is_none() {
        return Err(HelperErrorResult::without_details(
            "windowDays is required when scope is rolling_window",
            400,
        ));
    }
    Ok(FreeLimit {
        meter,
        cap: limit.cap,
        scope: limit.scope,
        window_days: limit.window_days,
    })
}

/// True when two normalized free limits name the same cap.
///
/// # Arguments
///
/// * `left` - First limit.
/// * `right` - Second limit.
///
/// # Returns
///
/// `true` when meter, cap, scope, and window days all match.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "free-limit",
    emit_order = 3
)]
pub fn free_limits_agree(left: &FreeLimit, right: &FreeLimit) -> bool {
    left.meter == right.meter
        && left.cap == right.cap
        && left.scope == right.scope
        && left.window_days == right.window_days
}

/// Description suffix appended to a free-capped MCP tool.
///
/// # Arguments
///
/// * `limit` - Normalized free limit.
/// * `shared_with` - Other tool names already on this meter.
///
/// # Returns
///
/// The `Free tool — …` sentence, plus a share tail when `shared_with` is
/// non-empty.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "free-limit",
    emit_order = 4
)]
pub fn free_tool_description_suffix(limit: &FreeLimit, shared_with: Option<&Value>) -> String {
    let shared_with = match shared_with {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let window = match limit.scope {
        FreeLimitScope::Lifetime => "lifetime".to_owned(),
        FreeLimitScope::RollingWindow => {
            let days = limit.window_days.map_or_else(|| "0".to_owned(), format_cap);
            format!("{days} days")
        }
    };
    let cap = format_cap(limit.cap);
    let base = format!(
        "Free tool — {cap} calls per {window}, then a plan is required. Call `account` for remaining usage."
    );
    if shared_with.is_empty() {
        return base;
    }
    let names = shared_with
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{base} Shares a free allowance with {names}.")
}

/// True when `meter` matches `^free-[a-z0-9-]+$`.
fn is_valid_free_meter(meter: &str) -> bool {
    let Some(rest) = meter.strip_prefix("free-") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Render a cap without a trailing `.0` when the value is integral.
fn format_cap(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items,
        clippy::float_cmp
    )]

    use super::*;

    #[test]
    fn defaults_meter_and_lowercases() {
        let limit = normalize_free_limit(&FreeLimitInput {
            meter: None,
            cap: 5.0,
            scope: FreeLimitScope::Lifetime,
            window_days: None,
        })
        .unwrap();
        assert_eq!(limit.meter, DEFAULT_FREE_METER);

        let limit = normalize_free_limit(&FreeLimitInput {
            meter: Some("Free-Previews".to_owned()),
            cap: 5.0,
            scope: FreeLimitScope::Lifetime,
            window_days: None,
        })
        .unwrap();
        assert_eq!(limit.meter, "free-previews");
    }

    #[test]
    fn rejects_bad_meter() {
        let err = normalize_free_limit(&FreeLimitInput {
            meter: Some("requests".to_owned()),
            cap: 5.0,
            scope: FreeLimitScope::Lifetime,
            window_days: None,
        })
        .unwrap_err();
        assert_eq!(err.status, 400);
        assert!(err.error.contains("must match"));
    }

    #[test]
    fn rolling_window_requires_days() {
        let err = normalize_free_limit(&FreeLimitInput {
            meter: Some("free-requests".to_owned()),
            cap: 5.0,
            scope: FreeLimitScope::RollingWindow,
            window_days: None,
        })
        .unwrap_err();
        assert_eq!(
            err.error,
            "windowDays is required when scope is rolling_window"
        );
    }
}
