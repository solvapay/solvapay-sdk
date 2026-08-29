//! Composite MCP ops on [`crate::SolvaPayClient`].
//!
//! Available on native and `wasm32-unknown` (edge `WasmClient`). The browser
//! wasm crate does not depend on this transport crate, so these stay off the
//! public-safe browser surface.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use solvapay_core::{
    billing_cycle, counts_usage, credits_per_unit_from_balance, credits_to_display_minor_units,
    get_business_country_options, get_tax_id_example, get_tax_id_field_label,
    get_tax_id_helper_text, headline_charges, included_units, is_error_result, meter_name,
    minor_units_per_major, normalize_cancel_response, normalize_reactivate_response,
    per_unit_charge, project_topup_process_outcome, project_usage_snapshot,
    resolve_purchase_customer_ref, resolve_seller_identity_display, select_active_purchases,
    trial_days, validate_activate_plan_params, validate_attach_business_details_params,
    validate_create_payment_intent_params, validate_process_payment_intent_params,
    validate_purchase_ref, validate_topup_payment_intent_params, CreditsToDisplayInput, SdkError,
    SellerIdentityInput,
};
use solvapay_dto::{
    ActivatePlanDto, AttachBusinessDetailsParams, CancelPurchaseParams, CheckLimitsRequest,
    CreateCheckoutSessionRequest, CreateCustomerSessionRequest, CreatePaymentIntentParams,
    CreateTopupPaymentIntentParams, GetCustomerBalanceParams, GetCustomerParams,
    GetPaymentMethodParams, ProcessPaymentIntentParams, ReactivatePurchaseParams,
};
use solvapay_mcp_core::{
    mcp_descriptors, mcp_handle_request, mcp_overview_resource, narrated_tool_result,
    new_widget_session_id, parse_mode, tool_error_result, tool_result, HandleRequestInput,
    McpDescriptorsInput,
};

use crate::client::SolvaPayClient;
use crate::http::{HeaderName, HttpRequest, HttpResponse, Method};

mod oauth_proxy;

/// Arguments for [`SolvaPayClient::mcp_bootstrap`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBootstrapParams {
    /// Widget view (`account` / `checkout` / `topup`).
    pub view: String,
    /// Product ref.
    pub product_ref: String,
    /// Public origin used as `returnUrl`.
    pub public_base_url: String,
    /// Authenticated customer, when known.
    #[serde(default)]
    pub customer_ref: Option<String>,
}

/// Arguments for [`SolvaPayClient::mcp_call_builtin_tool`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallBuiltinToolParams {
    /// Builtin tool name.
    pub name: String,
    /// Tool arguments.
    #[serde(default)]
    pub args: Value,
    /// Descriptor / bootstrap config.
    pub config: McpToolConfig,
    /// Optional customer.
    #[serde(default)]
    pub customer_ref: Option<String>,
    /// Optional widget session id (tests pin this; hosts omit it).
    #[serde(default)]
    pub widget_session_id: Option<String>,
}

/// Shared MCP server config for builtins / resources / OAuth.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolConfig {
    /// Product ref.
    pub product_ref: String,
    /// Public origin.
    pub public_base_url: String,
    /// UI resource URI.
    #[serde(default)]
    pub resource_uri: Option<String>,
    /// Views.
    #[serde(default)]
    pub views: Option<Vec<String>>,
    /// Optional MCP mount path for OAuth resource identifiers.
    #[serde(default)]
    pub mcp_path: Option<String>,
}

/// Arguments for [`SolvaPayClient::mcp_read_resource`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpReadResourceParams {
    /// Resource URI.
    pub uri: String,
    /// Server config.
    pub config: McpToolConfig,
    /// Optional customer (bootstrap resource).
    #[serde(default)]
    pub customer_ref: Option<String>,
}

/// Arguments for [`SolvaPayClient::mcp_dispatch`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDispatchParams {
    /// JSON-RPC request object.
    pub rpc: Value,
    /// Engine config.
    pub config: solvapay_mcp_core::EngineConfig,
    /// Optional Authorization header.
    #[serde(default)]
    pub auth_header: Option<String>,
}

/// Arguments for [`SolvaPayClient::mcp_oauth_request`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthRequestParams {
    /// HTTP method.
    pub method: String,
    /// Request path (may include query).
    pub path: String,
    /// Incoming headers (lowercase keys).
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Raw body.
    #[serde(default)]
    pub body: String,
    /// OAuth / discovery config.
    pub config: McpOauthConfig,
}

/// OAuth proxy config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthConfig {
    /// Public MCP origin.
    pub public_base_url: String,
    /// Optional MCP mount path.
    #[serde(default)]
    pub mcp_path: Option<String>,
    /// Product ref for DCR.
    pub product_ref: String,
    /// Optional OAuth path overrides.
    #[serde(default)]
    pub oauth_paths: Option<solvapay_mcp_core::OauthPaths>,
}

