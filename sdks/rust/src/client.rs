//! Async SolvaPay client — thin facade over [`SolvaPayClient`] plus gate plumbing.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use solvapay_core::{
    ensure_customer_next, gate_next, should_retry_usage_error, EnsureCustomerAction, GateAction,
    GateCacheOp, HelperErrorResult, RetryPolicy, SdkError,
};
use solvapay_dto::{
    CheckLimitRequest, CheckLimitsRequest, CreateCustomerRequest, GetCustomerParams,
    TrackUsageRequest, UpdateCustomerParams,
};
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient};
use tokio::sync::{Mutex, Notify};

use crate::config::{Config, CUSTOMER_DEDUP_MAX_CACHE_SIZE};
use crate::gate::{Allow, GateOpts, GateOutcome, Payable};
use crate::retry::with_retry_if;

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

#[derive(Clone)]
struct CustomerCacheEntry {
    value: String,
    timestamp_ms: i64,
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
            "limitsCacheTTLMs": self.inner.limits_cache_ttl_ms,
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
                GateAction::ReadLimitsCache { key } => {
                    let now = now_ms();
                    let hit = {
                        let gate = self.inner.gate.lock().await;
                        gate.limits_cache.get(&key).map(|entry| {
                            (entry.remaining, entry.limits.clone(), entry.timestamp_ms)
                        })
                    };
                    if let Some((remaining, limits, timestamp_ms)) = hit {
                        event = serde_json::json!({
                            "kind": "limitsCacheEntry",
                            "found": true,
                            "remaining": remaining,
                            "limits": limits,
                            "timestampMs": timestamp_ms,
                            "nowMs": now,
                            "randomUnit": self.random_unit(),
                        });
                    } else {
                        event = serde_json::json!({
                            "kind": "limitsCacheEntry",
                            "found": false,
                            "nowMs": now,
                            "randomUnit": self.random_unit(),
                        });
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
                        "randomUnit": self.random_unit(),
                    });
                }
                GateAction::Allow {
                    customer_ref: backend_ref,
                    product,
                    meter_name,
                    limits,
                    customer,
                    cache,
                } => {
                    self.apply_gate_cache(cache).await;
                    return Ok(GateOutcome::Allow(Allow {
                        client: self.clone(),
                        backend_ref,
                        product,
                        meter_name,
                        limits,
                        customer: Allow::from_core_customer(customer),
                        driver_state: state.clone().unwrap_or(Value::Null),
                    }));
                }
                GateAction::Gate {
                    gate,
                    cache,
                    request,
                    ..
                } => {
                    self.apply_gate_cache(cache).await;
                    self.post_usage_request(request).await?;
                    return Ok(GateOutcome::Paywall(gate));
                }
                GateAction::EmitUsage { .. } | GateAction::SkipUsage => {
                    return Err(SdkError::transport(
                        "gate_next returned a usage action during decide",
                        false,
                    ));
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

    pub(crate) fn random_unit(&self) -> f64 {
        self.inner.api.shell().random_unit()
    }

    pub(crate) async fn emit_handler_usage(
        &self,
        state: &Value,
        event: Value,
    ) -> Result<(), SdkError> {
        let out = gate_next(Some(state), Some(&event)).map_err(helper_to_sdk)?;
        match out.action {
            GateAction::SkipUsage => Ok(()),
            GateAction::EmitUsage { request } => self.post_usage_request(request).await,
            other => Err(SdkError::transport(
                format!("gate_next handler event returned unexpected action: {other:?}"),
                false,
            )),
        }
    }

    pub(crate) async fn post_usage_request(&self, request: Value) -> Result<(), SdkError> {
        let params: TrackUsageRequest = serde_json::from_value(request)
            .map_err(|err| SdkError::transport(format!("gate_next usage request: {err}"), false))?;
        with_retry_if(
            || self.inner.api.track_usage(params.clone()),
            RetryPolicy::default(),
            |err, _attempt| should_retry_usage_error(&sdk_error_message(err)),
        )
        .await?;
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
                checkout_url: _,
                meter_name: _,
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
        let mut state: Option<Value> = None;
        let mut event = serde_json::json!({
            "kind": "start",
            "customerRef": customer_ref,
            "canCreateCustomer": true,
            "canUpdateCustomer": true,
            "nowMs": now_ms() as i64,
        });
        loop {
            let out = ensure_customer_next(state.as_ref(), Some(&event)).map_err(helper_to_sdk)?;
            state = Some(serde_json::to_value(&out.state).map_err(|err| {
                SdkError::transport(format!("ensure_customer_next state: {err}"), false)
            })?);
            match out.action {
                EnsureCustomerAction::ReadCustomerCache { key } => {
                    let cached = {
                        let gate = self.inner.gate.lock().await;
                        gate.customer_cache.get(&key).cloned()
                    };
                    event = match cached {
                        Some(entry) => serde_json::json!({
                            "kind": "customerCacheEntry",
                            "found": true,
                            "backendRef": entry.value,
                            "timestampMs": entry.timestamp_ms,
                            "nowMs": now_ms() as i64,
                        }),
                        None => serde_json::json!({
                            "kind": "customerCacheEntry",
                            "found": false,
                            "nowMs": now_ms() as i64,
                        }),
                    };
                }
                EnsureCustomerAction::GetCustomer {
                    by_external_ref,
                    by_email,
                } => {
                    let lookup = GetCustomerParams {
                        customer_ref: None,
                        email: by_email,
                        external_ref: by_external_ref,
                    };
                    match self.inner.api.get_customer(lookup).await {
                        Ok(mapped) if !mapped.customer_ref.is_empty() => {
                            event = serde_json::json!({
                                "kind": "customerLookupResult",
                                "found": true,
                                "customer": {
                                    "customerRef": mapped.customer_ref,
                                    "externalRef": mapped.external_ref,
                                },
                                "nowMs": now_ms() as i64,
                            });
                        }
                        Ok(_) => {
                            event = serde_json::json!({
                                "kind": "customerLookupResult",
                                "found": false,
                                "nowMs": now_ms() as i64,
                            });
                        }
                        Err(err) => {
                            event = serde_json::json!({
                                "kind": "customerLookupResult",
                                "found": false,
                                "errorMessage": sdk_error_message(&err),
                                "nowMs": now_ms() as i64,
                            });
                        }
                    }
                }
                EnsureCustomerAction::CreateCustomer { params } => {
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
                    match self.inner.api.create_customer(request).await {
                        Ok(created) => {
                            event = serde_json::json!({
                                "kind": "customerCreateResult",
                                "ok": true,
                                "customer": { "customerRef": created.customer_ref },
                                "nowMs": now_ms() as i64,
                            });
                        }
                        Err(err) => {
                            event = serde_json::json!({
                                "kind": "customerCreateResult",
                                "ok": false,
                                "errorMessage": sdk_error_message(&err),
                                "nowMs": now_ms() as i64,
                            });
                        }
                    }
                }
                EnsureCustomerAction::UpdateCustomer {
                    customer_ref: backend,
                    patch,
                } => {
                    let params = UpdateCustomerParams {
                        email: None,
                        external_ref: patch
                            .get("externalRef")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        metadata: None,
                        name: None,
                        telephone: None,
                    };
                    match self.inner.api.update_customer(&backend, params).await {
                        Ok(_) => {
                            event = serde_json::json!({
                                "kind": "customerUpdateResult",
                                "ok": true,
                                "nowMs": now_ms() as i64,
                            });
                        }
                        Err(err) => {
                            event = serde_json::json!({
                                "kind": "customerUpdateResult",
                                "ok": false,
                                "errorMessage": sdk_error_message(&err),
                                "nowMs": now_ms() as i64,
                            });
                        }
                    }
                }
                EnsureCustomerAction::Resolved { backend_ref, cache } => {
                    if let Some(write) = cache {
                        let mut gate = self.inner.gate.lock().await;
                        insert_customer_cache(
                            &mut gate.customer_cache,
                            write.key,
                            CustomerCacheEntry {
                                value: write.backend_ref,
                                timestamp_ms: write.timestamp_ms,
                            },
                        );
                    }
                    return Ok(backend_ref);
                }
            }
        }
    }
}

