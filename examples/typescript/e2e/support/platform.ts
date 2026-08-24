/**
 * Preflight probes against the local platform stack.
 *
 * These run once in global setup so a missing stack or a mis-scoped merchant
 * credential fails before any browser starts, with a message that says what to
 * do about it.
 */

import type { MerchantEnv } from './env'

export interface PaidPlan {
  reference: string
  name: string
  type: string
  price: number
  currency: string
}

interface PlanWire {
  reference?: string
  name?: string
  type?: string
  price?: number
  currency?: string
  requiresPayment?: boolean
  status?: string
}

function planListUrl(env: MerchantEnv): string {
  return `${env.apiBaseUrl}/v1/sdk/products/${env.productRef}/plans`
}

async function fetchPlans(env: MerchantEnv): Promise<PlanWire[]> {
  const url = planListUrl(env)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${env.secretKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw new Error(
      `[examples-e2e] Cannot reach the local platform at ${env.apiBaseUrl}.\n\n` +
        '  Start it from the platform repo with `npm run local` (which also forwards\n' +
        '  Stripe webhooks), then re-run. The demos must talk to the provider-app\n' +
        '  proxy on :3010 — it is the only local process that fans /v1/* out across\n' +
        '  the provider, payment, billing and commerce services.\n',
      { cause },
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `[examples-e2e] The local platform rejected SOLVAPAY_SECRET_KEY (${response.status}). ` +
        'Create a fresh sandbox secret key in the provider console and export it.',
    )
  }
  if (response.status === 404) {
    throw new Error(
      `[examples-e2e] Product ${env.productRef} does not exist in the sandbox environment ` +
        'of this platform stack. Create it in the provider console (sandbox) and export its reference.',
    )
  }
  if (!response.ok) {
    throw new Error(
      `[examples-e2e] GET ${url} failed with ${response.status}: ${await response.text()}`,
    )
  }

  const body = (await response.json()) as { plans?: PlanWire[] }
  return body.plans ?? []
}

/**
 * Confirm the platform is up, the key is accepted, and the product exposes at
 * least one payable plan. Returns the payable plans so specs can assert against
 * real catalog data instead of hard-coded copy.
 */
export async function assertPayableCatalog(env: MerchantEnv): Promise<PaidPlan[]> {
  const plans = await fetchPlans(env)

  if (plans.length === 0) {
    throw new Error(
      `[examples-e2e] Product ${env.productRef} has no plans. Add at least one paid plan ` +
        'in the provider console — every spec completes a card payment.',
    )
  }

  const payable = plans.filter(plan => plan.requiresPayment !== false && (plan.price ?? 0) > 0)

  if (payable.length === 0) {
    throw new Error(
      `[examples-e2e] Product ${env.productRef} has ${plans.length} plan(s) but none require ` +
        'payment. Add a paid plan — the happy path under test is a card payment.',
    )
  }

  return payable.map(plan => ({
    reference: plan.reference ?? '',
    name: plan.name ?? '',
    type: plan.type ?? '',
    price: plan.price ?? 0,
    currency: plan.currency ?? 'USD',
  }))
}

/**
 * Confirm the PaymentElement will mount against Stripe test mode.
 *
 * The demos load Stripe.js with the publishable key this endpoint returns. If
 * the local stack is wired to a live-mode platform key, every spec would reach
 * the card form and then fail on a declined `4242…` — so check it here, where
 * the message can say why.
 */
export async function assertStripeTestMode(env: MerchantEnv): Promise<void> {
  const response = await fetch(`${env.apiBaseUrl}/v1/sdk/platform-config`, {
    headers: { authorization: `Bearer ${env.secretKey}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(
      `[examples-e2e] GET /v1/sdk/platform-config failed with ${response.status}: ${await response.text()}`,
    )
  }

  const { stripePublishableKey } = (await response.json()) as { stripePublishableKey?: string }

  if (!stripePublishableKey) {
    throw new Error(
      '[examples-e2e] The platform returned no Stripe publishable key, so the PaymentElement ' +
        'cannot mount. Configure Stripe on the local stack before running payment specs.',
    )
  }
  if (!stripePublishableKey.startsWith('pk_test_')) {
    throw new Error(
      '[examples-e2e] SOLVAPAY_SECRET_KEY belongs to an environment wired to a live-mode ' +
        'Stripe key, so the Stripe test cards this suite pays with would be declined — and a ' +
        'real card would be a real charge.\n\n' +
        '  Use a key for an environment on Stripe test mode (the sandbox environment in the\n' +
        '  provider console), and a product with a paid plan in that same environment.\n',
    )
  }
}

/**
 * Confirm the merchant profile resolves, so a provider that has never been
 * onboarded fails here instead of at the first Stripe mount.
 */
export async function assertMerchantResolves(env: MerchantEnv): Promise<string> {
  const response = await fetch(`${env.apiBaseUrl}/v1/sdk/merchant`, {
    headers: { authorization: `Bearer ${env.secretKey}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(
      `[examples-e2e] GET /v1/sdk/merchant failed with ${response.status}: ${await response.text()}`,
    )
  }

  const merchant = (await response.json()) as { displayName?: string }
  if (!merchant.displayName) {
    throw new Error(
      '[examples-e2e] The platform returned a merchant profile with no display name. ' +
        'Finish provider onboarding in the local console before running payment specs.',
    )
  }
  return merchant.displayName
}
