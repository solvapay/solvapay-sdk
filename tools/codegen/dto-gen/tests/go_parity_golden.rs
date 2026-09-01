//! Golden test for generated Go signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_go;

#[test]
fn go_parity_matches_committed_and_has_real_defaults() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_parity_suite_go(&ir).expect("emit parity");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("goParity")
            .expect("goParity"),
    )
    .expect("committed parity");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("len(operationSignatures); got != 42"));
    assert!(emitted.contains("expectedLimitsCacheTTLMs = 10000"));
    assert!(emitted.contains("expectedMaxRetries = 2"));
    assert!(emitted.contains("expectedInitialDelayMs = 500"));
    assert!(emitted.contains("_ = (*solvapay.Client).CheckLimits"));
    assert!(emitted.contains("TestSyncOnlyMatrix"));
    assert!(emitted.contains("paramTypes"));
    assert!(emitted.contains("TestExportedClientMethodsMatchCensus"));
    assert!(emitted.contains("map[string]interface {}"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("|| true"));
}