const PROVIDER_NOT_FOUND: &str = "Provider account not found on this SolvaPay deployment.\n\n\
The Worker secret key authenticates against SolvaPay, but no merchant\n\
record exists for it. This usually means the secret key was created\n\
manually (without running `solvapay init`) or the merchant was deleted.\n\n\
To recover:\n\
  1. Run `npx solvapay init` in the project root. It will create the\n\
     merchant on the backend and write a valid secret key to `.env`.\n\
  2. Redeploy with `npm run deploy` to push the corrected secret to\n\
     the Worker.\n\n\
No tool calls will succeed until the merchant exists.";

fn unauthenticated() -> Value {
    tool_error_result(
        "Unauthorized",
        401,
        Some("customer_ref missing from MCP auth context"),
    )
}

fn require_customer(customer_ref: Option<&str>) -> Result<&str, Value> {
    customer_ref.ok_or_else(unauthenticated)
}

fn helper_error_tool(err: &solvapay_core::HelperErrorResult) -> Value {
    tool_error_result(&err.error, err.status, err.details.as_deref())
}

fn wrap_ok(value: Value) -> Value {
    tool_result(&value)
}

fn widget_meta(session: &str, resource_uri: Option<&str>) -> Value {
    let mut meta = json!({ "openai/widgetSessionId": session });
    if let Some(uri) = resource_uri.filter(|uri| !uri.is_empty()) {
        meta["ui"] = json!({ "resourceUri": uri });
        meta["ui/resourceUri"] = json!(uri);
    }
    meta
}

fn sdk_error_placeholder(err: &SdkError) -> Value {
    match err {
        SdkError::Api {
            message, status, ..
        } => json!({
            "error": message,
            "status": status.unwrap_or(500)
        }),
        SdkError::Transport { message, .. } => json!({ "error": message, "status": 500 }),
        SdkError::Paywall { message, .. } => json!({ "error": message, "status": 402 }),
        _ => json!({ "error": "internal", "status": 500 }),
    }
}

fn wrap_ok_or_placeholder<T: Serialize>(result: Result<T, SdkError>) -> Value {
    match result {
        Ok(value) => serde_json::to_value(value).unwrap_or(Value::Null),
        Err(err) => sdk_error_placeholder(&err),
    }
}

fn bootstrap_lookup_error(prefix: &str, placeholder: &Value) -> SdkError {
    let status = placeholder
        .get("status")
        .and_then(Value::as_u64)
        .map(|s| s as u16);
    let err = placeholder
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("lookup failed");
    let message = if status == Some(404) && prefix == "merchant" {
        PROVIDER_NOT_FOUND.to_owned()
    } else {
        format!("bootstrap: {prefix} lookup failed: {err}")
    };
    SdkError::Api {
        message,
        status,
        code: None,
    }
}

#[allow(clippy::cast_possible_truncation)]
fn enrich_plan(mut plan: Value, balance: Option<&Value>) -> Value {
    let default_currency = plan
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("USD")
        .to_ascii_uppercase();
    let charges = headline_charges(Some(&plan));
    let pricing_options: Vec<Value> = charges
        .iter()
        .map(|charge| {
            json!({
                "currency": charge.currency,
                "price": charge.amount_minor as i64,
                "default": charge.currency.eq_ignore_ascii_case(&default_currency),
            })
        })
        .collect();
    let display = json!({
        "billingCycle": billing_cycle(Some(&plan)),
        "countsUsage": counts_usage(Some(&plan)),
        "includedUnits": included_units(Some(&plan), None),
        "meterName": meter_name(Some(&plan)),
        "perUnitCharge": per_unit_charge(Some(&plan), None),
        "creditsPerUnit": credits_per_unit_from_balance(Some(&plan), balance, None),
        "trialDays": trial_days(Some(&plan)),
    });
    if let Some(obj) = plan.as_object_mut() {
        if !pricing_options.is_empty() {
            obj.insert("pricingOptions".to_owned(), Value::Array(pricing_options));
        }
        obj.insert("display".to_owned(), display);
    }
    plan
}

