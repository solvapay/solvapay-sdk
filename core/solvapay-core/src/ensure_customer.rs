//! Ensure-customer step driver (cross-language sequencing).
//!
//! Hosts own the mutex / inflight lock, HTTP, and the cache map. This module
//! owns TTL freshness, lookup/create error classification, the 409 recovery
//! ladder, and capability checks. Missing `createCustomer` fails loudly.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::customer_sync::{
    build_create_customer_params, classify_create_error, classify_customer_ref,
    classify_lookup_error, extract_backend_customer_ref, is_email_conflict, CreateCustomerParams,
    CreateErrorKind, CustomerRefKind, LookupErrorKind,
};
use crate::helper_error::HelperErrorResult;

/// Default customer-dedup TTL (`customerDedupTTLMs`).
const DEFAULT_DEDUP_TTL_MS: i64 = 60_000;

/// Driver state between ensure-customer steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCustomerState {
    /// App customer ref from `start`.
    pub customer_ref: String,
    /// Optional explicit external ref (lookup/create key when set).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Optional explicit email.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Optional display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Host can call `createCustomer`.
    pub can_create_customer: bool,
    /// Host can call `updateCustomer`.
    pub can_update_customer: bool,
    /// Dedup TTL in ms.
    #[serde(rename = "dedupTTLMs")]
    pub dedup_ttl_ms: i64,
    /// Cache map key (`externalRef` or `customerRef`).
    pub cache_key: String,
    /// Which result event the driver is waiting for.
    pub pending: EnsurePending,
    /// Last create/lookup error message (409 ladder).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Backend ref held across `updateCustomer`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_backend_ref: Option<String>,
    /// First `createCustomer` already issued in this session.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub create_attempted: bool,
    /// Generated-email retry already issued.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub generated_email_attempted: bool,
}

/// In-flight step the next host event must complete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EnsurePending {
    /// Terminal or short-circuit.
    #[default]
    None,
    /// Waiting for `customerCacheEntry`.
    Cache,
    /// Waiting for the initial `getCustomer` result.
    LookupInitial,
    /// Waiting for the first `createCustomer` result.
    Create,
    /// Waiting for post-409 lookup by external ref.
    LookupConflictExternal,
    /// Waiting for post-409 lookup by email.
    LookupConflictEmail,
    /// Waiting for `updateCustomer` backfill.
    UpdateBackfill,
    /// Waiting for generated-email `createCustomer`.
    CreateGeneratedEmail,
}

/// Next host action or a terminal resolve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EnsureCustomerAction {
    /// Host reads the customer cache map (no TTL compare).
    #[serde(rename_all = "camelCase")]
    ReadCustomerCache {
        /// Cache key.
        key: String,
    },
    /// Host calls `getCustomer`.
    #[serde(rename_all = "camelCase")]
    GetCustomer {
        /// Lookup by `externalRef`.
        #[serde(skip_serializing_if = "Option::is_none")]
        by_external_ref: Option<String>,
        /// Lookup by email.
        #[serde(skip_serializing_if = "Option::is_none")]
        by_email: Option<String>,
    },
    /// Host calls `createCustomer` with this body.
    #[serde(rename_all = "camelCase")]
    CreateCustomer {
        /// Complete create params.
        params: CreateCustomerParams,
    },
    /// Host calls `updateCustomer`.
    #[serde(rename_all = "camelCase")]
    UpdateCustomer {
        /// Backend customer ref to patch.
        customer_ref: String,
        /// Patch body.
        patch: Map<String, Value>,
    },
    /// Terminal success. Host applies `cache` then returns `backendRef`.
    #[serde(rename_all = "camelCase")]
    Resolved {
        /// Backend customer ref.
        backend_ref: String,
        /// Optional cache write (successes only; errors are never cached).
        #[serde(skip_serializing_if = "Option::is_none")]
        cache: Option<EnsureCustomerCacheWrite>,
    },
}

/// Cache write bundled onto [`EnsureCustomerAction::Resolved`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCustomerCacheWrite {
    /// Cache key.
    pub key: String,
    /// Backend customer ref to store.
    pub backend_ref: String,
    /// Host `nowMs` — authoritative; hosts must not restamp.
    pub timestamp_ms: i64,
}

/// Driver output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCustomerNextOutput {
    /// State to pass into the next call.
    pub state: EnsureCustomerState,
    /// Host action or terminal result.
    pub action: EnsureCustomerAction,
}

