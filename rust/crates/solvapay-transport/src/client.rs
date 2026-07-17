//! Typed SolvaPay client methods — Groups A–C (steps 22–24).
//!
//! Thin typed layer over [`ClientShell`]: each method builds a [`ShellRequest`],
//! delegates transport/auth/retry/error mapping to the shell, then applies
//! TypeScript-parity response normalization where required.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Serialize, Serializer};
use serde_json::{Map, Value};
use solvapay_core::SdkError;
use solvapay_dto::error_templates::operations;
use solvapay_dto::{
    ActivatePlanDto, ActivatePlanResponseDto, AssignCreditsRequest, AttachBusinessDetailsParams,
    AutoRechargeInput, CancelPurchaseParams, CheckLimitsRequest, CloneProductOverrides,
    CloneProductResult, ConfigureMcpPlansDto, CreateCheckoutSessionRequest,
    CreateCheckoutSessionResponse, CreateCustomerRequest, CreateCustomerResult,
    CreateCustomerSessionRequest, CreateCustomerSessionResponse, CreatePaymentIntentParams,
    CreatePaymentIntentResult, CreatePlanParams, CreateProductRequest, CreateProductResult,
    CreateTopupPaymentIntentParams, CreateTopupPaymentIntentResult, CustomerResponseMapped,
    DisableAutoRechargeParams, GetAutoRechargeParams, GetCustomerBalanceParams,
    GetCustomerBalanceResult, GetCustomerParams, GetPaymentMethodParams, GetUserInfoParams,
    GrantCustomerCreditsResponse, McpBootstrapDto, ProcessPaymentIntentParams,
    ReactivatePurchaseParams, SaveAutoRechargeParams, SdkMerchantResponseDto,
    SdkPlatformConfigResponseDto, TrackUsageBulkRequest, TrackUsageRequest, UpdateCustomerParams,
    UpdateCustomerResult, UpdatePlanRequest, UpdateProductRequest, UserInfoResponse,
};

use crate::shell::{ClientShell, Idempotency, ShellRequest};
use crate::Method;

/// Typed SolvaPay API client (Groups A–C methods).
///
/// Construct from a configured [`ClientShell`]. Transport, auth, base URL,
/// retries, and HTTP error mapping stay in the shell; this type owns
/// per-method routes, bodies, and response normalization.
pub struct SolvaPayClient {
    /// Shared HTTP shell (auth, base URL, retries, template errors).
    shell: ClientShell,
}

impl SolvaPayClient {
    /// Wraps a configured [`ClientShell`].
    ///
    /// # Arguments
    ///
    /// * `shell` - Auth, base URL, transport, and retry configuration.
    ///
    /// # Returns
    ///
    /// A typed client ready for Group A–C method calls.
    pub fn new(shell: ClientShell) -> Self {
        Self { shell }
    }

    /// Returns a shared reference to the underlying shell.
    pub fn shell(&self) -> &ClientShell {
        &self.shell
    }

    /// `POST /v1/sdk/customers` — create a customer.
    ///
    /// Maps wire `reference || customerRef` onto [`CreateCustomerResult`].
    pub async fn create_customer(
        &self,
        params: CreateCustomerRequest,
    ) -> Result<CreateCustomerResult, SdkError> {
        let value = self
            .execute_json(
                Method::Post,
                "/v1/sdk/customers".to_owned(),
                BTreeMap::new(),
                Some(&params),
                Idempotency::None,
                operations::create_customer::DEFAULT,
            )
            .await?;
        let customer_ref =
            first_non_empty_str(&value, &["reference", "customerRef"]).ok_or_else(|| {
                SdkError::transport(
                    "createCustomer response missing reference/customerRef",
                    false,
                )
            })?;
        Ok(CreateCustomerResult { customer_ref })
    }

    /// `PATCH /v1/sdk/customers/{customerRef}` — update a customer.
    ///
    /// Path segment uses JavaScript `encodeURIComponent` semantics. Result
    /// prefers wire `reference || customerRef`, then falls back to the input ref.
    pub async fn update_customer(
        &self,
        customer_ref: &str,
        params: UpdateCustomerParams,
    ) -> Result<UpdateCustomerResult, SdkError> {
        let path = format!("/v1/sdk/customers/{}", encode_path_segment(customer_ref));
        let value = self
            .execute_json(
                Method::Patch,
                path,
                BTreeMap::new(),
                Some(&params),
                Idempotency::None,
                operations::update_customer::DEFAULT,
            )
            .await?;
        let mapped = first_non_empty_str(&value, &["reference", "customerRef"])
            .unwrap_or_else(|| customer_ref.to_owned());
        Ok(UpdateCustomerResult {
            customer_ref: mapped,
        })
    }

    /// `GET /v1/sdk/customers…` — look up a customer by ref, externalRef, or email.
    ///
    /// Precedence (non-empty values): `externalRef`, then `email`, then
    /// `customerRef`. Missing params fail before transport. Query lookups accept
    /// direct object, bare array, `{ customer }`, or `{ customers }` shapes.
    pub async fn get_customer(
        &self,
        params: GetCustomerParams,
    ) -> Result<CustomerResponseMapped, SdkError> {
        let external_ref = non_empty_opt(params.external_ref.as_deref());
        let email = non_empty_opt(params.email.as_deref());
        let customer_ref = non_empty_opt(params.customer_ref.as_deref());

        let (path, query, query_lookup) = if let Some(ext) = external_ref {
            let mut query = BTreeMap::new();
            query.insert("externalRef".to_owned(), ext.to_owned());
            ("/v1/sdk/customers".to_owned(), query, true)
        } else if let Some(email) = email {
            let mut query = BTreeMap::new();
            query.insert("email".to_owned(), email.to_owned());
            ("/v1/sdk/customers".to_owned(), query, true)
        } else if let Some(reference) = customer_ref {
            // TS interpolates customerRef without encodeURIComponent.
            (
                format!("/v1/sdk/customers/{reference}"),
                BTreeMap::new(),
                false,
            )
        } else {
            return Err(local_api_error(operations::get_customer::CASES[0], &[]));
        };

        let value = self
            .execute_json(
                Method::Get,
                path,
                query,
                None::<&()>,
                Idempotency::None,
                operations::get_customer::DEFAULT,
            )
            .await?;

        let customer_value = if query_lookup {
            select_customer_shape(&value).ok_or_else(|| {
                let ext = params.external_ref.as_deref().unwrap_or("undefined");
                local_api_error(operations::get_customer::CASES[1], &[("externalRef", ext)])
            })?
        } else {
            value
        };

        let normalized = normalize_mapped_customer_json(customer_value);
        deserialize_value(normalized)
    }

