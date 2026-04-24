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
 *  - `EmbeddedCheckout` — mounts `<PlanSelector>` + a plan gate that
 *                         branches on plan type (PAYG → `AmountPicker`
 *                         + `TopupForm` inline; recurring →
 *                         `PaymentForm`). This is the minimal
 *                         primitive-layer variant for non-MCP web
 *                         integrators; MCP hosts use the fuller
 *                         stepped flow from
 *                         `@solvapay/react/mcp` → `McpPaywallView`.
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
  useState,
} from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Slot } from './slot'
import { PlanSelector, usePlanSelector } from './PlanSelector'
import { PaymentForm } from './PaymentForm'
import { AmountPicker } from './AmountPicker'
import { TopupForm } from './TopupForm'
import { useCopy } from '../hooks/useCopy'
import { usePaywallResolver } from '../hooks/usePaywallResolver'
import { interpolate } from '../i18n/interpolate'
import { isPaygPlan } from '../utils/isPayg'
import type { Plan } from '../types'

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
  const copy = useCopy()
  const Comp = asChild ? Slot : 'p'
  const defaultText = resolvePaywallMessage(ctx.content, copy.paywall)
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-paywall-message=""
      className={className ?? ctx.classNames.message}
      {...rest}
    >
      {children ?? defaultText}
    </Comp>
  )
})

/**
 * Picks a client-side message when the paywall carries enough structured
 * data to build one — specifically a `payment_required` kind with a
 * `balance` attached. Falls back to the server-provided `message` string
 * (which older servers produce) so we stay back-compat.
 */
function resolvePaywallMessage(
  content: PaywallStructuredContent,
  paywallCopy: {
    paymentRequiredMessage: string
    paymentRequiredMessageRemaining: string
    paymentRequiredProductSuffix: string
  },
): string {
  if (content.kind !== 'payment_required') {
    return content.message
  }
  const balance = content.balance
  if (!balance) return content.message
  const productName = content.productDetails?.name
  const forProduct = productName
    ? interpolate(paywallCopy.paymentRequiredProductSuffix, { product: productName })
    : ''
  const remaining = balance.remainingUnits ?? 0
  if (remaining <= 0) {
    return interpolate(paywallCopy.paymentRequiredMessage, { forProduct })
  }
  return interpolate(paywallCopy.paymentRequiredMessageRemaining, {
    remaining: String(remaining),
    pluralSuffix: remaining === 1 ? '' : 's',
    forProduct,
  })
}

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
  const balance = ctx.content.balance
  if (ctx.content.kind !== 'activation_required' || !balance) return null
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
      <PlanSelector.Root productRef={ctx.content.product} filter={hidesFreePlan}>
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

/**
 * Hides the Free plan from the paywall's plan grid. The paywall only
 * appears once the user is out of free quota, so rendering a disabled
 * Free card adds noise without aiding the decision. The checkout view
 * uses a similar filter that *does* keep Free when it's the active plan
 * (to show "here's what you have now"); the paywall has no equivalent
 * need so we strip it unconditionally.
 */
function hidesFreePlan(plan: Plan): boolean {
  return plan.requiresPayment !== false
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
   * Return URL forwarded to `<PaymentForm.Root>` for Stripe's
   * confirmPayment step.
   */
  returnUrl: string
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
      <PlanSelector.Root productRef={ctx.content.product} filter={hidesFreePlan}>
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
        <PaywallSelectedPlanGate productRef={ctx.content.product} returnUrl={returnUrl}>
          {children}
        </PaywallSelectedPlanGate>
      </PlanSelector.Root>
    </div>
  )
}

/**
 * Switches the post-plan-selection surface based on the selected plan's
 * type. Usage-based / hybrid plans mount an `AmountPicker` → `TopupForm`
 * sequence (a one-shot top-up). Recurring plans keep the `PaymentForm`
 * subscribe flow.
 *
 * The `children` override, when provided, is forwarded to the recurring
 * `PaymentForm` only — PAYG has its own dedicated default layout since
 * its composition (`AmountPicker`, then `TopupForm`) differs
 * structurally from `PaymentForm`'s.
 *
 * @internal Minimal inline variant for primitive-level consumers. MCP
 * hosts use the stepped state machine in
 * `packages/react/src/mcp/views/checkout/` instead, which inserts an
 * explicit `Continue` button between plan selection and the amount
 * picker so those actions never coexist on one surface.
 */
function PaywallSelectedPlanGate({
  productRef,
  returnUrl,
  children,
}: {
  productRef: string
  returnUrl: string
  children?: React.ReactNode
}) {
  const { selectedPlan, selectedPlanRef } = usePlanSelector()
  if (!selectedPlanRef || !selectedPlan) return null
  if (isPaygPlan(selectedPlan)) {
    return (
      <PaywallPaygGate
        key={selectedPlanRef}
        plan={selectedPlan}
        returnUrl={returnUrl}
      />
    )
  }
  return (
    <PaywallPaymentFormGate productRef={productRef} returnUrl={returnUrl}>
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
  )
}

/**
 * PAYG branch: pick an amount first, then mount the `TopupForm`. A
 * `Change amount` link lets the customer back out to the amount step
 * without losing their plan selection.
 */
function PaywallPaygGate({
  plan,
  returnUrl,
}: {
  plan: Plan
  returnUrl: string
}) {
  const ctx = usePaywallNoticeCtx('EmbeddedCheckout')
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const [amountMinor, setAmountMinor] = useState<number | null>(null)

  if (amountMinor == null) {
    return (
      <div data-solvapay-paywall-payg-amount="">
        <AmountPicker.Root currency={currency} emit="minor">
          <AmountPicker.Custom />
          <AmountPicker.Confirm onConfirm={minor => setAmountMinor(minor)}>
            Continue
          </AmountPicker.Confirm>
        </AmountPicker.Root>
      </div>
    )
  }

  return (
    <div data-solvapay-paywall-payg-topup="">
      <button
        type="button"
        data-solvapay-paywall-payg-change-amount=""
        onClick={() => setAmountMinor(null)}
      >
        Change amount
      </button>
      <TopupForm.Root
        amount={amountMinor}
        currency={currency}
        returnUrl={returnUrl}
        onSuccess={() => {
          void ctx.refetch()
        }}
      >
        <TopupForm.Loading />
        <TopupForm.PaymentElement />
        <TopupForm.Error />
        <TopupForm.SubmitButton />
      </TopupForm.Root>
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
