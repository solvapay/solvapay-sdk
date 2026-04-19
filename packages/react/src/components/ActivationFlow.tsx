'use client'

/**
 * Default-tree shim over the `ActivationFlow` primitive.
 *
 * Renders the full usage-based activation state machine (summary →
 * activating → selectAmount → topupPayment → retrying → activated | error)
 * with the golden-path copy, the embedded `<CheckoutSummary>` + `<TopupForm>`,
 * and an optional back button. Full control is available by composing the
 * primitive at `@solvapay/react/primitives`.
 */

import React from 'react'
import {
  ActivationFlow as Primitive,
  useActivationFlow,
} from '../primitives/ActivationFlow'
export type { ActivationFlowStep } from '../primitives/ActivationFlow'
import {
  AmountPicker as AmountPickerPrimitive,
  useAmountPicker,
  useAmountPickerCopy,
} from '../primitives/AmountPicker'
import { CheckoutSummary } from './CheckoutSummary'
import { TopupForm } from '../TopupForm'
import { useCopy } from '../hooks/useCopy'
import type { ActivationResult } from '../types'

export interface ActivationFlowProps {
  productRef: string
  planRef?: string
  onSuccess?: (result: ActivationResult) => void
  onError?: (error: Error) => void
  onBack?: () => void
  retryDelayMs?: number
  retryBackoffMs?: number
  className?: string
}

export const ActivationFlow: React.FC<ActivationFlowProps> = props => {
  const { className, onBack, ...rootProps } = props
  const rootClass = ['solvapay-activation-flow', className].filter(Boolean).join(' ')
  return (
    <Primitive.Root {...rootProps} className={rootClass}>
      <SummaryStep />
      <AmountStep />
      <TopupPaymentStep />
      <RetryingStep />
      <ActivatedStep />
      <ErrorStep />
      {onBack && <BackButton onBack={onBack} />}
    </Primitive.Root>
  )
}

const SummaryStep: React.FC = () => {
  const copy = useCopy()
  return (
    <Primitive.Summary className="solvapay-activation-flow-summary">
      <h3 className="solvapay-activation-flow-heading">{copy.activationFlow.heading}</h3>
      <CheckoutSummary />
      <Primitive.ActivateButton className="solvapay-activation-flow-activate" />
    </Primitive.Summary>
  )
}

const AmountStep: React.FC = () => {
  const copy = useCopy()
  return (
    <Primitive.AmountPicker>
      <h3 className="solvapay-activation-flow-topup-heading">
        {copy.activationFlow.topupHeading}
      </h3>
      <p className="solvapay-activation-flow-topup-subheading">
        {copy.activationFlow.topupSubheading}
      </p>
      <AmountPickerBody />
      <Primitive.ContinueButton className="solvapay-activation-flow-continue" />
    </Primitive.AmountPicker>
  )
}

const AmountPickerBody: React.FC = () => {
  const ctx = useAmountPicker()
  const { selectAmountLabel, customAmountLabel } = useAmountPickerCopy()
  return (
    <>
      <p className="solvapay-amount-picker-label">{selectAmountLabel}</p>
      <div className="solvapay-amount-picker-pills">
        {ctx.quickAmounts.map(amount => (
          <AmountPickerPrimitive.Option
            key={amount}
            amount={amount}
            className="solvapay-amount-picker-pill"
          />
        ))}
      </div>
      <div className="solvapay-amount-picker-custom-wrapper">
        <p className="solvapay-amount-picker-custom-label">{customAmountLabel}</p>
        <AmountPickerPrimitive.Custom className="solvapay-amount-picker-custom-input" />
      </div>
    </>
  )
}

const TopupPaymentStep: React.FC = () => {
  const ctx = useActivationFlow()
  const copy = useCopy()
  if (ctx.step !== 'topupPayment') return null
  return (
    <div data-solvapay-activation-flow-topup-payment="">
      <button
        type="button"
        onClick={ctx.backToSelectAmount}
        className="solvapay-activation-flow-change-amount"
      >
        {copy.activationFlow.changeAmountButton}
      </button>
      <TopupForm
        amount={ctx.amountCents}
        currency={ctx.currency}
        onSuccess={ctx.onTopupSuccess}
        onError={err => ctx.onError?.(err instanceof Error ? err : new Error(String(err)))}
      />
    </div>
  )
}

const RetryingStep: React.FC = () => {
  const copy = useCopy()
  return (
    <Primitive.Retrying className="solvapay-activation-flow-retrying">
      <h3 className="solvapay-activation-flow-heading">
        {copy.activationFlow.retryingHeading}
      </h3>
      <p>{copy.activationFlow.retryingSubheading}</p>
    </Primitive.Retrying>
  )
}

const ActivatedStep: React.FC = () => {
  const copy = useCopy()
  return (
    <Primitive.Activated className="solvapay-activation-flow-activated">
      <h3>{copy.activationFlow.activatedHeading}</h3>
      <p>{copy.activationFlow.activatedSubheading}</p>
    </Primitive.Activated>
  )
}

const ErrorStep: React.FC = () => {
  const ctx = useActivationFlow()
  const copy = useCopy()
  if (ctx.step !== 'error') return null
  return (
    <div className="solvapay-activation-flow-error" role="alert">
      <p>{ctx.error}</p>
      <button
        type="button"
        onClick={ctx.reset}
        className="solvapay-activation-flow-try-again"
      >
        {copy.activationFlow.tryAgainButton}
      </button>
    </div>
  )
}

const BackButton: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const ctx = useActivationFlow()
  const copy = useCopy()
  if (ctx.step !== 'summary') return null
  return (
    <button
      type="button"
      onClick={onBack}
      className="solvapay-activation-flow-back"
    >
      {copy.activationFlow.backButton}
    </button>
  )
}