    /// `POST /v1/sdk/customers/{customerRef}/credits` — grant credits.
    ///
    /// Strips `customerRef` / `idempotencyKey` from the JSON body. Emits
    /// `Idempotency-Key` only when a non-empty caller key is supplied.
    pub async fn assign_credits(
        &self,
        params: AssignCreditsRequest,
    ) -> Result<GrantCustomerCreditsResponse, SdkError> {
        let path = format!(
            "/v1/sdk/customers/{}/credits",
            encode_path_segment(&params.customer_ref)
        );
        let idempotency = match params.idempotency_key.as_deref() {
            Some(key) if !key.is_empty() => Idempotency::CallerKey(key.to_owned()),
            _ => Idempotency::None,
        };
        self.execute_typed(
            Method::Post,
            path,
            BTreeMap::new(),
            Some(&params.base),
            idempotency,
            operations::assign_credits::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/customers/{customerRef}/balance` — credit balance.
    ///
    /// Path segment is unencoded (TypeScript parity).
    pub async fn get_customer_balance(
        &self,
        params: GetCustomerBalanceParams,
    ) -> Result<GetCustomerBalanceResult, SdkError> {
        let path = format!("/v1/sdk/customers/{}/balance", params.customer_ref);
        self.execute_typed(
            Method::Get,
            path,
            BTreeMap::new(),
            None::<&()>,
            Idempotency::None,
            operations::get_customer_balance::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/user-info` — customer/product user info.
    pub async fn get_user_info(
        &self,
        params: GetUserInfoParams,
    ) -> Result<UserInfoResponse, SdkError> {
        self.execute_typed(
            Method::Post,
            "/v1/sdk/user-info".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::get_user_info::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/checkout-sessions` — hosted checkout session.
    pub async fn create_checkout_session(
        &self,
        params: CreateCheckoutSessionRequest,
    ) -> Result<CreateCheckoutSessionResponse, SdkError> {
        self.execute_typed(
            Method::Post,
            "/v1/sdk/checkout-sessions".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::create_checkout_session::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/customers/customer-sessions` — customer portal session.
    pub async fn create_customer_session(
        &self,
        params: CreateCustomerSessionRequest,
    ) -> Result<CreateCustomerSessionResponse, SdkError> {
        self.execute_typed(
            Method::Post,
            "/v1/sdk/customers/customer-sessions".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::create_customer_session::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/merchant` — merchant profile.
    pub async fn get_merchant(&self) -> Result<SdkMerchantResponseDto, SdkError> {
        self.execute_typed(
            Method::Get,
            "/v1/sdk/merchant".to_owned(),
            BTreeMap::new(),
            None::<&()>,
            Idempotency::None,
            operations::get_merchant::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/platform-config` — publishable platform config.
    pub async fn get_platform_config(&self) -> Result<SdkPlatformConfigResponseDto, SdkError> {
        self.execute_typed(
            Method::Get,
            "/v1/sdk/platform-config".to_owned(),
            BTreeMap::new(),
            None::<&()>,
            Idempotency::None,
            operations::get_platform_config::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/payment-intents` — create a plan checkout payment intent.
    ///
    /// Body omits `idempotencyKey`; idempotency is caller key or auto
    /// `payment-{planRef}-{epochMs}-{random9}`.
    pub async fn create_payment_intent(
        &self,
        params: CreatePaymentIntentParams,
    ) -> Result<CreatePaymentIntentResult, SdkError> {
        let body = CreatePaymentIntentBody {
            product_ref: &params.product_ref,
            plan_ref: &params.plan_ref,
            customer_ref: &params.customer_ref,
            currency: non_empty_opt(params.currency.as_deref()),
        };
        let mut vars = BTreeMap::new();
        vars.insert("planRef", params.plan_ref.clone());
        let idempotency = caller_key_or_auto(
            params.idempotency_key.as_deref(),
            "payment-{planRef}-{epochMs}-{random9}",
            vars,
        );
        self.execute_typed(
            Method::Post,
            "/v1/sdk/payment-intents".to_owned(),
            BTreeMap::new(),
            Some(&body),
            idempotency,
            operations::create_payment_intent::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/payment-intents` — create a credit top-up payment intent.
    ///
    /// Body includes constant `purpose: "credit_topup"`. Idempotency is caller
    /// key or auto `topup-{epochMs}-{random9}`.
    pub async fn create_topup_payment_intent(
        &self,
        params: CreateTopupPaymentIntentParams,
    ) -> Result<CreateTopupPaymentIntentResult, SdkError> {
        let body = CreateTopupPaymentIntentBody {
            customer_ref: &params.customer_ref,
            purpose: "credit_topup",
            amount: params.amount,
            currency: &params.currency,
            description: non_empty_opt(params.description.as_deref()),
            auto_recharge: params
                .auto_recharge
                .as_ref()
                .map(TopupAutoRechargeBody::from),
        };
        let idempotency = caller_key_or_auto(
            params.idempotency_key.as_deref(),
            "topup-{epochMs}-{random9}",
            BTreeMap::new(),
        );
        self.execute_typed(
            Method::Post,
            "/v1/sdk/payment-intents".to_owned(),
            BTreeMap::new(),
            Some(&body),
            idempotency,
            operations::create_topup_payment_intent::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/payment-intents/{paymentIntentId}/process` — process payment.
    ///
    /// Path segment is unencoded (TypeScript parity). Body omits `paymentIntentId`.
    pub async fn process_payment_intent(
        &self,
        params: ProcessPaymentIntentParams,
    ) -> Result<solvapay_dto::schemas::ProcessPaymentResult, SdkError> {
        let path = format!(
            "/v1/sdk/payment-intents/{}/process",
            params.payment_intent_id
        );
        let body = ProcessPaymentIntentBody {
            product_ref: non_empty_opt(params.product_ref.as_deref()),
            customer_ref: &params.customer_ref,
            plan_ref: non_empty_opt(params.plan_ref.as_deref()),
        };
        self.execute_typed(
            Method::Post,
            path,
            BTreeMap::new(),
            Some(&body),
            Idempotency::None,
            operations::process_payment_intent::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/payment-intents/{paymentIntentId}/business-details`.
    ///
    /// Returns raw JSON (OpenAPI 200 has no response schema). Body omits
    /// `customerCountry` / `customerName` and `paymentIntentId`.
    pub async fn attach_business_details(
        &self,
        params: AttachBusinessDetailsParams,
    ) -> Result<Value, SdkError> {
        let path = format!(
            "/v1/sdk/payment-intents/{}/business-details",
            params.payment_intent_id
        );
        let body = AttachBusinessDetailsBody {
            is_business: params.is_business,
            business_name: params.business_name.as_deref(),
            country: params.country.as_deref(),
            tax_id: params.tax_id.as_deref(),
            tax_id_type: params.tax_id_type.as_deref(),
            customer_ref: params.customer_ref.as_deref(),
        };
        self.execute_json(
            Method::Post,
            path,
            BTreeMap::new(),
            Some(&body),
            Idempotency::None,
            operations::attach_business_details::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/activate` — activate a plan for a customer.
    pub async fn activate_plan(
        &self,
        params: ActivatePlanDto,
    ) -> Result<ActivatePlanResponseDto, SdkError> {
        self.execute_typed(
            Method::Post,
            "/v1/sdk/activate".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::activate_plan::DEFAULT,
        )
        .await
    }

    // --- Group C (step 24) ---------------------------------------------------

    /// `POST /v1/sdk/limits` — check usage limits for a customer/product.
    pub async fn check_limits(&self, params: CheckLimitsRequest) -> Result<Value, SdkError> {
        self.execute_json(
            Method::Post,
            "/v1/sdk/limits".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::check_limits::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/usages` — record a single usage event.
    pub async fn track_usage(&self, params: TrackUsageRequest) -> Result<Value, SdkError> {
        let mut body = serialize_body_ts_numbers(&params)?;
        // Overlay + flattened base both carry `customerRef`; keep the required overlay value.
        if let Value::Object(map) = &mut body {
            map.insert(
                "customerRef".to_owned(),
                Value::String(params.customer_ref.clone()),
            );
        }
        self.execute_value(
            Method::Post,
            "/v1/sdk/usages".to_owned(),
            BTreeMap::new(),
            Some(body),
            Idempotency::None,
            operations::track_usage::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/usages/bulk` — record multiple usage events.
    pub async fn track_usage_bulk(&self, params: TrackUsageBulkRequest) -> Result<Value, SdkError> {
        let body = serialize_body_ts_numbers(&params)?;
        self.execute_value(
            Method::Post,
            "/v1/sdk/usages/bulk".to_owned(),
            BTreeMap::new(),
            Some(body),
            Idempotency::None,
            operations::track_usage_bulk::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/products/{productRef}` — fetch one product (data-merge normalization).
    ///
    /// Path segment uses JavaScript `encodeURIComponent` (TS `getProduct` only).
    pub async fn get_product(&self, product_ref: &str) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{}", encode_path_segment(product_ref));
        let result = self
            .execute_json::<()>(
                Method::Get,
                path,
                BTreeMap::new(),
                None,
                Idempotency::None,
                operations::get_product::DEFAULT,
            )
            .await?;
        Ok(merge_get_product(result))
    }

    /// `GET /v1/sdk/products` — list products (per-item data-wins merge).
    pub async fn list_products(&self) -> Result<Value, SdkError> {
        let result = self
            .execute_json::<()>(
                Method::Get,
                "/v1/sdk/products".to_owned(),
                BTreeMap::new(),
                None,
                Idempotency::None,
                operations::list_products::DEFAULT,
            )
            .await?;
        Ok(normalize_list_products(result))
    }

    /// `POST /v1/sdk/products` — create a product.
    pub async fn create_product(
        &self,
        params: CreateProductRequest,
    ) -> Result<CreateProductResult, SdkError> {
        self.execute_typed(
            Method::Post,
            "/v1/sdk/products".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::create_product::DEFAULT,
        )
        .await
    }

    /// `PUT /v1/sdk/products/{productRef}` — update a product (path ref unencoded).
    pub async fn update_product(
        &self,
        product_ref: &str,
        params: UpdateProductRequest,
    ) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}");
        self.execute_json(
            Method::Put,
            path,
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::update_product::DEFAULT,
        )
        .await
    }

    /// `DELETE /v1/sdk/products/{productRef}` — delete a product (404 is success).
    pub async fn delete_product(&self, product_ref: &str) -> Result<(), SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}");
        let response = self
            .shell
            .execute_raw(ShellRequest {
                method: Method::Delete,
                path,
                query: BTreeMap::new(),
                body: None,
                idempotency: Idempotency::None,
                error_template: operations::delete_product::DEFAULT,
            })
            .await?;
        if (200..300).contains(&response.status) || response.status == 404 {
            return Ok(());
        }
        Err(api_error_from_template(
            operations::delete_product::DEFAULT,
            Some(response.status),
            &response.body,
        ))
    }

    /// `POST /v1/sdk/products/{productRef}/clone` — clone a product.
    pub async fn clone_product(
        &self,
        product_ref: &str,
        overrides: Option<CloneProductOverrides>,
    ) -> Result<CloneProductResult, SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}/clone");
        let body = overrides.unwrap_or(CloneProductOverrides { name: None });
        self.execute_typed(
            Method::Post,
            path,
            BTreeMap::new(),
            Some(&body),
            Idempotency::None,
            operations::clone_product::DEFAULT,
        )
        .await
    }

    /// `POST /v1/sdk/products/mcp/bootstrap` — bootstrap an MCP product.
    pub async fn bootstrap_mcp_product(&self, params: McpBootstrapDto) -> Result<Value, SdkError> {
        self.execute_json(
            Method::Post,
            "/v1/sdk/products/mcp/bootstrap".to_owned(),
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::bootstrap_mcp_product::DEFAULT,
        )
        .await
    }

    /// `PUT /v1/sdk/products/{productRef}/mcp/plans` — configure MCP plans.
    pub async fn configure_mcp_plans(
        &self,
        product_ref: &str,
        params: ConfigureMcpPlansDto,
    ) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}/mcp/plans");
        self.execute_json(
            Method::Put,
            path,
            BTreeMap::new(),
            Some(&params),
            Idempotency::None,
            operations::configure_mcp_plans::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/products/{productRef}/plans` — list plans (unwrap + price precedence).
    pub async fn list_plans(&self, product_ref: &str) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}/plans");
        let result = self
            .execute_json::<()>(
                Method::Get,
                path,
                BTreeMap::new(),
                None,
                Idempotency::None,
                operations::list_plans::DEFAULT,
            )
            .await?;
        Ok(normalize_list_plans(result))
    }

    /// `POST /v1/sdk/products/{productRef}/plans` — create a plan (`productRef` in path + body).
    pub async fn create_plan(&self, params: CreatePlanParams) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{}/plans", params.product_ref);
        let body = serialize_body_ts_numbers(&params)?;
        self.execute_value(
            Method::Post,
            path,
            BTreeMap::new(),
            Some(body),
            Idempotency::None,
            operations::create_plan::DEFAULT,
        )
        .await
    }

    /// `PUT /v1/sdk/products/{productRef}/plans/{planRef}` — update a plan.
    pub async fn update_plan(
        &self,
        product_ref: &str,
        plan_ref: &str,
        params: UpdatePlanRequest,
    ) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}/plans/{plan_ref}");
        let body = serialize_body_ts_numbers(&params)?;
        self.execute_value(
            Method::Put,
            path,
            BTreeMap::new(),
            Some(body),
            Idempotency::None,
            operations::update_plan::DEFAULT,
        )
        .await
    }

    /// `DELETE /v1/sdk/products/{productRef}/plans/{planRef}` — delete a plan (404 is success).
    pub async fn delete_plan(&self, product_ref: &str, plan_ref: &str) -> Result<(), SdkError> {
        let path = format!("/v1/sdk/products/{product_ref}/plans/{plan_ref}");
        let response = self
            .shell
            .execute_raw(ShellRequest {
                method: Method::Delete,
                path,
                query: BTreeMap::new(),
                body: None,
                idempotency: Idempotency::None,
                error_template: operations::delete_plan::DEFAULT,
            })
            .await?;
        if (200..300).contains(&response.status) || response.status == 404 {
            return Ok(());
        }
        Err(api_error_from_template(
            operations::delete_plan::DEFAULT,
            Some(response.status),
            &response.body,
        ))
    }

    /// `POST /v1/sdk/purchases/{purchaseRef}/cancel` — cancel a purchase.
    pub async fn cancel_purchase(&self, params: CancelPurchaseParams) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/purchases/{}/cancel", params.purchase_ref);
        let body = non_empty_opt(params.reason.as_deref()).map(|reason| {
            let mut map = Map::new();
            map.insert("reason".to_owned(), Value::String(reason.to_owned()));
            Value::Object(map)
        });
        let response = self
            .shell
            .execute_raw(ShellRequest {
                method: Method::Post,
                path,
                query: BTreeMap::new(),
                body,
                idempotency: Idempotency::None,
                error_template: operations::cancel_purchase::DEFAULT,
            })
            .await?;
        map_purchase_mutation_response(
            response,
            operations::cancel_purchase::DEFAULT,
            operations::cancel_purchase::CASES,
            "cancel",
        )
    }

    /// `POST /v1/sdk/purchases/{purchaseRef}/reactivate` — reactivate a purchase.
    pub async fn reactivate_purchase(
        &self,
        params: ReactivatePurchaseParams,
    ) -> Result<Value, SdkError> {
        let path = format!("/v1/sdk/purchases/{}/reactivate", params.purchase_ref);
        let response = self
            .shell
            .execute_raw(ShellRequest {
                method: Method::Post,
                path,
                query: BTreeMap::new(),
                body: None,
                idempotency: Idempotency::None,
                error_template: operations::reactivate_purchase::DEFAULT,
            })
            .await?;
        map_purchase_mutation_response(
            response,
            operations::reactivate_purchase::DEFAULT,
            operations::reactivate_purchase::CASES,
            "reactivate",
        )
    }

    /// `GET /v1/sdk/payment-method?customerRef=` — fetch a customer's payment method.
    pub async fn get_payment_method(
        &self,
        params: GetPaymentMethodParams,
    ) -> Result<Value, SdkError> {
        let mut query = BTreeMap::new();
        query.insert("customerRef".to_owned(), params.customer_ref);
        self.execute_json::<()>(
            Method::Get,
            "/v1/sdk/payment-method".to_owned(),
            query,
            None,
            Idempotency::None,
            operations::get_payment_method::DEFAULT,
        )
        .await
    }

    /// `GET /v1/sdk/auto-recharge?customerRef=` — fetch auto-recharge config.
    pub async fn get_auto_recharge(
        &self,
        params: GetAutoRechargeParams,
    ) -> Result<Value, SdkError> {
        let mut query = BTreeMap::new();
        query.insert("customerRef".to_owned(), params.customer_ref);
        self.execute_json::<()>(
            Method::Get,
            "/v1/sdk/auto-recharge".to_owned(),
            query,
            None,
            Idempotency::None,
            operations::get_auto_recharge::DEFAULT,
        )
        .await
    }

    /// `PUT /v1/sdk/auto-recharge` — save auto-recharge config.
    pub async fn save_auto_recharge(
        &self,
        params: SaveAutoRechargeParams,
    ) -> Result<Value, SdkError> {
        let body = SaveAutoRechargeBody::from(&params);
        let body = serialize_body_ts_numbers(&body)?;
        self.execute_value(
            Method::Put,
            "/v1/sdk/auto-recharge".to_owned(),
            BTreeMap::new(),
            Some(body),
            Idempotency::None,
            operations::save_auto_recharge::DEFAULT,
        )
        .await
    }

    /// `DELETE /v1/sdk/auto-recharge?customerRef=` — disable auto-recharge.
    pub async fn disable_auto_recharge(
        &self,
        params: DisableAutoRechargeParams,
    ) -> Result<Value, SdkError> {
        let mut query = BTreeMap::new();
        query.insert("customerRef".to_owned(), params.customer_ref);
        self.execute_json::<()>(
            Method::Delete,
            "/v1/sdk/auto-recharge".to_owned(),
            query,
            None,
            Idempotency::None,
            operations::disable_auto_recharge::DEFAULT,
        )
        .await
    }

    /// Executes a shell request and deserializes the JSON body into `R`.
    async fn execute_typed<B, R>(
        &self,
        method: Method,
        path: String,
        query: BTreeMap<String, String>,
        body: Option<&B>,
        idempotency: Idempotency,
        error_template: &'static str,
    ) -> Result<R, SdkError>
    where
        B: Serialize,
        R: DeserializeOwned,
    {
        let value = self
            .execute_json(method, path, query, body, idempotency, error_template)
            .await?;
        deserialize_value(value)
    }

    /// Executes a shell request and returns the parsed JSON [`Value`].
    async fn execute_json<B>(
        &self,
        method: Method,
        path: String,
        query: BTreeMap<String, String>,
        body: Option<&B>,
        idempotency: Idempotency,
        error_template: &'static str,
    ) -> Result<Value, SdkError>
    where
        B: Serialize,
    {
        let body = match body {
            Some(b) => Some(serialize_body(b)?),
            None => None,
        };
        self.execute_value(method, path, query, body, idempotency, error_template)
            .await
    }

    /// Executes a shell request with an already-built JSON body.
    async fn execute_value(
        &self,
        method: Method,
        path: String,
        query: BTreeMap<String, String>,
        body: Option<Value>,
        idempotency: Idempotency,
        error_template: &'static str,
    ) -> Result<Value, SdkError> {
        self.shell
            .execute(ShellRequest {
                method,
                path,
                query,
                body,
                idempotency,
                error_template,
            })
            .await
    }
}

/// JavaScript `encodeURIComponent` for a single path segment.
///
/// Encodes all bytes except `A–Z a–z 0–9 - _ . ! ~ * ' ( )`. Space → `%20`.
pub fn encode_path_segment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(char::from(b)),
            _ => {
                out.push('%');
                out.push(hex_nibble(b >> 4));
                out.push(hex_nibble(b & 0x0f));
            }
        }
    }
    out
}

/// Uppercase hex nibble for percent-encoding.
fn hex_nibble(n: u8) -> char {
    char::from(match n {
        0..=9 => b'0' + n,
        10..=15 => b'A' + (n - 10),
        _ => b'0',
    })
}

/// Serializes a typed request body to JSON.
fn serialize_body<T: Serialize>(value: &T) -> Result<Value, SdkError> {
    serde_json::to_value(value)
        .map_err(|err| SdkError::transport(format!("serialize request body: {err}"), false))
}

/// Serializes a body and coerces whole-number `f64` values to JSON integers
/// (`JSON.stringify` / wiremock `body_json` parity).
fn serialize_body_ts_numbers<T: Serialize>(value: &T) -> Result<Value, SdkError> {
    let mut body = serialize_body(value)?;
    coerce_whole_numbers(&mut body);
    Ok(body)
}

/// Recursively converts finite whole `f64` JSON numbers to integers.
fn coerce_whole_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_finite() && f.fract() == 0.0 {
                    #[expect(clippy::cast_possible_truncation)]
                    let int = f as i64;
                    if (int as f64 - f).abs() < f64::EPSILON {
                        if let Some(num) = serde_json::Number::from_i128(i128::from(int)) {
                            *value = Value::Number(num);
                        }
                    }
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                coerce_whole_numbers(item);
            }
        }
        Value::Object(map) => {
            for item in map.values_mut() {
                coerce_whole_numbers(item);
            }
        }
        _ => {}
    }
}

/// TS `getProduct` merge: `{ ...data, ...result }` (top-level wins; `data` kept).
fn merge_get_product(result: Value) -> Value {
    let mut merged = match &result {
        Value::Object(map) => map
            .get("data")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        _ => Map::new(),
    };
    if let Value::Object(top) = result {
        for (key, value) in top {
            merged.insert(key, value);
        }
    }
    Value::Object(merged)
}

/// TS `listProducts` normalization: bare array / `{ products }`; per item
/// `{ ...product, ...data }` (data wins; `data` key kept).
fn normalize_list_products(result: Value) -> Value {
    let products = match result {
        Value::Array(items) => items,
        Value::Object(map) => map
            .get("products")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mapped = products
        .into_iter()
        .map(|product| {
            let data = product
                .get("data")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut out = match product {
                Value::Object(map) => map,
                _ => Map::new(),
            };
            for (key, value) in data {
                out.insert(key, value);
            }
            Value::Object(out)
        })
        .collect();
    Value::Array(mapped)
}

/// TS `listPlans` normalization: bare array / `{ plans }`; per plan
/// `{ ...data, ...plan, price }`, then delete `data`.
fn normalize_list_plans(result: Value) -> Value {
    let plans = match result {
        Value::Array(items) => items,
        Value::Object(map) => map
            .get("plans")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mapped = plans
        .into_iter()
        .map(|plan| {
            let data = plan
                .get("data")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let price = match plan.get("price") {
                Some(Value::Null) | None => data.get("price").cloned(),
                Some(value) => Some(value.clone()),
            };

            let mut unwrapped = data;
            if let Value::Object(plan_obj) = plan {
                for (key, value) in plan_obj {
                    unwrapped.insert(key, value);
                }
            }
            if let Some(price) = price {
                unwrapped.insert("price".to_owned(), price);
            }
            unwrapped.remove("data");
            Value::Object(unwrapped)
        })
        .collect();
    Value::Array(mapped)
}

/// Maps cancel/reactivate purchase raw responses to TS-parity outcomes.
fn map_purchase_mutation_response(
    response: crate::http::HttpResponse,
    default_template: &'static str,
    cases: &[&'static str],
    _kind: &str,
) -> Result<Value, SdkError> {
    let body_text = String::from_utf8_lossy(&response.body).into_owned();

    if !(200..300).contains(&response.status) {
        let template = match response.status {
            404 => cases[0],
            400 => cases[1],
            _ => default_template,
        };
        return Err(api_error_from_template(
            template,
            Some(response.status),
            &response.body,
        ));
    }

    let response_data: Value = match serde_json::from_str(&body_text) {
        Ok(value) => value,
        Err(_) => {
            let prefix: String = body_text.chars().take(200).collect();
            let mut vars = BTreeMap::new();
            vars.insert("bodyPrefix200", prefix.as_str());
            return Err(SdkError::api_from_template(cases[2], &vars, None, None));
        }
    };

    if !response_data.is_object() {
        return Err(SdkError::api_from_template(
            cases[3],
            &BTreeMap::new(),
            None,
            None,
        ));
    }

    let extracted = extract_purchase_result(&response_data);
    if !extracted.is_object() {
        return Err(SdkError::api_from_template(
            cases[4],
            &BTreeMap::new(),
            None,
            None,
        ));
    }
    Ok(extracted)
}

/// TS cancel/reactivate purchase extraction (`purchase` / `reference` / fallback).
fn extract_purchase_result(response_data: &Value) -> Value {
    if let Some(purchase) = response_data.get("purchase").filter(|p| p.is_object()) {
        return purchase.clone();
    }
    if response_data.get("reference").is_some() {
        return response_data.clone();
    }
    response_data
        .get("purchase")
        .cloned()
        .unwrap_or_else(|| response_data.clone())
}

/// Builds [`SdkError::Api`] from a template + optional status + raw body bytes.
fn api_error_from_template(template: &str, status: Option<u16>, body: &[u8]) -> SdkError {
    let body_text = String::from_utf8_lossy(body);
    let status_str = status.map(|s| s.to_string()).unwrap_or_default();
    let mut vars = BTreeMap::new();
    vars.insert("status", status_str.as_str());
    vars.insert("body", body_text.as_ref());
    SdkError::api_from_template(template, &vars, status, None)
}

/// Deserializes a JSON value into a typed response.
fn deserialize_value<T: DeserializeOwned>(value: Value) -> Result<T, SdkError> {
    serde_json::from_value(value)
        .map_err(|err| SdkError::transport(format!("decode response body: {err}"), false))
}

/// Builds a pre-transport [`SdkError::Api`] from a manifest template.
fn local_api_error(template: &str, vars: &[(&str, &str)]) -> SdkError {
    let map: BTreeMap<&str, &str> = vars.iter().copied().collect();
    SdkError::api_from_template(template, &map, None, None)
}

/// Treats empty strings as absent (JS truthiness parity).
fn non_empty_opt(value: Option<&str>) -> Option<&str> {
    value.and_then(|s| if s.is_empty() { None } else { Some(s) })
}

/// Caller-supplied idempotency key, or auto-rendered from `format` + `vars`.
fn caller_key_or_auto(
    idempotency_key: Option<&str>,
    format: &'static str,
    vars: BTreeMap<&'static str, String>,
) -> Idempotency {
    match idempotency_key {
        Some(key) if !key.is_empty() => Idempotency::CallerKey(key.to_owned()),
        _ => Idempotency::Auto { format, vars },
    }
}

/// Serializes whole-number `f64` values as JSON integers (TS `JSON.stringify` parity).
fn serialize_whole_f64<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.is_finite() && value.fract() == 0.0 {
        #[expect(clippy::cast_possible_truncation)]
        let int = *value as i64;
        if (int as f64 - *value).abs() < f64::EPSILON {
            return serializer.serialize_i64(int);
        }
    }
    serializer.serialize_f64(*value)
}

/// Optional variant of [`serialize_whole_f64`].
fn serialize_opt_whole_f64<S: Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        None => serializer.serialize_none(),
        Some(v) => serialize_whole_f64(v, serializer),
    }
}

#[allow(clippy::missing_docs_in_private_items)]
mod wire_bodies {
    use super::{
        serialize_opt_whole_f64, serialize_whole_f64, AutoRechargeInput, SaveAutoRechargeParams,
    };
    use serde::Serialize;

    #[derive(Serialize)]
    pub(super) struct CreatePaymentIntentBody<'a> {
        #[serde(rename = "productRef")]
        pub(super) product_ref: &'a str,
        #[serde(rename = "planRef")]
        pub(super) plan_ref: &'a str,
        #[serde(rename = "customerRef")]
        pub(super) customer_ref: &'a str,
        #[serde(rename = "currency")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) currency: Option<&'a str>,
    }

    #[derive(Serialize)]
    pub(super) struct CreateTopupPaymentIntentBody<'a> {
        #[serde(rename = "customerRef")]
        pub(super) customer_ref: &'a str,
        #[serde(rename = "purpose")]
        pub(super) purpose: &'static str,
        #[serde(rename = "amount")]
        #[serde(serialize_with = "serialize_whole_f64")]
        pub(super) amount: f64,
        #[serde(rename = "currency")]
        pub(super) currency: &'a str,
        #[serde(rename = "description")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) description: Option<&'a str>,
        #[serde(rename = "autoRecharge")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) auto_recharge: Option<TopupAutoRechargeBody<'a>>,
    }

