//! Golden test for generated Rust portable helper re-exports.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_helpers_rs;

#[test]
fn rs_helpers_match_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = support::rustfmt_source(
        &emit_helpers_rs(&ir).expect("emit helpers_generated.rs"),
        "rs helpers",
    );
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("rsHelpers")
            .expect("rsHelpers"),
    )
    .expect("helpers_generated.rs");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("pub use solvapay_core::"));
    assert!(emitted.contains("derive_tax_id_type"));
}
