'use client'

/**
 * `<PaywallNotice>` compound primitive — renders the UI surfaced by a
 * `PaywallError`'s `structuredContent`. Transport-agnostic; works in any
 * tree under `SolvaPayProvider`.
 *
 * Sub-components render conditionally based on the paywall `kind`:
 *  - `Heading`          — always
 *  - `Message`          — always
 *  - `ProductContext`   — when `content.productDetails?.name`
 *  - `Balance`          — `activation_required` with `content.balance`
 *  - `Plans`            — `activation_required` with `content.plans`
 *  - `EmbeddedCheckout` — mounts `<PlanSelector>` + `<PaymentForm>`
 *  - `HostedCheckoutLink` — anchor to `content.checkoutUrl` (CSP-blocked hosts)
 *  - `Retry`            — calls `onResolved` once `usePaywallResolver.resolved`
 *
 * See phase-2 plan §2.1.f for the full contract.
 */

import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Slot } from './slot'
import { PlanSelector, usePlanSelector } from './PlanSelector'
import { PaymentForm } from './PaymentForm'
import { useCopy } from '../hooks/useCopy'
import { usePaywallResolver } from '../hooks/usePaywallResolver'
import { interpolate } from '../i18n/interpolate'

export interface PaywallNoticeClassNames {
  root?: string
  heading?: string
  message?: string
  productContext?: string
  balance?: string
  plans?: string
  hostedLink?: string
  embeddedCheckout?: string
  retryButton?: string
}

interface PaywallNoticeContextValue {
  content: PaywallStructuredContent
  resolved: boolean
  refetch: () => Promise<void>
  onResolved?: () => void
  classNames: PaywallNoticeClassNames
}

const PaywallNoticeContext = createContext<PaywallNoticeContextValue | null>(null)

function usePaywallNoticeCtx(part: string): PaywallNoticeContextValue {
  const ctx = useContext(PaywallNoticeContext)
  if (!ctx) {
    throw new Error(`PaywallNotice.${part} must be rendered inside <PaywallNotice.Root>.`)
  }
  return ctx
}

export interface PaywallNoticeRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'content'> {
  content: PaywallStructuredContent
  /**
   * Called once the paywall requirement is met (purchase created or plan
   * activated). Consumers typically use this to dismiss the notice and
   * retry the original tool call.
   */
  onResolved?: () => void
  classNames?: PaywallNoticeClassNames
  asChild?: boolean
}

const Root = forwardRef<HTMLDivElement, PaywallNoticeRootProps>(function PaywallNoticeRoot(
  { content, onResolved, classNames, asChild, children, ...rest },
  forwardedRef,
) {
  const { resolved, refetch } = usePaywallResolver(content)
  const classNamesResolved = useMemo(() => classNames ?? {}, [classNames])

  // Fire `onResolved` exactly once on the `false → true` transition.
  useEffect(() => {
    if (resolved) onResolved?.()
  }, [resolved, onResolved])

  const ctx = useMemo<PaywallNoticeContextValue>(
    () => ({
      content,
      resolved,
      refetch,
      onResolved,
      classNames: classNamesResolved,
    }),
    [content, resolved, refetch, onResolved, classNamesResolved],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <PaywallNoticeContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-paywall-notice=""
        data-kind={content.kind}
        data-state={resolved ? 'resolved' : 'pending'}
        className={classNamesResolved.root}
        {...rest}
      >
        {children}
      </Comp>
    </PaywallNoticeContext.Provider>
  )
})

type LeafProps = React.HTMLAttributes<HTMLElement> & { asChild?: boolean }

const Heading = forwardRef<HTMLHeadingElement, LeafProps>(function PaywallNoticeHeading(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
  const ctx = usePaywallNoticeCtx('Heading')
  const copy = useCopy()
  const defaultText = ctx.resolved
    ? copy.paywall.resolvedHeading
    : ctx.content.kind === 'payment_required'
      ? copy.paywall.paymentRequiredHeading
      : copy.paywall.activationRequiredHeading
  const Comp = asChild ? Slot : 'h2'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-paywall-heading=""
      className={className ?? ctx.classNames.heading}
      {...rest}
    >
      {children ?? defaultText}
    </Comp>
  )
})

const Message = forwardRef<HTMLParagraphElement, LeafProps>(function PaywallNoticeMessage(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
  const ctx = usePaywallNoticeCtx('Message')
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-paywall-message=""
      className={className ?? ctx.classNames.message}
      {...rest}
    >
      {children ?? ctx.content.message}
    </Comp>
  )
})

const ProductContext = forwardRef<HTMLDivElement, LeafProps>(function PaywallNoticeProductContext(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
  const ctx = usePaywallNoticeCtx('ProductContext')
  const copy = useCopy()
  const product =
    ctx.content.kind === 'activation_required' ? ctx.content.productDetails : undefined
  if (!product?.name) return null
  const label = interpolate(copy.paywall.productContext, { product: product.name })
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-paywall-product-context=""
      className={className ?? ctx.classNames.productContext}
      {...rest}
    >
      {children ?? label}
    </Comp>
  )
})

const Balance = forwardRef<HTMLDivElement, LeafProps>(function PaywallNoticeBalance(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
  const ctx = usePaywallNoticeCtx('Balance')
  const copy = useCopy()
  if (ctx.content.kind !== 'activation_required' || !ctx.content.balance) return null
  const balance = ctx.content.balance
  const label = interpolate(copy.paywall.balanceLine, {
    available: String(balance.remainingUnits ?? 0),
    required: String(balance.creditsPerUnit ?? 1),
  })
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-paywall-balance=""
      className={className ?? ctx.classNames.balance}
      {...rest}
    >
      {children ?? label}
    </Comp>
  )
})

