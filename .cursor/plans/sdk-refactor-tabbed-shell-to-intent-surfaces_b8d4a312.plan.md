# SDK refactor spec — from tabbed shell to intent surfaces

**Status:** Ready for implementation. "How to cut code" companion to [`mcp-apps-sdk_direction-refactor_f3e8a2c1.plan.md`](./mcp-apps-sdk_direction-refactor_f3e8a2c1.plan.md).
**Scope:** The structural changes to `@solvapay/react/mcp` and its callers required to ship the three-mode framework. Surface-level (shell, router, views, exports). Does not re-litigate the direction doc's decisions (tabs die, About dies, first-run tour dies, `McpActivateView` merges into `McpCheckoutView`). Does not specify surface wireframes — those come in a separate artifact.
**Audience:** SolvaPay engineering. The implementer of this spec is expected to turn its direction-level diffs into concrete file-by-file changes as part of the PR work.

**Related:**
- [`mcp-apps-sdk_direction-refactor_f3e8a2c1.plan.md`](./mcp-apps-sdk_direction-refactor_f3e8a2c1.plan.md) — direction doc. This spec implements its deprecation list.
- [`paid-plan-activation_a7c3f281.plan.md`](./paid-plan-activation_a7c3f281.plan.md) — activation UX brief that sits downstream of this refactor and drives the `McpCheckoutView` absorption of `McpActivateView`.
- [`mcp-apps-sdk.mdc`](../rules/mcp-apps-sdk.mdc) — cursor rule / north star. This spec is consistent with its three-mode framework.
- `ctx-respond-v1-spec-FINAL.md` — context-handler spec, parallel work. Interlock section below spells out sequencing.

---

## Scope statement

What this spec **does**:

- Names the load-bearing decision (shell routing mechanism) and commits to `bootstrap.view` as the dispatch signal.
- Inventories what stays, what changes shape, what gets deleted.
- Orders the commits so `examples/mcp-checkout-app` stays compilable across the cut.
- Specifies how this work interlocks with the ctx.respond refactor.
- Gives a test plan and review checklist.

What this spec **does not** do:

- Re-open deprecation decisions. Tabs, About, first-run tour, `McpActivateView`, `hasSeenTour`, `resetTourDismissal`, `TourReplayButton`, `DEFAULT_TOUR_STEPS`, `MCP_TAB_ORDER`, `MCP_TAB_HINTS`, `computeVisibleTabs` — all cut. The argument for each lives in the direction doc.
- Specify wireframes for `McpCheckoutView`'s "← Change plan" sub-flow or `McpUpsellStrip`. Those come in a separate wireframe artifact. Activation surface wireframes live in the paid-plan-activation brief linked above.

---

## Prerequisite decisions (closed)

These were decided during spec drafting. Recorded here so reviewers don't re-open them unless they have new information.

**Routing mechanism: `bootstrap.view` dispatch.** The shell routes to a single surface per invocation, chosen by `bootstrap.view`. This value is already what seeds `selectedTab` today via the `initialTab` `useMemo` in `McpAppShell`; the refactor locks the surface to `bootstrap.view` and drops the ability to change it mid-session. No new `_meta.ui.view` mechanism is introduced — the existing bootstrap field already does this job, it was just being overridden by tab-bar interaction.

**Shell public props: clean cut.** `tabs?: 'auto' | 'all' | McpTabKind[]` is removed from `McpAppShellProps` with no deprecation window. Since there are no public merchant integrators, the cost of a clean break is limited to internal callers, and the cost of a deprecation window is a permanent prop-shaped scar on the API.

**Type rename: `McpTabKind` → `McpViewKind`.** The tab-kind type exists today as the router's surface-selector enum. It continues to play that role; only the tab metaphor is gone. The rename makes the type's meaning honest. Exports from `@solvapay/react/mcp` include `McpViewKind` and a deprecated type alias `export type McpTabKind = McpViewKind` for one minor version to give internal callers a migration window on just the type name.

---

## What survives unchanged

Verified against current source. These are the load-bearing pieces the direction doc promised would stay, and which the snapshot confirms are already in place.

**`McpAppShellProps` core shape** — `bootstrap`, `views`, `classNames`, `footer`, `slashCommands`, `onRefreshBootstrap` all keep their current signatures and semantics. Only `tabs` is removed.

**`McpAppShell` internal state that isn't tab-related** — `paywallDismissed` (local opt-out from the paywall takeover), `lastRefreshedAtRef` + `STALE_THRESHOLD_MS` (debounce for `onRefreshBootstrap`). These survive because they're about the shell's relationship with the transport, not navigation.

