//! Async SolvaPay client — thin facade over [`SolvaPayClient`] plus gate plumbing.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use solvapay_core::{
    build_create_customer_params, classify_customer_ref, decide_paywall_outcome,
    evaluate_cached_limits, evaluate_fresh_limits, extract_backend_customer_ref, CustomerRefKind,
    PaywallOutcome, SdkError,
};
use solvapay_dto::{
    CheckLimitRequest, CheckLimitsRequest, CreateCustomerRequest, CreateUsageRequest,
    GetCustomerParams, TrackUsageRequest,
};
use solvapay_transport::{ClientShell, SharedTransport, SolvaPayClient};
use tokio::sync::{Mutex, Notify};

use crate::config::Config;
use crate::gate::{Allow, GateOpts, GateOutcome, Payable, TrackOpts};

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

    /// Paywall gate for a customer and product (§2.4). Limit decisions delegate to core.
    pub async fn gate(&self, customer_ref: &str, opts: GateOpts) -> Result<GateOutcome, SdkError> {
        let backend_ref = self.ensure_customer(customer_ref).await?;
        let limits_key = format!("{}:{}:{}", backend_ref, opts.product, opts.usage_type);
        let (within_limits, _remaining, limits) = self
            .evaluate_limits(&limits_key, &backend_ref, &opts.product, &opts.usage_type)
            .await?;

        let checkout_url = limits
            .get("checkoutUrl")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let limits_for_decision = if limits.is_null() {
            None
        } else {
            Some(&limits)
        };

        match decide_paywall_outcome(
            within_limits,
            &opts.product,
            limits_for_decision,
            checkout_url.as_deref(),
        ) {
            PaywallOutcome::Allow => Ok(GateOutcome::Allow(Allow {
                client: self.clone(),
                backend_ref,
                product: opts.product,
                usage_type: opts.usage_type,
            })),
            PaywallOutcome::Gate { gate } => Ok(GateOutcome::Paywall(gate)),
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

    pub(crate) async fn track_usage_after_allow(
        &self,
        backend_ref: &str,
        product: &str,
        usage_type: &str,
        opts: TrackOpts,
    ) -> Result<(), SdkError> {
        let metadata = opts
            .metadata
            .map(|m| m.into_iter().collect::<std::collections::BTreeMap<_, _>>());
        let base = CreateUsageRequest {
            customer_ref: Some(backend_ref.to_owned()),
            product_ref: Some(product.to_owned()),
            duration: opts.duration,
            metadata: metadata.clone(),
            action_type: None,
            description: Some(usage_type.to_owned()),
            error_message: None,
            idempotency_key: None,
            outcome: None,
            purchase_ref: None,
            timestamp: None,
            units: None,
        };

        let params = TrackUsageRequest {
            customer_ref: backend_ref.to_owned(),
            base,
            metadata,
        };
        self.inner.api.track_usage(params).await?;
        Ok(())
    }

    async fn evaluate_limits(
        &self,
        key: &str,
        customer_ref: &str,
        product: &str,
        usage_type: &str,
    ) -> Result<(bool, f64, Value), SdkError> {
        let now = now_ms();
        {
            let mut gate = self.inner.gate.lock().await;
            if let Some(entry) = gate.limits_cache.get(key) {
                if now.saturating_sub(entry.timestamp_ms) < self.inner.limits_cache_ttl_ms {
                    let cached_remaining = entry.remaining;
                    let cached_limits = entry.limits.clone();
                    let evaluation = evaluate_cached_limits(cached_remaining);
                    if evaluation.evict {
                        gate.limits_cache.remove(key);
                    } else if evaluation.within_limits {
                        if let Some(slot) = gate.limits_cache.get_mut(key) {
                            slot.remaining = evaluation.remaining;
                        }
                    }
                    return Ok((
                        evaluation.within_limits,
                        evaluation.remaining,
                        cached_limits,
                    ));
                }
                gate.limits_cache.remove(key);
            }
        }

        let limits = self.fetch_limits(customer_ref, product, usage_type).await?;
        let within = limits
            .get("withinLimits")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let remaining = limits
            .get("remaining")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let evaluation = evaluate_fresh_limits(within, remaining);

        {
            let mut gate = self.inner.gate.lock().await;
            if evaluation.should_cache {
                gate.limits_cache.insert(
                    key.to_owned(),
                    LimitsCacheEntry {
                        timestamp_ms: now,
                        remaining: evaluation.remaining,
                        limits: limits.clone(),
                    },
                );
            }
        }

        Ok((evaluation.within_limits, evaluation.remaining, limits))
    }

    async fn fetch_limits(
        &self,
        customer_ref: &str,
        product: &str,
        usage_type: &str,
    ) -> Result<Value, SdkError> {
        let params = CheckLimitsRequest {
            base: CheckLimitRequest {
                customer_ref: Some(customer_ref.to_owned()),
                product_ref: Some(product.to_owned()),
                meter_name: Some(usage_type.to_owned()),
                include_checkout_session: None,
                usage_type: None,
            },
            include_checkout_session: None,
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

#[path = "client_generated.rs"]
mod client_generated;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
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
        assert!(matches!(outcome, GateOutcome::Paywall(_)));
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
    }
}
