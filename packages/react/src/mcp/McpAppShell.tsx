'use client'

/**
 * `<McpAppShell>` — persistent in-iframe shell with tab navigation.
 *
 * Wraps `<McpViewRouter>` so end users can move between views
 * (About / Plan / Top up / Account) without a second MCP tool call.
 * `bootstrap.view` is the initial tab; tab changes mutate local state
 * only, re-using the module-level caches seeded by `seedMcpCaches`
 * during initial mount.
 *
 * Visibility rules live in `computeVisibleTabs()`:
 *  - About — always visible. It's the product landing page.
 *  - Plan — always visible. Contextual (picker vs active-plan summary).
 *  - Top up — visible when any usage-based plan exists, the customer
 *    holds one, or has a non-zero credit balance.
 *  - Account — visible when `customer != null`. Carries balance +
 *    usage meter inline (the former "Credits" tab).
 *
 * The paywall view takes over the whole viewport (no tabs, no footer)
 * because it's a gate, not a destination.
 *
 * Accessibility:
 *  - The tab row uses `role="tablist"` with `role="tab"` children.
 *  - Active tab has `aria-selected="true"` and `tabindex="0"`; siblings
 *    use `tabindex="-1"`.
 *  - ArrowLeft / ArrowRight cycle focus, Home / End jump to ends,
 *    Enter / Space activates the focused tab.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePurchase } from '../hooks/usePurchase'
import { useBalance } from '../hooks/useBalance'
import { useUsage } from '../hooks/useUsage'
import { useMerchant } from '../hooks/useMerchant'
import type { McpBootstrap } from './bootstrap'
import type { McpAppViewOverrides } from './McpApp'
import { McpFirstRunTour, TourReplayButton } from './McpFirstRunTour'
import { MCP_TAB_HINTS, TAB_LABELS } from './tab-metadata'
import { MCP_TAB_ORDER, type McpTabKind } from './tab-kind'
import {
  McpAboutView,
  type McpAboutViewProps,
} from './views/McpAboutView'
import {
  McpAccountView,
  type McpAccountViewProps,
} from './views/McpAccountView'
import { McpCustomerDetailsCard, McpSellerDetailsCard } from './views/detail-cards'
import {
  McpActivateView,
  type McpActivateViewProps,
} from './views/McpActivateView'
import {
  McpCheckoutView,
  type McpCheckoutViewProps,
} from './views/McpCheckoutView'
import {
  McpPaywallView,
  type McpPaywallViewProps,
} from './views/McpPaywallView'
import {
  McpTopupView,
  type McpTopupViewProps,
} from './views/McpTopupView'
import {
  McpUsageView,
  type McpUsageViewProps,
} from './views/McpUsageView'
import {
  McpNudgeView,
  type McpNudgeViewProps,
} from './views/McpNudgeView'
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'

export { MCP_TAB_HINTS } from './tab-metadata'
export { MCP_TAB_ORDER, type McpTabKind } from './tab-kind'

export interface McpAppShellProps {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /** `'auto'` (default) runs the visibility rules; `'all'` pins every known tab; array pins the given list in that order. */
  tabs?: 'auto' | 'all' | McpTabKind[]
  /** Render the footer? Defaults to `true` when the merchant has any of support/terms/privacy URLs. */
  footer?: boolean
  /**
   * Optional slash-command hints forwarded to `<McpAboutView>`. The
   * `<McpApp>` wrapper derives these from the server's prompt
   * registrations; standalone consumers can pass their own list.
   */
  slashCommands?: Array<{ command: string; description: string }>
  /**
   * Refresh the bootstrap snapshot. Wired by `<McpApp>` to
   * `SolvaPayProvider.refreshInitial` so a stale tab switch can
   * re-seed the caches. Called with no args, awaited, errors swallowed
   * (the nav is a soft signal, not a user-driven refresh).
   */
  onRefreshBootstrap?: () => void | Promise<void>
}

/** How stale the cache can be before a tab switch triggers a refresh. */
const STALE_THRESHOLD_MS = 60_000

