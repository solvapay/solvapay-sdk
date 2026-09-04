//! Golden test: emitted Magnus Step 44 shims match all committed generated files.
//!
//! Lowers the real contract manifest into IR, emits `Toolchain::Ruby`, runs
//! the emitted string through `rustfmt` exactly like `dto-gen` does on write,
//! and compares against the committed file after stripping the leading `//!`
//! module-doc block (the only sanctioned diff is the `@generated` header).
//!
//! Also asserts the hello-world allowlist: `fn get_merchant` present and the
//! other 35 Groups A–C methods absent.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;
use std::path::Path;

use dto_gen::emit_bindings_rs::{emit_bindings, Toolchain};
use dto_gen::ir::{Ir, IrBindingArtifact};

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

fn names_for(ir: &Ir, artifact: IrBindingArtifact) -> Vec<String> {
    let mut names: Vec<(u32, String)> = ir
        .binding_symbols
        .values()
        .filter(|s| s.artifact == artifact)
        .map(|s| (s.emit_order, s.names.rb.clone()))
        .collect();
    names.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    names.into_iter().map(|(_, n)| n).collect()
}

#[test]
fn ruby_full_surface_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::Ruby).expect("emit ruby");
    let src = support::paths()
        .generated_path("rubyBindings")
        .expect("rubyBindings");

    let client_names = names_for(&ir, IrBindingArtifact::Client);
    assert_eq!(client_names.len(), 43);
    for name in &client_names {
        assert!(
            emitted.client_rs.contains(&format!("fn {name}")),
            "missing Ruby client fn {name}"
        );
    }

    let decisions = names_for(&ir, IrBindingArtifact::Decisions);
    let payloads = names_for(&ir, IrBindingArtifact::PayloadBuilders);
    assert_eq!(decisions.len(), 66);
    assert_eq!(payloads.len(), 34);
    assert!(emitted.args_rs.contains("fn args_map"));
    for name in decisions.iter().chain(payloads.iter()) {
        assert!(
            emitted.register_rs.contains(&format!("\"{name}\"")),
            "registration missing {name}"
        );
    }
    assert!(emitted.client_rs.matches("without_gvl_envelope(||").count() >= 36);

    assert_matches(&emitted.args_rs, &src.join("args.rs"), "ruby_args");
    assert_matches(
        &emitted.decisions_rs,
        &src.join("decisions.rs"),
        "ruby_decisions",
    );
    assert_matches(
        &emitted.payload_builders_rs,
        &src.join("payload_builders.rs"),
        "ruby_payload_builders",
    );
    assert_matches(&emitted.client_rs, &src.join("client.rs"), "ruby_client");
    assert_matches(
        &emitted.register_rs,
        &src.join("register.rs"),
        "ruby_register",
    );
}