    #[derive(Serialize)]
    pub(super) struct TopupAutoRechargeBody<'a> {
        #[serde(rename = "enabled")]
        pub(super) enabled: bool,
        #[serde(rename = "triggerType")]
        pub(super) trigger_type: &'a str,
        #[serde(rename = "thresholdAmountMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) threshold_amount_major: Option<f64>,
        #[serde(rename = "topupAmountMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) topup_amount_major: Option<f64>,
        #[serde(rename = "currency")]
        pub(super) currency: &'a str,
        #[serde(rename = "maxMonthlySpendMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) max_monthly_spend_major: Option<f64>,
    }

    impl<'a> From<&'a AutoRechargeInput> for TopupAutoRechargeBody<'a> {
        fn from(value: &'a AutoRechargeInput) -> Self {
            Self {
                enabled: value.enabled,
                trigger_type: &value.trigger_type,
                threshold_amount_major: value.threshold_amount_major,
                topup_amount_major: value.topup_amount_major,
                currency: &value.currency,
                max_monthly_spend_major: value.max_monthly_spend_major,
            }
        }
    }

    #[derive(Serialize)]
    pub(super) struct ProcessPaymentIntentBody<'a> {
        #[serde(rename = "productRef")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) product_ref: Option<&'a str>,
        #[serde(rename = "customerRef")]
        pub(super) customer_ref: &'a str,
        #[serde(rename = "planRef")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) plan_ref: Option<&'a str>,
    }

    #[derive(Serialize)]
    pub(super) struct AttachBusinessDetailsBody<'a> {
        #[serde(rename = "isBusiness")]
        pub(super) is_business: bool,
        #[serde(rename = "businessName")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) business_name: Option<&'a str>,
        #[serde(rename = "country")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) country: Option<&'a str>,
        #[serde(rename = "taxId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) tax_id: Option<&'a str>,
        #[serde(rename = "taxIdType")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) tax_id_type: Option<&'a str>,
        #[serde(rename = "customerRef")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) customer_ref: Option<&'a str>,
    }

    #[derive(Serialize)]
    pub(super) struct SaveAutoRechargeBody<'a> {
        #[serde(rename = "customerRef")]
        pub(super) customer_ref: &'a str,
        #[serde(rename = "enabled")]
        pub(super) enabled: bool,
        #[serde(rename = "triggerType")]
        pub(super) trigger_type: &'a str,
        #[serde(rename = "thresholdAmountMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) threshold_amount_major: Option<f64>,
        #[serde(rename = "topupAmountMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) topup_amount_major: Option<f64>,
        #[serde(rename = "currency")]
        pub(super) currency: &'a str,
        #[serde(rename = "maxMonthlySpendMajor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(serialize_with = "serialize_opt_whole_f64")]
        pub(super) max_monthly_spend_major: Option<f64>,
        #[serde(rename = "deferSetupIntent")]
        #[serde(skip_serializing_if = "Option::is_none")]
        pub(super) defer_setup_intent: Option<bool>,
    }

    impl<'a> From<&'a SaveAutoRechargeParams> for SaveAutoRechargeBody<'a> {
        fn from(value: &'a SaveAutoRechargeParams) -> Self {
            Self {
                customer_ref: &value.customer_ref,
                enabled: value.base.base.enabled,
                trigger_type: &value.base.base.trigger_type,
                threshold_amount_major: value.base.base.threshold_amount_major,
                topup_amount_major: value.base.base.topup_amount_major,
                currency: &value.base.base.currency,
                max_monthly_spend_major: value.base.base.max_monthly_spend_major,
                defer_setup_intent: value.base.defer_setup_intent,
            }
        }
    }
}

