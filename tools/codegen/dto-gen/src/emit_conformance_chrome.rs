//! Shared chrome plumbing for Python/Ruby fixture-conformance emitters.

use serde_json::Value;

use crate::error::{GenError, GenResult};
use crate::ir::{Ir, IrBindingArg, IrBindingSymbol};

pub(crate) use crate::chrome::{chrome_str, load_snapshot};

/// Fixture-runner extras dispatched via each language’s host-adapter table.
///
/// `constructSdkError` is handled in dispatch instead.
pub const HOST_FNS: &[&str] = &[
    "withRetry",
    "pollBalanceUntilIncreased",
    "TOPUP_BALANCE_POLL_DELAYS_MS",
    "BALANCE_RECONCILE_DELAYS_MS",
    "resolveAuthenticatedUser",
];

/// Require `snapshot.hostFns` to equal [`HOST_FNS`] (order-sensitive).
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the key is missing or disagrees.
pub fn assert_host_fns(snapshot: &Value) -> GenResult<()> {
    let actual = snapshot
        .get("hostFns")
        .and_then(Value::as_array)
        .ok_or_else(|| GenError::Parse("snapshot missing hostFns".into()))?;
    let actual: Vec<&str> = actual.iter().filter_map(Value::as_str).collect();
    if actual.len() != HOST_FNS.len() || actual.iter().zip(HOST_FNS).any(|(a, b)| a != b) {
        return Err(GenError::Parse(format!(
            "snapshot.hostFns {actual:?} disagrees with HOST_FNS {HOST_FNS:?}"
        )));
    }
    Ok(())
}

/// Binding symbols whose args include a host-injected `nowMs`, sorted by emit order.
fn now_ms_symbols(ir: &Ir) -> Vec<&IrBindingSymbol> {
    let mut symbols: Vec<&IrBindingSymbol> = ir
        .binding_symbols
        .values()
        .filter(|sym| sym.args.iter().any(is_now_ms_host_arg))
        .collect();
    symbols.sort_by(|a, b| a.emit_order.cmp(&b.emit_order).then(a.id.cmp(&b.id)));
    symbols
}

/// Render `nowMs` injection blocks via `format_block`.
pub fn now_ms_blocks(ir: &Ir, format_block: impl Fn(&IrBindingSymbol) -> String) -> String {
    now_ms_symbols(ir).into_iter().map(format_block).collect()
}

/// Substitute per-file tokens into chrome file bodies.
///
/// `replacements` is `(file, token, value)` — each listed token must appear in
/// that file's chrome body.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the snapshot is missing a file, string, or placeholder.
pub fn emit_chrome_files(
    snapshot_raw: &str,
    snapshot_label: &str,
    header: &str,
    file_order: &[&str],
    replacements: &[(&str, &str, &str)],
) -> GenResult<Vec<(String, String)>> {
    let chrome = load_snapshot(snapshot_raw, snapshot_label)?;
    if chrome.get("header").is_some() {
        return Err(GenError::Parse(format!(
            "{snapshot_label} must not embed a header — banners come from generated_header"
        )));
    }
    let files = chrome
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| GenError::Parse("snapshot missing files".into()))?;

    let mut out = Vec::with_capacity(file_order.len());
    for name in file_order {
        let file = files
            .get(*name)
            .ok_or_else(|| GenError::Parse(format!("snapshot missing files.{name}")))?;
        let mut body = chrome_str(file, &["body"], snapshot_label)?.to_owned();
        for (file_name, token, value) in replacements {
            if *file_name != *name {
                continue;
            }
            if !body.contains(token) {
                return Err(GenError::Parse(format!("{name} chrome missing {token}")));
            }
            body = body.replace(token, value);
        }
        out.push(((*name).to_owned(), format!("{header}{body}")));
    }
    Ok(out)
}

fn is_now_ms_host_arg(arg: &IrBindingArg) -> bool {
    arg.host_injected && arg.name == "nowMs"
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn emit_chrome_files_rejects_embedded_header() {
        let raw = r#"{"header":"x","files":{"a.py":{"body":"print(1)\n"}}}"#;
        let err = emit_chrome_files(raw, "test-snapshot", "# hdr\n", &["a.py"], &[])
            .expect_err("header must fail");
        assert!(err.to_string().contains("must not embed a header"), "{err}");
    }
}
