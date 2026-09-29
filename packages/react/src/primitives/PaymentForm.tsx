'use client'

/**
 * PaymentForm compound primitive.
 *
 * Unstyled, accessible building blocks for running the paid OR free checkout
 * step inside a <SolvaPayProvider>. `Root` detects paid vs free plans via
 * `usePlan`, creates the payment intent for paid plans (card entry through
 * `PaymentForm.CardFields`, confirmed server-side), or falls through to
 * `useActivation` for free plans; both paths expose the same
 * `PaymentFormContext` so the same subcomponents compose identically in
 * either mode.
 *
 * Every leaf accepts `asChild` for Slot-style composition. The `SubmitButton`
 * emits `data-state=idle|processing|disabled` + `data-variant=paid|free|topup|activate`.
 */

import React, {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Slot } from './slot'
import { composeRefs } from './composeRefs'
import { composeEventHandlers } from './composeEventHandlers'
import { LegalFooter } from './LegalFooter'
import { useAppearance } from './useAppearance'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import { useCheckout } from '../hooks/useCheckout'
import { usePurchase } from '../hooks/usePurchase'
import { useSolvaPay } from '../hooks/useSolvaPay'
import { useCustomer } from '../hooks/useCustomer'
import { useCopy, useLocale } from '../hooks/useCopy'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useActivation } from '../hooks/useActivation'
import { usePlanSelection } from '../components/PlanSelectionContext'
import {
  PaymentFormProvider,
  usePaymentForm,
  type CardCapture,
  type PaymentFormContextValue,
  type PaymentElementKind,
} from '../components/PaymentFormContext'
import { CheckoutSummary as CheckoutSummaryShim } from '../components/CheckoutSummary'
import { MandateText as MandateTextShim } from '../components/MandateText'
import { Spinner } from '../components/Spinner'
import { confirmVaultPayment } from '../utils/confirmPayment'
import { reconcilePayment } from '../utils/processPaymentResult'
import { readPaymentIntentId, stripPaymentIntentParams } from './paymentIntentReturn'
import { VaultCardFields, type CardFieldsProps } from '../vault/CardFields'
import { normalizeOneTimePurchase } from '../utils/normalizePurchase'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import { resolveCta } from '../utils/checkoutCta'
import { formatPrice } from '../utils/format'
import {
  useBusinessDetailsAttach,
  defaultBusinessDetails,
} from '../hooks/useBusinessDetailsAttach'
import {
  createBusinessDetailsParts,
  createTaxSummaryParts,
} from '../components/businessCheckoutParts'
import type {
  ActivationResult,
  Appearance,
  PaymentFormProps,
  PaymentResult,
  PrefillCustomer,
  Plan,
  VaultInfo,
} from '../types'
import type { ActivatePlanResult } from '@solvapay/server'
import { isCustomerAddressComplete } from '@solvapay/core'

// ---------- helpers ----------

type SubmitDataVariant = 'paid' | 'free' | 'topup' | 'activate'

function toSubmitVariant(variant: CheckoutVariant): SubmitDataVariant {
  switch (variant) {
    case 'freeTier':
      return 'free'
    case 'topup':
      return 'topup'
    case 'usageMetered':
      return 'activate'
    default:
      return 'paid'
  }
}

// ---------- Root ----------

type PaymentFormRootProps = PaymentFormProps & {
  prefillCustomer?: PrefillCustomer
  requireTermsAcceptance?: boolean
  children?: React.ReactNode
}

