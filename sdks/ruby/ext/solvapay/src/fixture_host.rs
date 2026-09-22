//! Test-only native seams for shared offline fixture replay.

#![allow(clippy::missing_docs_in_private_items)]

use magnus::prelude::*;
use magnus::{function, Error, RModule};
use solvapay_core::fixture_host::{
    construct_sdk_error_envelope, resolve_authenticated_user_from_json,
};

use crate::error::run_envelope_sync;

pub(crate) fn resolve_authenticated_user_binding(args_json: String) -> String {
    run_envelope_sync(|| resolve_authenticated_user_from_json(&args_json))
}

pub(crate) fn construct_sdk_error_binding(args_json: String) -> String {
    construct_sdk_error_envelope(&args_json)
}

pub(crate) fn register(native: RModule) -> Result<(), Error> {
    native.define_singleton_method(
        "_resolve_authenticated_user",
        function!(resolve_authenticated_user_binding, 1),
    )?;
    native.define_singleton_method(
        "_construct_sdk_error",
        function!(construct_sdk_error_binding, 1),
    )?;
    Ok(())
}