use wire_bodies::{
    AttachBusinessDetailsBody, CreatePaymentIntentBody, CreateTopupPaymentIntentBody,
    ProcessPaymentIntentBody, SaveAutoRechargeBody, TopupAutoRechargeBody,
};

/// Returns the first non-empty string field among `keys`.
fn first_non_empty_str(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(Value::String(s)) = object.get(*key) {
            if !s.is_empty() {
                return Some(s.clone());
            }
        }
    }
    None
}

/// Picks a customer object from polymorphic query-lookup responses.
fn select_customer_shape(result: &Value) -> Option<Value> {
    let direct = match result {
        Value::Object(map)
            if map_has_non_empty_str(map, "reference")
                || map_has_non_empty_str(map, "customerRef")
                || map_has_non_empty_str(map, "externalRef") =>
        {
            Some(result.clone())
        }
        _ => None,
    };

    let wrapped = result
        .as_object()
        .and_then(|map| map.get("customer"))
        .filter(|c| c.is_object())
        .cloned();

    let from_list = match result {
        Value::Array(items) => items.first().cloned(),
        Value::Object(map) => map
            .get("customers")
            .and_then(Value::as_array)
            .and_then(|items| items.first().cloned()),
        _ => None,
    };

    direct.or(wrapped).or(from_list)
}