/// Advance ensure-customer by one step.
///
/// # Arguments
///
/// * `state` - Previous [`EnsureCustomerNextOutput::state`], or `None` on `start`.
/// * `event` - Host event tagged with `kind`.
///
/// # Errors
///
/// [`HelperErrorResult`] on malformed events, unexpected lookup/create
/// failures, missing create capability, or an unresolvable 409.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "paywall-decision",
    emit_order = 42
)]
pub fn ensure_customer_next(
    state: Option<&Value>,
    event: Option<&Value>,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let event = event
        .ok_or_else(|| HelperErrorResult::transport("ensure_customer_next event is required"))?;
    let kind = event.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HelperErrorResult::transport("ensure_customer_next event.kind is required")
    })?;
    match kind {
        "start" => start(event),
        "customerCacheEntry" => on_cache_entry(require_state(state)?, event),
        "customerLookupResult" => on_lookup_result(require_state(state)?, event),
        "customerCreateResult" => on_create_result(require_state(state)?, event),
        "customerUpdateResult" => on_update_result(require_state(state)?, event),
        other => Err(HelperErrorResult::transport(format!(
            "ensure_customer_next unknown event kind: {other}"
        ))),
    }
}

/// Handle `start`: short-circuit anonymous/backend, otherwise read the cache.
fn start(event: &Value) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let customer_ref = require_str(event, "customerRef")?;
    let external_ref = optional_nonempty(event, "externalRef");
    let email = optional_nonempty(event, "email");
    let name = optional_nonempty(event, "name");
    let can_create_customer = event
        .get("canCreateCustomer")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let can_update_customer = event
        .get("canUpdateCustomer")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let dedup_ttl_ms = event
        .get("dedupTTLMs")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_DEDUP_TTL_MS);
    let cache_key = external_ref.clone().unwrap_or_else(|| customer_ref.clone());
    let mut state = EnsureCustomerState {
        customer_ref: customer_ref.clone(),
        external_ref,
        email,
        name,
        can_create_customer,
        can_update_customer,
        dedup_ttl_ms,
        cache_key: cache_key.clone(),
        pending: EnsurePending::None,
        last_error: None,
        pending_backend_ref: None,
        create_attempted: false,
        generated_email_attempted: false,
    };
    match classify_customer_ref(&customer_ref) {
        CustomerRefKind::Anonymous | CustomerRefKind::Backend => {
            Ok(resolved(state, customer_ref, None))
        }
        CustomerRefKind::NeedsEnsure => {
            state.pending = EnsurePending::Cache;
            Ok(EnsureCustomerNextOutput {
                state,
                action: EnsureCustomerAction::ReadCustomerCache { key: cache_key },
            })
        }
    }
}

/// Handle a raw cache-map read. Rust owns freshness (`>=` TTL is stale).
fn on_cache_entry(
    state: EnsureCustomerState,
    event: &Value,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let found = require_bool(event, "found")?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    if found {
        let timestamp_ms = event
            .get("timestampMs")
            .and_then(Value::as_i64)
            .ok_or_else(|| {
                HelperErrorResult::transport(
                    "ensure_customer_next customerCacheEntry.timestampMs is required when found",
                )
            })?;
        let age = now_ms.saturating_sub(timestamp_ms);
        if age < state.dedup_ttl_ms {
            let backend_ref = require_str(event, "backendRef")?;
            return Ok(resolved(state, backend_ref, None));
        }
    }
    Ok(lookup_external(state))
}

