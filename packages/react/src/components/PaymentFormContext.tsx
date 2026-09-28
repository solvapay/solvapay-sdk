'use client'
import React, { createContext, useContext } from 'react'
import type { Appearance, Stripe, StripeElements } from '@stripe/stripe-js'
import type { BusinessDetailsInput, TaxBreakdown } from '@solvapay/core'
import type { CaptureMode, Plan, PrefillCustomer, VaultInfo } from '../types'
import type { CardCapture } from '../vault/CardFields'

export type PaymentElementKind = 'payment-element' | 'card-element' | 'card-fields' | null

export type { CardCapture }

export interface PaymentFormContextValue {
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  /** `processor_elements` (Stripe Elements) or `vault` (SDK CardFields, server-side confirm). */
  captureMode: CaptureMode
  /** SolvaPay payment intent id. Set in both modes; the vault calls key on it. */
  paymentIntentId: string | null
  vault: VaultInfo | null
  /** Resolved Elements appearance; vault `CardFields` derive their look from it. */
  appearance?: Appearance
  clientSecret: string | null
  processorPaymentId: string | null
  stripe: Stripe | null
  elements: StripeElements | null
  isProcessing: boolean
  isReady: boolean
  paymentInputComplete: boolean
  termsAccepted: boolean
  requireTermsAcceptance: boolean
  canSubmit: boolean
  error: string | null
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
  /** Vault mode only: `CardFields` hands `Root` the capture function (null on unmount). */
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