const Root = forwardRef<HTMLElement, PaymentFormRootProps>(
  function PaymentFormRoot(props, forwardedRef) {
    const {
      planRef,
      productRef,
      onSuccess,
      onResult,
      onFreePlan,
      onError,
      returnUrl,
      submitButtonText,
      className,
      buttonClassName,
      prefillCustomer,
      requireTermsAcceptance = false,
      appearance,
      children,
    } = props

    const solva = useContext(SolvaPayContext)
    if (!solva) throw new MissingProviderError('PaymentForm')

    const { attachBusinessDetails, customerRef } = solva

    const copy = useCopy()
    const planSelection = usePlanSelection()
    const effectivePlanRef = planRef ?? planSelection?.selectedPlanRef ?? undefined
    const effectiveProductRef = productRef ?? planSelection?.productRef

    const { plan: resolvedPlan } = usePlan({
      planRef: effectivePlanRef,
      productRef: effectiveProductRef,
    })
    const isFreePlan = resolvedPlan?.requiresPayment === false

    const {
      loading: checkoutLoading,
      error: checkoutError,
      processorPaymentId,
      paymentIntentId,
      vault,
      startCheckout,
      resolvedPlanRef,
    } = useCheckout({
      planRef: effectivePlanRef,
      productRef: effectiveProductRef,
      customer: prefillCustomer,
    })

    const hasInitializedRef = useRef(false)
    const hasPlanOrProduct = !!(effectivePlanRef || effectiveProductRef)

    useEffect(() => {
      if (isFreePlan) return
      if (
        !hasInitializedRef.current &&
        hasPlanOrProduct &&
        !checkoutLoading &&
        !checkoutError &&
        !paymentIntentId
      ) {
        hasInitializedRef.current = true
        startCheckout().catch(error => {
          console.error('[PaymentForm] startCheckout failed', error)
          hasInitializedRef.current = false
        })
      }
      if (hasPlanOrProduct && paymentIntentId) {
        hasInitializedRef.current = true
      }
    }, [
      hasPlanOrProduct,
      checkoutLoading,
      checkoutError,
      paymentIntentId,
      startCheckout,
      isFreePlan,
    ])

    const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

    const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
    const attachRoot = useCallback((node: HTMLElement | null) => {
      if (!node) return
      setRootEl(prev => (prev === node ? prev : node))
    }, [])
    const sectionRef = composeRefs(forwardedRef, attachRoot)
    const resolvedAppearance = useAppearance(rootEl, appearance)

    // The card goes into the vault through `PaymentForm.CardFields` and the
    // payment is confirmed server-side.
    const paidReady = !!paymentIntentId && !!vault

    const dataState = !hasPlanOrProduct || checkoutError
      ? 'error'
      : isFreePlan && resolvedPlan
        ? 'ready'
        : paidReady
          ? 'ready'
          : 'loading'
    const dataVariant = isFreePlan && resolvedPlan ? 'free' : paidReady ? 'paid' : undefined

    const pending = (
      <PendingInner
        planRef={effectivePlanRef}
        productRef={effectiveProductRef}
        resolvedPlanRef={resolvedPlanRef}
        plan={resolvedPlan ?? null}
        returnUrl={finalReturnUrl}
        submitButtonText={submitButtonText}
        buttonClassName={buttonClassName}
        error={
          checkoutError
            ? `${copy.errors.paymentInitFailed} ${checkoutError.message || copy.errors.unknownError}`
            : null
        }
      >
        {children}
      </PendingInner>
    )

    return (
      <section
        ref={sectionRef}
        className={className}
        data-solvapay-payment-form=""
        data-state={dataState}
        {...(dataVariant ? { 'data-variant': dataVariant } : {})}
      >
        {!hasPlanOrProduct ? (
          <p role="alert" data-solvapay-payment-form-error="">
            {copy.errors.configMissingPlanOrProduct}
          </p>
        ) : checkoutError ? (
          pending
        ) : isFreePlan && resolvedPlan ? (
          <FreeInner
            planRef={effectivePlanRef}
            productRef={effectiveProductRef}
            plan={resolvedPlan}
            resolvedPlanRef={resolvedPlanRef}
            requireTermsAcceptance={requireTermsAcceptance}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            onFreePlan={onFreePlan}
            onResult={onResult}
            onError={onError}
          >
            {children}
          </FreeInner>
        ) : paidReady && vault && paymentIntentId ? (
          <PaidBody
            planRef={effectivePlanRef}
            productRef={effectiveProductRef}
            prefillCustomer={prefillCustomer}
            resolvedPlanRef={resolvedPlanRef}
            plan={resolvedPlan ?? null}
            paymentIntentId={paymentIntentId}
            vault={vault}
            appearance={resolvedAppearance}
            processorPaymentId={processorPaymentId}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            requireTermsAcceptance={requireTermsAcceptance}
            onSuccess={onSuccess}
            onResult={onResult}
            onError={onError}
            onTaxChange={props.onTaxChange}
            attachBusinessDetails={attachBusinessDetails}
            customerRef={customerRef}
          >
            {children}
          </PaidBody>
        ) : (
          pending
        )}
      </section>
    )
  },
)

