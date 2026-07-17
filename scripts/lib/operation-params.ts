/**
 * Canonical per-entry-point parameter lists for the SDK contract catalog (§5.6).
 *
 * Sourced from hand-written `SolvaPayClient` / topLevel / facade signatures.
 * Consumed by the YAML populate helper and by unit tests as the expected shape.
 */

import type { OverlayTypeRef } from './manifest-schema.js'

export type ParamDefInput = OverlayTypeRef & {
  name: string
  required?: boolean
  default?: string | number | boolean
  doc?: string
}

export type TypeParamInput = { name: string }

/** Positional parameter lists for all 36 client operations. */
export const OPERATION_PARAMS: Record<string, ParamDefInput[]> = {
  checkLimits: [{ name: 'params', ref: 'CheckLimitsRequest', required: true }],
  trackUsage: [{ name: 'params', ref: 'TrackUsageRequest', required: true }],
  trackUsageBulk: [{ name: 'params', ref: 'TrackUsageBulkRequest', required: true }],
  createCustomer: [{ name: 'params', ref: 'CreateCustomerRequest', required: true }],
  updateCustomer: [
    { name: 'customerRef', type: 'string', required: true },
    { name: 'params', ref: 'UpdateCustomerParams', required: true },
  ],
  getCustomer: [{ name: 'params', ref: 'GetCustomerParams', required: true }],
  assignCredits: [{ name: 'params', ref: 'AssignCreditsRequest', required: true }],
  getMerchant: [],
  getPlatformConfig: [],
  getProduct: [{ name: 'productRef', type: 'string', required: true }],
  listProducts: [],
  createProduct: [{ name: 'params', ref: 'CreateProductRequest', required: true }],
  bootstrapMcpProduct: [{ name: 'params', ref: 'McpBootstrapDto', required: true }],
  configureMcpPlans: [
    { name: 'productRef', type: 'string', required: true },
    { name: 'params', ref: 'ConfigureMcpPlansDto', required: true },
  ],
  updateProduct: [
    { name: 'productRef', type: 'string', required: true },
    { name: 'params', ref: 'UpdateProductRequest', required: true },
  ],
  deleteProduct: [{ name: 'productRef', type: 'string', required: true }],
  cloneProduct: [
    { name: 'productRef', type: 'string', required: true },
    { name: 'overrides', ref: 'CloneProductOverrides', required: false },
  ],
  listPlans: [{ name: 'productRef', type: 'string', required: true }],
  createPlan: [{ name: 'params', ref: 'CreatePlanParams', required: true }],
  updatePlan: [
    { name: 'productRef', type: 'string', required: true },
    { name: 'planRef', type: 'string', required: true },
    { name: 'params', ref: 'UpdatePlanRequest', required: true },
  ],
  deletePlan: [
    { name: 'productRef', type: 'string', required: true },
    { name: 'planRef', type: 'string', required: true },
  ],
  createPaymentIntent: [{ name: 'params', ref: 'CreatePaymentIntentParams', required: true }],
  createTopupPaymentIntent: [
    { name: 'params', ref: 'CreateTopupPaymentIntentParams', required: true },
  ],
  cancelPurchase: [{ name: 'params', ref: 'CancelPurchaseParams', required: true }],
  reactivatePurchase: [{ name: 'params', ref: 'ReactivatePurchaseParams', required: true }],
  processPaymentIntent: [{ name: 'params', ref: 'ProcessPaymentIntentParams', required: true }],
  attachBusinessDetails: [{ name: 'params', ref: 'AttachBusinessDetailsParams', required: true }],
  getUserInfo: [{ name: 'params', ref: 'GetUserInfoParams', required: true }],
  getCustomerBalance: [{ name: 'params', ref: 'GetCustomerBalanceParams', required: true }],
  createCheckoutSession: [{ name: 'params', ref: 'CreateCheckoutSessionRequest', required: true }],
  createCustomerSession: [{ name: 'params', ref: 'CreateCustomerSessionRequest', required: true }],
  activatePlan: [{ name: 'params', ref: 'ActivatePlanDto', required: true }],
  getPaymentMethod: [{ name: 'params', ref: 'GetPaymentMethodParams', required: true }],
  getAutoRecharge: [{ name: 'params', ref: 'GetAutoRechargeParams', required: true }],
  saveAutoRecharge: [{ name: 'params', ref: 'SaveAutoRechargeParams', required: true }],
  disableAutoRecharge: [{ name: 'params', ref: 'DisableAutoRechargeParams', required: true }],
}

