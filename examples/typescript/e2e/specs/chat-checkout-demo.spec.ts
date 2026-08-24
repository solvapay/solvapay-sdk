/**
 * chat-checkout-demo: an anonymous customer, an inline checkout drawer, and the
 * stepped `CheckoutSteps` composition.
 *
 * The spec drives the proactive "Upgrade" entry point, not the 402 paywall —
 * tripping a real 402 means sending chat messages, which needs `GEMINI_API_KEY`.
 * Everything after the drawer opens is the same surface either path reaches.
 */

import { expect, test } from '@playwright/test'
import { continuePastPlanStep, payWithTestCard, selectPlanUnderTest } from '../support/checkout'

test('pays for a plan from the inline checkout drawer', async ({ page }) => {
  await page.goto('/')

  // The usage pill resolves from `useLimits`; the upgrade CTA only appears once
  // it has a real value, so waiting on it avoids racing the skeleton.
  await expect(page.getByRole('button', { name: 'Upgrade to Subscription' })).toBeVisible()

  const upgrade = page.getByRole('button', { name: /^(Upgrade|Add credits)$/ })
  await expect(
    upgrade,
    'The chat demo only surfaces its upgrade CTA once the free allowance is nearly spent. ' +
      'Point the suite at a product whose free tier is at most 2 requests (or has none).',
  ).toBeVisible({ timeout: 60_000 })
  await upgrade.click()

  await selectPlanUnderTest(page)
  await continuePastPlanStep(page)
  await payWithTestCard(page)

  // The demo dismisses the drawer from `onPurchaseSuccess`, which the SDK only
  // fires once the purchase is confirmed server-side — so the drawer closing
  // and the chat returning is the product-level success signal here, not a
  // rendered receipt.
  await expect(
    page.locator('[data-solvapay-checkout]'),
    'Card was charged but the checkout drawer never closed, so the demo never saw the ' +
      'purchase. Check that the platform is running with Stripe webhook forwarding ' +
      '(`npm run local`).',
  ).toHaveCount(0, { timeout: 90_000 })

  await expect(page.getByLabel('Chat input')).toBeVisible()
})