/// Handle `getCustomer` results for the initial lookup and the 409 ladder.
fn on_lookup_result(
    state: EnsureCustomerState,
    event: &Value,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let found = require_bool(event, "found")?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let error_message = optional_nonempty(event, "errorMessage");
    if found {
        let customer = event.get("customer").and_then(Value::as_object);
        let backend = customer
            .and_then(|c| c.get("customerRef"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let Some(backend_ref) = backend else {
            return after_lookup_miss(state, now_ms, None);
        };
        match state.pending {
            EnsurePending::LookupConflictEmail => {
                return maybe_backfill(state, event, backend_ref, now_ms)
            }
            _ => {
                let cache = Some(cache_write(&state, backend_ref.clone(), now_ms));
                return Ok(resolved(state, backend_ref, cache));
            }
        }
    }
    if let Some(message) = error_message.as_deref() {
        if classify_lookup_error(message) == LookupErrorKind::Unexpected {
            return Err(HelperErrorResult::transport(format!(
                "ensure_customer_next getCustomer failed: {message}"
            )));
        }
    }
    after_lookup_miss(state, now_ms, error_message)
}

/// Continue after an expected miss (404 / not found / empty body).
fn after_lookup_miss(
    mut state: EnsureCustomerState,
    now_ms: i64,
    error_message: Option<String>,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    match state.pending {
        EnsurePending::LookupInitial => emit_create(state, now_ms, false),
        EnsurePending::LookupConflictExternal => {
            let conflict = state.last_error.clone().unwrap_or_default();
            if is_email_conflict(&conflict) && state.email.is_some() {
                let email = state.email.clone().unwrap_or_default();
                state.pending = EnsurePending::LookupConflictEmail;
                Ok(EnsureCustomerNextOutput {
                    state,
                    action: EnsureCustomerAction::GetCustomer {
                        by_external_ref: None,
                        by_email: Some(email),
                    },
                })
            } else {
                unresolvable(&state, error_message.or(state.last_error.clone()))
            }
        }
        EnsurePending::LookupConflictEmail => {
            if state.generated_email_attempted {
                return unresolvable(&state, error_message.or(state.last_error.clone()));
            }
            emit_create(state, now_ms, true)
        }
        other => Err(HelperErrorResult::transport(format!(
            "ensure_customer_next unexpected lookup pending: {other:?}"
        ))),
    }
}

/// Email-conflict hit: backfill `externalRef` when the host can update.
fn maybe_backfill(
    mut state: EnsureCustomerState,
    event: &Value,
    backend_ref: String,
    now_ms: i64,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let customer = event.get("customer").and_then(Value::as_object);
    let existing_ext = customer
        .and_then(|c| c.get("externalRef"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let want_ext = state
        .external_ref
        .clone()
        .unwrap_or_else(|| state.customer_ref.clone());
    if state.can_update_customer && existing_ext.is_none() && !want_ext.is_empty() {
        state.pending = EnsurePending::UpdateBackfill;
        state.pending_backend_ref = Some(backend_ref.clone());
        let mut patch = Map::new();
        patch.insert("externalRef".into(), Value::String(want_ext));
        return Ok(EnsureCustomerNextOutput {
            state,
            action: EnsureCustomerAction::UpdateCustomer {
                customer_ref: backend_ref,
                patch,
            },
        });
    }
    let cache = Some(cache_write(&state, backend_ref.clone(), now_ms));
    Ok(resolved(state, backend_ref, cache))
}

/// Handle `createCustomer` results, including the 409 ladder.
fn on_create_result(
    mut state: EnsureCustomerState,
    event: &Value,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let ok = require_bool(event, "ok")?;
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    if ok {
        let customer = event.get("customer").and_then(Value::as_object);
        let fallback = state.customer_ref.clone();
        let backend_ref = match customer {
            Some(map) => extract_backend_customer_ref(map, &fallback),
            None => fallback,
        };
        let cache = Some(cache_write(&state, backend_ref.clone(), now_ms));
        return Ok(resolved(state, backend_ref, cache));
    }
    let message = optional_nonempty(event, "errorMessage").unwrap_or_default();
    if classify_create_error(&message) != CreateErrorKind::Conflict {
        return Err(HelperErrorResult::transport(format!(
            "ensure_customer_next createCustomer failed: {message}"
        )));
    }
    if state.pending == EnsurePending::CreateGeneratedEmail {
        return unresolvable(&state, Some(message));
    }
    state.last_error = Some(message);
    state.pending = EnsurePending::LookupConflictExternal;
    let by_external_ref = Some(state.cache_key.clone());
    Ok(EnsureCustomerNextOutput {
        state,
        action: EnsureCustomerAction::GetCustomer {
            by_external_ref,
            by_email: None,
        },
    })
}

/// Handle `updateCustomer`. The customer is already resolved; backfill is best-effort.
fn on_update_result(
    state: EnsureCustomerState,
    event: &Value,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let now_ms = event.get("nowMs").and_then(Value::as_i64).unwrap_or(0);
    let backend_ref = state.pending_backend_ref.clone().ok_or_else(|| {
        HelperErrorResult::transport(
            "ensure_customer_next customerUpdateResult missing pending backend ref",
        )
    })?;
    let cache = Some(cache_write(&state, backend_ref.clone(), now_ms));
    Ok(resolved(state, backend_ref, cache))
}

/// Ask the host to look up by the cache key as `externalRef`.
fn lookup_external(mut state: EnsureCustomerState) -> EnsureCustomerNextOutput {
    state.pending = EnsurePending::LookupInitial;
    let key = state.cache_key.clone();
    EnsureCustomerNextOutput {
        state,
        action: EnsureCustomerAction::GetCustomer {
            by_external_ref: Some(key),
            by_email: None,
        },
    }
}

/// Ask the host to create, or fail loudly when the capability is missing.
fn emit_create(
    mut state: EnsureCustomerState,
    now_ms: i64,
    generated_email: bool,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    if !state.can_create_customer {
        return Err(HelperErrorResult::transport(format!(
            "ensure_customer_next createCustomer is not available for {}",
            state.customer_ref
        )));
    }
    let email = if generated_email {
        Some(format!(
            "{}-{now_ms}@auto-created.local",
            state.customer_ref
        ))
    } else {
        state.email.clone()
    };
    let params = build_create_customer_params(
        &state.customer_ref,
        Some(state.cache_key.as_str()),
        email.as_deref(),
        state.name.as_deref(),
        now_ms,
    );
    if generated_email {
        state.generated_email_attempted = true;
        state.pending = EnsurePending::CreateGeneratedEmail;
    } else {
        state.create_attempted = true;
        state.pending = EnsurePending::Create;
    }
    Ok(EnsureCustomerNextOutput {
        state,
        action: EnsureCustomerAction::CreateCustomer { params },
    })
}

/// Unresolvable 409 — do not return the app ref (that produces downstream 404s).
fn unresolvable(
    state: &EnsureCustomerState,
    message: Option<String>,
) -> Result<EnsureCustomerNextOutput, HelperErrorResult> {
    let unresolved = message
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Customer already exists but could not be resolved".to_owned());
    Err(HelperErrorResult::transport(format!(
        "Failed to resolve existing customer for {} after conflict: {unresolved}. \
         Ensure the existing customer is linked to this externalRef.",
        state.customer_ref
    )))
}

/// Terminal resolve, clearing in-flight bookkeeping.
fn resolved(
    mut state: EnsureCustomerState,
    backend_ref: String,
    cache: Option<EnsureCustomerCacheWrite>,
) -> EnsureCustomerNextOutput {
    state.pending = EnsurePending::None;
    state.last_error = None;
    state.pending_backend_ref = None;
    EnsureCustomerNextOutput {
        state,
        action: EnsureCustomerAction::Resolved { backend_ref, cache },
    }
}

/// Build a success cache write.
fn cache_write(
    state: &EnsureCustomerState,
    backend_ref: String,
    timestamp_ms: i64,
) -> EnsureCustomerCacheWrite {
    EnsureCustomerCacheWrite {
        key: state.cache_key.clone(),
        backend_ref,
        timestamp_ms,
    }
}

/// Deserialize driver state.
fn require_state(state: Option<&Value>) -> Result<EnsureCustomerState, HelperErrorResult> {
    let value = state
        .ok_or_else(|| HelperErrorResult::transport("ensure_customer_next state is required"))?;
    serde_json::from_value(value.clone()).map_err(|err| {
        HelperErrorResult::transport(format!("ensure_customer_next invalid state: {err}"))
    })
}

/// Required non-empty string field.
fn require_str(value: &Value, key: &str) -> Result<String, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            HelperErrorResult::transport(format!("ensure_customer_next {key} is required"))
        })
}

/// Required boolean field.
fn require_bool(value: &Value, key: &str) -> Result<bool, HelperErrorResult> {
    value.get(key).and_then(Value::as_bool).ok_or_else(|| {
        HelperErrorResult::transport(format!("ensure_customer_next {key} must be a boolean"))
    })
}

/// Optional non-empty string (`null` / `''` omitted).
fn optional_nonempty(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use serde_json::json;

    fn start_event(customer: &str) -> Value {
        json!({
            "kind": "start",
            "customerRef": customer,
            "canCreateCustomer": true,
            "canUpdateCustomer": true,
        })
    }

    fn app_state() -> EnsureCustomerState {
        let out = ensure_customer_next(None, Some(&start_event("user-1"))).unwrap();
        out.state
    }

    fn action_kind(out: &EnsureCustomerNextOutput) -> &'static str {
        match &out.action {
            EnsureCustomerAction::ReadCustomerCache { .. } => "readCustomerCache",
            EnsureCustomerAction::GetCustomer { .. } => "getCustomer",
            EnsureCustomerAction::CreateCustomer { .. } => "createCustomer",
            EnsureCustomerAction::UpdateCustomer { .. } => "updateCustomer",
            EnsureCustomerAction::Resolved { .. } => "resolved",
        }
    }

    #[test]
    fn start_app_ref_reads_cache() {
        let out = ensure_customer_next(None, Some(&start_event("user-1"))).unwrap();
        assert_eq!(action_kind(&out), "readCustomerCache");
        match &out.action {
            EnsureCustomerAction::ReadCustomerCache { key } => assert_eq!(key, "user-1"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn start_anonymous_resolves() {
        let out = ensure_customer_next(None, Some(&start_event("anonymous"))).unwrap();
        assert_eq!(action_kind(&out), "resolved");
        match &out.action {
            EnsureCustomerAction::Resolved { backend_ref, cache } => {
                assert_eq!(backend_ref, "anonymous");
                assert!(cache.is_none());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn start_backend_resolves() {
        let out = ensure_customer_next(None, Some(&start_event("cus_abc"))).unwrap();
        match &out.action {
            EnsureCustomerAction::Resolved { backend_ref, cache } => {
                assert_eq!(backend_ref, "cus_abc");
                assert!(cache.is_none());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn cache_fresh_resolves_without_write() {
        let state = serde_json::to_value(app_state()).unwrap();
        let out = ensure_customer_next(
            Some(&state),
            Some(&json!({
                "kind": "customerCacheEntry",
                "found": true,
                "backendRef": "cus_1",
                "timestampMs": 1_000,
                "nowMs": 2_000,
            })),
        )
        .unwrap();
        match &out.action {
            EnsureCustomerAction::Resolved { backend_ref, cache } => {
                assert_eq!(backend_ref, "cus_1");
                assert!(cache.is_none());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn cache_at_ttl_is_stale_and_looks_up() {
        let state = serde_json::to_value(app_state()).unwrap();
        let out = ensure_customer_next(
            Some(&state),
            Some(&json!({
                "kind": "customerCacheEntry",
                "found": true,
                "backendRef": "cus_1",
                "timestampMs": 1_000,
                "nowMs": 61_000,
            })),
        )
        .unwrap();
        match &out.action {
            EnsureCustomerAction::GetCustomer {
                by_external_ref, ..
            } => {
                assert_eq!(by_external_ref.as_deref(), Some("user-1"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unexpected_lookup_fails() {
        let started = ensure_customer_next(None, Some(&start_event("user-1"))).unwrap();
        let looking = ensure_customer_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "customerCacheEntry", "found": false, "nowMs": 1 })),
        )
        .unwrap();
        let err = ensure_customer_next(
            Some(&serde_json::to_value(&looking.state).unwrap()),
            Some(&json!({
                "kind": "customerLookupResult",
                "found": false,
                "errorMessage": "timeout",
            })),
        )
        .unwrap_err();
        assert!(err.details.unwrap().contains("timeout"));
    }

    #[test]
    fn lookup_404_creates() {
        let started = ensure_customer_next(None, Some(&start_event("user-1"))).unwrap();
        let looking = ensure_customer_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "customerCacheEntry", "found": false, "nowMs": 1 })),
        )
        .unwrap();
        let out = ensure_customer_next(
            Some(&serde_json::to_value(&looking.state).unwrap()),
            Some(&json!({
                "kind": "customerLookupResult",
                "found": false,
                "errorMessage": "404 not found",
                "nowMs": 1_700_000_000_000_i64,
            })),
        )
        .unwrap();
        match &out.action {
            EnsureCustomerAction::CreateCustomer { params } => {
                assert_eq!(params.email, "user-1-1700000000000@auto-created.local");
                assert_eq!(params.external_ref.as_deref(), Some("user-1"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn no_create_capability_fails() {
        let started = ensure_customer_next(
            None,
            Some(&json!({
                "kind": "start",
                "customerRef": "user-1",
                "canCreateCustomer": false,
                "canUpdateCustomer": false,
            })),
        )
        .unwrap();
        let looking = ensure_customer_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({ "kind": "customerCacheEntry", "found": false, "nowMs": 1 })),
        )
        .unwrap();
        let err = ensure_customer_next(
            Some(&serde_json::to_value(&looking.state).unwrap()),
            Some(&json!({
                "kind": "customerLookupResult",
                "found": false,
                "errorMessage": "404",
                "nowMs": 1,
            })),
        )
        .unwrap_err();
        assert!(err
            .details
            .unwrap()
            .contains("createCustomer is not available"));
    }
}
