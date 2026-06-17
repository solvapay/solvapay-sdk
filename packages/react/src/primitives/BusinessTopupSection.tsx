'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AddressElement, TaxIdElement } from '@stripe/react-stripe-js'
import type {
  StripeAddressElementChangeEvent,
  StripeTaxIdElementChangeEvent,
} from '@stripe/stripe-js'
import {
  addressFromStripeElement,
  type BusinessDetailsPayload,
  taxIdFromStripeElement,
} from './businessDetails'

export interface BusinessTopupSectionProps {
  currency?: string
  subtotalMinor?: number
  taxMinor?: number
  totalMinor?: number
  onBusinessModeChange?: (enabled: boolean) => void
  onBusinessDetailsChange: (details: BusinessDetailsPayload | undefined) => void
}

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

export const BusinessTopupSection: React.FC<BusinessTopupSectionProps> = ({
  currency = 'usd',
  subtotalMinor,
  taxMinor,
  totalMinor,
  onBusinessModeChange,
  onBusinessDetailsChange,
}) => {
  const [purchasingAsBusiness, setPurchasingAsBusiness] = useState(false)
  const [addressDetails, setAddressDetails] = useState<BusinessDetailsPayload['address']>()
  const [taxIdDetails, setTaxIdDetails] = useState<BusinessDetailsPayload['taxId']>()
  const lastEmittedRef = useRef('')

  const emitDetails = useCallback(
    (
      enabled: boolean,
      address?: BusinessDetailsPayload['address'],
      taxId?: BusinessDetailsPayload['taxId'],
    ) => {
      const payload: BusinessDetailsPayload | undefined =
        enabled && address ? { address, ...(taxId ? { taxId } : {}) } : undefined
      const key = JSON.stringify({ enabled, payload })
      if (key === lastEmittedRef.current) {
        return
      }
      lastEmittedRef.current = key
      onBusinessDetailsChange(payload)
    },
    [onBusinessDetailsChange],
  )

  useEffect(() => {
    emitDetails(purchasingAsBusiness, addressDetails, taxIdDetails)
  }, [purchasingAsBusiness, addressDetails, taxIdDetails, emitDetails])

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked
    setPurchasingAsBusiness(enabled)
    onBusinessModeChange?.(enabled)
    if (!enabled) {
      setAddressDetails(undefined)
      setTaxIdDetails(undefined)
      lastEmittedRef.current = ''
      onBusinessDetailsChange(undefined)
    }
  }

  const showSummary =
    purchasingAsBusiness &&
    subtotalMinor != null &&
    taxMinor != null &&
    totalMinor != null &&
    addressDetails?.country

  return (
    <section aria-label="Business purchase options" className="solvapay-business-topup">
      <label className="solvapay-business-topup__toggle">
        <input type="checkbox" checked={purchasingAsBusiness} onChange={handleToggle} />
        <span>I&apos;m purchasing as a business</span>
      </label>

      {purchasingAsBusiness ? (
        <section aria-label="Business billing details" className="solvapay-business-topup__fields">
          <AddressElement
            options={{ mode: 'billing', fields: { phone: 'never' } }}
            onChange={(event: StripeAddressElementChangeEvent) => {
              setAddressDetails(event.complete ? addressFromStripeElement(event) : undefined)
            }}
          />
          <TaxIdElement
            options={{ visibility: 'auto', fields: { businessName: 'always' } }}
            onChange={(event: StripeTaxIdElementChangeEvent) => {
              setTaxIdDetails(event.complete ? taxIdFromStripeElement(event) : undefined)
            }}
          />
        </section>
      ) : null}

      {showSummary ? (
        <section aria-label="Order summary" className="solvapay-business-topup__summary">
          <p>
            <span>Subtotal</span>
            <span>{formatMinor(subtotalMinor, currency)}</span>
          </p>
          <p>
            <span>VAT</span>
            <span>{formatMinor(taxMinor, currency)}</span>
          </p>
          <p>
            <strong>Total due</strong>
            <strong>{formatMinor(totalMinor, currency)}</strong>
          </p>
        </section>
      ) : null}
    </section>
  )
}
