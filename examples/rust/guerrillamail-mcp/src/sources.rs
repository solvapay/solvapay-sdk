//! Guerrilla Mail upstream: fixture replay and live HTTP.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;
use serde_json::Value;

use crate::error::ExampleError;
use crate::session::{Session, SessionStore};

/// Default `ip` query parameter required by every Guerrilla Mail call.
pub const DEFAULT_IP: &str = "127.0.0.1";
/// Default `agent` query parameter required by every Guerrilla Mail call.
pub const DEFAULT_AGENT: &str = "solvapay-guerrillamail-mcp";
/// Live origin confirmed by the recording probe (`https` works; `http` 301s away).
pub const LIVE_AJAX_URL: &str = "https://api.guerrillamail.com/ajax.php";

/// One recorded or outbound Guerrilla Mail call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRequest {
    /// API function name (`f`).
    pub function: String,
    /// Extra query pairs (may repeat keys such as `email_ids[]`).
    pub params: Vec<(String, String)>,
    /// Session credential sent as `sid_token`, when any.
    pub sid_token: Option<String>,
}

/// Parsed JSON body from Guerrilla Mail.
#[derive(Debug, Clone)]
pub struct SourceResponse {
    /// Response object.
    pub body: Value,
}

impl SourceResponse {
    /// `sid_token` from the JSON body, when present and non-empty.
    #[must_use]
    pub fn sid_token(&self) -> Option<String> {
        self.body
            .get("sid_token")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
    }
}

/// Injectable Guerrilla Mail client.
pub trait Source: Send + Sync {
    /// Invoke one API function.
    fn call(&self, request: SourceRequest) -> BoxFuture<'_, Result<SourceResponse, ExampleError>>;
}

/// Offline source that serves recorded JSON from `fixtures/`.
pub struct FixtureSource {
    /// Directory of `{function}.json` files.
    dir: PathBuf,
    /// In-memory replacements used by tests.
    overrides: BTreeMap<String, Value>,
    /// Calls observed so far.
    requests: Mutex<Vec<SourceRequest>>,
}

impl FixtureSource {
    /// Load `{function}.json` from `dir`.
    #[must_use]
    pub fn from_dir(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            overrides: BTreeMap::new(),
            requests: Mutex::new(Vec::new()),
        }
    }

    /// Serve an in-memory body for one function (tests).
    #[must_use]
    pub fn with_body(function: &str, body: Value) -> Self {
        let mut overrides = BTreeMap::new();
        overrides.insert(function.to_owned(), body);
        Self {
            dir: PathBuf::new(),
            overrides,
            requests: Mutex::new(Vec::new()),
        }
    }

    /// Override one function's body on an existing directory-backed source.
    #[must_use]
    pub fn override_function(mut self, function: &str, body: Value) -> Self {
        self.overrides.insert(function.to_owned(), body);
        self
    }

    /// Calls observed so far.
    ///
    /// # Errors
    ///
    /// When the mutex is poisoned.
    pub fn recorded_requests(&self) -> Result<Vec<SourceRequest>, ExampleError> {
        self.requests
            .lock()
            .map(|g| g.clone())
            .map_err(|_| ExampleError::new("fixture request log lock poisoned"))
    }

    /// Load an override or `{dir}/{function}.json`.
    fn load_body(&self, function: &str) -> Result<Value, ExampleError> {
        if let Some(body) = self.overrides.get(function) {
            return Ok(body.clone());
        }
        if self.dir.as_os_str().is_empty() {
            return Err(ExampleError::new(format!(
                "missing fixture for Guerrilla Mail function {function}"
            )));
        }
        let path = self.dir.join(format!("{function}.json"));
        let text = std::fs::read_to_string(&path).map_err(|_| {
            ExampleError::new(format!(
                "missing fixture for Guerrilla Mail function {function} ({})",
                path.display()
            ))
        })?;
        serde_json::from_str(&text).map_err(|e| {
            ExampleError::new(format!(
                "invalid JSON fixture for Guerrilla Mail function {function}: {e}"
            ))
        })
    }
}

impl Source for FixtureSource {
    fn call(&self, request: SourceRequest) -> BoxFuture<'_, Result<SourceResponse, ExampleError>> {
        Box::pin(async move {
            let recorded = with_required_params(request);
            {
                let mut log = self
                    .requests
                    .lock()
                    .map_err(|_| ExampleError::new("fixture request log lock poisoned"))?;
                log.push(recorded.clone());
            }
            let body = self.load_body(&recorded.function)?;
            Ok(SourceResponse { body })
        })
    }
}

