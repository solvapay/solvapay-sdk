/**
 * hosted-checkout-demo: the redirect integration. The demo owns no checkout UI —
 * it mints a checkout session server-side and hands the customer to SolvaPay's
 * hosted page, which redirects back to the demo's origin once the purchase is
 * fulfilled.
 *
 * So this spec crosses origins on purpose: demo (:3034) → hosted checkout →
 * demo. The hosted page belongs to the platform stack, which is why the suite
 * requires a running stack rather than mocking the redirect.
 *
 * Runs in anonymous mode (`NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH=anonymous`); see the
 * demo's `app/lib/auth-mode.ts`.
 */

import { expect, test } from '@playwright/test'
import { checkoutPlan } from '../support/catalog'
import { demoBaseUrl, findDemo } from '../support/demos'
import { fillStripeTestCard, waitForPaymentElement } from '../support/stripe'

const DEMO_URL = demoBaseUrl(findDemo('hosted-checkout-demo'))

test('redirects to hosted checkout, pays, and returns with an active purchase', async ({ page }) => {
  const plan = await checkoutPlan()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome to Your Dashboard' })).toBeVisible()

  // The nav renders an Upgrade button too; this is the dashboard CTA.
  await page.getByRole('main').getByRole('button', { name: 'Upgrade' }).click()

  await expect(
    page,
    'The demo never reached the hosted checkout. `POST /api/create-checkout-session` failed — ' +
      'check the dev-server output for the platform response.',
  ).toHaveURL(/\/customer\/checkout(\?|$)/, { timeout: 60_000 })

  // The demo creates the session without a planRef, so the hosted page opens on
  // its own plan-selection panel.
  const planRow = page.getByRole('listitem').filter({ hasText: plan.name })
  await expect(planRow).toBeVisible()
  await planRow.getByRole('button', { name: 'Select' }).click()

  await waitForPaymentElement(page)
  await fillStripeTestCard(page)
  await page.getByRole('button', { name: /^(Subscribe|Pay)\b/ }).click()

  await expect(page).toHaveURL(/\/customer\/checkout\/success/, { timeout: 60_000 })

  // The hosted success page waits for fulfillment, then sends the customer back
  // to the returnUrl the SDK derived from the demo's own origin.
  await expect(
    page,
    'The payment succeeded but the hosted page never returned to the demo. It only redirects ' +
      'once fulfillment lands, so check that the platform is running with Stripe webhook ' +
      'forwarding (`npm run local`).',
  ).toHaveURL(new RegExp(`^${DEMO_URL.replace(/\./g, '\\.')}`), { timeout: 120_000 })

  const productLine = page.getByText(/You're on the/)
  await expect(productLine).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Manage Purchase' })).toBeVisible()
})
