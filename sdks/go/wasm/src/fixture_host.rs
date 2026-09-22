//! Test-only host adapters for golden fixtures not on the public facade.
//!
//! Exposes `sv_resolve_authenticated_user` and `sv_construct_sdk_error` for the
//! offline Go contract suite.

#![allow(clippy::missing_docs_in_private_items)]

use solvapay_core::fixture_host::{
    construct_sdk_error_envelope, resolve_authenticated_user_from_json,
};

use crate::abi::{pack, read_string};
use crate::error::run_envelope_sync;

/// Binding for `resolveAuthenticatedUser` (helper-auth fixtures).
///
/// # Safety
///
/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.
#[no_mangle]
pub unsafe extern "C" fn sv_resolve_authenticated_user(args_ptr: *mut u8, args_len: usize) -> u64 {
    let args_json = read_string(args_ptr, args_len);
    pack(run_envelope_sync(|| {
        resolve_authenticated_user_from_json(&args_json)
    }))
}

/// Binding for `constructSdkError` (error-model fixtures).
///
/// # Safety
///
/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.
#[no_mangle]
pub unsafe extern "C" fn sv_construct_sdk_error(args_ptr: *mut u8, args_len: usize) -> u64 {
    let args_json = read_string(args_ptr, args_len);
    pack(construct_sdk_error_envelope(&args_json))
}