/**
 * Compute the set of tabs the shell should render. Returned list is
 * stable in `MCP_TAB_ORDER` order so the strip never re-shuffles.
 *
 * The default set is About / Plan / Top up / Account. Credits folds
 * into Account; Activate merges into Plan. Integrators who want the
 * legacy tabs can pass `tabs='all'` or pass an explicit array.
 */
export function computeVisibleTabs(
  bootstrap: McpBootstrap,
  override: McpAppShellProps['tabs'] = 'auto',
): McpTabKind[] {
  if (override === 'all') return [...MCP_TAB_ORDER]
  if (Array.isArray(override)) {
    return override.filter((t): t is McpTabKind => MCP_TAB_ORDER.includes(t))
  }

  const visible = new Set<McpTabKind>()
  const customer = bootstrap.customer
  const plans = bootstrap.plans ?? []
  const activePurchase = (customer?.purchase?.purchases?.[0] ?? null) as
    | { planSnapshot?: PlanSnapshotLike | null }
    | null
  const planSnapshot = activePurchase?.planSnapshot ?? null
  const hasUsageBasedPlan = plans.some((p) => isUsageBasedPlan(p as PlanSnapshotLike))
  const customerHasUsageBased = planSnapshot ? isUsageBasedPlan(planSnapshot) : false
  const hasBalanceData = customer?.balance != null

  // About — always visible. Cold-start users land here; returning
  // customers still use it as the product info / slash-command hub.
  visible.add('about')

  // Plan — always visible. Empty state = picker; active state =
  // current-plan summary.
  visible.add('checkout')

  // Top up — any usage-based plan on the product, the customer holds
  // one, or has a non-zero credit balance.
  if (hasUsageBasedPlan || customerHasUsageBased || hasBalanceData) {
    visible.add('topup')
  }

  // Account — only when authenticated.
  if (customer !== null) {
    visible.add('account')
  }

  return MCP_TAB_ORDER.filter((tab) => visible.has(tab))
}

interface PlanSnapshotLike {
  planType?: string
  meterRef?: string | null
  meterId?: string | null
  limit?: number | null
}

function isUsageBasedPlan(plan: PlanSnapshotLike | null | undefined): boolean {
  if (!plan) return false
  return plan.planType === 'usage-based' || Boolean(plan.meterRef) || Boolean(plan.meterId)
}

function isUnlimitedPlan(plan: PlanSnapshotLike | null | undefined): boolean {
  if (!plan) return false
  if (plan.planType !== 'recurring') return false
  return !plan.meterRef && !plan.meterId && (plan.limit == null || plan.limit === 0)
}

/**
 * `McpViewRouter`-equivalent that promotes the active view to local
 * state so tab changes don't require a tool call.
 */
