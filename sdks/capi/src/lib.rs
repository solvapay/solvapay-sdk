//! `solvapay-c`: optional in-repo native C ABI for SolvaPay (`publish = false`).
//!
//! Surface: opaque generation-counted client handles + generic JSON-envelope
//! dispatch (`solvapay_client_call`) + sync `solvapay_verify_webhook` /
//! `solvapay_version` / `solvapay_abi_version`. Every FFI edge uses
//! `catch_unwind` (§7.6). Full 42-op client dispatch is generated
//! (`Toolchain::C`). `ctest/smoke.c` stays single-op; full fixture replay is
//! `ctest/contract.sh`.

#![allow(clippy::result_large_err)]

mod abi;
mod dispatch;
mod error;
#[cfg(feature = "fixture-host")]
mod fixture_host;
pub mod fuzz_oracle;
mod handle;
mod runtime;

use std::os::raw::c_char;
use std::panic::AssertUnwindSafe;
use std::ptr;
use std::sync::Arc;

use serde::Deserialize;
use solvapay_core::{verify_webhook as core_verify_webhook, SdkError};
use solvapay_transport::{ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient};

use crate::abi::{free_c_string, into_c_string, read_c_str};
use crate::error::{
    envelope_from_panic_payload, err_envelope, internal_error_envelope, parse_args_json,
    run_envelope_sync,
};

/// ABI version stamped into the cbindgen header as `SOLVAPAY_ABI_VERSION`.
pub const SOLVAPAY_ABI_VERSION: u32 = 2;

/// Opaque client handle for the C ABI (never dereferenced as a Rust pointer).
#[repr(C)]
pub struct SolvapayClient {
    /// Zero-sized private marker — real clients live in the handle registry.
    _private: [u8; 0],
}

/// Non-envelope status codes for `solvapay_client_new` and similar edges.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SolvapayStatus {
    /// Success.
    Ok = 0,
    /// A required C-string or out-pointer argument was null.
    NullArgument = 1,
    /// Handle is null, garbage, or already freed (generation mismatch).
    InvalidHandle = 2,
    /// Panic caught at the FFI boundary, or registry failure.
    Panic = 3,
}

/// JSON config for [`solvapay_client_new`]: `{"apiKey","apiBaseUrl?"}`.
#[derive(Debug, Deserialize)]
struct ClientConfig {
    /// Bearer token.
    #[serde(rename = "apiKey")]
    api_key: String,
    /// Optional API origin override.
    #[serde(rename = "apiBaseUrl")]
    api_base_url: Option<String>,
}

/// JSON args for [`solvapay_verify_webhook`].
#[derive(Debug, Deserialize)]
struct VerifyWebhookArgs {
    /// Raw request body string.
    body: String,
    /// `SV-Signature` header value.
    signature: String,
    /// Webhook secret including the `whsec_` prefix.
    secret: String,
    /// Host clock as unix seconds.
    #[serde(rename = "nowUnixSecs")]
    now_unix_secs: i64,
}

/// Builds a [`SolvaPayClient`] from JSON config `{"apiKey","apiBaseUrl?"}`.
fn build_client_from_config(config_json: &str) -> Result<SolvaPayClient, SdkError> {
    let config: ClientConfig = parse_args_json(config_json)?;
    let transport = ReqwestTransport::new()?;
    let transport: SharedTransport = Arc::new(transport);
    let mut shell = ClientShell::new(transport, config.api_key);
    if let Some(base) = config.api_base_url {
        shell = shell.with_base_url(base);
    }
    Ok(SolvaPayClient::new(shell))
}

/// Returns the C ABI version (`SOLVAPAY_ABI_VERSION`).
#[no_mangle]
pub extern "C" fn solvapay_abi_version() -> u32 {
    std::panic::catch_unwind(|| SOLVAPAY_ABI_VERSION).unwrap_or_default()
}

