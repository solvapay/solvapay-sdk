//! Emit facade runtime defaults from manifest `defaults:`.

use std::fmt::Write as _;
use std::io::Write as IoWrite;
use std::process::{Command, Stdio};

use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrDefaults};

/// `sdks/typescript/server/src/defaults.ts`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent.
pub fn emit_defaults_ts(ir: &Ir) -> GenResult<String> {
    let d = &ir.defaults;
    let payment = require_format(d, "payment")?;
    let topup = require_format(d, "topup")?;
    let mut out = generated_header(CommentStyle::Block, "ts-defaults-out");
    out.push('\n');
    let _ = writeln!(
        out,
        "/** Frozen contract defaults (`defaults:` in sdk-contract.yaml). */\n\
         \n\
         export const MAX_RETRIES = {max}\n\
         export const INITIAL_DELAY_MS = {delay}\n\
         export const RETRY_BACKOFF = '{backoff}'\n\
         export const WEBHOOK_TOLERANCE_SEC = {tolerance}\n\
         export const LIMITS_CACHE_TTL_MS = {limits}\n\
         export const CUSTOMER_DEDUP_TTL_MS = {dedup}\n\
         export const CUSTOMER_DEDUP_MAX_CACHE_SIZE = {cache}\n\
         export const ANONYMOUS_CUSTOMER_REF = '{anon}'\n\
         export const REQUEST_ID_FORMAT = '{request}'\n\
         export const USAGE_ACTION_TYPE = '{usage}'\n\
         export const PAYMENT_IDEMPOTENCY_KEY_FORMAT = '{payment}'\n\
         export const TOPUP_IDEMPOTENCY_KEY_FORMAT = '{topup}'\n\
         export const GO_CONTEXT_FIRST_PARAM = {go_ctx}",
        max = d.max_retries,
        delay = grouped(d.initial_delay_ms),
        backoff = escape_single(&d.retry_backoff),
        tolerance = d.webhook_tolerance_sec,
        limits = grouped(d.limits_cache_ttl_ms),
        dedup = grouped(d.customer_dedup_ttl_ms),
        cache = grouped(u64::from(d.customer_dedup_max_cache_size)),
        anon = escape_single(&d.anonymous_customer_ref),
        request = escape_single(&d.request_id_format),
        usage = escape_single(&d.usage_action_type),
        payment = escape_single(payment),
        topup = escape_single(topup),
        go_ctx = if d.go_context_first_param {
            "true"
        } else {
            "false"
        },
    );
    Ok(out)
}

/// `sdks/python/python/solvapay/defaults.py`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent.
pub fn emit_defaults_py(ir: &Ir) -> GenResult<String> {
    let d = &ir.defaults;
    let payment = require_format(d, "payment")?;
    let topup = require_format(d, "topup")?;
    let payment_required = require_paywall(ir, "payment_required")?;
    let mut out = generated_header(CommentStyle::Hash, "py-defaults-out");
    let _ = writeln!(
        out,
        "\n\"\"\"Frozen contract defaults (`defaults:` in sdk-contract.yaml).\"\"\"\n\
         \n\
         from __future__ import annotations\n\
         \n\
         _MAX_RETRIES = {max}\n\
         _INITIAL_DELAY_MS = {delay}\n\
         _RETRY_BACKOFF = \"{backoff}\"\n\
         _WEBHOOK_TOLERANCE_SEC = {tolerance}\n\
         _DEFAULT_LIMITS_CACHE_TTL_MS = {limits}\n\
         _CUSTOMER_DEDUP_TTL_MS = {dedup}\n\
         _CUSTOMER_DEDUP_MAX_CACHE_SIZE = {cache}\n\
         _ANONYMOUS_CUSTOMER_REF = \"{anon}\"\n\
         _REQUEST_ID_FORMAT = \"{request}\"\n\
         _USAGE_ACTION_TYPE = \"{usage}\"\n\
         _PAYMENT_IDEMPOTENCY_KEY_FORMAT = \"{payment}\"\n\
         _TOPUP_IDEMPOTENCY_KEY_FORMAT = \"{topup}\"\n\
         _GO_CONTEXT_FIRST_PARAM = {go_ctx}\n\
         _PAYMENT_REQUIRED = \"{payment_required}\"\n",
        max = d.max_retries,
        delay = grouped(d.initial_delay_ms),
        backoff = escape_double(&d.retry_backoff),
        tolerance = d.webhook_tolerance_sec,
        limits = grouped(d.limits_cache_ttl_ms),
        dedup = grouped(d.customer_dedup_ttl_ms),
        cache = grouped(u64::from(d.customer_dedup_max_cache_size)),
        anon = escape_double(&d.anonymous_customer_ref),
        request = escape_double(&d.request_id_format),
        usage = escape_double(&d.usage_action_type),
        payment = escape_double(payment),
        topup = escape_double(topup),
        go_ctx = if d.go_context_first_param {
            "True"
        } else {
            "False"
        },
        payment_required = escape_double(payment_required),
    );
    Ok(out)
}

