/**
 * SolvaPay API Client Type Definitions
 *
 * Types related to the SolvaPay API client and backend communication.
 */

import type { TaxIdType } from '@solvapay/core'
import type { components, operations } from './generated'

/** SDK purchase row. Generated from the OpenAPI `SdkPurchaseResponse` schema. */
export type PurchaseInfo = components['schemas']['SdkPurchaseResponse']

export type AttachBusinessDetailsParams = {
  paymentIntentId: string
} & components['schemas']['BusinessDetailsDto']

export type AttachBusinessDetailsResult = components['schemas']['AttachBusinessDetailsResponse']

/**
 * What the browser needs to write one card into the vault: for one payment
 * (`POST /v1/sdk/payment-intents/{id}/capture-grant`, `scope.paymentIntentId`)
 * or on a session, the customer's credential on the hosted pages
 * (`POST /v1/customer-sessions/{sessionId}/capture-grant`, `scope.sessionId`).
 * The scope echoes what the grant was asked for; the card's binding is
 * enforced by the backend from the grant window on that record.
 */
export interface CaptureGrant {
  /** Short-lived vault access token scoped to card capture only. */
  token: string
  tenantId: string
  environment: 'sandbox' | 'live'
  /** Epoch milliseconds. */
  expiresAt: number
  scope: { paymentIntentId: string } | { sessionId: string }
}

/** Confirm a vault payment with a captured card or a saved payment method. Exactly one of the two. */
export type ConfirmPaymentParams = {
  paymentIntentId: string
  /** Where the rail sends the payer back after a customer action (3DS). */
  returnUrl?: string
  /** The cardholder's name, email and address for a vault card; a saved payment method keeps its own. */
  billingDetails?: CardBillingDetails
} & (
  | { cardId: string; paymentMethodId?: undefined }
  | { paymentMethodId: string; cardId?: undefined }
)

/** `POST /v1/sdk/payment-intents/{id}/confirm` */
export interface ConfirmPaymentResult {
  /** SolvaPay payment intent id. */
  id: string
  /** Rail payment reference. */
  processorPaymentId: string
  status:
    | 'pending'
    | 'processing'
    | 'succeeded'
    | 'cancelled'
    | 'failed'
    | 'requires_action'
    | 'requires_payment_method'
    | 'requires_confirmation'
    | (string & {})
  /** The payer must be sent here to finish a customer action (3DS). */
  redirectUrl?: string
}

/** Billing details stored with a card saved outside a payment. */
export interface CardBillingDetails {
  name?: string
  email?: string
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
}

/**
 * Save a vault-captured card on a customer session (no payment), or complete
 * the setup the payer just authenticated. Exactly one of the two shapes.
 */
export type SaveCustomerSessionCardParams =
  | {
      sessionId: string
      cardId: string
      billingDetails?: CardBillingDetails
      /** Where the rail sends the payer back after 3DS: an https URL on the provider's website or the session's pages. */
      returnUrl: string
    }
  | {
      sessionId: string
      /** The payer is back from 3DS: finish the setup the session keeps. */
      completePendingSetup: true
    }

