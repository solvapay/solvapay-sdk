/**
 * tailwind-checkout: the same `PlanSelector` + `PaymentForm` composition as
 * shadcn-checkout, styled with Tailwind `data-[state=…]` variants instead of
 * `asChild`.
 */

import { expect, test } from '@playwright/test'
import { checkoutPlan } from '../support/catalog'
import { expectPlanBecomesCurrent, payWithTestCard, selectPlanUnderTest } from '../support/checkout'

test('pays for a plan from the local catalog', async ({ page }) => {
  const plan = await checkoutPlan()

  await page.goto('/')
  await page.locator('a[href="/checkout"]').click()
  await expect(page).toHaveURL(/\/checkout$/)

  await selectPlanUnderTest(page)
  await expect(page.getByText(plan.name).first()).toBeVisible()

  await payWithTestCard(page, { acceptTerms: true })
  await expectPlanBecomesCurrent(page)
})