**Surface views** — `McpAccountView`, `McpCheckoutView`, `McpTopupView`, `McpPaywallView` all keep their prop signatures. Specifically:
- `McpTopupView` already has `onBack` + `BackLink` wired per the direction doc. No prop-signature changes.
- `McpPaywallView` already has `upgradeCta` wired; the `findRecurringPlan` + `formatUpgradeLabel` helpers in `McpAppShell` that produce it keep working as-is.
- `McpAccountView` already folds credits inline. No prop-signature changes.

**`plan-actions.ts` module** — `resolvePlanShape`, `resolveActivationStrategy`, `resolvePlanActions`, `resolveActivityStrip`, `PlanLike`. All stay. (The two `resolveAboutCta*` helpers go — see the deletions section.)

**`BackLink` primitive** — `packages/react/src/mcp/views/BackLink.tsx`. Already used by `McpTopupView`, about to be used by `McpCheckoutView`.

**Paywall takeover flow** — `ShellPaywallContent`'s dispatch logic (flip `paywallDismissed` + set the surface to `checkout` on the "Upgrade to —" click) is unchanged in shape. It's the one place where the shell mutates the surface after mount; this is legitimate because the paywall is a mode, not a view in the router sense.

**Router dispatch pattern** — `ShellTabContent` becomes `ShellViewRouter` (rename-only) and resolves each view via `views?.x ?? DefaultView`. The override map (`McpAppViewOverrides`) keeps its shape.

---

## What changes shape

### 1. `McpAppShell` — from tabbed container to thin router

The shell stops being a navigation primitive and becomes a layout primitive that routes by bootstrap intent. Concretely:

- `selectedTab` state is deleted. The surface rendered is always `bootstrap.view`. (If `bootstrap.view` is undefined, default to `account` — same fallback the current `initialTab` memo uses.)
- `visibleTabs` / `activeTab` derivations are deleted.
- The `<McpTabBar …/>` conditional render is deleted.
- `tourForceOpen` state and the `<McpFirstRunTour …/>` mount at the bottom of the shell are deleted.
- The `{isPaywall ? <ShellPaywallContent/> : <ShellTabContent/>}` branch stays, but `ShellTabContent` renames to `ShellViewRouter` and takes `view: McpViewKind` directly instead of deriving it from internal state.
- `ShellHeader` loses its `TourReplayButton`. The product-title + merchant-brand row is unchanged.

**Net effect on file size.** `McpAppShell.tsx` currently carries the whole shell (header, tab strip, body router, sidebar, footer, paywall takeover, tour mount). After the cut, the tab strip's ~90 lines and the tour mount go away. The body router renames. Everything else stays. Expect the file to shrink by 25-30%.

### 2. `ShellTabContent` → `ShellViewRouter`

Internal rename. Signature changes from implicit-state-driven to explicit-input-driven:

- **Before:** reads `activeTab` from the shell's render closure.
- **After:** takes `view: McpViewKind` as an argument.

The router body itself is a `switch` (or map lookup) over `McpViewKind` that resolves `views?.[kind] ?? DefaultView` and threads `productRef` / `stripePublishableKey` / `returnUrl` / view-specific callbacks from `bootstrap` into the resolved component.

The `role="tabpanel"` + `id` / `aria-labelledby` wrapping comes off — without a tab bar, the ARIA relationship is vestigial. Any surface-level chrome (like the outstanding `← Change plan` BackLink in `McpCheckoutView`) plugs in *inside* the view, not in the router wrapper.

### 3. `McpCheckoutView` — absorbs the `← Change plan` affordance

The one genuine surface change in this refactor. Today `McpCheckoutView` has no BackLink; the direction doc calls for a "← Change plan" affordance so users who've advanced to the embedded Stripe step can back out to plan selection. The implementer adds:

- A `BackLink` primitive (same one `McpTopupView` already uses) rendered conditionally when the view is past plan selection.
- An internal state handle for "which step am I on" — probably lifts out of `PlanSelector.Root` / `ActivationFlow`'s existing state, though the implementer will decide that during the PR.

This is the one place the spec is genuinely adding UI rather than deleting it. Keep the scope of that addition tight: one BackLink, one back transition, no new props on `McpCheckoutView`.

### 4. Type rename and re-export