/** The card saved on a customer session. */
export interface SavedCardPaymentMethod {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * `POST /v1/customer-sessions/{sessionId}/payment-methods`.
 * `requires_action`: send the payer to `redirectUrl`; when they are back,
 * post `{ completePendingSetup: true }` to finish. `processing`: the setup
 * settles asynchronously.
 */
export interface SavedCardResult {
  status: 'succeeded' | 'requires_action' | 'processing'
  paymentMethod?: SavedCardPaymentMethod
  redirectUrl?: string
}

export type UsageMeterType = 'requests' | 'tokens'
export type CheckLimitsRequest = components['schemas']['CheckLimitRequest']

/**
 * Per-customer cap declared in code on a `registerFree` tool. Not a
 * registered `Meter` — the name must match `/^free-[a-z0-9-]+$/`.
 *
 * Derived from `CheckLimitRequest.freeAllowance`. nestjs-zod omits
 * nested `required`, so OpenAPI marks every property optional; the
 * object schema only treats `windowDays` as optional.
 */
type GeneratedFreeAllowance = NonNullable<CheckLimitsRequest['freeAllowance']>
export type FreeLimit = Required<Omit<GeneratedFreeAllowance, 'windowDays'>> &
  Pick<GeneratedFreeAllowance, 'windowDays'>

true satisfies FreeLimit extends GeneratedFreeAllowance ? true : never

/**
 * `LimitResponse` plus a deprecated SDK-only `plan` alias.
 *
 * The backend `LimitResponse` carries the `onExceed` outcome flags
 * (`overage` / `needsTopUp`, resolved by `decideLimit`), so they flow
 * through from `generated.ts`. `overage` rides the allow path
 * (`withinLimits: true`) so a protected handler can read it from
 * `decision.limits`; `needsTopUp` accompanies a gate outcome.
 *
 * Read `planRef` for the active plan. `plan` is never populated by the
 * backend — it remains optional so older fixtures and callers still type-check.
 */
export type LimitResponseWithPlan = components['schemas']['LimitResponse'] & {
  /** @deprecated Never populated by the backend. Read `planRef` instead. */
  plan?: string
}

type GeneratedTaxIdType = NonNullable<components['schemas']['BusinessDetailsDto']['taxIdType']>
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

/**
 * Fails to compile if `@solvapay/core`'s `TaxIdType` drifts from the
 * generated `BusinessDetailsDto.taxIdType` union. `core` cannot import
 * `generated.ts`, so this is where parity is enforced.
 */
true satisfies AssertEqual<TaxIdType, GeneratedTaxIdType>

/**
 * Extended CustomerResponse with proper field mapping
 *
 * Note: The backend API returns purchases as SdkPurchaseResponse objects.
 */
export type CustomerResponseMapped = {
  customerRef: string
  email?: string
  name?: string
  externalRef?: string
  plan?: string
  purchases?: PurchaseInfo[]
}

export type OneTimePurchaseInfo = components['schemas']['OneTimePurchaseInfo']

/**
 * Result from processing a payment intent.
 *
 * Derived from the generated `/v1/sdk/payment-intents/{id}/process` 200
 * response. The `succeeded` branches further discriminate on `type` so
 * consumers can route to recurring vs one-time handling without guarding
 * against `purchase === undefined`. A bare `{ status: 'succeeded' }` is
 * returned when the webhook race means the backend can't yet enrich the
 * response with the created purchase — callers should fall back to
 * refetching.
 *
 * `failed` and `cancelled` are returned when the rail payment is
 * in a terminal non-success state and are routed to `onError` by
 * `reconcilePayment`. `timeout` carries a retry hint and is routed to
 * the timeout branch.
 */
export type ProcessPaymentResult =
  operations['processPaymentIntent']['responses']['200']['content']['application/json']

type ProcessPaymentStatus = ProcessPaymentResult['status']
true satisfies AssertEqual<
  ProcessPaymentStatus,
  'succeeded' | 'processing' | 'timeout' | 'failed' | 'cancelled'
>

/**
 * Result from processing a credit-topup payment intent.
 *
 * Narrower projection of {@link ProcessPaymentResult} — topups don't
 * create a `PurchaseInfo` row (they book a `TOPUP` credit transaction
 * via the webhook handler), so the `type: 'recurring' | 'one-time'`
 * branches are stripped. The remaining four statuses match the
 * backend's `/sdk/payment-intents/:id/process` response verbatim and
 * are what the SDK's `processTopupPayment` exposes to `TopupForm`.
 *
 * `succeeded` means the backend observed the PI reach succeeded AND
 * the credit transaction has been booked (credit booking happens in
 * the same webhook handler invocation that flips PI status). `timeout` carries a
 * soft retry hint; `failed` / `cancelled` route to the error branch.
 *
 * `creditsAdded` is the wallet delta observed by the backend helper's
 * post-process balance poll (`processTopupPaymentIntentCore`). When
 * present, the React side bumps `balance.adjustBalance(creditsAdded)`
 * for an instant optimistic UI before the deterministic
 * `refetchPurchase()` lands. Absent when the helper's poll budget
 * exhausted (rare — the webhook was genuinely stalled) OR when the
 * baseline capture failed (legacy `SolvaPayClient` adapters without
 * `getCustomerBalance`); callers fall back to refetch-only.
 */
export type TopupProcessResult =
  | { status: 'succeeded'; creditsAdded?: number }
  | { status: 'processing' }
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }

