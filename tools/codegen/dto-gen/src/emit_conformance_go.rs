//! Emit `sdks/go/internal/contract/*.go` from IR plus chrome.

use crate::emit_conformance_chrome::{
    assert_host_fns, emit_chrome_files, load_snapshot, now_ms_blocks, HOST_FNS,
};
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArtifact};

const SNAPSHOT: &str = include_str!("../assets/conformance-go-emit.snapshot.json");

const FILE_ORDER: &[&str] = &[
    "clock.go",
    "names.go",
    "fixture_loader.go",
    "compare.go",
    "stub_backend.go",
    "host_adapters.go",
    "dispatch.go",
];

/// Generated Go conformance-harness files (`relative path`, contents).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing a
/// required field or placeholder.
pub fn emit_conformance_go(ir: &Ir) -> GenResult<Vec<(String, String)>> {
    assert_host_fns(&load_snapshot(SNAPSHOT, "conformance-go-emit snapshot")?)?;
    let host_entries: Vec<(String, String)> = HOST_FNS
        .iter()
        .map(|id| ((*id).to_owned(), "{},".to_owned()))
        .collect();
    let host_fns_inner = aligned_go_map_lines(&host_entries);
    let now_ms = now_ms_blocks(ir, |sym| {
        let id = &sym.id;
        format!(
            "\tif fn == \"{id}\" {{\n\t\tclock := fixture.Input.Clock\n\t\tif clock == \"\" {{\n\t\t\treturn Outcome{{}}, fmt.Errorf(\"input.clock is required for {id}\")\n\t\t}}\n\t\tms, err := UnixMs(clock)\n\t\tif err != nil {{\n\t\t\treturn Outcome{{}}, err\n\t\t}}\n\t\targs[\"nowMs\"] = ms\n\t}}\n"
        )
    });
    let sync_exports = sync_exports_inner(ir);
    emit_chrome_files(
        SNAPSHOT,
        "conformance-go-emit snapshot",
        &format!(
            "{}\n",
            generated_header(CommentStyle::Go, "go-conformance-out")
        ),
        FILE_ORDER,
        &[
            ("host_adapters.go", "{{HOST_FNS}}", &host_fns_inner),
            ("dispatch.go", "{{NOW_MS_INJECTION}}", &now_ms),
            ("dispatch.go", "{{SYNC_EXPORTS}}", &sync_exports),
        ],
    )
}

fn sync_exports_inner(ir: &Ir) -> String {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|sym| {
            matches!(
                sym.artifact,
                IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders
            )
        })
        .collect();
    symbols.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    let entries: Vec<(String, String)> = symbols
        .into_iter()
        .map(|sym| (sym.id.clone(), format!("\"sv_{}\",", sym.rust_fn_name)))
        .collect();
    aligned_go_map_lines(&entries)
}

fn aligned_go_map_lines(entries: &[(String, String)]) -> String {
    let width = entries
        .iter()
        .map(|(key, _)| key.len() + 2)
        .max()
        .unwrap_or(0);
    entries
        .iter()
        .map(|(key, value)| {
            let quoted = format!("\"{key}\"");
            let spaces = " ".repeat(1 + width.saturating_sub(quoted.len()));
            format!("\t{quoted}:{spaces}{value}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn snapshot_declares_every_emitted_file() {
        let chrome: Value = serde_json::from_str(SNAPSHOT).unwrap();
        assert!(
            chrome.get("header").is_none(),
            "banners must not live in the snapshot"
        );
        let files = chrome.get("files").and_then(Value::as_object).unwrap();
        for name in FILE_ORDER {
            assert!(files.contains_key(*name), "missing {name}");
        }
    }
}
