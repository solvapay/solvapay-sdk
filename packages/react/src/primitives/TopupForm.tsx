'use client'

/**
 * TopupForm compound primitive.
 *
 * Wraps `useTopup` + Stripe Elements to run a one-shot credit top-up.
 * Unlike `PaymentForm`, no backend reconciliation is needed — credits land
 * via the webhook handler, so `onSuccess` fires immediately after Stripe
 * confirmation.
 *
 * `TopupForm.AmountPicker` is re-exported from the `AmountPicker` primitive
 * so consumers can compose an in-place amount picker without importing from
 * two modules. The amount flows into the form either via the `amount` prop
 * on `Root` or via a sibling `AmountPicker` with matching state.
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement as StripePaymentElement,
} from '@stripe/react-stripe-js'
import type { Stripe, StripeElements, StripeElementLocale } from '@stripe/stripe-js'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { AmountPicker as AmountPickerPrimitive } from './AmountPicker'
import { LegalFooter } from './LegalFooter'
import { withPaymentElementDefaults } from './paymentElementDefaults'
import { useTopup } from '../hooks/useTopup'
import { useCopy, useLocale } from '../hooks/useCopy'
import { Spinner } from '../components/Spinner'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { TopupFormProps } from '../types'

type SubmitState = 'idle' | 'processing' | 'disabled'
type TopupFormState = 'loading' | 'ready' | 'error'

type TopupFormContextValue = {
  amount: number
  currency?: string
  state: TopupFormState
  clientSecret: string | null
  stripe: Stripe | null
  elements: StripeElements | null
  isReady: boolean
  isProcessing: boolean
  paymentInputComplete: boolean
  canSubmit: boolean
  error: string | null
  returnUrl: string
  setPaymentInputComplete: (complete: boolean) => void
  submit: () => Promise<void>
}

const TopupFormContext = createContext<TopupFormContextValue | null>(null)

function useTopupCtx(part: string): TopupFormContextValue {
  const ctx = useContext(TopupFormContext)
  if (!ctx) {
    throw new Error(`TopupForm.${part} must be rendered inside <TopupForm.Root>.`)
  }
  return ctx
}

type RootProps = TopupFormProps & {
  asChild?: boolean
  children?: React.ReactNode
}

const Root = forwardRef<HTMLDivElement, RootProps>(function TopupFormRoot(
  props,
  forwardedRef,
) {
  const {
    amount,
    currency,
    onSuccess,
    onError,
    returnUrl,
    submitButtonText: _submitButtonText,
    buttonClassName: _buttonClassName,
    className,
    asChild,
    children,
    ...rest
  } = props as RootProps & Record<string, unknown>

  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('TopupForm')

  const copy = useCopy()
  const locale = useLocale()
  const { loading, error: topupError, clientSecret, startTopup, stripePromise } = useTopup({
    amount,
    currency,
  })

  const hasInitializedRef = useRef(false)
  const hasAmount = amount > 0

  useEffect(() => {
    if (
      !hasInitializedRef.current &&
      hasAmount &&
      !loading &&
      !topupError &&
      !clientSecret
    ) {
      hasInitializedRef.current = true
      startTopup().catch(() => {
        hasInitializedRef.current = false
      })
    }
    if (hasAmount && clientSecret) hasInitializedRef.current = true
  }, [hasAmount, loading, topupError, clientSecret, startTopup])

  const finalReturnUrl =
    returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return { clientSecret, locale: locale as StripeElementLocale | undefined }
  }, [clientSecret, locale])

  const Comp = asChild ? Slot : 'div'

  const outerError = !hasAmount
    ? copy.errors.configMissingAmount
    : topupError
      ? `${copy.errors.topupInitFailed} ${topupError.message || copy.errors.unknownError}`
      : null

  const dataState: TopupFormState = outerError
    ? 'error'
    : clientSecret && stripePromise
      ? 'ready'
      : 'loading'

  const canMountElements = !!(stripePromise && clientSecret && elementsOptions)

  const innerCommon = {
    amount,
    currency,
    clientSecret,
    returnUrl: finalReturnUrl,
    outerError,
    state: dataState,
    onSuccess,
    onError,
  }

  const shell = (
    <Comp
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={forwardedRef as any}
      className={className}
      data-solvapay-topup-form=""
      data-state={dataState}
      {...rest}
    >
      {children}
    </Comp>
  )

  if (canMountElements) {
    return (
      <Elements key={clientSecret} stripe={stripePromise} options={elementsOptions}>
        <Inner {...innerCommon}>{shell}</Inner>
      </Elements>
    )
  }

  return <OfflineInner {...innerCommon}>{shell}</OfflineInner>
})

type InnerProps = {
  amount: number
  currency?: string
  clientSecret: string | null
  returnUrl: string
  outerError: string | null
  state: TopupFormState
  onSuccess?: TopupFormProps['onSuccess']
  onError?: TopupFormProps['onError']
  children?: React.ReactNode
}

const Inner: React.FC<InnerProps> = ({
  amount,
  currency,
  clientSecret,
  returnUrl,
  outerError,
  state,
  onSuccess,
  onError,
  children,
}) => {
  const stripe = useStripe()
  const elements = useElements()
  const copy = useCopy()

  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReady = !!(stripe && elements)
  const canSubmit = isReady && paymentInputComplete && !isProcessing && !!clientSecret

  const submit = useCallback(async () => {
    if (!stripe || !elements || !clientSecret) {
      const msg = copy.errors.stripeUnavailable
      setError(msg)
      onError?.(new Error(msg))
      return
    }
    setError(null)
    setIsProcessing(true)

    // Stripe requires elements.submit() before confirmPayment() whenever async
    // work happens between click and confirm. Calling it unconditionally is
    // safe — it validates the Payment Element and is a no-op otherwise.
    // https://stripe.com/docs/payments/accept-a-payment-deferred
    const { error: submitError } = await elements.submit()
    if (submitError) {
      const msg = submitError.message || copy.errors.paymentUnexpected
      setError(msg)
      setIsProcessing(false)
      onError?.(new Error(msg))
      return
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    })

    if (confirmError) {
      const msg = confirmError.message || copy.errors.paymentUnexpected
      setError(msg)
      setIsProcessing(false)
      onError?.(new Error(msg))
      return
    }

    setIsProcessing(false)
    if (paymentIntent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await onSuccess?.(paymentIntent as any)
    }
  }, [stripe, elements, clientSecret, returnUrl, copy, onSuccess, onError])

  const effectiveError = error ?? outerError

  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      clientSecret,
      stripe: (stripe as Stripe | null) ?? null,
      elements: (elements as StripeElements | null) ?? null,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      error: effectiveError,
      returnUrl,
      setPaymentInputComplete,
      submit,
    }),
    [
      amount,
      currency,
      state,
      clientSecret,
      stripe,
      elements,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      effectiveError,
      returnUrl,
      submit,
    ],
  )

  return <TopupFormContext.Provider value={ctx}>{children}</TopupFormContext.Provider>
}

/** Pre-Elements context so leaves render (disabled) during initial load. */
const OfflineInner: React.FC<InnerProps> = ({
  amount,
  currency,
  clientSecret,
  returnUrl,
  outerError,
  state,
  children,
}) => {
  const noopSubmit = useCallback(async () => {}, [])
  const noopSet = useCallback(() => {}, [])
  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      clientSecret,
      stripe: null,
      elements: null,
      isReady: false,
      isProcessing: false,
      paymentInputComplete: false,
      canSubmit: false,
      error: outerError,
      returnUrl,
      setPaymentInputComplete: noopSet,
      submit: noopSubmit,
    }),
    [amount, currency, state, clientSecret, outerError, returnUrl, noopSet, noopSubmit],
  )
  return <TopupFormContext.Provider value={ctx}>{children}</TopupFormContext.Provider>
}

