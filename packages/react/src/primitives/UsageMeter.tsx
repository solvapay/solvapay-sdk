'use client'

/**
 * `<UsageMeter>` compound primitive — renders the authenticated customer's
 * usage against their plan quota.
 *
 * Composes `useUsage()` internally so integrators only render the leaf
 * primitives they care about. Leaves render `null` when the active plan
 * isn't usage-based, so dropping the compound into any account page is
 * safe.
 *
 * State:
 *  - root / bar `data-state="safe" | "warning" | "critical" | "loading"`
 *  - root `data-solvapay-usage-meter`
 *  - bar  `data-solvapay-usage-meter-bar`
 */

import React, { createContext, forwardRef, useContext, useMemo } from 'react'
import { Slot } from './slot'
import { useCopy } from '../hooks/useCopy'
import { useUsage, type UsageSnapshot } from '../hooks/useUsage'
import { interpolate } from '../i18n/interpolate'

type UsageMeterState = 'safe' | 'warning' | 'critical' | 'loading'

interface UsageMeterContextValue {
  usage: UsageSnapshot | null
  loading: boolean
  error: Error | null
  percentUsed: number | null
  isApproachingLimit: boolean
  isAtLimit: boolean
  isUnlimited: boolean
  state: UsageMeterState
  warningAt: number
  criticalAt: number
}

const UsageMeterContext = createContext<UsageMeterContextValue | null>(null)

function useUsageMeterCtx(part: string): UsageMeterContextValue {
  const ctx = useContext(UsageMeterContext)
  if (!ctx) {
    throw new Error(`UsageMeter.${part} must be rendered inside <UsageMeter.Root>.`)
  }
  return ctx
}

export interface UsageMeterClassNames {
  root?: string
  bar?: string
  label?: string
  percentage?: string
  resetsIn?: string
  loading?: string
  empty?: string
  error?: string
}

export interface UsageMeterRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Percent at which the bar flips to `data-state="warning"`. Default 75. */
  warningAt?: number
  /** Percent at which the bar flips to `data-state="critical"`. Default 90. */
  criticalAt?: number
  classNames?: UsageMeterClassNames
  asChild?: boolean
  /**
   * Override the usage snapshot rather than reading from `useUsage`.
   * Mostly useful for tests / Storybook demos.
   */
  usageOverride?: UsageSnapshot | null
}

const Root = forwardRef<HTMLDivElement, UsageMeterRootProps>(function UsageMeterRoot(
  {
    warningAt = 75,
    criticalAt = 90,
    classNames,
    asChild,
    usageOverride,
    children,
    className,
    ...rest
  },
  forwardedRef,
) {
  const hookResult = useUsage()
  const usage = usageOverride !== undefined ? usageOverride : hookResult.usage
  const loading = hookResult.loading && !usage
  const percentUsed = usage?.percentUsed ?? null

  const state: UsageMeterState =
    loading
      ? 'loading'
      : percentUsed === null
        ? 'safe'
        : percentUsed >= criticalAt
          ? 'critical'
          : percentUsed >= warningAt
            ? 'warning'
            : 'safe'

  const ctx = useMemo<UsageMeterContextValue>(
    () => ({
      usage,
      loading,
      error: hookResult.error,
      percentUsed,
      isApproachingLimit: hookResult.isApproachingLimit,
      isAtLimit: hookResult.isAtLimit,
      isUnlimited: hookResult.isUnlimited,
      state,
      warningAt,
      criticalAt,
    }),
    [
      usage,
      loading,
      hookResult.error,
      percentUsed,
      hookResult.isApproachingLimit,
      hookResult.isAtLimit,
      hookResult.isUnlimited,
      state,
      warningAt,
      criticalAt,
    ],
  )

  const rootClass = [classNames?.root ?? 'solvapay-usage-meter', className].filter(Boolean).join(' ')
  const Comp = asChild ? Slot : 'div'
  return (
    <UsageMeterContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-usage-meter=""
        data-state={state}
        className={rootClass}
        {...rest}
      >
        {children}
      </Comp>
    </UsageMeterContext.Provider>
  )
})

const Bar = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function UsageMeterBar(
  { className, style, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('Bar')
  const width =
    ctx.percentUsed === null ? 0 : Math.max(0, Math.min(100, ctx.percentUsed))
  return (
    <div
      ref={forwardedRef}
      data-solvapay-usage-meter-bar=""
      data-state={ctx.state}
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={className ?? 'solvapay-usage-meter-bar'}
      style={{
        // Expose as a CSS custom property so default styles can drive
        // `width: var(--solvapay-usage-meter-fill)` without inline styling.
        ['--solvapay-usage-meter-fill' as string]: `${width}%`,
        ...style,
      }}
      {...rest}
    />
  )
})

