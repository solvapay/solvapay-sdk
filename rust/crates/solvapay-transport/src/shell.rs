//! Client shell: auth, base URL, idempotency, retry wiring, template errors (step 21).
//!
//! Sits between [`crate::Transport`] and the typed client methods (steps 22–24).
//! Owns everything every method has in common; per-operation logic stays out of scope.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use solvapay_core::{RetryPolicy, SdkError};

use crate::http::{HeaderName, HttpRequest, Method};
use crate::transport::{BoxFuture, Transport};

/// Default API origin when no override is provided (TS `createSolvaPayClient` parity).
pub const DEFAULT_BASE_URL: &str = "https://api.solvapay.com";

/// Shared transport handle — `Send + Sync` on native for tokio; bare on wasm32.
#[cfg(not(target_arch = "wasm32"))]
pub type SharedTransport = Arc<dyn Transport + Send + Sync>;

/// Shared transport handle on wasm32 (`!Send` futures).
#[cfg(target_arch = "wasm32")]
pub type SharedTransport = Arc<dyn Transport>;

/// Epoch-ms clock hook (real time by default; fixtures inject a fixed instant).
#[cfg(not(target_arch = "wasm32"))]
pub type ClockFn = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Epoch-ms clock hook on wasm32.
#[cfg(target_arch = "wasm32")]
pub type ClockFn = Arc<dyn Fn() -> u64>;

/// `Math.random`-equivalent hook returning a float in `[0, 1)`.
#[cfg(not(target_arch = "wasm32"))]
pub type RngFn = Arc<dyn Fn() -> f64 + Send + Sync>;

/// `Math.random`-equivalent hook on wasm32.
#[cfg(target_arch = "wasm32")]
pub type RngFn = Arc<dyn Fn() -> f64>;

/// Host-side sleep for retry delays (timers never live in `solvapay-core`).
#[cfg(not(target_arch = "wasm32"))]
pub type SleeperFn = Arc<dyn Fn(Duration) -> BoxFuture<'static, ()> + Send + Sync>;

/// Host-side sleep on wasm32.
#[cfg(target_arch = "wasm32")]
pub type SleeperFn = Arc<dyn Fn(Duration) -> BoxFuture<'static, ()>>;

/// How the shell should set (or omit) the `Idempotency-Key` header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Idempotency {
    /// No idempotency header.
    None,
    /// Forward a caller-supplied key verbatim (e.g. `assignCredits`).
    CallerKey(String),
    /// Render a manifest format with `{epochMs}` / `{random9}` / named vars.
    Auto {
        /// Format string, e.g. `payment-{planRef}-{epochMs}-{random9}`.
        format: &'static str,
        /// Named placeholders beyond the built-ins (`planRef`, …).
        vars: BTreeMap<&'static str, String>,
    },
}

/// One shell-level HTTP call (method/path/body + idempotency + error template).
#[derive(Debug, Clone)]
pub struct ShellRequest {
    /// HTTP method.
    pub method: Method,
    /// Absolute path beginning with `/` (no origin).
    pub path: String,
    /// Optional query string pairs (encoded by the shell).
    pub query: BTreeMap<String, String>,
    /// Optional JSON body.
    pub body: Option<Value>,
    /// Idempotency-key policy for this call.
    pub idempotency: Idempotency,
    /// Manifest message template for non-2xx responses (`{status}`, `{body}`).
    pub error_template: &'static str,
}

/// Shared HTTP shell over a [`Transport`].
pub struct ClientShell {
    /// Underlying transport (`ReqwestTransport` / `FetchTransport` / mock).
    transport: SharedTransport,
    /// Bearer token; empty rejects with TS-parity `"Missing apiKey"`.
    api_key: String,
    /// Origin without trailing slash (default [`DEFAULT_BASE_URL`]).
    base_url: String,
    /// Retry policy; shell default is `max_retries: 0` (no retries).
    retry_policy: RetryPolicy,
    /// Epoch-ms clock.
    clock: ClockFn,
    /// Unit-interval RNG.
    rng: RngFn,
    /// Host sleep for retry delays.
    sleeper: SleeperFn,
}

