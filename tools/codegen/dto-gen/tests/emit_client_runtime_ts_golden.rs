//! Golden tests for `emit_client_runtime_ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_client_runtime_ts;

#[test]
fn emit_client_runtime_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_client_runtime_ts(&ir).expect("emit client runtime ts");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("tsClientRuntime")
            .expect("tsClientRuntime"),
    )
    .expect("committed client.runtime.generated.ts");
    assert_eq!(emitted, committed);

    assert_eq!(emitted.matches("async ").count(), 43);
    assert!(emitted.contains("async mcpDispatch(params)"));
    assert!(emitted.contains("async updateCustomer(customerRef, params)"));
    assert!(emitted.contains("{ customerRef, ...params }"));
    assert!(emitted.contains("async cloneProduct(productRef, overrides)"));
    assert!(emitted.contains("{ productRef, ...(overrides ?? {}) }"));
    assert!(emitted.contains("async getMerchant()"));
    assert!(emitted.contains("dispatchClient('getMerchant', {})"));
}
