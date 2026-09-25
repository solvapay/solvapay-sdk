'use client'

import React, { createContext, useContext } from 'react'
import type {
  CaptureError,
  CaptureFieldName,
  CaptureFieldOptions,
  CaptureSession,
  CaptureState,
  CapturedInstrument,
  SavedInstrument,
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
  /**
   * Sends the card to the vault. Resolves with a handle, never with card data.
   *
   * The lower-level half of `save`. Use it directly only when the card should
   * reach the vault without being recorded against the customer, which is a
   * narrower case than it sounds: a card the vault holds and we have no
   * reference to is a card nobody can ever charge.
   */
  capture: () => Promise<CapturedInstrument>
  /** True while the captured card is being recorded. */
  saving: boolean
  /**
   * Captures the card and records it against the customer, in that order.
   *
   * This is what a submit button calls. The capture grant is single use, so a
   * fresh one is minted afterwards and the surface is ready for another card.
   */
  save: (options?: { setAsDefault?: boolean }) => Promise<SavedInstrument>
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