impl ClientShell {
    /// Builds a shell with default base URL, no-retry policy, real clock/RNG, and
    /// a no-op sleeper (callers that enable retries should inject a real sleeper).
    ///
    /// # Arguments
    ///
    /// * `transport` - Dyn transport handle.
    /// * `api_key` - Bearer token (empty → `"Missing apiKey"` on [`ClientShell::execute`]).
    ///
    /// # Returns
    ///
    /// A ready [`ClientShell`].
    pub fn new(transport: SharedTransport, api_key: impl Into<String>) -> Self {
        Self {
            transport,
            api_key: api_key.into(),
            base_url: normalize_base_url(DEFAULT_BASE_URL),
            retry_policy: RetryPolicy {
                max_retries: 0,
                ..RetryPolicy::default()
            },
            clock: Arc::new(default_clock_ms),
            rng: Arc::new(default_random),
            sleeper: Arc::new(|_d| Box::pin(async {})),
        }
    }

    /// Overrides the API origin (trailing slash stripped).
    ///
    /// # Arguments
    ///
    /// * `base_url` - Origin such as `https://api.example.com` or with a trailing `/`.
    ///
    /// # Returns
    ///
    /// `self` for chaining.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = normalize_base_url(&base_url.into());
        self
    }

    /// Sets the retry policy used by [`ClientShell::execute`].
    ///
    /// # Arguments
    ///
    /// * `policy` - Delay / attempt schedule from `solvapay_core::RetryPolicy`.
    ///
    /// # Returns
    ///
    /// `self` for chaining.
    pub fn with_retry_policy(mut self, policy: RetryPolicy) -> Self {
        self.retry_policy = policy;
        self
    }

    /// Injects a clock returning Unix epoch milliseconds.
    ///
    /// # Arguments
    ///
    /// * `clock` - Hook invoked when rendering auto idempotency keys.
    ///
    /// # Returns
    ///
    /// `self` for chaining.
    pub fn with_clock(mut self, clock: ClockFn) -> Self {
        self.clock = clock;
        self
    }

    /// Injects a `Math.random`-equivalent float generator.
    ///
    /// # Arguments
    ///
    /// * `rng` - Hook returning a value in `[0, 1)`.
    ///
    /// # Returns
    ///
    /// `self` for chaining.
    pub fn with_rng(mut self, rng: RngFn) -> Self {
        self.rng = rng;
        self
    }

    /// Injects the host sleeper used between retries.
    ///
    /// # Arguments
    ///
    /// * `sleeper` - Async delay hook (must not live in `solvapay-core`).
    ///
    /// # Returns
    ///
    /// `self` for chaining.
    pub fn with_sleeper(mut self, sleeper: SleeperFn) -> Self {
        self.sleeper = sleeper;
        self
    }

    /// Returns the normalized base URL (no trailing slash).
    ///
    /// # Returns
    ///
    /// The configured origin string.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Executes one shell request: build URL/headers, retry transport I/O, map errors.
    ///
    /// # Arguments
    ///
    /// * `req` - Method, path, optional body/query, idempotency policy, error template.
    ///
    /// # Returns
    ///
    /// Parsed JSON [`Value`] on 2xx, or [`SdkError`] (Api / Transport / Missing apiKey).
    pub async fn execute(&self, req: ShellRequest) -> Result<Value, SdkError> {
        let template = req.error_template;
        let response = self.execute_raw(req).await?;
        if (200..300).contains(&response.status) {
            return parse_success_body(&response.body);
        }
        Err(map_api_error(template, response.status, &response.body))
    }

    /// Executes one shell request with auth / idempotency / retry, returning the raw
    /// HTTP response without status mapping or JSON parsing.
    ///
    /// Used by Group C methods that need TS-parity handling of non-2xx successes
    /// (`deleteProduct` / `deletePlan` 404) or status-specific / body-prefix errors
    /// (`cancelPurchase` / `reactivatePurchase`).
    ///
    /// # Arguments
    ///
    /// * `req` - Method, path, optional body/query, idempotency policy (error template
    ///   is ignored; callers map status themselves).
    ///
    /// # Returns
    ///
    /// [`HttpResponse`] after successful transport I/O, or [`SdkError`] (Transport /
    /// Missing apiKey).
    pub async fn execute_raw(
        &self,
        req: ShellRequest,
    ) -> Result<crate::http::HttpResponse, SdkError> {
        if self.api_key.is_empty() {
            return Err(SdkError::Api {
                message: "Missing apiKey".to_owned(),
                status: None,
                code: None,
            });
        }

        let http_req = self.build_http_request(&req)?;
        let mut attempt: u32 = 0;

        loop {
            match self.transport.send(http_req.clone()).await {
                Ok(response) => return Ok(response),
                Err(err) => {
                    let retryable = matches!(
                        &err,
                        SdkError::Transport {
                            retryable: true,
                            ..
                        }
                    );
                    if !retryable {
                        return Err(err);
                    }
                    match self.retry_policy.next_delay(attempt) {
                        None => return Err(err),
                        Some(delay) => {
                            (self.sleeper)(delay).await;
                            attempt = attempt.saturating_add(1);
                        }
                    }
                }
            }
        }
    }

    /// Builds the absolute-URL [`HttpRequest`] for `req` (auth + idempotency applied).
    fn build_http_request(&self, req: &ShellRequest) -> Result<HttpRequest, SdkError> {
        let url = assemble_url(&self.base_url, &req.path, &req.query);
        let mut headers = Vec::new();
        headers.push((
            HeaderName::new("Content-Type")?,
            "application/json".to_owned(),
        ));
        headers.push((
            HeaderName::new("Authorization")?,
            format!("Bearer {}", self.api_key),
        ));

        match &req.idempotency {
            Idempotency::None => {}
            Idempotency::CallerKey(key) => {
                headers.push((HeaderName::new("Idempotency-Key")?, key.clone()));
            }
            Idempotency::Auto { format, vars } => {
                let epoch_ms = (self.clock)();
                let random9 = random9_from_f64((self.rng)());
                let key = render_idempotency_key(format, vars, epoch_ms, &random9);
                headers.push((HeaderName::new("Idempotency-Key")?, key));
            }
        }

        let body = match &req.body {
            None => None,
            Some(value) => Some(serde_json::to_vec(value).map_err(|err| {
                SdkError::transport(format!("serialize request body: {err}"), false)
            })?),
        };

        Ok(HttpRequest {
            method: req.method,
            url,
            headers,
            body,
        })
    }
}

