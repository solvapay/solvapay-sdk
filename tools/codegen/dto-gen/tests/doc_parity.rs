//! Cross-language emitted-summary parity. Supersedes `ruby_doc_coverage`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeSet;

use dto_gen::doc_parity::{
    check_doc_parity, collect_failures, load_pending, DocLang, EmittedSurface,
};
use dto_gen::emit_client_rb::emit_client_rb;
use dto_gen::emit_core_wrappers_ts::{emit_core_wrappers_ts, CoreWrapperKind};
use dto_gen::emit_helpers_go::emit_helpers_go;
use dto_gen::emit_helpers_py::emit_helpers_py;
use dto_gen::emit_helpers_rs::emit_helpers_rs;
use dto_gen::emit_mcp::{emit_mcp_go, emit_mcp_py, emit_mcp_rb, emit_mcp_rs, emit_mcp_ts};

fn pending_path() -> std::path::PathBuf {
    support::paths()
        .contract_input("sdkManifest")
        .expect("sdkManifest")
        .parent()
        .expect("manifest dir")
        .join("doc-parity-pending.yaml")
}

fn surfaces(ir: &dto_gen::Ir) -> Vec<EmittedSurface> {
    let ts_core = emit_core_wrappers_ts(ir, CoreWrapperKind::NativeCore).expect("native-core");
    let ts_helpers =
        emit_core_wrappers_ts(ir, CoreWrapperKind::NativeHelpers).expect("native-helpers");
    let ts_decisions =
        emit_core_wrappers_ts(ir, CoreWrapperKind::NativeDecisions).expect("native-decisions");
    let ruby = emit_client_rb(ir).expect("ruby public");
    let py = emit_helpers_py(ir).expect("py helpers");
    let go = emit_helpers_go(ir).expect("go helpers");
    let rust = emit_helpers_rs(ir).expect("rs helpers");
    let ts_mcp = emit_mcp_ts(ir).expect("ts mcp");
    let py_mcp = emit_mcp_py(ir).expect("py mcp");
    let rb_mcp = emit_mcp_rb(ir).expect("rb mcp");
    let go_mcp = emit_mcp_go(ir).expect("go mcp");
    let rs_mcp = emit_mcp_rs(ir).expect("rs mcp");
    vec![
        EmittedSurface {
            lang: DocLang::Ts,
            label: "native-core.ts",
            source: ts_core,
        },
        EmittedSurface {
            lang: DocLang::Ts,
            label: "native-helpers.ts",
            source: ts_helpers,
        },
        EmittedSurface {
            lang: DocLang::Ts,
            label: "native-decisions.ts",
            source: ts_decisions,
        },
        EmittedSurface {
            lang: DocLang::Rb,
            label: "helpers.generated.rb",
            source: ruby.helpers_rb,
        },
        EmittedSurface {
            lang: DocLang::Rb,
            label: "client.rb",
            source: ruby.client_rb,
        },
        EmittedSurface {
            lang: DocLang::Py,
            label: "helpers.generated.py",
            source: py,
        },
        EmittedSurface {
            lang: DocLang::Go,
            label: "helpers_generated.go",
            source: go,
        },
        EmittedSurface {
            lang: DocLang::Rust,
            label: "helpers_generated.rs",
            source: rust,
        },
        EmittedSurface {
            lang: DocLang::Ts,
            label: "native-mcp.generated.ts",
            source: ts_mcp,
        },
        EmittedSurface {
            lang: DocLang::Py,
            label: "_layer2.generated.py",
            source: py_mcp,
        },
        EmittedSurface {
            lang: DocLang::Rb,
            label: "layer2.generated.rb",
            source: rb_mcp,
        },
        EmittedSurface {
            lang: DocLang::Go,
            label: "layer2_generated.go",
            source: go_mcp,
        },
        EmittedSurface {
            lang: DocLang::Rust,
            label: "layer2_generated.rs",
            source: rs_mcp,
        },
    ]
}

fn pending_set() -> BTreeSet<(String, String)> {
    load_pending(&pending_path())
        .expect("pending yaml")
        .into_iter()
        .map(|e| (e.id, e.lang))
        .collect()
}

#[test]
fn emitted_docs_match_contract_summaries() {
    let ir = support::lower_bindings_ir();
    let surfaces = surfaces(&ir);
    check_doc_parity(&ir, &surfaces, &pending_set()).expect("doc parity");
}

#[test]
fn pending_list_only_contains_current_failures() {
    let ir = support::lower_bindings_ir();
    let surfaces = surfaces(&ir);
    let actual: BTreeSet<(String, String)> = collect_failures(&ir, &surfaces)
        .into_iter()
        .map(|f| (f.id, f.lang.as_str().to_string()))
        .collect();
    let pending = load_pending(&pending_path()).expect("pending yaml");
    let mut stale = Vec::new();
    for entry in &pending {
        let key = (entry.id.clone(), entry.lang.clone());
        if !actual.contains(&key) {
            stale.push(format!("{}.{} (step {})", entry.id, entry.lang, entry.step));
        }
    }
    assert!(
        stale.is_empty(),
        "doc-parity-pending.yaml contains (id, lang) that already pass:\n{}",
        stale.join("\n")
    );
}