/// Live HTTP source. Tests drive this through wiremock, never guerrillamail.com.
pub struct LiveSource {
    /// Ajax endpoint (`https://api.guerrillamail.com/ajax.php` or wiremock).
    base_url: String,
    /// Client with 5s connect / 8s overall timeout.
    client: reqwest::Client,
}

impl LiveSource {
    /// Talk to the confirmed HTTPS ajax endpoint.
    ///
    /// # Errors
    ///
    /// When the reqwest client cannot be built.
    pub fn new() -> Result<Self, ExampleError> {
        Self::with_base_url(LIVE_AJAX_URL)
    }

    /// Talk to an arbitrary ajax URL (wiremock).
    ///
    /// # Errors
    ///
    /// When the reqwest client cannot be built.
    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self, ExampleError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| ExampleError::new(format!("build Guerrilla Mail HTTP client: {e}")))?;
        Ok(Self {
            base_url: base_url.into(),
            client,
        })
    }

    /// Required params plus `sid_token` when the caller stored one.
    fn query_pairs(request: &SourceRequest) -> Vec<(String, String)> {
        let mut pairs = with_required_params(request.clone()).params;
        if let Some(sid) = &request.sid_token {
            if !pairs.iter().any(|(k, _)| k == "sid_token") {
                pairs.push(("sid_token".to_owned(), sid.clone()));
            }
        }
        pairs
    }
}

impl Source for LiveSource {
    fn call(&self, request: SourceRequest) -> BoxFuture<'_, Result<SourceResponse, ExampleError>> {
        Box::pin(async move {
            let pairs = Self::query_pairs(&request);
            let response = self
                .client
                .get(&self.base_url)
                .query(&pairs)
                .send()
                .await
                .map_err(|e| {
                    ExampleError::new(format!(
                        "Guerrilla Mail {} request failed: {e}",
                        request.function
                    ))
                })?;
            let status = response.status();
            let text = response.text().await.map_err(|e| {
                ExampleError::new(format!(
                    "Guerrilla Mail {} read failed: {e}",
                    request.function
                ))
            })?;
            if !status.is_success() {
                return Err(ExampleError::new(format!(
                    "Guerrilla Mail {} returned HTTP {status}: {text}",
                    request.function
                )));
            }
            let body: Value = serde_json::from_str(&text).map_err(|_| {
                ExampleError::new(format!(
                    "Guerrilla Mail {} returned non-JSON body: {text}",
                    request.function
                ))
            })?;
            Ok(SourceResponse { body })
        })
    }
}

/// Attach required `f` / `ip` / `agent` params (without dropping caller extras).
#[must_use]
pub fn with_required_params(mut request: SourceRequest) -> SourceRequest {
    if !request.params.iter().any(|(k, _)| k == "f") {
        request
            .params
            .insert(0, ("f".to_owned(), request.function.clone()));
    }
    if !request.params.iter().any(|(k, _)| k == "ip") {
        request
            .params
            .push(("ip".to_owned(), DEFAULT_IP.to_owned()));
    }
    if !request.params.iter().any(|(k, _)| k == "agent") {
        request
            .params
            .push(("agent".to_owned(), DEFAULT_AGENT.to_owned()));
    }
    request
}

/// Call Guerrilla Mail, sending and rotating the stored `sid_token`.
///
/// # Errors
///
/// Source, lock, or session-update failures.
pub async fn call_with_session(
    source: &dyn Source,
    store: &SessionStore,
    customer_ref: &str,
    function: &str,
    params: Vec<(String, String)>,
) -> Result<SourceResponse, ExampleError> {
    let existing = store.get(customer_ref)?;
    let sid_token = existing.as_ref().and_then(|s| s.sid_token.clone());
    let response = source
        .call(SourceRequest {
            function: function.to_owned(),
            params,
            sid_token,
        })
        .await?;
    let mut session = existing.unwrap_or_else(Session::new);
    if let Some(sid) = response.sid_token() {
        session.sid_token = Some(sid);
    }
    if let Some(addr) = response
        .body
        .get("email_addr")
        .or_else(|| response.body.get("email"))
        .and_then(Value::as_str)
    {
        session.email_addr = Some(addr.to_owned());
    }
    if let Some(ts) =
        json_i64(response.body.get("email_timestamp")).or_else(|| json_i64(response.body.get("ts")))
    {
        session.email_timestamp = Some(ts);
    }
    store.put(customer_ref, session)?;
    Ok(response)
}

