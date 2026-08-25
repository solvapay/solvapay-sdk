//! Golden test: emitted C dispatch covers the full 36-op client surface.
//!
//! Lowers the real contract manifest into IR, emits `Toolchain::C`, runs the
//! emitted string through `rustfmt`, and ratchets:
//! - every IR client symbol appears as a `"op" =>` match arm
//! - chrome (unknown-op fallback + `#[cfg(test)]` module) matches committed
//!   `sdks/capi/src/dispatch.rs`
//! - live-contract `invoke.rs` camelCase ops are a subset of the emitted arms

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_bindings_rs::{emit_bindings, Toolchain};
use dto_gen::ir::{Ir, IrBindingArtifact, IrSerializeKind};

fn client_symbols(ir: &Ir) -> Vec<&dto_gen::ir::IrBindingSymbol> {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|s| s.artifact == IrBindingArtifact::Client)
        .collect();
    symbols.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    symbols
}

fn committed_dispatch() -> String {
    let src = support::paths()
        .generated_path("cBindings")
        .expect("cBindings")
        .join("dispatch.rs");
    fs::read_to_string(&src).unwrap_or_else(|e| panic!("read {}: {e}", src.display()))
}

fn extract_unknown_op_arm(src: &str) -> &str {
    let needle = "other =>";
    let start = src.find(needle).expect("unknown-op arm");
    let rest = &src[start..];
    let end = rest.find('\n').expect("unknown-op newline");
    rest[..end].trim()
}

fn extract_tests_mod(src: &str) -> &str {
    let start = src.find("#[cfg(test)]").expect("tests module");
    src[start..].trim()
}

fn extract_get_merchant_arm(src: &str) -> String {
    let start = src
        .find("\"getMerchant\" =>")
        .expect("getMerchant arm missing");
    let after = &src[start..];
    let mut depth = 0i32;
    let mut saw_body = false;
    for (i, ch) in after.char_indices() {
        match ch {
            '{' => {
                depth += 1;
                saw_body = true;
            }
            '}' => {
                depth -= 1;
                if saw_body && depth == 0 {
                    return after[..=i].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("unclosed getMerchant arm");
}

fn live_contract_ops() -> Vec<String> {
    let path = support::paths().abs("tools/conformance/live-contract/src/invoke.rs");
    let src = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let mut ops = Vec::new();
    for line in src.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix('"') {
            if let Some(end) = rest.find('"') {
                let name = &rest[..end];
                if trimmed[1 + end..].contains("=>")
                    && name.chars().next().is_some_and(char::is_alphabetic)
                {
                    ops.push(name.to_string());
                }
            }
        }
    }
    ops.sort();
    ops.dedup();
    ops
}

#[test]
fn c_column_emits_full_36_op_surface() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::C).expect("emit C");
    let symbols = client_symbols(&ir);
    assert_eq!(symbols.len(), 36, "expected 36 client binding symbols");

    let formatted = support::rustfmt_source(&emitted.client_rs, "dispatch");
    for sym in &symbols {
        let arm = format!("\"{}\" =>", sym.id);
        assert!(formatted.contains(&arm), "missing C dispatch arm {arm}");
    }

    let mut saw_await = false;
    let mut saw_split = false;
    let mut saw_ignore = false;
    for sym in &symbols {
        let kind = match &sym.call {
            dto_gen::ir::IrBindingCall::Wrap { serialize, .. } => *serialize,
            dto_gen::ir::IrBindingCall::Verbatim => continue,
        };
        match kind {
            IrSerializeKind::ClientAwait => {
                saw_await = true;
                let dto = sym.dto_type.as_deref().expect("clientAwait dto");
                assert!(
                    formatted.contains(&format!("let params: {dto} = parse_args_json")),
                    "ClientAwait {} missing dto deserialize for {dto}",
                    sym.id
                );
            }
            IrSerializeKind::ClientSplit => {
                saw_split = true;
                assert!(
                    formatted.contains("split_path_refs(&args_json"),
                    "ClientSplit {} missing split_path_refs",
                    sym.id
                );
            }
            IrSerializeKind::ClientIgnore => {
                saw_ignore = true;
            }
            other => panic!("unexpected serialize {other:?} for {}", sym.id),
        }
    }
    assert!(saw_await, "expected at least one ClientAwait op");
    assert!(saw_split, "expected at least one ClientSplit op");
    assert!(saw_ignore, "expected at least one ClientIgnore op");

    assert!(formatted.contains("runtime::runtime().block_on"));
    assert!(formatted.contains("run_envelope(async move"));
    assert!(emitted.decisions_rs.is_empty());
    assert!(emitted.payload_builders_rs.is_empty());
    assert!(emitted.register_rs.is_empty());
    assert!(emitted.args_rs.is_empty());
}

#[test]
fn c_chrome_unknown_op_and_tests_match_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::C).expect("emit C");
    let formatted = support::rustfmt_source(&emitted.client_rs, "chrome");
    let committed = committed_dispatch();

    assert_eq!(
        extract_unknown_op_arm(&formatted),
        extract_unknown_op_arm(&committed),
        "unknown-op fallback drifted"
    );
    assert_eq!(
        extract_tests_mod(&formatted),
        extract_tests_mod(&committed),
        "tests trailer drifted"
    );
}

#[test]
fn c_get_merchant_arm_keeps_client_call_and_block_on() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::C).expect("emit C");
    let formatted = support::rustfmt_source(&emitted.client_rs, "get_merchant");
    let arm = extract_get_merchant_arm(&formatted);
    assert!(
        arm.contains("client.get_merchant()"),
        "getMerchant must call client.get_merchant: {arm}"
    );
    assert!(
        arm.contains("runtime::runtime().block_on"),
        "getMerchant must drive the future with the C runtime: {arm}"
    );
    assert!(
        arm.contains("run_envelope"),
        "getMerchant must reuse run_envelope: {arm}"
    );
}

#[test]
fn c_ops_cover_live_contract_invoke_table() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::C).expect("emit C");
    let formatted = support::rustfmt_source(&emitted.client_rs, "live_contract");
    let live = live_contract_ops();
    assert!(!live.is_empty(), "live-contract invoke.rs produced no ops");
    for op in live {
        let arm = format!("\"{op}\" =>");
        assert!(
            formatted.contains(&arm),
            "live-contract op {op} missing from C dispatch"
        );
    }
}