// ---------- Paid inner ----------

type PaidBodyProps = {
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  paymentIntentId: string
  vault: VaultInfo
  appearance?: Appearance
  processorPaymentId: string | null
  returnUrl: string
  submitButtonText?: string
  buttonClassName?: string
  requireTermsAcceptance: boolean
  onSuccess?: PaymentFormProps['onSuccess']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
  onTaxChange?: PaymentFormProps['onTaxChange']
  attachBusinessDetails?: import('../hooks/useBusinessDetailsAttach').AttachBusinessDetailsFn
  customerRef?: string
  children?: React.ReactNode
}

const PaidBody: React.FC<PaidBodyProps> = ({
  planRef,
  productRef,
  prefillCustomer,
  resolvedPlanRef,
  plan,
  paymentIntentId,
  vault,
  appearance,
  processorPaymentId,
  returnUrl,
  submitButtonText,
  buttonClassName,
  requireTermsAcceptance,
  onSuccess,
  onResult,
  onError,
  onTaxChange,
  attachBusinessDetails,
  customerRef,
  children,
}) => {
  const copy = useCopy()
  const {
    processPayment,
    upsertPurchase,
    createCaptureGrant,
    confirmPayment: confirmPaymentTransport,
  } = useSolvaPay()
  const { refetch } = usePurchase()

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
    // No rail payment exists before confirm; the backend resolves the SolvaPay id.
    processorPaymentId: paymentIntentId,
    attachBusinessDetails,
    customerRef,
    onTaxChange,
  })

  const [elementKind, setElementKind] = useState<PaymentElementKind>(
    children ? null : 'card-fields',
  )
  const [cardCapture, setCardCapture] = useState<CardCapture | null>(null)
  const setCardCaptureStable = useCallback((capture: CardCapture | null) => {
    setCardCapture(() => capture)
  }, [])
  const [customerName, setCustomerName] = useState('')
  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const returnResumeStarted = useRef(false)

  const finishSucceeded = useCallback(
    async (paymentIntent: Parameters<NonNullable<PaymentFormProps['onSuccess']>>[0], railPaymentId: string) => {
      const reconcileResult = await reconcilePayment({
        paymentIntentId: railPaymentId,
        productRef,
        planRef: planRef || resolvedPlanRef || undefined,
        processPayment,
        refetchPurchase: refetch,
        copy,
      })
      if (reconcileResult.status === 'success') {
        const r = reconcileResult.result
        if (r && 'type' in r && r.type === 'recurring') {
          upsertPurchase(r.purchase)
        } else if (r && 'type' in r && r.type === 'one-time') {
          upsertPurchase(normalizeOneTimePurchase(r.oneTimePurchase))
        } else {
          try {
            await refetch()
          } catch (error) {
            console.error('[PaymentForm] secondary purchase refetch failed after submit success', error)
          }
        }
        onSuccess?.(paymentIntent)
        const paid: PaymentResult = { kind: 'paid', paymentIntent }
        onResult?.(paid)
        return true
      }
      const msg =
        reconcileResult.status === 'timeout' || reconcileResult.status === 'pending'
          ? reconcileResult.error.message
          : copy.errors.paymentProcessingFailed
      setError(msg)
      onError?.(reconcileResult.error)
      return false
    },
    [productRef, planRef, resolvedPlanRef, processPayment, refetch, copy, upsertPurchase, onSuccess, onResult, onError],
  )

  // 3DS return path: the rail sends the payer back with `payment_intent`
  // in the URL; resume by reconciling through the backend on that id.
  useEffect(() => {
    if (returnResumeStarted.current || typeof window === 'undefined') return
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
        await finishSucceeded(
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
  }, [paymentIntentId, finishSucceeded])


  const isReady = !!paymentIntentId
  const paymentSourceReady = !!cardCapture

  const canSubmit =
    isReady &&
    paymentSourceReady &&
    !!elementKind &&
    paymentInputComplete &&
    (!requireTermsAcceptance || termsAccepted) &&
    (!requiresBusinessAttach || businessDetailsAttached) &&
    isCustomerAddressComplete(businessDetails) &&
    !businessDetailsAttaching &&
    !isProcessing

  const submit = useCallback(async () => {
    if (!cardCapture) {
      const msg = copy.errors.cardFieldsMissing
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
    // try/finally so a throw anywhere after `setIsProcessing(true)` (confirm,
    // reconcile, upsertPurchase, onSuccess/onResult) cannot wedge the button
    // in the processing state.
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
        // The rail needs the payer (3DS). Send them there; the return path
        // above resumes on `payment_intent`.
        window.location.assign(result.redirectUrl)
        return
      }
      if (result.status === 'pending' || result.status === 'other') {
        setError(result.message)
        onError?.(new Error(result.message))
        return
      }
      await finishSucceeded(result.payment, result.payment.processorPaymentId)
    } finally {
      setIsProcessing(false)
    }
  }, [
    paymentIntentId,
    cardCapture,
    createCaptureGrant,
    confirmPaymentTransport,
    finishSucceeded,
    returnUrl,
    copy,
    onError,
    requiresBusinessAttach,
    businessDetailsAttached,
    runAttach,
    businessDetails,
    businessDetailsError,
  ])

  const effectiveError = error ?? businessDetailsError

  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer,
      resolvedPlanRef,
      plan,
      paymentIntentId,
      vault,
      appearance,
      processorPaymentId,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error: effectiveError ?? null,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      customerName,
      setCustomerName,
      businessDetails,
      taxBreakdown,
      businessDetailsAttached,
      businessDetailsAttaching,
      businessDetailsError,
      fieldErrors,
      setBusinessDetails,
      setElementKind,
      setCardCapture: setCardCaptureStable,
      setPaymentInputComplete,
      setTermsAccepted,
      submit,
    }),
    [
      planRef,
      productRef,
      prefillCustomer,
      resolvedPlanRef,
      plan,
      paymentIntentId,
      vault,
      appearance,
      processorPaymentId,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      effectiveError,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      customerName,
      setCustomerName,
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

  return <PaymentFormProvider value={contextValue}>{children}</PaymentFormProvider>
}

