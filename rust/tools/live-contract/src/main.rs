//! Step 48 — live Rust contract binary (env-gated).
//!
//! Env:
//!   SOLVAPAY_SHADOW_BASE_URL   required
//!   SOLVAPAY_SHADOW_API_KEY    required
//!   SOLVAPAY_SHADOW_ENABLE_STRIPE  optional (`true` / `1`) to run requires:stripe
//!   SOLVAPAY_LIVE_OUT          optional report path
//!     (default: contract/shadow/output/rust-live-report.json)

#![allow(clippy::missing_docs_in_private_items)]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use live_contract::{
    extract_ref, invoke, normalize, resolve_args, score_scenario, setup_side, Requires, SCENARIOS,
};
use serde_json::{json, Value};
use solvapay::blocking::BlockingClient;
use solvapay::Config;

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<ExitCode, String> {
    let base_url = env::var("SOLVAPAY_SHADOW_BASE_URL")
        .map_err(|_| "SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required")?;
    let api_key = env::var("SOLVAPAY_SHADOW_API_KEY")
        .map_err(|_| "SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required")?;
    if base_url.is_empty() || api_key.is_empty() {
        return Err("SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY are required".to_owned());
    }

    let enable_stripe = env::var("SOLVAPAY_SHADOW_ENABLE_STRIPE")
        .map(|v| {
            let lower = v.to_ascii_lowercase();
            matches!(lower.as_str(), "1" | "true" | "yes")
        })
        .unwrap_or(false);

    let out_path = env::var("SOLVAPAY_LIVE_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_out_path());

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("create report dir {}: {err}", parent.display()))?;
    }

    let started = iso_now();
    let client = BlockingClient::new(Config {
        api_key,
        api_base_url: Some(base_url.clone()),
        ..Config::default()
    })
    .map_err(|err| format!("BlockingClient::new: {err:?}"))?;

    let run_id = short_run_id();
    let mut refs = setup_side(&client, &run_id)?;

    let mut results: Vec<Value> = Vec::new();
    let mut failures: u32 = 0;

    for scenario in SCENARIOS.iter() {
        if scenario.requires == Some(Requires::Stripe) && !enable_stripe {
            results.push(json!({
                "op": scenario.op,
                "scenarioId": scenario.id,
                "status": "SKIPPED",
                "reason": scenario.skip_reason.unwrap_or("requires: stripe"),
            }));
            continue;
        }
        if scenario.requires == Some(Requires::ActivePurchase) {
            results.push(json!({
                "op": scenario.op,
                "scenarioId": scenario.id,
                "status": "SKIPPED",
                "reason": scenario.skip_reason.unwrap_or("requires: activePurchase"),
            }));
            continue;
        }

        let args = resolve_args(&scenario.args, &refs);
        let outcome = invoke(&client, scenario.op, &args);
        let status = score_scenario(scenario, &outcome);
        if status == "DIVERGED" {
            failures += 1;
        }
        results.push(json!({
            "op": scenario.op,
            "scenarioId": scenario.id,
            "status": status,
            "normalized": normalize(&outcome),
        }));

        if outcome.get("ok") == Some(&Value::Bool(true)) {
            if let Some(value) = outcome.get("value") {
                if scenario.op == "createProduct" {
                    if let Some(ref_) = extract_ref(value, &["reference", "productRef"]) {
                        refs.insert("productRef".to_owned(), ref_);
                    }
                }
                if scenario.op == "createPlan" {
                    if let Some(ref_) = extract_ref(value, &["reference", "planRef"]) {
                        refs.insert("planRef".to_owned(), ref_);
                    }
                }
                if scenario.op == "createCustomer" {
                    if let Some(ref_) = extract_ref(value, &["customerRef", "reference"]) {
                        refs.insert("customerRef".to_owned(), ref_);
                    }
                }
            }
        }
    }

    let finished = iso_now();
    let report = json!({
        "startedAt": started,
        "finishedAt": finished,
        "baseUrl": base_url,
        "mode": "live",
        "side": "rust",
        "results": results,
    });

    let body =
        serde_json::to_string_pretty(&report).map_err(|err| format!("serialize report: {err}"))?;
    fs::write(&out_path, format!("{body}\n"))
        .map_err(|err| format!("write {}: {err}", out_path.display()))?;

    let identical = results
        .iter()
        .filter(|r| r.get("status") == Some(&json!("IDENTICAL")))
        .count();
    let skipped = results
        .iter()
        .filter(|r| r.get("status") == Some(&json!("SKIPPED")))
        .count();
    println!(
        "rust live contract: identical={identical} skipped={skipped} failed={failures} report={}",
        out_path.display()
    );

    Ok(if failures > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    })
}

fn default_out_path() -> PathBuf {
    // rust/tools/live-contract → repo root
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // tools
    path.pop(); // rust
    path.pop(); // repo
    path.push("contract");
    path.push("shadow");
    path.push("output");
    path.push("rust-live-report.json");
    path
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC stamp without chrono dependency.
    format!("{secs}")
}

fn short_run_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos % 0xffff_ffff)
}
