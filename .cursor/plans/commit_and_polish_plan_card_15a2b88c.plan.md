---
name: commit and polish plan card
overview: "Commit the completed `defer-customer-portal-prefetch` work, then ship a small follow-up that makes the MCP \"Your plan\" card safe for the 0.2.x demo: collapse to a single CTA renamed \"Manage account\", surface a billing cycle in the price line, and add fine-print explaining where to cancel / update the card."
todos:
  - id: commit
    content: Commit completed defer-customer-portal-prefetch work with conventional-commit message
    status: pending
  - id: cycle-fallback
    content: Fall back to planSnapshot.billingCycle in CurrentPlanCard.tsx + add unit test
    status: pending
  - id: hide-cancel
    content: Pass hideCancelButton on McpAccountView's CurrentPlanCard + add fine-print
    status: pending
  - id: rename-launch
    content: Rename customerPortal.launchButton to 'Manage account' across i18n bundles
    status: pending
  - id: add-portal-hint
    content: Add currentPlan.portalHint copy key (types.ts + en.ts + locales)
    status: pending
  - id: update-tests
    content: "Update McpAccountView tests: no Cancel button, portalHint renders, label is Manage account"
    status: pending
  - id: docs-changeset
    content: Update README.md + add changeset describing cycle fix, single-CTA UX, label rename
    status: pending
  - id: follow-up-todo
    content: Add TODO near CancelPlanButton MCP usage referencing the follow-up to fix inline cancel
    status: pending
isProject: false
---

## Job 1 — Commit completed work

Commit the staged changes from the prior task on the current branch (`fix/mcp-host-ui-polish`). All tests + build already green.

### Files in the commit

- New: [`packages/react/src/hooks/useCustomerSessionUrl.ts`](solvapay-sdk/packages/react/src/hooks/useCustomerSessionUrl.ts), [`packages/react/src/hooks/useCustomerSessionUrl.test.tsx`](solvapay-sdk/packages/react/src/hooks/useCustomerSessionUrl.test.tsx)
- Refactored: [`packages/react/src/components/LaunchCustomerPortalButton.tsx`](solvapay-sdk/packages/react/src/components/LaunchCustomerPortalButton.tsx) + test, [`packages/react/src/components/UpdatePaymentMethodButton.test.tsx`](solvapay-sdk/packages/react/src/components/UpdatePaymentMethodButton.test.tsx)
- One-line: [`packages/react/src/mcp/views/McpAccountView.tsx`](solvapay-sdk/packages/react/src/mcp/views/McpAccountView.tsx) + test
- Docs: [`packages/react/README.md`](solvapay-sdk/packages/react/README.md), [`docs/guides/mcp-app.mdx`](solvapay-sdk/docs/guides/mcp-app.mdx)
- Changeset: [`.changeset/launch-customer-portal-render-eager.md`](solvapay-sdk/.changeset/launch-customer-portal-render-eager.md)

### Commit message (Conventional Commits)

```
feat(react): render-eager LaunchCustomerPortalButton with shared session fetch

Replace the per-mount useEffect prefetch with `useCustomerSessionUrl`, a
WeakMap-keyed hook that shares one in-flight `createCustomerSession()`
across every consumer under the same transport. The button renders
enabled and labelled from first paint regardless of session state; the
ready path is a synchronous <a target="_blank"> click, the cache-miss
path falls back to window.open after awaiting the shared promise.

Also drops the inline Update card button from `<McpAccountView>` (the
portal handles card updates) and updates README + mcp-app guide
language away from the inaccurate "pre-fetches on mount / hover" claim.
```