// ---------- Free inner ----------

const FreeInner: React.FC<{
  planRef?: string
  productRef?: string
  plan: Plan
  resolvedPlanRef: string | null
  requireTermsAcceptance: boolean
  submitButtonText?: string
  buttonClassName?: string
  onFreePlan?: PaymentFormProps['onFreePlan']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
  children?: React.ReactNode
}> = ({
  planRef,
  productRef,
  plan,
  resolvedPlanRef,
  requireTermsAcceptance,
  submitButtonText,
  buttonClassName,
  onFreePlan,
  onResult,
  onError,
  children,
}) => {
  const copy = useCopy()
  const { refetch } = usePurchase()
  const { activate, state, error: activationError, result: activationResult } = useActivation()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const resultFiredRef = useRef(false)

  useEffect(() => {
    if (state === 'activated' && activationResult && !resultFiredRef.current) {
      resultFiredRef.current = true
      const res: ActivationResult = { kind: 'activated', result: activationResult }
      onResult?.(res)
      refetch().catch(error => {
        console.error('[PaymentForm] purchase refetch failed after activation', error)
      })
    }
  }, [state, activationResult, onResult, refetch])

  const isProcessing = state === 'activating'
  const canSubmit = !isProcessing && (!requireTermsAcceptance || termsAccepted) && !!productRef

  const submit = useCallback(async () => {
    if (!productRef) {
      const msg = copy.errors.configMissingPlanOrProduct
      setLocalError(msg)
      onError?.(new Error(msg))
      return
    }
    setLocalError(undefined)
    try {
      if (onFreePlan) {
        await onFreePlan(plan)
        const activationResult: ActivatePlanResult = { status: 'activated' }
        const activated: ActivationResult = { kind: 'activated', result: activationResult }
        onResult?.(activated)
        return
      }
      await activate({ productRef, planRef: plan.reference })
    } catch (err) {
      const msg = err instanceof Error ? err.message : copy.activation.failed
      setLocalError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    }
  }, [productRef, plan, onFreePlan, activate, onResult, onError, copy])

  const error = localError ?? activationError

  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer: undefined,
      resolvedPlanRef,
      plan,
      paymentIntentId: null,
      vault: null,
      processorPaymentId: null,
      isProcessing,
      isReady: true,
      paymentInputComplete: true,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      elementKind: null,
      returnUrl: '',
      submitButtonText,
      buttonClassName,
      customerName: '',
      setCustomerName: () => {},
      businessDetails: defaultBusinessDetails,
      taxBreakdown: null,
      businessDetailsAttached: false,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      fieldErrors: {},
      setBusinessDetails: () => {},
      setElementKind: () => {},
      setCardCapture: () => {},
      setPaymentInputComplete: () => {},
      setTermsAccepted,
      submit,
    }),
    [
      planRef,
      productRef,
      resolvedPlanRef,
      plan,
      isProcessing,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      submitButtonText,
      buttonClassName,
      submit,
    ],
  )

  return <PaymentFormProvider value={contextValue}>{children}</PaymentFormProvider>
}

