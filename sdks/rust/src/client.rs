//! Async SolvaPay client — thin facade over [`SolvaPayClient`] plus gate plumbing.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use solvapay_core::{
    build_create_customer_params, classify_customer_ref, extract_backend_customer_ref, gate_next,
    CustomerRefKind, GateAction, GateCacheOp, HelperErrorResult, SdkError,
};
use solvapay_dto::{
    CheckLimitRequest, CheckLimitsRequest, CreateCustomerRequest, CreateUsageRequest,
    CreateUsageRequestActionType, CreateUsageRequestOutcome, GetCustomerParams, TrackUsageRequest,
};
use solvapay_transport::random9_from_f64;
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient};
use tokio::sync::{Mutex, Notify};

use crate::config::Config;
use crate::gate::{Allow, GateOpts, GateOutcome, Payable};

const CUSTOMER_CACHE_TTL_MS: u64 = 60_000;

/// Public async SolvaPay SDK client.
#[derive(Clone)]
pub struct Client {
    inner: Arc<ClientInner>,
}

struct ClientInner {
    api: SolvaPayClient,
    limits_cache_ttl_ms: u64,
    gate: Mutex<GateState>,
}

struct GateState {
    limits_cache: HashMap<String, LimitsCacheEntry>,
    customer_cache: HashMap<String, CustomerCacheEntry>,
    customer_inflight: HashMap<String, Arc<CustomerInflight>>,
}

struct LimitsCacheEntry {
    timestamp_ms: u64,
    remaining: f64,
    limits: Value,
}

struct CustomerCacheEntry {
    value: String,
    expires_at_ms: u64,
}

struct CustomerInflight {
    notify: Notify,
    done: Mutex<bool>,
    result: Mutex<Option<Result<String, SdkError>>>,
}

