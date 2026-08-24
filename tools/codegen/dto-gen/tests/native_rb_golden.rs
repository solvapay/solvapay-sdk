//! Golden test for generated Ruby native dispatch.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_native_rb;





#[test]
fn native_rb_matches_committed_and_is_deterministic() {
    let ir = support::lower_bindings_ir();
    let first = emit_native_rb(&ir).expect("emit");
    let second = emit_native_rb(&ir).expect("emit twice");
    assert_eq!(first, second);
    let committed = fs::read_to_string(support::paths().generated_path("nativeRb").expect("nativeRb"))
        .expect("committed native ruby");
    assert_eq!(first, committed, "_native.rb drifted");
    assert_eq!(first.matches("\n      get_merchant\n").count(), 1);
    assert!(first.contains("def reconstruct_error"));
}
