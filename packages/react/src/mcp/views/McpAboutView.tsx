'use client'

/**
 * `<McpAboutView>` — the product-description landing page surfaced by
 * the About tab.
 *
 * Renders three stacked sections:
 *  1. Product header — logo/image, `name`, `description` (all sourced
 *     from `bootstrap.product`). Collapses gracefully when fields are
 *     empty; product `name` is always present.
 *  2. "Your activity" strip (returning customers only) — variant per
 *     plan shape (PAYG balance, recurring-unlimited renew date,
 *     recurring-metered usage bar, free usage bar). Hidden with
 *     `activity === 'none'`.
 *  3. Two CTA cards + slash-command list for cold-start users. CTA2 is
 *     contextual (start-free / try-payg / hidden), CTA1 narrows to
 *     "Change plan" for returning customers.
 *
 * End-user vocabulary: hosts call MCP servers "Connected apps"; we
 * still use "product" in the copy because it's what the merchant
 * configures in the admin, and "About <product>" is the phrasing
 * every major host converges on.
 */

import React from 'react'
import { useBalance } from '../../hooks/useBalance'
import { useMerchant } from '../../hooks/useMerchant'
import { usePurchase } from '../../hooks/usePurchase'
import { useUsage } from '../../hooks/useUsage'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { UsageMeter } from '../../primitives/UsageMeter'
import type { McpBootstrap } from '../bootstrap'
import {
  resolveAboutCtaCard1,
  resolveAboutCtaCard2,
  resolveActivityStrip,
  type ActivityStripKind,
  type PlanLike,
} from '../plan-actions'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpAboutViewProps {
  /**
   * Full bootstrap snapshot — lets the view read `product.name`,
   * `product.description`, `product.imageUrl`, and `plans[]` without
   * firing extra hook reads. The shell passes the same object it
   * routes with, so this stays a `useMemo` pointer equality match.
   */
  bootstrap: McpBootstrap
  classNames?: McpViewClassNames
  /** Called when the user picks "See plans" / "Change plan". */
  onSeePlans?: () => void
  /** Called when the user picks "Try without subscribing" / PAYG top-up. */
  onTopup?: () => void
  /** Called when the user picks "Upgrade" on a free / metered strip. */
  onUpgrade?: () => void
  /**
   * Slash-command hints surfaced under the CTA cards. Typically wired
   * to the prompts the server registered; the view renders whatever
   * the consumer passes so text-only hosts can omit them.
   */
  slashCommands?: Array<{ command: string; description: string }>
}