fn enrich_merchant(mut merchant: Value) -> Value {
    let identity = resolve_seller_identity_display(&SellerIdentityInput {
        country: merchant
            .get("country")
            .and_then(Value::as_str)
            .map(str::to_owned),
        vat_number: merchant
            .get("vatNumber")
            .and_then(Value::as_str)
            .map(str::to_owned),
        tax_id: merchant
            .get("taxId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        company_number: merchant
            .get("companyNumber")
            .and_then(Value::as_str)
            .map(str::to_owned),
    });
    if let Some(obj) = merchant.as_object_mut() {
        obj.insert(
            "identityDisplay".to_owned(),
            serde_json::to_value(identity).unwrap_or(Value::Null),
        );
    }
    merchant
}

fn enrich_balance(mut balance: Value) -> Value {
    let credits = balance.get("credits").and_then(Value::as_f64);
    let credits_per_minor_unit = balance.get("creditsPerMinorUnit").and_then(Value::as_f64);
    let display_currency = balance
        .get("displayCurrency")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let display_exchange_rate = balance
        .get("displayExchangeRate")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    if let (Some(credits), Some(credits_per_minor_unit), Some(display_currency)) =
        (credits, credits_per_minor_unit, display_currency)
    {
        let display_minor = credits_to_display_minor_units(&CreditsToDisplayInput {
            credits,
            credits_per_minor_unit,
            display_exchange_rate,
            display_currency: display_currency.clone(),
        });
        let minor_per_major = minor_units_per_major(&display_currency);
        if let Some(obj) = balance.as_object_mut() {
            if let Some(minor) = display_minor {
                obj.insert("displayMinorUnits".to_owned(), json!(minor));
            }
            obj.insert("minorUnitsPerMajor".to_owned(), json!(minor_per_major));
        }
    }
    balance
}

fn tax_id_fields_table() -> Value {
    let mut map = Map::new();
    for option in get_business_country_options() {
        let code = option.value;
        map.insert(
            code.clone(),
            json!({
                "label": get_tax_id_field_label(&code),
                "example": get_tax_id_example(&code),
                "helperText": get_tax_id_helper_text(&code),
            }),
        );
    }
    Value::Object(map)
}

fn enrich_purchase(mut purchase: Value) -> Value {
    let amount = purchase.get("amount").and_then(Value::as_f64);
    let original = purchase.get("originalAmount").and_then(Value::as_f64);
    let currency = purchase
        .get("currency")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let price_display = format_minor_intl(original, currency.as_deref())
        .or_else(|| format_minor_intl(amount, Some("USD")));
    let price_usd_display = currency.as_deref().and_then(|c| {
        if c.eq_ignore_ascii_case("USD") {
            None
        } else {
            format_minor_intl(amount, Some("USD"))
        }
    });
    if let Some(obj) = purchase.as_object_mut() {
        if let Some(display) = price_display {
            obj.insert("priceDisplay".to_owned(), Value::String(display));
        }
        if let Some(display) = price_usd_display {
            obj.insert("priceUsdDisplay".to_owned(), Value::String(display));
        }
        if let Some(Value::Object(snap)) = obj.get_mut("planSnapshot") {
            let price = snap.get("price").and_then(Value::as_f64);
            let snap_currency = snap
                .get("currency")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(display) = format_minor_intl(price, snap_currency.as_deref()) {
                snap.insert("priceDisplay".to_owned(), Value::String(display));
            }
        }
        if let Some(snap) = obj.remove("planSnapshot") {
            obj.insert("planSnapshot".to_owned(), enrich_plan(snap, None));
        }
    }
    purchase
}

fn format_minor_intl(amount: Option<f64>, currency: Option<&str>) -> Option<String> {
    let amount = amount?;
    let currency = currency?;
    format_money_intl(amount, currency)
}

fn format_money_intl(amount_minor: f64, currency: &str) -> Option<String> {
    let zero = matches!(
        currency.to_ascii_lowercase().as_str(),
        "bif"
            | "clp"
            | "djf"
            | "gnf"
            | "jpy"
            | "kmf"
            | "krw"
            | "mga"
            | "pyg"
            | "rwf"
            | "ugx"
            | "vnd"
            | "vuv"
            | "xaf"
            | "xof"
            | "xpf"
    );
    let major = if zero {
        amount_minor
    } else {
        amount_minor / 100.0
    };
    let fraction = if zero { 0 } else { 2 };
    Some(format_major_intl(major, currency, fraction))
}

fn format_major_intl(major: f64, currency: &str, fraction: usize) -> String {
    let code = currency.to_ascii_uppercase();
    let int_part = major.trunc() as i64;
    let mut grouped = String::new();
    let digits: Vec<char> = int_part.abs().to_string().chars().collect();
    for (i, ch) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(*ch);
    }
    let sign = if major.is_sign_negative() { "-" } else { "" };
    let formatted = if fraction == 0 {
        format!("{sign}{grouped}")
    } else {
        let scale = 10_i64.pow(fraction as u32);
        let frac = ((major.abs() * scale as f64).round() as i64) % scale;
        format!("{sign}{grouped}.{frac:0width$}", width = fraction)
    };
    match code.as_str() {
        "USD" => format!("${formatted}"),
        "EUR" => format!("€{formatted}"),
        "GBP" => format!("£{formatted}"),
        "JPY" => format!("¥{formatted}"),
        other => format!("{other}\u{00a0}{formatted}"),
    }
}