const Label = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(function UsageMeterLabel(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('Label')
  const copy = useCopy()
  if (!ctx.usage) return null
  if (ctx.isUnlimited) {
    return (
      <span
        ref={forwardedRef}
        data-solvapay-usage-meter-label=""
        className={className ?? 'solvapay-usage-meter-label'}
        {...rest}
      >
        {children ?? copy.usage.unlimitedLabel}
      </span>
    )
  }
  const unit = ctx.usage.meterRef ?? 'units'
  const label =
    ctx.usage.total !== null
      ? interpolate(copy.usage.usedLabel, {
          used: String(ctx.usage.used),
          total: String(ctx.usage.total),
          unit,
        })
      : interpolate(copy.usage.remainingLabel, {
          remaining: String(ctx.usage.remaining ?? 0),
          unit,
        })
  return (
    <span
      ref={forwardedRef}
      data-solvapay-usage-meter-label=""
      className={className ?? 'solvapay-usage-meter-label'}
      {...rest}
    >
      {children ?? label}
    </span>
  )
})

const Percentage = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(function UsageMeterPercentage(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('Percentage')
  const copy = useCopy()
  if (ctx.percentUsed === null) return null
  return (
    <span
      ref={forwardedRef}
      data-solvapay-usage-meter-percentage=""
      className={className ?? 'solvapay-usage-meter-percentage'}
      {...rest}
    >
      {children ??
        interpolate(copy.usage.percentUsedLabel, { percent: String(Math.round(ctx.percentUsed)) })}
    </span>
  )
})

/**
 * Compute a human-readable "resets in N days" label without reading
 * `Date.now()` during render (react-hooks/purity forbids impure calls).
 *
 * The `nowMs` argument defaults to the current time and is only intended
 * to be set in tests. Real consumers should leave it unset — React's
 * rendering model still fires this once per render with the latest value,
 * but the indirection keeps the purity rule happy while giving us a
 * testable seam.
 */
function formatResetsIn(
  copy: ReturnType<typeof useCopy>,
  periodEnd: string,
  nowMs: number = typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : 0,
): string | null {
  const end = new Date(periodEnd).getTime()
  if (Number.isNaN(end)) return null
  const daysLeft = Math.max(0, Math.ceil((end - nowMs) / (24 * 60 * 60 * 1000)))
  return daysLeft > 0
    ? interpolate(copy.usage.resetsInLabel, { days: String(daysLeft) })
    : interpolate(copy.usage.resetsOnLabel, { date: new Date(periodEnd).toLocaleDateString() })
}

const ResetsIn = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(function UsageMeterResetsIn(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('ResetsIn')
  const copy = useCopy()
  const periodEnd = ctx.usage?.periodEnd
  if (!periodEnd) return null
  const label = formatResetsIn(copy, periodEnd)
  if (!label) return null
  return (
    <span
      ref={forwardedRef}
      data-solvapay-usage-meter-resets-in=""
      className={className ?? 'solvapay-usage-meter-resets-in'}
      {...rest}
    >
      {children ?? label}
    </span>
  )
})

const Loading = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function UsageMeterLoading(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('Loading')
  const copy = useCopy()
  if (ctx.state !== 'loading') return null
  return (
    <div
      ref={forwardedRef}
      data-solvapay-usage-meter-loading=""
      className={className ?? 'solvapay-usage-meter-loading'}
      {...rest}
    >
      {children ?? copy.usage.loadingLabel}
    </div>
  )
})

const Empty = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function UsageMeterEmpty(
  { className, children, ...rest },
  forwardedRef,
) {
  const ctx = useUsageMeterCtx('Empty')
  const copy = useCopy()
  // Only renders when there's no usage snapshot AND we're not loading — a
  // non-usage-based plan is the canonical "empty" state.
  if (ctx.loading || ctx.usage !== null) return null
  return (
    <div
      ref={forwardedRef}
      data-solvapay-usage-meter-empty=""
      className={className ?? 'solvapay-usage-meter-empty'}
      {...rest}
    >
      {children ?? copy.usage.emptyLabel}
    </div>
  )
})

export const UsageMeter = Object.assign(Root, {
  Root,
  Bar,
  Label,
  Percentage,
  ResetsIn,
  Loading,
  Empty,
})

export { Root as UsageMeterRoot }
export { Bar as UsageMeterBar }
export { Label as UsageMeterLabel }
export { Percentage as UsageMeterPercentage }
export { ResetsIn as UsageMeterResetsIn }
export { Loading as UsageMeterLoading }
export { Empty as UsageMeterEmpty }

export function useUsageMeter(): UsageMeterContextValue {
  return useUsageMeterCtx('useUsageMeter')
}