export function McpAboutView({
  bootstrap,
  classNames,
  onSeePlans,
  onTopup,
  onUpgrade,
  slashCommands,
}: McpAboutViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const { activePurchase, hasPaidPurchase } = usePurchase()
  const { merchant } = useMerchant()

  // `bootstrap.product` is a loose structural alias — treat all
  // string fields defensively.
  const product = bootstrap.product as unknown as {
    name?: string
    description?: string
    imageUrl?: string
  }
  const productName = product?.name ?? merchant?.displayName ?? 'This app'
  const description = typeof product?.description === 'string' ? product.description.trim() : ''
  const imageUrl = typeof product?.imageUrl === 'string' ? product.imageUrl.trim() : ''

  const plans = (bootstrap.plans ?? []) as unknown as PlanLike[]
  const hasActivePurchase = hasPaidPurchase || Boolean(activePurchase)
  const cta1 = resolveAboutCtaCard1(hasActivePurchase)
  const cta2 = resolveAboutCtaCard2({ hasActivePurchase, plans })
  const activity = resolveActivityStrip({
    planSnapshot: activePurchase?.planSnapshot as PlanLike | null | undefined,
    hasPaymentMethod: undefined,
  })

  return (
    <div className="solvapay-mcp-about">
      <section className={`${cx.card} solvapay-mcp-about-product`.trim()}>
        {imageUrl ? (
          <img
            className="solvapay-mcp-about-image"
            src={imageUrl}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <h2 className={cx.heading}>{productName}</h2>
        {description ? (
          <p className="solvapay-mcp-about-description">{description}</p>
        ) : null}
      </section>

      {activity !== 'none' ? (
        <ActivityStrip
          kind={activity}
          classNames={classNames}
          activePurchase={activePurchase}
          onTopup={onTopup}
          onUpgrade={onUpgrade}
        />
      ) : null}

      {(cta1 || cta2 !== 'none') ? (
        <section
          className="solvapay-mcp-about-ctas"
          aria-label={hasActivePurchase ? 'Plan actions' : 'Get started'}
        >
          <h3 className={cx.heading}>Ready to start?</h3>
          <div className="solvapay-mcp-about-cta-grid">
            {cta1 ? (
              <CtaCard
                title={cta1 === 'choose-plan' ? 'Choose a plan' : 'Change plan'}
                body={
                  cta1 === 'choose-plan'
                    ? 'Free, trial, or paid.'
                    : 'Switch to a different plan at any time.'
                }
                buttonLabel={cta1 === 'choose-plan' ? 'See plans' : 'Change plan'}
                onClick={onSeePlans}
                cx={cx}
              />
            ) : null}
            {cta2 === 'start-free' ? (
              <CtaCard
                title="Start free"
                body="No card required — activate in one click."
                buttonLabel="Start free"
                onClick={onSeePlans}
                cx={cx}
              />
            ) : null}
            {cta2 === 'try-payg' ? (
              <CtaCard
                title="Try without subscribing"
                body="Add credits now and pay as you go."
                buttonLabel="Top up"
                onClick={onTopup}
                cx={cx}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {slashCommands && slashCommands.length > 0 ? (
        <section className="solvapay-mcp-about-commands" aria-label="Quick commands">
          <h3 className={cx.heading}>Quick commands</h3>
          <ul className="solvapay-mcp-about-command-list">
            {slashCommands.map((cmd) => (
              <li key={cmd.command}>
                <code className="solvapay-mcp-about-command">/{cmd.command}</code>
                {cmd.description ? (
                  <span className={cx.muted}> — {cmd.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function CtaCard({
  title,
  body,
  buttonLabel,
  onClick,
  cx,
}: {
  title: string
  body: string
  buttonLabel: string
  onClick?: () => void
  cx: ReturnType<typeof resolveMcpClassNames>
}) {
  return (
    <div className={`${cx.card} solvapay-mcp-about-cta`.trim()}>
      <h4 className={cx.heading}>{title}</h4>
      <p className={cx.muted}>{body}</p>
      <button
        type="button"
        className={cx.button}
        onClick={onClick}
        disabled={!onClick}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

function ActivityStrip({
  kind,
  classNames,
  activePurchase,
  onTopup,
  onUpgrade,
}: {
  kind: ActivityStripKind
  classNames?: McpViewClassNames
  activePurchase: ReturnType<typeof usePurchase>['activePurchase']
  onTopup?: () => void
  onUpgrade?: () => void
}) {
  const cx = resolveMcpClassNames(classNames)
  const { credits } = useBalance()
  const { usage } = useUsage()

  return (
    <section
      className={`${cx.card} solvapay-mcp-about-activity`.trim()}
      aria-label="Your activity"
    >
      <h3 className={cx.heading}>Your activity</h3>

      {kind === 'payg-balance' ? (
        <div className={cx.balanceRow}>
          <BalanceBadge />
          <button
            type="button"
            className={cx.button}
            onClick={onTopup}
            disabled={!onTopup}
          >
            Top up
          </button>
        </div>
      ) : null}

      {kind === 'recurring-unlimited-renew' ? (
        <div>
          <p>
            <strong>{activePurchase?.planSnapshot?.name ?? 'Unlimited'}</strong>
            {' — no limits on this plan'}
          </p>
          {activePurchase?.planSnapshot?.billingCycle ? (
            <p className={cx.muted}>
              Billed {activePurchase.planSnapshot.billingCycle}
            </p>
          ) : null}
        </div>
      ) : null}

      {(kind === 'recurring-metered-usage' || kind === 'free-usage') ? (
        <div>
          <UsageMeter.Root>
            <UsageMeter.Label />
            <UsageMeter.Bar />
            <UsageMeter.Percentage />
            <UsageMeter.ResetsIn />
            <UsageMeter.Loading />
            <UsageMeter.Empty />
          </UsageMeter.Root>
          {usage || kind === 'free-usage' ? (
            <button
              type="button"
              className={cx.button}
              onClick={onUpgrade}
              disabled={!onUpgrade}
            >
              Upgrade
            </button>
          ) : null}
          {/* Suppress unused-credits warning on non-PAYG strips. */}
          <span hidden>{credits ?? 0}</span>
        </div>
      ) : null}
    </section>
  )
}
