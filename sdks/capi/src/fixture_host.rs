//! Test-only fixture-host ABI (`--features fixture-host`).
//!
//! Reuses `fixture-runner` for registry dispatch, corpus loading, and
//! `assert_expect`. The C harness still exercises the public C boundary
//! (`solvapay_client_call` / `solvapay_verify_webhook`) for client ops.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::raw::{c_char, c_int};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use solvapay_core::SdkError;

use crate::abi::{into_c_string, read_c_str};
use crate::error::{envelope_from_panic_payload, err_envelope, ok_envelope};

use fixture_runner::extract::require_clock_ms;
use fixture_runner::{
    assert_expect, create_default_registry, discover_fixtures, BindingError, BindingRegistry,
    DiscoveredFixture, ErrorObservation, FixtureInput,
};

/// Last fixture index observed by an indexed host export (clock/rng sidecar).
static CURRENT_FIXTURE: AtomicUsize = AtomicUsize::new(usize::MAX);

/// Loaded golden-fixture corpus, or a loud load error (no silent empty default).
static CORPUS: OnceLock<Result<Vec<DiscoveredFixture>, String>> = OnceLock::new();

/// Default fixture-runner helper registry.
static REGISTRY: OnceLock<BindingRegistry> = OnceLock::new();

/// Live single-shot HTTP stubs keyed by packed handle.
static STUBS: Mutex<Vec<Option<StubSlot>>> = Mutex::new(Vec::new());

/// One in-flight stub backend.
struct StubSlot {
    /// Join handle returning the captured request (or an accept/parse error).
    join: Option<JoinHandle<Result<CapturedRequest, String>>>,
    /// Programmed `wire.request` used by [`solvapay_fh_stub_assert`].
    expected: Option<fixture_runner::WireRequest>,
}

/// Captured inbound HTTP request (method/path/query/body — not headers).
struct CapturedRequest {
    /// HTTP verb.
    method: String,
    /// Path without query string.
    path: String,
    /// Decoded query pairs.
    query: BTreeMap<String, String>,
    /// Parsed JSON body, or raw string when not JSON.
    body: Option<Value>,
}

fn corpus() -> Result<&'static [DiscoveredFixture], String> {
    match CORPUS.get_or_init(load_corpus) {
        Ok(items) => Ok(items.as_slice()),
        Err(message) => Err(message.clone()),
    }
}

fn load_corpus() -> Result<Vec<DiscoveredFixture>, String> {
    let root = repo_paths::load()
        .map_err(|err| err.to_string())?
        .contract_fixtures()
        .map_err(|err| err.to_string())?;
    if !root.is_dir() {
        return Err(format!(
            "fixtures root is not a directory: {}",
            root.display()
        ));
    }
    discover_fixtures(&root).map_err(|err| err.to_string())
}

fn registry() -> &'static BindingRegistry {
    REGISTRY.get_or_init(create_default_registry)
}

fn select_fixture(index: usize) {
    CURRENT_FIXTURE.store(index, Ordering::SeqCst);
}

fn selected_clock_rng(fn_name: &str) -> (Option<String>, Option<i64>) {
    let index = CURRENT_FIXTURE.load(Ordering::SeqCst);
    let Ok(items) = corpus() else {
        return (None, None);
    };
    match items.get(index) {
        Some(item) if item.fixture.input.fn_name == fn_name => (
            item.fixture.input.clock.clone(),
            item.fixture.input.rng_seed,
        ),
        _ => (None, None),
    }
}

fn transport_err(message: impl Into<String>) -> *mut c_char {
    into_c_string(err_envelope(&SdkError::transport(message.into(), false)))
}

fn empty_ok_string() -> *mut c_char {
    into_c_string(String::new())
}

fn parse_args_map(args_json: &str) -> Result<BTreeMap<String, Value>, String> {
    let value: Value =
        serde_json::from_str(args_json).map_err(|err| format!("invalid args JSON: {err}"))?;
    match value {
        Value::Object(map) => Ok(map.into_iter().collect()),
        _ => Err("args JSON must be an object".to_owned()),
    }
}

