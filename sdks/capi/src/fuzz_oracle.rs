//! Model-based C ABI handle-misuse oracle (step 55-a).

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::HashMap;
use std::ffi::CString;
use std::os::raw::c_char;
use std::ptr;

use solvapay_core::fuzz_oracle::{check_envelope_output, OracleViolation};
use solvapay_core::SdkError;
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient, Transport};

use crate::dispatch::dispatch;
use crate::{
    solvapay_client_call, solvapay_client_free, solvapay_client_new, solvapay_free_string,
    SolvapayClient, SolvapayStatus,
};

const MAX_FIELD_BYTES: usize = 1_048_576;
const MAX_OPS: usize = 64;

/// One step in a handle-misuse sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandleOp {
    /// `solvapay_client_new` with JSON config.
    New {
        /// Config JSON (`apiKey` required).
        config_json: String,
    },
    /// `solvapay_client_new(NULL, &out)`.
    NewNullConfig,
    /// `solvapay_client_new(config, NULL)`.
    NewNullOut,
    /// `solvapay_client_call` on a previously created slot.
    Call {
        /// Index into the sequence's handle table.
        slot: u32,
        /// Operation name.
        op: String,
        /// Args JSON.
        args: String,
    },
    /// `solvapay_client_call(NULL, op, args)`.
    CallNullHandle {
        /// Operation name.
        op: String,
        /// Args JSON.
        args: String,
    },
    /// `solvapay_client_free` on a slot (idempotent if already freed).
    Free {
        /// Index into the sequence's handle table.
        slot: u32,
    },
    /// `solvapay_free_string` on a previously returned string.
    FreeString {
        /// Index into the sequence's string table.
        slot: u32,
    },
    /// `solvapay_client_call` with a raw packed integer as the handle.
    UseRaw {
        /// Packed handle bits.
        raw: u64,
    },
}

/// Length-prefixed encoding of a [`HandleOp`] sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandleSequence {
    /// Ordered operations.
    pub ops: Vec<HandleOp>,
}

/// Checks FFI JSON dispatch via the real C `dispatch` (dummy transport).
pub fn check_c_dispatch_envelope(op: &str, args_json: &str) -> Result<(), OracleViolation> {
    let client = dummy_client();
    solvapay_core::fuzz_oracle::check_envelope_invariants_with(op, args_json, |op, args| {
        dispatch(&client, op, args)
    })
}

