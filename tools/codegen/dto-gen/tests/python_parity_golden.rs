//! Golden test: emitted Python signature-parity suite matches committed output
//! (Step 41-e).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_py::emit_parity_suite_py;

#[test]
fn python_parity_suite_matches_committed() {
    let ir = support::lower_catalog_ir();
    let emitted = emit_parity_suite_py(&ir).expect("emit py parity");
    let path = support::paths()
        .generated_path("pyParity")
        .expect("pyParity");
    let committed = fs::read_to_string(&path).expect("read committed parity suite");
    assert_eq!(
        support::strip_generated_header(&emitted),
        support::strip_generated_header(&committed),
        "python parity suite drifted — regenerate with --py-parity-out"
    );
    assert!(emitted.contains("check_limits"));
    assert!(emitted.contains("10000"));
    assert!(emitted.contains("test_client_method_census"));
    assert!(emitted.contains("test_stub_cross_check"));
    assert!(emitted.contains("['self', 'args_json']"));
    assert!(!emitted.contains("test_client_method_presence"));
    assert!(!emitted.contains("assert async_expected"));
    assert!(!emitted.contains("or True"));
    assert!(!emitted.contains("2 == 2"));
}