export function McpAppShell({
  bootstrap,
  views,
  classNames,
  tabs = 'auto',
  footer,
  slashCommands,
  onRefreshBootstrap,
}: McpAppShellProps) {
  const visibleTabs = useMemo(() => computeVisibleTabs(bootstrap, tabs), [bootstrap, tabs])
  const { merchant } = useMerchant()
  const [paywallDismissed, setPaywallDismissed] = useState(false)

  const isPaywall = bootstrap.view === 'paywall' && !paywallDismissed
  // Nudge view has the same "no tab strip, render bespoke content"
  // shape as the paywall — handled alongside it in the render tree.
  const isNudge = bootstrap.view === 'nudge'

  // Treat the incoming `bootstrap.view` as the *initial* tab; tab
  // changes after that mutate local state only. The server may route
  // `manage_account` → `'about'` for cold-start customers; we honour
  // it when the tab is visible.
  const initialTab: McpTabKind = useMemo(() => {
    if (isPaywall) return 'about'
    const incoming = bootstrap.view
    const mapped: McpTabKind | null =
      incoming === 'about' ||
      incoming === 'activate' ||
      incoming === 'account' ||
      incoming === 'topup' ||
      incoming === 'checkout' ||
      incoming === 'usage'
        ? (incoming satisfies McpTabKind)
        : null
    // Legacy `activate` routes to the merged Plan tab.
    if (mapped === 'activate' && !visibleTabs.includes('activate')) {
      return visibleTabs.includes('checkout') ? 'checkout' : (visibleTabs[0] ?? 'checkout')
    }
    if (mapped && visibleTabs.includes(mapped)) return mapped
    return visibleTabs[0] ?? 'checkout'
  }, [bootstrap.view, visibleTabs, isPaywall])

  const [selectedTab, setSelectedTab] = useState<McpTabKind>(initialTab)
  // Derive the active tab during render so a no-longer-visible selection
  // snaps to the first visible tab without a setState-in-effect cascade
  // (see https://react.dev/learn/you-might-not-need-an-effect).
  const activeTab: McpTabKind = visibleTabs.includes(selectedTab)
    ? selectedTab
    : (visibleTabs[0] ?? 'checkout')
  // Initialised in a mount effect (below) rather than at render time —
  // `Date.now()` is impure and the React compiler/linter forbids it in
  // render bodies (including `useRef` initialisers).
  const lastRefreshedAtRef = useRef<number>(0)
  const [tourForceOpen, setTourForceOpen] = useState(0)

  useEffect(() => {
    lastRefreshedAtRef.current = Date.now()
  }, [])

  const handleSelect = useCallback(
    (next: McpTabKind) => {
      if (next === activeTab) return
      setSelectedTab(next)
      const now = Date.now()
      if (onRefreshBootstrap && now - lastRefreshedAtRef.current > STALE_THRESHOLD_MS) {
        lastRefreshedAtRef.current = now
        void Promise.resolve(onRefreshBootstrap()).catch(() => {
          /* best-effort. */
        })
      }
    },
    [activeTab, onRefreshBootstrap],
  )

  const showFooter = footer ?? Boolean(merchant?.termsUrl || merchant?.privacyUrl)

  const isShellSidebarEligible = bootstrap.customer !== null

  // Product-driven title; the merchant/brand marker stays above it.
  const productName =
    (bootstrap.product as { name?: string } | undefined)?.name ?? null

  return (
    <div className="solvapay-mcp-shell" data-paywall={isPaywall ? 'true' : undefined}>
      <ShellHeader
        merchant={merchant}
        productName={productName}
        classNames={classNames}
        onReplayTour={isPaywall ? undefined : () => setTourForceOpen((n) => n + 1)}
      />

      {!isPaywall && !isNudge && visibleTabs.length > 1 ? (
        <McpTabBar
          tabs={visibleTabs}
          active={activeTab}
          onSelect={handleSelect}
          hideAtWide={['account']}
        />
      ) : null}

      <div className="solvapay-mcp-shell-layout">
        <div className="solvapay-mcp-shell-body">
          {isPaywall ? (
            <ShellPaywallContent
              bootstrap={bootstrap}
              views={views}
              classNames={classNames}
              onUpgradeRequested={() => {
                setPaywallDismissed(true)
                setSelectedTab('checkout')
              }}
            />
          ) : isNudge ? (
            <ShellNudgeContent
              bootstrap={bootstrap}
              views={views}
              classNames={classNames}
              onUpgradeRequested={() => {
                // Nudge CTA opens the checkout tab in the same shell,
                // mirroring the paywall "Upgrade" flow.
                setSelectedTab('checkout')
              }}
            />
          ) : (
            <ShellTabContent
              tab={activeTab}
              bootstrap={bootstrap}
              views={views}
              classNames={classNames}
              slashCommands={slashCommands}
              onSelect={handleSelect}
              suppressDetailCards={isShellSidebarEligible}
            />
          )}
        </div>

        {!isPaywall && !isNudge && isShellSidebarEligible ? (
          <aside className="solvapay-mcp-shell-sidebar" aria-label="Your account context">
            <McpSellerDetailsCard classNames={classNames} />
            <McpCustomerDetailsCard
              classNames={classNames}
              onTopup={() => handleSelect('topup')}
            />
          </aside>
        ) : null}
      </div>

      {!isPaywall && !isNudge && showFooter ? (
        <ShellFooter classNames={classNames} merchant={merchant} />
      ) : null}

      {!isPaywall && !isNudge ? (
        <McpFirstRunTour
          key={tourForceOpen}
          forceOpen={tourForceOpen > 0}
        />
      ) : null}
    </div>
  )
}

