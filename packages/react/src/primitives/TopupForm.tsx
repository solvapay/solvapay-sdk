'use client'

/**
 * TopupForm compound primitive.
 *
 * Wraps `useTopup` + the vault `CardFields` to run a one-shot credit
 * top-up, confirmed server-side. Unlike `PaymentForm`, no purchase
 * reconciliation is needed — `processTopupPayment` waits for the credit
 * booking, then `onSuccess` fires.
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
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { AmountPicker as AmountPickerPrimitive } from './AmountPicker'
import { LegalFooter } from './LegalFooter'
import { composeRefs } from './composeRefs'
import { useAppearance } from './useAppearance'
import { useTopup } from '../hooks/useTopup'
import { useCopy } from '../hooks/useCopy'
import { Spinner } from '../components/Spinner'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import {
  isCustomerAddressComplete,
  type BusinessDetailsInput,
  type TaxBreakdown,
} from '@solvapay/core'
import { confirmVaultPayment } from '../utils/confirmPayment'
import { buildBillingDetails } from '../utils/billingDetails'
import { useCustomer } from '../hooks/useCustomer'
import { useCanOpenExternal, useOpenExternal } from '../hooks/useExternalLink'
import { AUTHENTICATION_WAIT_ATTEMPTS } from './authenticationWait'
import type {
  Appearance,
  SolvaPayContextValue,
  SucceededPayment,
  TopupFormProps,
  VaultInfo,
} from '../types'
import { VaultCardFields, type CardCapture, type CardFieldsProps } from '../vault/CardFields'
import {
  buildPaymentReturnUrl,
  readPaymentReturn,
  rememberPaymentReturn,
  stripPaymentReturnParams,
  takePaymentReturn,
  type PaymentReturn,
} from './paymentReturn'
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
  paymentIntentId: string | null
  vault: VaultInfo | null
  appearance?: Appearance
  processorPaymentId: string | null
  isReady: boolean
  isProcessing: boolean
  paymentInputComplete: boolean
  canSubmit: boolean
  error: string | null
  /** What the payer is told while the top-up settles; rendered by `TopupForm.Notice`, not a failure. */
  notice: string | null
  returnUrl: string
  businessDetails: BusinessDetailsInput
  taxBreakdown: TaxBreakdown | null
  businessDetailsAttached: boolean
  businessDetailsAttaching: boolean
  businessDetailsError: string | null
  fieldErrors: Partial<Record<keyof BusinessDetailsInput, string>>
  setBusinessDetails: (patch: Partial<BusinessDetailsInput>) => void
  setPaymentInputComplete: (complete: boolean) => void
  /** `CardFields` registers the capture function here. */
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

  // `processTopupPayment` gates `onSuccess` on the backend booking the
  // credit. Optional — transports that don't implement it keep the legacy
  // fire-on-confirm behaviour.
  const {
    processTopupPayment,
    attachBusinessDetails,
    customerRef,
    createCaptureGrant,
    confirmPayment: confirmPaymentTransport,
  } = solva

  const copy = useCopy()
  const {
    loading,
    error: topupError,
    processorPaymentId,
    paymentIntentId,
    vault,
    startTopup,
  } = useTopup({
    amount,
    currency,
    autoRecharge,
  })

  const hasInitializedRef = useRef(false)
  const hasAmount = amount > 0

  // A 3DS return names the top-up the payer left for: that payment is
  // reconciled and no new one is created.
  const [paymentReturn] = useState<PaymentReturn | null>(() =>
    typeof window === 'undefined' ? null : (readPaymentReturn(window.location.search) ?? null),
  )

  useEffect(() => {
    if (paymentReturn) return
    if (!hasInitializedRef.current && hasAmount && !loading && !topupError && !paymentIntentId) {
      hasInitializedRef.current = true
      startTopup().catch(error => {
        console.error('[TopupForm] startTopup failed', error)
        hasInitializedRef.current = false
      })
    }
    if (hasAmount && paymentIntentId) hasInitializedRef.current = true
  }, [hasAmount, loading, topupError, paymentIntentId, startTopup, paymentReturn])

  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const attachRoot = useCallback((node: HTMLElement | null) => {
    if (!node) return
    setRootEl(prev => (prev === node ? prev : node))
  }, [])
  const resolvedAppearance = useAppearance(rootEl, appearance)

  const outerError = paymentReturn
    ? null
    : !hasAmount
      ? copy.errors.configMissingAmount
      : topupError
        ? `${copy.errors.topupInitFailed} ${topupError.message || copy.errors.unknownError}`
        : null

  const intentReady = !!paymentIntentId && !!vault
  const dataState: TopupFormState = outerError
    ? 'error'
    : intentReady || paymentReturn
      ? 'ready'
      : 'loading'

  // Owned on Root so country/state/postal survive the OfflineInner → Inner
  // swap when the PaymentIntent arrives. OfflineInner used to no-op
  // `setBusinessDetails`, which dropped the buyer country before attach.
  const businessAttach = useBusinessDetailsAttach({
    // No rail payment exists before confirm; the backend resolves the SolvaPay id.
    processorPaymentId: paymentIntentId,
    attachBusinessDetails,
    customerRef,
    onTaxChange,
  })

  const innerCommon = {
    amount,
    currency,
    paymentIntentId,
    vault: intentReady ? vault : null,
    appearance: resolvedAppearance,
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
    if (paymentReturn) {
      return (
        <ReturnInner {...innerCommon} paymentReturn={paymentReturn}>
          {slotted}
        </ReturnInner>
      )
    }
    if (intentReady) {
      return <Inner {...innerCommon}>{slotted}</Inner>
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
      {paymentReturn ? (
        <ReturnInner {...innerCommon} paymentReturn={paymentReturn}>
          {children}
        </ReturnInner>
      ) : intentReady ? (
        <Inner {...innerCommon}>{children}</Inner>
      ) : (
        <OfflineInner {...innerCommon}>{children}</OfflineInner>
      )}
    </section>
  )
})

