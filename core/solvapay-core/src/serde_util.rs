//! Shared serde helpers for JSON integer-emission parity with TS.

use serde::Serializer;

/// Serializes whole-number `f64` values as JSON integers (TS `JSON.stringify` parity).
///
/// # Errors
///
/// Propagates serializer errors.
pub(crate) fn serialize_whole_f64<S: Serializer>(
    value: &f64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if value.is_finite() && value.fract() == 0.0 {
        #[expect(clippy::cast_possible_truncation)]
        let int = *value as i64;
        if (int as f64 - *value).abs() < f64::EPSILON {
            return serializer.serialize_i64(int);
        }
    }
    serializer.serialize_f64(*value)
}

/// Optional variant of [`serialize_whole_f64`].
///
/// # Errors
///
/// Propagates serializer errors.
pub(crate) fn serialize_opt_whole_f64<S: Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        None => serializer.serialize_none(),
        Some(v) => serialize_whole_f64(v, serializer),
    }
}