/// Parse a JSON number or numeric string as `i64`.
#[must_use]
pub fn json_i64(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value.as_i64().or_else(|| {
        value
            .as_u64()
            .and_then(|n| i64::try_from(n).ok())
            .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
    })
}

/// Parse a JSON number or numeric string as `u64`.
///
/// # Errors
///
/// When the value is present but not a non-negative integer.
pub fn json_u64_required(value: Option<&Value>, field: &str) -> Result<u64, ExampleError> {
    let Some(value) = value else {
        return Err(ExampleError::new(format!("missing {field}")));
    };
    if let Some(n) = value.as_u64() {
        return Ok(n);
    }
    if let Some(n) = value.as_i64() {
        return u64::try_from(n)
            .map_err(|_| ExampleError::new(format!("{field} is negative: {n}")));
    }
    if let Some(s) = value.as_str() {
        return s
            .trim()
            .parse::<u64>()
            .map_err(|_| ExampleError::new(format!("{field} is not an integer: {s:?}")));
    }
    Err(ExampleError::new(format!(
        "{field} is not an integer: {value}"
    )))
}

/// Directory that holds the recorded JSON fixtures next to this crate.
#[must_use]
pub fn default_fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// Shared source handle.
pub type SharedSource = Arc<dyn Source>;

#[cfg(test)]
#[allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture_dir() -> PathBuf {
        default_fixture_dir()
    }

    #[tokio::test]
    async fn get_email_address_fixture_returns_body_and_sid() {
        let source = FixtureSource::from_dir(fixture_dir());
        let response = source
            .call(SourceRequest {
                function: "get_email_address".to_owned(),
                params: Vec::new(),
                sid_token: None,
            })
            .await
            .unwrap();
        assert_eq!(
            response.body["email_addr"],
            "solvatestinbox@guerrillamailblock.com"
        );
        assert_eq!(response.sid_token().as_deref(), Some("sid_alpha"));
        let recorded = source.recorded_requests().unwrap();
        assert_eq!(recorded.len(), 1);
        assert!(recorded[0]
            .params
            .iter()
            .any(|(k, v)| k == "f" && v == "get_email_address"));
        assert!(recorded[0].params.iter().any(|(k, _)| k == "ip"));
        assert!(recorded[0].params.iter().any(|(k, _)| k == "agent"));
    }

    #[tokio::test]
    async fn missing_fixture_names_the_function() {
        let source = FixtureSource::from_dir(fixture_dir());
        let err = source
            .call(SourceRequest {
                function: "forget_me".to_owned(),
                params: Vec::new(),
                sid_token: None,
            })
            .await
            .expect_err("missing fixture");
        assert!(err.message().contains("forget_me"), "{}", err.message());
    }

    #[tokio::test]
    async fn second_call_sends_stored_sid_and_rotation_replaces_it() {
        let source = FixtureSource::from_dir(fixture_dir()).override_function(
            "check_email",
            json!({
                "list": [],
                "count": "0",
                "sid_token": "sid_rotated"
            }),
        );
        let store = SessionStore::new();
        call_with_session(&source, &store, "cus_1", "get_email_address", Vec::new())
            .await
            .unwrap();
        assert_eq!(
            store.get("cus_1").unwrap().unwrap().sid_token.as_deref(),
            Some("sid_alpha")
        );
        call_with_session(&source, &store, "cus_1", "check_email", Vec::new())
            .await
            .unwrap();
        let recorded = source.recorded_requests().unwrap();
        assert_eq!(recorded[1].function, "check_email");
        assert_eq!(recorded[1].sid_token.as_deref(), Some("sid_alpha"));
        assert!(recorded[1].params.iter().any(|(k, _)| k == "f"));
        assert!(recorded[1].params.iter().any(|(k, _)| k == "ip"));
        assert!(recorded[1].params.iter().any(|(k, _)| k == "agent"));
        assert_eq!(
            store.get("cus_1").unwrap().unwrap().sid_token.as_deref(),
            Some("sid_rotated")
        );
    }
}
