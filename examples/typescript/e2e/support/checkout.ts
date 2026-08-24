/**
 * Shared assertions for the SolvaPay checkout primitives.
 *
 * Every demo composes the same primitives, so the specs differ only in how
 * they reach the checkout surface. Selectors target the stable
 * `data-solvapay-*` attributes the primitives emit — never demo-specific
 * class names.
 */

import { expect, type Page } from '@playwright/test'
import { checkoutPlan } from './catalog'
import { fillStripeTestCard, waitForPaymentElement } from './stripe'

const PLAN_CARD = '[data-solvapay-plan-selector-card]'
const PLAN_ERROR = '[data-solvapay-plan-selector-error]'
const PLAN_LOADING = '[data-solvapay-plan-selector-loading]'
const PAYMENT_FORM = '[data-solvapay-payment-form]'
const PAYMENT_ERROR = '[data-solvapay-payment-form-error]'
const SUBMIT = '[data-solvapay-payment-form-submit]'
const TERMS_CHECKBOX = '#solvapay-terms-checkbox'

/**
 * Wait for the plan grid to be populated from the local API, then click the
 * card for the plan under test.
 */
export async function selectPlanUnderTest(page: Page): Promise<void> {
  const plan = await checkoutPlan()

  await expect(page.locator(PLAN_ERROR)).toHaveCount(0)
  await expect(page.locator(PLAN_LOADING)).toHaveCount(0)
  await expect(
    page.locator(PLAN_CARD).first(),
    'No plan cards rendered — the demo did not receive plans from the local platform.',
  ).toBeVisible()

  const card = page
    .locator(PLAN_CARD)
    .filter({ has: page.locator('[data-solvapay-plan-selector-card-name]', { hasText: plan.name }) })
    .first()

  await expect(
    card,
    `Plan "${plan.name}" (${plan.reference}) is not in the rendered plan grid.`,
  ).toBeVisible()
  await expect(card).not.toHaveAttribute('data-state', 'disabled')
  await card.click()
  await expect(card).toHaveAttribute('data-state', 'selected')
}

/** Advance the stepped checkout from the plan step to the payment step. */
export async function continuePastPlanStep(page: Page): Promise<void> {
  const continueButton = page.locator('[data-solvapay-checkout-continue]')
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  await expect(page.locator('[data-solvapay-checkout]')).toHaveAttribute('data-step', 'payment')
}

/**
 * Fill and submit the PaymentElement with the always-approved test card.
 *
 * `acceptTerms` is for the demos that compose `PaymentForm.TermsCheckbox` with
 * `requireTermsAcceptance` — the submit button stays disabled until it is
 * ticked.
 */
export async function payWithTestCard(
  page: Page,
  { acceptTerms = false }: { acceptTerms?: boolean } = {},
): Promise<void> {
  await expect(page.locator(PAYMENT_FORM)).toHaveAttribute('data-state', 'ready')
  await waitForPaymentElement(page)
  await fillStripeTestCard(page)

  if (acceptTerms) {
    await page.locator(TERMS_CHECKBOX).check()
  }

  const submit = page.locator(SUBMIT)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.locator(PAYMENT_ERROR)).toHaveCount(0)
}

/**
 * The purchase is only real once the demo observes it. Stripe confirming the
 * card is not enough: the plan card flips to `current` when
 * `usePurchase` reports an active purchase for it.
 */
export async function expectPlanBecomesCurrent(page: Page, timeout = 90_000): Promise<void> {
  const plan = await checkoutPlan()

  await expect(
    page.locator(`${PLAN_CARD}[data-state="current"]`),
    `Card was charged but the demo never saw an active purchase for "${plan.name}". ` +
      'Check that the platform is running with Stripe webhook forwarding (`npm run local`).',
  ).toBeVisible({ timeout })
}