fn invoke_sync(fn_name: &str, args_json: &str) -> String {
    let Some(binding) = registry()
        .get(fn_name)
        .and_then(|bindings| bindings.first())
    else {
        return err_envelope(&SdkError::transport(
            format!("unregistered fixture fn: {fn_name}"),
            false,
        ));
    };
    let args = match parse_args_map(args_json) {
        Ok(args) => args,
        Err(message) => return err_envelope(&SdkError::transport(message, false)),
    };
    let (clock, rng_seed) = selected_clock_rng(fn_name);
    let input = FixtureInput {
        fn_name: fn_name.to_owned(),
        args,
        clock,
        rng_seed,
    };
    match (binding.invoke)(&input) {
        Ok(value) => ok_envelope(&value),
        Err(BindingError::Sdk(obs)) => observation_envelope(&obs),
        Err(BindingError::Harness(message)) => err_envelope(&SdkError::transport(message, false)),
    }
}

fn observation_envelope(obs: &ErrorObservation) -> String {
    let mut error = Map::new();
    if let Some(name) = &obs.name {
        error.insert("name".to_owned(), Value::String(name.clone()));
    }
    if let Some(kind) = &obs.kind {
        error.insert("kind".to_owned(), Value::String(kind.clone()));
    }
    error.insert("message".to_owned(), Value::String(obs.message.clone()));
    match obs.kind.as_deref() {
        Some("Transport") => {
            let retryable = obs.code.as_deref() == Some("retryable");
            error.insert("retryable".to_owned(), Value::Bool(retryable));
        }
        _ => {
            if let Some(code) = &obs.code {
                error.insert("code".to_owned(), Value::String(code.clone()));
            }
        }
    }
    if let Some(status) = obs.status {
        error.insert("status".to_owned(), json!(status));
    }
    json!({ "ok": false, "error": error }).to_string()
}

fn envelope_to_outcome(envelope_json: &str) -> Result<Value, BindingError> {
    let value: Value = serde_json::from_str(envelope_json)
        .map_err(|err| BindingError::Harness(format!("invalid envelope JSON: {err}")))?;
    let ok = value
        .get("ok")
        .and_then(Value::as_bool)
        .ok_or_else(|| BindingError::Harness("envelope missing ok".to_owned()))?;
    if ok {
        let mut value = value.get("value").cloned().unwrap_or(Value::Null);
        canonicalize_json_numbers(&mut value);
        Ok(value)
    } else {
        let error = value
            .get("error")
            .ok_or_else(|| BindingError::Harness("envelope missing error".to_owned()))?;
        let kind = error.get("kind").and_then(Value::as_str).map(str::to_owned);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("SolvaPay error")
            .to_owned();
        let name = if let Some(n) = error.get("name").and_then(Value::as_str) {
            Some(n.to_owned())
        } else if kind.as_deref() == Some("Paywall") {
            Some("PaywallError".to_owned())
        } else if kind.is_none() {
            Some("Error".to_owned())
        } else {
            Some("SolvaPayError".to_owned())
        };
        let code = match kind.as_deref() {
            Some("Transport") => {
                if error.get("retryable").and_then(Value::as_bool) == Some(true) {
                    Some("retryable".to_owned())
                } else {
                    Some("non_retryable".to_owned())
                }
            }
            _ => error.get("code").and_then(Value::as_str).map(str::to_owned),
        };
        let status = error.get("status").and_then(Value::as_i64);
        Err(BindingError::Sdk(ErrorObservation {
            name,
            message,
            kind,
            code,
            status,
        }))
    }
}