/// Returns the crate version string. Caller must free with [`solvapay_free_string`].
#[no_mangle]
pub extern "C" fn solvapay_version() -> *mut c_char {
    match std::panic::catch_unwind(|| into_c_string(env!("CARGO_PKG_VERSION").to_owned())) {
        Ok(ptr) => ptr,
        Err(_) => ptr::null_mut(),
    }
}

/// Creates a client from JSON config. On success writes the opaque handle to `out`.
///
/// # Safety
///
/// `config_json` must be a valid NUL-terminated C string (or null → [`SolvapayStatus::NullArgument`]).
/// `out` must be a valid writable pointer (or null → [`SolvapayStatus::NullArgument`]).
#[no_mangle]
pub unsafe extern "C" fn solvapay_client_new(
    config_json: *const c_char,
    out: *mut *mut SolvapayClient,
) -> SolvapayStatus {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        if out.is_null() {
            return SolvapayStatus::NullArgument;
        }
        // Safety: null-checked above; caller owns the out slot.
        unsafe {
            *out = ptr::null_mut();
        }
        let Some(config) = read_c_str(config_json) else {
            return SolvapayStatus::NullArgument;
        };
        match build_client_from_config(&config) {
            Ok(client) => match handle::register(client) {
                Ok(h) => {
                    // Safety: out validated non-null above.
                    unsafe {
                        *out = h;
                    }
                    SolvapayStatus::Ok
                }
                Err(status) => status,
            },
            // parse_args_json maps malformed JSON to Transport; that is a bad
            // argument, not an FFI panic. Real transport-init failures stay Panic.
            Err(SdkError::Transport { ref message, .. })
                if message.starts_with("invalid args JSON:") =>
            {
                SolvapayStatus::NullArgument
            }
            Err(SdkError::Transport { .. }) => SolvapayStatus::Panic,
            Err(_) => SolvapayStatus::NullArgument,
        }
    }));
    match result {
        Ok(status) => status,
        Err(_) => SolvapayStatus::Panic,
    }
}

/// Reads `op` + `args_json` C strings into owned UTF-8, or an error envelope.
fn read_op_args(op: *const c_char, args_json: *const c_char) -> Result<(String, String), String> {
    let Some(op_str) = read_c_str(op) else {
        return Err(err_envelope(&SdkError::transport(
            "null op argument",
            false,
        )));
    };
    let Some(args) = read_c_str(args_json) else {
        return Err(err_envelope(&SdkError::transport(
            "null args_json argument",
            false,
        )));
    };
    Ok((op_str.into_owned(), args.into_owned()))
}

/// Generic op dispatch. Always returns a JSON envelope string (caller frees).
///
/// Invalid handles / null args yield an error envelope (never null for those
/// paths when allocation succeeds), so callers parse one shape.
///
/// # Safety
///
/// `op` and `args_json` must be valid NUL-terminated C strings when non-null.
/// `client` must be null or a handle from [`solvapay_client_new`].
#[no_mangle]
pub unsafe extern "C" fn solvapay_client_call(
    client: *mut SolvapayClient,
    op: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let (op_str, args) = match read_op_args(op, args_json) {
            Ok(pair) => pair,
            Err(env) => return into_c_string(env),
        };
        match handle::with_client(client, |c| dispatch::dispatch(c, &op_str, &args)) {
            Ok(envelope) => into_c_string(envelope),
            Err(SolvapayStatus::InvalidHandle) => into_c_string(err_envelope(
                &SdkError::transport("invalid client handle", false),
            )),
            Err(SolvapayStatus::Panic) => {
                into_c_string(internal_error_envelope("client registry failure"))
            }
            Err(other) => into_c_string(err_envelope(&SdkError::transport(
                format!("client_call status: {other:?}"),
                false,
            ))),
        }
    }));
    match result {
        Ok(ptr) => ptr,
        Err(payload) => into_c_string(envelope_from_panic_payload(payload)),
    }
}