function ShellHeader({
  merchant,
  productName,
  classNames,
  onReplayTour,
}: {
  merchant: ReturnType<typeof useMerchant>['merchant']
  productName: string | null
  classNames?: McpViewClassNames
  onReplayTour?: () => void
}) {
  const cx = resolveMcpClassNames(classNames)
  const displayName = merchant?.displayName ?? null
  const logoUrl = merchant?.logoUrl ?? null
  const initials = displayName
    ? displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join('')
    : 'SP'

  // Fallback chain: product.name → merchant.displayName → 'My account'.
  const headingText = productName ?? displayName ?? 'My account'

  return (
    <header className="solvapay-mcp-shell-header">
      <div className="solvapay-mcp-shell-brand">
        {logoUrl ? (
          <img
            className="solvapay-mcp-shell-logo"
            src={logoUrl}
            alt={displayName ?? 'Merchant logo'}
          />
        ) : (
          <span className="solvapay-mcp-shell-logo-initials" aria-hidden="true">
            {initials}
          </span>
        )}
        {displayName ? (
          <span className="solvapay-mcp-shell-brand-name">{displayName}</span>
        ) : null}
      </div>
      <h1 className={`${cx.heading} solvapay-mcp-shell-title`.trim()}>{headingText}</h1>
      {onReplayTour ? <TourReplayButton onReplay={onReplayTour} /> : null}
    </header>
  )
}

