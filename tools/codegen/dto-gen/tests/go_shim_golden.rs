//! Golden test: emitted wazero (Go) WASI guest shims match committed files.
//!
//! Lowers the real contract manifest into IR, emits `Toolchain::Go`, runs the
//! emitted string through `rustfmt` exactly like `dto-gen` does on write, and
//! compares against the committed files under `sdks/go/wasm/src`
//! after stripping the leading `//!` module-doc block.
//!
//! Also asserts the Step 50 full surface: all 36 `sv_*` client exports, plus
//! `split_path_refs` / ClientAwait deserialize shapes in `args.rs` / `client.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;
use std::path::Path;

use dto_gen::emit_bindings_rs::{emit_bindings, Toolchain};
use dto_gen::ir::{Ir, IrBindingArtifact, IrSerializeKind};

fn strip_module_doc(src: &str) -> String {
    let mut rest: Vec<&str> = Vec::new();
    let mut in_header = true;
    for line in src.lines() {
        if in_header && line.trim_start().starts_with("//!") {
            continue;
        }
        in_header = false;
        rest.push(line);
    }
    rest.join("\n").trim_start().to_string()
}

fn assert_matches(emitted: &str, committed_path: &Path, tag: &str) {
    let committed = fs::read_to_string(committed_path)
        .unwrap_or_else(|e| panic!("read committed {}: {e}", committed_path.display()));
    let formatted = support::rustfmt_source(emitted, tag);
    let got = strip_module_doc(&formatted);
    let want = strip_module_doc(&committed);
    if got != want {
        let g: Vec<&str> = got.lines().collect();
        let w: Vec<&str> = want.lines().collect();
        let mut first = 0;
        while first < g.len() && first < w.len() && g[first] == w[first] {
            first += 1;
        }
        let ctx = |v: &[&str]| {
            let start = first.saturating_sub(2);
            let end = (first + 4).min(v.len());
            v[start..end].join("\n")
        };
        panic!(
            "emitted {tag} does not match committed at line ~{first}\n--- emitted ---\n{}\n--- committed ---\n{}",
            ctx(&g),
            ctx(&w)
        );
    }
}

fn client_symbols(ir: &Ir) -> Vec<&dto_gen::ir::IrBindingSymbol> {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|s| s.artifact == IrBindingArtifact::Client)
        .collect();
    symbols.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    symbols
}

#[test]
fn go_client_exports_full_36_op_surface() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::Go).expect("emit go");
    let symbols = client_symbols(&ir);
    assert_eq!(symbols.len(), 41, "expected 41 client binding symbols");

    for sym in &symbols {
        let export = format!("sv_{}(", sym.rust_fn_name);
        assert!(
            emitted.client_rs.contains(&export),
            "missing export {export}"
        );
    }

    assert!(emitted.args_rs.contains("fn split_path_refs"));
    assert!(emitted.args_rs.contains("struct ClientConfig"));
    assert!(emitted.args_rs.contains("struct VerifyWebhookArgs"));
    assert!(emitted.webhook_rs.contains("sv_verify_webhook"));

    let mut saw_await = false;
    let mut saw_split = false;
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
                    emitted
                        .client_rs
                        .contains(&format!("let params: {dto} = parse_args_json")),
                    "ClientAwait {} missing dto deserialize for {dto}",
                    sym.id
                );
            }
            IrSerializeKind::ClientSplit => {
                saw_split = true;
                assert!(
                    emitted.client_rs.contains("split_path_refs(&args_json"),
                    "ClientSplit {} missing split_path_refs",
                    sym.id
                );
            }
            IrSerializeKind::ClientIgnore => {}
            other => panic!("unexpected serialize {other:?} for {}", sym.id),
        }
    }
    assert!(saw_await, "expected at least one ClientAwait op");
    assert!(saw_split, "expected at least one ClientSplit op");

    let mut sync: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|s| {
            matches!(
                s.artifact,
                IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders
            )
        })
        .collect();
    assert_eq!(sync.len(), 93, "expected 93 sync helper binding symbols");
    sync.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    for sym in &sync {
        let export = format!("sv_{}(", sym.rust_fn_name);
        let in_decisions = emitted.decisions_rs.contains(&export);
        let in_payload = emitted.payload_builders_rs.contains(&export);
        assert!(in_decisions || in_payload, "missing sync export {export}");
    }
    assert!(!emitted.decisions_rs.is_empty());
    assert!(!emitted.payload_builders_rs.is_empty());
    assert!(emitted.register_rs.is_empty());
    assert!(
        !emitted.client_rs.contains("hello-world scaffold"),
        "module doc must not advertise the Step 49 scaffold"
    );
}

#[test]
fn go_shims_match_committed_files() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::Go).expect("emit go");
    let src = support::paths()
        .generated_path("goBindings")
        .expect("goBindings");

    assert_matches(&emitted.args_rs, &src.join("args.rs"), "go_args");
    assert_matches(
        &emitted.decisions_rs,
        &src.join("decisions.rs"),
        "go_decisions",
    );
    assert_matches(
        &emitted.payload_builders_rs,
        &src.join("payload_builders.rs"),
        "go_payload",
    );
    assert_matches(&emitted.client_rs, &src.join("client.rs"), "go_client");
    assert_matches(&emitted.webhook_rs, &src.join("webhook.rs"), "go_webhook");
}