/// True when `map[key]` is a non-empty string.
fn map_has_non_empty_str(map: &Map<String, Value>, key: &str) -> bool {
    matches!(map.get(key), Some(Value::String(s)) if !s.is_empty())
}

/// Maps wire customer JSON onto the public [`CustomerResponseMapped`] shape.
///
/// Preserves purchase overlay fields by rewriting JSON keys before typed decode
/// (never narrows through the less-complete wire `CustomerResponse` DTO).
fn normalize_mapped_customer_json(mut customer: Value) -> Value {
    let Some(object) = customer.as_object_mut() else {
        return customer;
    };

    let customer_ref = object
        .get("reference")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            object
                .get("customerRef")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        });

    if let Some(reference) = customer_ref {
        object.insert("customerRef".to_owned(), Value::String(reference));
    }
    object.remove("reference");

    if !object.contains_key("purchases") || object.get("purchases").is_some_and(Value::is_null) {
        object.insert("purchases".to_owned(), Value::Array(Vec::new()));
    }

    customer
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;

    use serde_json::{Map, Value};

    fn obj(pairs: &[(&str, Value)]) -> Value {
        let mut map = Map::new();
        for (key, value) in pairs {
            map.insert((*key).to_owned(), value.clone());
        }
        Value::Object(map)
    }

    #[test]
    fn merge_get_product_top_level_wins_and_keeps_data() {
        let data = obj(&[
            ("name", Value::String("Nested".into())),
            ("description", Value::String("from-data".into())),
        ]);
        let input = obj(&[
            ("reference", Value::String("prd_fixture".into())),
            ("name", Value::String("Top".into())),
            ("data", data.clone()),
        ]);
        let expected = obj(&[
            ("name", Value::String("Top".into())),
            ("description", Value::String("from-data".into())),
            ("reference", Value::String("prd_fixture".into())),
            ("data", data),
        ]);
        assert_eq!(merge_get_product(input), expected);
    }

    #[test]
    fn normalize_list_products_data_wins_and_keeps_data() {
        let data = obj(&[
            ("name", Value::String("FromData".into())),
            ("description", Value::String("desc".into())),
        ]);
        let input = Value::Array(vec![obj(&[
            ("reference", Value::String("prd_a".into())),
            ("name", Value::String("Top".into())),
            ("data", data.clone()),
        ])]);
        let expected = Value::Array(vec![obj(&[
            ("reference", Value::String("prd_a".into())),
            ("name", Value::String("FromData".into())),
            ("description", Value::String("desc".into())),
            ("data", data),
        ])]);
        assert_eq!(normalize_list_products(input), expected);
    }

    #[test]
    fn normalize_list_plans_price_precedence_and_drops_data() {
        let data = obj(&[
            ("price", Value::from(9999)),
            ("meterName", Value::String("requests".into())),
        ]);
        let input = Value::Array(vec![obj(&[
            ("reference", Value::String("plan_basic".into())),
            ("name", Value::String("Basic".into())),
            ("price", Value::from(1000)),
            ("data", data),
        ])]);
        let expected = Value::Array(vec![obj(&[
            ("reference", Value::String("plan_basic".into())),
            ("name", Value::String("Basic".into())),
            ("price", Value::from(1000)),
            ("meterName", Value::String("requests".into())),
        ])]);
        assert_eq!(normalize_list_plans(input), expected);
    }

    #[test]
    fn create_topup_body_serializes_whole_amount_without_decimal() {
        let body = CreateTopupPaymentIntentBody {
            customer_ref: "cus_fixture",
            purpose: "credit_topup",
            amount: 2000.0,
            currency: "usd",
            description: None,
            auto_recharge: None,
        };
        let encoded = serde_json::to_string(&body).expect("serialize");
        // Keep assertion messages free of curly braces so check-no-unwrap brace-skip stays accurate.
        assert!(
            encoded.contains("\"amount\":2000"),
            "expected integer amount in JSON"
        );
    }

    #[test]
    fn encode_path_segment_matches_encode_uri_component() {
        assert_eq!(encode_path_segment("cus_fixture"), "cus_fixture");
        assert_eq!(encode_path_segment("a b"), "a%20b");
        assert_eq!(encode_path_segment("a/b"), "a%2Fb");
        assert_eq!(encode_path_segment("café"), "caf%C3%A9");
        assert_eq!(encode_path_segment("a+b"), "a%2Bb");
    }

    #[cfg(not(target_arch = "wasm32"))]
    mod native {
        use super::*;

        use std::sync::{Arc, Mutex};

        use crate::http::{HttpRequest, HttpResponse};
        use crate::shell::{ClientShell, SharedTransport};
        use crate::transport::{BoxFuture, Transport};

        struct MockTransport {
            responses: Mutex<Vec<Result<HttpResponse, SdkError>>>,
            recorded: Mutex<Vec<HttpRequest>>,
        }

        impl MockTransport {
            fn new(responses: Vec<Result<HttpResponse, SdkError>>) -> Arc<Self> {
                Arc::new(Self {
                    responses: Mutex::new(responses),
                    recorded: Mutex::new(Vec::new()),
                })
            }
        }

        impl Transport for MockTransport {
            fn send<'a>(
                &'a self,
                request: HttpRequest,
            ) -> BoxFuture<'a, Result<HttpResponse, SdkError>> {
                Box::pin(async move {
                    self.recorded.lock().unwrap().push(request);
                    self.responses
                        .lock()
                        .unwrap()
                        .pop()
                        .unwrap_or_else(|| Err(SdkError::transport("no mock response", false)))
                })
            }
        }

        #[tokio::test]
        async fn update_customer_falls_back_to_input_reference() {
            let transport = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br"{}".to_vec(),
            })]);
            let shared: SharedTransport = Arc::clone(&transport) as SharedTransport;
            let client = SolvaPayClient::new(
                ClientShell::new(shared, "sk_test").with_base_url("https://api.test"),
            );

            let result = client
                .update_customer(
                    "cus_input",
                    UpdateCustomerParams {
                        email: None,
                        external_ref: None,
                        metadata: None,
                        name: Some("Ada".to_owned()),
                        telephone: None,
                    },
                )
                .await
                .expect("update");

            assert_eq!(result.customer_ref, "cus_input");
            let recorded = transport.recorded.lock().unwrap();
            assert_eq!(recorded.len(), 1);
            assert!(recorded[0].url.ends_with("/v1/sdk/customers/cus_input"));
        }

        #[tokio::test]
        async fn update_customer_encodes_path_segment() {
            let transport = MockTransport::new(vec![Ok(HttpResponse {
                status: 200,
                body: br#"{"reference":"cus_out"}"#.to_vec(),
            })]);
            let shared: SharedTransport = Arc::clone(&transport) as SharedTransport;
            let client = SolvaPayClient::new(
                ClientShell::new(shared, "sk_test").with_base_url("https://api.test"),
            );

            let _ = client
                .update_customer(
                    "cus with/slash",
                    UpdateCustomerParams {
                        email: None,
                        external_ref: None,
                        metadata: None,
                        name: None,
                        telephone: None,
                    },
                )
                .await
                .expect("update");

            let recorded = transport.recorded.lock().unwrap();
            assert!(recorded[0]
                .url
                .ends_with("/v1/sdk/customers/cus%20with%2Fslash"));
        }

        #[tokio::test]
        async fn get_customer_missing_params_skips_transport() {
            let transport = MockTransport::new(vec![]);
            let shared: SharedTransport = Arc::clone(&transport) as SharedTransport;
            let client = SolvaPayClient::new(
                ClientShell::new(shared, "sk_test").with_base_url("https://api.test"),
            );

            let err = client
                .get_customer(GetCustomerParams {
                    customer_ref: Some(String::new()),
                    email: None,
                    external_ref: None,
                })
                .await
                .expect_err("missing");

            match err {
                SdkError::Api {
                    message, status, ..
                } => {
                    assert_eq!(
                        message,
                        "One of customerRef, externalRef, or email must be provided"
                    );
                    assert_eq!(status, None);
                }
                other => panic!("expected Api, got {other:?}"),
            }
            assert!(transport.recorded.lock().unwrap().is_empty());
        }
    }
}
