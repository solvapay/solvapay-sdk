//! Emit `sdks/python/tests/contract/*.py` from IR plus chrome.

use crate::emit_conformance_chrome::{
    assert_host_fns, emit_chrome_files, load_snapshot, now_ms_blocks, HOST_FNS,
};
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::Ir;

const SNAPSHOT: &str = include_str!("../assets/conformance-py-emit.snapshot.json");

const FILE_ORDER: &[&str] = &[
    "__init__.py",
    "clock.py",
    "names.py",
    "fixture_loader.py",
    "compare.py",
    "stub_backend.py",
    "host_adapters.py",
    "dispatch.py",
];

/// Generated Python conformance-harness files (`relative path`, contents).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the embedded chrome snapshot is missing a
/// required field or placeholder.
pub fn emit_conformance_py(ir: &Ir) -> GenResult<Vec<(String, String)>> {
    assert_host_fns(&load_snapshot(SNAPSHOT, "conformance-py-emit snapshot")?)?;
    let host_fns_inner = HOST_FNS
        .iter()
        .map(|id| format!("        \"{id}\","))
        .collect::<Vec<_>>()
        .join("\n");
    let now_ms = now_ms_blocks(ir, |sym| {
        let py = &sym.names.py;
        let id = &sym.id;
        format!(
            "    if snake == \"{py}\":\n        clock = fixture.input.clock\n        if clock is None:\n            raise ValueError(\"input.clock is required for {id}\")\n        args[\"nowMs\"] = parse_iso8601_utc_to_unix_ms(clock)\n"
        )
    });
    emit_chrome_files(
        SNAPSHOT,
        "conformance-py-emit snapshot",
        &format!(
            "{}\n",
            generated_header(CommentStyle::Hash, "py-conformance-out")
        ),
        FILE_ORDER,
        &[
            ("host_adapters.py", "{{HOST_FNS}}", &host_fns_inner),
            ("dispatch.py", "{{NOW_MS_INJECTION}}", &now_ms),
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
