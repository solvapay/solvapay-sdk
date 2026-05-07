'use client'

/**
 * `<PaywallNotice>` compound primitive — renders the UI surfaced by a
 * `PaywallError`'s `structuredContent`. Transport-agnostic; works in
 * any tree under `SolvaPayProvider`.
 *
 * Sub-components render conditionally based on the paywall `kind`:
 *  - `Heading`            — always
 *  - `Message`            — always; resolves a kind-specific i18n
 *                           string before falling back to the
 *                           server-provided `content.message`. The
 *                           fallback used to leak MCP-flavored copy
 *                           ("Call the `upgrade` tool…") into web UIs;
 *                           the i18n pre-resolution avoids that.
 *  - `ProductContext`     — when `content.productDetails?.name`
 *  - `Balance`            — `activation_required` with `content.balance`
 *  - `Plans`              — `activation_required` with `content.plans`
 *  - `EmbeddedCheckout`   — stepped composition of
 *                           `<CheckoutSteps.*>` (plan → amount [PAYG] →
 *                           payment → success). Deliberately
 *                           opinionated: the SDK's recommended
 *                           default for paywall surfaces. Apps that
 *                           want a different layout compose
 *                           `<CheckoutSteps.*>` directly.
 *  - `HostedCheckoutLink` — anchor to `content.checkoutUrl`
 *                           (CSP-blocked hosts)
 *  - `Retry`              — calls `onResolved` once
 *                           `usePaywallResolver.resolved`
 */

import React, { createContext, forwardRef, useContext, useEffect, useMemo } from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Slot } from './slot'
import { PlanSelector } from './PlanSelector'
import { CheckoutSteps } from './checkout'
import { buildDefaultCheckoutPlanFilter } from './checkout/shared'
import { useCopy } from '../hooks/useCopy'
import { usePaywallResolver } from '../hooks/usePaywallResolver'
import { usePlans } from '../hooks/usePlans'
import { interpolate } from '../i18n/interpolate'
import type { Plan } from '../types'
import { isPaygPlan } from '../utils/isPayg'

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