/// `sdks/ruby/lib/solvapay/defaults.rb`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent.
pub fn emit_defaults_rb(ir: &Ir) -> GenResult<String> {
    let d = &ir.defaults;
    let payment = require_format(d, "payment")?;
    let topup = require_format(d, "topup")?;
    let payment_required = require_paywall(ir, "payment_required")?;
    let mut out = generated_header(CommentStyle::Hash, "rb-defaults-out");
    let _ = writeln!(
        out,
        "# frozen_string_literal: true\n\
         \n\
         module SolvaPay\n\
         \x20 MAX_RETRIES = {max}\n\
         \x20 INITIAL_DELAY_MS = {delay}\n\
         \x20 RETRY_BACKOFF = \"{backoff}\"\n\
         \x20 WEBHOOK_TOLERANCE_SEC = {tolerance}\n\
         \x20 DEFAULT_LIMITS_CACHE_TTL_MS = {limits}\n\
         \x20 CUSTOMER_DEDUP_TTL_MS = {dedup}\n\
         \x20 CUSTOMER_DEDUP_MAX_CACHE_SIZE = {cache}\n\
         \x20 ANONYMOUS_CUSTOMER_REF = \"{anon}\"\n\
         \x20 REQUEST_ID_FORMAT = \"{request}\"\n\
         \x20 USAGE_ACTION_TYPE = \"{usage}\"\n\
         \x20 PAYMENT_IDEMPOTENCY_KEY_FORMAT = \"{payment}\"\n\
         \x20 TOPUP_IDEMPOTENCY_KEY_FORMAT = \"{topup}\"\n\
         \x20 GO_CONTEXT_FIRST_PARAM = {go_ctx}\n\
         \x20 PAYMENT_REQUIRED = \"{payment_required}\"\n\
         end",
        max = d.max_retries,
        delay = grouped(d.initial_delay_ms),
        backoff = escape_double(&d.retry_backoff),
        tolerance = d.webhook_tolerance_sec,
        limits = grouped(d.limits_cache_ttl_ms),
        dedup = grouped(d.customer_dedup_ttl_ms),
        cache = grouped(u64::from(d.customer_dedup_max_cache_size)),
        anon = escape_double(&d.anonymous_customer_ref),
        request = escape_double(&d.request_id_format),
        usage = escape_double(&d.usage_action_type),
        payment = escape_double(payment),
        topup = escape_double(topup),
        go_ctx = if d.go_context_first_param {
            "true"
        } else {
            "false"
        },
        payment_required = escape_double(payment_required),
    );
    Ok(out)
}

