//! Step 48 — live Rust contract driver (pure helpers).
//!
//! Mirrors Python/Ruby `live_contract` helpers: scenario table, placeholder
//! resolution, volatile-key normalization, and structured-error scoring.
//! The env-gated live loop lives in [`crate`]'s binary (`main.rs`).

#![allow(clippy::missing_docs_in_private_items)]
#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

mod invoke;
mod scenarios;

pub use invoke::{invoke, sdk_error_observation, setup_side, Outcome};
pub use scenarios::{Requires, Scenario, SCENARIOS};

/// Keys stripped during normalize (Python/Ruby `VOLATILE_KEYS` parity).
pub const VOLATILE_KEYS: &[&str] = &[
    "id",
    "reference",
    "createdAt",
    "updatedAt",
    "created",
    "updated",
    "idempotencyKey",
    "clientSecret",
    "secret",
    "token",
    "url",
    "checkoutUrl",
    "sessionUrl",
];

/// Suffixes that mark volatile fields (Python/Ruby `VOLATILE_SUFFIXES` parity).
pub const VOLATILE_SUFFIXES: &[&str] = &["At", "Url", "Ref", "Id", "Secret", "Token"];

/// Recursively substitutes `{key}` placeholders from `refs` into a JSON value.
pub fn resolve_args(template: &Value, refs: &BTreeMap<String, String>) -> Value {
    match template {
        Value::String(s) => {
            let mut out = s.clone();
            for (key, replacement) in refs {
                let needle = format!("{{{key}}}");
                out = out.replace(&needle, replacement);
            }
            Value::String(out)
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve_args(item, refs)).collect())
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, child) in map {
                out.insert(key.clone(), resolve_args(child, refs));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Extracts the first non-empty string for any of `keys`, including nested
/// `product` / `plan` / `customer` objects.
pub fn extract_ref(value: &Value, keys: &[&str]) -> Option<String> {
    let Value::Object(map) = value else {
        return None;
    };
    for key in keys {
        if let Some(Value::String(candidate)) = map.get(*key) {
            if !candidate.is_empty() {
                return Some(candidate.clone());
            }
        }
    }
    for nest in ["product", "plan", "customer"] {
        if let Some(nested) = map.get(nest) {
            if let Some(found) = extract_ref(nested, keys) {
                return Some(found);
            }
        }
    }
    None
}

/// Strips volatile keys/suffixes and drops nulls (Python/Ruby `normalize` parity).
pub fn normalize(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, child) in map {
                if VOLATILE_KEYS.contains(&key.as_str())
                    || VOLATILE_SUFFIXES.iter().any(|suffix| key.ends_with(suffix))
                {
                    continue;
                }
                if child.is_null() {
                    continue;
                }
                out.insert(key.clone(), normalize(child));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// True when the client returned a structured SDK/Paywall error observation.
pub fn is_structured_error(outcome: &Value) -> bool {
    if outcome.get("ok") != Some(&Value::Bool(false)) {
        return false;
    }
    let Some(error) = outcome.get("error") else {
        return false;
    };
    let Some(message) = error.get("message").and_then(Value::as_str) else {
        return false;
    };
    !message.is_empty()
}

/// Scores one live scenario (`IDENTICAL` / `DIVERGED`).
///
/// Success-path scenarios must return ok. Intentional error probes
/// (`expect_error`) must return a structured SDK error.
pub fn score_scenario(scenario: &Scenario, outcome: &Value) -> &'static str {
    if scenario.expect_error {
        if is_structured_error(outcome) {
            "IDENTICAL"
        } else {
            "DIVERGED"
        }
    } else if outcome.get("ok") == Some(&Value::Bool(true)) {
        "IDENTICAL"
    } else {
        "DIVERGED"
    }
}

/// Builds a success observation JSON object.
pub fn ok_outcome(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

/// Builds an error observation JSON object.
pub fn err_outcome(error: Value) -> Value {
    json!({ "ok": false, "error": error })
}