interface PlansProps {
  /** Custom className forwarded to the underlying `<PlanSelector.Root>`. */
  className?: string
  children?: React.ReactNode
}

function Plans({ className, children }: PlansProps) {
  const ctx = usePaywallNoticeCtx('Plans')
  if (ctx.content.kind !== 'activation_required') return null
  if (!ctx.content.product) return null
  const defaultClass = className ?? ctx.classNames.plans ?? 'solvapay-paywall-plans'
  return (
    <div data-solvapay-paywall-plans="" className={defaultClass}>
      <PlanSelector.Root productRef={ctx.content.product}>
        {children ?? (
          <>
            <PlanSelector.Grid>
              <PlanSelector.Card>
                <PlanSelector.CardBadge />
                <PlanSelector.CardName />
                <PlanSelector.CardPrice />
                <PlanSelector.CardInterval />
              </PlanSelector.Card>
            </PlanSelector.Grid>
            <PlanSelector.Loading />
            <PlanSelector.Error />
          </>
        )}
      </PlanSelector.Root>
    </div>
  )
}

const HostedCheckoutLink = forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean }
>(function PaywallNoticeHostedCheckoutLink({ asChild, children, className, ...rest }, forwardedRef) {
  const ctx = usePaywallNoticeCtx('HostedCheckoutLink')
  const copy = useCopy()
  const href = ctx.content.checkoutUrl
  if (!href) return null
  const Comp = asChild ? Slot : 'a'
  return (
    <Comp
      ref={forwardedRef}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-solvapay-paywall-hosted-link=""
      className={className ?? ctx.classNames.hostedLink}
      {...rest}
    >
      {children ?? copy.paywall.hostedCheckoutButton}
    </Comp>
  )
})

interface EmbeddedCheckoutProps {
  /**
   * Stripe publishable key used to gate Stripe Elements mounting.
   * When omitted, the compound delegates to the host transport's
   * `createPayment` / `processPayment` flow.
   */
  publishableKey?: string | null
  returnUrl: string
  /** Hide the embedded flow when the host CSP blocks Stripe. */
  hideWhenBlocked?: boolean
  className?: string
  children?: React.ReactNode
}

function EmbeddedCheckout({
  returnUrl,
  className,
  children,
}: EmbeddedCheckoutProps) {
  const ctx = usePaywallNoticeCtx('EmbeddedCheckout')
  if (!ctx.content.product) return null
  const defaultClass =
    className ?? ctx.classNames.embeddedCheckout ?? 'solvapay-paywall-embedded-checkout'
  return (
    <div data-solvapay-paywall-embedded-checkout="" className={defaultClass}>
      <PlanSelector.Root productRef={ctx.content.product}>
        <PlanSelector.Grid>
          <PlanSelector.Card>
            <PlanSelector.CardBadge />
            <PlanSelector.CardName />
            <PlanSelector.CardPrice />
            <PlanSelector.CardInterval />
          </PlanSelector.Card>
        </PlanSelector.Grid>
        <PlanSelector.Loading />
        <PlanSelector.Error />
        <PaywallPaymentFormGate productRef={ctx.content.product} returnUrl={returnUrl}>
          {children ?? (
            <>
              <PaymentForm.Summary />
              <PaymentForm.Loading />
              <PaymentForm.PaymentElement />
              <PaymentForm.Error />
              <PaymentForm.MandateText />
              <PaymentForm.SubmitButton />
            </>
          )}
        </PaywallPaymentFormGate>
      </PlanSelector.Root>
    </div>
  )
}

function PaywallPaymentFormGate({
  productRef,
  returnUrl,
  children,
}: {
  productRef: string
  returnUrl: string
  children: React.ReactNode
}) {
  const { selectedPlanRef } = usePlanSelector()
  const ctx = usePaywallNoticeCtx('EmbeddedCheckout')
  if (!selectedPlanRef) return null
  return (
    <PaymentForm.Root
      key={selectedPlanRef}
      planRef={selectedPlanRef}
      productRef={productRef}
      returnUrl={returnUrl}
      requireTermsAcceptance={false}
      onSuccess={() => {
        void ctx.refetch()
      }}
    >
      {children}
    </PaymentForm.Root>
  )
}

const Retry = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  function PaywallNoticeRetry({ asChild, children, className, onClick, ...rest }, forwardedRef) {
    const ctx = usePaywallNoticeCtx('Retry')
    const copy = useCopy()
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={forwardedRef}
        type="button"
        disabled={!ctx.resolved}
        data-solvapay-paywall-retry=""
        data-state={ctx.resolved ? 'ready' : 'waiting'}
        className={className ?? ctx.classNames.retryButton}
        onClick={e => {
          onClick?.(e as React.MouseEvent<HTMLButtonElement>)
          if (!e.defaultPrevented && ctx.resolved) ctx.onResolved?.()
        }}
        {...rest}
      >
        {children ?? copy.paywall.retryButton}
      </Comp>
    )
  },
)

export const PaywallNotice = Object.assign(Root, {
  Root,
  Heading,
  Message,
  ProductContext,
  Plans,
  Balance,
  HostedCheckoutLink,
  EmbeddedCheckout,
  Retry,
})

export { Root as PaywallNoticeRoot }
export { Heading as PaywallNoticeHeading }
export { Message as PaywallNoticeMessage }
export { ProductContext as PaywallNoticeProductContext }
export { Balance as PaywallNoticeBalance }
export { Plans as PaywallNoticePlans }
export { HostedCheckoutLink as PaywallNoticeHostedCheckoutLink }
export { EmbeddedCheckout as PaywallNoticeEmbeddedCheckout }
export { Retry as PaywallNoticeRetry }

export function usePaywallNotice(): PaywallNoticeContextValue {
  return usePaywallNoticeCtx('usePaywallNotice')
}