/** Top-level callables that must declare params (excludes error classes). */
export const TOP_LEVEL_CALLABLE_IDS = [
  'verifyWebhook',
  'withRetry',
  'buildPaywallGate',
  'buildGateMessage',
  'buildNudgeMessage',
  'classifyPaywallState',
  'paywallErrorToClientPayload',
] as const

export const TOP_LEVEL_PARAMS: Record<string, ParamDefInput[]> = {
  verifyWebhook: [
    {
      name: 'options',
      object: {
        body: { type: 'string', required: true },
        signature: { type: 'string', required: true },
        secret: { type: 'string', required: true },
      },
      required: true,
    },
  ],
  withRetry: [
    { name: 'fn', type: 'unknown', required: true, doc: '() => Promise<T> — callable stand-in' },
    { name: 'options', ref: 'RetryOptions', required: false },
  ],
  buildPaywallGate: [{ name: 'input', type: 'unknown', required: true }],
  buildGateMessage: [{ name: 'input', type: 'unknown', required: true }],
  buildNudgeMessage: [{ name: 'input', type: 'unknown', required: true }],
  classifyPaywallState: [{ name: 'input', type: 'unknown', required: true }],
  paywallErrorToClientPayload: [{ name: 'error', type: 'unknown', required: true }],
  SolvaPayError: [
    { name: 'message', type: 'string', required: true },
    {
      name: 'init',
      object: {
        status: { type: 'number', required: false },
        code: { type: 'string', required: false },
      },
      required: false,
    },
  ],
  PaywallError: [
    { name: 'message', type: 'string', required: true },
    { name: 'structuredContent', type: 'unknown', required: true },
  ],
}

export const TOP_LEVEL_TYPE_PARAMS: Partial<Record<string, TypeParamInput[]>> = {
  withRetry: [{ name: 'T' }],
}

export const FACADE_PARAMS: Record<string, ParamDefInput[]> = {
  createSolvaPay: [{ name: 'config', type: 'unknown', required: false }],
  createSolvaPayClient: [{ name: 'opts', type: 'unknown', required: true }],
  payable: [{ name: 'options', type: 'unknown', required: true }],
  protect: [{ name: 'options', type: 'unknown', required: true }],
  gate: [{ name: 'options', type: 'unknown', required: true }],
}

/** New overlays required so param type refs resolve. */
export const PARAM_OVERLAYS = {
  UpdateCustomerParams: {
    kind: 'synthetic' as const,
    fields: {
      email: { type: 'string' as const, required: false },
      name: { type: 'string' as const, required: false },
      telephone: { type: 'string' as const, required: false },
      metadata: { map: { type: 'unknown' as const }, required: false },
      externalRef: { type: 'string' as const, required: false },
    },
  },
  CancelPurchaseParams: {
    kind: 'synthetic' as const,
    fields: {
      purchaseRef: { type: 'string' as const, required: true },
      reason: { type: 'string' as const, required: false },
    },
  },
  ReactivatePurchaseParams: {
    kind: 'synthetic' as const,
    fields: {
      purchaseRef: { type: 'string' as const, required: true },
    },
  },
  GetUserInfoParams: {
    kind: 'synthetic' as const,
    fields: {
      customerRef: { type: 'string' as const, required: true },
      productRef: { type: 'string' as const, required: true },
    },
  },
  CloneProductOverrides: {
    kind: 'synthetic' as const,
    fields: {
      name: { type: 'string' as const, required: false },
    },
  },
  CreatePlanParams: {
    kind: 'extendDto' as const,
    base: 'CreatePlanRequest',
    fields: {
      productRef: { type: 'string' as const, required: true },
    },
  },
  SaveAutoRechargeParams: {
    kind: 'extendDto' as const,
    base: 'SaveAutoRechargeInput',
    fields: {
      customerRef: { type: 'string' as const, required: true },
    },
  },
  RetryOptions: {
    kind: 'synthetic' as const,
    fields: {
      maxRetries: { type: 'number' as const, required: false },
      initialDelay: { type: 'number' as const, required: false },
      backoffStrategy: { enum: ['fixed', 'linear', 'exponential'], required: false },
      shouldRetry: { type: 'unknown' as const, required: false },
      onRetry: { type: 'unknown' as const, required: false },
    },
  },
}
