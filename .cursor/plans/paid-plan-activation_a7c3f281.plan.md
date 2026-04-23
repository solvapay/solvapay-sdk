---
name: ''
overview: ''
todos: []
isProject: false
---

# Paid-plan Activation — Implementation Brief

**Scope:** The UX and wiring that runs when a customer attempts to use the tool beyond what their current plan allows, and must activate a paid plan to continue. Covers two paid plan shapes: Pay as you go (PAYG) and Recurring (subscription).
**Surface:** `McpCheckoutView` inside the existing `McpAppShell`. No new top-level surface.
**Status:** Ready for implementation. Sits downstream of the SDK refactor spec (tabbed shell removed, `McpActivateView` merged into `McpCheckoutView`) and the `ctx.respond()` V1 spec.

**Related docs:**

- `sdk-refactor-spec.md` — the shell refactor this builds on.
- `ctx-respond-v1-spec-FINAL.md` — the handler context API.
- `CLAUDE.md` — the rules file (three-mode framework, north-star principles).

**Wireframes (attached):**

- **Image 1** — MCP Checkout demo, six high-fidelity surface wireframes.
- **Image 2** — same, full-viewport view.
- **Images 3–6** — activation flow, six panels. Image 3: state machine (disregard the Free branch; see §12). Image 4: shared plan-selection surface (disregard the Free card; see §3). Image 5 left half: Branch A — Free (**not implemented — see §12**). Image 5 right half: Branch A (PAYG). Image 6: Branch B (Recurring) and cross-branch invariants.

---

## 1. Why this exists

When a customer uses a merchant's paid tool, there are three possible states:

1. **Free plan is active** (default at sign-up/sign-in). The customer can call the tool up to the Free quota. This state requires no activation work from the SDK — it's the ambient default.
2. **A paid plan is active** (PAYG or Recurring). Calls run silently; merchant data is returned; commerce is invisible. This is the 90%-silent-mode goal.
3. **The customer has exceeded their Free quota and no paid plan is active.** The tool can't run. The SDK takes over the surface, offers the paid plans, and activates one.

This brief covers state 3. The flow is triggered when `payable().mcp()`'s pre-check rejects a call because the customer's Free quota is exhausted (or the tool requires a paid plan and the customer is still on Free).

**Only one plan is active at a time.** Activating a paid plan replaces Free. The customer returns to Free only if they explicitly cancel or downgrade later — out of scope for this brief.

Two paid-plan shapes are supported in V1:

- **PAYG** — three surfaces (pick amount, pay, confirm).
- **Recurring** — two surfaces (pay, confirm — price is fixed by the plan).

Both live in `McpCheckoutView`. The branching is driven by `resolvePlanShape()` and `resolveActivationStrategy()`, both already in the codebase.

---

## 2. Entry conditions

The flow begins when **all** of the following are true:

1. Customer invokes a paid tool via the merchant's MCP server.
2. `payable().mcp()` pre-check rejects the call with `outcome: 'paywall'`. Typical reasons: Free-plan quota exhausted (`withinLimits === false`), or the tool is paid-only and the customer has the Free plan (or no plan) active.
3. The merchant's product has at least one paid plan configured.

Under these conditions, the SDK:

- Does **not** run the handler. `trackUsage` records `outcome: 'paywall'`, no charge.
- Mounts `McpAppShell` with `bootstrap.view = 'checkout'`.
- Sets the checkout view's internal step state to `'plan'` (the shared entry point).

If no paid plans are configured, this is a merchant misconfiguration and the SDK should throw at `createSolvaPayMcpServer` construction (per the config-time-validation rule in `CLAUDE.md`).

**Important:** entering this flow does **not** change the customer's active plan. Free (or whatever was active) remains active until the customer completes payment for a paid plan, at which point the paid plan replaces it. If the customer dismisses the flow without activating, they stay on Free — the specific call that triggered the flow still fails, but future calls within the Free quota continue to work.

---

## 3. Shared entry point — paid-plan selection

**Wireframe:** Image 4 (disregard the Free card; see §12).

The customer sees a single surface with:

