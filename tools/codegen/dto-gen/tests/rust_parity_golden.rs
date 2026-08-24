//! Golden test for generated Rust signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_rs;







#[test]
fn rust_parity_matches_committed_and_has_real_defaults() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_parity_suite_rs(&ir).expect("emit parity");
    let committed = fs::read_to_string(support::paths().generated_path("rsParity").expect("rsParity"))
        .expect("committed parity");
    assert_eq!(support::rustfmt_source(&emitted, "parity"), committed);
    assert!(emitted.contains("assert_eq!(OPERATION_SIGNATURES.len(), 36)"));
    assert!(emitted.contains("_assert_typed_surface"));
    assert!(emitted.contains("_parity_sink"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("or true"));
}
