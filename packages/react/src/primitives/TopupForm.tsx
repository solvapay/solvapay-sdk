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
import { formatPrice } from '../utils/format'
import {
  validateBusinessDetails,
  SUPPORTED_BUSINESS_COUNTRIES,
  type BusinessDetailsInput,
  type TaxBreakdown,
} from '@solvapay/core'
import type { TopupFormProps } from '../types'

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

const Root = forwardRef<HTMLDivElement, RootProps>(function TopupFormRoot(props, forwardedRef) {
  const {
    amount,
    currency,
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
  processTopupPayment?: (params: { paymentIntentId: string }) => Promise<
    | { status: 'succeeded'; creditsAdded?: number }
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

function mapBusinessFieldErrors(
  input: BusinessDetailsInput,
): Partial<Record<keyof BusinessDetailsInput, string>> {
  const result = validateBusinessDetails(input)
  if (result.success) return {}
  const errors: Partial<Record<keyof BusinessDetailsInput, string>> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !errors[key as keyof BusinessDetailsInput]) {
      errors[key as keyof BusinessDetailsInput] = issue.message
    }
  }
  return errors
}

const defaultBusinessDetails: BusinessDetailsInput = { isBusiness: false }

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
  const [businessDetails, setBusinessDetailsState] =
    useState<BusinessDetailsInput>(defaultBusinessDetails)
  const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdown | null>(null)
  const [businessDetailsAttached, setBusinessDetailsAttached] = useState(false)
  const [businessDetailsAttaching, setBusinessDetailsAttaching] = useState(false)
  const [businessDetailsError, setBusinessDetailsError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof BusinessDetailsInput, string>>
  >({})

  const attachRequestIdRef = useRef(0)

  const setBusinessDetails = useCallback((patch: Partial<BusinessDetailsInput>) => {
    setBusinessDetailsState(prev => {
      const next = { ...prev, ...patch }
      if (patch.isBusiness === false) {
        return { isBusiness: false }
      }
      return next
    })
    setBusinessDetailsAttached(false)
    setBusinessDetailsError(null)
  }, [])

  const runAttach = useCallback(
    async (input: BusinessDetailsInput): Promise<boolean> => {
      if (!processorPaymentId || !attachBusinessDetails) {
        return !attachBusinessDetails
      }

      const validation = validateBusinessDetails(input)
      if (!validation.success) {
        setFieldErrors(mapBusinessFieldErrors(input))
        return false
      }

      setFieldErrors({})
      const requestId = ++attachRequestIdRef.current
      setBusinessDetailsAttaching(true)

      try {
        const result = await attachBusinessDetails({
          paymentIntentId: processorPaymentId,
          ...(customerRef ? { customerRef } : {}),
          ...validation.data,
        })
        if (requestId !== attachRequestIdRef.current) return false
        setTaxBreakdown(result.taxBreakdown)
        setBusinessDetailsAttached(true)
        setBusinessDetailsError(null)
        onTaxChange?.(result.taxBreakdown)
        return true
      } catch (err) {
        if (requestId !== attachRequestIdRef.current) return false
        const msg = err instanceof Error ? err.message : String(err)
        setBusinessDetailsAttached(false)
        setBusinessDetailsError(msg)
        return false
      } finally {
        if (requestId === attachRequestIdRef.current) {
          setBusinessDetailsAttaching(false)
        }
      }
    },
    [processorPaymentId, attachBusinessDetails, customerRef, onTaxChange],
  )

  useEffect(() => {
    if (!processorPaymentId || !attachBusinessDetails) return

    const validation = validateBusinessDetails(businessDetails)
    if (!validation.success) {
      setFieldErrors(mapBusinessFieldErrors(businessDetails))
      setBusinessDetailsAttached(false)
      return
    }

    setFieldErrors({})
    const timer = setTimeout(() => {
      void runAttach(businessDetails)
    }, 300)

    return () => clearTimeout(timer)
  }, [businessDetails, processorPaymentId, attachBusinessDetails, runAttach])

  const requiresBusinessAttach = !!attachBusinessDetails
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await onSuccess?.(paymentIntent as any, creditsAdded !== undefined ? { creditsAdded } : undefined)
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
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

type BusinessDetailsRootProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean
  children?: React.ReactNode
}

const BusinessDetailsRoot = forwardRef<HTMLDivElement, BusinessDetailsRootProps>(
  function TopupFormBusinessDetailsRoot({ asChild, children, ...rest }, forwardedRef) {
    useTopupCtx('BusinessDetails')
    const Comp = asChild ? Slot : 'div'
    return (
      <Comp ref={forwardedRef} data-solvapay-topup-form-business-details="" {...rest}>
        {children}
      </Comp>
    )
  },
)

type BusinessDetailsToggleProps = React.InputHTMLAttributes<HTMLInputElement> & {
  asChild?: boolean
}

const BusinessDetailsToggle = forwardRef<HTMLInputElement, BusinessDetailsToggleProps>(
  function TopupFormBusinessDetailsToggle({ asChild, onChange, ...rest }, forwardedRef) {
    const ctx = useTopupCtx('BusinessDetails.Toggle')
    const commonProps = {
      'data-solvapay-topup-form-business-details-toggle': '',
      type: 'checkbox',
      checked: ctx.businessDetails.isBusiness,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.setBusinessDetails({ isBusiness: e.target.checked })
      }),
      ...rest,
    }

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)} />
      )
    }

    return <input ref={forwardedRef} {...commonProps} />
  },
)

type BusinessDetailsFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  asChild?: boolean
}

const BusinessDetailsBusinessName = forwardRef<HTMLInputElement, BusinessDetailsFieldProps>(
  function TopupFormBusinessDetailsBusinessName({ asChild, onChange, ...rest }, forwardedRef) {
    const ctx = useTopupCtx('BusinessDetails.BusinessName')
    if (!ctx.businessDetails.isBusiness) return null

    const commonProps = {
      'data-solvapay-topup-form-business-details-name': '',
      type: 'text',
      value: ctx.businessDetails.businessName ?? '',
      'aria-invalid': ctx.fieldErrors.businessName ? true : undefined,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.setBusinessDetails({ businessName: e.target.value })
      }),
      ...rest,
    }

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)} />
      )
    }

    return <input ref={forwardedRef} {...commonProps} />
  },
)

type BusinessDetailsCountryProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  asChild?: boolean
}

const BusinessDetailsCountry = forwardRef<HTMLSelectElement, BusinessDetailsCountryProps>(
  function TopupFormBusinessDetailsCountry({ asChild, onChange, children, ...rest }, forwardedRef) {
    const ctx = useTopupCtx('BusinessDetails.Country')
    if (!ctx.businessDetails.isBusiness) return null

    const commonProps = {
      'data-solvapay-topup-form-business-details-country': '',
      value: ctx.businessDetails.country ?? '',
      'aria-invalid': ctx.fieldErrors.country ? true : undefined,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLSelectElement>) => {
        ctx.setBusinessDetails({ country: e.target.value })
      }),
      ...rest,
    }

    const defaultOptions = (
      <>
        <option value="">Select country</option>
        {SUPPORTED_BUSINESS_COUNTRIES.map(code => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </>
    )

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
          {children ?? defaultOptions}
        </Slot>
      )
    }

    return (
      <select ref={forwardedRef} {...commonProps}>
        {children ?? defaultOptions}
      </select>
    )
  },
)