/** Pre-intent context so Loading / Error slots own chrome while Root stays mounted. */
const PendingInner: React.FC<{
  planRef?: string
  productRef?: string
  resolvedPlanRef: string | null
  plan: Plan | null
  returnUrl: string
  submitButtonText?: string
  buttonClassName?: string
  error: string | null
  children?: React.ReactNode
}> = ({
  planRef,
  productRef,
  resolvedPlanRef,
  plan,
  returnUrl,
  submitButtonText,
  buttonClassName,
  error,
  children,
}) => {
  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer: undefined,
      resolvedPlanRef,
      plan,
      paymentIntentId: null,
      vault: null,
      processorPaymentId: null,
      isProcessing: false,
      isReady: false,
      paymentInputComplete: false,
      termsAccepted: false,
      requireTermsAcceptance: false,
      canSubmit: false,
      error,
      elementKind: null,
      returnUrl,
      submitButtonText,
      buttonClassName,
      customerName: '',
      setCustomerName: () => {},
      businessDetails: defaultBusinessDetails,
      taxBreakdown: null,
      businessDetailsAttached: false,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      fieldErrors: {},
      setBusinessDetails: () => {},
      setElementKind: () => {},
      setCardCapture: () => {},
      setPaymentInputComplete: () => {},
      setTermsAccepted: () => {},
      submit: async () => {},
    }),
    [
      planRef,
      productRef,
      resolvedPlanRef,
      plan,
      returnUrl,
      submitButtonText,
      buttonClassName,
      error,
    ],
  )

  return <PaymentFormProvider value={contextValue}>{children}</PaymentFormProvider>
}

// ---------- Subcomponents ----------

type SummaryProps = Omit<React.ComponentProps<typeof CheckoutSummaryShim>, 'planRef' | 'productRef'>

const Summary: React.FC<SummaryProps> = props => {
  const ctx = usePaymentForm()
  return (
    <CheckoutSummaryShim
      {...props}
      planRef={ctx.planRef || ctx.resolvedPlanRef || undefined}
      productRef={ctx.productRef}
      taxBreakdown={ctx.businessDetails.isBusiness ? ctx.taxBreakdown : null}
      baseAmountMinor={ctx.plan?.price ?? 0}
    />
  )
}

type MandateTextPrimitiveProps = Omit<
  React.ComponentProps<typeof MandateTextShim>,
  'planRef' | 'productRef'
>

const MandateTextPrimitive: React.FC<MandateTextPrimitiveProps> = props => {
  const ctx = usePaymentForm()
  return (
    <MandateTextShim
      {...props}
      planRef={ctx.planRef || ctx.resolvedPlanRef || undefined}
      productRef={ctx.productRef}
    />
  )
}

type CustomerFieldsProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean
  readOnly?: boolean
}

const CustomerFields = forwardRef<HTMLElement, CustomerFieldsProps>(
  function PaymentFormCustomerFields(
    { asChild, readOnly: _readOnly = true, children, ...rest },
    ref,
  ) {
    const copy = useCopy()
    const customer = useCustomer()
    const { prefillCustomer, customerName, setCustomerName, setBusinessDetails } = usePaymentForm()

    const email = customer.email ?? prefillCustomer?.email

    if (!email) return null

    const Comp = asChild ? Slot : 'section'
    return (
      <Comp ref={ref} data-solvapay-payment-form-customer-fields="" {...rest}>
        {children ?? (
          <>
            {email && (
              <dl data-solvapay-payment-form-customer-email="">
                <dt>{copy.customer.emailLabel}</dt>
                <dd>{email}</dd>
              </dl>
            )}
            <dl data-solvapay-payment-form-customer-name="">
              <dt>{copy.customer.nameLabel}</dt>
              <dd>
                <input
                  type="text"
                  value={customerName}
                  onChange={event => {
                    const nextName = event.target.value
                    setCustomerName(nextName)
                    setBusinessDetails({
                      customerName: nextName.trim() || undefined,
                    })
                  }}
                  placeholder="Optional"
                  aria-label={copy.customer.nameLabel}
                />
              </dd>
            </dl>
          </>
        )}
      </Comp>
    )
  },
)

