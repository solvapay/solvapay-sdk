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
import type { Appearance, Stripe, StripeElements } from '@stripe/stripe-js'
import { toStripeElementLocale } from '../utils/stripeLocale'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { AmountPicker as AmountPickerPrimitive } from './AmountPicker'
import { LegalFooter } from './LegalFooter'
import { composeRefs } from './composeRefs'
import { withPaymentElementDefaults } from './paymentElementDefaults'
import { useStripeAppearance } from './useStripeAppearance'
import { useTopup } from '../hooks/useTopup'
import { useCopy, useLocale } from '../hooks/useCopy'
import { Spinner } from '../components/Spinner'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import {
  isCustomerAddressComplete,
  resolveBuyerCountry,
  type BusinessDetailsInput,
  type TaxBreakdown,
} from '@solvapay/core'
import { useCustomer } from '../hooks/useCustomer'
import {
  buildConfirmBillingDetails,
  confirmPayment,
  confirmVaultPayment,
} from '../utils/confirmPayment'
import type { CaptureMode, SolvaPayContextValue, SucceededPayment, TopupFormProps, VaultInfo } from '../types'
import { VaultCardFields, type CardCapture, type CardFieldsProps } from '../vault/CardFields'
import {
  readPaymentIntentClientSecret,
  readPaymentIntentId,
  stripPaymentIntentParams,
} from './paymentIntentReturn'
import {
  useBusinessDetailsAttach,
  type UseBusinessDetailsAttachReturn,
} from '../hooks/useBusinessDetailsAttach'
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
  captureMode: CaptureMode
  paymentIntentId: string | null
  vault: VaultInfo | null
  appearance?: Appearance
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
  /** Vault mode only: `CardFields` registers the capture function here. */
  setCardCapture: (capture: CardCapture | null) => void
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

type RootProps = TopupFormProps &
  Omit<React.ComponentPropsWithoutRef<'section'>, keyof TopupFormProps | 'children'> & {
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
    appearance,
    className,
    asChild,
    children,
    ...rest
  } = props

  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('TopupForm')

  // Pulled here so the Stripe-confirm-to-webhook race fix (gating
  // `onSuccess` on backend confirmation) lives next to the existing
  // provider-context read. Optional — transports that don't implement
  // it keep the legacy fire-on-confirm behaviour.
  const {
    processTopupPayment,
    attachBusinessDetails,
    customerRef,
    createCaptureGrant,
    confirmPayment: confirmPaymentTransport,
  } = solva

  const copy = useCopy()
  const locale = useLocale()
  const {
    loading,
    error: topupError,
    clientSecret,
    processorPaymentId,
    paymentIntentId,
    captureMode,
    vault,
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
    if (
      !hasInitializedRef.current &&
      hasAmount &&
      !loading &&
      !topupError &&
      !clientSecret &&
      !paymentIntentId
    ) {
      hasInitializedRef.current = true
      startTopup().catch(error => {
        console.error('[TopupForm] startTopup failed', error)
        hasInitializedRef.current = false
      })
    }
    if (hasAmount && (clientSecret || paymentIntentId)) hasInitializedRef.current = true
  }, [hasAmount, loading, topupError, clientSecret, paymentIntentId, startTopup])

  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const attachRoot = useCallback((node: HTMLElement | null) => {
    if (!node) return
    setRootEl(prev => (prev === node ? prev : node))
  }, [])
  const resolvedAppearance = useStripeAppearance(rootEl, appearance)

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return {
      clientSecret,
      locale: toStripeElementLocale(locale),
      ...(resolvedAppearance ? { appearance: resolvedAppearance } : {}),
    }
  }, [clientSecret, locale, resolvedAppearance])

  const outerError = !hasAmount
    ? copy.errors.configMissingAmount
    : topupError
      ? `${copy.errors.topupInitFailed} ${topupError.message || copy.errors.unknownError}`
      : null

  const isVault = captureMode === 'vault' && !!paymentIntentId && !!vault
  const dataState: TopupFormState = outerError
    ? 'error'
    : (clientSecret && stripePromise) || isVault
      ? 'ready'
      : 'loading'

  const appearanceReady = appearance !== undefined || rootEl !== null
  const canMountElements = !!(
    stripePromise &&
    clientSecret &&
    elementsOptions &&
    appearanceReady
  )

  // Owned on Root so country/state/postal survive the OfflineInner → Inner
  // swap when the PaymentIntent arrives. OfflineInner used to no-op
  // `setBusinessDetails`, which dropped the buyer country before attach.
  const businessAttach = useBusinessDetailsAttach({
    // Vault mode has no rail payment yet; the backend resolves the SolvaPay id.
    processorPaymentId: isVault ? paymentIntentId : processorPaymentId,
    attachBusinessDetails,
    customerRef,
    onTaxChange,
  })

  const innerCommon = {
    amount,
    currency,
    captureMode: (isVault ? 'vault' : 'processor_elements') as CaptureMode,
    paymentIntentId,
    vault: isVault ? vault : null,
    appearance: resolvedAppearance,
    clientSecret,
    processorPaymentId,
    returnUrl: finalReturnUrl,
    outerError,
    state: dataState,
    onSuccess,
    onError,
    processTopupPayment,
    createCaptureGrant,
    confirmPaymentTransport,
    businessAttach,
  }

  const rootRef = composeRefs(forwardedRef as React.Ref<HTMLElement>, attachRoot)

  if (asChild) {
    const slotted = (
      <Slot
        ref={rootRef}
        className={className}
        data-solvapay-topup-form=""
        data-state={dataState}
        {...rest}
      >
        {children}
      </Slot>
    )
    if (isVault) {
      return (
        <Inner {...innerCommon} stripe={null} elements={null}>
          {slotted}
        </Inner>
      )
    }
    if (canMountElements) {
      return (
        <Elements key={clientSecret} stripe={stripePromise} options={elementsOptions}>
          <ElementsInner {...innerCommon}>{slotted}</ElementsInner>
        </Elements>
      )
    }
    return <OfflineInner {...innerCommon}>{slotted}</OfflineInner>
  }

  return (
    <section
      ref={rootRef}
      className={className}
      data-solvapay-topup-form=""
      data-state={dataState}
      {...rest}
    >
      {isVault ? (
        <Inner {...innerCommon} stripe={null} elements={null}>
          {children}
        </Inner>
      ) : canMountElements ? (
        <Elements key={clientSecret} stripe={stripePromise} options={elementsOptions}>
          <ElementsInner {...innerCommon}>{children}</ElementsInner>
        </Elements>
      ) : (
        <OfflineInner {...innerCommon}>{children}</OfflineInner>
      )}
    </section>
  )
})