export type ActivatePlanResult = components['schemas']['ActivatePlanResponseDto']

/**
 * SDK-facing payment-method projection returned by
 * `GET /v1/sdk/payment-method?customerRef=...`.
 *
 * Derived from the generated operation response so any backend shape
 * change propagates through a single `npm run generate:types` run. The
 * inline `oneOf` schema on the backend controller translates to a clean
 * `{ kind: 'card', ... } | { kind: 'none' }` discriminated union here.
 */
export type PaymentMethodInfo =
  operations['getPaymentMethod']['responses']['200']['content']['application/json']

/**
 * Result of `DELETE /v1/sdk/payment-method?customerRef=...`: the removed card,
 * and whether auto-recharge now waits for a new card.
 */
export interface RemovedPaymentMethodResult {
  removed: { brand: string; last4: string; expMonth: number; expYear: number }
  autoRechargePaused: boolean
}

export type AutoRechargeStatus = components['schemas']['AutoRechargeConfigDto']['status']

/**
 * Stored auto-recharge config. `display` is an SDK-side merge of the
 * sibling `AutoRechargeGetResponse.display` block so consumers can read
 * formatted amounts off the config object.
 */
export type AutoRechargeConfig = components['schemas']['AutoRechargeConfigDto'] & {
  display?: components['schemas']['AutoRechargeDisplayDto']
}

export type AutoRechargeDisplayBlock = components['schemas']['AutoRechargeDisplayDto']

export type CreditDisplayBlock = components['schemas']['CustomerBalanceDisplayDto']

export type AutoRechargeInput = Omit<
  components['schemas']['PutAutoRechargeSdkDto'],
  'customerRef' | 'customerEmail' | 'customerName'
>

/**
 * PUT /sdk/auto-recharge. A config saved without a card on file answers
 * `requiresPaymentMethod: true`; a top-up payment intent created with
 * `autoRecharge` stages the same config and arms it with the charged card.
 */
export type SaveAutoRechargeInput = AutoRechargeInput

export type AutoRechargeResponse = components['schemas']['AutoRechargeGetResponse']

export type SaveAutoRechargeResponse = components['schemas']['SaveAutoRechargeResponse']

/**
 * SDK-facing merchant identity (source: GET /v1/sdk/merchant).
 */
export type SdkMerchantResponse = components['schemas']['SdkMerchantResponseDto']

/**
 * SDK-facing platform config (source: GET /v1/sdk/platform-config).
 *
 * Environment-aware platform values resolved against the authenticated
 * provider. The SDK's card entry does not read it.
 */
export type SdkPlatformConfigResponse = components['schemas']['SdkPlatformConfigResponseDto']

/** SDK-facing product projection. Sourced from the existing OpenAPI spec. */
export type SdkProductResponse = components['schemas']['SdkProductResponse']

export type CreditDebitSkipReason = components['schemas']['CreditDebitSkippedResponse']['reason']

export type CreditDebitResult =
  | components['schemas']['CreditDebitSuccessResponse']
  | components['schemas']['CreditDebitSkippedResponse']

