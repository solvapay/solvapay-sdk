'use client'

/**
 * `<McpAppShell>` — persistent in-iframe shell with tab navigation.
 *
 * Wraps `<McpViewRouter>` so end users can move between views
 * (Credits / Plan / Top up / Account / Activate) without a second MCP
 * tool call. `bootstrap.view` is the initial tab; tab changes mutate
 * local state only, re-using the module-level caches seeded by
 * `seedMcpCaches` during initial mount.
 *
 * Visibility rules live in `computeVisibleTabs()` — Credits hides when
 * the customer has no usage/balance/unlimited plan, Top up hides when
 * no usage-based plan exists, etc. The paywall view takes over the
 * whole viewport (no tabs, no footer) because it's a gate, not a
 * destination.
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
import { resolveMcpClassNames, type McpViewClassNames } from './views/types'

export type McpTabKind = 'usage' | 'checkout' | 'topup' | 'account' | 'activate'

/**
 * Stable ordering used by the tab strip. `usage` (rendered as
 * "Credits") sits first because it's the most-revisited view and the
 * natural landing spot after a paywall resolution.
 */
export const MCP_TAB_ORDER: McpTabKind[] = [
  'usage',
  'checkout',
  'topup',
  'account',
  'activate',
]

const TAB_LABELS: Record<McpTabKind, string> = {
  usage: 'Credits',
  checkout: 'Plan',
  topup: 'Top up',
  account: 'Account',
  activate: 'Activate',
}