type InnerProps = {
  amount: number
  currency?: string
  captureMode: CaptureMode
  paymentIntentId: string | null
  vault: VaultInfo | null
  appearance?: Appearance
  clientSecret: string | null
  processorPaymentId: string | null
  returnUrl: string
  outerError: string | null
  state: TopupFormState
  onSuccess?: TopupFormProps['onSuccess']
  onError?: TopupFormProps['onError']
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
    | { status: 'processing' }
    | { status: 'timeout'; message?: string }
    | { status: 'failed' }
    | { status: 'cancelled' }
  >
  createCaptureGrant?: SolvaPayContextValue['createCaptureGrant']
  confirmPaymentTransport?: SolvaPayContextValue['confirmPayment']
  businessAttach: UseBusinessDetailsAttachReturn
  children?: React.ReactNode
}

/** `processor_elements` shell: reads Stripe from the surrounding `<Elements>`. */
const ElementsInner: React.FC<InnerProps> = props => {
  const stripe = useStripe()
  const elements = useElements()
  return <Inner {...props} stripe={stripe} elements={elements} />
}

const Inner: React.FC<InnerProps & { stripe: Stripe | null; elements: StripeElements | null }> = ({
  amount,
  currency,
  captureMode,
  paymentIntentId,
  vault,
  appearance,
  clientSecret,
  processorPaymentId,
  returnUrl,
  outerError,
  state,
  onSuccess,
  onError,
  processTopupPayment,
  createCaptureGrant,
  confirmPaymentTransport,
  businessAttach,
  stripe,
  elements,
  children,
}) => {
  const isVault = captureMode === 'vault'
  const stripeAvailable = !!stripe
  const stripeRef = useRef(stripe)
  const copy = useCopy()
  const customer = useCustomer()

  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [cardCapture, setCardCapture] = useState<CardCapture | null>(null)
  const setCardCaptureStable = useCallback((capture: CardCapture | null) => {
    setCardCapture(() => capture)
  }, [])
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const returnResumeStarted = useRef(false)

  useEffect(() => {
    stripeRef.current = stripe
  })

  /** Vault mode: wait for the backend to book the credit, then fire `onSuccess`. */
  const finishVaultTopup = useCallback(
    async (payment: SucceededPayment, railPaymentId: string) => {
      let creditsAdded: number | undefined
      if (processTopupPayment) {
        try {
          const result = await processTopupPayment({ paymentIntentId: railPaymentId })
          if (result.status === 'processing') {
            setError(copy.errors.paymentPending)
            return
          }
          if (result.status === 'failed' || result.status === 'cancelled') {
            setError(copy.errors.paymentUnexpected)
            onError?.(new Error(`Topup ${result.status}`))
            return
          }
          if (result.status === 'succeeded' && typeof result.creditsAdded === 'number') {
            creditsAdded = result.creditsAdded
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          onError?.(err instanceof Error ? err : new Error(msg))
          return
        }
      }
      await onSuccess?.(payment, creditsAdded !== undefined ? { creditsAdded } : undefined)
    },
    [processTopupPayment, copy, onSuccess, onError],
  )

  // Vault return path: after 3DS the rail sends the payer back with
  // `payment_intent` in the URL; there is no Stripe.js to resume with.
  useEffect(() => {
    if (!isVault || returnResumeStarted.current || typeof window === 'undefined') return
    const railPaymentId = readPaymentIntentId(window.location.search)
    if (!railPaymentId) return
    returnResumeStarted.current = true
    let cancelled = false
    void (async () => {
      setIsProcessing(true)
      setError(null)
      stripPaymentIntentParams()
      try {
        if (cancelled) return
        await finishVaultTopup(
          { id: paymentIntentId ?? railPaymentId, processorPaymentId: railPaymentId, status: 'succeeded' },
          railPaymentId,
        )
      } finally {
        if (!cancelled) setIsProcessing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isVault, paymentIntentId, finishVaultTopup])

  useEffect(() => {
    const stripeApi = stripeRef.current
    if (!stripeAvailable || !stripeApi || returnResumeStarted.current || typeof window === 'undefined') {
      return
    }
    const returnClientSecret = readPaymentIntentClientSecret(window.location.search)
    if (!returnClientSecret) return
    returnResumeStarted.current = true

    let cancelled = false
    void (async () => {
      setIsProcessing(true)
      setError(null)

      const retrieved = await stripeApi.retrievePaymentIntent(returnClientSecret)
      if (cancelled) return
      stripPaymentIntentParams()

      if (retrieved.error || !retrieved.paymentIntent) {
        setError(copy.errors.paymentUnexpected)
        setIsProcessing(false)
        return
      }

      let paymentIntent = retrieved.paymentIntent
      if (paymentIntent.status === 'requires_action') {
        const actionResult = await stripeApi.handleNextAction({ clientSecret: returnClientSecret })
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
  }, [stripeAvailable, copy, processTopupPayment, onSuccess, onError])

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
  } = businessAttach

  const isReady = isVault ? !!paymentIntentId : !!(stripe && elements)
  const paymentSourceReady = isVault
    ? !!cardCapture && !!createCaptureGrant && !!confirmPaymentTransport
    : !!clientSecret
  const canSubmit =
    isReady &&
    paymentInputComplete &&
    !isProcessing &&
    paymentSourceReady &&
    (!requiresBusinessAttach || businessDetailsAttached) &&
    isCustomerAddressComplete(businessDetails) &&
    !businessDetailsAttaching

  const submit = useCallback(async () => {
    if (isVault) {
      if (!paymentIntentId || !cardCapture || !createCaptureGrant || !confirmPaymentTransport) {
        const msg = !paymentIntentId ? copy.errors.paymentIntentUnavailable : copy.errors.cardFieldsMissing
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
      try {
        const result = await confirmVaultPayment({
          paymentIntentId,
          capture: cardCapture,
          createCaptureGrant,
          confirmPayment: confirmPaymentTransport,
          returnUrl,
          copy,
        })
        if (result.status === 'error') {
          setError(result.message)
          onError?.(new Error(result.message))
          return
        }
        if (result.status === 'requires_action') {
          window.location.assign(result.redirectUrl)
          return
        }
        if (result.status === 'pending' || result.status === 'other') {
          setError(result.message)
          return
        }
        await finishVaultTopup(result.payment, result.payment.processorPaymentId)
      } finally {
        setIsProcessing(false)
      }
      return
    }

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

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret,
      returnUrl,
      billingDetails: buildConfirmBillingDetails({
        name: customer.name,
        email: customer.email,
        country: resolveBuyerCountry(businessDetails),
        state: businessDetails.customerState,
        postalCode: businessDetails.customerPostalCode,
      }),
      copy,
    })

    if (result.status === 'error' || result.status === 'requires_action' || result.status === 'other') {
      setError(result.message)
      setIsProcessing(false)
      if (result.status === 'error') {
        onError?.(new Error(result.message))
      }
      return
    }

    if (result.status === 'pending') {
      setError(result.message)
      setIsProcessing(false)
      return
    }

    const paymentIntent = result.paymentIntent

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
      await onSuccess?.(
        paymentIntent,
        creditsAdded !== undefined ? { creditsAdded } : undefined,
      )
    }
  }, [
    isVault,
    paymentIntentId,
    cardCapture,
    createCaptureGrant,
    confirmPaymentTransport,
    finishVaultTopup,
    stripe,
    elements,
    clientSecret,
    returnUrl,
    customer,
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
      captureMode,
      paymentIntentId,
      vault,
      appearance,
      clientSecret,
      processorPaymentId,
      stripe,
      elements,
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
      setCardCapture: setCardCaptureStable,
      submit,
    }),
    [
      amount,
      currency,
      state,
      captureMode,
      paymentIntentId,
      vault,
      appearance,
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
      setCardCaptureStable,
      submit,
    ],
  )

  return <TopupFormContext.Provider value={ctx}>{children}</TopupFormContext.Provider>
}

/** Pre-Elements context so leaves render (disabled) during initial load. */
const OfflineInner: React.FC<InnerProps> = ({
  amount,
  currency,
  captureMode,
  paymentIntentId,
  vault,
  appearance,
  clientSecret,
  processorPaymentId,
  returnUrl,
  outerError,
  state,
  businessAttach,
  children,
}) => {
  const noopSubmit = useCallback(async () => {}, [])
  const noopSet = useCallback(() => {}, [])
  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      captureMode,
      paymentIntentId,
      vault,
      appearance,
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
      businessDetails: businessAttach.businessDetails,
      taxBreakdown: businessAttach.taxBreakdown,
      businessDetailsAttached: businessAttach.businessDetailsAttached,
      businessDetailsAttaching: businessAttach.businessDetailsAttaching,
      businessDetailsError: businessAttach.businessDetailsError,
      fieldErrors: businessAttach.fieldErrors,
      setBusinessDetails: businessAttach.setBusinessDetails,
      setPaymentInputComplete: noopSet,
      setCardCapture: noopSet,
      submit: noopSubmit,
    }),
    [
      amount,
      currency,
      state,
      captureMode,
      paymentIntentId,
      vault,
      appearance,
      clientSecret,
      processorPaymentId,
      outerError,
      returnUrl,
      businessAttach,
      noopSet,
      noopSubmit,
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
        <Slot ref={forwardedRef as React.Ref<HTMLElement>} {...(commonProps as Record<string, unknown>)}>
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
    isBusiness: ctx.businessDetails.isBusiness,
  }
}

const BusinessDetails = createBusinessDetailsParts(useTopupBusinessCtx, 'topup-form')
const Summary = createTaxSummaryParts(useTopupSummaryCtx, 'topup-form')

export const TopupFormRoot = Root
/** Vault-mode card entry for top-ups; see `PaymentForm.CardFields`. Renders nothing in `processor_elements` mode. */
const CardFieldsSlot = forwardRef<HTMLElement, CardFieldsProps>(function TopupFormCardFields(props, ref) {
  const { captureMode, vault, paymentIntentId, appearance, setCardCapture, setPaymentInputComplete } =
    useTopupCtx('CardFields')
  if (captureMode !== 'vault') return null
  return (
    <VaultCardFields
      ref={ref}
      data-solvapay-topup-form-card-fields=""
      {...props}
      vault={vault}
      paymentIntentId={paymentIntentId}
      appearance={appearance}
      onCapture={setCardCapture}
      onComplete={setPaymentInputComplete}
    />
  )
})

export const TopupFormPaymentElement = PaymentElementSlot
export const TopupFormCardFields = CardFieldsSlot
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
  CardFields: CardFieldsSlot,
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
