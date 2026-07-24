//! Host-import transport: bridges [`Transport`] to `solvapay_host::transport_send`.
//!
//! The guest serializes each [`HttpRequest`] to a small JSON shape both sides
//! share, hands it to the host over linear memory, and parses the JSON response
//! the host writes back. All network I/O happens on the host (Go `net/http`).
//!
//! Wire shapes:
//! - request: `{"method":"GET","url":"…","headers":[["name","value"],…],"body":"…"?}`
//! - response: `{"status":200,"body":"…"}`

use serde::{Deserialize, Serialize};
use solvapay_core::SdkError;
use solvapay_transport::{BoxFuture, HttpRequest, HttpResponse, Transport};

use crate::abi::{read_string, sv_alloc, sv_dealloc};

#[link(wasm_import_module = "solvapay_host")]
extern "C" {
    /// Host import: performs the HTTP request whose JSON is at `req_ptr`/`req_len`
    /// in guest memory and returns a packed `(ptr << 32) | len` handle to the
    /// response JSON (also in guest memory, allocated via `sv_alloc`).
    fn transport_send(req_ptr: u32, req_len: u32) -> u64;
}

/// Serializable mirror of [`HttpRequest`] for the host wire protocol.
#[derive(Serialize)]
struct WireRequest {
    /// Uppercase HTTP verb.
    method: String,
    /// Absolute request URL.
    url: String,
    /// Header name/value pairs (names already lowercased by the shell).
    headers: Vec<[String; 2]>,
    /// Optional UTF-8 body (the SolvaPay API is JSON).
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

/// Deserializable mirror of [`HttpResponse`] from the host wire protocol.
#[derive(Deserialize)]
struct WireResponse {
    /// HTTP status code.
    status: u16,
    /// UTF-8 response body (empty string when the host has no body).
    #[serde(default)]
    body: String,
}

/// [`Transport`] implementation that delegates to the host `transport_send`.
pub struct WasiHostTransport;

impl WasiHostTransport {
    /// Builds a new host-import transport.
    pub fn new() -> Self {
        Self
    }
}

impl Default for WasiHostTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for WasiHostTransport {
    fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
        Box::pin(async move { call_host(&req) })
    }
}

/// Serializes `req`, calls the host, and parses the response (synchronous).
fn call_host(req: &HttpRequest) -> Result<HttpResponse, SdkError> {
    let wire = WireRequest {
        method: req.method.as_str().to_owned(),
        url: req.url.clone(),
        headers: req
            .headers
            .iter()
            .map(|(name, value)| [name.as_str().to_owned(), value.clone()])
            .collect(),
        body: req
            .body
            .as_ref()
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned()),
    };
    let json = serde_json::to_string(&wire)
        .map_err(|err| SdkError::transport(format!("serialize request: {err}"), false))?;
    let bytes = json.into_bytes();
    let req_len = bytes.len();
    if req_len == 0 {
        return Err(SdkError::transport("empty request payload", false));
    }

    // SAFETY: `req_len > 0`; `sv_alloc` returns a valid align-1 buffer.
    let req_ptr = unsafe { sv_alloc(req_len) };
    if req_ptr.is_null() {
        return Err(SdkError::transport("guest allocation failed", false));
    }
    // SAFETY: `req_ptr` addresses `req_len` fresh bytes disjoint from `bytes`.
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), req_ptr, req_len);
    }

    // SAFETY: FFI to the host; the request buffer stays valid for the call and
    // is freed immediately after. Casts are lossless on `wasm32` (32-bit ptr).
    let packed = unsafe { transport_send(req_ptr as u32, req_len as u32) };
    // SAFETY: matching free of the request buffer we allocated above.
    unsafe {
        sv_dealloc(req_ptr, req_len);
    }

    if packed == 0 {
        return Err(SdkError::transport(
            "host transport returned no response",
            false,
        ));
    }
    let resp_ptr = ((packed >> 32) as u32) as *mut u8;
    let resp_len = (packed & 0xFFFF_FFFF) as usize;
    // SAFETY: the host wrote `resp_len` bytes at `resp_ptr` via `sv_alloc`;
    // `read_string` takes ownership and frees it.
    let resp_json = unsafe { read_string(resp_ptr, resp_len) };

    let response: WireResponse = serde_json::from_str(&resp_json)
        .map_err(|err| SdkError::transport(format!("invalid host response: {err}"), false))?;
    Ok(HttpResponse {
        status: response.status,
        body: response.body.into_bytes(),
    })
}