/**
 * When `debited: true` and `autoRecharge.triggered: true`, the server initiated
 * an off-session charge — credits are booked asynchronously via webhook, not inline.
 */
export type CreditDebitSuccess = components['schemas']['CreditDebitSuccessResponse']

export type TrackUsageRequest = Omit<
  Partial<components['schemas']['CreateUsageRequest']>,
  'customerRef' | 'metadata'
> & {
  customerRef: string
  metadata?: Record<string, unknown>
}

export type TrackUsageResponse = components['schemas']['UsageRecordResponse']

export interface TrackUsageBulkRequest {
  events: TrackUsageRequest[]
}

export type TrackUsageBulkResponse = components['schemas']['BulkUsageResponse']

export type AssignCreditsRequest = components['schemas']['GrantCustomerCreditsRequest'] & {
  customerRef: string
  idempotencyKey?: string
}

export type AssignCreditsResponse = components['schemas']['GrantCustomerCreditsResponse']

export type McpBootstrapPlanInput = NonNullable<
  components['schemas']['McpBootstrapDto']['plans']
>[number]

export type ToolPlanMappingInput = NonNullable<
  components['schemas']['McpBootstrapDto']['tools']
>[number]

export type McpBootstrapRequest = components['schemas']['McpBootstrapDto']

export type McpToolPlanMappingInput = NonNullable<
  components['schemas']['ConfigureMcpPlansDto']['toolMapping']
>[number]

export type McpBootstrapResponse = components['schemas']['McpBootstrapResult']

export type ConfigureMcpPlansRequest = components['schemas']['ConfigureMcpPlansDto']

export type ConfigureMcpPlansResponse = components['schemas']['ConfigureMcpPlansResult']

export type CreditActivityType = components['schemas']['CreditActivityEntryDto']['type']

/**
 * One account-wide credit ledger row from `GET /v1/sdk/credits/activity`.
 * Seven fields only — amounts are credit units, not money.
 */
export type CreditActivityEntry = components['schemas']['CreditActivityEntryDto']

export type CreditActivityResult = components['schemas']['CreditActivityResponseDto']

/**
 * Settled `get_history` / `useHistory` payload. Charges are product-scoped
 * purchases; credit activity is account-wide. History is not on bootstrap —
 * `checkPurchaseCore` only returns `status === 'active'`.
 */
export interface GetHistoryResult {
  charges: PurchaseInfo[]
  creditActivity: CreditActivityResult
}

/**
 * SolvaPay API Client Interface
 *
 * This interface defines the contract for communicating with the SolvaPay backend.
 * Uses auto-generated types from the OpenAPI specification.
 * You can provide your own implementation or use the default createSolvaPayClient().
 */
export interface SolvaPayClient {
  // POST: /v1/sdk/limits
  checkLimits(params: CheckLimitsRequest): Promise<LimitResponseWithPlan>

  // POST: /v1/sdk/usages
  trackUsage(params: TrackUsageRequest): Promise<TrackUsageResponse>

  // POST: /v1/sdk/usages/bulk
  trackUsageBulk?(params: TrackUsageBulkRequest): Promise<TrackUsageBulkResponse>

  // POST: /v1/sdk/customers
  createCustomer?(
    params: components['schemas']['CreateCustomerRequest'],
  ): Promise<{ customerRef: string }>

  /**
   * PATCH: /v1/sdk/customers/{customerRef}
   * Update mutable customer fields. Used by `ensureCustomer` to backfill
   * `externalRef` on an existing email-matched customer, and exposed
   * directly for integrators who need it.
   */
  updateCustomer?(
    customerRef: string,
    params: components['schemas']['UpdateCustomerRequest'],
  ): Promise<{ customerRef: string }>

  // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}
  getCustomer(params: {
    customerRef?: string
    externalRef?: string
    email?: string
  }): Promise<CustomerResponseMapped>

