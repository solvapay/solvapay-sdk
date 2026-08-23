//! Emit `sdks/ruby/test/contract/*.rb` from IR plus chrome.

use crate::emit_conformance_chrome::{
    assert_host_fns, emit_chrome_files, load_snapshot, now_ms_blocks, HOST_FNS,
};
use crate::error::GenResult;
use crate::ir::Ir;

const SNAPSHOT: &str = include_str!("../assets/conformance-rb-emit.snapshot.json");

const FILE_ORDER: &[&str] = &[
    "clock.rb",
    "names.rb",
    "fixture_loader.rb",
    "compare.rb",
    "stub_backend.rb",
    "host_adapters.rb",
    "dispatch.rb",
];

/// Generated Ruby conformance-harness files (`relative path`, contents).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing a
/// required field or placeholder.
pub fn emit_conformance_rb(ir: &Ir) -> GenResult<Vec<(String, String)>> {
    assert_host_fns(&load_snapshot(SNAPSHOT, "conformance-rb-emit snapshot")?)?;
    let host_fns_inner = HOST_FNS
        .iter()
        .map(|id| format!("      {id}"))
        .collect::<Vec<_>>()
        .join("\n");
    let now_ms = now_ms_blocks(ir, |sym| {
        let rb = &sym.names.rb;
        format!(
            "      if name == \"{rb}\"\n        args[\"nowMs\"] = Clock.unix_ms(fixture.fetch(\"input\").fetch(\"clock\"))\n      end\n"
        )
    });
    emit_chrome_files(
        SNAPSHOT,
        "conformance-rb-emit snapshot",
        FILE_ORDER,
        &[
            ("host_adapters.rb", "{{HOST_FNS}}", &host_fns_inner),
            ("dispatch.rb", "{{NOW_MS_INJECTION}}", &now_ms),
        ],
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn snapshot_declares_every_emitted_file() {
        let chrome: Value = serde_json::from_str(SNAPSHOT).unwrap();
        let files = chrome.get("files").and_then(Value::as_object).unwrap();
        for name in FILE_ORDER {
            assert!(files.contains_key(*name), "missing {name}");
        }
    }
}
