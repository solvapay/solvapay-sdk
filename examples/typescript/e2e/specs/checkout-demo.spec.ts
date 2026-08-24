/**
 * checkout-demo: the full-app demo — stepped `CheckoutSteps` checkout on its own
 * route, plus a dashboard that reflects the purchase.
 *
 * Runs in anonymous mode (`NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH=anonymous`), so there
 * is no Supabase project to provision; see the demo's `app/lib/auth-mode.ts`.
 */

import { expect, test } from '@playwright/test'
import { checkoutPlan } from '../support/catalog'
import { continuePastPlanStep, payWithTestCard, selectPlanUnderTest } from '../support/checkout'

test('pays for a plan and sees it on the dashboard', async ({ page }) => {
  const plan = await checkoutPlan()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome to Your Dashboard' })).toBeVisible()

  await page.locator('a[href="/checkout"]').first().click()
  await expect(page).toHaveURL(/\/checkout$/)

  await selectPlanUnderTest(page)
  await continuePastPlanStep(page)
  await payWithTestCard(page)

  // The page renders the success step, then redirects home after 2.5s. The
  // dashboard reading back the plan name is the durable signal: it comes from
  // `usePurchase`, i.e. from the platform, not from local checkout state.
  await expect(
    page,
    'Card was charged but the checkout never redirected home, so the demo never saw the ' +
      'purchase. Check that the platform is running with Stripe webhook forwarding ' +
      '(`npm run local`).',
  ).toHaveURL(/\/$/, { timeout: 90_000 })

  const planLine = page.getByText(/You're on the/)
  await expect(planLine).toBeVisible()
  await expect(planLine).toContainText(plan.name)
  await expect(page.getByRole('button', { name: 'Manage Purchase' })).toBeVisible()
})