Plan stays untracked under `.cursor/plans/` (don't commit untracked plan files unless asked).

---

## Job 2 — "Your plan" card polish (new commit on the same branch)

Three small changes scoped to the MCP account view, plus a copy addition. No behavioural change to the public component itself.

### 1. Show billing cycle in the price line

Today `<CurrentPlanCard>` reads `activePurchase.billingCycle` (top-level), but the bootstrap stamps the cycle on `activePurchase.planSnapshot.billingCycle`. Result on the screenshot: `SEK 500` instead of `SEK 500 / month`.

Edit [`packages/react/src/components/CurrentPlanCard.tsx:169-172`](solvapay-sdk/packages/react/src/components/CurrentPlanCard.tsx) to fall back to the snapshot:

```ts
const cycleKey = (activePurchase.billingCycle ??
  activePurchase.planSnapshot?.billingCycle ??
  undefined) as keyof typeof copy.currentPlan.cycleUnit | undefined
```

This is the minimal-blast-radius fix and keeps the existing shape. Add one unit test in [`CurrentPlanCard.test.tsx`](solvapay-sdk/packages/react/src/components/CurrentPlanCard.test.tsx) covering the snapshot-only fallback.

### 2. Hide inline Cancel + Update on the MCP account view, with fine-print

`<CurrentPlanCard>` already supports `hideCancelButton` and `hideUpdatePaymentButton`. The Update flag is already passed (Job 1). Add `hideCancelButton` and a one-line hint underneath the card.

Edit [`packages/react/src/mcp/views/McpAccountView.tsx:121-122`](solvapay-sdk/packages/react/src/mcp/views/McpAccountView.tsx):

```tsx
{hasPaidPurchase ? (
  <>
    <CurrentPlanCard hideUpdatePaymentButton hideCancelButton />
    <p className={cx.muted} data-solvapay-mcp-portal-hint="">
      {copy.currentPlan.portalHint}
    </p>
  </>
) : null}
```

The single CTA below ("Manage account") stays where it is — just rename the label per Job 2.3.

### 2.1. Tests

Update [`McpAccountView.test.tsx`](solvapay-sdk/packages/react/src/mcp/views/__tests__/McpAccountView.test.tsx):

- Existing "no Update card" assertion stays
- Add: no `Cancel plan` link/button on paid plan
- Add: portal hint copy renders on paid plan

### 3. Add `currentPlan.portalHint` copy + rename launch button to "Manage account"

User picked "Manage account" over "Manage billing"/"Manage subscription".

Edit [`packages/react/src/i18n/types.ts`](solvapay-sdk/packages/react/src/i18n/types.ts) and [`packages/react/src/i18n/en.ts`](solvapay-sdk/packages/react/src/i18n/en.ts):

```ts
// types.ts — currentPlan
portalHint: string

// en.ts — currentPlan
portalHint: 'Click Manage account to update your card or cancel your plan.'

// en.ts — customerPortal
launchButton: 'Manage account'  // was 'Manage billing'
```

Mirror the rename in any other locale bundles under [`packages/react/src/i18n/`](solvapay-sdk/packages/react/src/i18n/).

Snapshot/text tests that assert `Manage billing` need updating:

- [`LaunchCustomerPortalButton.test.tsx`](solvapay-sdk/packages/react/src/components/LaunchCustomerPortalButton.test.tsx) — none assert the literal label currently, but verify
- [`McpAccountView.test.tsx`](solvapay-sdk/packages/react/src/mcp/views/__tests__/McpAccountView.test.tsx) — `findByRole('link', { name: /manage billing/i })` becomes `/manage account/i`
- [`UpdatePaymentMethodButton.test.tsx`](solvapay-sdk/packages/react/src/components/UpdatePaymentMethodButton.test.tsx) — `Update card` is still the default label there (separate copy key)

### 4. Docs + changeset

- [`packages/react/README.md`](solvapay-sdk/packages/react/README.md): note that the MCP `<McpAccountView>` collapses card updates and cancellation into the portal CTA
- New [`.changeset/`](solvapay-sdk/.changeset/) patch entry on `@solvapay/react`:
  - Cycle suffix now resolves from `planSnapshot.billingCycle` fallback (bug fix)
  - `<McpAccountView>` collapses to a single "Manage account" portal CTA with explanatory fine-print (UX)
  - `customerPortal.launchButton` copy renamed to "Manage account" (default label change — patch-level since it's a localised string, but flag in the changeset)

### Out of scope (follow-up)

- Root-cause why the inline `<CancelPlanButton>` doesn't work in MCP. Likely candidates: `window.confirm()` ignored in the host iframe sandbox, or the `cancel_purchase` MCP tool failing silently. Owned by a separate issue/branch — capture as a TODO comment near `<CancelPlanButton>` referring to that follow-up so we don't lose it.

### Verification

```bash
pnpm -F @solvapay/react exec vitest run
pnpm -F @solvapay/react build
```

Then in `examples/mcp-checkout-app`:

- "Your plan" card shows `SEK 500 / month` on a recurring purchase
- No "Cancel plan" or "Update card" buttons inside the card
- Single "Manage account" CTA below the card with fine-print: "Click Manage account to update your card or cancel your plan."
- Click opens the Stripe customer portal in a new tab