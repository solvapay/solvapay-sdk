/* tslint:disable */
/* eslint-disable */

/**
 * Binding for `MCP_TOOL_NAMES`.
 */
export function MCP_TOOL_NAMES(args_json: string): string

/**
 * Binding for `SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE`.
 */
export function SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE(args_json: string): string

/**
 * wasm-bindgen client wrapping Rust [`SolvaPayClient`] over [`FetchTransport`].
 *
 * Every method takes one JSON-args string and returns a `Promise<string>`
 * resolving to one envelope string.
 */
export class WasmClient {
  free(): void
  [Symbol.dispose](): void
  /**
   * `POST /v1/sdk/activate`
   */
  activatePlan(args_json: string): Promise<string>
  /**
   * Grant credits to a customer.
   */
  assignCredits(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/payment-intents/{id}/business-details`
   */
  attachBusinessDetails(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/products/mcp/bootstrap`
   */
  bootstrapMcpProduct(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/purchases/{purchaseRef}/cancel`
   */
  cancelPurchase(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/limits`
   */
  checkLimits(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/products/{productRef}/clone`
   *
   * Args JSON is `{ productRef, name? }`.
   */
  cloneProduct(args_json: string): Promise<string>
  /**
   * `PUT /v1/sdk/products/{productRef}/mcp/plans`
   *
   * Args JSON is `{ productRef, ...params }`.
   */
  configureMcpPlans(args_json: string): Promise<string>
  /**
   * Hosted checkout session.
   */
  createCheckoutSession(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/customers`
   */
  createCustomer(args_json: string): Promise<string>
  /**
   * Customer portal session.
   */
  createCustomerSession(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/payment-intents` (plan checkout).
   */
  createPaymentIntent(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/products/{productRef}/plans` (`productRef` in body).
   */
  createPlan(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/products`
   */
  createProduct(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/payment-intents` (credit top-up).
   */
  createTopupPaymentIntent(args_json: string): Promise<string>
  /**
   * `DELETE /v1/sdk/products/{productRef}/plans/{planRef}`
   *
   * Args JSON is `{ productRef, planRef }`. Success value is `null`.
   */
  deletePlan(args_json: string): Promise<string>
  /**
   * `DELETE /v1/sdk/products/{productRef}`
   *
   * Args JSON is `{ productRef }`. Success value is `null`.
   */
  deleteProduct(args_json: string): Promise<string>
  /**
   * `DELETE /v1/sdk/auto-recharge`
   */
  disableAutoRecharge(args_json: string): Promise<string>
  /**
   * `GET /v1/sdk/auto-recharge`
   */
  getAutoRecharge(args_json: string): Promise<string>
  /**
   * Customer lookup by ref / externalRef / email.
   */
  getCustomer(args_json: string): Promise<string>
  /**
   * Credit balance for a customer.
   */
  getCustomerBalance(args_json: string): Promise<string>
  /**
   * Merchant profile (`args_json` ignored; pass `"{}"`).
   */
  getMerchant(_args_json: string): Promise<string>
  /**
   * `GET /v1/sdk/payment-method`
   */
  getPaymentMethod(args_json: string): Promise<string>
  /**
   * Platform config (`args_json` ignored; pass `"{}"`).
   */
  getPlatformConfig(_args_json: string): Promise<string>
  /**
   * `GET /v1/sdk/products/{productRef}`
   *
   * Args JSON is `{ productRef }`.
   */
  getProduct(args_json: string): Promise<string>
  /**
   * User info for a customer/product pair.
   */
  getUserInfo(args_json: string): Promise<string>
  /**
   * `GET /v1/sdk/products/{productRef}/plans`
   *
   * Args JSON is `{ productRef }`.
   */
  listPlans(args_json: string): Promise<string>
  /**
   * `GET /v1/sdk/products` (`args_json` ignored; pass `"{}"`).
   */
  listProducts(_args_json: string): Promise<string>
  /**
   * Constructs a client over `FetchTransport` + `ClientShell`.
   *
   * # Arguments
   *
   * * `api_key` - Bearer token.
   * * `api_base_url` - Optional origin; defaults to `https://api.solvapay.com`.
   */
  constructor(api_key: string, api_base_url?: string | null)
  /**
   * `POST /v1/sdk/payment-intents/{id}/process`
   */
  processPaymentIntent(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/purchases/{purchaseRef}/reactivate`
   */
  reactivatePurchase(args_json: string): Promise<string>
  /**
   * `PUT /v1/sdk/auto-recharge`
   */
  saveAutoRecharge(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/usages`
   */
  trackUsage(args_json: string): Promise<string>
  /**
   * `POST /v1/sdk/usages/bulk`
   */
  trackUsageBulk(args_json: string): Promise<string>
  /**
   * `PATCH /v1/sdk/customers/{customerRef}`
   *
   * Args JSON is `{ customerRef, ...body }` — Rust splits path vs body.
   */
  updateCustomer(args_json: string): Promise<string>
  /**
   * `PUT /v1/sdk/products/{productRef}/plans/{planRef}`
   *
   * Args JSON is `{ productRef, planRef, ...params }`.
   */
  updatePlan(args_json: string): Promise<string>
  /**
   * `PUT /v1/sdk/products/{productRef}`
   *
   * Args JSON is `{ productRef, ...params }`.
   */
  updateProduct(args_json: string): Promise<string>
}

/**
 * Binding for `assertResponseResult` — brand failures are Transport errors
 * (TS wrapper rethrows as plain `Error` for fixture name parity).
 */
export function assertResponseResult(args_json: string): string

/**
 * Binding for `attachBusinessDetailsValidationError`.
 */
export function attachBusinessDetailsValidationError(args_json: string): string

/**
 * Binding for `buildCreateCustomerParams` (`nowMs` is required; no clock string).
 */
export function buildCreateCustomerParams(args_json: string): string

/**
 * Binding for `buildGateMessage`.
 */
export function buildGateMessage(args_json: string): string

/**
 * Binding for `buildNudgeMessage`.
 */
export function buildNudgeMessage(args_json: string): string

/**
 * Binding for `buildPaywallGate`.
 */
export function buildPaywallGate(args_json: string): string

/**
 * Binding for `buildPromptDescriptorMetadata`.
 */
export function buildPromptDescriptorMetadata(args_json: string): string

/**
 * Binding for `buildPromptUserMessage`.
 */
export function buildPromptUserMessage(args_json: string): string

/**
 * Binding for `buildToolDescriptorMetadata`.
 */
export function buildToolDescriptorMetadata(args_json: string): string

/**
 * Binding for `classifyCancelError`.
 */
export function classifyCancelError(args_json: string): string

/**
 * Binding for `classifyCreateError`.
 */
export function classifyCreateError(args_json: string): string

/**
 * Binding for `classifyCustomerRef`.
 */
export function classifyCustomerRef(args_json: string): string

/**
 * Binding for `classifyLookupError`.
 */
export function classifyLookupError(args_json: string): string

/**
 * Binding for `classifyPaywallState`.
 */
export function classifyPaywallState(args_json: string): string

/**
 * Binding for `classifyReactivateError`.
 */
export function classifyReactivateError(args_json: string): string

/**
 * Binding for `coerceCustomerOptions`.
 */
export function coerceCustomerOptions(args_json: string): string

/**
 * Binding for `creditsToDisplayMinorUnits` (`null` when undefined).
 */
export function creditsToDisplayMinorUnits(args_json: string): string

/**
 * Binding for `decidePaywallOutcome`.
 */
export function decidePaywallOutcome(args_json: string): string

/**
 * Binding for `deriveIcons` — absent/empty branding → JSON `null`.
 */
export function deriveIcons(args_json: string): string

/**
 * Binding for `deriveTaxIdType`.
 */
export function deriveTaxIdType(args_json: string): string

/**
 * Binding for `evaluateCachedLimits`.
 */
export function evaluateCachedLimits(args_json: string): string

/**
 * Binding for `evaluateFreshLimits`.
 */
export function evaluateFreshLimits(args_json: string): string

/**
 * Binding for `extractBackendCustomerRef`.
 */
export function extractBackendCustomerRef(args_json: string): string

/**
 * Binding for `getBusinessCountryOptions`.
 */
export function getBusinessCountryOptions(args_json: string): string

/**
 * Binding for `getSellerTaxIdentifierDisplayLabel`.
 */
export function getSellerTaxIdentifierDisplayLabel(args_json: string): string

/**
 * Binding for `getTaxIdExample`.
 */
export function getTaxIdExample(args_json: string): string

/**
 * Binding for `getTaxIdFieldLabel`.
 */
export function getTaxIdFieldLabel(args_json: string): string

/**
 * Binding for `getTaxIdHelperText`.
 */
export function getTaxIdHelperText(args_json: string): string

/**
 * Binding for `isCachedCustomerRefValid`.
 */
export function isCachedCustomerRefValid(args_json: string): string

/**
 * Binding for `isEmailConflict`.
 */
export function isEmailConflict(args_json: string): string

/**
 * Binding for `isErrorResult`.
 */
export function isErrorResult(args_json: string): string

/**
 * Binding for `isZeroDecimalCurrency`.
 */
export function isZeroDecimalCurrency(args_json: string): string

/**
 * Binding for `makeResponseResult`.
 */
export function makeResponseResult(args_json: string): string

/**
 * Binding for `mapRouteError` (`kind`: `"solvapay"` | `"error"` | `"unknown"`).
 */
export function mapRouteError(args_json: string): string

/**
 * Binding for `mcpViewMaps`.
 */
export function mcpViewMaps(args_json: string): string

/**
 * Binding for `minorUnitsPerMajor`.
 */
export function minorUnitsPerMajor(args_json: string): string

/**
 * Binding for `normalizeCancelResponse`.
 */
export function normalizeCancelResponse(args_json: string): string

/**
 * Binding for `normalizeReactivateResponse`.
 */
export function normalizeReactivateResponse(args_json: string): string

/**
 * Binding for `paywallErrorToClientPayload`.
 */
export function paywallErrorToClientPayload(args_json: string): string

/**
 * Binding for `paywallToolResult` (also used by `McpAdapter.formatGate`).
 */
export function paywallToolResult(args_json: string): string

/**
 * Binding for `projectPaymentIntentResult`.
 */
export function projectPaymentIntentResult(args_json: string): string

/**
 * Binding for `projectTopupProcessOutcome`.
 */
export function projectTopupProcessOutcome(args_json: string): string

/**
 * Binding for `projectUsageSnapshot`.
 */
export function projectUsageSnapshot(args_json: string): string

/**
 * Binding for `resolveCheckLimitsParams`.
 */
export function resolveCheckLimitsParams(args_json: string): string

/**
 * Binding for `resolveFallbackGateLimits`.
 */
export function resolveFallbackGateLimits(args_json: string): string

/**
 * Binding for `resolveProductRef`.
 */
export function resolveProductRef(args_json: string): string

/**
 * Binding for `resolvePurchaseCustomerRef`.
 */
export function resolvePurchaseCustomerRef(args_json: string): string

/**
 * Binding for `resolveReturnUrl`.
 */
export function resolveReturnUrl(args_json: string): string

/**
 * Binding for `resolveSellerIdentityDisplay`.
 */
export function resolveSellerIdentityDisplay(args_json: string): string

/**
 * Binding for `resolveTaxBehavior`.
 */
export function resolveTaxBehavior(args_json: string): string

/**
 * Binding for `retryNextDelayMs`.
 */
export function retryNextDelayMs(args_json: string): string

/**
 * Binding for `selectActivePurchases`.
 */
export function selectActivePurchases(args_json: string): string

/**
 * Binding for `validateActivatePlanParams`.
 */
export function validateActivatePlanParams(args_json: string): string

/**
 * Binding for `validateAttachBusinessDetailsParams`.
 */
export function validateAttachBusinessDetailsParams(args_json: string): string

/**
 * Binding for `validateBusinessDetails`.
 */
export function validateBusinessDetails(args_json: string): string

/**
 * Binding for `validateCheckoutSessionParams`.
 */
export function validateCheckoutSessionParams(args_json: string): string

/**
 * Binding for `validateCreatePaymentIntentParams`.
 */
export function validateCreatePaymentIntentParams(args_json: string): string

/**
 * Binding for `validateGetProductParams`.
 */
export function validateGetProductParams(args_json: string): string

/**
 * Binding for `validateListPlansParams`.
 */
export function validateListPlansParams(args_json: string): string

/**
 * Binding for `validateProcessPaymentIntentParams`.
 */
export function validateProcessPaymentIntentParams(args_json: string): string

/**
 * Binding for `validatePublicBaseUrl` — invalid → error message; valid → `null`.
 */
export function validatePublicBaseUrl(args_json: string): string

/**
 * Binding for `validatePurchaseRef`.
 */
export function validatePurchaseRef(args_json: string): string

/**
 * Binding for `validateTopupPaymentIntentParams`.
 */
export function validateTopupPaymentIntentParams(args_json: string): string

/**
 * Verifies a SolvaPay webhook signature with an explicit clock.
 *
 * Returns the parsed JSON body as a string on success. On failure throws a JS
 * `Error` whose `code` is the snake_case webhook error code.
 *
 * # Arguments
 *
 * * `body` - Raw request body string.
 * * `signature` - `SV-Signature` header value.
 * * `secret` - Webhook secret (`whsec_…`).
 * * `now_unix_secs` - Host clock as unix seconds (typically `Math.floor(Date.now()/1000)`).
 *   Accepted as `f64` so the JS binding stays a Number (wasm-bindgen maps `i64` to BigInt).
 */
export function verifyWebhook(
  body: string,
  signature: string,
  secret: string,
  now_unix_secs: number,
): string

/**
 * Returns the crate version string (`CARGO_PKG_VERSION`).
 *
 * Used as a hello-world smoke export proving the WASM module loads under both
 * edge and browser profiles.
 */
export function wasmVersion(): string

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly MCP_TOOL_NAMES: (a: number, b: number) => [number, number]
  readonly SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: (a: number, b: number) => [number, number]
  readonly __wbg_wasmclient_free: (a: number, b: number) => void
  readonly assertResponseResult: (a: number, b: number) => [number, number]
  readonly attachBusinessDetailsValidationError: (a: number, b: number) => [number, number]
  readonly buildCreateCustomerParams: (a: number, b: number) => [number, number]
  readonly buildGateMessage: (a: number, b: number) => [number, number]
  readonly buildNudgeMessage: (a: number, b: number) => [number, number]
  readonly buildPaywallGate: (a: number, b: number) => [number, number]
  readonly buildPromptDescriptorMetadata: (a: number, b: number) => [number, number]
  readonly buildPromptUserMessage: (a: number, b: number) => [number, number]
  readonly buildToolDescriptorMetadata: (a: number, b: number) => [number, number]
  readonly classifyCancelError: (a: number, b: number) => [number, number]
  readonly classifyCreateError: (a: number, b: number) => [number, number]
  readonly classifyCustomerRef: (a: number, b: number) => [number, number]
  readonly classifyLookupError: (a: number, b: number) => [number, number]
  readonly classifyPaywallState: (a: number, b: number) => [number, number]
  readonly classifyReactivateError: (a: number, b: number) => [number, number]
  readonly coerceCustomerOptions: (a: number, b: number) => [number, number]
  readonly creditsToDisplayMinorUnits: (a: number, b: number) => [number, number]
  readonly decidePaywallOutcome: (a: number, b: number) => [number, number]
  readonly deriveIcons: (a: number, b: number) => [number, number]
  readonly deriveTaxIdType: (a: number, b: number) => [number, number]
  readonly evaluateCachedLimits: (a: number, b: number) => [number, number]
  readonly evaluateFreshLimits: (a: number, b: number) => [number, number]
  readonly extractBackendCustomerRef: (a: number, b: number) => [number, number]
  readonly getBusinessCountryOptions: (a: number, b: number) => [number, number]
  readonly getSellerTaxIdentifierDisplayLabel: (a: number, b: number) => [number, number]
  readonly getTaxIdExample: (a: number, b: number) => [number, number]
  readonly getTaxIdFieldLabel: (a: number, b: number) => [number, number]
  readonly getTaxIdHelperText: (a: number, b: number) => [number, number]
  readonly isCachedCustomerRefValid: (a: number, b: number) => [number, number]
  readonly isEmailConflict: (a: number, b: number) => [number, number]
  readonly isErrorResult: (a: number, b: number) => [number, number]
  readonly isZeroDecimalCurrency: (a: number, b: number) => [number, number]
  readonly makeResponseResult: (a: number, b: number) => [number, number]
  readonly mapRouteError: (a: number, b: number) => [number, number]
  readonly mcpViewMaps: (a: number, b: number) => [number, number]
  readonly minorUnitsPerMajor: (a: number, b: number) => [number, number]
  readonly normalizeCancelResponse: (a: number, b: number) => [number, number]
  readonly normalizeReactivateResponse: (a: number, b: number) => [number, number]
  readonly paywallErrorToClientPayload: (a: number, b: number) => [number, number]
  readonly paywallToolResult: (a: number, b: number) => [number, number]
  readonly projectPaymentIntentResult: (a: number, b: number) => [number, number]
  readonly projectTopupProcessOutcome: (a: number, b: number) => [number, number]
  readonly projectUsageSnapshot: (a: number, b: number) => [number, number]
  readonly resolveCheckLimitsParams: (a: number, b: number) => [number, number]
  readonly resolveFallbackGateLimits: (a: number, b: number) => [number, number]
  readonly resolveProductRef: (a: number, b: number) => [number, number]
  readonly resolvePurchaseCustomerRef: (a: number, b: number) => [number, number]
  readonly resolveReturnUrl: (a: number, b: number) => [number, number]
  readonly resolveSellerIdentityDisplay: (a: number, b: number) => [number, number]
  readonly resolveTaxBehavior: (a: number, b: number) => [number, number]
  readonly retryNextDelayMs: (a: number, b: number) => [number, number]
  readonly selectActivePurchases: (a: number, b: number) => [number, number]
  readonly validateActivatePlanParams: (a: number, b: number) => [number, number]
  readonly validateAttachBusinessDetailsParams: (a: number, b: number) => [number, number]
  readonly validateBusinessDetails: (a: number, b: number) => [number, number]
  readonly validateCheckoutSessionParams: (a: number, b: number) => [number, number]
  readonly validateCreatePaymentIntentParams: (a: number, b: number) => [number, number]
  readonly validateGetProductParams: (a: number, b: number) => [number, number]
  readonly validateListPlansParams: (a: number, b: number) => [number, number]
  readonly validateProcessPaymentIntentParams: (a: number, b: number) => [number, number]
  readonly validatePublicBaseUrl: (a: number, b: number) => [number, number]
  readonly validatePurchaseRef: (a: number, b: number) => [number, number]
  readonly validateTopupPaymentIntentParams: (a: number, b: number) => [number, number]
  readonly verifyWebhook: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
  ) => [number, number, number, number]
  readonly wasmVersion: () => [number, number]
  readonly wasmclient_activatePlan: (a: number, b: number, c: number) => any
  readonly wasmclient_assignCredits: (a: number, b: number, c: number) => any
  readonly wasmclient_attachBusinessDetails: (a: number, b: number, c: number) => any
  readonly wasmclient_bootstrapMcpProduct: (a: number, b: number, c: number) => any
  readonly wasmclient_cancelPurchase: (a: number, b: number, c: number) => any
  readonly wasmclient_checkLimits: (a: number, b: number, c: number) => any
  readonly wasmclient_cloneProduct: (a: number, b: number, c: number) => any
  readonly wasmclient_configureMcpPlans: (a: number, b: number, c: number) => any
  readonly wasmclient_createCheckoutSession: (a: number, b: number, c: number) => any
  readonly wasmclient_createCustomer: (a: number, b: number, c: number) => any
  readonly wasmclient_createCustomerSession: (a: number, b: number, c: number) => any
  readonly wasmclient_createPaymentIntent: (a: number, b: number, c: number) => any
  readonly wasmclient_createPlan: (a: number, b: number, c: number) => any
  readonly wasmclient_createProduct: (a: number, b: number, c: number) => any
  readonly wasmclient_createTopupPaymentIntent: (a: number, b: number, c: number) => any
  readonly wasmclient_deletePlan: (a: number, b: number, c: number) => any
  readonly wasmclient_deleteProduct: (a: number, b: number, c: number) => any
  readonly wasmclient_disableAutoRecharge: (a: number, b: number, c: number) => any
  readonly wasmclient_getAutoRecharge: (a: number, b: number, c: number) => any
  readonly wasmclient_getCustomer: (a: number, b: number, c: number) => any
  readonly wasmclient_getCustomerBalance: (a: number, b: number, c: number) => any
  readonly wasmclient_getMerchant: (a: number, b: number, c: number) => any
  readonly wasmclient_getPaymentMethod: (a: number, b: number, c: number) => any
  readonly wasmclient_getPlatformConfig: (a: number, b: number, c: number) => any
  readonly wasmclient_getProduct: (a: number, b: number, c: number) => any
  readonly wasmclient_getUserInfo: (a: number, b: number, c: number) => any
  readonly wasmclient_listPlans: (a: number, b: number, c: number) => any
  readonly wasmclient_listProducts: (a: number, b: number, c: number) => any
  readonly wasmclient_new: (a: number, b: number, c: number, d: number) => number
  readonly wasmclient_processPaymentIntent: (a: number, b: number, c: number) => any
  readonly wasmclient_reactivatePurchase: (a: number, b: number, c: number) => any
  readonly wasmclient_saveAutoRecharge: (a: number, b: number, c: number) => any
  readonly wasmclient_trackUsage: (a: number, b: number, c: number) => any
  readonly wasmclient_trackUsageBulk: (a: number, b: number, c: number) => any
  readonly wasmclient_updateCustomer: (a: number, b: number, c: number) => any
  readonly wasmclient_updatePlan: (a: number, b: number, c: number) => any
  readonly wasmclient_updateProduct: (a: number, b: number, c: number) => any
  readonly wasm_bindgen__convert__closures_____invoke__hf82478b34f74c087: (
    a: number,
    b: number,
    c: any,
  ) => [number, number]
  readonly wasm_bindgen__convert__closures_____invoke__h23bdb694a7765c71: (
    a: number,
    b: number,
    c: any,
    d: any,
  ) => void
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number
  readonly __wbindgen_exn_store: (a: number) => void
  readonly __externref_table_alloc: () => number
  readonly __wbindgen_externrefs: WebAssembly.Table
  readonly __wbindgen_destroy_closure: (a: number, b: number) => void
  readonly __wbindgen_free: (a: number, b: number, c: number) => void
  readonly __externref_table_dealloc: (a: number) => void
  readonly __wbindgen_start: () => void
}

export type SyncInitInput = BufferSource | WebAssembly.Module

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>