#[allow(clippy::cast_possible_truncation, clippy::float_cmp)]
fn canonicalize_json_numbers(value: &mut Value) {
    match value {
        Value::Number(number) => {
            if number.as_i64().is_some() || number.as_u64().is_some() {
                return;
            }
            if let Some(float) = number.as_f64() {
                if float.is_finite() && float.fract() == 0.0 {
                    let int = float as i64;
                    if int as f64 == float {
                        *value = Value::from(int);
                    }
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                canonicalize_json_numbers(item);
            }
        }
        Value::Object(map) => {
            for item in map.values_mut() {
                canonicalize_json_numbers(item);
            }
        }
        Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
}

fn fixture_args_json(item: &DiscoveredFixture) -> Result<String, String> {
    let mut map: Map<String, Value> = item
        .fixture
        .input
        .args
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if item.fixture.input.fn_name == "verifyWebhook" && item.fixture.input.clock.is_some() {
        let ms = require_clock_ms(&item.fixture.input).map_err(|err| match err {
            BindingError::Harness(message)
            | BindingError::Sdk(ErrorObservation { message, .. }) => message,
        })?;
        map.insert("nowUnixSecs".to_owned(), json!(ms / 1000));
    }
    serde_json::to_string(&Value::Object(map)).map_err(|err| err.to_string())
}

fn relative_label(item: &DiscoveredFixture) -> String {
    format!("{}/{}", item.fixture.suite, item.fixture.case)
}

fn catch_string(f: impl FnOnce() -> *mut c_char + std::panic::UnwindSafe) -> *mut c_char {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(ptr) => ptr,
        Err(payload) => into_c_string(envelope_from_panic_payload(payload)),
    }
}

/// Invokes a fixture-runner registry helper and returns a JSON envelope.
///
/// # Safety
///
/// `fn_name` and `args_json` must be valid NUL-terminated C strings when non-null.
#[no_mangle]
pub unsafe extern "C" fn solvapay_fh_call_sync(
    fn_name: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    catch_string(|| {
        let Some(fn_name) = read_c_str(fn_name) else {
            return transport_err("null fn_name argument");
        };
        let Some(args_json) = read_c_str(args_json) else {
            return transport_err("null args_json argument");
        };
        into_c_string(invoke_sync(&fn_name, &args_json))
    })
}

/// Returns the number of discovered golden fixtures, or `0` when load failed.
#[no_mangle]
pub extern "C" fn solvapay_fh_fixture_count() -> usize {
    std::panic::catch_unwind(|| match corpus() {
        Ok(items) => items.len(),
        Err(_) => 0,
    })
    .unwrap_or(0)
}

/// Returns `input.fn` for fixture `index`. Caller frees with [`crate::solvapay_free_string`].
///
/// # Safety
///
/// `index` must be in range, or the returned string names the error.
#[no_mangle]
pub extern "C" fn solvapay_fh_fixture_fn(index: usize) -> *mut c_char {
    catch_string(|| match corpus() {
        Ok(items) => match items.get(index) {
            Some(item) => {
                select_fixture(index);
                into_c_string(item.fixture.input.fn_name.clone())
            }
            None => transport_err(format!("fixture index {index} out of range")),
        },
        Err(message) => transport_err(message),
    })
}

/// Returns fixture args JSON (injects `nowUnixSecs` for `verifyWebhook`).
///
/// # Safety
///
/// Returned pointer is owned by the caller.
#[no_mangle]
pub extern "C" fn solvapay_fh_fixture_args(index: usize) -> *mut c_char {
    catch_string(|| match corpus() {
        Ok(items) => match items.get(index) {
            Some(item) => {
                select_fixture(index);
                match fixture_args_json(item) {
                    Ok(json) => into_c_string(json),
                    Err(message) => transport_err(message),
                }
            }
            None => transport_err(format!("fixture index {index} out of range")),
        },
        Err(message) => transport_err(message),
    })
}

/// Returns a `suite/case` label for fixture `index`.
///
/// # Safety
///
/// Returned pointer is owned by the caller.
#[no_mangle]
pub extern "C" fn solvapay_fh_fixture_label(index: usize) -> *mut c_char {
    catch_string(|| match corpus() {
        Ok(items) => match items.get(index) {
            Some(item) => {
                select_fixture(index);
                into_c_string(relative_label(item))
            }
            None => transport_err(format!("fixture index {index} out of range")),
        },
        Err(message) => transport_err(message),
    })
}

/// Compares `envelope_json` against fixture `index`'s `expect` block.
///
/// Returns an empty string on match; a non-empty diff otherwise.
///
/// # Safety
///
/// `envelope_json` must be a valid NUL-terminated C string when non-null.
#[no_mangle]
pub unsafe extern "C" fn solvapay_fh_assert(
    index: usize,
    envelope_json: *const c_char,
) -> *mut c_char {
    catch_string(|| {
        select_fixture(index);
        let Some(envelope_json) = read_c_str(envelope_json) else {
            return into_c_string("null envelope_json argument".to_owned());
        };
        let items = match corpus() {
            Ok(items) => items,
            Err(message) => return into_c_string(message),
        };
        let Some(item) = items.get(index) else {
            return into_c_string(format!("fixture index {index} out of range"));
        };
        let outcome = envelope_to_outcome(&envelope_json);
        match assert_expect(&item.fixture.expect, outcome) {
            Ok(()) => empty_ok_string(),
            Err(diff) => into_c_string(diff),
        }
    })
}

/// Starts a single-shot TCP stub serving fixture `index`'s `wire.response`.
///
/// Writes the origin URL to `base_url_out` (caller frees). Returns a handle `> 0`
/// on success, or `0` on failure (and writes an error string to `base_url_out`).
///
/// # Safety
///
/// `base_url_out` must be a valid writable pointer.
#[no_mangle]
pub unsafe extern "C" fn solvapay_fh_stub_start(
    index: usize,
    base_url_out: *mut *mut c_char,
) -> c_int {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if base_url_out.is_null() {
            return 0;
        }
        unsafe {
            *base_url_out = std::ptr::null_mut();
        }
        select_fixture(index);
        match start_stub(index) {
            Ok((handle, url)) => {
                unsafe {
                    *base_url_out = into_c_string(url);
                }
                handle
            }
            Err(message) => {
                unsafe {
                    *base_url_out = into_c_string(message);
                }
                0
            }
        }
    }));
    result.unwrap_or_default()
}

