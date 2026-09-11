//! Client-less MCP dispatch (`solvapay_call` parity).

use serde_json::{json, Value};
use solvapay_core::SdkError;

use crate::abi::{pack, read_string};
use crate::error::err_envelope;

/// Binding for `solvapay_call` (`{ "op", "args" }`).
///
/// # Safety
///
/// `args_ptr` / `args_len` must describe a valid guest allocation from `sv_alloc`.
#[no_mangle]
pub unsafe extern "C" fn sv_solvapay_call_binding(args_ptr: *mut u8, args_len: usize) -> u64 {
    let args_json = read_string(args_ptr, args_len);
    pack(dispatch(&args_json))
}

fn dispatch(args_json: &str) -> String {
    let parsed: Value = match serde_json::from_str(args_json) {
        Ok(value) => value,
        Err(err) => {
            return err_envelope(&SdkError::transport(
                format!("invalid solvapay_call args: {err}"),
                false,
            ));
        }
    };
    let Some(op) = parsed.get("op").and_then(Value::as_str) else {
        return err_envelope(&SdkError::transport("missing op", false));
    };
    let args = parsed.get("args").cloned().unwrap_or_else(|| json!({}));
    solvapay_mcp_core::dispatch_sync(op, &args.to_string())
}
