//! Shared chrome plumbing for Python/Ruby fixture-conformance emitters.

use serde_json::Value;

use crate::error::{GenError, GenResult};
use crate::ir::{Ir, IrBindingArg, IrBindingSymbol};

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

/// Parse an embedded chrome snapshot and fail loudly on invalid JSON.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when `raw` is not JSON.
pub fn load_snapshot(raw: &str, label: &str) -> GenResult<Value> {
    serde_json::from_str(raw).map_err(|e| GenError::Parse(format!("invalid {label}: {e}")))
}

/// Walk `path` on a JSON object and require a string leaf.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a key is missing or the leaf is not a string.
pub fn chrome_str<'a>(art: &'a Value, path: &[&str], label: &str) -> GenResult<&'a str> {
    let mut cur = art;
    for key in path {
        cur = cur
            .get(*key)
            .ok_or_else(|| GenError::Parse(format!("{label} missing {}", path.join("."))))?;
    }
    cur.as_str()
        .ok_or_else(|| GenError::Parse(format!("{label} {} is not a string", path.join("."))))
}

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
    file_order: &[&str],
    replacements: &[(&str, &str, &str)],
) -> GenResult<Vec<(String, String)>> {
    let chrome = load_snapshot(snapshot_raw, snapshot_label)?;
    let header = chrome_str(&chrome, &["header"], snapshot_label)?;
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