/// Validates the captured stub request against `wire.request` (method/path/query/body).
///
/// Returns an empty string on match. Consumes the handle.
///
/// # Safety
///
/// `handle` must come from [`solvapay_fh_stub_start`].
#[no_mangle]
pub extern "C" fn solvapay_fh_stub_assert(handle: c_int) -> *mut c_char {
    catch_string(|| match take_stub(handle) {
        Ok(slot) => match join_and_compare(slot) {
            Ok(()) => empty_ok_string(),
            Err(diff) => into_c_string(diff),
        },
        Err(message) => into_c_string(message),
    })
}

fn start_stub(index: usize) -> Result<(c_int, String), String> {
    let items = corpus()?;
    let item = items
        .get(index)
        .ok_or_else(|| format!("fixture index {index} out of range"))?;
    let wire = item
        .fixture
        .wire
        .clone()
        .ok_or_else(|| format!("fixture {index} has no wire block"))?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
    listener
        .set_nonblocking(false)
        .map_err(|err| err.to_string())?;
    let addr = listener.local_addr().map_err(|err| err.to_string())?;
    let url = format!("http://{addr}");
    let status = wire.response.status;
    let body = wire.response.body.clone();
    let join = thread::spawn(move || serve_one(listener, status, body));
    let mut table = STUBS
        .lock()
        .map_err(|_| "stub registry mutex poisoned".to_owned())?;
    table.push(Some(StubSlot {
        join: Some(join),
        expected: Some(wire.request),
    }));
    let handle = c_int::try_from(table.len()).map_err(|_| "too many stubs".to_owned())?;
    Ok((handle, url))
}

fn take_stub(handle: c_int) -> Result<StubSlot, String> {
    if handle <= 0 {
        return Err("invalid stub handle".to_owned());
    }
    let index = usize::try_from(handle).map_err(|_| "invalid stub handle".to_owned())? - 1;
    let mut table = STUBS
        .lock()
        .map_err(|_| "stub registry mutex poisoned".to_owned())?;
    table
        .get_mut(index)
        .and_then(Option::take)
        .ok_or_else(|| "invalid or already asserted stub handle".to_owned())
}

fn join_and_compare(mut slot: StubSlot) -> Result<(), String> {
    let join = slot
        .join
        .take()
        .ok_or_else(|| "stub thread missing".to_owned())?;
    let captured = join
        .join()
        .map_err(|_| "stub thread panicked".to_owned())??;
    let expected = slot
        .expected
        .take()
        .ok_or_else(|| "stub expected request missing".to_owned())?;
    compare_wire(&captured, &expected)
}