  // POST: /v1/sdk/customers/{customerRef}/credits
  assignCredits?(params: AssignCreditsRequest): Promise<AssignCreditsResponse>

  /**
   * SDK-facing merchant identity (GET /v1/sdk/merchant).
   * Returns the subset of provider fields safe for browser consumption —
   * used by `<MandateText>`, `<CheckoutSummary>`, and trust signals.
   */
  getMerchant?(): Promise<SdkMerchantResponse>

  /**
   * SDK-facing platform config (GET /v1/sdk/platform-config).
   * Returns environment-aware browser-safe values (resolved sandbox/live
   * against the authenticated provider).
   */
  getPlatformConfig?(): Promise<SdkPlatformConfigResponse>

  // GET: /v1/sdk/products/{productRef}
  getProduct?(productRef: string): Promise<SdkProductResponse>

  // Management methods

  // GET: /v1/sdk/products
  listProducts?(): Promise<components['schemas']['SdkProductResponse'][]>

  // POST: /v1/sdk/products
  createProduct?(
    params: components['schemas']['CreateProductRequest'],
  ): Promise<components['schemas']['SdkProductResponse']>

  // POST: /v1/sdk/products/mcp/bootstrap
  bootstrapMcpProduct?(params: McpBootstrapRequest): Promise<McpBootstrapResponse>

  // PUT: /v1/sdk/products/{productRef}/mcp/plans
  configureMcpPlans?(
    productRef: string,
    params: ConfigureMcpPlansRequest,
  ): Promise<ConfigureMcpPlansResponse>

  // PUT: /v1/sdk/products/{productRef}
  updateProduct?(
    productRef: string,
    params: components['schemas']['UpdateProductRequest'],
  ): Promise<components['schemas']['SdkProductResponse']>

  // DELETE: /v1/sdk/products/{productRef}
  deleteProduct?(productRef: string): Promise<void>

  // POST: /v1/sdk/products/{productRef}/clone
  cloneProduct?(
    productRef: string,
    overrides?: components['schemas']['CloneProductDto'],
  ): Promise<components['schemas']['SdkProductResponse']>

  // GET: /v1/sdk/products/{productRef}/plans
  listPlans?(productRef: string): Promise<components['schemas']['Plan'][]>

  // POST: /v1/sdk/products/{productRef}/plans
  createPlan?(
    params: components['schemas']['CreatePlanRequest'] & { productRef: string },
  ): Promise<components['schemas']['Plan']>

  // PUT: /v1/sdk/products/{productRef}/plans/{planRef}
  updatePlan?(
    productRef: string,
    planRef: string,
    params: components['schemas']['UpdatePlanRequest'],
  ): Promise<components['schemas']['Plan']>

  // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
  deletePlan?(productRef: string, planRef: string): Promise<void>

  // POST: /v1/sdk/payment-intents
  createPaymentIntent?(
    params: Omit<components['schemas']['CreatePaymentIntentDto'], 'purpose'> & {
      purpose?: components['schemas']['CreatePaymentIntentDto']['purpose']
      idempotencyKey?: string
    },
  ): Promise<components['schemas']['SdkPaymentIntentResponse']>

  // POST: /v1/sdk/payment-intents (purpose: credit_topup)
  createTopupPaymentIntent?(
    params: Pick<
      components['schemas']['CreatePaymentIntentDto'],
      'customerRef' | 'amount' | 'currency' | 'description' | 'autoRecharge'
    > & {
      currency: string
      amount: number
      idempotencyKey?: string
      autoRecharge?: AutoRechargeInput
    },
  ): Promise<components['schemas']['SdkPaymentIntentResponse']>

  // POST: /v1/sdk/purchases/{purchaseRef}/cancel
  cancelPurchase?(
    params: components['schemas']['CancelPurchaseRequest'] & {
      purchaseRef: string
    },
  ): Promise<PurchaseInfo>