impl Client {
    /// Builds a client with the default native [`solvapay_transport::ReqwestTransport`].
    ///
    /// # Errors
    ///
    /// Returns [`SdkError::Transport`] when the HTTP client fails to initialize.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(config: Config) -> Result<Self, SdkError> {
        let transport: SharedTransport = Arc::new(solvapay_transport::ReqwestTransport::new()?);
        Ok(Self::with_transport(transport, config))
    }

    /// Builds a client over an injected transport (tests, custom HTTP stacks).
    pub fn with_transport(transport: SharedTransport, config: Config) -> Self {
        let shell = build_shell(transport, &config);
        Self::with_shell(shell, config)
    }

    /// Builds a client from a preconfigured [`ClientShell`] (fixture clock/rng hooks).
    pub fn with_shell(shell: ClientShell, config: Config) -> Self {
        let api = SolvaPayClient::new(shell);
        Self {
            inner: Arc::new(ClientInner {
                api,
                limits_cache_ttl_ms: config.limits_cache_ttl_ms,
                gate: Mutex::new(GateState {
                    limits_cache: HashMap::new(),
                    customer_cache: HashMap::new(),
                    customer_inflight: HashMap::new(),
                }),
            }),
        }
    }

    /// Paywall gate for a customer and product (§2.4). Sequencing is [`gate_next`].
    pub async fn gate(&self, customer_ref: &str, opts: GateOpts) -> Result<GateOutcome, SdkError> {
        let started_ms = now_ms();
        let mut state: Option<Value> = None;
        let mut event = serde_json::json!({
            "kind": "start",
            "customerRef": customer_ref,
            "product": opts.product,
            "usageType": opts.usage_type,
            "startedMs": started_ms,
        });
        loop {
            let out = gate_next(state.as_ref(), Some(&event)).map_err(helper_to_sdk)?;
            state = Some(serde_json::to_value(&out.state).map_err(|err| {
                SdkError::transport(format!("serialize gate state: {err}"), false)
            })?);
            match out.action {
                GateAction::EnsureCustomer {
                    customer_ref: ref_to_ensure,
                } => {
                    let backend = self.ensure_customer(&ref_to_ensure).await?;
                    event = serde_json::json!({
                        "kind": "customerResolved",
                        "backendRef": backend,
                        "nowMs": now_ms(),
                    });
                }
                GateAction::LookupCache { key } => {
                    let now = now_ms();
                    let hit = {
                        let gate = self.inner.gate.lock().await;
                        gate.limits_cache.get(&key).and_then(|entry| {
                            (now.saturating_sub(entry.timestamp_ms)
                                < self.inner.limits_cache_ttl_ms)
                                .then(|| (entry.remaining, entry.limits.clone()))
                        })
                    };
                    if let Some((remaining, limits)) = hit {
                        event = serde_json::json!({
                            "kind": "cacheHit",
                            "remaining": remaining,
                            "limits": limits,
                            "nowMs": now,
                        });
                    } else {
                        {
                            let mut gate = self.inner.gate.lock().await;
                            gate.limits_cache.remove(&key);
                        }
                        event = serde_json::json!({ "kind": "cacheMiss", "nowMs": now });
                    }
                }
                GateAction::CheckLimits {
                    customer_ref: backend,
                    product_ref,
                    meter_name,
                    include_checkout_session,
                    cache_delete_key,
                } => {
                    if let Some(key) = cache_delete_key {
                        let mut gate = self.inner.gate.lock().await;
                        gate.limits_cache.remove(&key);
                    }
                    let limits = self
                        .fetch_limits(
                            &backend,
                            &product_ref,
                            &meter_name,
                            include_checkout_session,
                        )
                        .await?;
                    event = serde_json::json!({
                        "kind": "limitsResult",
                        "limits": limits,
                        "nowMs": now_ms(),
                    });
                }
                GateAction::Done {
                    outcome,
                    customer_ref: backend_ref,
                    product,
                    meter_name,
                    limits,
                    gate,
                    cache,
                    track,
                } => {
                    self.apply_gate_cache(cache).await;
                    if let Some(track) = track {
                        self.track_usage_event(
                            &track.customer_ref,
                            &track.product_ref,
                            &track.action,
                            CreateUsageRequestOutcome::Paywall,
                            track.duration_ms.max(0.0),
                            None,
                        )
                        .await?;
                    }
                    if outcome == "gate" {
                        let gate = gate.ok_or_else(|| {
                            SdkError::transport("gate_next done/gate missing gate", false)
                        })?;
                        return Ok(GateOutcome::Paywall(gate));
                    }
                    return Ok(GateOutcome::Allow(Allow {
                        client: self.clone(),
                        backend_ref,
                        product,
                        meter_name,
                        limits,
                    }));
                }
            }
        }
    }

    /// Returns a product-scoped helper for repeated gate calls.
    pub fn payable(&self, product: impl Into<String>, usage_type: impl Into<String>) -> Payable {
        Payable {
            client: self.clone(),
            product: product.into(),
            usage_type: usage_type.into(),
        }
    }

    pub(crate) async fn track_usage_event(
        &self,
        backend_ref: &str,
        product: &str,
        action: &str,
        outcome: CreateUsageRequestOutcome,
        duration_ms: f64,
        extra_metadata: Option<Map<String, Value>>,
    ) -> Result<(), SdkError> {
        let shell = self.inner.api.shell();
        let now_ms = shell.now_ms();
        let request_id = format!(
            "solvapay_{}_{}",
            now_ms,
            random9_from_f64(shell.random_unit())
        );
        let mut metadata = extra_metadata.unwrap_or_default();
        metadata.insert("action".to_owned(), Value::String(action.to_owned()));
        metadata.insert("requestId".to_owned(), Value::String(request_id));
        let overlay: BTreeMap<String, Value> = metadata.into_iter().collect();

        let base = CreateUsageRequest {
            customer_ref: Some(backend_ref.to_owned()),
            product_ref: Some(product.to_owned()),
            duration: Some(duration_ms),
            metadata: None,
            action_type: Some(CreateUsageRequestActionType::ApiCall),
            description: None,
            error_message: None,
            idempotency_key: None,
            outcome: Some(outcome),
            purchase_ref: None,
            timestamp: Some(iso8601_millis(now_ms)),
            units: Some(1),
        };

        let params = TrackUsageRequest {
            customer_ref: backend_ref.to_owned(),
            base,
            metadata: Some(overlay),
        };
        self.inner.api.track_usage(params).await?;
        Ok(())
    }

    async fn apply_gate_cache(&self, cache: Option<GateCacheOp>) {
        let Some(cache) = cache else {
            return;
        };
        let mut gate = self.inner.gate.lock().await;
        match cache {
            GateCacheOp::Delete { key } => {
                gate.limits_cache.remove(&key);
            }
            GateCacheOp::UpdateRemaining { key, remaining } => {
                if let Some(entry) = gate.limits_cache.get_mut(&key) {
                    entry.remaining = remaining;
                }
            }
            GateCacheOp::Set {
                key,
                remaining,
                limits,
                timestamp,
            } => {
                gate.limits_cache.insert(
                    key,
                    LimitsCacheEntry {
                        timestamp_ms: timestamp.max(0) as u64,
                        remaining,
                        limits,
                    },
                );
            }
        }
    }

    async fn fetch_limits(
        &self,
        customer_ref: &str,
        product: &str,
        usage_type: &str,
        include_checkout_session: bool,
    ) -> Result<Value, SdkError> {
        let include = include_checkout_session.then_some(true);
        let params = CheckLimitsRequest {
            base: CheckLimitRequest {
                customer_ref: Some(customer_ref.to_owned()),
                product_ref: Some(product.to_owned()),
                meter_name: Some(usage_type.to_owned()),
                include_checkout_session: include,
                usage_type: None,
            },
            include_checkout_session: include,
        };
        self.inner.api.check_limits(params).await
    }

    async fn ensure_customer(&self, customer_ref: &str) -> Result<String, SdkError> {
        match classify_customer_ref(customer_ref) {
            CustomerRefKind::Anonymous | CustomerRefKind::Backend => {
                return Ok(customer_ref.to_owned());
            }
            CustomerRefKind::NeedsEnsure => {}
        }

        let now = now_ms();
        {
            let gate = self.inner.gate.lock().await;
            if let Some(entry) = gate.customer_cache.get(customer_ref) {
                if now < entry.expires_at_ms {
                    return Ok(entry.value.clone());
                }
            }
        }

        let (inflight, is_leader) = {
            let mut gate = self.inner.gate.lock().await;
            match gate.customer_inflight.get(customer_ref) {
                Some(existing) => (Arc::clone(existing), false),
                None => {
                    let cell = Arc::new(CustomerInflight {
                        notify: Notify::new(),
                        done: Mutex::new(false),
                        result: Mutex::new(None),
                    });
                    gate.customer_inflight
                        .insert(customer_ref.to_owned(), Arc::clone(&cell));
                    (cell, true)
                }
            }
        };

        if is_leader {
            let outcome = self.find_or_create_customer(customer_ref).await;
            {
                *inflight.done.lock().await = true;
                *inflight.result.lock().await = Some(outcome.clone());
            }
            inflight.notify.notify_waiters();
            {
                let mut gate = self.inner.gate.lock().await;
                gate.customer_inflight.remove(customer_ref);
            }
            return outcome;
        }

        loop {
            inflight.notify.notified().await;
            if *inflight.done.lock().await {
                let result = inflight.result.lock().await.clone();
                return result
                    .unwrap_or_else(|| Err(SdkError::transport("customer lookup failed", false)));
            }
        }
    }

    async fn find_or_create_customer(&self, customer_ref: &str) -> Result<String, SdkError> {
        let lookup = GetCustomerParams {
            customer_ref: None,
            email: None,
            external_ref: Some(customer_ref.to_owned()),
        };
        if let Ok(mapped) = self.inner.api.get_customer(lookup).await {
            if !mapped.customer_ref.is_empty() {
                self.cache_customer(customer_ref, &mapped.customer_ref)
                    .await;
                return Ok(mapped.customer_ref);
            }
        }

        let email = customer_ref.contains('@').then_some(customer_ref);
        let params = build_create_customer_params(
            customer_ref,
            Some(customer_ref),
            email,
            None,
            now_ms() as i64,
        );
        let request = CreateCustomerRequest {
            description: None,
            email: Some(params.email),
            external_ref: params.external_ref,
            metadata: Some(
                params
                    .metadata
                    .into_iter()
                    .collect::<std::collections::BTreeMap<_, _>>(),
            ),
            name: params.name,
            telephone: None,
        };
        let created = self.inner.api.create_customer(request).await?;
        let map = Map::from_iter([(
            "customerRef".to_owned(),
            Value::String(created.customer_ref.clone()),
        )]);
        let backend = extract_backend_customer_ref(&map, customer_ref);
        if backend.is_empty() {
            return Err(SdkError::transport(
                "createCustomer did not return customerRef",
                false,
            ));
        }
        self.cache_customer(customer_ref, &backend).await;
        Ok(backend)
    }

    async fn cache_customer(&self, key: &str, backend_ref: &str) {
        let expires = now_ms().saturating_add(CUSTOMER_CACHE_TTL_MS);
        let mut gate = self.inner.gate.lock().await;
        gate.customer_cache.insert(
            key.to_owned(),
            CustomerCacheEntry {
                value: backend_ref.to_owned(),
                expires_at_ms: expires,
            },
        );
    }
}

