/**
* @generated — do not edit. Regenerate with:
*   cargo run -p dto-gen -- \
*     --snapshot ../contract/openapi/sdk-v1.snapshot.json \
*     --manifest ../contract/manifest/sdk-contract.yaml \
*     --out crates/solvapay-dto/src \
*     --ts-out packages/server/src/types/overlays.generated.d.ts \
*     --ts-client-out packages/server/src/types/client.generated.d.ts
*/

import type { components, operations } from './generated'
import type * as overlays from './overlays.generated'
import type {
  AttachBusinessDetailsParams,
  AttachBusinessDetailsResult,
  CheckLimitsRequest,
  LimitResponseWithPlan,
  CustomerResponseMapped,
  ProcessPaymentResult,
  TopupProcessResult,
  ActivatePlanResult,
  PaymentMethodInfo,
  AutoRechargeInput,
  SaveAutoRechargeInput,
  AutoRechargeResponse,
  SaveAutoRechargeResponse,
  CreditDisplayBlock,
  GetCustomerBalanceResult,
  SdkMerchantResponse,
  SdkPlatformConfigResponse,
  SdkProductResponse,
  TrackUsageRequest,
  TrackUsageResponse,
  TrackUsageBulkRequest,
  TrackUsageBulkResponse,
  AssignCreditsRequest,
  AssignCreditsResponse,
  McpBootstrapRequest,
  McpBootstrapResponse,
  ConfigureMcpPlansRequest,
  ConfigureMcpPlansResponse,
  OneTimePurchaseInfo,
} from './client'