/// Client-less sync dispatch (`validateBusinessDetails`, MCP ops, …).
///
/// # Safety
///
/// `op` and `args_json` must be valid NUL-terminated C strings when non-null.
#[no_mangle]
pub unsafe extern "C" fn solvapay_call(op: *const c_char, args_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let (op_str, args) = match read_op_args(op, args_json) {
            Ok(pair) => pair,
            Err(env) => return into_c_string(env),
        };
        into_c_string(solvapay_mcp_core::dispatch_sync(&op_str, &args))
    }));
    match result {
        Ok(ptr) => ptr,
        Err(payload) => into_c_string(envelope_from_panic_payload(payload)),
    }
}

/// Verifies a webhook signature. Returns a JSON envelope (caller frees).
///
/// # Safety
///
/// `args_json` must be a valid NUL-terminated C string when non-null.
#[no_mangle]
pub unsafe extern "C" fn solvapay_verify_webhook(args_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let Some(args) = read_c_str(args_json) else {
            return into_c_string(err_envelope(&SdkError::transport(
                "null args_json argument",
                false,
            )));
        };
        into_c_string(run_envelope_sync(|| {
            let parsed: VerifyWebhookArgs = parse_args_json(&args)?;
            core_verify_webhook(
                &parsed.body,
                &parsed.signature,
                &parsed.secret,
                parsed.now_unix_secs,
            )
            .map_err(SdkError::from)
        }))
    }));
    match result {
        Ok(ptr) => ptr,
        Err(payload) => into_c_string(envelope_from_panic_payload(payload)),
    }
}

/// Frees a client handle. Null / stale handles are no-ops.
///
/// # Safety
///
/// `client` must be null or a handle from [`solvapay_client_new`].
#[no_mangle]
pub unsafe extern "C" fn solvapay_client_free(client: *mut SolvapayClient) {
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
        handle::free(client);
    }));
}