fn check_limits_request(customer_ref: &str, product_ref: &str) -> CheckLimitsRequest {
    CheckLimitsRequest {
        base: solvapay_dto::schemas::CheckLimitRequest {
            customer_ref: Some(customer_ref.to_owned()),
            include_checkout_session: None,
            meter_name: Some("requests".to_owned()),
            product_ref: Some(product_ref.to_owned()),
            usage_type: None,
        },
        include_checkout_session: None,
    }
}

impl SolvaPayClient {
    /// Fan-out bootstrap payload for the MCP widget (`mcpBootstrap`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 36,
        dto_type = "solvapay_transport::McpBootstrapParams"
    )]
    pub async fn mcp_bootstrap(&self, params: McpBootstrapParams) -> Result<Value, SdkError> {
        let customer_ref = params
            .customer_ref
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let platform = self.get_platform_config_json().await.ok();
        let stripe_publishable_key = platform.and_then(|p| {
            p.get("stripePublishableKey")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

        let merchant_value = wrap_ok_or_placeholder(self.get_merchant_json().await);
        if is_error_result(&merchant_value) {
            return Err(bootstrap_lookup_error("merchant", &merchant_value));
        }
        let product_value = wrap_ok_or_placeholder(self.get_product(&params.product_ref).await);
        if is_error_result(&product_value) {
            return Err(bootstrap_lookup_error("product", &product_value));
        }

        let plans_raw = self.list_plans(&params.product_ref).await;
        let plans_unenriched = match plans_raw {
            Ok(Value::Array(items)) => items,
            Ok(Value::Object(map)) => map
                .get("plans")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            _ => Vec::new(),
        };

        let customer = match customer_ref {
            None => None,
            Some(customer_ref) => {
                let purchase_result = check_purchase(self, customer_ref).await;
                let payment_method = wrap_ok_or_placeholder(
                    self.get_payment_method(GetPaymentMethodParams {
                        customer_ref: customer_ref.to_owned(),
                    })
                    .await,
                );
                let balance = wrap_ok_or_placeholder(
                    self.get_customer_balance(GetCustomerBalanceParams {
                        customer_ref: customer_ref.to_owned(),
                    })
                    .await,
                );
                let usage = match self
                    .check_limits(check_limits_request(customer_ref, &params.product_ref))
                    .await
                {
                    Ok(limits) => serde_json::to_value(project_usage_snapshot(None, Some(&limits)))
                        .unwrap_or(Value::Null),
                    Err(err) => sdk_error_placeholder(&err),
                };
                let balance_value = if is_error_result(&balance) {
                    Value::Null
                } else {
                    enrich_balance(balance)
                };
                let purchase = if is_error_result(&purchase_result) {
                    Value::Null
                } else {
                    enrich_purchase(purchase_result)
                };
                Some(json!({
                    "ref": customer_ref,
                    "purchase": purchase,
                    "paymentMethod": if is_error_result(&payment_method) { Value::Null } else { payment_method },
                    "balance": balance_value,
                    "usage": if is_error_result(&usage) { Value::Null } else { usage },
                }))
            }
        };

        let balance_for_plans = customer
            .as_ref()
            .and_then(|c| c.get("balance"))
            .filter(|b| !b.is_null());
        let plans: Vec<Value> = plans_unenriched
            .into_iter()
            .map(|plan| enrich_plan(plan, balance_for_plans))
            .collect();

        Ok(json!({
            "view": params.view,
            "productRef": params.product_ref,
            "stripePublishableKey": stripe_publishable_key,
            "returnUrl": params.public_base_url,
            "merchant": enrich_merchant(merchant_value),
            "product": product_value,
            "plans": plans,
            "customer": customer,
            "taxIdFields": tax_id_fields_table(),
        }))
    }

    /// Run one builtin MCP tool (`mcpCallBuiltinTool`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 37,
        dto_type = "solvapay_transport::McpCallBuiltinToolParams"
    )]
    pub async fn mcp_call_builtin_tool(
        &self,
        params: McpCallBuiltinToolParams,
    ) -> Result<Value, SdkError> {
        let args = if params.args.is_object() {
            params.args.clone()
        } else {
            json!({})
        };
        let product_ref = args
            .get("productRef")
            .and_then(Value::as_str)
            .unwrap_or(&params.config.product_ref);
        let customer_ref = params
            .customer_ref
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let mode = match parse_mode(args.get("mode").and_then(Value::as_str)) {
            "text" => "text",
            _ => "ui",
        };
        let session = params
            .widget_session_id
            .clone()
            .unwrap_or_else(new_widget_session_id);
        match params.name.as_str() {
            "upgrade" | "manage_account" | "topup" => {
                let view = match params.name.as_str() {
                    "upgrade" => "checkout",
                    "manage_account" => "account",
                    _ => "topup",
                };
                let payload: Value = self
                    .mcp_bootstrap(McpBootstrapParams {
                        view: view.to_owned(),
                        product_ref: product_ref.to_owned(),
                        public_base_url: params.config.public_base_url.clone(),
                        customer_ref: params.customer_ref.clone(),
                    })
                    .await?;
                Ok(narrated_tool_result(
                    params.name.as_str(),
                    &payload,
                    mode,
                    Some(&widget_meta(
                        &session,
                        params.config.resource_uri.as_deref(),
                    )),
                ))
            }
            "create_checkout_session" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                let plan_ref = args
                    .get("planRef")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let session = self
                    .create_checkout_session_json(CreateCheckoutSessionRequest {
                        customer_ref: Some(customer_ref.to_owned()),
                        plan_ref,
                        product_ref: Some(product_ref.to_owned()),
                        purpose: None,
                        return_url: Some(params.config.public_base_url.clone()),
                    })
                    .await?;
                Ok(wrap_ok(session))
            }
            "create_customer_session" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                let session = self
                    .create_customer_session_json(CreateCustomerSessionRequest {
                        customer_ref: Some(customer_ref.to_owned()),
                        product_ref: Some(product_ref.to_owned()),
                    })
                    .await?;
                Ok(wrap_ok(session))
            }
            "create_payment_intent" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                if let Some(err) = validate_create_payment_intent_params(
                    args.get("planRef").and_then(Value::as_str),
                    Some(product_ref),
                ) {
                    return Ok(helper_error_tool(&err));
                }
                let plan_ref = args.get("planRef").and_then(Value::as_str).unwrap_or("");
                let created = self
                    .create_payment_intent_json(CreatePaymentIntentParams {
                        plan_ref: plan_ref.to_owned(),
                        product_ref: product_ref.to_owned(),
                        customer_ref: customer_ref.to_owned(),
                        currency: args
                            .get("currency")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        idempotency_key: None,
                    })
                    .await?;
                Ok(wrap_ok(created))
            }
            "process_payment" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                if let Some(err) = validate_process_payment_intent_params(
                    args.get("paymentIntentId").and_then(Value::as_str),
                    Some(product_ref),
                ) {
                    return Ok(helper_error_tool(&err));
                }
                let payment_intent_id = args
                    .get("paymentIntentId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let value = self
                    .process_payment_intent_json(ProcessPaymentIntentParams {
                        payment_intent_id: payment_intent_id.to_owned(),
                        product_ref: Some(product_ref.to_owned()),
                        customer_ref: customer_ref.to_owned(),
                        plan_ref: args
                            .get("planRef")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    })
                    .await?;
                let outcome = project_topup_process_outcome(
                    value.get("status").and_then(Value::as_str),
                    value.get("message").and_then(Value::as_str),
                );
                let mut out = serde_json::to_value(outcome)
                    .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))?;
                if out.get("message").is_none() {
                    out.as_object_mut()
                        .map(|m| m.insert("message".to_owned(), Value::Null));
                }
                Ok(wrap_ok(out))
            }
            "create_topup_payment_intent" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                if let Some(err) = validate_topup_payment_intent_params(
                    args.get("amount").and_then(Value::as_f64),
                    args.get("currency").and_then(Value::as_str),
                ) {
                    return Ok(helper_error_tool(&err));
                }
                let created = self
                    .create_topup_payment_intent_json(CreateTopupPaymentIntentParams {
                        amount: args.get("amount").and_then(Value::as_f64).unwrap_or(0.0),
                        currency: args
                            .get("currency")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned(),
                        customer_ref: customer_ref.to_owned(),
                        description: args
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        auto_recharge: None,
                        idempotency_key: None,
                    })
                    .await?;
                Ok(wrap_ok(created))
            }
            "attach_business_details" => {
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                if let Some(err) = validate_attach_business_details_params(
                    args.get("paymentIntentId").and_then(Value::as_str),
                ) {
                    return Ok(helper_error_tool(&err));
                }
                let attached = self
                    .attach_business_details(AttachBusinessDetailsParams {
                        payment_intent_id: args
                            .get("paymentIntentId")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned(),
                        is_business: args.get("isBusiness") == Some(&Value::Bool(true)),
                        business_name: args
                            .get("businessName")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        country: args
                            .get("country")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        tax_id: args.get("taxId").and_then(Value::as_str).map(str::to_owned),
                        tax_id_type: args
                            .get("taxIdType")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        customer_ref: Some(customer_ref.to_owned()),
                        customer_country: None,
                        customer_name: None,
                    })
                    .await?;
                Ok(wrap_ok(attached))
            }
            "cancel_renewal" => {
                if let Err(err) = require_customer(customer_ref) {
                    return Ok(err);
                }
                if let Some(err) =
                    validate_purchase_ref(args.get("purchaseRef").and_then(Value::as_str))
                {
                    return Ok(helper_error_tool(&err));
                }
                let purchase_ref = args
                    .get("purchaseRef")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let cancelled = self
                    .cancel_purchase(CancelPurchaseParams {
                        purchase_ref: purchase_ref.to_owned(),
                        reason: args
                            .get("reason")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    })
                    .await?;
                match normalize_cancel_response(&cancelled) {
                    Ok(value) => {
                        self.shell()
                            .delay(std::time::Duration::from_millis(500))
                            .await;
                        Ok(wrap_ok(value))
                    }
                    Err(err) => Ok(helper_error_tool(&err)),
                }
            }
            "reactivate_renewal" => {
                if let Err(err) = require_customer(customer_ref) {
                    return Ok(err);
                }
                if let Some(err) =
                    validate_purchase_ref(args.get("purchaseRef").and_then(Value::as_str))
                {
                    return Ok(helper_error_tool(&err));
                }
                let purchase_ref = args
                    .get("purchaseRef")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let reactivated = self
                    .reactivate_purchase(ReactivatePurchaseParams {
                        purchase_ref: purchase_ref.to_owned(),
                    })
                    .await?;
                match normalize_reactivate_response(&reactivated) {
                    Ok(value) => {
                        self.shell()
                            .delay(std::time::Duration::from_millis(500))
                            .await;
                        Ok(wrap_ok(value))
                    }
                    Err(err) => Ok(helper_error_tool(&err)),
                }
            }
            "activate_plan" => {
                let plan_ref = args
                    .get("planRef")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty());
                if plan_ref.is_none() {
                    let views = params.config.views.clone().unwrap_or_else(|| {
                        vec![
                            "checkout".to_owned(),
                            "account".to_owned(),
                            "topup".to_owned(),
                        ]
                    });
                    if !views.iter().any(|v| v == "checkout") {
                        return Ok(tool_error_result(
                            "activate_plan requires a planRef on this server",
                            400,
                            Some("The checkout view (where the plan picker lives) is not enabled on this server. Pass `planRef` to activate a specific plan, or re-enable the \"checkout\" view via the `views` option."),
                        ));
                    }
                    let payload: Value = self
                        .mcp_bootstrap(McpBootstrapParams {
                            view: "checkout".to_owned(),
                            product_ref: product_ref.to_owned(),
                            public_base_url: params.config.public_base_url.clone(),
                            customer_ref: params.customer_ref.clone(),
                        })
                        .await?;
                    return Ok(narrated_tool_result(
                        "activate_plan",
                        &payload,
                        mode,
                        Some(&widget_meta(
                            &session,
                            params.config.resource_uri.as_deref(),
                        )),
                    ));
                }
                let customer_ref = match require_customer(customer_ref) {
                    Ok(v) => v,
                    Err(err) => return Ok(err),
                };
                if let Some(err) = validate_activate_plan_params(Some(product_ref), plan_ref) {
                    return Ok(helper_error_tool(&err));
                }
                let activated = self
                    .execute_json(
                        Method::Post,
                        "/v1/sdk/activate".to_owned(),
                        BTreeMap::new(),
                        Some(&ActivatePlanDto {
                            customer_ref: Some(customer_ref.to_owned()),
                            product_ref: Some(product_ref.to_owned()),
                            plan_ref: plan_ref.map(str::to_owned),
                        }),
                        crate::Idempotency::None,
                        solvapay_dto::error_templates::operations::activate_plan::DEFAULT,
                    )
                    .await?;
                Ok(wrap_ok(activated))
            }
            other => Err(SdkError::transport(
                format!("unknown builtin tool: {other}"),
                false,
            )),
        }
    }

    /// Read an MCP resource (`mcpReadResource`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 38,
        dto_type = "solvapay_transport::McpReadResourceParams"
    )]
    pub async fn mcp_read_resource(
        &self,
        params: McpReadResourceParams,
    ) -> Result<Value, SdkError> {
        match params.uri.as_str() {
            "docs://solvapay/overview.md" => serde_json::to_value(mcp_overview_resource())
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false)),
            "solvapay://bootstrap.json" => {
                self.mcp_bootstrap(McpBootstrapParams {
                    view: "account".to_owned(),
                    product_ref: params.config.product_ref.clone(),
                    public_base_url: params.config.public_base_url.clone(),
                    customer_ref: params.customer_ref.clone(),
                })
                .await
            }
            uri if params.config.resource_uri.as_deref() == Some(uri) => {
                let desc = mcp_descriptors(&McpDescriptorsInput {
                    resource_uri: uri.to_owned(),
                    public_base_url: params.config.public_base_url.clone(),
                    product_ref: params.config.product_ref.clone(),
                    views: params.config.views.clone(),
                    csp: None,
                    api_base_url: None,
                    branding: None,
                })
                .map_err(|message| SdkError::transport(message, false))?;
                Ok(json!({
                    "uri": uri,
                    "mimeType": "text/html;profile=mcp-app",
                    "csp": desc.csp,
                }))
            }
            other => Err(SdkError::transport(
                format!("unknown resource uri: {other}"),
                false,
            )),
        }
    }

    /// Handle one OAuth HTTP request (`mcpOauthRequest`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 39,
        dto_type = "solvapay_transport::McpOauthRequestParams"
    )]
    pub async fn mcp_oauth_request(
        &self,
        params: McpOauthRequestParams,
    ) -> Result<Value, SdkError> {
        oauth_proxy::handle(self, &params).await
    }

    /// Route one MCP JSON-RPC request (`mcpDispatch`).
    #[solvapay_core::solvapay_export(
        catalog = "operation",
        section = "MCP composite",
        emit_order = 40,
        dto_type = "solvapay_transport::McpDispatchParams"
    )]
    pub async fn mcp_dispatch(&self, params: McpDispatchParams) -> Result<Value, SdkError> {
        let handled = mcp_handle_request(&HandleRequestInput {
            rpc: params.rpc,
            config: params.config.clone(),
            auth_header: params.auth_header.clone(),
        })
        .map_err(|message| SdkError::transport(message, false))?;
        match handled.get("kind").and_then(Value::as_str) {
            Some("callBuiltin") => {
                let result = self
                    .mcp_call_builtin_tool(McpCallBuiltinToolParams {
                        name: handled
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned(),
                        args: handled.get("args").cloned().unwrap_or(json!({})),
                        config: McpToolConfig {
                            product_ref: params.config.product_ref.clone(),
                            public_base_url: params.config.public_base_url.clone(),
                            resource_uri: Some(params.config.resource_uri.clone()),
                            views: params.config.views.clone(),
                            mcp_path: params.config.mcp_path.clone(),
                        },
                        customer_ref: handled
                            .get("customerRef")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        widget_session_id: None,
                    })
                    .await?;
                let id = handled.get("rpcId").cloned().unwrap_or(Value::Null);
                Ok(json!({
                    "kind": "rpc",
                    "rpc": { "jsonrpc": "2.0", "id": id, "result": result }
                }))
            }
            Some("readResource") => {
                let uri = handled
                    .get("uri")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                let contents = self
                    .mcp_read_resource(McpReadResourceParams {
                        uri: uri.clone(),
                        config: McpToolConfig {
                            product_ref: params.config.product_ref.clone(),
                            public_base_url: params.config.public_base_url.clone(),
                            resource_uri: Some(params.config.resource_uri.clone()),
                            views: params.config.views.clone(),
                            mcp_path: params.config.mcp_path.clone(),
                        },
                        customer_ref: None,
                    })
                    .await?;
                let id = handled.get("rpcId").cloned().unwrap_or(Value::Null);
                let text = if contents.get("body").and_then(Value::as_str).is_some() {
                    contents.get("body").cloned().unwrap_or(Value::Null)
                } else {
                    Value::String(contents.to_string())
                };
                Ok(json!({
                    "kind": "rpc",
                    "rpc": {
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "contents": [{
                                "uri": contents.get("uri").cloned().unwrap_or(Value::String(uri)),
                                "mimeType": contents.get("mimeType").cloned().unwrap_or(Value::String("application/json".to_owned())),
                                "text": text
                            }]
                        }
                    }
                }))
            }
            _ => Ok(handled),
        }
    }
}

