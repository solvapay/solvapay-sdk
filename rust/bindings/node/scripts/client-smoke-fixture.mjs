/**
 * Shared client + sync pure-logic smoke fixtures (Step 37R-e).
 *
 * Used by clean-install-consumer:
 * - sync: buildPaywallGate golden (mirrors contract/fixtures/paywall/gate/payment-minimal)
 * - async: getCustomer against an in-process node:http stub
 */

/** @type {{ productRef: string, limits: { plan: string, remaining: number, checkoutUrl: string } }} */
export const PAYWALL_GATE_SMOKE_INPUT = {
  productRef: 'prd_demo',
  limits: {
    plan: 'pl_basic',
    remaining: 0,
    checkoutUrl: 'https://pay.test/x',
  },
}

/** @type {{ kind: string, product: string, checkoutUrl: string, message: string }} */
export const PAYWALL_GATE_SMOKE_EXPECTED = {
  kind: 'payment_required',
  product: 'prd_demo',
  checkoutUrl: 'https://pay.test/x',
  message:
    "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan, or open https://pay.test/x in a browser.",
}

export const CUSTOMER_SMOKE_REF = 'cus_smoke_1'
export const CUSTOMER_SMOKE_EMAIL = 'smoke@example.com'
export const CUSTOMER_SMOKE_NAME = 'Smoke Customer'
export const CUSTOMER_SMOKE_EXTERNAL_REF = 'ext_smoke_1'

/** Upstream JSON body for GET /v1/sdk/customers/:ref */
export const CUSTOMER_SMOKE_UPSTREAM = {
  reference: CUSTOMER_SMOKE_REF,
  email: CUSTOMER_SMOKE_EMAIL,
  name: CUSTOMER_SMOKE_NAME,
  externalRef: CUSTOMER_SMOKE_EXTERNAL_REF,
  purchases: [],
}

/** Normalized Client.getCustomer result shape */
export const CUSTOMER_SMOKE_EXPECTED = {
  customerRef: CUSTOMER_SMOKE_REF,
  email: CUSTOMER_SMOKE_EMAIL,
  name: CUSTOMER_SMOKE_NAME,
  externalRef: CUSTOMER_SMOKE_EXTERNAL_REF,
  purchases: [],
}