function ShellFooter({
  classNames,
  merchant,
}: {
  classNames?: McpViewClassNames
  merchant: ReturnType<typeof useMerchant>['merchant']
}) {
  const cx = resolveMcpClassNames(classNames)
  const termsUrl = merchant?.termsUrl
  const privacyUrl = merchant?.privacyUrl

  if (!termsUrl && !privacyUrl) {
    return (
      <footer className={`solvapay-mcp-shell-footer ${cx.muted}`.trim()}>
        Provided by SolvaPay
      </footer>
    )
  }

  return (
    <footer className={`solvapay-mcp-shell-footer ${cx.muted}`.trim()}>
      {termsUrl ? (
        <a
          className="solvapay-mcp-shell-footer-link"
          href={termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Terms (opens in a new tab)"
        >
          Terms
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
        </a>
      ) : null}
      {termsUrl && privacyUrl ? <span aria-hidden="true"> · </span> : null}
      {privacyUrl ? (
        <a
          className="solvapay-mcp-shell-footer-link"
          href={privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Privacy (opens in a new tab)"
        >
          Privacy
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
        </a>
      ) : null}
      <span aria-hidden="true"> · </span>
      <span>Provided by SolvaPay</span>
    </footer>
  )
}

interface McpTabBarProps {
  tabs: McpTabKind[]
  active: McpTabKind
  onSelect: (tab: McpTabKind) => void
  hideAtWide?: McpTabKind[]
}

function McpTabBar({ tabs, active, onSelect, hideAtWide }: McpTabBarProps) {
  const tabRefs = useRef(new Map<McpTabKind, HTMLButtonElement | null>())

  const focusTab = useCallback((tab: McpTabKind) => {
    const el = tabRefs.current.get(tab)
    el?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, tab: McpTabKind) => {
      const currentIndex = tabs.indexOf(tab)
      if (currentIndex === -1) return

      switch (event.key) {
        case 'ArrowRight': {
          event.preventDefault()
          const next = tabs[(currentIndex + 1) % tabs.length]
          focusTab(next)
          break
        }
        case 'ArrowLeft': {
          event.preventDefault()
          const next = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
          focusTab(next)
          break
        }
        case 'Home': {
          event.preventDefault()
          focusTab(tabs[0])
          break
        }
        case 'End': {
          event.preventDefault()
          focusTab(tabs[tabs.length - 1])
          break
        }
        case 'Enter':
        case ' ': {
          event.preventDefault()
          onSelect(tab)
          break
        }
        default:
          break
      }
    },
    [tabs, onSelect, focusTab],
  )

  return (
    <div className="solvapay-mcp-tablist" role="tablist" aria-label="Account sections">
      {tabs.map((tab) => {
        const isActive = tab === active
        const hideWide = hideAtWide?.includes(tab) ? 'true' : undefined
        const hintId = `solvapay-mcp-tab-hint-${tab}`
        return (
          <React.Fragment key={tab}>
            <button
              ref={(el) => {
                tabRefs.current.set(tab, el)
              }}
              role="tab"
              type="button"
              id={`solvapay-mcp-tab-${tab}`}
              aria-selected={isActive}
              aria-controls={`solvapay-mcp-tabpanel-${tab}`}
              aria-describedby={hintId}
              tabIndex={isActive ? 0 : -1}
              className="solvapay-mcp-tab"
              data-active={isActive ? 'true' : undefined}
              data-kind={tab}
              data-hide-wide={hideWide}
              data-tour-step={tab}
              title={MCP_TAB_HINTS[tab]}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => handleKeyDown(event, tab)}
            >
              {TAB_LABELS[tab]}
            </button>
            <span id={hintId} hidden>
              {MCP_TAB_HINTS[tab]}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

type RenderTabArgs = {
  tab: McpTabKind
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  slashCommands?: Array<{ command: string; description: string }>
  onSelect: (tab: McpTabKind) => void
  suppressDetailCards?: boolean
}

// Rendered as a JSX component (`<ShellTabContent … />`) rather than a
// plain helper function so React compiler / `react-hooks/refs` treats
// callback props attached to the returned tree as event handlers and
// doesn't flag them as "ref read during render".
function ShellTabContent({
  tab,
  bootstrap,
  views,
  classNames,
  slashCommands,
  onSelect,
  suppressDetailCards,
}: RenderTabArgs): React.ReactNode {
  const { productRef, stripePublishableKey, returnUrl } = bootstrap
  const AboutView = (views?.about ?? McpAboutView) as React.ComponentType<McpAboutViewProps>
  const CheckoutView = (views?.checkout ?? McpCheckoutView) as React.ComponentType<McpCheckoutViewProps>
  const AccountView = (views?.account ?? McpAccountView) as React.ComponentType<McpAccountViewProps>
  const TopupView = (views?.topup ?? McpTopupView) as React.ComponentType<McpTopupViewProps>
  const ActivateView = (views?.activate ?? McpActivateView) as React.ComponentType<McpActivateViewProps>
  const UsageView = (views?.usage ?? McpUsageView) as React.ComponentType<McpUsageViewProps>

  const panel = (body: React.ReactNode) => (
    <div
      role="tabpanel"
      id={`solvapay-mcp-tabpanel-${tab}`}
      aria-labelledby={`solvapay-mcp-tab-${tab}`}
      className="solvapay-mcp-shell-panel"
    >
      {body}
    </div>
  )

  switch (tab) {
    case 'about':
      return panel(
        <AboutView
          bootstrap={bootstrap}
          classNames={classNames}
          slashCommands={slashCommands}
          onSeePlans={() => onSelect('checkout')}
          onTopup={() => onSelect('topup')}
          onUpgrade={() => onSelect('checkout')}
        />,
      )
    case 'checkout':
      return panel(
        <CheckoutView
          productRef={productRef}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
          onRequestTopup={() => onSelect('topup')}
        />,
      )
    case 'account':
      return panel(
        <AccountView
          classNames={classNames}
          onTopup={() => onSelect('topup')}
          onChangePlan={() => onSelect('checkout')}
          hideDetailCards={suppressDetailCards}
        />,
      )
    case 'topup':
      return panel(
        <TopupView
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
          onBack={() => onSelect('account')}
        />,
      )
    case 'activate':
      return panel(<ActivateView productRef={productRef} classNames={classNames} />)
    case 'usage':
      return panel(
        <UnlimitedAwareUsageView
          View={UsageView}
          classNames={classNames}
          onRequestTopup={() => onSelect('topup')}
          onRequestUpgrade={() => onSelect('checkout')}
        />,
      )
    default:
      return null
  }
}

function ShellNudgeContent({
  bootstrap,
  views,
  classNames,
  onUpgradeRequested,
}: {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  onUpgradeRequested: () => void
}) {
  const NudgeView = (views?.nudge ?? McpNudgeView) as React.ComponentType<McpNudgeViewProps>
  return (
    <NudgeView
      bootstrap={bootstrap}
      onCta={onUpgradeRequested}
      classNames={classNames}
    />
  )
}

function ShellPaywallContent({
  bootstrap,
  views,
  classNames,
  onUpgradeRequested,
}: {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  onUpgradeRequested: () => void
}) {
  const PaywallView = (views?.paywall ?? McpPaywallView) as React.ComponentType<McpPaywallViewProps>
  if (!bootstrap.paywall) return null

  const upgradeCandidate = findRecurringPlan(bootstrap.plans)
  const upgradeCta = upgradeCandidate
    ? {
        label: formatUpgradeLabel(upgradeCandidate),
        onClick: onUpgradeRequested,
      }
    : undefined

  return (
    <PaywallView
      content={bootstrap.paywall}
      publishableKey={bootstrap.stripePublishableKey}
      returnUrl={bootstrap.returnUrl}
      classNames={classNames}
      upgradeCta={upgradeCta}
    />
  )
}

interface UpgradeCandidatePlan {
  reference?: string
  name?: string | null
  price?: number
  currency?: string
  planType?: string
  billingCycle?: string | null
  meterRef?: string | null
  limit?: number | null
}

function findRecurringPlan(plans: McpBootstrap['plans']): UpgradeCandidatePlan | null {
  const list = plans as unknown as UpgradeCandidatePlan[] | undefined
  if (!list || list.length === 0) return null
  const match = list.find((p) => {
    if (p.planType !== 'recurring') return false
    return !p.meterRef
  })
  return match ?? null
}

function formatUpgradeLabel(plan: UpgradeCandidatePlan): string {
  const name = plan.name ?? 'Unlimited'
  if (typeof plan.price === 'number' && plan.price > 0 && plan.currency) {
    const amount = Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(plan.price / 100)
    const cycle = plan.billingCycle ? `/${plan.billingCycle.slice(0, 2)}` : ''
    return `Upgrade to ${name} — ${amount}${cycle}`
  }
  return `Upgrade to ${name}`
}

function UnlimitedAwareUsageView({
  View,
  classNames,
  onRequestTopup,
  onRequestUpgrade,
}: {
  View: React.ComponentType<McpUsageViewProps>
  classNames?: McpViewClassNames
  onRequestTopup: () => void
  onRequestUpgrade: () => void
}) {
  const cx = resolveMcpClassNames(classNames)
  const { activePurchase, loading } = usePurchase()
  const { usage } = useUsage()
  const { credits } = useBalance()

  const planSnapshot = activePurchase?.planSnapshot
  const unlimited = planSnapshot ? isUnlimitedPlan(planSnapshot) : false

  if (!loading && unlimited && usage == null && (credits ?? 0) === 0) {
    const planName = planSnapshot?.name ?? 'Unlimited'
    const cycle = planSnapshot?.billingCycle
    return (
      <div className={cx.card} aria-label="Unlimited plan summary">
        <h2 className={cx.heading}>{planName} — no limits on this plan</h2>
        <p className={cx.muted}>
          {cycle
            ? `Billed ${cycle}. Use as much as you like — we won't meter this plan.`
            : "Use as much as you like — we won't meter this plan."}
        </p>
      </div>
    )
  }

  return (
    <View
      classNames={classNames}
      onRequestTopup={onRequestTopup}
      onRequestUpgrade={onRequestUpgrade}
    />
  )
}
