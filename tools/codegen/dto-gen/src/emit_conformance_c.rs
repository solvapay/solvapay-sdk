//! Emit `sdks/capi/ctest/contract/*.{c,h}` from IR plus chrome.

use crate::emit_conformance_chrome::emit_chrome_files;
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArtifact};

const SNAPSHOT: &str = include_str!("../assets/conformance-c-emit.snapshot.json");

const FILE_ORDER: &[&str] = &["dispatch.c", "dispatch.h", "harness.c", "harness.h"];

/// Generated C conformance-harness files (`relative path`, contents).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing a
/// required field or placeholder.
pub fn emit_conformance_c(ir: &Ir) -> GenResult<Vec<(String, String)>> {
    let client_ops = client_ops_inner(ir);
    emit_chrome_files(
        SNAPSHOT,
        "conformance-c-emit snapshot",
        &format!("{}\n", generated_header(CommentStyle::CBlock, "c-conformance-out")),
        FILE_ORDER,
        &[("dispatch.c", "{{CLIENT_OPS}}", &client_ops)],
    )
}

fn client_ops_inner(ir: &Ir) -> String {
    let mut symbols: Vec<_> = ir
        .binding_symbols
        .values()
        .filter(|sym| matches!(sym.artifact, IrBindingArtifact::Client))
        .collect();
    symbols.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    symbols
        .into_iter()
        .map(|sym| format!("  \"{}\",", sym.id))
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
        assert!(chrome.get("header").is_none(), "banners must not live in the snapshot");
        let files = chrome.get("files").and_then(Value::as_object).unwrap();
        for name in FILE_ORDER {
            assert!(files.contains_key(*name), "missing {name}");
        }
    }
}
