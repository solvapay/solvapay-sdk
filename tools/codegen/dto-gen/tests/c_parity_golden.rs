//! Golden test for generated C signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_c;





#[test]
fn c_parity_matches_committed_and_has_real_checks() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_parity_suite_c(&ir).expect("emit parity");
    let committed = fs::read_to_string(support::paths().generated_path("cParity").expect("cParity"))
        .expect("committed parity");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("nops != 36"));
    assert!(emitted.contains("(void)&solvapay_client_call"));
    assert!(emitted.contains("solvapay_abi_version() != SOLVAPAY_ABI_VERSION"));
    assert!(emitted.contains("unknown op"));
    assert!(emitted.contains("kRequiredArgs[][kMaxRequired]"));
    assert!(emitted.contains("json_with_filled"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("|| true"));
}
