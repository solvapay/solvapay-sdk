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
import { type BusinessDetailsInput, type TaxBreakdown } from '@solvapay/core'
import type { TopupFormProps } from '../types'
import { readPaymentIntentClientSecret, stripPaymentIntentParams } from './paymentIntentReturn'
import { useBusinessDetailsAttach, defaultBusinessDetails } from '../hooks/useBusinessDetailsAttach'
import {
  createBusinessDetailsParts,
  createTaxSummaryParts,
} from '../components/businessCheckoutParts'

type SubmitState = 'idle' | 'processing' | 'disabled'
type TopupFormState = 'loading' | 'ready' | 'error'

type TopupFormContextValue = {
  amount: number
  currency?: string
  state: TopupFormState
  clientSecret: string | null
  processorPaymentId: string | null
  stripe: Stripe | null
  elements: StripeElements | null
  isReady: boolean
  isProcessing: boolean
  paymentInputComplete: boolean
  canSubmit: boolean
  error: string | null
  returnUrl: string
  businessDetails: BusinessDetailsInput
  taxBreakdown: TaxBreakdown | null
  businessDetailsAttached: boolean
  businessDetailsAttaching: boolean
  businessDetailsError: string | null
  fieldErrors: Partial<Record<keyof BusinessDetailsInput, string>>
  setBusinessDetails: (patch: Partial<BusinessDetailsInput>) => void
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

const Root = forwardRef<HTMLElement, RootProps>(function TopupFormRoot(props, forwardedRef) {
  const {
    amount,
    currency,
    autoRecharge,
    onSuccess,
    onError,
    onTaxChange,
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

  // Pulled here so the Stripe-confirm-to-webhook race fix (gating
  // `onSuccess` on backend confirmation) lives next to the existing
  // provider-context read. Optional — transports that don't implement
  // it keep the legacy fire-on-confirm behaviour.
  const { processTopupPayment, attachBusinessDetails, customerRef } = solva

  const copy = useCopy()
  const locale = useLocale()
  const {
    loading,
    error: topupError,
    clientSecret,
    processorPaymentId,
    startTopup,
    stripePromise,
  } = useTopup({
    amount,
    currency,
    autoRecharge,
  })

  const hasInitializedRef = useRef(false)
  const hasAmount = amount > 0

  useEffect(() => {
    if (!hasInitializedRef.current && hasAmount && !loading && !topupError && !clientSecret) {
      hasInitializedRef.current = true
      startTopup().catch(() => {
        hasInitializedRef.current = false
      })
    }
    if (hasAmount && clientSecret) hasInitializedRef.current = true
  }, [hasAmount, loading, topupError, clientSecret, startTopup])

  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return { clientSecret, locale: locale as StripeElementLocale | undefined }
  }, [clientSecret, locale])

  const Comp = asChild ? Slot : 'section'

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
    processorPaymentId,
    returnUrl: finalReturnUrl,
    outerError,
    state: dataState,
    onSuccess,
    onError,
    onTaxChange,
    processTopupPayment,
    attachBusinessDetails,
    customerRef,
  }

  const shell = (
    <Comp
      ref={forwardedRef as React.Ref<HTMLElement>}
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
  processorPaymentId: string | null
  returnUrl: string
  outerError: string | null
  state: TopupFormState
  onSuccess?: TopupFormProps['onSuccess']
  onError?: TopupFormProps['onError']
  onTaxChange?: TopupFormProps['onTaxChange']
  /**
   * Provider-side backend confirmation hook. When present, `submit`
   * awaits it before firing `onSuccess` so the customer is fully
   * credited (PI succeeded + webhook handler booked the credit) by
   * the time the drawer closes. When absent (custom transports
   * without a `processTopupPayment` impl), the form keeps the legacy
   * fire-on-Stripe-confirm behaviour.
   *
   * On the `succeeded` branch, the backend may surface a
   * `creditsAdded` delta observed by its post-process balance poll.
   * `submit` forwards it to `onSuccess` via the optional `extras`
   * argument so the checkout flow can optimistically bump the
   * in-memory balance before its deterministic refetch lands.
   */
  processTopupPayment?: (params: {
    paymentIntentId: string
  }) => Promise<
    | { status: 'succeeded'; creditsAdded?: number }
    | { status: 'processing' }
    | { status: 'timeout'; message?: string }
    | { status: 'failed' }
    | { status: 'cancelled' }
  >
  attachBusinessDetails?: (params: {
    paymentIntentId: string
    customerRef?: string
    isBusiness: boolean
    businessName?: string
    country?: string
    taxId?: string
    taxIdType?: import('@solvapay/core').TaxIdType
  }) => Promise<{ taxBreakdown: TaxBreakdown }>
  customerRef?: string
  children?: React.ReactNode
}

const Inner: React.FC<InnerProps> = ({
  amount,
  currency,
  clientSecret,
  processorPaymentId,
  returnUrl,
  outerError,
  state,
  onSuccess,
  onError,
  onTaxChange,
  processTopupPayment,
  attachBusinessDetails,
  customerRef,
  children,
}) => {
  const stripe = useStripe()
  const elements = useElements()
  const copy = useCopy()

  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const returnResumeStarted = useRef(false)

  useEffect(() => {
    if (!stripe || returnResumeStarted.current || typeof window === 'undefined') return
    const returnClientSecret = readPaymentIntentClientSecret(window.location.search)
    if (!returnClientSecret) return
    returnResumeStarted.current = true

    let cancelled = false
    void (async () => {
      setIsProcessing(true)
      setError(null)

      const retrieved = await stripe.retrievePaymentIntent(returnClientSecret)
      if (cancelled) return
      stripPaymentIntentParams()

      if (retrieved.error || !retrieved.paymentIntent) {
        setError(copy.errors.paymentUnexpected)
        setIsProcessing(false)
        return
      }

      let paymentIntent = retrieved.paymentIntent
      if (paymentIntent.status === 'requires_action') {
        const actionResult = await stripe.handleNextAction({ clientSecret: returnClientSecret })
        if (cancelled) return
        if (actionResult.error || !actionResult.paymentIntent) {
          setError(copy.errors.paymentRequires3ds)
          setIsProcessing(false)
          return
        }
        paymentIntent = actionResult.paymentIntent
      }

      if (paymentIntent.status === 'processing') {
        setError(copy.errors.paymentPending)
        setIsProcessing(false)
        return
      }

      if (paymentIntent.status !== 'succeeded') {
        setError(copy.errors.paymentProcessingFailed)
        setIsProcessing(false)
        return
      }

      let creditsAdded: number | undefined
      if (processTopupPayment) {
        try {
          const result = await processTopupPayment({ paymentIntentId: paymentIntent.id })
          if (result.status === 'processing') {
            setError(copy.errors.paymentPending)
            setIsProcessing(false)
            return
          }
          if (result.status === 'failed' || result.status === 'cancelled') {
            setError(copy.errors.paymentUnexpected)
            setIsProcessing(false)
            onError?.(new Error(`Topup ${result.status}`))
            return
          }
          if (result.status === 'succeeded' && typeof result.creditsAdded === 'number') {
            creditsAdded = result.creditsAdded
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setIsProcessing(false)
          onError?.(err instanceof Error ? err : new Error(msg))
          return
        }
      }

      if (cancelled) return
      setIsProcessing(false)
      await onSuccess?.(paymentIntent, creditsAdded !== undefined ? { creditsAdded } : undefined)
    })()

    return () => {
      cancelled = true
    }
  }, [stripe, copy, processTopupPayment, onSuccess, onError])

  const {
    businessDetails,
    setBusinessDetails,
    fieldErrors,
    taxBreakdown,
    businessDetailsAttached,
    businessDetailsAttaching,
    businessDetailsError,
    requiresBusinessAttach,
    runAttach,
  } = useBusinessDetailsAttach({
    processorPaymentId,
    attachBusinessDetails,
    customerRef,
    onTaxChange,
  })

  const isReady = !!(stripe && elements)
  const canSubmit =
    isReady &&
    paymentInputComplete &&
    !isProcessing &&
    !!clientSecret &&
    (!requiresBusinessAttach || businessDetailsAttached) &&
    !businessDetailsAttaching

  const submit = useCallback(async () => {
    if (!stripe || !elements || !clientSecret) {
      const msg = copy.errors.stripeUnavailable
      setError(msg)
      onError?.(new Error(msg))
      return
    }

    if (requiresBusinessAttach && !businessDetailsAttached) {
      const attached = await runAttach(businessDetails)
      if (!attached) {
        const msg = businessDetailsError ?? 'Complete business details before paying'
        setError(msg)
        onError?.(new Error(msg))
        return
      }
    }

    setError(null)
    setIsProcessing(true)

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

    let creditsAdded: number | undefined
    if (paymentIntent && processTopupPayment) {
      try {
        const result = await processTopupPayment({ paymentIntentId: paymentIntent.id })
        if (result.status === 'processing') {
          setError(copy.errors.paymentPending)
          setIsProcessing(false)
          return
        }
        if (result.status === 'failed' || result.status === 'cancelled') {
          setError(copy.errors.paymentUnexpected)
          setIsProcessing(false)
          onError?.(new Error(`Topup ${result.status}`))
          return
        }
        if (result.status === 'succeeded' && typeof result.creditsAdded === 'number') {
          creditsAdded = result.creditsAdded
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setIsProcessing(false)
        onError?.(err instanceof Error ? err : new Error(msg))
        return
      }
    }

    setIsProcessing(false)
    if (paymentIntent) {
      await onSuccess?.(paymentIntent, creditsAdded !== undefined ? { creditsAdded } : undefined)
    }
  }, [
    stripe,
    elements,
    clientSecret,
    returnUrl,
    copy,
    onSuccess,
    onError,
    processTopupPayment,
    requiresBusinessAttach,
    businessDetailsAttached,
    runAttach,
    businessDetails,
    businessDetailsError,
  ])

  const effectiveError = error ?? outerError ?? businessDetailsError

  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      clientSecret,
      processorPaymentId,
      stripe: (stripe as Stripe | null) ?? null,
      elements: (elements as StripeElements | null) ?? null,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      error: effectiveError,
      returnUrl,
      businessDetails,
      taxBreakdown,
      businessDetailsAttached,
      businessDetailsAttaching,
      businessDetailsError,
      fieldErrors,
      setBusinessDetails,
      setPaymentInputComplete,
      submit,
    }),
    [
      amount,
      currency,
      state,
      clientSecret,
      processorPaymentId,
      stripe,
      elements,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      effectiveError,
      returnUrl,
      businessDetails,
      taxBreakdown,
      businessDetailsAttached,
      businessDetailsAttaching,
      businessDetailsError,
      fieldErrors,
      setBusinessDetails,
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
  processorPaymentId,
  returnUrl,
  outerError,
  state,
  children,
}) => {
  const noopSubmit = useCallback(async () => {}, [])
  const noopSet = useCallback(() => {}, [])
  const noopBusinessSet = useCallback(() => {}, [])
  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      clientSecret,
      processorPaymentId,
      stripe: null,
      elements: null,
      isReady: false,
      isProcessing: false,
      paymentInputComplete: false,
      canSubmit: false,
      error: outerError,
      returnUrl,
      businessDetails: defaultBusinessDetails,
      taxBreakdown: null,
      businessDetailsAttached: false,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      fieldErrors: {},
      setBusinessDetails: noopBusinessSet,
      setPaymentInputComplete: noopSet,
      submit: noopSubmit,
    }),
    [
      amount,
      currency,
      state,
      clientSecret,
      processorPaymentId,
      outerError,
      returnUrl,
      noopSet,
      noopSubmit,
      noopBusinessSet,
    ],
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
      <output data-solvapay-topup-form-loading="">
        <Spinner size="sm" />
      </output>
    )
  }

  return (
    <section data-solvapay-topup-form-payment-element="">
      <StripePaymentElement
        options={withPaymentElementDefaults(options)}
        onChange={e => setPaymentInputComplete(e.complete)}
        key={locale || 'default'}
      />
    </section>
  )
}

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  function TopupFormSubmitButton({ asChild, onClick, children, ...rest }, forwardedRef) {
    const ctx = useTopupCtx('SubmitButton')
    const copy = useCopy()
    const dataState: SubmitState = ctx.isProcessing
      ? 'processing'
      : !ctx.canSubmit
        ? 'disabled'
        : 'idle'

    const processingContent = (
      <>
        <Spinner size="sm" />
        <span>{copy.cta.processing}</span>
      </>
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
      // The consumer's element is the wrapper that carries their styling.
      // Preserve it across the idle→processing transition by cloning and
      // swapping its children, never replacing it with a Fragment. The
      // previous behaviour passed a Fragment to <Slot> when processing, so
      // className/disabled/onClick landed on a Fragment (which React does
      // not render to DOM) and the button visually broke on click.
      const slotChild =
        ctx.isProcessing && React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{ children?: React.ReactNode }>,
              undefined,
              processingContent,
            )
          : children
      return (
        <Slot
          ref={forwardedRef as React.Ref<HTMLElement>}
          {...(commonProps as Record<string, unknown>)}
        >
          {slotChild}
        </Slot>
      )
    }

    const content = ctx.isProcessing ? processingContent : children ? children : copy.cta.topUp

    return (
      <button ref={forwardedRef} type="submit" {...commonProps}>
        {content}
      </button>
    )
  },
)

