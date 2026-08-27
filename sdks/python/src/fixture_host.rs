//! Test-only host adapters for golden fixtures not on the public facade (Step 42).
//!
//! Exposes `_resolve_authenticated_user` and `_construct_sdk_error` for the
//! offline Python contract suite. Not part of the idiomatic `solvapay` facade.

#![allow(clippy::missing_docs_in_private_items)]

use pyo3::prelude::*;
use solvapay_core::fixture_host::{
    construct_sdk_error_envelope, resolve_authenticated_user_from_json,
};

use crate::error::run_envelope_sync;

/// Binding for `resolveAuthenticatedUser` (helper-auth fixtures).
#[pyfunction(name = "_resolve_authenticated_user")]
pub fn resolve_authenticated_user_binding(args_json: String) -> String {
    run_envelope_sync(|| resolve_authenticated_user_from_json(&args_json))
}

/// Binding for `constructSdkError` (error-model fixtures).
///
/// Always returns an error envelope (fixtures under `error-model/` expect errors).
#[pyfunction(name = "_construct_sdk_error")]
pub fn construct_sdk_error_binding(args_json: String) -> String {
    construct_sdk_error_envelope(&args_json)
}

/// Registers test-only fixture host helpers on the extension module.
pub(crate) fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(resolve_authenticated_user_binding, m)?)?;
    m.add_function(wrap_pyfunction!(construct_sdk_error_binding, m)?)?;
    Ok(())
}