/// Runs `ops` against the real `extern "C"` ABI plus a shadow live-handle map.
pub fn check_handle_sequence(seq: &HandleSequence) -> Result<(), OracleViolation> {
    let mut live: Vec<HandleSlot> = Vec::new();
    let mut strings: Vec<*mut c_char> = Vec::new();
    let mut shadow_live: HashMap<usize, bool> = HashMap::new();

    for op in &seq.ops {
        match op {
            HandleOp::New { config_json } => {
                let Ok(c_config) = CString::new(config_json.as_str()) else {
                    continue;
                };
                let mut out: *mut SolvapayClient = ptr::null_mut();
                let status = unsafe { solvapay_client_new(c_config.as_ptr(), &mut out) };
                reject_if_panic(status)?;
                let idx = live.len();
                if status == SolvapayStatus::Ok && !out.is_null() {
                    live.push(HandleSlot {
                        ptr: out,
                        live: true,
                    });
                    shadow_live.insert(idx, true);
                } else {
                    live.push(HandleSlot {
                        ptr: out,
                        live: false,
                    });
                    shadow_live.insert(idx, false);
                }
            }
            HandleOp::NewNullConfig => {
                let mut out: *mut SolvapayClient = ptr::null_mut();
                let status = unsafe { solvapay_client_new(ptr::null(), &mut out) };
                reject_if_panic(status)?;
                if status != SolvapayStatus::NullArgument {
                    return Err(OracleViolation::MalformedEnvelope(
                        "null config must be NullArgument".to_owned(),
                    ));
                }
            }
            HandleOp::NewNullOut => {
                let Ok(c_config) = CString::new("{\"apiKey\":\"sk\"}") else {
                    continue;
                };
                let status = unsafe { solvapay_client_new(c_config.as_ptr(), ptr::null_mut()) };
                reject_if_panic(status)?;
                if status != SolvapayStatus::NullArgument {
                    return Err(OracleViolation::MalformedEnvelope(
                        "null out must be NullArgument".to_owned(),
                    ));
                }
            }
            HandleOp::Call { slot, op, args } => {
                let handle = slot_ptr(&live, *slot);
                let envelope = call_raw(handle, op, args)?;
                check_envelope_output(&envelope)?;
                if !slot_is_live(&live, *slot) {
                    assert_invalid_handle_envelope(&envelope)?;
                }
            }
            HandleOp::CallNullHandle { op, args } => {
                let envelope = call_raw(ptr::null_mut(), op, args)?;
                check_envelope_output(&envelope)?;
                assert_invalid_handle_envelope(&envelope)?;
            }
            HandleOp::Free { slot } => {
                let handle = slot_ptr(&live, *slot);
                unsafe {
                    solvapay_client_free(handle);
                    solvapay_client_free(handle);
                }
                if let Some(entry) = live.get_mut(*slot as usize) {
                    entry.live = false;
                }
                shadow_live.insert(*slot as usize, false);
            }
            HandleOp::FreeString { slot } => {
                let idx = *slot as usize;
                if idx < strings.len() {
                    unsafe {
                        solvapay_free_string(strings[idx]);
                    }
                    strings[idx] = ptr::null_mut();
                }
            }
            HandleOp::UseRaw { raw } => {
                let handle = *raw as *mut SolvapayClient;
                let envelope = call_raw(handle, "getMerchant", "{}")?;
                check_envelope_output(&envelope)?;
                assert_invalid_handle_envelope(&envelope)?;
            }
        }
    }

    for s in strings {
        if !s.is_null() {
            unsafe {
                solvapay_free_string(s);
            }
        }
    }
    for entry in live {
        if entry.live && !entry.ptr.is_null() {
            unsafe {
                solvapay_client_free(entry.ptr);
            }
        }
    }
    let _ = shadow_live;
    Ok(())
}

/// Encodes a handle sequence as corpus bytes.
impl HandleSequence {
    /// Length-prefixed encoding.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let n = self.ops.len().min(MAX_OPS);
        let count = u32::try_from(n).unwrap_or(0);
        buf.extend_from_slice(&count.to_le_bytes());
        for op in self.ops.iter().take(n) {
            encode_op(&mut buf, op);
        }
        buf
    }

    /// Decodes length-prefixed corpus bytes.
    pub fn decode(data: &[u8]) -> Option<Self> {
        let mut rest = data;
        if rest.len() < 4 {
            return None;
        }
        let mut count_bytes = [0u8; 4];
        count_bytes.copy_from_slice(&rest[..4]);
        rest = &rest[4..];
        let count = u32::from_le_bytes(count_bytes) as usize;
        if count > MAX_OPS {
            return None;
        }
        let mut ops = Vec::new();
        for _ in 0..count {
            ops.push(decode_op(&mut rest)?);
        }
        Some(Self { ops })
    }
}

/// One slot in the sequence's handle table.
struct HandleSlot {
    /// Packed ABI handle (may be stale after free).
    ptr: *mut SolvapayClient,
    /// Whether the slot is still live in the shadow model.
    live: bool,
}

fn dummy_client() -> SolvaPayClient {
    let transport: SharedTransport = std::sync::Arc::new(NoopTransport);
    SolvaPayClient::new(ClientShell::new(transport, "sk_test"))
}

/// Transport that always fails, so dispatch never needs a network.
struct NoopTransport;

