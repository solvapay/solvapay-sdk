/**
 * Driving the Stripe PaymentElement from Playwright.
 *
 * Same approach as the platform QA suite (`platform/test/qa/support/stripe-ui.ts`):
 * the element renders in a cross-origin `__privateStripeFrame*` iframe, so the
 * fields are reached through a frame locator and addressed by placeholder.
 */

import { expect, type FrameLocator, type Page } from '@playwright/test'

/** Always-approved Stripe test card. Only settles in test mode. */
export const STRIPE_TEST_CARD = '4242424242424242'
export const STRIPE_TEST_EXPIRY = '12 / 34'
export const STRIPE_TEST_CVC = '123'

export function paymentElementFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[name^="__privateStripeFrame"]').first()
}

/**
 * Wait for the PaymentElement to mount and be interactive. Stripe mounts the
 * frame before the card fields exist, so waiting on the frame alone races the
 * first `fill`.
 */
export async function waitForPaymentElement(page: Page, timeout = 45_000): Promise<void> {
  await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({
    timeout,
  })
  await expect(paymentElementFrame(page).getByPlaceholder('1234 1234 1234 1234')).toBeVisible({
    timeout,
  })
}

export async function fillStripeTestCard(
  page: Page,
  cardNumber: string = STRIPE_TEST_CARD,
): Promise<void> {
  const frame = paymentElementFrame(page)
  await frame.getByPlaceholder('1234 1234 1234 1234').fill(cardNumber)
  await frame.getByPlaceholder('MM / YY').fill(STRIPE_TEST_EXPIRY)
  await frame.getByPlaceholder('CVC').fill(STRIPE_TEST_CVC)

  // Some PaymentElement configurations add a postal code field; fill it when present.
  const postalCode = frame.getByPlaceholder('12345')
  if (await postalCode.count()) {
    await postalCode.fill('12345')
  }
}
