//! Compile-time backstop for scanned `#[solvapay_export]` signatures.

#![allow(missing_docs, unused_imports, dead_code)]

use serde_json::Value;
use solvapay_core::*;
use solvapay_dto::*;

/// Proves `T` is sized and serde-capable at compile time.
pub const fn assert_boundary<T: serde::Serialize + serde::de::DeserializeOwned + Sized>() {}

include!("asserts.generated.rs");