/// Strips a single trailing `/` from `base` (TS `replace(/\/$/, '')` parity).
///
/// # Arguments
///
/// * `base` - Raw origin string.
///
/// # Returns
///
/// Origin without a trailing slash.
pub fn normalize_base_url(base: &str) -> String {
    base.strip_suffix('/').unwrap_or(base).to_owned()
}

/// Mulberry32 PRNG matching `scripts/lib/fixture-harness.ts`.
///
/// # Arguments
///
/// * `seed` - 32-bit seed (`>>> 0` semantics).
///
/// # Returns
///
/// A closure yielding successive floats in `[0, 1)`.
pub fn mulberry32(seed: u32) -> impl Fn() -> f64 + Send + Sync {
    use std::sync::Mutex;
    let state = Mutex::new(seed);
    move || {
        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = guard.wrapping_add(0x6d2b79f5);
        let mut t = *guard;
        t = js_imul(t ^ (t >> 15), t | 1);
        t ^= t.wrapping_add(js_imul(t ^ (t >> 7), t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

/// JS `Math.random().toString(36).substr(2, 9)` fragment from a unit-interval float.
///
/// # Arguments
///
/// * `n` - Float in `[0, 1)` (typically from [`mulberry32`]).
///
/// # Returns
///
/// Nine base-36 characters.
pub fn random9_from_f64(n: f64) -> String {
    let full = js_number_to_string_36(n);
    full.chars().skip(2).take(9).collect()
}

/// Renders an auto idempotency key from a manifest format.
///
/// # Arguments
///
/// * `format` - e.g. `payment-{planRef}-{epochMs}-{random9}`.
/// * `vars` - Named placeholders (`planRef`, …).
/// * `epoch_ms` - Clock value for `{epochMs}`.
/// * `random9` - Precomputed `{random9}` fragment.
///
/// # Returns
///
/// The rendered key string.
pub fn render_idempotency_key(
    format: &str,
    vars: &BTreeMap<&'static str, String>,
    epoch_ms: u64,
    random9: &str,
) -> String {
    let epoch = epoch_ms.to_string();
    let mut out = String::with_capacity(format.len() + 32);
    let mut rest = format;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match key {
                    "epochMs" => out.push_str(&epoch),
                    "random9" => out.push_str(random9),
                    other => match vars.get(other) {
                        Some(value) => out.push_str(value),
                        None => {
                            out.push('{');
                            out.push_str(other);
                            out.push('}');
                        }
                    },
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Wall-clock Unix epoch milliseconds for non-fixture clients.
///
/// `wasm32-unknown-unknown` (browser / edge) has no `SystemTime`, so it reads
/// the host `Date.now()` — calling `SystemTime::now()` there traps (`unreachable`).
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn default_clock_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => u64::try_from(d.as_millis()).unwrap_or(u64::MAX),
        Err(_) => 0,
    }
}

/// Wall-clock Unix epoch milliseconds via host `Date.now()` (browser / edge).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn default_clock_ms() -> u64 {
    js_sys::Date::now() as u64
}

/// Non-cryptographic unit-interval float for non-fixture clients (`Math.random` role).
///
/// `wasm32-unknown-unknown` reads the host `Math.random()`; other targets derive
/// one from `SystemTime` (which traps on that wasm target).
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
fn default_random() -> f64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut hasher = DefaultHasher::new();
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        .hash(&mut hasher);
    (hasher.finish() as f64) / (u64::MAX as f64)
}

/// Host `Math.random()` unit-interval float (browser / edge).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
fn default_random() -> f64 {
    js_sys::Math::random()
}

/// JS `Math.imul` — signed 32-bit multiply, result as `u32` bits.
fn js_imul(a: u32, b: u32) -> u32 {
    (a as i32).wrapping_mul(b as i32) as u32
}

/// Approximate JS `Number.prototype.toString(36)` for values in `[0, 1)`.
fn js_number_to_string_36(n: f64) -> String {
    // Integer part is always 0 for unit-interval floats used by Math.random.
    let mut out = String::from("0.");
    let mut x = n.fract().abs();
    for _ in 0..20 {
        x *= 36.0;
        let digit = x.floor() as u32;
        out.push(base36_digit(digit.min(35)));
        x -= f64::from(digit);
        if x <= 0.0 {
            break;
        }
    }
    out
}

/// Maps `0..=35` to a base-36 digit character (`0-9a-z`).
fn base36_digit(n: u32) -> char {
    match n {
        0..=9 => char::from(b'0' + n as u8),
        10..=35 => char::from(b'a' + (n as u8 - 10)),
        _ => '0',
    }
}

/// Joins origin + path + sorted form-urlencoded query string.
fn assemble_url(base: &str, path: &str, query: &BTreeMap<String, String>) -> String {
    let mut url = format!("{base}{path}");
    if !query.is_empty() {
        let mut pairs: Vec<String> = query
            .iter()
            .map(|(k, v)| {
                format!(
                    "{}={}",
                    encode_query_component(k),
                    encode_query_component(v)
                )
            })
            .collect();
        pairs.sort();
        url.push('?');
        url.push_str(&pairs.join("&"));
    }
    url
}

/// Minimal `application/x-www-form-urlencoded` component encoding for query keys/values.
///
/// # Arguments
///
/// * `raw` - Unencoded query key or value.
///
/// # Returns
///
/// Percent-encoded component (`space` → `+`).
pub fn encode_query_component(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(b));
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push(nibble(b >> 4));
                out.push(nibble(b & 0x0f));
            }
        }
    }
    out
}

