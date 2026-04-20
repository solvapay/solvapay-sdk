---
name: sdk lovable rollout phase3
overview: 'Phase 3 of the Lovable-stack SDK work: roll the Phase 1 (plan selector / activation / checkout composition) and Phase 2 (current-plan management) surface out to public docs, skills, cursor-plugin, and every remaining SDK example. No SDK code changes — pure downstream propagation so code agents (Lovable, Bolt, etc.) reach for the new primitives by default.'
todos:
  - id: readme-react-three-layer
    content: Restructure packages/react/README.md around the Phase 1 three-layer mental model (CheckoutLayout golden path → custom composition → hooks-only) and add a fourth "Managing plans post-checkout" section covering CurrentPlanCard + PlanSwitcher from Phase 2. Add the "Using with Supabase Edge Functions" snippet that shows api URL overrides for the Lovable stack. Include a Swedish locale + partial copy bundle snippet.
    status: pending
  - id: other-examples-audit
    content: 'Audit each non-checkout-demo example for opportunities to use the new primitives: hosted-checkout-demo (keep as-is, distinct flow), express-basic (no React surface, skip), mcp-oauth-bridge + mcp-time-app (backend-only, skip), supabase-edge (add React consumer snippet in README showing CheckoutLayout against /functions/v1/* URLs). Document outcome per example.'
    status: pending
  - id: supabase-edge-react-snippet
    content: Extend examples/supabase-edge/README.md with a React consumer snippet that shows SolvaPayProvider wired with full api URL overrides (including the new getMerchant, getProduct, changePlan, createSetupIntent, getPaymentMethod endpoints) and CheckoutLayout as the drop-in. Cross-link from the Phase 1 SDK README.
    status: pending
  - id: docs-checkout-composition-guide
    content: 'Create docs/sdks/typescript/guides/checkout-composition.mdx (or extend guides/react.mdx): three-layer model, CheckoutLayout one-liner recipe for chat / mobile / desktop embeds, PlanSelector + PaymentForm + ActivationFlow composition, CurrentPlanCard + PlanSwitcher for /account pages. Uses SolvaPay terminology (product / plan / purchase) per docs AGENTS.md.'
    status: pending
  - id: docs-merchant-endpoint-ref
    content: Add docs coverage for the new SDK endpoints shipped across Phase 1 + Phase 2 (getMerchant, getProduct, changePlan, createSetupIntent, getPaymentMethod). Either extend the existing API reference pages or add short endpoint cards under sdks/typescript/reference/. Keep the SDK-facing "merchant" vs internal "provider" terminology rationale in one sentence.
    status: pending
  - id: docs-localization-guide
    content: Create docs/sdks/typescript/guides/localization.mdx covering the SolvaPayCopy bundle shape, deep-merge precedence, locale prop (Stripe passthrough + formatPrice), Swedish worked example with partial override, and function-form mandate copy for languages with different word order. Mark pluralization / date formatting as integrator-owned.
    status: pending
  - id: docs-json-nav
    content: Register the new docs pages in docs.json under the TypeScript SDK group (checkout-composition between react and mcp; localization after webhooks; reference additions inline).
    status: pending
  - id: skills-checkout-layout-first
    content: 'Update skills/solvapay/sdk-integration/react/guide.md (and any sibling stack guides that render React components) to teach CheckoutLayout-first: golden path snippet at the top, prefillCustomer + requireTermsAcceptance defaults, locale + copy override pattern, CancelledPlanNotice + CancelPlanButton wired in. Demote the headless-hooks walkthrough to the bottom.'
    status: pending
  - id: skills-lovable-overlay
    content: Update skills/solvapay/sdk-integration/edge-functions/supabase-edge/guide.md (and the lovable overlay if present) so the "frontend wiring" section uses CheckoutLayout as the drop-in, wires every api URL explicitly to Supabase function paths, and references getMerchant / getProduct / Phase 2 endpoints.
    status: pending
  - id: skills-account-surface
    content: Add a short "Managing plans post-checkout" section to the relevant skill guides showing the /account page drop-in (CurrentPlanCard) and the PlanSwitcher + UpdatePaymentMethodButton composition. Intent matrix entries for "change plan", "update card", "view current plan".
    status: pending
  - id: plugin-mirror-skills
    content: Mirror the skills updates into plugins/solvapay/skills/solvapay/ in the cursor-plugin repo. Bump plugin version (next patch) in plugin.json, marketplace.json, and skills metadata.json. Expand rules/coding-standards.mdc "Preferred SDK components" to list CheckoutLayout, PlanSelector, ActivationFlow, CurrentPlanCard, PlanSwitcher as first-choice surfaces.
    status: pending
  - id: verification
    content: 'Run mint broken-links + mint dev against docs; run node scripts/validate-template.mjs in cursor-plugin; spot-check intent matrix routing for "build checkout", "lovable", "supabase edge", "change plan", "localize"; confirm examples/supabase-edge README snippet type-checks against shipped SolvaPayConfig.api shape.'
    status: pending
