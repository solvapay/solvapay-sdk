/**
 * shadcn-checkout: `PlanSelector` + `PaymentForm` composed over shadcn/ui via
 * `asChild`. No auth — the demo's proxy stamps a fixed `x-user-id`.
 */

import { expect, test } from '@playwright/test'
import { checkoutPlan } from '../support/catalog'
import { expectPlanBecomesCurrent, payWithTestCard, selectPlanUnderTest } from '../support/checkout'

test('pays for a plan from the local catalog', async ({ page }) => {
  const plan = await checkoutPlan()

  await page.goto('/')
  await page.locator('a[href="/checkout"]').click()
  await expect(page).toHaveURL(/\/checkout$/)

  // The plan grid is the proof that plans came from the local API rather than
  // the bundled stub client, whose plans are named "Starter"/"Pro".
  await selectPlanUnderTest(page)
  await expect(page.getByText(plan.name).first()).toBeVisible()

  await payWithTestCard(page, { acceptTerms: true })
  await expectPlanBecomesCurrent(page)
})
