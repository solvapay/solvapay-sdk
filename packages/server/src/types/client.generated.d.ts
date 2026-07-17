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
 * activatePlan client method.
 */
  activatePlan?(params: components['schemas']['ActivatePlanDto']): Promise<ActivatePlanResult>
/**
 * assignCredits client method.
 */
  assignCredits?(params: AssignCreditsRequest): Promise<AssignCreditsResponse>
/**
 * attachBusinessDetails client method.
 */
  attachBusinessDetails?(params: AttachBusinessDetailsParams): Promise<AttachBusinessDetailsResult>
/**
 * bootstrapMcpProduct client method.
 */
  bootstrapMcpProduct?(params: McpBootstrapRequest): Promise<McpBootstrapResponse>
/**
 * cancelPurchase client method.
 */
  cancelPurchase?(params: overlays.CancelPurchaseParams): Promise<components['schemas']['PurchaseInfo']>
/**
 * checkLimits client method.
 */
  checkLimits(params: CheckLimitsRequest): Promise<LimitResponseWithPlan>
/**
 * cloneProduct client method.
 */
  cloneProduct?(productRef: string, overrides?: overlays.CloneProductOverrides): Promise<overlays.CloneProductResult>
/**
 * configureMcpPlans client method.
 */
  configureMcpPlans?(productRef: string, params: ConfigureMcpPlansRequest): Promise<ConfigureMcpPlansResponse>
/**
 * createCheckoutSession client method.
 */
  createCheckoutSession(params: components['schemas']['CreateCheckoutSessionRequest']): Promise<components['schemas']['CreateCheckoutSessionResponse']>
/**
 * createCustomer client method.
 */
  createCustomer?(params: components['schemas']['CreateCustomerRequest']): Promise<overlays.CreateCustomerResult>
/**
 * createCustomerSession client method.
 */
  createCustomerSession(params: components['schemas']['CreateCustomerSessionRequest']): Promise<components['schemas']['CreateCustomerSessionResponse']>
/**
 * createPaymentIntent client method.
 */
  createPaymentIntent?(params: overlays.CreatePaymentIntentParams): Promise<overlays.CreatePaymentIntentResult>
/**
 * createPlan client method.
 */
  createPlan?(params: overlays.CreatePlanParams): Promise<components['schemas']['Plan']>
/**
 * createProduct client method.
 */
  createProduct?(params: components['schemas']['CreateProductRequest']): Promise<overlays.CreateProductResult>
/**
 * createTopupPaymentIntent client method.
 */
  createTopupPaymentIntent?(params: overlays.CreateTopupPaymentIntentParams): Promise<overlays.CreateTopupPaymentIntentResult>
/**
 * deletePlan client method.
 */
  deletePlan?(productRef: string, planRef: string): Promise<void>
/**
 * deleteProduct client method.
 */
  deleteProduct?(productRef: string): Promise<void>
/**
 * disableAutoRecharge client method.
 */
  disableAutoRecharge?(params: overlays.DisableAutoRechargeParams): Promise<components['schemas']['DisableAutoRechargeResponse']>
/**
 * getAutoRecharge client method.
 */
  getAutoRecharge?(params: overlays.GetAutoRechargeParams): Promise<AutoRechargeResponse>
/**
 * getCustomer client method.
 */
  getCustomer(params: overlays.GetCustomerParams): Promise<CustomerResponseMapped>
/**
 * getCustomerBalance client method.
 */
  getCustomerBalance?(params: overlays.GetCustomerBalanceParams): Promise<GetCustomerBalanceResult>
/**
 * getMerchant client method.
 */
  getMerchant?(): Promise<SdkMerchantResponse>
/**
 * getPaymentMethod client method.
 */
  getPaymentMethod?(params: overlays.GetPaymentMethodParams): Promise<PaymentMethodInfo>
/**
 * getPlatformConfig client method.
 */
  getPlatformConfig?(): Promise<SdkPlatformConfigResponse>
/**
 * getProduct client method.
 */
  getProduct?(productRef: string): Promise<SdkProductResponse>
/**
 * getUserInfo client method.
 */
  getUserInfo?(params: overlays.GetUserInfoParams): Promise<components['schemas']['UserInfoResponse']>
/**
 * listPlans client method.
 */
  listPlans?(productRef: string): Promise<overlays.ListPlansResult>
/**
 * listProducts client method.
 */
  listProducts?(): Promise<overlays.ListProductsResult>
/**
 * processPaymentIntent client method.
 */
  processPaymentIntent?(params: overlays.ProcessPaymentIntentParams): Promise<ProcessPaymentResult>
/**
 * reactivatePurchase client method.
 */
  reactivatePurchase?(params: overlays.ReactivatePurchaseParams): Promise<components['schemas']['PurchaseInfo']>
/**
 * saveAutoRecharge client method.
 */
  saveAutoRecharge?(params: overlays.SaveAutoRechargeParams): Promise<SaveAutoRechargeResponse>
/**
 * trackUsage client method.
 */
  trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse>
/**
 * trackUsageBulk client method.
 */
  trackUsageBulk?(params: TrackUsageBulkRequest): Promise<TrackUsageBulkResponse>
/**
 * updateCustomer client method.
 */
  updateCustomer?(customerRef: string, params: overlays.UpdateCustomerParams): Promise<overlays.UpdateCustomerResult>
/**
 * updatePlan client method.
 */
  updatePlan?(productRef: string, planRef: string, params: components['schemas']['UpdatePlanRequest']): Promise<components['schemas']['Plan']>
/**
 * updateProduct client method.
 */
  updateProduct?(productRef: string, params: components['schemas']['UpdateProductRequest']): Promise<SdkProductResponse>
}

/**
 * Generated withRetry signature for parity (§2.8).
 */
export declare function withRetryGenerated<T>(fn: () => Promise<T>, options?: overlays.RetryOptions): Promise<T>

