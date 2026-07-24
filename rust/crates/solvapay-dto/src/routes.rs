// @generated — do not edit. Regenerate with: pnpm gen

//! Route table and JSON round-trip helpers for generated DTOs.

use serde_json::Value;

use crate::schemas;

/// A matched OpenAPI route and its response body Rust type name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteMatch {
    /// Uppercase HTTP method.
    pub method: &'static str,
    /// Templated OpenAPI path.
    pub path_template: &'static str,
    /// OpenAPI operationId.
    pub operation_id: &'static str,
    /// Response DTO type key when a 2xx JSON schema exists.
    pub response_type: Option<&'static str>,
}

/// OpenAPI routes compiled from the snapshot (method + path template).
const ROUTES: &[RouteMatch] = &[
    RouteMatch {
        method: "DELETE",
        path_template: "/v1/sdk/auto-recharge",
        operation_id: "AutoRechargeSdkController_deleteAutoRecharge",
        response_type: Some("DisableAutoRechargeResponse"),
    },
    RouteMatch {
        method: "DELETE",
        path_template: "/v1/sdk/products/{productRef}",
        operation_id: "ProductSdkController_deleteProduct",
        response_type: Some("DeleteProductsResponse"),
    },
    RouteMatch {
        method: "DELETE",
        path_template: "/v1/sdk/products/{productRef}/plans/{planRef}",
        operation_id: "PlanSdkController_deletePlan",
        response_type: Some("DeletePlansResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/auto-recharge",
        operation_id: "AutoRechargeSdkController_getAutoRecharge",
        response_type: Some("AutoRechargeGetResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/customers",
        operation_id: "CustomerSdkController_getCustomerByQuery",
        response_type: Some("CustomerResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/customers/customer-sessions/{sessionId}",
        operation_id: "CustomerSdkController_getCustomerSession",
        response_type: Some("GetCustomerSessionResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/customers/{reference}",
        operation_id: "CustomerSdkController_getCustomer",
        response_type: Some("CustomerResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/customers/{reference}/balance",
        operation_id: "CustomerSdkController_getCustomerBalance",
        response_type: Some("CustomerBalanceResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/merchant",
        operation_id: "getMerchant",
        response_type: Some("SdkMerchantResponseDto"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/payment-intents",
        operation_id: "PaymentIntentSdkController_getPaymentIntents",
        response_type: Some("SdkPaymentIntentListResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/payment-intents/{reference}",
        operation_id: "PaymentIntentSdkController_getPaymentIntent",
        response_type: Some("SdkPaymentIntentResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/payment-method",
        operation_id: "PaymentMethodSdkController_getPaymentMethod",
        response_type: Some("PaymentMethodResult"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/platform-config",
        operation_id: "getPlatformConfig",
        response_type: Some("SdkPlatformConfigResponseDto"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/products",
        operation_id: "ProductSdkController_listProducts",
        response_type: Some("GetProductsResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/products/{productRef}",
        operation_id: "ProductSdkController_getProduct",
        response_type: Some("SdkProductResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/products/{productRef}/plans",
        operation_id: "PlanSdkController_listPlans",
        response_type: Some("GetPlansResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/products/{productRef}/plans/{planRef}",
        operation_id: "PlanSdkController_getPlan",
        response_type: Some("Plan"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/purchases",
        operation_id: "PurchaseSdkController_listPurchases",
        response_type: Some("GetPurchasesResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/purchases/customer/{customerRef}",
        operation_id: "PurchaseSdkController_getPurchasesForCustomer",
        response_type: Some("GetCustomerResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/purchases/product/{productRef}",
        operation_id: "PurchaseSdkController_getPurchasesForProduct",
        response_type: Some("GetProductResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/purchases/{purchaseRef}",
        operation_id: "PurchaseSdkController_getPurchase",
        response_type: Some("SdkPurchaseResponse"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/webhooks/event-schema",
        operation_id: "WebhookSdkController_getEventSchema",
        response_type: Some("WebhookEventDto"),
    },
    RouteMatch {
        method: "GET",
        path_template: "/v1/sdk/webhooks/event-types",
        operation_id: "WebhookSdkController_listEventTypes",
        response_type: Some("Vec<WebhookEventCategoryDto>"),
    },
    RouteMatch {
        method: "PATCH",
        path_template: "/v1/sdk/customers/{reference}",
        operation_id: "CustomerSdkController_updateCustomer",
        response_type: Some("CustomerResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/activate",
        operation_id: "ActivateSdkController_activate",
        response_type: Some("ActivatePlanResponseDto"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/checkout-sessions",
        operation_id: "CheckoutSessionSdkController_createCheckoutSession",
        response_type: Some("CreateCheckoutSessionResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/customers",
        operation_id: "CustomerSdkController_createCustomer",
        response_type: Some("CustomerResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/customers/customer-sessions",
        operation_id: "CustomerSdkController_createCustomerSession",
        response_type: Some("CreateCustomerSessionResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/customers/{reference}/credits",
        operation_id: "CustomerSdkController_grantCredits",
        response_type: Some("GrantCustomerCreditsResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/limits",
        operation_id: "LimitsSdkController_checkLimits",
        response_type: Some("LimitResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/meter-events",
        operation_id: "MeterEventsSdkController_recordEvent",
        response_type: Some("PostMeterEventsResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/meter-events/bulk",
        operation_id: "MeterEventsSdkController_recordBulkEvents",
        response_type: Some("PostBulkResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/payment-intents",
        operation_id: "PaymentIntentSdkController_createPaymentIntent",
        response_type: Some("SdkPaymentIntentResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/payment-intents/{processorPaymentId}/business-details",
        operation_id: "PaymentIntentSdkController_attachBusinessDetails",
        response_type: None,
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/payment-intents/{processorPaymentId}/process",
        operation_id: "PaymentIntentSdkController_processPaymentIntent",
        response_type: Some("ProcessPaymentResult"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/products",
        operation_id: "ProductSdkController_createProduct",
        response_type: Some("SdkProductResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/products/mcp/bootstrap",
        operation_id: "ProductSdkController_bootstrapMcpProduct",
        response_type: Some("McpBootstrapResult"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/products/{productRef}/clone",
        operation_id: "ProductSdkController_cloneProduct",
        response_type: Some("SdkProductResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/products/{productRef}/plans",
        operation_id: "PlanSdkController_createPlan",
        response_type: Some("Plan"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/purchases/{purchaseRef}/cancel",
        operation_id: "PurchaseSdkController_cancelPurchase",
        response_type: Some("PostCancelResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/purchases/{purchaseRef}/reactivate",
        operation_id: "PurchaseSdkController_reactivatePurchase",
        response_type: Some("PostReactivateResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/usages",
        operation_id: "UsageSdkController_recordUsage",
        response_type: Some("UsageRecordResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/usages/bulk",
        operation_id: "UsageSdkController_recordBulkUsage",
        response_type: Some("BulkUsageResponse"),
    },
    RouteMatch {
        method: "POST",
        path_template: "/v1/sdk/user-info",
        operation_id: "UserInfoSdkController_getUserInfo",
        response_type: Some("UserInfoResponse"),
    },
    RouteMatch {
        method: "PUT",
        path_template: "/v1/sdk/auto-recharge",
        operation_id: "AutoRechargeSdkController_putAutoRecharge",
        response_type: Some("SaveAutoRechargeResponse"),
    },
    RouteMatch {
        method: "PUT",
        path_template: "/v1/sdk/products/{productRef}",
        operation_id: "ProductSdkController_updateProduct",
        response_type: Some("SdkProductResponse"),
    },
    RouteMatch {
        method: "PUT",
        path_template: "/v1/sdk/products/{productRef}/mcp/plans",
        operation_id: "ProductSdkController_configureMcpPlans",
        response_type: Some("ConfigureMcpPlansResult"),
    },
    RouteMatch {
        method: "PUT",
        path_template: "/v1/sdk/products/{productRef}/plans/{planRef}",
        operation_id: "PlanSdkController_updatePlan",
        response_type: Some("Plan"),
    },
];

/// Returns true when `concrete` matches an OpenAPI path template.
///
/// `{param}` segments match any single path segment.
pub fn path_matches_template(template: &str, concrete: &str) -> bool {
    let t: Vec<&str> = template.split('/').filter(|s| !s.is_empty()).collect();
    let c: Vec<&str> = concrete.split('/').filter(|s| !s.is_empty()).collect();
    if t.len() != c.len() {
        return false;
    }
    t.iter()
        .zip(c.iter())
        .all(|(tp, cp)| (tp.starts_with('{') && tp.ends_with('}')) || *tp == *cp)
}

/// Looks up a route by method + concrete path.
pub fn match_route(method: &str, path: &str) -> Option<&'static RouteMatch> {
    let method = method.to_ascii_uppercase();
    ROUTES
        .iter()
        .find(|route| route.method == method && path_matches_template(route.path_template, path))
}

/// Deserializes `body` into the route's response DTO and re-serializes it.
///
/// # Errors
///
/// Returns a string error when the route is unknown, has no response type,
/// or serde fails.
pub fn roundtrip_response(method: &str, path: &str, body: &Value) -> Result<Value, String> {
    let route = match_route(method, path).ok_or_else(|| format!("no route for {method} {path}"))?;
    let type_name = route
        .response_type
        .ok_or_else(|| format!("route {} has no JSON response body", route.operation_id))?;
    roundtrip_by_type(type_name, body)
}

/// Deserializes and re-serializes `body` as the named generated DTO type.
fn roundtrip_by_type(type_name: &str, body: &Value) -> Result<Value, String> {
    match type_name {
        "ActivatePlanResponseDto" => {
            let parsed: schemas::ActivatePlanResponseDto =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "AutoRechargeGetResponse" => {
            let parsed: schemas::AutoRechargeGetResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "BulkUsageResponse" => {
            let parsed: schemas::BulkUsageResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "ConfigureMcpPlansResult" => {
            let parsed: schemas::ConfigureMcpPlansResult =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "CreateCheckoutSessionResponse" => {
            let parsed: schemas::CreateCheckoutSessionResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "CreateCustomerSessionResponse" => {
            let parsed: schemas::CreateCustomerSessionResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "CustomerBalanceResponse" => {
            let parsed: schemas::CustomerBalanceResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "CustomerResponse" => {
            let parsed: schemas::CustomerResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "DeletePlansResponse" => {
            let parsed: schemas::DeletePlansResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "DeleteProductsResponse" => {
            let parsed: schemas::DeleteProductsResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "DisableAutoRechargeResponse" => {
            let parsed: schemas::DisableAutoRechargeResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetCustomerResponse" => {
            let parsed: schemas::GetCustomerResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetCustomerSessionResponse" => {
            let parsed: schemas::GetCustomerSessionResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetPlansResponse" => {
            let parsed: schemas::GetPlansResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetProductResponse" => {
            let parsed: schemas::GetProductResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetProductsResponse" => {
            let parsed: schemas::GetProductsResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GetPurchasesResponse" => {
            let parsed: schemas::GetPurchasesResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "GrantCustomerCreditsResponse" => {
            let parsed: schemas::GrantCustomerCreditsResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "LimitResponse" => {
            let parsed: schemas::LimitResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "McpBootstrapResult" => {
            let parsed: schemas::McpBootstrapResult =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "PaymentMethodResult" => {
            let parsed: schemas::PaymentMethodResult =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "Plan" => {
            let parsed: schemas::Plan =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "PostBulkResponse" => {
            let parsed: schemas::PostBulkResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "PostCancelResponse" => {
            let parsed: schemas::PostCancelResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "PostMeterEventsResponse" => {
            let parsed: schemas::PostMeterEventsResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "PostReactivateResponse" => {
            let parsed: schemas::PostReactivateResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "ProcessPaymentResult" => {
            let parsed: schemas::ProcessPaymentResult =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SaveAutoRechargeResponse" => {
            let parsed: schemas::SaveAutoRechargeResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkMerchantResponseDto" => {
            let parsed: schemas::SdkMerchantResponseDto =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkPaymentIntentListResponse" => {
            let parsed: schemas::SdkPaymentIntentListResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkPaymentIntentResponse" => {
            let parsed: schemas::SdkPaymentIntentResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkPlatformConfigResponseDto" => {
            let parsed: schemas::SdkPlatformConfigResponseDto =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkProductResponse" => {
            let parsed: schemas::SdkProductResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "SdkPurchaseResponse" => {
            let parsed: schemas::SdkPurchaseResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "UsageRecordResponse" => {
            let parsed: schemas::UsageRecordResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "UserInfoResponse" => {
            let parsed: schemas::UserInfoResponse =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "Vec<WebhookEventCategoryDto>" => {
            let parsed: Vec<schemas::WebhookEventCategoryDto> =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        "WebhookEventDto" => {
            let parsed: schemas::WebhookEventDto =
                serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(parsed).map_err(|e| e.to_string())
        }
        other => Err(format!("no round-trip arm for {other}")),
    }
}
