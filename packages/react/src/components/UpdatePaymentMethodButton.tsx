'use client'

/**
 * `<UpdatePaymentMethodButton>` — trigger that opens the SolvaPay hosted
 * customer portal so the customer can update their card on file.
 *
 * This MCP-first slice ships `mode="portal"` only (thin wrapper around
 * `<LaunchCustomerPortalButton>`). A future Lovable-focused PR will add
 * `mode="inline"` — a drawer containing `<PaymentMethodForm>` (Stripe
 * Elements + SetupIntent). The `mode` prop is defined now so the API
 * stays stable across both PRs.
 */

import React, { forwardRef } from 'react'
import {
  LaunchCustomerPortalButton,
  type LaunchCustomerPortalButtonProps,
} from './LaunchCustomerPortalButton'
import { useCopy } from '../hooks/useCopy'

export type UpdatePaymentMethodButtonMode = 'portal'

export interface UpdatePaymentMethodButtonProps
  extends Omit<LaunchCustomerPortalButtonProps, 'children'> {
  /**
   * How card updates are collected. `"portal"` (default, only value shipped
   * today) opens the SolvaPay hosted customer portal in a new tab. A
   * future PR adds `"inline"` for Stripe Elements; keep the prop stable so
   * callers don't need to migrate when that lands.
   */
  mode?: UpdatePaymentMethodButtonMode
  /** Override the default "Update card" label. */
  children?: React.ReactNode
}

export const UpdatePaymentMethodButton = forwardRef<
  HTMLAnchorElement,
  UpdatePaymentMethodButtonProps
>(function UpdatePaymentMethodButton(
  { mode = 'portal', children, ...rest },
  forwardedRef,
) {
  const copy = useCopy()

  // Defensive: preserve the API shape. Today only 'portal' is implemented.
  if (mode !== 'portal') {
    throw new Error(
      `<UpdatePaymentMethodButton mode="${mode}"> is not implemented yet — use mode="portal" or omit the prop.`,
    )
  }

  return (
    <LaunchCustomerPortalButton
      ref={forwardedRef}
      data-solvapay-update-payment-method=""
      {...rest}
    >
      {children ?? copy.currentPlan.updatePaymentButton}
    </LaunchCustomerPortalButton>
  )
})