- The standard shell header (merchant brand, product name).
- An amber **"Upgrade to continue"** banner explaining why the flow was triggered. Copy is contextual: `"You've used your 50 free calls this month. Pick a plan to keep going."` for quota exhaustion, or `"This tool needs a paid plan. Pick one to get started."` when the merchant's tool is paid-only.
- A `"Choose a plan"` heading.
- One card per configured **paid** plan, rendered in the order: PAYG (if configured), Recurring tiers (ascending price). No Free card — Free is the current active plan, not a choice to pick.
- Visual promotion rules:
  - PAYG gets the filled blue card + `"recommended"` amber tag (per CLAUDE.md's opinionated-default rule: _usage-based is the featured pricing model_).
  - Recurring cards show `"Auto-renews. Cancel anytime."` in the description line to defuse commitment anxiety.
- A primary CTA whose **label tracks the current selection**:
  - PAYG selected → `"Continue with Pay as you go"`
  - Recurring selected → `"Continue with Pro — $18/mo"` (with the selected plan's price inlined)
- A secondary `"Stay on Free"` link at the bottom. Dismisses the surface without activating anything. The tool call that triggered the flow still fails; future Free-tier calls continue to work.

**Explicit non-goals for this surface:**

- No personalized savings line on Recurring cards. The "$14/mo vs PAYG at your usage" math requires historical usage data this customer may not have. Feature it in the change-plan flow from `McpAccountView`, not here.
- No "come back later" option. Either the customer activates a paid plan now or they fall back to Free and this exact flow re-triggers on their next out-of-quota call.

**Card selection UX:** Tapping anywhere on a card selects it. The radio dot is visual feedback, not a separate click target. The CTA label updates on selection.

---

## 4. Branch A — Pay as you go

**Wireframe:** Image 5 (right half).

**Interaction:**

1. Customer selects the PAYG card and taps `"Continue with Pay as you go"`.
2. Checkout view transitions internally to `step: 'amount'`. `← Back` BackLink appears.
3. Customer picks a preset credit amount (500 / 2,000 / 10,000) or enters a custom amount. The 2,000 tier is marked `"popular"`. The CTA label updates to include the total price (e.g. `"Continue — $18.00"`).
4. Customer taps Continue. View transitions to `step: 'payment'`. BackLink text changes to `← Change amount`.
5. Order summary renders above the Stripe element. `"Save card for future top-ups"` checkbox sits below.
6. Customer fills in card details and taps `"Pay $18.00"`.
7. SDK calls three transport tools in sequence:
   - `activate_plan({ plan: 'payg' })` — replaces the Free plan with PAYG.
   - `create_topup_payment_intent({ amount: 18.00 })` — creates the Stripe payment intent and returns the client secret.
   - `process_payment` — confirms the intent client-side.
8. On success, view transitions to `step: 'success'`. BackLink disappears (payment is settled). Receipt grid shows `Amount / Credits / Plan / Rate`.
9. `"Back to chat"` unmounts the shell. Chat re-invokes the original tool silently.

**Three surfaces of interaction + one success surface.**

**Critical distinction from `McpTopupView`:** these look similar but are semantically different. This flow fires `activate_plan` before taking payment, because the customer's previous state was Free, not PAYG. `McpTopupView` assumes PAYG (or a metered recurring plan) is already active and only handles the top-up. Success copy differs: `"Credits added + Pay as you go plan is active"` vs `"Top-up complete"`. If you're ever tempted to merge them, reread this paragraph.

---

## 5. Branch B — Recurring subscription

**Wireframe:** Image 6 (left three-quarters).

**Interaction:**

1. Customer selects a Recurring card (e.g. Pro) and taps `"Continue with Pro — $18/mo"`.
2. Checkout view transitions to `step: 'payment'`. `← Change plan` BackLink appears.
3. Order summary renders with `"Pro plan • monthly"`, the price, and `"2,000 credits included"`. A fine-print terms line reads _"By subscribing, you agree Pro renews at $18/month until you cancel."_
4. Stripe element renders. No "Save card" checkbox — the card is required to maintain the subscription, not a choice.
5. Customer taps `"Subscribe — $18.00 / month"`.
6. SDK calls `create_payment_intent` with the subscription flag set. Backend creates the Stripe subscription, replaces Free with Pro, confirms the first charge, and returns the payment intent client secret.
7. On success, view transitions to `step: 'success'`. Receipt grid shows `Plan / Credits / Charged today / Next renewal`. A `"Manage from /manage_account"` link is present (but not a CTA — it's just a pointer).
8. `"Back to chat"` unmounts the shell.

**Two surfaces of interaction + one success surface.** No amount picker — price is the plan.

**Notes:**

- The `"Manage from /manage_account"` pointer on the success surface is deliberately not a button. Clicking it does nothing. It's a hint that teaches the customer where cancellation and plan changes live, without competing with `"Back to chat"` for the primary action.
- Next-renewal date is rendered server-side as part of the success payload. Don't compute client-side — timezones will bite you.

---

## 6. Cross-branch invariants

**Wireframe:** Image 6 (right quarter, six cards — disregard references to the Free branch).

**One plan is active at a time.** Activating PAYG or Recurring replaces Free. The customer does not have "Free + paid" — the new plan supersedes the old one. Downstream of activation, `bootstrap.plan` references only the now-active paid plan. If the paid plan is later cancelled, the customer falls back to Free; that's a separate flow.

**The tool call that triggered the flow doesn't auto-retry at activation time.** The customer taps `"Back to chat"` and the chat re-invokes the tool. This produces a clean "shell unmounts → silent call runs" narrative. If we auto-retried before unmount, the customer would see the tool succeed without a clear closure of the activation flow.

**Same surface, different internal state.** Both paid branches live in `McpCheckoutView`. No `bootstrap.view` changes between steps within a branch. The BackLink primitive moves between steps without leaving the surface. Step counts: PAYG: 3 action surfaces + success. Recurring: 2 action surfaces + success.

**Confirmation names the plan.** Success copy is branch-specific: _"Credits added"_ (with a plan line below reading `"Pay as you go plan is active"`), _"Pro plan active"_. The success layout is shared — green check → title → receipt grid → `"Back to chat"` — but the verbs and nouns tell the customer exactly what they bought.

**BackLink appears when reversible.** Absent on step 1 of each branch (nothing to go back to — the customer just arrived). Present on intermediate steps. Absent on success (payment is settled; there's no going back to an unpaid state). BackLink copy is contextual: `← Back`, `← Change amount`, `← Change plan`.

**"Upgrade to continue" banner is gated on one flag.** The amber strip appears iff the customer hit the paywall (either quota-exhausted or paid-plan-required). The change-plan flow from `McpAccountView` does not show it — the customer already has a paid plan and is choosing to switch. One flag, one visual, no heuristics.

**Tool-call wiring is fixed per branch.**

| Branch    | Step transition   | Transport tool(s)                                                             |
| --------- | ----------------- | ----------------------------------------------------------------------------- |
| PAYG      | plan → amount     | _(local state change, no tool call)_                                          |
| PAYG      | amount → payment  | `activate_plan({ plan: 'payg' })` + `create_topup_payment_intent({ amount })` |
| PAYG      | payment → success | `process_payment`                                                             |
| Recurring | plan → payment    | `create_payment_intent` (with subscription flag)                              |
| Recurring | payment → success | `process_payment`                                                             |

If your branch needs a tool that isn't in this table, you're probably building something that should be a separate flow, not a variation of paid-plan activation.

---

## 7. Component and state contract

### `McpCheckoutView` props

No changes required for V1. The view reads `bootstrap.plan` (the current active plan — Free when entering this flow) and `bootstrap.availablePaidPlans` (merchant-configured paid plan list; excludes Free). Internal step state is local to the view.

### Internal state machine

```
step: 'plan' | 'amount' | 'payment' | 'success'
selectedPlan: PaidPlan | null
selectedAmount: number | null  // PAYG only
```

**Transition table:**

| From        | Event                   | To          | Side effect                                                       |
| ----------- | ----------------------- | ----------- | ----------------------------------------------------------------- |
| `'plan'`    | PAYG card Continue      | `'amount'`  | —                                                                 |
| `'plan'`    | Recurring card Continue | `'payment'` | —                                                                 |
| `'plan'`    | "Stay on Free" dismiss  | _(unmount)_ | —                                                                 |
| `'amount'`  | BackLink                | `'plan'`    | —                                                                 |
| `'amount'`  | Continue                | `'payment'` | `activate_plan({ plan: 'payg' })` + `create_topup_payment_intent` |
| `'payment'` | BackLink (PAYG)         | `'amount'`  | —                                                                 |
| `'payment'` | BackLink (Recurring)    | `'plan'`    | —                                                                 |
| `'payment'` | Stripe confirm success  | `'success'` | —                                                                 |
| `'success'` | `"Back to chat"`        | _(unmount)_ | `onRefreshBootstrap`                                              |

### New component: none

`McpCheckoutView` absorbs both branches internally. The only net-new React component introduced by the broader refactor is `McpUpsellStrip` (handled by the `ctx.respond` spec, not this brief).

### BackLink wiring

Use the existing `BackLink` primitive — same one `McpTopupView` uses. Pass the step-specific label via props. Do not create branch-specific BackLink variants.

---

## 8. Acceptance criteria

A V1 implementation is complete when:

- [ ] A paywall-rejected paid tool call from a customer on Free mounts `McpCheckoutView` at `step: 'plan'` with the "Upgrade to continue" banner visible.
- [ ] Plan cards render in order PAYG → Recurring (ascending price for recurring). **No Free card.**
- [ ] PAYG card shows the `"recommended"` amber tag.
- [ ] CTA label tracks the selected card (`"Continue with Pay as you go"` / `"Continue with Pro — $18/mo"`).
- [ ] `"Stay on Free"` link at the bottom dismisses the surface without activating a paid plan; customer's Free plan remains active.
- [ ] **PAYG branch:** amount picker renders three preset tiers + custom input, `"popular"` tag on the middle tier. Payment step shows Stripe element + Save-card checkbox + order summary. Success step shows Amount / Credits / Plan / Rate.
- [ ] **Recurring branch:** payment step shows Stripe element + order summary + subscription terms line. No Save-card checkbox. Success step shows Plan / Credits / Charged today / Next renewal + `/manage_account` pointer.
- [ ] BackLink appears on intermediate steps with correct contextual label (`← Back` / `← Change amount` / `← Change plan`). Absent on step 1 and success.
- [ ] Transport tools fire in the order specified in the wiring table.
- [ ] On successful activation, the customer's `bootstrap.plan` reflects the new paid plan (not "Free + paid"); Free is replaced.
- [ ] On success surface, `"Back to chat"` unmounts the shell and dispatches `onRefreshBootstrap`.
- [ ] After the shell unmounts, the original paid tool call re-invokes and runs silently (no iframe, no card, just data).
- [ ] Dismissing the surface via `"Stay on Free"` leaves the Free plan active; subsequent within-quota calls work, out-of-quota calls re-trigger this flow.
- [ ] "Upgrade to continue" banner does **not** appear in the change-plan flow from `McpAccountView`.
- [ ] Tests cover the state machine: each transition row in §7 has a test asserting the correct step change and tool calls.
- [ ] Tests cover both happy paths end-to-end (mount → plan select → [branch] → success → unmount).
- [ ] Test covers the dismissal path (mount → "Stay on Free" → unmount, Free plan still active).

---

## 9. Out of scope for V1

**Failed-payment surface.** Stripe confirmation can fail (declined card, 3DS timeout, network error). V1 assumption: show a generic error banner above the Stripe element, CTA unchanged, customer retries. A dedicated failed-payment surface (with remediation copy per failure reason) is a V1.1 addition.

**Saved-card handoff.** A customer switching between paid plans (e.g. PAYG → Recurring) already has a card on file. The payment step should show `"Use ending in 4242 • Change"` instead of a blank Stripe element. This is a change-plan flow, not first-paid-activation — out of scope here.

**Plan-shape matrix, full version.** V1 supports two paid shapes: PAYG and Recurring-unlimited-with-included-credits. Two other shapes exist in the plan model (recurring-unlimited-no-credits, recurring-metered-tiered) but aren't featured here. The plan-selection card renders differently per shape; the payment-step shape is identical across recurring variants. Extending to cover the remaining shapes is purely additive on the plan-selection surface.

**Cancellation and plan switching.** Cancelling a paid plan (returning to Free) and switching between paid plans both live in the change-plan flow from `McpAccountView`. Out of scope here.

**Personalized savings math.** Requires historical usage data. Feature it in the change-plan flow instead.

**Multi-product activation.** If a merchant configures multiple products behind one SolvaPay account, each product's paywall is an independent activation trigger. Unified multi-product activation is a future concern.

**Free-plan-exhausted nudge before the paywall.** When the customer gets close to their Free limit (say, 45 of 50 calls), `McpUpsellStrip` could nudge them with "Running low on free calls." That's mode 2 in the CLAUDE.md three-mode framework, handled by the `ctx.respond().withNudge()` API — separate from this brief.

---

## 10. Sequencing

This work depends on the SDK refactor (tabs gone, `McpActivateView` merged into `McpCheckoutView`) and the `ctx.respond()` V1 plumbing. Land order:

1. Annotations PR (independent; already scoped).
2. `ctx.respond()` types land in `@solvapay/mcp`.
3. SDK refactor lands (`McpCheckoutView` becomes the single checkout surface, BackLink wired).
4. **This brief's work lands.** Paid-plan activation step state added to `McpCheckoutView`, transport wiring per §6, wireframes per §§3–5.
5. Demo tools in `examples/mcp-checkout-app` updated to exercise the activation flow. The demo product should ship with both a Free plan (auto-active) and at least one paid plan configured, so the flow is reachable by exceeding Free's quota.

**Estimate:** 2–3 focused days of SDK work. Bulk of the complexity is the internal state machine and transport wiring; the UI components are mostly already there from the refactor.

---

## 11. Open questions (flag in review)

Three small decisions where I've picked defaults but could be wrong.

**Q1 — "Stay on Free" link copy and placement.** Current answer: text link at the bottom, below the primary CTA, labeled `"Stay on Free"`. Alternative: a secondary outlined button rendered side-by-side with the primary. Leaning: text link. A button competes visually with the primary CTA and pushes the customer toward rejection; a text link is there for people who want it without selling them on it.

**Q2 — Banner copy when Free quota is exhausted vs when the tool is paid-only.** Current answer: two different strings (`"You've used your 50 free calls this month"` vs `"This tool needs a paid plan"`). Alternative: one generic string (`"Upgrade to use this tool"`). Leaning: two strings. The specific reason matters to the customer and is cheap to switch on.

**Q3 — Should the "Stay on Free" dismissal show a brief confirmation toast in chat?** Something like `"You're still on the Free plan. You have 0 calls remaining this cycle."` Current answer: no — the shell unmounts cleanly, the original tool call already failed with its own error, and a toast on top would feel like badgering. Alternative: yes, because the customer who dismisses might not realize their tool call failed. Leaning: no, but verify by user-testing the demo.

All three are reversible cheaply.

---

## 12. What changed from the earlier draft — and what to ignore in the wireframes

This brief was originally drafted as a three-branch _first-use_ activation flow (Free / PAYG / Recurring). The product actually activates Free automatically at sign-up, so Free never flows through the activation surface. Additionally, only one plan is active at a time — activating a paid plan replaces Free rather than coexisting with it. The implementation brief collapses to two branches, with cleaner "replace" semantics rather than "add."

When reviewing the attached wireframes:

- **Image 3 (state machine).** The Free branch, the `"Activate (one tap)"` node, and the `"Product activated"` terminal for Free all disappear. What remains is Entry → Select plan → (PAYG or Recurring) → Payment → Success → Shell unmounts.
- **Image 4 (shared plan-selection surface).** The Free card disappears. The amber banner copy changes from `"First-time setup — Pick how you'd like to pay. You can switch later."` to the contextual `"Upgrade to continue"` copy described in §3. The `"Keep current plan"` footnote becomes the `"Stay on Free"` link described in §3.
- **Image 5 left half (Branch A — Free).** Disregard entirely. Not implemented.
- **Image 5 right half + Image 6 left three-quarters (PAYG + Recurring).** Still valid as-is. The only visual delta is that in the plan-selection step, the Free card is absent from the stack of options.
- **Image 6 right quarter (cross-branch invariants).** Disregard the "Confirmation names the plan — Free: 'Free plan active'" line. Everything else in that panel applies to the two-branch flow. Note that the "product not usable until activated" invariant is softened in the new model — the product _is_ usable (on Free) until the customer exceeds the Free quota; then activation is required.

New wireframes for the revised plan-selection surface and the `"Stay on Free"` dismissal path are a reasonable next piece of work; not a blocker for dev handoff since the deltas are straightforward.
