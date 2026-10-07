'use client'
import React, { createContext, useContext } from 'react'
import type { BusinessDetailsInput, TaxBreakdown } from '@solvapay/core'
import type { Appearance, Plan, PrefillCustomer, VaultInfo } from '../types'
import type { CardCapture } from '../vault/CardFields'

/** Which card entry is mounted: `'card-fields'` while `CardFields` is active, otherwise `null`. */
export type PaymentElementKind = 'card-fields' | null

export type { CardCapture }

export interface PaymentFormContextValue {
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  /** SolvaPay payment intent id; the capture-grant and confirm calls key on it. */
  paymentIntentId: string | null
  vault: VaultInfo | null
  /** Resolved appearance; `CardFields` derive their look from it. */
  appearance?: Appearance
  processorPaymentId: string | null
  isProcessing: boolean
  isReady: boolean
  paymentInputComplete: boolean
  termsAccepted: boolean
  requireTermsAcceptance: boolean
  canSubmit: boolean
  error: string | null
  /**
   * What the payer is told while the payment is still settling (the rail
   * holds it, or the bank's page is open elsewhere). Rendered by
   * `PaymentForm.Notice`; not a failure, so `onError` does not fire for it.
   */
  notice: string | null
  elementKind: PaymentElementKind
  returnUrl: string
  submitButtonText?: string
  buttonClassName?: string
  customerName: string
  setCustomerName: (name: string) => void
  businessDetails: BusinessDetailsInput
  taxBreakdown: TaxBreakdown | null
  businessDetailsAttached: boolean
  businessDetailsAttaching: boolean
  businessDetailsError: string | null
  fieldErrors: Partial<Record<keyof BusinessDetailsInput, string>>
  setBusinessDetails: (patch: Partial<BusinessDetailsInput>) => void
  setElementKind: (k: PaymentElementKind) => void
  /** `CardFields` hands `Root` the capture function (null on unmount). */
  setCardCapture: (capture: CardCapture | null) => void
  setPaymentInputComplete: (complete: boolean) => void
  setTermsAccepted: (accepted: boolean) => void
  submit: () => Promise<void>
}

export const PaymentFormContext = createContext<PaymentFormContextValue | null>(null)

export function usePaymentForm(): PaymentFormContextValue {
  const ctx = useContext(PaymentFormContext)
  if (!ctx) {
    throw new Error(
      'PaymentForm subcomponents must be used inside a <PaymentForm>. ' +
        'Wrap the slots with <PaymentForm planRef=... productRef=...>.',
    )
  }
  return ctx
}

export const PaymentFormProvider: React.FC<{
  value: PaymentFormContextValue
  children: React.ReactNode
}> = ({ value, children }) => (
  <PaymentFormContext.Provider value={value}>{children}</PaymentFormContext.Provider>
)
