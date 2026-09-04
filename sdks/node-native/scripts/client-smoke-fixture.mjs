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

/** @type {{ kind: string, product: string, checkoutUrl: string, message: string, shortMessage: string, planRef: string }} */
export const PAYWALL_GATE_SMOKE_EXPECTED = {
  kind: 'payment_required',
  product: 'prd_demo',
  checkoutUrl: 'https://pay.test/x',
  message:
    "You've reached the included usage for this period. [Open checkout](https://pay.test/x) to continue (expires in 15 minutes), or call the `upgrade` tool. See docs://solvapay/overview.md.",
  shortMessage: 'Payment required',
  planRef: 'pl_basic',
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