async fn check_purchase(client: &SolvaPayClient, customer_ref: &str) -> Value {
    match client
        .get_customer(GetCustomerParams {
            customer_ref: Some(customer_ref.to_owned()),
            email: None,
            external_ref: None,
        })
        .await
    {
        Err(_) => json!({ "customerRef": customer_ref, "purchases": [] }),
        Ok(customer) => {
            let value = serde_json::to_value(&customer).unwrap_or(json!({}));
            let purchases = value
                .get("purchases")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let selected = select_active_purchases(&purchases);
            let enriched: Vec<Value> = selected.into_iter().map(enrich_purchase).collect();
            let resolved = resolve_purchase_customer_ref(
                value.get("customerRef").and_then(Value::as_str),
                customer_ref,
            );
            json!({
                "customerRef": resolved,
                "email": value.get("email"),
                "name": value.get("name"),
                "purchases": enriched,
            })
        }
    }
}

pub(crate) fn native_cors_headers(origin: Option<&str>) -> Vec<(String, String)> {
    let Some(origin) = origin.filter(|o| {
        o.starts_with("cursor:")
            || o.starts_with("vscode:")
            || o.starts_with("vscode-webview:")
            || o.starts_with("claude:")
    }) else {
        return Vec::new();
    };
    vec![
        ("access-control-allow-origin".to_owned(), origin.to_owned()),
        ("vary".to_owned(), "Origin".to_owned()),
    ]
}