type PaymentElementProps = {
  options?: React.ComponentProps<typeof StripePaymentElement>['options']
}

const PaymentElementSlot: React.FC<PaymentElementProps> = ({ options }) => {
  const { setPaymentInputComplete, isReady, stripe, elements } = useTopupCtx('PaymentElement')
  const locale = useLocale()

  if (!stripe || !elements) return null
  if (!isReady) {
    return (
      <div data-solvapay-topup-form-loading="">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div data-solvapay-topup-form-payment-element="">
      <StripePaymentElement
        options={withPaymentElementDefaults(options)}
        onChange={e => setPaymentInputComplete(e.complete)}
        key={locale || 'default'}
      />
    </div>
  )
}

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(function TopupFormSubmitButton(
  { asChild, onClick, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('SubmitButton')
  const copy = useCopy()
  const dataState: SubmitState = ctx.isProcessing
    ? 'processing'
    : !ctx.canSubmit
      ? 'disabled'
      : 'idle'

  const content = ctx.isProcessing ? (
    <>
      <Spinner size="sm" />
      <span>{copy.cta.processing}</span>
    </>
  ) : children ? (
    children
  ) : (
    copy.cta.topUp
  )

  const commonProps = {
    'data-solvapay-topup-form-submit': '',
    'data-state': dataState,
    'aria-busy': ctx.isProcessing,
    'aria-disabled': !ctx.canSubmit,
    disabled: !ctx.canSubmit,
    onClick: composeEventHandlers(onClick, e => {
      e.preventDefault()
      void ctx.submit()
    }),
    ...rest,
  } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
        {content}
      </Slot>
    )
  }
  return (
    <button ref={forwardedRef} type="submit" {...commonProps}>
      {content}
    </button>
  )
})

type SlotProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLDivElement, SlotProps>(function TopupFormLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('Loading')
  if (ctx.state !== 'loading') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-topup-form-loading="" {...rest}>
      {children ?? <Spinner size="sm" />}
    </Comp>
  )
})

const ErrorSlot = forwardRef<HTMLDivElement, SlotProps>(function TopupFormError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('Error')
  if (!ctx.error) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={forwardedRef}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-solvapay-topup-form-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </Comp>
  )
})

export const TopupFormRoot = Root
export const TopupFormPaymentElement = PaymentElementSlot
export const TopupFormSubmitButton = SubmitButton
export const TopupFormLoading = Loading
export const TopupFormError = ErrorSlot
export const TopupFormLegalFooter = LegalFooter

export const TopupForm = {
  Root,
  AmountPicker: AmountPickerPrimitive.Root,
  PaymentElement: PaymentElementSlot,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
  LegalFooter,
} as const

export function useTopupForm(): TopupFormContextValue {
  return useTopupCtx('useTopupForm')
}
