/**
 * Global setup for the example e2e suite.
 *
 * Playwright starts the demos; it does NOT start the platform. This step is
 * what turns "the stack isn't running" or "the key is live, not sandbox"
 * into a single, actionable failure before any demo boots.
 *
 * There is no stub client, no request mocking and no conditional skip: if the
 * preconditions are absent the run fails.
 */

import { resolveMerchantEnv } from './support/env'
import {
  assertMerchantResolves,
  assertPayableCatalog,
  assertStripeTestMode,
} from './support/platform'

async function globalSetup(): Promise<void> {
  const env = resolveMerchantEnv()
  const merchantName = await assertMerchantResolves(env)
  await assertStripeTestMode(env)
  const payablePlans = await assertPayableCatalog(env)

  console.warn(
    `[examples-e2e] ${merchantName} · ${env.productRef} · ` +
      `${payablePlans.length} payable plan(s) via ${env.apiBaseUrl}`,
  )
}

// Playwright resolves `globalSetup` through the module's default export.
export default globalSetup