fn compare_wire(
    actual: &CapturedRequest,
    expected: &fixture_runner::WireRequest,
) -> Result<(), String> {
    if actual.method != expected.method.as_str() {
        return Err(format!(
            "wire.request.method mismatch: {:?} != {:?}",
            actual.method,
            expected.method.as_str()
        ));
    }
    if actual.path != expected.path {
        return Err(format!(
            "wire.request.path mismatch: {:?} != {:?}",
            actual.path, expected.path
        ));
    }
    if let Some(expected_query) = &expected.query {
        if &actual.query != expected_query {
            return Err(format!(
                "wire.request.query mismatch: {:?} != {:?}",
                actual.query, expected_query
            ));
        }
    }
    if let Some(expected_body) = &expected.body {
        match &actual.body {
            Some(actual_body) if actual_body == expected_body => {}
            other => {
                return Err(format!(
                    "wire.request.body mismatch: {other:?} != {expected_body:?}"
                ));
            }
        }
    }
    Ok(())
}

fn serve_one(listener: TcpListener, status: i64, body: Value) -> Result<CapturedRequest, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(pair) => break pair,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("stub accept timed out".to_owned());
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(err) => return Err(err.to_string()),
        }
    };
    stream
        .set_nonblocking(false)
        .map_err(|err| err.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|err| err.to_string())?;
    let captured = read_http_request(&mut stream)?;
    write_http_response(&mut stream, status, &body)?;
    Ok(captured)
}

fn read_http_request(stream: &mut std::net::TcpStream) -> Result<CapturedRequest, String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        let n = stream.read(&mut tmp).map_err(|err| err.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 1_000_000 {
            return Err("stub request too large".to_owned());
        }
    }
    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "stub request missing header terminator".to_owned())?;
    let header_bytes = &buf[..header_end];
    let header_text = std::str::from_utf8(header_bytes).map_err(|err| err.to_string())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "stub request missing request line".to_owned())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "stub request missing method".to_owned())?
        .to_owned();
    let target = parts
        .next()
        .ok_or_else(|| "stub request missing path".to_owned())?;
    let (path, query_str) = match target.split_once('?') {
        Some((path, query)) => (path.to_owned(), Some(query)),
        None => (target.to_owned(), None),
    };
    let mut content_length = 0usize;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value
                .trim()
                .parse()
                .map_err(|_| format!("invalid content-length: {value}"))?;
        }
    }
    let mut body_bytes = buf[header_end + 4..].to_vec();
    while body_bytes.len() < content_length {
        let n = stream.read(&mut tmp).map_err(|err| err.to_string())?;
        if n == 0 {
            break;
        }
        body_bytes.extend_from_slice(&tmp[..n]);
    }
    body_bytes.truncate(content_length);
    let query = parse_query(query_str.unwrap_or(""));
    let body = if body_bytes.is_empty() {
        None
    } else {
        match serde_json::from_slice::<Value>(&body_bytes) {
            Ok(value) => Some(value),
            Err(_) => Some(Value::String(
                String::from_utf8_lossy(&body_bytes).into_owned(),
            )),
        }
    };
    Ok(CapturedRequest {
        method,
        path,
        query,
        body,
    })
}

fn parse_query(raw: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    if raw.is_empty() {
        return out;
    }
    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some((k, v)) => (percent_decode(k), percent_decode(v)),
            None => (percent_decode(pair), String::new()),
        };
        out.insert(key, value);
    }
    out
}