pub(crate) async fn proxy_customer_auth(
    client: &SolvaPayClient,
    method: Method,
    path_and_query: &str,
    headers: &BTreeMap<String, String>,
    body: &str,
) -> Result<HttpResponse, SdkError> {
    let url = format!("{}{path_and_query}", client.shell().base_url());
    let mut out_headers = Vec::new();
    let content_type = headers
        .get("content-type")
        .cloned()
        .unwrap_or_else(|| "application/json".to_owned());
    out_headers.push((HeaderName::new("Content-Type")?, content_type));
    if let Some(auth) = headers.get("authorization") {
        out_headers.push((HeaderName::new("Authorization")?, auth.clone()));
    }
    client
        .shell()
        .send_http(HttpRequest {
            method,
            url,
            headers: out_headers,
            body: if body.is_empty() {
                None
            } else {
                Some(body.as_bytes().to_vec())
            },
        })
        .await
}

pub(crate) fn http_json_response(status: u16, body: Value, extra: Vec<(String, String)>) -> Value {
    let mut headers = Map::new();
    headers.insert(
        "content-type".to_owned(),
        Value::String("application/json".to_owned()),
    );
    for (k, v) in extra {
        headers.insert(k, Value::String(v));
    }
    json!({ "status": status, "headers": headers, "body": body })
}

