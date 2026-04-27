'use client'

/**
 * Default-tree shim over the `TopupForm` primitive.
 *
 * Drops in a golden-path credit top-up form: Stripe `PaymentElement` +
 * submit button + loading/error states. Full control is available by
 * composing the primitive at `@solvapay/react/primitives`.
 */

import React from 'react'
import { TopupForm as Primitive } from './primitives/TopupForm'
import type { TopupFormProps } from './types'

export const TopupForm: React.FC<TopupFormProps> = props => {
  const { className, buttonClassName, submitButtonText, ...rootProps } = props
  const rootClass = ['solvapay-topup-form', className].filter(Boolean).join(' ')
  const buttonClass = ['solvapay-topup-form-submit', buttonClassName].filter(Boolean).join(' ')
  return (
    <Primitive.Root {...rootProps} className={rootClass}>
      <Primitive.PaymentElement />
      <Primitive.Error className="solvapay-topup-form-error" />
      <Primitive.Loading className="solvapay-topup-form-loading" />
      <Primitive.SubmitButton className={buttonClass}>
        {submitButtonText}
      </Primitive.SubmitButton>
    </Primitive.Root>
  )
}