/// `sdks/go/defaults.go`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent or gofmt fails.
pub fn emit_defaults_go(ir: &Ir) -> GenResult<String> {
    let d = &ir.defaults;
    let payment = require_format(d, "payment")?;
    let topup = require_format(d, "topup")?;
    let payment_required = require_paywall(ir, "payment_required")?;
    let mut out = generated_header(CommentStyle::Go, "go-defaults-out");
    let _ = writeln!(
        out,
        "\npackage solvapay\n\
         \n\
         // Frozen contract defaults (`sdk-contract.yaml` `defaults:`).\n\
         const (\n\
         \tDefaultMaxRetries              = {max}\n\
         \tDefaultInitialDelayMs          = {delay}\n\
         \tRetryBackoff                   = \"{backoff}\"\n\
         \tDefaultWebhookToleranceSec     = {tolerance}\n\
         \tDefaultLimitsCacheTTLMs        = {limits}\n\
         \tCustomerDedupTTLMs             = {dedup}\n\
         \tCustomerDedupMaxCacheSize      = {cache}\n\
         \tAnonymousCustomerRef           = \"{anon}\"\n\
         \tRequestIDFormat                = \"{request}\"\n\
         \tUsageActionType                = \"{usage}\"\n\
         \tPaymentIdempotencyKeyFormat    = \"{payment}\"\n\
         \tTopupIdempotencyKeyFormat      = \"{topup}\"\n\
         \tGoContextFirstParam            = {go_ctx}\n\
         \tPaymentRequiredMessage         = \"{payment_required}\"\n\
         )\n",
        max = d.max_retries,
        delay = grouped(d.initial_delay_ms),
        backoff = escape_double(&d.retry_backoff),
        tolerance = d.webhook_tolerance_sec,
        limits = grouped(d.limits_cache_ttl_ms),
        dedup = grouped(d.customer_dedup_ttl_ms),
        cache = grouped(u64::from(d.customer_dedup_max_cache_size)),
        anon = escape_double(&d.anonymous_customer_ref),
        request = escape_double(&d.request_id_format),
        usage = escape_double(&d.usage_action_type),
        payment = escape_double(payment),
        topup = escape_double(topup),
        go_ctx = if d.go_context_first_param {
            "true"
        } else {
            "false"
        },
        payment_required = escape_double(payment_required),
    );
    gofmt_source(&out)
}

/// `sdks/rust/src/defaults_generated.rs`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent.
pub fn emit_defaults_rs(ir: &Ir) -> GenResult<String> {
    emit_rust_defaults(ir, "rs-defaults-out", false)
}

/// `core/solvapay-transport/src/contract_defaults.generated.rs`
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a required idempotency format is absent.
pub fn emit_defaults_transport_rs(ir: &Ir) -> GenResult<String> {
    emit_rust_defaults(ir, "transport-defaults-out", true)
}

fn emit_rust_defaults(ir: &Ir, flag: &str, crate_private: bool) -> GenResult<String> {
    let d = &ir.defaults;
    let payment = require_format(d, "payment")?;
    let topup = require_format(d, "topup")?;
    let vis = if crate_private { "pub(crate)" } else { "pub" };
    let mut out = generated_header(CommentStyle::LineSlash, flag);
    let _ = writeln!(
        out,
        "\n//! Frozen contract defaults (`defaults:` in sdk-contract.yaml).\n\
         \n\
         /// Retry attempts after the initial call.\n\
         {vis} const DEFAULT_MAX_RETRIES: u32 = {max};\n\
         /// Initial retry delay in milliseconds.\n\
         {vis} const DEFAULT_INITIAL_DELAY_MS: u64 = {delay};\n\
         /// Retry backoff name.\n\
         {vis} const RETRY_BACKOFF: &str = \"{backoff}\";\n\
         /// Webhook timestamp tolerance in seconds.\n\
         {vis} const WEBHOOK_TOLERANCE_SEC: i64 = {tolerance};\n\
         /// Default limits-cache TTL in milliseconds.\n\
         {vis} const DEFAULT_LIMITS_CACHE_TTL_MS: u64 = {limits};\n\
         /// Frozen customer-dedup TTL (`defaults.customerDedupTTLMs`).\n\
         {vis} const CUSTOMER_DEDUP_TTL_MS: u64 = {dedup};\n\
         /// Frozen customer-dedup max cache size (`defaults.customerDedupMaxCacheSize`).\n\
         {vis} const CUSTOMER_DEDUP_MAX_CACHE_SIZE: usize = {cache};\n\
         /// Frozen anonymous customer ref (`defaults.anonymousCustomerRef`).\n\
         {vis} const ANONYMOUS_CUSTOMER_REF: &str = \"{anon}\";\n\
         /// Frozen `trackUsage` request-id template (`defaults.requestIdFormat`).\n\
         {vis} const REQUEST_ID_FORMAT: &str = \"{request}\";\n\
         /// Frozen `trackUsage.actionType` (`defaults.usageActionType`).\n\
         {vis} const USAGE_ACTION_TYPE: &str = \"{usage}\";\n\
         /// Payment idempotency-key template (`defaults.idempotencyKeyFormats.payment`).\n\
         {vis} const PAYMENT_IDEMPOTENCY_KEY_FORMAT: &str = \"{payment}\";\n\
         /// Top-up idempotency-key template (`defaults.idempotencyKeyFormats.topup`).\n\
         {vis} const TOPUP_IDEMPOTENCY_KEY_FORMAT: &str = \"{topup}\";\n\
         /// Go methods take `context.Context` as the first parameter.\n\
         {vis} const GO_CONTEXT_FIRST_PARAM: bool = {go_ctx};\n",
        max = d.max_retries,
        delay = grouped(d.initial_delay_ms),
        backoff = escape_double(&d.retry_backoff),
        tolerance = d.webhook_tolerance_sec,
        limits = grouped(d.limits_cache_ttl_ms),
        dedup = grouped(d.customer_dedup_ttl_ms),
        cache = d.customer_dedup_max_cache_size,
        anon = escape_double(&d.anonymous_customer_ref),
        request = escape_double(&d.request_id_format),
        usage = escape_double(&d.usage_action_type),
        payment = escape_double(payment),
        topup = escape_double(topup),
        go_ctx = if d.go_context_first_param {
            "true"
        } else {
            "false"
        },
    );
    Ok(out)
}

