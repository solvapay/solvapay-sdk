//! Shared `trackUsage` request renderer used by both gate and payable drivers.

use serde_json::{json, Value};

use crate::random::{iso8601_millis, random9_from_f64};

/// Frozen `trackUsage.actionType` (`defaults.usageActionType`).
const USAGE_ACTION_TYPE: &str = "api_call";
/// Frozen `trackUsage` request-id template (`defaults.requestIdFormat`).
const REQUEST_ID_FORMAT: &str = "solvapay_{epochMs}_{random9}";

/// Expand the frozen `solvapay_{epochMs}_{random9}` request-id template.
fn render_request_id(now_ms: i64, random_unit: f64) -> String {
    REQUEST_ID_FORMAT
        .replace("{epochMs}", &now_ms.to_string())
        .replace("{random9}", &random9_from_f64(random_unit))
}

/// Render the complete `trackUsage` body, including request ID and timestamp.
///
/// # Arguments
///
/// * `customer_ref` - Backend customer ref billed for this event.
/// * `product` - Product reference.
/// * `meter_name` - Usage meter (`metadata.action`).
/// * `outcome` - `success` / `fail` / `paywall`.
/// * `duration_ms` - Elapsed milliseconds.
/// * `now_ms` - Host clock (authoritative timestamp + request id).
/// * `random_unit` - Host `Math.random()` unit interval for the request id.
/// * `error_message` - Optional fail-path message.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn build_usage_request(
    customer_ref: &str,
    product: &str,
    meter_name: &str,
    outcome: &str,
    duration_ms: f64,
    now_ms: i64,
    random_unit: f64,
    error_message: Option<String>,
) -> Value {
    let request_id = render_request_id(now_ms, random_unit);
    let duration = if duration_ms.is_finite() && duration_ms.fract() == 0.0 {
        #[expect(clippy::cast_possible_truncation)]
        let whole = duration_ms as i64;
        json!(whole)
    } else {
        json!(duration_ms)
    };
    let mut request = json!({
        "customerRef": customer_ref,
        "actionType": USAGE_ACTION_TYPE,
        "units": 1,
        "outcome": outcome,
        "productRef": product,
        "duration": duration,
        "metadata": {
            "action": meter_name,
            "requestId": request_id,
        },
        "timestamp": iso8601_millis(now_ms),
    });
    if let Some(message) = error_message {
        if let Some(obj) = request.as_object_mut() {
            obj.insert("errorMessage".to_owned(), json!(message));
        }
    }
    request
}
