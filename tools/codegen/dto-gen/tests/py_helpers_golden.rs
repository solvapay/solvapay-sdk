//! Golden test for generated Python portable helpers.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_helpers_py;

#[test]
fn py_helpers_match_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_helpers_py(&ir).expect("emit helpers.generated.py");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("pyHelpers")
            .expect("pyHelpers"),
    )
    .expect("helpers.generated.py");
    assert_eq!(
        support::strip_generated_header(&emitted),
        support::strip_generated_header(&committed)
    );
    assert!(emitted.contains("def derive_tax_id_type("));
    assert!(emitted.contains("call_native_sync"));
    assert!(emitted.contains("_CONSTANT_IDS"));
}