fn build_shell(transport: SharedTransport, config: &Config) -> ClientShell {
    let mut shell = ClientShell::new(transport, config.api_key.clone());
    if let Some(base) = config.api_base_url.as_deref() {
        shell = shell.with_base_url(base);
    }
    shell.with_retry_policy(config.retry_policy)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn helper_to_sdk(err: HelperErrorResult) -> SdkError {
    SdkError::Api {
        message: err.details.unwrap_or(err.error),
        status: Some(err.status),
        code: None,
    }
}

/// RFC 3339 UTC with millisecond precision (`2026-08-25T15:04:05.123Z`).
fn iso8601_millis(epoch_ms: u64) -> String {
    let total_secs = (epoch_ms / 1000) as i64;
    let millis = epoch_ms % 1000;
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let min = (secs_of_day % 3600) / 60;
    let sec = secs_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Howard Hinnant civil_from_days (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

#[path = "client_generated.rs"]
mod client_generated;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::gate::TrackOpts;
    use solvapay_transport::http::{HttpRequest, HttpResponse, Method};
    use solvapay_transport::transport::{BoxFuture, Transport};
    use std::sync::Mutex as StdMutex;

    struct MockTransport {
        responses: StdMutex<Vec<Result<HttpResponse, SdkError>>>,
        recorded: StdMutex<Vec<HttpRequest>>,
    }

    impl MockTransport {
        fn new(responses: Vec<Result<HttpResponse, SdkError>>) -> Arc<Self> {
            Arc::new(Self {
                responses: StdMutex::new(responses),
                recorded: StdMutex::new(Vec::new()),
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

    #[test]
    fn iso8601_millis_unix_epoch() {
        assert_eq!(iso8601_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso8601_millis(1_704_067_200_123),
            "2024-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn config_default_limits_ttl_is_10s() {
        assert_eq!(Config::default().limits_cache_ttl_ms, 10_000);
    }

    #[test]
    fn config_default_reads_env_api_key() {
        // SAFETY: test-only env mutation; single-threaded test harness.
        unsafe { std::env::set_var("SOLVAPAY_SECRET_KEY", "sk_from_env") };
        assert_eq!(Config::default().api_key, "sk_from_env");
        unsafe { std::env::remove_var("SOLVAPAY_SECRET_KEY") };
    }

    #[tokio::test]
    async fn client_with_transport_uses_injected_transport() {
        let mock = MockTransport::new(vec![Ok(HttpResponse {
            status: 200,
            body: br#"{"displayName":"Acme"}"#.to_vec(),
        })]);
        let client = Client::with_transport(
            mock.clone(),
            Config {
                api_key: "sk_test".to_owned(),
                ..Config::default()
            },
        );
        let merchant = client.get_merchant().await.expect("merchant");
        assert_eq!(merchant.display_name.as_deref(), Some("Acme"));
        let recorded = mock.recorded();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].method, Method::Get);
        assert!(recorded[0].url.contains("/v1/sdk/merchant"));
    }

    #[tokio::test]
    async fn gate_allow_returns_allow_when_within_limits() {
        let limits_body = br#"{"withinLimits":true,"remaining":3,"plan":"pro"}"#;
        let mock = MockTransport::new(vec![Ok(HttpResponse {
            status: 200,
            body: limits_body.to_vec(),
        })]);
        let client = Client::with_transport(
            mock,
            Config {
                api_key: "sk_test".to_owned(),
                ..Config::default()
            },
        );
        let outcome = client
            .gate(
                "cus_test",
                GateOpts {
                    product: "prd_x".to_owned(),
                    usage_type: "requests".to_owned(),
                },
            )
            .await
            .expect("gate");
        assert!(matches!(outcome, GateOutcome::Allow(_)));
    }

    #[tokio::test]
    async fn gate_paywall_returns_gate_when_over_limit() {
        let limits_body = br#"{"withinLimits":false,"remaining":0,"plan":"pro"}"#;
        let usage_ok = br#"{}"#;
        let mock = MockTransport::new(vec![
            Ok(HttpResponse {
                status: 200,
                body: limits_body.to_vec(),
            }),
            Ok(HttpResponse {
                status: 200,
                body: usage_ok.to_vec(),
            }),
        ]);
        let client = Client::with_transport(
            mock.clone(),
            Config {
                api_key: "sk_test".to_owned(),
                ..Config::default()
            },
        );
        let outcome = client
            .gate(
                "cus_test",
                GateOpts {
                    product: "prd_x".to_owned(),
                    usage_type: "requests".to_owned(),
                },
            )
            .await
            .expect("gate");
        assert!(matches!(outcome, GateOutcome::Paywall(_)));
        let recorded = mock.recorded();
        assert_eq!(recorded.len(), 2);
        assert!(recorded[1].url.contains("/v1/sdk/usages"));
        let body: Value =
            serde_json::from_slice(recorded[1].body.as_ref().expect("body")).expect("usage json");
        assert_eq!(body.get("outcome").and_then(Value::as_str), Some("paywall"));
        assert_eq!(
            body.get("actionType").and_then(Value::as_str),
            Some("api_call")
        );
        assert_eq!(body.get("units").and_then(Value::as_i64), Some(1));
        assert_eq!(
            body.get("metadata")
                .and_then(Value::as_object)
                .and_then(|m| m.get("action"))
                .and_then(Value::as_str),
            Some("requests")
        );
        assert!(body.get("timestamp").and_then(Value::as_str).is_some());
        assert!(body
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|m| m.get("requestId"))
            .and_then(Value::as_str)
            .is_some());
    }

    #[tokio::test]
    async fn allow_track_success_issues_track_usage() {
        let limits_body = br#"{"withinLimits":true,"remaining":1,"plan":"pro"}"#;
        let usage_ok = br#"{}"#;
        let mock = MockTransport::new(vec![
            Ok(HttpResponse {
                status: 200,
                body: limits_body.to_vec(),
            }),
            Ok(HttpResponse {
                status: 200,
                body: usage_ok.to_vec(),
            }),
        ]);
        let client = Client::with_transport(
            mock.clone(),
            Config {
                api_key: "sk_test".to_owned(),
                ..Config::default()
            },
        );
        let outcome = client
            .gate(
                "cus_test",
                GateOpts {
                    product: "prd_x".to_owned(),
                    usage_type: "requests".to_owned(),
                },
            )
            .await
            .expect("gate");
        let GateOutcome::Allow(allow) = outcome else {
            panic!("expected allow");
        };
        allow
            .track_success(TrackOpts::default())
            .await
            .expect("track");
        let recorded = mock.recorded();
        assert_eq!(recorded.len(), 2);
        assert_eq!(recorded[1].method, Method::Post);
        assert!(recorded[1].url.contains("/v1/sdk/usages"));
        let body: Value =
            serde_json::from_slice(recorded[1].body.as_ref().expect("body")).expect("usage json");
        assert_eq!(body.get("outcome").and_then(Value::as_str), Some("success"));
        assert_eq!(
            body.get("actionType").and_then(Value::as_str),
            Some("api_call")
        );
        assert_eq!(body.get("units").and_then(Value::as_i64), Some(1));
        assert_eq!(
            body.get("metadata")
                .and_then(Value::as_object)
                .and_then(|m| m.get("action"))
                .and_then(Value::as_str),
            Some("requests")
        );
        assert!(body.get("duration").is_some());
        assert!(body.get("timestamp").and_then(Value::as_str).is_some());
    }
}
