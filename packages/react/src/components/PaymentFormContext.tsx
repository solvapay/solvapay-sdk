'use client'
import React, { createContext, useContext } from 'react'
import type { Stripe, StripeElements } from '@stripe/stripe-js'
import type { Plan, PrefillCustomer } from '../types'

export type PaymentElementKind = 'payment-element' | 'card-element' | null

export interface PaymentFormContextValue {
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  clientSecret: string | null
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
  setElementKind: (k: PaymentElementKind) => void
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
