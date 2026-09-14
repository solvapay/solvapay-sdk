'use client'

import React, { createContext, useContext } from 'react'
import type {
  CaptureError,
  CaptureFieldName,
  CaptureFieldOptions,
  CaptureSession,
  CaptureState,
  CapturedCredential,
} from '../vault/types'

/**
 * State shared by the vault capture slots.
 *
 * Deliberately separate from `PaymentFormContext`. The payment form context
 * describes a checkout; this one describes a set of inputs. Keeping them apart
 * means the capture surface can be mounted on its own, for saving a card
 * outside a purchase, without pretending there is a payment in flight.
 */
export interface CardFieldsContextValue {
  session: CaptureSession | null
  state: CaptureState
  /** The script and the session are both resolved. */
  ready: boolean
  /** Every required field is valid. */
  complete: boolean
  error: CaptureError | null
  /**
   * Registers a container element for one field and mounts the iframe into it.
   * Passing `null` unmounts. Options are read once, at mount.
   */
  registerField: (
    name: CaptureFieldName,
    element: HTMLElement | null,
    options?: CaptureFieldOptions,
  ) => void
  /** Sends the card to the vault. Resolves with a handle, never with card data. */
  capture: () => Promise<CapturedCredential>
}

export const CardFieldsContext = createContext<CardFieldsContextValue | null>(null)

export function useCardFields(): CardFieldsContextValue {
  const ctx = useContext(CardFieldsContext)
  if (!ctx) {
    throw new Error(
      'CardFields subcomponents must be used inside a <PaymentForm.CardFields>. ' +
        'Wrap the field slots with <PaymentForm.CardFields>.',
    )
  }
  return ctx
}

export const CardFieldsProvider: React.FC<{
  value: CardFieldsContextValue
  children: React.ReactNode
}> = ({ value, children }) => (
  <CardFieldsContext.Provider value={value}>{children}</CardFieldsContext.Provider>
)