impl Transport for NoopTransport {
    fn send(
        &self,
        _request: solvapay_transport::HttpRequest,
    ) -> solvapay_transport::BoxFuture<'_, Result<solvapay_transport::HttpResponse, SdkError>> {
        Box::pin(async { Err(SdkError::transport("noop", false)) })
    }
}

fn reject_if_panic(status: SolvapayStatus) -> Result<(), OracleViolation> {
    if status == SolvapayStatus::Panic {
        Err(OracleViolation::Panicked(
            "SolvapayStatus::Panic observed".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn slot_ptr(live: &[HandleSlot], slot: u32) -> *mut SolvapayClient {
    live.get(slot as usize)
        .map(|s| s.ptr)
        .unwrap_or(ptr::null_mut())
}

fn slot_is_live(live: &[HandleSlot], slot: u32) -> bool {
    live.get(slot as usize).is_some_and(|s| s.live)
}

fn call_raw(handle: *mut SolvapayClient, op: &str, args: &str) -> Result<String, OracleViolation> {
    let Ok(c_op) = CString::new(op) else {
        return Ok(solvapay_core::err_envelope(&SdkError::transport(
            "op contained interior NUL",
            false,
        )));
    };
    let Ok(c_args) = CString::new(args) else {
        return Ok(solvapay_core::err_envelope(&SdkError::transport(
            "args contained interior NUL",
            false,
        )));
    };
    let ptr = unsafe { solvapay_client_call(handle, c_op.as_ptr(), c_args.as_ptr()) };
    if ptr.is_null() {
        return Err(OracleViolation::MalformedEnvelope(
            "client_call returned null".to_owned(),
        ));
    }
    let owned = match crate::abi::read_c_str(ptr) {
        Some(s) => s.into_owned(),
        None => {
            unsafe {
                solvapay_free_string(ptr);
            }
            return Err(OracleViolation::MalformedEnvelope(
                "client_call string unreadable".to_owned(),
            ));
        }
    };
    unsafe {
        solvapay_free_string(ptr);
    }
    Ok(owned)
}

fn assert_invalid_handle_envelope(envelope: &str) -> Result<(), OracleViolation> {
    let value: serde_json::Value = match serde_json::from_str(envelope) {
        Ok(v) => v,
        Err(_) => {
            return Err(OracleViolation::MalformedEnvelope(
                "invalid-handle envelope is not JSON".to_owned(),
            ));
        }
    };
    let ok = value.get("ok").and_then(serde_json::Value::as_bool);
    let kind = value
        .get("error")
        .and_then(|e| e.get("kind"))
        .and_then(serde_json::Value::as_str);
    if ok != Some(false) || kind != Some("Transport") {
        return Err(OracleViolation::MalformedEnvelope(
            "freed/unknown handle must be Transport error envelope".to_owned(),
        ));
    }
    Ok(())
}

fn encode_op(buf: &mut Vec<u8>, op: &HandleOp) {
    match op {
        HandleOp::New { config_json } => {
            buf.push(0);
            put_str(buf, config_json);
        }
        HandleOp::NewNullConfig => buf.push(1),
        HandleOp::NewNullOut => buf.push(2),
        HandleOp::Call { slot, op, args } => {
            buf.push(3);
            buf.extend_from_slice(&slot.to_le_bytes());
            put_str(buf, op);
            put_str(buf, args);
        }
        HandleOp::CallNullHandle { op, args } => {
            buf.push(4);
            put_str(buf, op);
            put_str(buf, args);
        }
        HandleOp::Free { slot } => {
            buf.push(5);
            buf.extend_from_slice(&slot.to_le_bytes());
        }
        HandleOp::FreeString { slot } => {
            buf.push(6);
            buf.extend_from_slice(&slot.to_le_bytes());
        }
        HandleOp::UseRaw { raw } => {
            buf.push(7);
            buf.extend_from_slice(&raw.to_le_bytes());
        }
    }
}

fn decode_op(rest: &mut &[u8]) -> Option<HandleOp> {
    if rest.is_empty() {
        return None;
    }
    let tag = rest[0];
    *rest = &rest[1..];
    match tag {
        0 => Some(HandleOp::New {
            config_json: take_str(rest)?,
        }),
        1 => Some(HandleOp::NewNullConfig),
        2 => Some(HandleOp::NewNullOut),
        3 => {
            if rest.len() < 4 {
                return None;
            }
            let mut slot_bytes = [0u8; 4];
            slot_bytes.copy_from_slice(&rest[..4]);
            *rest = &rest[4..];
            let slot = u32::from_le_bytes(slot_bytes);
            let op = take_str(rest)?;
            let args = take_str(rest)?;
            Some(HandleOp::Call { slot, op, args })
        }
        4 => {
            let op = take_str(rest)?;
            let args = take_str(rest)?;
            Some(HandleOp::CallNullHandle { op, args })
        }
        5 => Some(HandleOp::Free {
            slot: take_u32(rest)?,
        }),
        6 => Some(HandleOp::FreeString {
            slot: take_u32(rest)?,
        }),
        7 => {
            if rest.len() < 8 {
                return None;
            }
            let mut raw_bytes = [0u8; 8];
            raw_bytes.copy_from_slice(&rest[..8]);
            *rest = &rest[8..];
            Some(HandleOp::UseRaw {
                raw: u64::from_le_bytes(raw_bytes),
            })
        }
        _ => None,
    }
}

fn take_u32(rest: &mut &[u8]) -> Option<u32> {
    if rest.len() < 4 {
        return None;
    }
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(&rest[..4]);
    *rest = &rest[4..];
    Some(u32::from_le_bytes(bytes))
}

fn put_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let n = bytes.len().min(MAX_FIELD_BYTES);
    let len = u32::try_from(n).unwrap_or(0);
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(&bytes[..n]);
}

fn take_str(rest: &mut &[u8]) -> Option<String> {
    if rest.len() < 4 {
        return None;
    }
    let mut len_bytes = [0u8; 4];
    len_bytes.copy_from_slice(&rest[..4]);
    let len = usize::try_from(u32::from_le_bytes(len_bytes)).unwrap_or(usize::MAX);
    if len > MAX_FIELD_BYTES {
        return None;
    }
    *rest = &rest[4..];
    if rest.len() < len {
        return None;
    }
    let bytes = &rest[..len];
    *rest = &rest[len..];
    Some(String::from_utf8_lossy(bytes).into_owned())
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;

    #[test]
    fn panic_status_is_a_violation() {
        let err = reject_if_panic(SolvapayStatus::Panic).unwrap_err();
        assert!(matches!(err, OracleViolation::Panicked(_)));
    }

    #[test]
    fn double_free_and_null_handle_are_safe() {
        let seq = HandleSequence {
            ops: vec![
                HandleOp::New {
                    config_json: r#"{"apiKey":"sk_test"}"#.to_owned(),
                },
                HandleOp::Free { slot: 0 },
                HandleOp::Call {
                    slot: 0,
                    op: "getMerchant".to_owned(),
                    args: "{}".to_owned(),
                },
                HandleOp::CallNullHandle {
                    op: "getMerchant".to_owned(),
                    args: "{}".to_owned(),
                },
                HandleOp::NewNullConfig,
                HandleOp::NewNullOut,
                HandleOp::UseRaw { raw: 0xDEAD_BEEF },
            ],
        };
        check_handle_sequence(&seq).expect("misuse must not panic");
        let round = HandleSequence::decode(&seq.encode()).expect("round trip");
        assert_eq!(round, seq);
    }

    #[test]
    fn unknown_op_dispatch_is_transport() {
        check_c_dispatch_envelope("noSuchOp", "{}").expect("unknown op");
    }
}