- `packages/react/src/mcp/tab-kind.ts` renames to `view-kind.ts` (or the existing file keeps its name and just exports the renamed type — implementer's call, minor).
- `McpTabKind` type renames to `McpViewKind`.
- `export type McpTabKind = McpViewKind` deprecation alias added. Kept for one minor version, then dropped.
- `MCP_TAB_ORDER` constant is deleted outright (see deletions).

The `McpViewKind` union narrows: `'about'` drops out.

---

## What gets deleted

Delete list, consolidated from the direction doc and cross-checked against the snapshot. All of these are in `packages/react/src/mcp/` unless noted.

**Files deleted entirely:**
- `views/McpAboutView.tsx`
- `McpFirstRunTour.tsx` and any supporting files (`tour-steps.ts`, etc.)
- `TourReplayButton.tsx` (if a separate file) or its export from `ShellHeader`
- `tour-dismissal.ts` or wherever `hasSeenTour` / `resetTourDismissal` live
- `views/McpActivateView.tsx` if still present (snapshot suggests it may already be merged; verify during PR)

**Exports removed from `@solvapay/react/mcp`'s public index:**
- `McpAboutView`
- `McpFirstRunTour`
- `TourReplayButton`
- `DEFAULT_TOUR_STEPS`
- `hasSeenTour`
- `resetTourDismissal`
- `MCP_TAB_ORDER`
- `MCP_TAB_HINTS`
- `TAB_LABELS`
- `computeVisibleTabs`
- `McpActivateView` (if currently exported)

**Type-level deletions:**
- `'about'` from the `McpViewKind` union (was in `McpTabKind`)
- `McpTabKind` as a primary export — survives only as a deprecated alias

**In-file deletions:**
- `data-tour-step` attribute on every element in the codebase (scatter hunt — `McpTabBar` buttons, and wherever else tour anchors were planted)
- `McpAppShell`'s `tourForceOpen` state + key prop threading
- `McpAppShell`'s `paywallDismissed` — **not deleted.** Keep this. It's independent of tours.
- `McpAppShell`'s `tabs` prop and its consumer `computeVisibleTabs` call
- `ShellHeader`'s `TourReplayButton` render
- `plan-actions.ts` — `resolveAboutCtaCard1`, `resolveAboutCtaCard2` helpers

**One judgment call for the implementer:** `McpTabBar` is a ~90-line internal component in `McpAppShell.tsx`. Delete outright — it has no use outside the tab strip. If a reviewer worries about "what if we ever want tabs back," the answer is git.

---

## What gets added

Two things. Both small.

**`McpUpsellStrip`** — new component per the direction doc and the ctx.respond spec. Reads `structuredContent._meta.ui.nudge`, renders an inline dismissible strip with the CTA button. ~80 lines. Lives in `packages/react/src/mcp/primitives/` (or wherever the other mode-2 primitives would live). Exported from `@solvapay/react/mcp`.

This component is *specified* by the ctx.respond spec — nudge kinds, default CTA labels, metadata shape — and *integrated* by this refactor spec. The refactor spec commits to rendering it, but its surface semantics are owned by ctx.respond.

**`BackLink` usage inside `McpCheckoutView`.** Not a new primitive — reuse of the existing one. Covered under "What changes shape" above.

---

## Interlock with the ctx.respond spec

The two specs touch `buildPayableHandler` and share `McpUpsellStrip`. Sequencing matters, but the collision is benign.

**Where they collide:**
- `buildPayableHandler` — ctx.respond adds a context-construction step and a `(args, ctx)` handler signature. The refactor doesn't touch this file directly, but the examples that this refactor validates (`examples/mcp-checkout-app/src/demo-tools.ts`) will want to use the new handler signature.
- `McpUpsellStrip` — ctx.respond specifies the metadata and behavior. This refactor integrates it into the views and exports it.

**Recommended sequencing:**

1. **ctx.respond types land first** — pure additive change to `@solvapay/mcp`, no behavior change, no coupling.
2. **This refactor lands in parallel to ctx.respond's server-side work.** The two can proceed independently because:
   - The refactor's handler signature is unchanged — `examples/mcp-checkout-app`'s demo tools continue working with the one-arg handler shape during the refactor.
   - `McpUpsellStrip` ships empty (no integration yet) in the refactor. When ctx.respond lands, it gets wired up.
3. **Integration happens as the last step.** Demo tools update to use `ctx.respond(data, { nudge: ... })`. `McpUpsellStrip` starts reading real metadata.

**What if they can't land in parallel?** Refactor lands first. ctx.respond builds on it. The opposite order (ctx.respond first) works too but means `McpUpsellStrip` has no integration point to plug into until the shell reshape ships.

---

## Commit sequence

Ordered so `examples/mcp-checkout-app` compiles at every commit. Each bullet is one PR-sized commit.

1. **Type rename and alias.** `McpTabKind` → `McpViewKind`. Deprecated alias `export type McpTabKind = McpViewKind`. Drop `'about'` from the union. No behavior change — this commit's only observable effect is that the example stops using `'about'` anywhere.
2. **Delete `McpAboutView` + About exports.** Drop the file, drop the export, drop the `'about'` branch from the router. Example compiles because step 1 already narrowed the union.
3. **Delete first-run tour.** `McpFirstRunTour`, `TourReplayButton`, `DEFAULT_TOUR_STEPS`, `hasSeenTour`, `resetTourDismissal`, `data-tour-step` scatter. Tour was a cross-cutting mount; removing it has no impact on routing.
4. **Delete `McpActivateView`** (if still present). Merge its logic into `McpCheckoutView` per the direction doc. This is the biggest single commit in the sequence — the checkout view's activation dispatch absorbs whatever the activate view was doing separately. See [`paid-plan-activation_a7c3f281.plan.md`](./paid-plan-activation_a7c3f281.plan.md) for the activation UX this commit must end up supporting.
5. **Reshape `McpAppShell` — remove tab bar.** `McpTabBar` deleted. `selectedTab` state deleted. `tabs` prop removed. `computeVisibleTabs` / `MCP_TAB_ORDER` / `MCP_TAB_HINTS` / `TAB_LABELS` deleted. `ShellTabContent` renames to `ShellViewRouter`, takes `view` as an explicit arg. This is the visible commit — this is where "the tabs are gone" becomes true for the example.
6. **Add `BackLink` to `McpCheckoutView`.** The `← Change plan` affordance. Pure addition, no side effects.
7. **Add `McpUpsellStrip`** — empty integration, just the component and export. When ctx.respond's integration commit lands, this already exists.

Commits 1-5 are the delete sequence; 6-7 are additive. If anything goes sideways, the revert surface is per-commit, not monolithic.

---

## Migration for internal callers

Since there are no public merchant integrators, "migration" means the monorepo's own callers.

- Any file importing `McpAboutView`, `McpFirstRunTour`, `TourReplayButton`, `MCP_TAB_ORDER`, `MCP_TAB_HINTS`, `TAB_LABELS`, `computeVisibleTabs`, `hasSeenTour`, `resetTourDismissal` → delete the import. None of these have replacements.
- Any file using `McpTabKind` → rename to `McpViewKind`. The deprecation alias means this can happen across the one-minor-version window, not in lockstep.
- Any file passing `tabs={...}` to `<McpAppShell>` → drop the prop. The intent is now carried by `bootstrap.view` from the server.
- `examples/mcp-checkout-app` — expect to touch `mcp-app.tsx` to drop the tour config and any tab-related props. The direction doc flags this as "shorter because no tabs."

**What doesn't need migration:**
- Code using `McpAccountView`, `McpCheckoutView`, `McpTopupView`, `McpPaywallView` directly — their prop signatures are unchanged.
- Code using `resolveActivationStrategy`, `resolvePlanActions`, `resolveActivityStrip`, `BackLink`, `PlanLike` — all survive unchanged.
- Code relying on `McpAppShellProps.bootstrap` / `views` / `classNames` / `footer` / `slashCommands` / `onRefreshBootstrap` — all survive unchanged.

---

## Test plan

No new testing infrastructure. The existing test harness for `@solvapay/react/mcp` covers the view-level behavior; this refactor's tests are about the shell and router.

**Shell routing:**
- Given `bootstrap.view === 'account'`, `McpAccountView` renders and no tab bar appears.
- Given `bootstrap.view === 'checkout'`, `McpCheckoutView` renders.
- Given `bootstrap.view === 'topup'`, `McpTopupView` renders.
- Given `bootstrap.view === undefined`, defaults to `account`.
- Paywall takeover still works: given `bootstrap.paywall` present, `McpPaywallView` renders regardless of `view`, and clicking `upgradeCta` transitions to `McpCheckoutView`.

**Deprecation aliases:**
- `import { McpTabKind } from '@solvapay/react/mcp'` still compiles and resolves to `McpViewKind`.
- Passing `tabs={...}` to `<McpAppShell>` fails type-check (prop removed).

**View-level regression:**
- `McpCheckoutView`'s new `BackLink` transitions correctly between plan-selection and payment steps.
- `McpTopupView`'s existing `BackLink` behavior is unchanged.
- `McpPaywallView`'s `upgradeCta` flow is unchanged.
- `McpAccountView`'s inline credits display is unchanged.

**Deletions:**
- Snapshot tests of the shell DOM no longer include `role="tablist"`, `role="tab"`, `role="tabpanel"`, or any `data-tour-step` attributes.

~12-15 tests. Most are additions to existing view tests; a few are shell-level new tests.

---

## Review checklist

- [ ] `McpTabKind` renamed to `McpViewKind` with deprecation alias
- [ ] `'about'` removed from the `McpViewKind` union
- [ ] `McpAboutView` file and export deleted
- [ ] `McpFirstRunTour`, `TourReplayButton`, `DEFAULT_TOUR_STEPS`, `hasSeenTour`, `resetTourDismissal` all deleted
- [ ] All `data-tour-step` attributes removed from the codebase
- [ ] `McpActivateView` merged into `McpCheckoutView` (or confirmed already merged)
- [ ] `McpTabBar` component deleted
- [ ] `McpAppShell.selectedTab` state deleted; surface locked to `bootstrap.view`
- [ ] `McpAppShell.tabs` prop removed from public API
- [ ] `computeVisibleTabs`, `MCP_TAB_ORDER`, `MCP_TAB_HINTS`, `TAB_LABELS` deleted
- [ ] `ShellTabContent` renamed to `ShellViewRouter`, takes `view` explicitly
- [ ] `role="tabpanel"` wrappers removed from router body
- [ ] `ShellHeader`'s `TourReplayButton` render removed
- [ ] `plan-actions.ts`'s `resolveAboutCta*` helpers deleted
- [ ] `McpCheckoutView` has `← Change plan` BackLink wired to plan-selection step
- [ ] `McpUpsellStrip` component exists and is exported (integration wired by ctx.respond PR)
- [ ] `examples/mcp-checkout-app/src/mcp-app.tsx` cleaned of tour config and tab props
- [ ] `paywallDismissed` state in `McpAppShell` preserved (not deleted with tab state)
- [ ] `McpTopupView`, `McpPaywallView`, `McpAccountView` prop signatures unchanged
- [ ] Shell tests cover the four-surface routing + paywall takeover
- [ ] No internal caller imports any deleted symbol

---

## Estimated effort

Assuming one implementer focused:

- **Commit 1 (type rename):** 1-2 hours.
- **Commit 2 (About deletion):** 1-2 hours, plus a scatter hunt for About references.
- **Commit 3 (tour deletion):** 2-3 hours. Tour anchors were scattered; the cleanup is the time-consuming part, not the deletion.
- **Commit 4 (activate merge):** 4-8 hours. Biggest commit. Depends on how much of the merge is already done.
- **Commit 5 (shell reshape):** 4-6 hours. The visible commit; lots of dependency tracking.
- **Commit 6 (BackLink add):** 2-3 hours.
- **Commit 7 (upsell strip add):** 3-4 hours.
- **Tests + review rounds:** 1 day on top.

**Total:** 3-4 focused days for the SDK side. Interlocks with ctx.respond's ~3-4 focused days per that spec. If one person does both, call it 5-7 days end-to-end; if two people split the work, call it a week wall-clock with parallel tracks.

Demo-shippable the moment commit 5 lands. Commits 6-7 are polish.

---

## Open questions (flag in review)

Three small calls where the default might be wrong.

**1. `McpAppShell` sidebar fate.** The shell today renders a sidebar (`<aside>` with `McpSellerDetailsCard` + `McpCustomerDetailsCard`) when `isShellSidebarEligible`. The direction doc doesn't mention the sidebar. Current assumption: keep it. If the sidebar was a tab-era compensation pattern ("detail cards have nowhere else to go when tabs dominate the main area"), it may also want to die. Leaning keep because the snapshot shows it as independent of the tab infrastructure.

**2. `McpAppShell` footer fate.** Same shape as the sidebar question. Direction doc doesn't mention; current assumption: keep. `showFooter` is derived from bootstrap, not tabs.

**3. `slashCommands` prop on `McpAppShell`.** Still present. Still useful? If the shell is now a single-surface container routed by `bootstrap.view`, slash commands are about cross-surface navigation — which was the tab problem. Leaning deprecate if no current usage, keep if any. Implementer checks during the PR.

---

## Not answered here

- Wireframes for `McpCheckoutView`'s `← Change plan` step. Separate artifact. Activation flow wireframes live in [`paid-plan-activation_a7c3f281.plan.md`](./paid-plan-activation_a7c3f281.plan.md).
- Exact wire format of `_meta.ui.nudge`. Owned by ctx.respond's implementation.
- Bundled HTML DX improvement. Covered in `bundled-html-open-questions.md`, ships after this refactor.