export interface PaywallNoticeRootProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'content'
> {
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
      : isTopupGate(ctx.content)
        ? copy.paywall.topupRequiredHeading
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
 * Resolve a web-friendly paywall message, in this priority:
 *
 *   1. `payment_required` + balance with `remainingUnits > 0`
 *      → `paymentRequiredMessageRemaining` (e.g. "Only 3 calls left…")
 *   2. `payment_required` + balance with `remainingUnits === 0`
 *      → `paymentRequiredMessage` ("You've used all your included calls…")
 *   3. `payment_required` + no balance block
 *      → `paymentRequiredMessageNoBalance` (web-friendly fallback)
 *   4. `activation_required` + every available plan is PAYG
 *      → `topupRequiredMessage` ("You're out of credits…")
 *   5. `activation_required` (mixed or non-PAYG plans)
 *      → `activationRequiredMessage` ("You need an active plan… to continue")
 *   6. Any future `kind`
 *      → `content.message` (server-provided, forward-compat)
 *
 * The fallback path used to drop straight to `content.message`, which
 * was authored for MCP / CLI hosts and bled MCP-flavored copy ("Call
 * the `upgrade` tool…") into web UIs. We resolve a kind-specific i18n
 * string first and only fall through when we genuinely can't recognise
 * the kind.
 */
type PaywallMessageCopy = {
  paymentRequiredMessage: string
  paymentRequiredMessageRemaining: string
  paymentRequiredMessageNoBalance: string
  activationRequiredMessage: string
  topupRequiredMessage: string
  paymentRequiredProductSuffix: string
}

/**
 * Discriminate the topup variant of an activation gate from a
 * subscription/lifetime activation. PAYG-only gates (every available
 * plan has `type: 'usage-based' | 'hybrid'`) get topup-flavored copy
 * ("Add credits", "You're out of credits…"); anything else gets the
 * generic "Activate a plan" framing.
 *
 * Returns `false` when `plans` is missing — without plan-shape
 * information we can't safely promise the user "credits", so we keep
 * the neutral activation copy.
 */
function isTopupGate(content: PaywallStructuredContent): boolean {
  if (content.kind !== 'activation_required') return false
  const plans = content.plans
  if (!plans || plans.length === 0) return false
  return plans.every(p => isPaygPlan(p))
}

function resolvePaywallMessage(
  content: PaywallStructuredContent,
  paywallCopy: PaywallMessageCopy,
): string {
  const productName =
    content.kind === 'payment_required' || content.kind === 'activation_required'
      ? content.productDetails?.name
      : undefined
  const forProduct = productName
    ? interpolate(paywallCopy.paymentRequiredProductSuffix, { product: productName })
    : ''

  if (content.kind === 'payment_required') {
    const balance = content.balance
    if (!balance) {
      return interpolate(paywallCopy.paymentRequiredMessageNoBalance, { forProduct })
    }
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

  if (content.kind === 'activation_required') {
    if (isTopupGate(content)) {
      return interpolate(paywallCopy.topupRequiredMessage, { forProduct })
    }
    return interpolate(paywallCopy.activationRequiredMessage, { forProduct })
  }

  // Any future kind we don't recognise — fall through to the
  // server-provided message rather than silently rendering a blank
  // surface.
  return (content as { message?: string }).message ?? ''
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
>(function PaywallNoticeHostedCheckoutLink(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
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
   * Return URL forwarded to Stripe's confirmPayment step.
   */
  returnUrl: string
  /**
   * Currency for the PAYG topup branch. Forwarded to
   * `<CheckoutSteps.Root>`. Defaults to `merchant.defaultCurrency`.
   * Pass an explicit value when integrators surface a per-customer
   * currency picker (multi-currency topup, future). Plan currency is
   * never used as a fallback — credit topups are merchant-wide.
   */
  topupCurrency?: string
  className?: string
}

/**
 * Stepped paywall checkout — wraps `<CheckoutSteps.*>` with the
 * Free-hiding filter and the SDK's recommended layout. The order is
 * plan → amount (PAYG only) → payment → success, with an explicit
 * Continue button between the plan grid and the form so users never
 * accidentally drift past plan selection.
 *
 * This is the SDK's documented default for paywall surfaces. Apps that
 * want a different layout — extra chrome, alternate ordering, embedded
 * inside another widget — compose `<CheckoutSteps.*>` directly.
 */
function EmbeddedCheckout({ returnUrl, topupCurrency, className }: EmbeddedCheckoutProps) {
  const ctx = usePaywallNoticeCtx('EmbeddedCheckout')
  const productRef = ctx.content.product
  // Prefetch plans so the filter sees the full plan list. `usePlans`
  // has a global module cache keyed by `productRef`, so the inner
  // `<PlanSelector.Root>` (mounted via `<CheckoutSteps.Root>`) hits
  // cache rather than firing a second request.
  const { plans } = usePlans({ productRef: productRef ?? undefined })
  const filter = useMemo(() => buildDefaultCheckoutPlanFilter(plans), [plans])
  if (!productRef) return null
  const resolvedClassName =
    className ?? ctx.classNames.embeddedCheckout ?? 'solvapay-paywall-embedded-checkout'
  return (
    <CheckoutSteps.Root
      productRef={productRef}
      returnUrl={returnUrl}
      filter={filter}
      topupCurrency={topupCurrency}
      onPurchaseSuccess={() => {
        void ctx.refetch()
      }}
      className={resolvedClassName}
    >
      <CheckoutSteps.IfStep step="plan">
        <CheckoutSteps.PlanGrid />
        <PlanSelector.Loading />
        <PlanSelector.Error />
        <CheckoutSteps.PlanContinueButton />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="amount">
        <CheckoutSteps.BackLink />
        <CheckoutSteps.AmountPicker />
        <CheckoutSteps.AmountContinueButton />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="payment">
        <CheckoutSteps.BackLink />
        <CheckoutSteps.Payment />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="success">
        <CheckoutSteps.Success />
      </CheckoutSteps.IfStep>
    </CheckoutSteps.Root>
  )
}

const Retry = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(function PaywallNoticeRetry({ asChild, children, className, onClick, ...rest }, forwardedRef) {
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
})

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