type InnerProps = {
  amount: number
  currency?: string
  paymentIntentId: string | null
  vault: VaultInfo | null
  appearance?: Appearance
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
   * fire-on-confirm behaviour.
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
  createCaptureGrant: SolvaPayContextValue['createCaptureGrant']
  confirmPaymentTransport: SolvaPayContextValue['confirmPayment']
  businessAttach: UseBusinessDetailsAttachReturn
  children?: React.ReactNode
}

type TopupSettlement =
  | { status: 'succeeded'; creditsAdded?: number }
  | { status: 'processing' }
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }

/**
 * Ask the backend to process the top-up (it waits for the credit booking).
 * Without `processTopupPayment` the confirm alone is the settlement.
 */
async function settleTopup(
  processTopupPayment: InnerProps['processTopupPayment'],
  railPaymentId: string,
): Promise<TopupSettlement> {
  if (!processTopupPayment) return { status: 'succeeded' }
  return processTopupPayment({ paymentIntentId: railPaymentId })
}

const Inner: React.FC<InnerProps> = ({
  amount,
  currency,
  paymentIntentId,
  vault,
  appearance,
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
  children,
}) => {
  const copy = useCopy()
  const customer = useCustomer()
  const openExternal = useOpenExternal()
  const canOpenExternal = useCanOpenExternal()

  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [cardCapture, setCardCapture] = useState<CardCapture | null>(null)
  const setCardCaptureStable = useCallback((capture: CardCapture | null) => {
    setCardCapture(() => capture)
  }, [])
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Settle a confirmed top-up once: a booked credit fires `onSuccess`; one
   * the backend still reports processing leaves the pending notice; a
   * failed or cancelled one is an error. Returns the settlement status.
   */
  const finishConfirmed = useCallback(
    async (
      payment: SucceededPayment,
      railPaymentId: string,
    ): Promise<TopupSettlement['status']> => {
      let settlement: TopupSettlement
      try {
        settlement = await settleTopup(processTopupPayment, railPaymentId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setNotice(null)
        setError(msg)
        onError?.(err instanceof Error ? err : new Error(msg))
        return 'failed'
      }
      if (settlement.status === 'processing') {
        setNotice(copy.errors.paymentPending)
        return settlement.status
      }
      if (settlement.status === 'failed' || settlement.status === 'cancelled') {
        setNotice(null)
        setError(copy.errors.paymentUnexpected)
        onError?.(new Error(`Topup ${settlement.status}`))
        return settlement.status
      }
      // `succeeded`, or `timeout` (the rail confirmed; the credit lands with
      // the webhook and the purchase refetch converges on it).
      setNotice(null)
      await onSuccess?.(
        payment,
        settlement.status === 'succeeded' && settlement.creditsAdded !== undefined
          ? { creditsAdded: settlement.creditsAdded }
          : undefined,
      )
      return settlement.status
    },
    [processTopupPayment, copy, onSuccess, onError],
  )

  /**
   * The bank's page is open outside the form (an MCP host opened it): keep
   * the form mounted and follow the top-up through the backend until it
   * settles or the wait budget ends.
   */
  const awaitAuthentication = useCallback(
    async (payment: SucceededPayment, railPaymentId: string) => {
      setNotice(copy.errors.paymentAwaitingAuthentication)
      for (let attempt = 0; attempt < AUTHENTICATION_WAIT_ATTEMPTS; attempt++) {
        let settlement: TopupSettlement
        try {
          settlement = await settleTopup(processTopupPayment, railPaymentId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setNotice(null)
          setError(msg)
          onError?.(err instanceof Error ? err : new Error(msg))
          return
        }
        if (settlement.status === 'succeeded') {
          setNotice(null)
          await onSuccess?.(
            payment,
            settlement.creditsAdded !== undefined
              ? { creditsAdded: settlement.creditsAdded }
              : undefined,
          )
          return
        }
        if (settlement.status === 'failed' || settlement.status === 'cancelled') {
          setNotice(null)
          setError(copy.errors.paymentUnexpected)
          onError?.(new Error(`Topup ${settlement.status}`))
          return
        }
        // processing | timeout: the payer is still with the bank.
      }
      setNotice(null)
      const timedOut = new Error(copy.errors.paymentAuthenticationTimedOut)
      setError(timedOut.message)
      onError?.(timedOut)
    },
    [processTopupPayment, copy, onSuccess, onError],
  )

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

  const isReady = !!paymentIntentId
  const paymentSourceReady = !!cardCapture
  const canSubmit =
    isReady &&
    paymentInputComplete &&
    !isProcessing &&
    paymentSourceReady &&
    (!requiresBusinessAttach || businessDetailsAttached) &&
    isCustomerAddressComplete(businessDetails) &&
    !businessDetailsAttaching

  const submit = useCallback(async () => {
    if (!paymentIntentId || !cardCapture) {
      const msg = !paymentIntentId
        ? copy.errors.paymentIntentUnavailable
        : copy.errors.cardFieldsMissing
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
    setNotice(null)
    setIsProcessing(true)
    try {
      const result = await confirmVaultPayment({
        paymentIntentId,
        capture: cardCapture,
        createCaptureGrant,
        confirmPayment: confirmPaymentTransport,
        returnUrl: buildPaymentReturnUrl(returnUrl, { paymentIntentId }),
        billingDetails: buildBillingDetails({
          name: customer.name,
          email: customer.email,
          businessDetails,
        }),
        copy,
      })
      if (result.status === 'error') {
        setError(result.message)
        onError?.(new Error(result.message))
        return
      }
      if (result.status === 'requires_action') {
        // The bank needs the payer. Inside an MCP host the host opens the
        // page and the form follows the top-up here; otherwise the browser
        // navigates and the return path reconciles the remembered payment.
        rememberPaymentReturn({
          paymentIntentId,
          processorPaymentId: result.payment.processorPaymentId,
        })
        if (canOpenExternal) {
          const opened = await openExternal(result.redirectUrl)
          if (!opened) {
            const msg = copy.errors.authenticationUnavailable
            setError(msg)
            onError?.(new Error(msg))
            return
          }
          await awaitAuthentication(result.payment, result.payment.processorPaymentId)
          return
        }
        window.location.assign(result.redirectUrl)
        return
      }
      if (result.status === 'other') {
        setError(result.message)
        onError?.(new Error(result.message))
        return
      }
      // `succeeded` and `pending` both go through the backend: a pending
      // top-up is followed, not failed.
      await finishConfirmed(result.payment, result.payment.processorPaymentId)
    } finally {
      setIsProcessing(false)
    }
  }, [
    paymentIntentId,
    cardCapture,
    createCaptureGrant,
    confirmPaymentTransport,
    finishConfirmed,
    awaitAuthentication,
    openExternal,
    canOpenExternal,
    returnUrl,
    copy,
    onError,
    requiresBusinessAttach,
    businessDetailsAttached,
    runAttach,
    businessDetails,
    businessDetailsError,
    customer.name,
    customer.email,
  ])

  const effectiveError = error ?? outerError ?? businessDetailsError

  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      paymentIntentId,
      vault,
      appearance,
      processorPaymentId,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      error: effectiveError,
      notice,
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
      paymentIntentId,
      vault,
      appearance,
      processorPaymentId,
      isReady,
      isProcessing,
      paymentInputComplete,
      canSubmit,
      effectiveError,
      notice,
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

/**
 * The payer is back from the bank (`solvapay_payment` in the URL): settle
 * the top-up they left for, with the rail reference the form remembered
 * before the redirect. No new payment is created; a return without a
 * remembered record is reported as unresolved.
 */
const ReturnInner: React.FC<InnerProps & { paymentReturn: PaymentReturn }> = ({
  amount,
  currency,
  appearance,
  returnUrl,
  state,
  onSuccess,
  onError,
  processTopupPayment,
  businessAttach,
  paymentReturn,
  children,
}) => {
  const copy = useCopy()
  const [isProcessing, setIsProcessing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [processorPaymentId, setProcessorPaymentId] = useState<string | null>(null)
  const started = useRef(false)
  const noopSubmit = useCallback(async () => {}, [])
  const noopSet = useCallback(() => {}, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    stripPaymentReturnParams()
    const record = takePaymentReturn(paymentReturn.paymentIntentId)
    void (async () => {
      try {
        if (!record) {
          const unresolved = new Error(copy.errors.paymentReturnUnresolved)
          setError(unresolved.message)
          onError?.(unresolved)
          return
        }
        setProcessorPaymentId(record.processorPaymentId)
        let settlement: TopupSettlement
        try {
          settlement = await settleTopup(processTopupPayment, record.processorPaymentId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          onError?.(err instanceof Error ? err : new Error(msg))
          return
        }
        if (settlement.status === 'processing') {
          setNotice(copy.errors.paymentPending)
          return
        }
        if (settlement.status === 'failed' || settlement.status === 'cancelled') {
          setError(copy.errors.paymentUnexpected)
          onError?.(new Error(`Topup ${settlement.status}`))
          return
        }
        await onSuccess?.(
          {
            id: record.paymentIntentId,
            processorPaymentId: record.processorPaymentId,
            status: 'succeeded',
          },
          settlement.status === 'succeeded' && settlement.creditsAdded !== undefined
            ? { creditsAdded: settlement.creditsAdded }
            : undefined,
        )
      } finally {
        setIsProcessing(false)
      }
    })()
  }, [paymentReturn, processTopupPayment, copy, onSuccess, onError])

  const ctx = useMemo<TopupFormContextValue>(
    () => ({
      amount,
      currency,
      state,
      paymentIntentId: paymentReturn.paymentIntentId,
      vault: null,
      appearance,
      processorPaymentId,
      isReady: false,
      isProcessing,
      paymentInputComplete: false,
      canSubmit: false,
      error,
      notice,
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
      paymentReturn,
      appearance,
      processorPaymentId,
      isProcessing,
      error,
      notice,
      returnUrl,
      businessAttach,
      noopSet,
      noopSubmit,
    ],
  )
  return <TopupFormContext.Provider value={ctx}>{children}</TopupFormContext.Provider>
}

/** Pre-intent context so leaves render (disabled) during initial load. */
const OfflineInner: React.FC<InnerProps> = ({
  amount,
  currency,
  paymentIntentId,
  vault,
  appearance,
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
      paymentIntentId,
      vault,
      appearance,
      processorPaymentId,
      isReady: false,
      isProcessing: false,
      paymentInputComplete: false,
      canSubmit: false,
      error: outerError,
      notice: null,
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
      paymentIntentId,
      vault,
      appearance,
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

type NoticeSlotProps = React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }

/** What the payer is told while the top-up settles. Not an error; `role="status"`. */
const NoticeSlot = forwardRef<HTMLParagraphElement, NoticeSlotProps>(function TopupFormNotice(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useTopupCtx('Notice')
  if (!ctx.notice) return null
  if (asChild) {
    return (
      <Slot
        ref={forwardedRef as React.Ref<HTMLElement>}
        role="status"
        aria-live="polite"
        data-solvapay-topup-form-notice=""
        {...rest}
      >
        {children ?? ctx.notice}
      </Slot>
    )
  }
  return (
    <p
      ref={forwardedRef}
      role="status"
      aria-live="polite"
      data-solvapay-topup-form-notice=""
      {...rest}
    >
      {children ?? ctx.notice}
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
/** Card entry for top-ups; see `PaymentForm.CardFields`. Renders nothing until the intent exists. */
const CardFieldsSlot = forwardRef<HTMLElement, CardFieldsProps>(
  function TopupFormCardFields(props, ref) {
    const { vault, paymentIntentId, appearance, setCardCapture, setPaymentInputComplete } =
      useTopupCtx('CardFields')
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
  },
)

export const TopupFormCardFields = CardFieldsSlot
export const TopupFormSubmitButton = SubmitButton
export const TopupFormLoading = Loading
export const TopupFormError = ErrorSlot
export const TopupFormNotice = NoticeSlot
export const TopupFormLegalFooter = LegalFooter
export const TopupFormBusinessDetails = BusinessDetails
export const TopupFormSummary = Summary

export const TopupForm = {
  Root,
  AmountPicker: AmountPickerPrimitive.Root,
  CardFields: CardFieldsSlot,
  BusinessDetails,
  Summary,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
  Notice: NoticeSlot,
  LegalFooter,
} as const

export function useTopupForm(): TopupFormContextValue {
  return useTopupCtx('useTopupForm')
}