/**
 * Card entry: VGS Collect hosted fields for number, expiry and CVC.
 * Renders nothing until the payment intent exists.
 *
 * On mount it registers a capture function with `Root`; `Root.submit` asks
 * the backend for a grant, writes the card into the vault and confirms
 * server-side. The card number never touches the integrator's DOM.
 */
const CardFieldsSlot = forwardRef<HTMLElement, CardFieldsProps>(function PaymentFormCardFields(
  props,
  ref,
) {
  const { vault, paymentIntentId, appearance, setElementKind, setCardCapture, setPaymentInputComplete } =
    usePaymentForm()
  const onActive = useCallback(
    (active: boolean) => setElementKind(active ? 'card-fields' : null),
    [setElementKind],
  )
  return (
    <VaultCardFields
      ref={ref}
      data-solvapay-payment-form-card-fields=""
      {...props}
      vault={vault}
      paymentIntentId={paymentIntentId}
      appearance={appearance}
      onCapture={setCardCapture}
      onComplete={setPaymentInputComplete}
      onActive={onActive}
    />
  )
})

type TermsCheckboxProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  asChild?: boolean
  label?: React.ReactNode
}

const TermsCheckbox = forwardRef<HTMLLabelElement, TermsCheckboxProps>(
  function PaymentFormTermsCheckbox({ asChild, label, children, ...rest }, ref) {
    const { termsAccepted, setTermsAccepted } = usePaymentForm()
    const copy = useCopy()
    const id = 'solvapay-terms-checkbox'

    if (asChild) {
      return (
        <Slot ref={ref} data-solvapay-payment-form-terms="" {...rest}>
          {children}
        </Slot>
      )
    }
    return (
      <label ref={ref} htmlFor={id} data-solvapay-payment-form-terms="" {...rest}>
        <input
          id={id}
          type="checkbox"
          checked={termsAccepted}
          onChange={e => setTermsAccepted(e.target.checked)}
        />
        <span>{label ?? copy.terms.checkboxLabel}</span>
      </label>
    )
  },
)

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  function PaymentFormSubmitButton({ asChild, onClick, children, ...rest }, ref) {
    const ctx = usePaymentForm()
    const copy = useCopy()
    const locale = useLocale()
    const { plan } = usePlan({
      planRef: ctx.planRef || ctx.resolvedPlanRef || undefined,
      productRef: ctx.productRef,
    })
    const { product } = useProduct(ctx.productRef)

    const variant = deriveVariant(plan ?? ctx.plan ?? undefined)
    const dataVariant = toSubmitVariant(variant)
    const dataState: 'idle' | 'processing' | 'disabled' = ctx.isProcessing
      ? 'processing'
      : !ctx.canSubmit
        ? 'disabled'
        : 'idle'

    const planCurrency = plan?.currency ?? ctx.plan?.currency ?? 'usd'
    const baseMinor = ctx.taxBreakdown?.total ?? plan?.price ?? ctx.plan?.price ?? 0
    const amountFormatted = formatPrice(baseMinor, ctx.taxBreakdown?.currency ?? planCurrency, {
      locale,
      interval: variant === 'recurring' ? plan?.interval ?? ctx.plan?.interval : undefined,
      intervalCount: variant === 'recurring' ? 1 : undefined,
      free: copy.interval.free,
    })

    const label = resolveCta({
      variant,
      plan: plan ?? ctx.plan,
      product,
      amountFormatted,
      copy,
      override: typeof children === 'string' ? children : ctx.submitButtonText,
    })

    const processingContent = (
      <>
        <Spinner size="sm" />
        <span>{copy.cta.processing}</span>
      </>
    )

    const buttonProps = {
      'data-solvapay-payment-form-submit': '',
      'data-state': dataState,
      'data-variant': dataVariant,
      'aria-busy': ctx.isProcessing,
      'aria-disabled': !ctx.canSubmit,
      'aria-label': label,
      disabled: !ctx.canSubmit,
      className: rest.className ?? ctx.buttonClassName,
      onClick: composeEventHandlers(onClick, e => {
        e.preventDefault()
        ctx.submit()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    if (asChild) {
      // Preserve the consumer's wrapper element across idle→processing.
      // See the matching comment in TopupForm.SubmitButton — replacing
      // the wrapper with a Fragment when processing strips className,
      // disabled, and onClick from the rendered DOM.
      const slotChild =
        ctx.isProcessing && React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{ children?: React.ReactNode }>,
              undefined,
              processingContent,
            )
          : children
      return (
        <Slot ref={ref as React.Ref<HTMLElement>} {...(buttonProps as Record<string, unknown>)}>
          {slotChild}
        </Slot>
      )
    }

    const content = ctx.isProcessing
      ? processingContent
      : children && typeof children !== 'string'
        ? children
        : label

    return (
      <button ref={ref} type="submit" {...buttonProps}>
        {content}
      </button>
    )
  },
)

type LoadingProps = React.HTMLAttributes<HTMLOutputElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLOutputElement, LoadingProps>(function PaymentFormLoading(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (ctx.isReady && ctx.paymentIntentId) return null
  if (asChild) {
    return (
      <Slot ref={ref as React.Ref<HTMLElement>} data-solvapay-payment-form-loading="" {...rest}>
        {children ?? <Spinner size="sm" />}
      </Slot>
    )
  }
  return (
    <output ref={ref} data-solvapay-payment-form-loading="" {...rest}>
      {children ?? <Spinner size="sm" />}
    </output>
  )
})

type ErrorProps = React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }

const ErrorSlot = forwardRef<HTMLParagraphElement, ErrorProps>(function PaymentFormError(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (!ctx.error) return null
  if (asChild) {
    return (
      <Slot
        ref={ref as React.Ref<HTMLElement>}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-solvapay-payment-form-error=""
        {...rest}
      >
        {children ?? ctx.error}
      </Slot>
    )
  }
  return (
    <p
      ref={ref}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-solvapay-payment-form-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </p>
  )
})

function usePaymentBusinessCtx(_part: string) {
  const ctx = usePaymentForm()
  return {
    businessDetails: ctx.businessDetails,
    setBusinessDetails: ctx.setBusinessDetails,
    fieldErrors: ctx.fieldErrors,
  }
}

function usePaymentSummaryCtx(_part: string) {
  const ctx = usePaymentForm()
  return {
    taxBreakdown: ctx.taxBreakdown,
    businessDetailsAttaching: ctx.businessDetailsAttaching,
    baseAmountMinor: ctx.plan?.price ?? 0,
    currency: ctx.taxBreakdown?.currency ?? ctx.plan?.currency ?? 'usd',
    isBusiness: ctx.businessDetails.isBusiness,
  }
}

const BusinessDetails = createBusinessDetailsParts(usePaymentBusinessCtx, 'payment-form')
const TaxSummary = createTaxSummaryParts(usePaymentSummaryCtx, 'payment-form')

// ---------- Exports ----------

export const PaymentFormRoot = Root
export const PaymentFormSummary = Summary
export const PaymentFormCustomerFields = CustomerFields
export const PaymentFormCardFields = CardFieldsSlot
export const PaymentFormMandateText = MandateTextPrimitive
export const PaymentFormTermsCheckbox = TermsCheckbox
export const PaymentFormSubmitButton = SubmitButton
export const PaymentFormLoading = Loading
export const PaymentFormError = ErrorSlot
export const PaymentFormLegalFooter = LegalFooter
export const PaymentFormBusinessDetails = BusinessDetails
export const PaymentFormTaxSummary = TaxSummary

export const PaymentForm = {
  Root,
  Summary,
  CustomerFields,
  CardFields: CardFieldsSlot,
  BusinessDetails,
  TaxSummary,
  MandateText: MandateTextPrimitive,
  TermsCheckbox,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
  LegalFooter,
} as const