/// Frees a heap string returned by this ABI. Null is a no-op.
///
/// # Safety
///
/// `s` must be null or a pointer returned by an ABI function that transfers string ownership.
#[no_mangle]
pub unsafe extern "C" fn solvapay_free_string(s: *mut c_char) {
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
        // Safety: ABI ownership contract.
        unsafe {
            free_c_string(s);
        }
    }));
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
    use serde_json::{json, Value};
    use std::ffi::CString;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn parse_envelope(ptr: *mut c_char) -> Value {
        assert!(!ptr.is_null());
        let s = read_c_str(ptr).expect("c str").into_owned();
        unsafe {
            solvapay_free_string(ptr);
        }
        serde_json::from_str(&s).expect("envelope json")
    }

    #[test]
    fn abi_version_matches_const() {
        assert_eq!(solvapay_abi_version(), SOLVAPAY_ABI_VERSION);
        assert_eq!(SOLVAPAY_ABI_VERSION, 2);
    }

    #[test]
    fn version_returns_nonempty_string() {
        let ptr = solvapay_version();
        let s = read_c_str(ptr).expect("version").into_owned();
        unsafe {
            solvapay_free_string(ptr);
        }
        assert!(!s.is_empty());
    }

    #[test]
    fn client_round_trip_get_merchant_and_use_after_free() {
        let server = runtime::runtime().block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/v1/sdk/merchant"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "displayName": "Acme Payments",
                    "country": "US"
                })))
                .mount(&server)
                .await;
            server
        });

        let config = CString::new(format!(
            r#"{{"apiKey":"sk_test_123","apiBaseUrl":"{}"}}"#,
            server.uri()
        ))
        .unwrap();
        let mut out: *mut SolvapayClient = ptr::null_mut();
        let status = unsafe { solvapay_client_new(config.as_ptr(), &mut out) };
        assert_eq!(status, SolvapayStatus::Ok);
        assert!(!out.is_null());

        let op = CString::new("getMerchant").unwrap();
        let args = CString::new("{}").unwrap();
        let env = parse_envelope(unsafe { solvapay_client_call(out, op.as_ptr(), args.as_ptr()) });
        assert_eq!(env["ok"], true);
        assert_eq!(env["value"]["displayName"], "Acme Payments");

        unsafe {
            solvapay_client_free(out);
        }

        let after_free =
            parse_envelope(unsafe { solvapay_client_call(out, op.as_ptr(), args.as_ptr()) });
        assert_eq!(after_free["ok"], false);
        assert_eq!(after_free["error"]["kind"], "Transport");
        assert!(after_free["error"]["message"]
            .as_str()
            .unwrap()
            .contains("invalid client handle"));

        let garbage = 0xDEAD_BEEF_u64 as *mut SolvapayClient;
        let misuse =
            parse_envelope(unsafe { solvapay_client_call(garbage, op.as_ptr(), args.as_ptr()) });
        assert_eq!(misuse["ok"], false);
        assert_eq!(misuse["error"]["kind"], "Transport");
    }

    #[test]
    fn client_call_unknown_op_envelope() {
        let config = CString::new(r#"{"apiKey":"sk_test_123"}"#).unwrap();
        let mut out: *mut SolvapayClient = ptr::null_mut();
        assert_eq!(
            unsafe { solvapay_client_new(config.as_ptr(), &mut out) },
            SolvapayStatus::Ok
        );
        let op = CString::new("noSuchOp").unwrap();
        let args = CString::new("{}").unwrap();
        let env = parse_envelope(unsafe { solvapay_client_call(out, op.as_ptr(), args.as_ptr()) });
        assert_eq!(env["ok"], false);
        assert!(env["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unknown op"));
        unsafe {
            solvapay_client_free(out);
        }
    }

    #[test]
    fn solvapay_call_validate_business_details() {
        let op = CString::new("validateBusinessDetails").unwrap();
        let args = CString::new(r#"{"isBusiness":false}"#).unwrap();
        let env = parse_envelope(unsafe { solvapay_call(op.as_ptr(), args.as_ptr()) });
        assert_eq!(env["ok"], true);
    }

    #[test]
    fn solvapay_call_null_op_is_error_envelope() {
        let args = CString::new("{}").unwrap();
        let env = parse_envelope(unsafe { solvapay_call(ptr::null(), args.as_ptr()) });
        assert_eq!(env["ok"], false);
        assert!(env["error"]["message"]
            .as_str()
            .unwrap()
            .contains("null op"));
    }

    #[test]
    fn solvapay_call_unknown_op_is_error_envelope() {
        let op = CString::new("noSuchOp").unwrap();
        let args = CString::new("{}").unwrap();
        let env = parse_envelope(unsafe { solvapay_call(op.as_ptr(), args.as_ptr()) });
        assert_eq!(env["ok"], false);
        assert!(env["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unknown op"));
    }

    #[test]
    fn solvapay_call_null_args_is_error_envelope() {
        let op = CString::new("validateBusinessDetails").unwrap();
        let env = parse_envelope(unsafe { solvapay_call(op.as_ptr(), ptr::null()) });
        assert_eq!(env["ok"], false);
        assert!(env["error"]["message"]
            .as_str()
            .unwrap()
            .contains("null args"));
    }

    #[test]
    fn verify_webhook_missing_signature_envelope() {
        let args =
            CString::new(r#"{"body":"{}","signature":"","secret":"whsec_x","nowUnixSecs":0}"#)
                .unwrap();
        let env = parse_envelope(unsafe { solvapay_verify_webhook(args.as_ptr()) });
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Webhook");
    }

    #[test]
    fn null_args_to_client_new_are_null_argument() {
        let mut out: *mut SolvapayClient = ptr::null_mut();
        assert_eq!(
            unsafe { solvapay_client_new(ptr::null(), &mut out) },
            SolvapayStatus::NullArgument
        );
        let config = CString::new(r#"{"apiKey":"sk"}"#).unwrap();
        assert_eq!(
            unsafe { solvapay_client_new(config.as_ptr(), ptr::null_mut()) },
            SolvapayStatus::NullArgument
        );
        let bad = CString::new("not-json").unwrap();
        let mut out2: *mut SolvapayClient = ptr::null_mut();
        assert_eq!(
            unsafe { solvapay_client_new(bad.as_ptr(), &mut out2) },
            SolvapayStatus::NullArgument
        );
    }
}