/// Uppercase hex nibble for percent-encoding.
fn nibble(n: u8) -> char {
    char::from(match n {
        0..=9 => b'0' + n,
        10..=15 => b'A' + (n - 10),
        _ => b'0',
    })
}

/// Parses a 2xx response body as JSON (`null` when empty).
fn parse_success_body(body: &[u8]) -> Result<Value, SdkError> {
    if body.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(body)
        .map_err(|err| SdkError::transport(format!("response body is not JSON: {err}"), false))
}

/// Maps a non-2xx response to [`SdkError::Api`] via a manifest message template.
fn map_api_error(template: &str, status: u16, body: &[u8]) -> SdkError {
    let body_text = String::from_utf8_lossy(body);
    let status_str = status.to_string();
    let mut vars = BTreeMap::new();
    vars.insert("status", status_str.as_str());
    vars.insert("body", body_text.as_ref());
    SdkError::api_from_template(template, &vars, Some(status), None)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    // Tokio + MockTransport unit suite is native-only (no tokio on wasm32 lib tests).
    #[cfg(not(target_arch = "wasm32"))]
    mod native {
        use super::super::*;

        use std::sync::Mutex;

        use serde_json::json;
        use solvapay_core::{Backoff, RetryPolicy};

        use crate::http::HttpResponse;

        struct MockTransport {
            responses: Mutex<Vec<Result<HttpResponse, SdkError>>>,
            recorded: Mutex<Vec<HttpRequest>>,
        }

        impl MockTransport {
            fn new(responses: Vec<Result<HttpResponse, SdkError>>) -> Arc<Self> {
                Arc::new(Self {
                    responses: Mutex::new(responses),
                    recorded: Mutex::new(Vec::new()),
                })
            }

            fn recorded(&self) -> Vec<HttpRequest> {
                self.recorded.lock().expect("lock").clone()
            }
        }

        impl Transport for MockTransport {
            fn send(&self, req: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, SdkError>> {
                let recorded = &self.recorded;
                let responses = &self.responses;
                Box::pin(async move {
                    recorded.lock().expect("lock").push(req);
                    let mut guard = responses.lock().expect("lock");
                    if guard.is_empty() {
                        Err(SdkError::transport("mock responses exhausted", false))
                    } else {
                        guard.remove(0)
                    }
                })
            }
        }

        fn recording_sleeper(delays: Arc<Mutex<Vec<u64>>>) -> SleeperFn {
            Arc::new(move |d: Duration| {
                let delays = Arc::clone(&delays);
                Box::pin(async move {
                    delays.lock().expect("lock").push(d.as_millis() as u64);
                })
            })
        }

        fn shell_with_mock(mock: Arc<MockTransport>, api_key: &str) -> ClientShell {
            let transport: SharedTransport = mock;
            ClientShell::new(transport, api_key)
        }

        #[test]
        fn default_base_url_is_solvapay_api() {
            let mock = MockTransport::new(vec![]);
            let shell = shell_with_mock(mock, "sk_test");
            assert_eq!(shell.base_url(), DEFAULT_BASE_URL);
        }

        #[test]
        fn base_url_override_and_trailing_slash_normalization() {
            let mock = MockTransport::new(vec![]);
            let shell = shell_with_mock(mock, "sk_test").with_base_url("https://example.test/api/");
            assert_eq!(shell.base_url(), "https://example.test/api");
        }

        #[tokio::test]
        async fn empty_api_key_rejected_with_ts_parity_message() {
            let mock = MockTransport::new(vec![]);
            let shell = shell_with_mock(mock, "");
            let err = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/health".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "unused ({status}): {body}",
                })
                .await
                .expect_err("empty api key must fail");
            match err {
                SdkError::Api {
                    message,
                    status,
                    code,
                } => {
                    assert_eq!(message, "Missing apiKey");
                    assert_eq!(status, None);
                    assert_eq!(code, None);
                }
                other => panic!("expected Api error, got {other:?}"),
            }
        }

        #[tokio::test]
        async fn auth_and_content_type_headers_on_every_request() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{"ok":true}"#.to_vec(),
            })]);
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test_fixture")
                .with_base_url("https://api.solvapay.com");
            let _ = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/limits".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({"customerRef": "cus"})),
                    idempotency: Idempotency::None,
                    error_template: "Check limits failed ({status}): {body}",
                })
                .await
                .expect("200 ok");

            let recorded = mock.recorded();
            assert_eq!(recorded.len(), 1);
            let headers = &recorded[0].headers;
            let get = |name: &str| {
                headers
                    .iter()
                    .find(|(n, _)| n.as_str() == name)
                    .map(|(_, v)| v.as_str())
            };
            assert_eq!(get("authorization"), Some("Bearer sk_test_fixture"));
            assert_eq!(get("content-type"), Some("application/json"));
        }

        #[tokio::test]
        async fn query_string_assembly() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"[]"#.to_vec(),
            })]);
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test").with_base_url("http://mock");
            let mut query = BTreeMap::new();
            query.insert("b".to_owned(), "two words".to_owned());
            query.insert("a".to_owned(), "1".to_owned());
            let _ = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/items".to_owned(),
                    query,
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect("ok");
            let url = &mock.recorded()[0].url;
            assert!(
                url.contains("a=1") && url.contains("b=two+words"),
                "url should encode query, got {url}"
            );
            assert!(url.starts_with("http://mock/v1/sdk/items?"));
        }

        #[test]
        fn mulberry32_42_random9_is_frozen_fragment() {
            let rng = mulberry32(42);
            let fragment = random9_from_f64(rng());
            assert_eq!(fragment, "ln13h9a6y");
        }

        #[test]
        fn auto_payment_idempotency_key_byte_for_byte() {
            let mut vars = BTreeMap::new();
            vars.insert("planRef", "plan_basic".to_owned());
            let key = render_idempotency_key(
                "payment-{planRef}-{epochMs}-{random9}",
                &vars,
                1_782_864_000_000,
                "ln13h9a6y",
            );
            assert_eq!(key, "payment-plan_basic-1782864000000-ln13h9a6y");
        }

        #[test]
        fn auto_topup_idempotency_format() {
            let key = render_idempotency_key(
                "topup-{epochMs}-{random9}",
                &BTreeMap::new(),
                1_782_864_000_000,
                "ln13h9a6y",
            );
            assert_eq!(key, "topup-1782864000000-ln13h9a6y");
        }

        #[tokio::test]
        async fn caller_key_forwarded_verbatim() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{}"#.to_vec(),
            })]);
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test").with_base_url("http://mock");
            let _ = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({})),
                    idempotency: Idempotency::CallerKey("caller_key".to_owned()),
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect("ok");
            let headers = &mock.recorded()[0].headers;
            let key = headers
                .iter()
                .find(|(n, _)| n.as_str() == "idempotency-key")
                .map(|(_, v)| v.as_str());
            assert_eq!(key, Some("caller_key"));
        }

        #[tokio::test]
        async fn none_idempotency_omits_header() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{}"#.to_vec(),
            })]);
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test").with_base_url("http://mock");
            let _ = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({})),
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect("ok");
            let has = mock.recorded()[0]
                .headers
                .iter()
                .any(|(n, _)| n.as_str() == "idempotency-key");
            assert!(!has, "Idempotency-Key must be absent");
        }

        #[tokio::test]
        async fn auto_idempotency_uses_clock_and_rng_hooks() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{}"#.to_vec(),
            })]);
            let mut vars = BTreeMap::new();
            vars.insert("planRef", "plan_basic".to_owned());
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test")
                .with_base_url("http://mock")
                .with_clock(Arc::new(|| 1_782_864_000_000))
                .with_rng(Arc::new(mulberry32(42)));
            let _ = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/payment-intents".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({})),
                    idempotency: Idempotency::Auto {
                        format: "payment-{planRef}-{epochMs}-{random9}",
                        vars,
                    },
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect("ok");
            let recorded = mock.recorded();
            let key = recorded[0]
                .headers
                .iter()
                .find(|(n, _)| n.as_str() == "idempotency-key")
                .map(|(_, v)| v.as_str());
            assert_eq!(key, Some("payment-plan_basic-1782864000000-ln13h9a6y"));
        }

        #[tokio::test]
        async fn non_2xx_maps_to_api_error_with_template() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 400,
                body: b"bad".to_vec(),
            })]);
            let shell = shell_with_mock(mock, "sk_test").with_base_url("http://mock");
            let err = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/limits".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({})),
                    idempotency: Idempotency::None,
                    error_template: "Check limits failed ({status}): {body}",
                })
                .await
                .expect_err("400 must map to Api");
            match err {
                SdkError::Api {
                    message, status, ..
                } => {
                    assert_eq!(message, "Check limits failed (400): bad");
                    assert_eq!(status, Some(400));
                }
                other => panic!("expected Api, got {other:?}"),
            }
        }

        #[tokio::test]
        async fn execute_raw_returns_non_2xx_without_mapping() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 404,
                body: b"gone".to_vec(),
            })]);
            let shell = shell_with_mock(mock, "sk_test").with_base_url("http://mock");
            let response = shell
                .execute_raw(ShellRequest {
                    method: Method::Delete,
                    path: "/v1/sdk/products/prd".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "Delete product failed ({status}): {body}",
                })
                .await
                .expect("raw must not map status");
            assert_eq!(response.status, 404);
            assert_eq!(response.body, b"gone");
        }

        #[tokio::test]
        async fn execute_raw_rejects_empty_api_key() {
            let mock = MockTransport::new(vec![]);
            let shell = shell_with_mock(mock, "");
            let err = shell
                .execute_raw(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "unused",
                })
                .await
                .expect_err("empty key");
            match err {
                SdkError::Api { message, .. } => assert_eq!(message, "Missing apiKey"),
                other => panic!("expected Api, got {other:?}"),
            }
        }

        #[tokio::test]
        async fn success_2xx_returns_parsed_json_value() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{"plan":"plan_basic","remaining":10}"#.to_vec(),
            })]);
            let shell = shell_with_mock(mock, "sk_test").with_base_url("http://mock");
            let value = shell
                .execute(ShellRequest {
                    method: Method::Post,
                    path: "/v1/sdk/limits".to_owned(),
                    query: BTreeMap::new(),
                    body: Some(json!({})),
                    idempotency: Idempotency::None,
                    error_template: "Check limits failed ({status}): {body}",
                })
                .await
                .expect("200");
            assert_eq!(value, json!({"plan":"plan_basic","remaining":10}));
        }

        #[tokio::test]
        async fn retryable_transport_errors_retry_with_recorded_delays() {
            let mock = MockTransport::new(vec![
                Err(SdkError::transport("boom1", true)),
                Err(SdkError::transport("boom2", true)),
                Ok(HttpResponse {
                    status: 200,
                    body: br#"{"ok":true}"#.to_vec(),
                }),
            ]);
            let delays = Arc::new(Mutex::new(Vec::new()));
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test")
                .with_base_url("http://mock")
                .with_retry_policy(RetryPolicy::default())
                .with_sleeper(recording_sleeper(Arc::clone(&delays)));
            let value = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect("eventual success");
            assert_eq!(value, json!({"ok": true}));
            assert_eq!(mock.recorded().len(), 3);
            assert_eq!(*delays.lock().expect("lock"), vec![500, 500]);
        }

        #[tokio::test]
        async fn non_retryable_transport_error_does_not_retry() {
            let mock = MockTransport::new(vec![Err(SdkError::transport("bad url", false))]);
            let delays = Arc::new(Mutex::new(Vec::new()));
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test")
                .with_base_url("http://mock")
                .with_retry_policy(RetryPolicy::default())
                .with_sleeper(recording_sleeper(Arc::clone(&delays)));
            let err = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect_err("must fail");
            assert!(matches!(
                err,
                SdkError::Transport {
                    retryable: false,
                    ..
                }
            ));
            assert_eq!(mock.recorded().len(), 1);
            assert!(delays.lock().expect("lock").is_empty());
        }

        #[tokio::test]
        async fn non_2xx_status_does_not_retry() {
            let mock = MockTransport::new(vec![Ok(HttpResponse {
                status: 500,
                body: b"nope".to_vec(),
            })]);
            let delays = Arc::new(Mutex::new(Vec::new()));
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test")
                .with_base_url("http://mock")
                .with_retry_policy(RetryPolicy::default())
                .with_sleeper(recording_sleeper(Arc::clone(&delays)));
            let err = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect_err("500");
            assert!(matches!(
                err,
                SdkError::Api {
                    status: Some(500),
                    ..
                }
            ));
            assert_eq!(mock.recorded().len(), 1);
            assert!(delays.lock().expect("lock").is_empty());
        }

        #[tokio::test]
        async fn retry_exhaustion_returns_last_transport_error() {
            let mock = MockTransport::new(vec![
                Err(SdkError::transport("a", true)),
                Err(SdkError::transport("b", true)),
                Err(SdkError::transport("c", true)),
            ]);
            let delays = Arc::new(Mutex::new(Vec::new()));
            let shell = shell_with_mock(Arc::clone(&mock), "sk_test")
                .with_base_url("http://mock")
                .with_retry_policy(RetryPolicy {
                    max_retries: 2,
                    initial_delay_ms: 500,
                    backoff: Backoff::Fixed,
                })
                .with_sleeper(recording_sleeper(Arc::clone(&delays)));
            let err = shell
                .execute(ShellRequest {
                    method: Method::Get,
                    path: "/v1/sdk/x".to_owned(),
                    query: BTreeMap::new(),
                    body: None,
                    idempotency: Idempotency::None,
                    error_template: "failed ({status}): {body}",
                })
                .await
                .expect_err("exhausted");
            match err {
                SdkError::Transport { message, retryable } => {
                    assert_eq!(message, "c");
                    assert!(retryable);
                }
                other => panic!("expected last transport error, got {other:?}"),
            }
            assert_eq!(mock.recorded().len(), 3);
            assert_eq!(*delays.lock().expect("lock"), vec![500, 500]);
        }
    }
}