#[cfg(test)]
mod enrich_tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;

    #[test]
    fn enrich_plan_emits_pricing_options_and_display() {
        let plan = json!({
            "name": "Pro",
            "currency": "USD",
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 1800, "currency": "USD" },
                { "kind": "charge", "per": "unit", "amountMinor": 2, "currency": "USD", "meter": "requests" },
                { "kind": "limit", "cap": 1000, "meter": "requests" }
            ]
        });
        let balance = json!({
            "displayCurrency": "USD",
            "creditsPerMinorUnit": 100,
            "displayExchangeRate": 1
        });
        let enriched = enrich_plan(plan, Some(&balance));
        assert_eq!(enriched["pricingOptions"][0]["currency"], "USD");
        assert_eq!(enriched["pricingOptions"][0]["price"], 1800);
        assert_eq!(enriched["pricingOptions"][0]["default"], true);
        assert_eq!(enriched["display"]["billingCycle"]["interval"], "month");
        assert_eq!(enriched["display"]["countsUsage"], true);
        assert_eq!(enriched["display"]["includedUnits"], 1000);
        assert_eq!(enriched["display"]["meterName"], "requests");
        assert_eq!(enriched["display"]["perUnitCharge"]["amountMinor"], 2);
        assert_eq!(enriched["display"]["creditsPerUnit"], 200);
    }

    #[test]
    fn enrich_merchant_emits_identity_display() {
        let merchant = json!({
            "displayName": "Acme",
            "country": "DE",
            "vatNumber": "DE123456789"
        });
        let enriched = enrich_merchant(merchant);
        assert_eq!(
            enriched["identityDisplay"]["taxIdentifier"]["label"],
            "VAT number"
        );
        assert_eq!(
            enriched["identityDisplay"]["taxIdentifier"]["value"],
            "DE123456789"
        );
    }

    #[test]
    fn enrich_balance_emits_display_minor_units() {
        let balance = json!({
            "credits": 1500,
            "creditsPerMinorUnit": 100,
            "displayCurrency": "USD",
            "displayExchangeRate": 1
        });
        let enriched = enrich_balance(balance);
        assert_eq!(enriched["displayMinorUnits"], 15);
        assert_eq!(enriched["minorUnitsPerMajor"], 100);
    }

    #[test]
    fn tax_id_fields_covers_supported_countries() {
        let table = tax_id_fields_table();
        let obj = table.as_object().expect("object");
        assert!(obj.len() >= 30);
        assert_eq!(table["DE"]["label"], "VAT ID");
        assert_eq!(table["DE"]["example"], "DE123456789");
        assert!(table["DE"]["helperText"]
            .as_str()
            .unwrap()
            .contains("DE123456789"));
        assert_eq!(table["US"]["label"], "EIN (Employer Identification Number)");
        assert_eq!(table["GB"]["label"], "VAT Number");
    }
}