export interface McpAppShellProps {
  bootstrap: McpBootstrap
  views?: McpAppViewOverrides
  classNames?: McpViewClassNames
  /** `'auto'` (default) runs the visibility rules; `'all'` pins all five; array pins the given list in that order. */
  tabs?: 'auto' | 'all' | McpTabKind[]
  /** Render the footer? Defaults to `true` when the merchant has any of support/terms/privacy URLs. */
  footer?: boolean
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
 */
export function computeVisibleTabs(
  bootstrap: McpBootstrap,
  override: McpAppShellProps['tabs'] = 'auto',
): McpTabKind[] {
  if (override === 'all') return [...MCP_TAB_ORDER]
  if (Array.isArray(override)) {
    // Keep consumer-specified order, filter to known kinds.
    return override.filter((t): t is McpTabKind => MCP_TAB_ORDER.includes(t))
  }

  const visible = new Set<McpTabKind>()
  const customer = bootstrap.customer
  const plans = bootstrap.plans ?? []
  // `BootstrapCustomer.purchase` is a `PurchaseCheckResult` whose
  // `purchases` array holds the full per-purchase records; the plan
  // snapshot lives on the first entry.
  const activePurchase = (customer?.purchase?.purchases?.[0] ?? null) as
    | { planSnapshot?: PlanSnapshotLike | null }
    | null
  const planSnapshot = activePurchase?.planSnapshot ?? null
  const hasUsageBasedPlan = plans.some((p) => isUsageBasedPlan(p as PlanSnapshotLike))
  const customerHasUsageBased = planSnapshot ? isUsageBasedPlan(planSnapshot) : false
  const isUnlimitedPurchase = planSnapshot ? isUnlimitedPlan(planSnapshot) : false
  const hasUsageData = customer?.usage != null
  const hasBalanceData = customer?.balance != null

  // Credits — metered usage, prepaid balance, or an affirming
  // "Unlimited" state for recurring customers.
  if (hasUsageData || hasBalanceData || isUnlimitedPurchase) {
    visible.add('usage')
  }

  // Plan — always present, the guaranteed fallback.
  visible.add('checkout')

  // Top up — any usage-based plan on the product, or customer already
  // holds one.
  if (hasUsageBasedPlan || customerHasUsageBased) {
    visible.add('topup')
  }

  // Account — only when authenticated. (Phase 5 hides it at `xl` in
  // favour of the sidebar, but the shell itself stays breakpoint-
  // agnostic; the caller / CSS decides.)
  if (customer !== null) {
    visible.add('account')
  }

  // Activate — when at least one plan could plausibly be activated
  // (free plan, or any plan we haven't already activated). Keeping
  // this permissive; `McpActivateView` filters further.
  if (plans.length > 0) {
    visible.add('activate')
  }

  return MCP_TAB_ORDER.filter((tab) => visible.has(tab))
}

interface PlanSnapshotLike {
  planType?: string
  meterRef?: string | null
  /** Present on `BootstrapPlan`; absent on `PurchaseCheckResult.purchases[i].planSnapshot`. */
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
  onRefreshBootstrap,
}: McpAppShellProps) {
  const cx = resolveMcpClassNames(classNames)
  const visibleTabs = useMemo(() => computeVisibleTabs(bootstrap, tabs), [bootstrap, tabs])
  const { merchant } = useMerchant()
  // When the user picks the paywall's secondary "Upgrade" CTA, dismiss
  // the gate locally and route the shell into the Plan tab. The
  // bootstrap's `view` still reads `'paywall'`, but the user has
  // escaped into the regular tabbed flow.
  const [paywallDismissed, setPaywallDismissed] = useState(false)

  // Paywall is a take-over — it doesn't participate in the tab strip.
  const isPaywall = bootstrap.view === 'paywall' && !paywallDismissed

  // Treat the incoming `bootstrap.view` as the *initial* tab; tab
  // changes after that mutate local state only.
  const initialTab: McpTabKind = useMemo(() => {
    if (isPaywall) return 'usage'
    const incoming = bootstrap.view
    if (incoming === 'activate' || incoming === 'account' || incoming === 'topup' || incoming === 'checkout' || incoming === 'usage') {
      if (visibleTabs.includes(incoming)) return incoming
    }
    return visibleTabs[0] ?? 'checkout'
  }, [bootstrap.view, visibleTabs, isPaywall])

  const [activeTab, setActiveTab] = useState<McpTabKind>(initialTab)
  const lastRefreshedAtRef = useRef<number>(Date.now())

  // Snap the active tab back inside the visible set when a refresh
  // removes it (e.g. the customer cancels their usage-based purchase
  // and the Top up tab disappears).
  useEffect(() => {
    if (!visibleTabs.includes(activeTab) && visibleTabs.length > 0) {
      setActiveTab(visibleTabs[0])
    }
  }, [visibleTabs, activeTab])

  const handleSelect = useCallback(
    (next: McpTabKind) => {
      if (next === activeTab) return
      setActiveTab(next)
      const now = Date.now()
      if (onRefreshBootstrap && now - lastRefreshedAtRef.current > STALE_THRESHOLD_MS) {
        lastRefreshedAtRef.current = now
        void Promise.resolve(onRefreshBootstrap()).catch(() => {
          /* best-effort: a nav refresh is a soft signal, not a user-driven retry. */
        })
      }
    },
    [activeTab, onRefreshBootstrap],
  )

  const showFooter =
    footer ?? Boolean(merchant?.termsUrl || merchant?.privacyUrl || merchant?.supportUrl)

  // The responsive sidebar is driven by CSS — at `xl` and above the
  // `.solvapay-mcp-shell-layout` grid gives the aside its own column;
  // below, the aside is `display: none` and Account stays in the tab
  // strip. React can't read the viewport width here reliably (iframes
  // resize, SSR is possible), so we render the sidebar markup only
  // when the customer exists (otherwise Customer/Seller cards would
  // be empty) and let CSS hide it on narrow iframes. The `account`
  // tab is always included in `visibleTabs` — the tab bar filter
  // `isShellSidebarEligible` strips it only from the *rendered* tab
  // list when the sidebar is present, which CSS also gates.
  const isShellSidebarEligible = bootstrap.customer !== null

  return (
    <div className="solvapay-mcp-shell" data-paywall={isPaywall ? 'true' : undefined}>
      <ShellHeader merchant={merchant} classNames={classNames} />

      {!isPaywall && visibleTabs.length > 1 ? (
        <McpTabBar
          tabs={visibleTabs}
          active={activeTab}
          onSelect={handleSelect}
          // CSS hides the Account tab at `xl+` because the sidebar
          // renders the same content there. The data attribute lets
          // `.solvapay-mcp-tab[data-kind="account"]` target it.
          hideAtWide={['account']}
        />
      ) : null}

      <div className="solvapay-mcp-shell-layout">
        <div className="solvapay-mcp-shell-body">
          {isPaywall
            ? renderPaywall({
                bootstrap,
                views,
                classNames,
                onUpgradeRequested: () => {
                  setPaywallDismissed(true)
                  setActiveTab('checkout')
                },
              })
            : renderTab({
                tab: activeTab,
                bootstrap,
                views,
                classNames,
                onSelect: handleSelect,
                suppressDetailCards: isShellSidebarEligible,
              })}
        </div>

        {!isPaywall && isShellSidebarEligible ? (
          <aside className="solvapay-mcp-shell-sidebar" aria-label="Your account context">
            <McpSellerDetailsCard classNames={classNames} />
            <McpCustomerDetailsCard
              classNames={classNames}
              onTopup={() => handleSelect('topup')}
            />
          </aside>
        ) : null}
      </div>

      {!isPaywall && showFooter ? <ShellFooter classNames={classNames} merchant={merchant} /> : null}
    </div>
  )
}