fn percent_decode(input: &str) -> String {
    let mut out = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &input[i + 1..i + 3];
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn write_http_response(
    stream: &mut std::net::TcpStream,
    status: i64,
    body: &Value,
) -> Result<(), String> {
    let (payload, content_type) = match body {
        Value::String(s) => (s.clone().into_bytes(), "text/plain; charset=utf-8"),
        other => (
            serde_json::to_vec(other).map_err(|err| err.to_string())?,
            "application/json",
        ),
    };
    let header = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(header.as_bytes())
        .map_err(|err| err.to_string())?;
    stream.write_all(&payload).map_err(|err| err.to_string())?;
    let _ = stream.flush();
    Ok(())
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
    use crate::solvapay_free_string;
    use std::ffi::CString;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn parse_json_ptr(ptr: *mut c_char) -> Value {
        assert!(!ptr.is_null());
        let s = read_c_str(ptr).expect("c str").into_owned();
        unsafe {
            solvapay_free_string(ptr);
        }
        serde_json::from_str(&s).expect("json")
    }

    fn read_ptr(ptr: *mut c_char) -> String {
        assert!(!ptr.is_null());
        let s = read_c_str(ptr).expect("c str").into_owned();
        unsafe {
            solvapay_free_string(ptr);
        }
        s
    }

    #[test]
    fn call_sync_classify_customer_ref_and_unregistered() {
        let fn_name = CString::new("classifyCustomerRef").unwrap();
        let args = CString::new(r#"{"customerRef":"cus_abc123"}"#).unwrap();
        let env = parse_json_ptr(unsafe { solvapay_fh_call_sync(fn_name.as_ptr(), args.as_ptr()) });
        assert_eq!(env["ok"], true);
        assert_eq!(env["value"], "backend");

        let missing = CString::new("noSuchFixtureFn").unwrap();
        let empty = CString::new("{}").unwrap();
        let err =
            parse_json_ptr(unsafe { solvapay_fh_call_sync(missing.as_ptr(), empty.as_ptr()) });
        assert_eq!(err["ok"], false);
        let message = err["error"]["message"].as_str().unwrap();
        assert!(
            message.contains("noSuchFixtureFn"),
            "unregistered error must name the fn: {message}"
        );
    }

    #[test]
    fn corpus_count_round_trip_and_assert() {
        let count = solvapay_fh_fixture_count();
        assert_eq!(count, 584, "parsed fixture census");

        let mut classify_index = None;
        for i in 0..count {
            let fn_name = read_ptr(solvapay_fh_fixture_fn(i));
            if fn_name == "classifyCustomerRef" {
                let args = read_ptr(solvapay_fh_fixture_args(i));
                if args.contains("cus_abc123") {
                    classify_index = Some(i);
                    let label = read_ptr(solvapay_fh_fixture_label(i));
                    assert!(label.contains("helper-customer-sync"), "label={label}");
                    break;
                }
            }
        }
        let index = classify_index.expect("classifyCustomerRef fixture");
        let fn_name = CString::new(read_ptr(solvapay_fh_fixture_fn(index))).unwrap();
        let args = CString::new(read_ptr(solvapay_fh_fixture_args(index))).unwrap();
        let env_ptr = unsafe { solvapay_fh_call_sync(fn_name.as_ptr(), args.as_ptr()) };
        let env_str = read_ptr(env_ptr);
        let env_c = CString::new(env_str.clone()).unwrap();
        let diff = read_ptr(unsafe { solvapay_fh_assert(index, env_c.as_ptr()) });
        assert_eq!(diff, "", "matching envelope must assert empty, got {diff}");

        let bad = CString::new(r#"{"ok":true,"value":"nope"}"#).unwrap();
        let mismatch = read_ptr(unsafe { solvapay_fh_assert(index, bad.as_ptr()) });
        assert!(
            !mismatch.is_empty(),
            "mismatching envelope must return a diff"
        );
    }

    #[test]
    fn stub_start_serves_wire_response_and_assert_matches() {
        let count = solvapay_fh_fixture_count();
        let mut index = None;
        for i in 0..count {
            let fn_name = read_ptr(solvapay_fh_fixture_fn(i));
            if fn_name == "getMerchant" {
                index = Some(i);
                break;
            }
        }
        let index = index.expect("getMerchant fixture");
        let mut base_url: *mut c_char = std::ptr::null_mut();
        let handle = unsafe { solvapay_fh_stub_start(index, &mut base_url) };
        assert!(handle > 0, "stub_start handle");
        let url = read_ptr(base_url);
        assert!(url.starts_with("http://127.0.0.1:"), "url={url}");

        let items = corpus().expect("corpus");
        let wire = items[index].fixture.wire.as_ref().expect("wire");
        let path = &wire.request.path;
        let method = wire.request.method.as_str();
        let mut stream = TcpStream::connect(url.trim_start_matches("http://")).unwrap();
        let req =
            format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(
            response.contains("200") || response.contains(&wire.response.status.to_string()),
            "response={response}"
        );

        let diff = read_ptr(solvapay_fh_stub_assert(handle));
        assert_eq!(diff, "", "wire assert: {diff}");
    }
}
