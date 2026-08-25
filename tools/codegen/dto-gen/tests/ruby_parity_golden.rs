//! Golden test for generated Ruby signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_rb;

#[test]
fn ruby_parity_matches_committed_and_has_real_defaults() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_parity_suite_rb(&ir).expect("emit parity");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("rbParity")
            .expect("rbParity"),
    )
    .expect("committed parity");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("assert_equal 36"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("or true"));
}
