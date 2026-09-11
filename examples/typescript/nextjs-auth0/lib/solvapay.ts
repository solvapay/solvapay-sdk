import { createSolvaPay, type SolvaPay } from '@solvapay/server'

/**
 * Shared server-side SolvaPay client.
 *
 * Call with NO arguments so the SDK reads BOTH `SOLVAPAY_SECRET_KEY` and
 * `SOLVAPAY_API_BASE_URL` from the environment — exactly like the `@solvapay/next`
 * route wrappers do. Passing only `{ apiKey }` would leave `apiBaseUrl` unset,
 * defaulting to the production API where the `sk_sandbox_` dev key is rejected
 * (401 on `/v1/sdk/limits`). The secret key never leaves the server.
 */
export function getSolvaPay(): SolvaPay {
  return createSolvaPay()
}

/** Product that gates the task board — the "Auth0 demo" product. */
export function getProductRef(): string {
  const productRef = process.env.SOLVAPAY_PRODUCT_REF
  if (!productRef) {
    throw new Error(
      'Server configuration error: SOLVAPAY_PRODUCT_REF environment variable is required.',
    )
  }

  return productRef
}