function ShellHeader({
  merchant,
  classNames,
}: {
  merchant: ReturnType<typeof useMerchant>['merchant']
  classNames?: McpViewClassNames
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
      <h1 className={`${cx.heading} solvapay-mcp-shell-title`.trim()}>My account</h1>
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
        >
          Terms
        </a>
      ) : null}
      {termsUrl && privacyUrl ? <span aria-hidden="true"> · </span> : null}
      {privacyUrl ? (
        <a
          className="solvapay-mcp-shell-footer-link"
          href={privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy
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
  /**
   * List of tab kinds that should be hidden at wide viewports (`xl+`)
   * via CSS — typically `['account']` because the sidebar renders the
   * same content there. Hidden tabs stay mounted so keyboard arrow nav
   * doesn't jump, but they're `display: none` at the breakpoint.
   */
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
        return (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current.set(tab, el)
            }}
            role="tab"
            type="button"
            id={`solvapay-mcp-tab-${tab}`}
            aria-selected={isActive}
            aria-controls={`solvapay-mcp-tabpanel-${tab}`}
            tabIndex={isActive ? 0 : -1}
            className="solvapay-mcp-tab"
            data-active={isActive ? 'true' : undefined}
            data-kind={tab}
            data-hide-wide={hideWide}
            onClick={() => onSelect(tab)}
            onKeyDown={(event) => handleKeyDown(event, tab)}
          >
            {TAB_LABELS[tab]}
          </button>
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
  onSelect: (tab: McpTabKind) => void
  /**
   * When `true`, the Account tab body skips its Customer + Seller
   * detail cards because the shell's wide-iframe sidebar already
   * renders them. At narrow viewports the sidebar is hidden and the
   * cards render in-place.
   */
  suppressDetailCards?: boolean
}

function renderTab({ tab, bootstrap, views, classNames, onSelect, suppressDetailCards }: RenderTabArgs): React.ReactNode {
  const { productRef, stripePublishableKey, returnUrl } = bootstrap
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
    case 'checkout':
      return panel(
        <CheckoutView
          productRef={productRef}
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
        />,
      )
    case 'account':
      return panel(
        <AccountView
          classNames={classNames}
          onTopup={() => onSelect('topup')}
          hideDetailCards={suppressDetailCards}
        />,
      )
    case 'topup':
      return panel(
        <TopupView
          publishableKey={stripePublishableKey}
          returnUrl={returnUrl}
          classNames={classNames}
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

function renderPaywall({
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
    // Prefer unlimited recurring (no meter) for the upgrade-out-of-gate
    // CTA — that's the "switch plan, stop metering" branch.
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

/**
 * Wraps `<McpUsageView>` with the "Unlimited — no limits on this
 * plan" empty state defined in the shell's visibility rules. When the
 * customer is on a recurring plan without a meter, we skip the meter
 * primitive (which assumes a numeric limit) and render a confirmation
 * card instead.
 */
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
