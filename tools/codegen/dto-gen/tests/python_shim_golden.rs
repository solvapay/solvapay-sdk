//! Golden test: emitted PyO3 shims must match committed files once headers are
//! normalized (Step 41-a/b — full client + decisions + payload builders + args).
//!
//! Lowers the real contract manifest into IR, emits `Toolchain::Python`, runs
//! the emitted strings through `rustfmt` exactly like `dto-gen` does on write,
//! and compares against the committed files after stripping the leading `//!`
//! module-doc block (the only sanctioned diff is the `@generated` header).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;
use std::path::Path;

use dto_gen::emit_bindings_rs::{emit_bindings, Toolchain};
use dto_gen::ir::{Ir, IrBindingArtifact, IrErrorTemplates};







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
        .map(|s| (s.emit_order, s.names.py.clone()))
        .collect();
    names.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    names.into_iter().map(|(_, n)| n).collect()
}

#[test]
fn python_full_surface_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_bindings(&ir, Toolchain::Python).expect("emit python");
    let src = support::paths()
        .generated_path("pythonBindings")
        .expect("pythonBindings");

    let client_names = names_for(&ir, IrBindingArtifact::Client);
    assert_eq!(client_names.len(), 36);
    for name in &client_names {
        assert!(
            emitted.client_rs.contains(&format!("fn {name}")),
            "missing async method fn {name}"
        );
        let blocking = format!("{name}_blocking");
        assert!(
            emitted.client_rs.contains(&format!("fn {blocking}")),
            "missing blocking twin fn {blocking}"
        );
    }

    let decision_names = names_for(&ir, IrBindingArtifact::Decisions);
    assert_eq!(decision_names.len(), 45);
    for name in &decision_names {
        assert!(
            emitted
                .decisions_rs
                .contains(&format!("pyfunction(name = \"{name}\")")),
            "decisions.rs missing #[pyfunction(name = \"{name}\")]"
        );
        assert!(
            emitted.register_rs.contains("wrap_pyfunction!"),
            "register.rs must wire pyfunctions"
        );
    }

    let payload_names = names_for(&ir, IrBindingArtifact::PayloadBuilders);
    assert_eq!(payload_names.len(), 23);
    for name in &payload_names {
        assert!(
            emitted
                .payload_builders_rs
                .contains(&format!("pyfunction(name = \"{name}\")")),
            "payload_builders.rs missing #[pyfunction(name = \"{name}\")]"
        );
    }

    assert!(emitted.args_rs.contains("fn args_map"));
    assert!(emitted.args_rs.contains("fn require_string"));
    assert!(emitted.register_rs.contains("fn register_generated"));

    assert_matches(&emitted.args_rs, &src.join("args.rs"), "python_args");
    assert_matches(
        &emitted.decisions_rs,
        &src.join("decisions.rs"),
        "python_decisions",
    );
    assert_matches(
        &emitted.payload_builders_rs,
        &src.join("payload_builders.rs"),
        "python_payload_builders",
    );
    assert_matches(&emitted.client_rs, &src.join("client.rs"), "python_client");
    assert_matches(
        &emitted.register_rs,
        &src.join("register.rs"),
        "python_register",
    );
}