export interface SolvaPayClientGenerated {
/**
 * Activate a plan for a customer (purchase or entitlement grant).
 * @param params Plan activation request fields.
 * @returns Activation result projection.
 */
  activatePlan?(params: components['schemas']['ActivatePlanDto']): Promise<ActivatePlanResult>
/**
 * Grant credits to a customer balance.
 * @param params Credit grant request (customer, amount, and reason).
 * @returns Credit assignment response.
 */
  assignCredits?(params: AssignCreditsRequest): Promise<AssignCreditsResponse>
/**
 * Attach or update business details used for tax and invoicing.
 * @param params Business details payload.
 * @returns Attached business details result.
 */
  attachBusinessDetails?(params: AttachBusinessDetailsParams): Promise<AttachBusinessDetailsResult>
/**
 * Bootstrap an MCP product with default plans and tooling.
 * @param params MCP bootstrap request payload.
 * @returns Bootstrap result including product and plan refs.
 */
  bootstrapMcpProduct?(params: McpBootstrapRequest): Promise<McpBootstrapResponse>
/**
 * Cancel an active purchase for a customer.
 * @param params Cancel request identifying the purchase.
 * @returns Updated purchase info after cancellation.
 */
  cancelPurchase?(params: overlays.CancelPurchaseParams): Promise<components['schemas']['PurchaseInfo']>
/**
 * Check remaining usage/spend limits for a customer against a product's plan.
 * @param params Limits request including customer and product refs.
 * @returns Current remaining limits, optionally including plan details.
 */
  checkLimits(params: CheckLimitsRequest): Promise<LimitResponseWithPlan>
/**
 * Clone a product, optionally applying field overrides.
 * @param overrides Optional field overrides applied to the clone.
 * @returns The cloned product projection.
 */
  cloneProduct?(productRef: string, overrides?: overlays.CloneProductOverrides): Promise<overlays.CloneProductResult>
/**
 * Configure MCP plans for an existing product.
 * @param params MCP plan configuration payload.
 * @returns Configured MCP plans response.
 */
  configureMcpPlans?(productRef: string, params: ConfigureMcpPlansRequest): Promise<ConfigureMcpPlansResponse>
/**
 * Create a hosted checkout session for a customer and product.
 * @param params Checkout session creation fields.
 * @returns Created checkout session projection.
 */
  createCheckoutSession(params: components['schemas']['CreateCheckoutSessionRequest']): Promise<components['schemas']['CreateCheckoutSessionResponse']>
/**
 * Create a customer in SolvaPay for the current merchant.
 * @param params Customer creation fields (email, external refs, metadata).
 * @returns The created customer projection.
 */
  createCustomer?(params: components['schemas']['CreateCustomerRequest']): Promise<overlays.CreateCustomerResult>
/**
 * Create a customer portal/session for self-serve account actions.
 * @param params Customer session creation fields.
 * @returns Created customer session projection.
 */
  createCustomerSession(params: components['schemas']['CreateCustomerSessionRequest']): Promise<components['schemas']['CreateCustomerSessionResponse']>
/**
 * Create a payment intent for a purchase or activation flow.
 * @param params Payment intent creation fields.
 * @returns Created payment intent projection.
 */
  createPaymentIntent?(params: overlays.CreatePaymentIntentParams): Promise<overlays.CreatePaymentIntentResult>
/**
 * Create a plan under a product.
 * @param params Plan creation fields including product ref.
 * @returns The created plan projection.
 */
  createPlan?(params: overlays.CreatePlanParams): Promise<components['schemas']['Plan']>
/**
 * Create a product for the current merchant.
 * @param params Product creation fields.
 * @returns The created product projection.
 */
  createProduct?(params: components['schemas']['CreateProductRequest']): Promise<overlays.CreateProductResult>
/**
 * Create a payment intent to top up a customer balance.
 * @param params Top-up payment intent fields.
 * @returns Created top-up payment intent projection.
 */
  createTopupPaymentIntent?(params: overlays.CreateTopupPaymentIntentParams): Promise<overlays.CreateTopupPaymentIntentResult>
/**
 * Delete a plan by product and plan references.
 */
  deletePlan?(productRef: string, planRef: string): Promise<void>
/**
 * Delete a product by reference.
 */
  deleteProduct?(productRef: string): Promise<void>
/**
 * Disable auto-recharge for a customer.
 * @param params Disable request identifying the customer.
 * @returns Updated auto-recharge status after disable.
 */
  disableAutoRecharge?(params: overlays.DisableAutoRechargeParams): Promise<components['schemas']['DisableAutoRechargeResponse']>
/**
 * Fetch auto-recharge configuration for a customer.
 * @param params Auto-recharge lookup options.
 * @returns Auto-recharge configuration projection.
 */
  getAutoRecharge?(params: overlays.GetAutoRechargeParams): Promise<AutoRechargeResponse>
/**
 * Fetch a customer by reference.
 * @param params Lookup options including the customer reference.
 * @returns The customer projection.
 */
  getCustomer(params: overlays.GetCustomerParams): Promise<CustomerResponseMapped>
/**
 * Fetch a customer credit balance projection for display.
 * @param params Balance request identifying the customer.
 * @returns Customer balance display projection.
 */
  getCustomerBalance?(params: overlays.GetCustomerBalanceParams): Promise<GetCustomerBalanceResult>
/**
 * Fetch the authenticated merchant profile.
 * @returns Merchant profile projection.
 */
  getMerchant?(): Promise<SdkMerchantResponse>
/**
 * Fetch the default payment method for a customer.
 * @param params Payment-method lookup options.
 * @returns Payment method info, when present.
 */
  getPaymentMethod?(params: overlays.GetPaymentMethodParams): Promise<PaymentMethodInfo>
/**
 * Fetch platform configuration for the current merchant.
 * @returns Platform configuration projection.
 */
  getPlatformConfig?(): Promise<SdkPlatformConfigResponse>
/**
 * Fetch a product by reference.
 * @returns Product projection.
 */
  getProduct?(productRef: string): Promise<SdkProductResponse>
/**
 * Fetch end-user info for a customer session.
 * @param params User-info request options.
 * @returns User info projection.
 */
  getUserInfo?(params: overlays.GetUserInfoParams): Promise<components['schemas']['UserInfoResponse']>
/**
 * List plans for a product.
 * @returns Plan list projection.
 */
  listPlans?(productRef: string): Promise<overlays.ListPlansResult>
/**
 * List products for the current merchant.
 * @returns Product list projection.
 */
  listProducts?(): Promise<overlays.ListProductsResult>
/**
 * Process a completed payment intent into a purchase or top-up outcome.
 * @param params Process request identifying the payment intent.
 * @returns Normalized process-payment result (purchase, top-up, or error branch).
 */
  processPaymentIntent?(params: overlays.ProcessPaymentIntentParams): Promise<ProcessPaymentResult>
/**
 * Reactivate a previously cancelled purchase.
 * @param params Reactivate request identifying the purchase.
 * @returns Updated purchase info after reactivation.
 */
  reactivatePurchase?(params: overlays.ReactivatePurchaseParams): Promise<components['schemas']['PurchaseInfo']>
/**
 * Create or update auto-recharge configuration for a customer.
 * @param params Auto-recharge settings to persist.
 * @returns Saved auto-recharge configuration.
 */
  saveAutoRecharge?(params: overlays.SaveAutoRechargeParams): Promise<SaveAutoRechargeResponse>
/**
 * Record a single usage event against a meter for billing.
 * @param params Usage event payload (customer, meter, and amount).
 * @returns The recorded usage event response.
 */
  trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse>
/**
 * Record multiple usage events in one request.
 * @param params Bulk usage payload with one or more events.
 * @returns Bulk usage recording response.
 */
  trackUsageBulk?(params: TrackUsageBulkRequest): Promise<TrackUsageBulkResponse>
/**
 * Update an existing customer by reference.
 * @param params Fields to patch on the customer.
 * @returns The updated customer projection.
 */
  updateCustomer?(customerRef: string, params: overlays.UpdateCustomerParams): Promise<overlays.UpdateCustomerResult>
/**
 * Update an existing plan by product and plan references.
 * @param params Fields to patch on the plan.
 * @returns The updated plan projection.
 */
  updatePlan?(productRef: string, planRef: string, params: components['schemas']['UpdatePlanRequest']): Promise<components['schemas']['Plan']>
/**
 * Update an existing product by reference.
 * @param params Fields to patch on the product.
 * @returns The updated product projection.
 */
  updateProduct?(productRef: string, params: components['schemas']['UpdateProductRequest']): Promise<SdkProductResponse>
}

/**
 * Retry an async callable with the frozen default backoff policy.
 * @param fn () => Promise<T> — callable stand-in
 * @param options Optional retry overrides.
 * @returns The callable's resolved value.
 */
export declare function withRetryGenerated<T>(fn: () => Promise<T>, options?: overlays.RetryOptions): Promise<T>

