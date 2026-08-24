/**
 * Merchant + platform environment for the example e2e suite.
 *
 * The suite drives real checkout flows against a locally running platform
 * stack, so every input is validated up front and a bad one fails in global
 * setup with an actionable message rather than surfacing later as an empty plan
 * grid or a declined test card.
 *
 * Note what is deliberately NOT validated here: the secret key's environment
 * prefix. A local stack's `live` environment is itself wired to a Stripe test
 * account, so `sk_live_…` there is perfectly payable while the same prefix
 * against production is not. The invariant that actually matters is "Stripe is
 * in test mode", and `assertStripeTestMode` checks exactly that against the
 * platform rather than guessing from the prefix.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'
import dotenv from 'dotenv'

export const E2E_ROOT = path.resolve(__dirname, '..')
export const EXAMPLES_ROOT = path.resolve(E2E_ROOT, '..')

const ENV_FILE = path.resolve(E2E_ROOT, '.env')
if (existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE, quiet: true })
}

/**
 * provider-app's Next proxy. It is the only local process that fans `/v1/*`
 * out across the provider / payment / billing / commerce services, so the
 * demos must not talk to `:3001` (identity-service only).
 */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3010'

export interface MerchantEnv {
  /** Base URL of the local platform proxy, e.g. `http://127.0.0.1:3010`. */
  apiBaseUrl: string
  /** Secret key used by every demo's server side. */
  secretKey: string
  /** Product the specs check out, e.g. `prd_ABC12345`. */
  productRef: string
}

const SETUP_STEPS = [
  'Start the platform stack from the platform repo: `npm run local`.',
  'In the local provider console (http://localhost:3010) create a product with at',
  'least one paid plan, and a secret key for the same environment.',
  `Export them, or copy ${path.join('examples', 'typescript', 'e2e', '.env.example')} to`,
  `${path.join('examples', 'typescript', 'e2e', '.env')} and fill it in.`,
].join('\n  ')

function fail(problem: string): never {
  throw new Error(`[examples-e2e] ${problem}\n\n  ${SETUP_STEPS}\n`)
}

function requireVar(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    fail(`${name} is not set.`)
  }
  return value
}

export function resolveMerchantEnv(): MerchantEnv {
  const secretKey = requireVar('SOLVAPAY_SECRET_KEY')
  if (!secretKey.startsWith('sk_')) {
    fail('SOLVAPAY_SECRET_KEY must be a SolvaPay secret key (sk_…).')
  }

  const productRef = requireVar('SOLVAPAY_PRODUCT_REF')
  if (!productRef.startsWith('prd_')) {
    fail(`SOLVAPAY_PRODUCT_REF must be a product reference (prd_…), got "${productRef}".`)
  }

  return {
    apiBaseUrl: (process.env.SOLVAPAY_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    secretKey,
    productRef,
  }
}