isProject: false
---

## Relationship to Phase 1 and Phase 2

- Phase 1 ([sdk_plan_selector_3646143f.plan.md](.cursor/plans/sdk_plan_selector_3646143f.plan.md)) ships the full checkout loop: `<CheckoutLayout>` golden path, `<PlanSelector>`, `<ActivationFlow>`, `<AmountPicker>`, `<CancelPlanButton>`, `<CancelledPlanNotice>`, `<CreditGate>`, plus Supabase-edge parity for `getMerchant` + `getProduct`.
- Phase 2 ([sdk_plan_management_phase2_6e40d833.plan.md](.cursor/plans/sdk_plan_management_phase2_6e40d833.plan.md)) adds post-checkout management: `<CurrentPlanCard>`, `<PlanSwitcher>`, `<PaymentMethodForm>`, `<UpdatePaymentMethodButton>` + three new backend endpoints.

Phase 3 is pure downstream: no SDK code changes, no backend changes. It propagates the new surface out to every consumer-facing channel (`packages/react/README.md`, Mintlify docs, skills repo, cursor plugin, remaining examples) so agents and humans reach for `<CheckoutLayout>` first.

```mermaid
flowchart LR
  P1[Phase 1 SDK primitives] --> P3[Phase 3 rollout]
  P2[Phase 2 plan management] --> P3
  P3 --> Docs[Mintlify docs]
  P3 --> Skills[skills repo]
  P3 --> Plugin[cursor-plugin]
  P3 --> Examples[SDK examples]
  P3 --> ReactReadme[packages/react/README.md]
```

## Dependency and sequencing

Phase 3 work can start **incrementally** as Phase 1 + Phase 2 PRs land — there's no hard gate. Recommended order:

1. `readme-react-three-layer` — runs in parallel with the tail end of Phase 1 so the SDK README matches the shipped surface on day one.
2. Docs pages (`docs-checkout-composition-guide`, `docs-merchant-endpoint-ref`, `docs-localization-guide`) — open after Phase 1 PRs merge; extend after Phase 2 merges.
3. Skills + plugin updates — open after Phase 1 PRs merge; one follow-up after Phase 2.
4. Examples audit + Supabase-edge React snippet — any time after Phase 1.
5. Final verification pass once all the above have landed.

Each todo is independently shippable. Treat Phase 3 as a rolling maintenance phase, not a single landing.

## Carried over from `sdk-checkout-composition`

Three follow-up items were pending on the now-completed composition plan and are absorbed here:

| Original todo                                                                    | Carried into                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `followup-sdk-examples` (backfill CheckoutLayout into all examples)              | `other-examples-audit` + `supabase-edge-react-snippet`           |
| `followup-docs` (composition guide, merchant reference, localization guide)      | `docs-checkout-composition-guide`, `docs-merchant-endpoint-ref`, `docs-localization-guide` |
| `followup-skills` (CheckoutLayout-first agent skills)                            | `skills-checkout-layout-first`, `skills-lovable-overlay`, `skills-account-surface`, `plugin-mirror-skills` |

The fourth composition todo (`docs-examples` — packages/react/README + checkout-demo rewrite) is fully subsumed by Phase 1's `readme` + `demo-rewrite-page` + `demo-mount-routes` todos and does not need to carry forward.

## Out of scope

- Translating the `SolvaPayCopy` bundle into any non-English locale in-SDK. The localization docs page ships with a Swedish snippet as a worked example only. Full bundles remain integrator-owned (matches `stripe-js`, `react-i18next`).
- Building a dedicated "React-on-Supabase" example app. Lovable wiring is documented via the README snippet + skills guide; a standalone example is a separate plan if demand appears.
- Phase 3 tracking for any hybrid-plan copy — hybrid plans are still backend-gated (see composition plan out-of-scope section).
- Customer-portal UI beyond `<CurrentPlanCard>` + `<PlanSwitcher>` (invoice history, billing address, tax ID). Tracked as Phase 4 candidates in the Phase 2 plan's out-of-scope section.