fn build_shell(transport: SharedTransport, config: &Config) -> ClientShell {
    let mut shell = ClientShell::new(transport, config.api_key.clone());
    if let Some(base) = config.api_base_url.as_deref() {
        shell = shell.with_base_url(base);
    }
    shell.with_retry_policy(config.retry_policy)
}

fn insert_customer_cache(
    cache: &mut HashMap<String, CustomerCacheEntry>,
    key: String,
    entry: CustomerCacheEntry,
) {
    cache.insert(key, entry);
    let overflow = cache.len().saturating_sub(CUSTOMER_DEDUP_MAX_CACHE_SIZE);
    if overflow == 0 {
        return;
    }
    let mut oldest: Vec<(String, i64)> = cache
        .iter()
        .map(|(cache_key, cached)| (cache_key.clone(), cached.timestamp_ms))
        .collect();
    oldest.sort_by_key(|(_, timestamp)| *timestamp);
    for (cache_key, _) in oldest.into_iter().take(overflow) {
        cache.remove(&cache_key);
    }
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn sdk_error_message(err: &SdkError) -> String {
    match err {
        SdkError::Api { message, .. }
        | SdkError::Paywall { message, .. }
        | SdkError::Transport { message, .. } => message.clone(),
        other => format!("{other:?}"),
    }
}

fn helper_to_sdk(err: HelperErrorResult) -> SdkError {
    SdkError::Api {
        message: err.details.unwrap_or(err.error),
        status: Some(err.status),
        code: None,
    }
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
    fn customer_cache_evicts_past_max() {
        assert_eq!(CUSTOMER_DEDUP_MAX_CACHE_SIZE, 1000);
        let mut cache = HashMap::new();
        for index in 0..=CUSTOMER_DEDUP_MAX_CACHE_SIZE {
            insert_customer_cache(
                &mut cache,
                format!("k{index}"),
                CustomerCacheEntry {
                    value: format!("cus_{index}"),
                    timestamp_ms: index as i64,
                },
            );
        }
        assert!(!cache.contains_key("k0"));
        assert!(cache.contains_key(&format!("k{CUSTOMER_DEDUP_MAX_CACHE_SIZE}")));
        assert_eq!(cache.len(), CUSTOMER_DEDUP_MAX_CACHE_SIZE);
    }

    #[test]
    fn iso8601_millis_unix_epoch() {
        assert_eq!(solvapay_core::iso8601_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            solvapay_core::iso8601_millis(1_704_067_200_123),
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

    #[tokio::test]
    async fn allow_track_fail_paywall_error_skips_usage() {
        use solvapay_core::{PaywallGate, PaywallGateKind};

        let limits_body = br#"{"withinLimits":true,"remaining":1,"plan":"pro"}"#;
        let mock = MockTransport::new(vec![Ok(HttpResponse {
            status: 200,
            body: limits_body.to_vec(),
        })]);
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
        let err = SdkError::paywall(
            "Payment required",
            PaywallGate {
                kind: PaywallGateKind::PaymentRequired,
                product: "prd_x".to_owned(),
                checkout_url: String::new(),
                message: "Payment required".to_owned(),
                short_message: "Payment required".to_owned(),
                confirmation_url: None,
                plans: None,
                balance: None,
                product_details: None,
            },
        );
        allow
            .track_fail(err, TrackOpts::default())
            .await
            .expect("track_fail");
        assert_eq!(mock.recorded().len(), 1);
    }
}