type LoadingSlotProps = React.HTMLAttributes<HTMLOutputElement> & { asChild?: boolean }
type ErrorSlotProps = React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLOutputElement, LoadingSlotProps>(function TopupFormLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('Loading')
  if (ctx.state !== 'loading') return null
  if (asChild) {
    return (
      <Slot
        ref={forwardedRef as React.Ref<HTMLElement>}
        data-solvapay-topup-form-loading=""
        {...rest}
      >
        {children ?? <Spinner size="sm" />}
      </Slot>
    )
  }
  return (
    <output ref={forwardedRef} data-solvapay-topup-form-loading="" {...rest}>
      {children ?? <Spinner size="sm" />}
    </output>
  )
})

const ErrorSlot = forwardRef<HTMLParagraphElement, ErrorSlotProps>(function TopupFormError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('Error')
  if (!ctx.error) return null
  if (asChild) {
    return (
      <Slot
        ref={forwardedRef as React.Ref<HTMLElement>}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-solvapay-topup-form-error=""
        {...rest}
      >
        {children ?? ctx.error}
      </Slot>
    )
  }
  return (
    <p
      ref={forwardedRef}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-solvapay-topup-form-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </p>
  )
})

function useTopupBusinessCtx(part: string) {
  const ctx = useTopupCtx(part)
  return {
    businessDetails: ctx.businessDetails,
    setBusinessDetails: ctx.setBusinessDetails,
    fieldErrors: ctx.fieldErrors,
  }
}

function useTopupSummaryCtx(part: string) {
  const ctx = useTopupCtx(part)
  return {
    taxBreakdown: ctx.taxBreakdown,
    businessDetailsAttaching: ctx.businessDetailsAttaching,
    baseAmountMinor: ctx.amount,
    currency: ctx.currency ?? 'usd',
  }
}

const BusinessDetails = createBusinessDetailsParts(useTopupBusinessCtx, 'topup-form')
const Summary = createTaxSummaryParts(useTopupSummaryCtx, 'topup-form')

export const TopupFormRoot = Root
export const TopupFormPaymentElement = PaymentElementSlot
export const TopupFormSubmitButton = SubmitButton
export const TopupFormLoading = Loading
export const TopupFormError = ErrorSlot
export const TopupFormLegalFooter = LegalFooter
export const TopupFormBusinessDetails = BusinessDetails
export const TopupFormSummary = Summary

export const TopupForm = {
  Root,
  AmountPicker: AmountPickerPrimitive.Root,
  PaymentElement: PaymentElementSlot,
  BusinessDetails,
  Summary,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
  LegalFooter,
} as const

export function useTopupForm(): TopupFormContextValue {
  return useTopupCtx('useTopupForm')
}
