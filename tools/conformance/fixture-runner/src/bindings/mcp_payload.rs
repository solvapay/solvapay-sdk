//! Host-side adapter for `assertResponseResult` (`name: "Error"`).

use serde_json::Value;
use solvapay_core::assert_response_result;

use crate::model::FixtureInput;
use crate::runner::{BindingError, ErrorObservation};

/// Binding for `assertResponseResult`.
pub(crate) fn invoke_assert_response_result(input: &FixtureInput) -> Result<Value, BindingError> {
    let value = input
        .args
        .get("value")
        .cloned()
        .ok_or_else(|| BindingError::Harness("args.value is required".to_owned()))?;
    match assert_response_result(&value) {
        Ok(v) => Ok(v),
        Err(message) => Err(BindingError::Sdk(ErrorObservation {
            name: Some("Error".to_owned()),
            message: message.to_owned(),
            kind: None,
            code: None,
            status: None,
        })),
    }
}