const BusinessDetailsTaxId = forwardRef<HTMLInputElement, BusinessDetailsFieldProps>(
  function TopupFormBusinessDetailsTaxId({ asChild, onChange, ...rest }, forwardedRef) {
    const ctx = useTopupCtx('BusinessDetails.TaxId')
    if (!ctx.businessDetails.isBusiness) return null

    const commonProps = {
      'data-solvapay-topup-form-business-details-tax-id': '',
      type: 'text',
      value: ctx.businessDetails.taxId ?? '',
      'aria-invalid': ctx.fieldErrors.taxId ? true : undefined,
      onChange: composeEventHandlers(onChange, (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.setBusinessDetails({ taxId: e.target.value })
      }),
      ...rest,
    }

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)} />
      )
    }

    return <input ref={forwardedRef} {...commonProps} />
  },
)

const BusinessDetails = {
  Root: BusinessDetailsRoot,
  Toggle: BusinessDetailsToggle,
  BusinessName: BusinessDetailsBusinessName,
  Country: BusinessDetailsCountry,
  TaxId: BusinessDetailsTaxId,
} as const

type SummaryRootProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean
  children?: React.ReactNode
}

const SummaryRoot = forwardRef<HTMLDivElement, SummaryRootProps>(function TopupFormSummaryRoot(
  { asChild, children, ...rest },
  forwardedRef,
) {
  useTopupCtx('Summary')
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-topup-form-summary="" {...rest}>
      {children}
    </Comp>
  )
})

type SummaryLeafProps = React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }

function useSummaryAmounts() {
  const ctx = useTopupCtx('Summary')
  const locale = useLocale()
  const currency = (ctx.taxBreakdown?.currency ?? ctx.currency ?? 'usd').toLowerCase()

  const subtotalMinor = ctx.taxBreakdown?.subtotal ?? ctx.amount
  const taxMinor = ctx.taxBreakdown?.taxAmount ?? 0
  const totalMinor = ctx.taxBreakdown?.total ?? ctx.amount

  return {
    subtotalFormatted: formatPrice(subtotalMinor, currency, { locale }),
    taxFormatted: formatPrice(taxMinor, currency, { locale }),
    totalFormatted: formatPrice(totalMinor, currency, { locale }),
    taxRate: ctx.taxBreakdown?.taxRate ?? null,
    treatment: ctx.taxBreakdown?.treatment ?? null,
    attaching: ctx.businessDetailsAttaching,
  }
}

const SummarySubtotal = forwardRef<HTMLSpanElement, SummaryLeafProps>(
  function TopupFormSummarySubtotal({ asChild, children, ...rest }, forwardedRef) {
    const { subtotalFormatted } = useSummaryAmounts()
    const Comp = asChild ? Slot : 'span'
    return (
      <Comp ref={forwardedRef} data-solvapay-topup-form-summary-subtotal="" {...rest}>
        {children ?? subtotalFormatted}
      </Comp>
    )
  },
)

const SummaryTax = forwardRef<HTMLSpanElement, SummaryLeafProps>(function TopupFormSummaryTax(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const { taxFormatted, taxRate, treatment } = useSummaryAmounts()
  const Comp = asChild ? Slot : 'span'
  const defaultLabel =
    treatment === 'reverse_charge'
      ? `VAT reverse charge (${taxFormatted})`
      : taxRate != null
        ? `Tax (${Math.round(taxRate * 100)}%)`
        : 'Tax'
  return (
    <Comp ref={forwardedRef} data-solvapay-topup-form-summary-tax="" {...rest}>
      {children ?? (
        <>
          <span>{defaultLabel}</span>{' '}
          <span data-solvapay-topup-form-summary-tax-amount="">{taxFormatted}</span>
        </>
      )}
    </Comp>
  )
})

const SummaryTotal = forwardRef<HTMLSpanElement, SummaryLeafProps>(function TopupFormSummaryTotal(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const { totalFormatted } = useSummaryAmounts()
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-topup-form-summary-total="" {...rest}>
      {children ?? totalFormatted}
    </Comp>
  )
})

const Summary = {
  Root: SummaryRoot,
  Subtotal: SummarySubtotal,
  Tax: SummaryTax,
  Total: SummaryTotal,
} as const

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