  // POST: /v1/sdk/purchases/{purchaseRef}/reactivate
  reactivatePurchase?(params: { purchaseRef: string }): Promise<PurchaseInfo>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/process
  // `productRef` is optional because credit-topup PIs (no product) are
  // processed through the same route — the backend controller ignores
  // the body entirely and drives off the PI id + authenticated provider.
  processPaymentIntent?(
    params: components['schemas']['ProcessPaymentIntentDto'] & {
      paymentIntentId: string
    },
  ): Promise<ProcessPaymentResult>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/business-details
  attachBusinessDetails?(params: AttachBusinessDetailsParams): Promise<AttachBusinessDetailsResult>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/capture-grant
  createCaptureGrant?(params: { paymentIntentId: string }): Promise<CaptureGrant>

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/confirm
  confirmPayment?(params: ConfirmPaymentParams): Promise<ConfirmPaymentResult>

  // GET: /v1/sdk/customers/customer-sessions/{sessionId}
  getCustomerSession?(params: {
    sessionId: string
  }): Promise<components['schemas']['GetCustomerSessionResponse']>

  // POST: /v1/customer-sessions/{sessionId}/capture-grant
  createCustomerSessionCaptureGrant?(params: { sessionId: string }): Promise<CaptureGrant>

  // POST: /v1/customer-sessions/{sessionId}/payment-methods
  saveCustomerSessionCard?(params: SaveCustomerSessionCardParams): Promise<SavedCardResult>

  // POST: /v1/sdk/user-info
  getUserInfo?(params: {
    customerRef: string
    productRef: string
  }): Promise<components['schemas']['UserInfoResponse']>

  // GET: /v1/sdk/customers/:customerRef/credits
  getCustomerBalance?(params: {
    customerRef: string
  }): Promise<components['schemas']['CustomerBalanceResponse']>

  // POST: /v1/sdk/checkout-sessions
  createCheckoutSession(
    params: operations['createCheckoutSession']['requestBody']['content']['application/json'],
  ): Promise<components['schemas']['CreateCheckoutSessionResponse']>

  // POST: /v1/sdk/customers/customer-sessions
  createCustomerSession(
    params: components['schemas']['CreateCustomerSessionRequest'],
  ): Promise<components['schemas']['CreateCustomerSessionResponse']>

  // POST: /v1/sdk/activate
  activatePlan?(params: components['schemas']['ActivatePlanDto']): Promise<ActivatePlanResult>

  // GET: /v1/sdk/payment-method?customerRef=...
  getPaymentMethod?(params: { customerRef: string }): Promise<PaymentMethodInfo>

  // DELETE: /v1/sdk/payment-method?customerRef=...
  removePaymentMethod?(params: { customerRef: string }): Promise<RemovedPaymentMethodResult>

  // GET: /v1/sdk/purchases?customerRef=&productRef=
  listPurchases?(params: {
    customerRef?: string
    productRef?: string
    status?:
      | 'pending'
      | 'active'
      | 'trialing'
      | 'past_due'
      | 'cancelled'
      | 'expired'
      | 'suspended'
      | 'refunded'
    includeFree?: boolean
  }): Promise<{ purchases: PurchaseInfo[] }>

  // GET: /v1/sdk/credits/activity?customerRef=&limit=
  getCreditActivity?(params: { customerRef: string; limit?: number }): Promise<CreditActivityResult>

  // GET: /v1/sdk/auto-recharge?customerRef=...
  getAutoRecharge?(params: { customerRef: string }): Promise<AutoRechargeResponse>

  // PUT: /v1/sdk/auto-recharge
  saveAutoRecharge?(
    params: SaveAutoRechargeInput & { customerRef: string },
  ): Promise<SaveAutoRechargeResponse>

  // DELETE: /v1/sdk/auto-recharge?customerRef=...
  disableAutoRecharge?(params: {
    customerRef: string
  }): Promise<components['schemas']['DisableAutoRechargeResponse']>
}
