//! Descriptor-driven signature-parity suite emitters.

mod descriptor;
mod render_c;
mod render_go;
mod render_py;
mod render_rb;
mod render_rs;
mod render_ts;

use crate::error::GenResult;
use crate::ir::Ir;

use descriptor::ParitySuiteDescriptor;

/// Emits `signature-parity.generated.test.ts` contents.
///
/// # Errors
///
/// Returns formatting errors as [`crate::error::GenError`] (none expected for string writes).
pub fn emit_parity_suite_ts(ir: &Ir) -> GenResult<String> {
    render_ts::render(&ParitySuiteDescriptor::from_ir(ir)?)
}

/// Emits `signature_parity_generated_test.py` contents.
///
/// # Errors
///
/// Returns formatting errors as [`crate::error::GenError`] (none expected).
pub fn emit_parity_suite_py(ir: &Ir) -> GenResult<String> {
    render_py::render(&ParitySuiteDescriptor::from_ir(ir)?)
}

/// Emits `test/signature_parity_generated_test.rb`.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_parity_suite_rb(ir: &Ir) -> GenResult<String> {
    render_rb::render(&ParitySuiteDescriptor::from_ir(ir)?)
}

/// Emits `signature_parity_generated_test.go`.
///
/// # Errors
///
/// Returns formatting / IR shape failures as [`crate::error::GenError`].
pub fn emit_parity_suite_go(ir: &Ir) -> GenResult<String> {
    render_go::render(&ParitySuiteDescriptor::from_ir(ir)?)
}

/// Emits `tests/signature_parity_generated.rs`.
///
/// # Errors
///
/// Returns formatting / IR shape failures as [`crate::error::GenError`].
pub fn emit_parity_suite_rs(ir: &Ir) -> GenResult<String> {
    render_rs::render(&ParitySuiteDescriptor::from_ir(ir)?)
}

/// Emits `sdks/capi/ctest/signature_parity_generated.c`.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_parity_suite_c(ir: &Ir) -> GenResult<String> {
    render_c::render(&ParitySuiteDescriptor::from_ir(ir)?)
}