fn require_paywall<'a>(ir: &'a Ir, key: &str) -> GenResult<&'a str> {
    ir.error_templates
        .paywall_messages
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| GenError::Parse(format!("errors.paywall.messages.{key} is required")))
}

fn require_format<'a>(defaults: &'a IrDefaults, key: &str) -> GenResult<&'a str> {
    defaults
        .idempotency_key_formats
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| GenError::Parse(format!("defaults.idempotencyKeyFormats.{key} is required")))
}

/// Digit grouping used by the hand-written defaults (`60_000`, `1000`).
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    if digits.len() < 5 {
        return digits;
    }
    let mut out = String::new();
    for (i, ch) in digits.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push('_');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}

fn escape_single(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn escape_double(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn gofmt_source(src: &str) -> GenResult<String> {
    let mut child = Command::new("gofmt")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| GenError::Parse(format!("failed to spawn gofmt: {e}")))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| GenError::Parse("gofmt stdin is closed".into()))?
        .write_all(src.as_bytes())
        .map_err(|e| GenError::Parse(format!("failed to write gofmt stdin: {e}")))?;
    let output = child
        .wait_with_output()
        .map_err(|e| GenError::Parse(format!("gofmt failed: {e}")))?;
    if !output.status.success() {
        return Err(GenError::Parse(format!(
            "gofmt exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    String::from_utf8(output.stdout).map_err(|e| GenError::Parse(format!("gofmt stdout: {e}")))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn contract_ir() -> Ir {
        let mut ir = Ir::default();
        ir.defaults.go_context_first_param = true;
        ir.defaults.idempotency_key_formats.insert(
            "payment".into(),
            "payment-{planRef}-{epochMs}-{random9}".into(),
        );
        ir.defaults
            .idempotency_key_formats
            .insert("topup".into(), "topup-{epochMs}-{random9}".into());
        ir
    }

    #[test]
    fn typescript_defaults_include_the_live_dedup_ttl() {
        let ts = emit_defaults_ts(&contract_ir()).unwrap();
        assert!(ts.contains("export const CUSTOMER_DEDUP_TTL_MS = 60_000"));
        assert!(ts.contains(
            "export const PAYMENT_IDEMPOTENCY_KEY_FORMAT = 'payment-{planRef}-{epochMs}-{random9}'"
        ));
        assert!(ts.contains("@generated by dto-gen (--ts-defaults-out)"));
    }

    #[test]
    fn missing_idempotency_format_fails() {
        let err = emit_defaults_ts(&Ir::default()).unwrap_err();
        assert!(
            err.to_string().contains("idempotencyKeyFormats.payment"),
            "{err}"
        );
    }
}
