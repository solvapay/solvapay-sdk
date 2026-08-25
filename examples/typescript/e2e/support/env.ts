/**
 * Merchant + platform environment for the example e2e suite.
 *
 * The suite only runs against the provider's **sandbox** environment. A live
 * key is rejected here — before any demo boots — because the specs pay with
 * Stripe test cards and must never charge a real customer.
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

/** SolvaPay secret keys are environment-prefixed. Only sandbox is allowed. */
export const SANDBOX_KEY_PREFIX = 'sk_sandbox_'
const LIVE_KEY_PREFIX = 'sk_live_'

export interface MerchantEnv {
  /** Base URL of the local platform proxy, e.g. `http://127.0.0.1:3010`. */
  apiBaseUrl: string
  /** Sandbox secret key used by every demo's server side. */
  secretKey: string
  /** Product the specs check out, e.g. `prd_ABC12345`. */
  productRef: string
}

const SETUP_STEPS = [
  'Start the platform stack from the platform repo: `npm run local`.',
  'Open the local provider console at http://localhost:3010, switch to SANDBOX,',
  'create a product with at least one paid plan, then create a sandbox secret key.',
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

  if (secretKey.startsWith(LIVE_KEY_PREFIX)) {
    fail(
      'SOLVAPAY_SECRET_KEY is a live-mode key. This suite only runs in sandbox — ' +
        `provide a ${SANDBOX_KEY_PREFIX}… key. Live keys charge real cards.`,
    )
  }
  if (!secretKey.startsWith(SANDBOX_KEY_PREFIX)) {
    fail(`SOLVAPAY_SECRET_KEY must be a sandbox key (${SANDBOX_KEY_PREFIX}…).`)
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
