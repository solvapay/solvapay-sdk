'use client'
import React, { useEffect, useRef, useState } from 'react'
import { PaymentForm } from '../PaymentForm'
import type { PaymentIntent } from '@stripe/stripe-js'
import type { PrefillCustomer } from '../types'

export type CheckoutLayoutSize = 'chat' | 'mobile' | 'desktop' | 'auto'

export type CheckoutLayoutClassNames = {
  root?: string
  summary?: string
  form?: string
  mandate?: string
  submit?: string
}

export type CheckoutLayoutProps = {
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  size?: CheckoutLayoutSize
  requireTermsAcceptance?: boolean
  onSuccess?: (paymentIntent: PaymentIntent) => void
  onError?: (error: Error) => void
  submitButtonText?: string
  returnUrl?: string
  classNames?: CheckoutLayoutClassNames
}

type ResolvedSize = 'chat' | 'mobile' | 'desktop'

const BREAKPOINTS = {
  chat: 480,
  desktop: 768,
} as const

function widthToSize(width: number): ResolvedSize {
  if (width < BREAKPOINTS.chat) return 'chat'
  if (width < BREAKPOINTS.desktop) return 'mobile'
  return 'desktop'
}

/**
 * Opinionated one-line drop-in checkout. Uses a `ResizeObserver` to adapt to
 * the container width — works identically inside a chat bubble, a phone
 * viewport, and a full-page desktop layout without relying on viewport media
 * queries (so it survives being embedded in resizable iframes and chat UIs).
 */
export const CheckoutLayout: React.FC<CheckoutLayoutProps> = ({
  planRef,
  productRef,
  prefillCustomer,
  size = 'auto',
  requireTermsAcceptance,
  onSuccess,
  onError,
  submitButtonText,
  returnUrl,
  classNames,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [autoSize, setAutoSize] = useState<ResolvedSize>('desktop')

  useEffect(() => {
    if (size !== 'auto') return
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        setAutoSize(widthToSize(w))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  const resolvedSize: ResolvedSize = size === 'auto' ? autoSize : size

  const isDesktop = resolvedSize === 'desktop'
  const isChat = resolvedSize === 'chat'

  return (
    <div
      ref={rootRef}
      data-solvapay-checkout-layout={resolvedSize}
      className={classNames?.root}
      style={{
        display: 'grid',
        gap: isDesktop ? 24 : 16,
        gridTemplateColumns: isDesktop ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
        padding: isChat ? 8 : isDesktop ? 24 : 16,
        fontSize: resolvedSize === 'mobile' ? 15 : 14,
      }}
    >
      <PaymentForm
        planRef={planRef}
        productRef={productRef}
        prefillCustomer={prefillCustomer}
        requireTermsAcceptance={requireTermsAcceptance}
        onSuccess={onSuccess}
        onError={onError}
        submitButtonText={submitButtonText}
        returnUrl={returnUrl}
      >
        <section
          className={classNames?.summary}
          data-solvapay-layout-section="summary"
          style={{ gridColumn: isDesktop ? '1 / 2' : '1 / -1' }}
        >
          <PaymentForm.Summary />
          <PaymentForm.CustomerFields />
        </section>
        <section
          className={classNames?.form}
          data-solvapay-layout-section="form"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            gridColumn: isDesktop ? '2 / 3' : '1 / -1',
          }}
        >
          {isChat ? (
            <PaymentForm.CardElement />
          ) : (
            <PaymentForm.PaymentElement />
          )}
          <PaymentForm.Error />
          <PaymentForm.MandateText className={classNames?.mandate} />
          {requireTermsAcceptance && <PaymentForm.TermsCheckbox />}
          <PaymentForm.SubmitButton className={classNames?.submit} />
        </section>
      </PaymentForm>
    </div>
  )
}
