---
name: example smoke preview gate
overview: Phased automated smoke coverage for every SolvaPay SDK example, added as a gate before we promote any preview to @latest. Phase 1 ensures every example builds + dev-serves cleanly against the published @preview. Phase 2 adds a shared Playwright happy-path (home -> checkout -> 4242 -> dashboard) per example. Phase 3 layers in gate, topup, cancel, and re-activate flows. Scoped deliberately small on purpose; the Lovable go-live plan published preview.5 without this coverage and explicitly deferred it here.
todos:
  - id: phase1-matrix
    content: Build+start CI matrix across checkout-demo, hosted-checkout-demo, shadcn-checkout, tailwind-checkout, spa-checkout, express-basic. For each example run `pnpm --filter <example> build` and start its dev server with a 30-60s ready probe (HTTP 200 on /). No UI assertions.
    status: pending
  - id: phase1-preview-install
    content: Add a parallel job that scaffolds each example from a throwaway template using the published `@preview` tag (not workspace:*), then runs build + start. Catches publish-time drift that workspace symlinks mask (missing files in package.json "files", wrong "exports", etc.).
    status: pending
  - id: phase2-fixtures
    content: Shared Playwright fixtures under `examples/shared/e2e/` — Supabase test user bootstrap (for SPA + supabase-edge examples), sandbox product ref env wiring, Stripe 4242 card helper. One fixture file reused across examples.
    status: pending
  - id: phase2-happypath
    content: Per example, a single Playwright spec covering home -> /checkout -> plan select -> 4242 card -> onResult('paid') -> post-payment landing. Screenshots at each stage archived as CI artifact. Skip Next.js examples that require a SolvaPay dev console session until we have an auth fixture.
    status: pending
  - id: phase3-gate
    content: Per example, Playwright spec for <PurchaseGate> — gated route blocks before purchase, allows after. Exercises the new productRef/planRef + hasPurchase API.
    status: pending
  - id: phase3-topup
    content: Playwright spec for <TopupForm> / <AmountPicker> flows in examples/checkout-demo.
    status: pending
  - id: phase3-cancel
    content: Playwright spec for CancelPlanButton + CancelledPlanNotice in checkout-demo and shadcn-checkout.
    status: pending
  - id: ci-wiring
    content: Wire all three phases into a dedicated `example-smoke.yml` workflow triggered on PR + on every new @preview publish. Must gate promotion of @preview to @latest.
    status: pending
isProject: false
---

# Example smoke preview gate

## Why this exists

The go-live preview for Lovable plan shipped `1.0.8-preview.5` without example-level runtime smoke coverage. That was a deliberate deferral — the user accepted the risk for the preview window but we need real automated coverage before any preview graduates to `@latest`.

Two things this plan prevents:

- Silent breakage of non-Next examples (the `spa-checkout` case that the Lovable skill depends on) during refactors that only get exercised through the Next.js examples during local dev.
- Publish-time regressions where `workspace:*` symlinks mask missing files in package `exports` / `files` — those only surface when a consumer installs from the registry under `@preview` or `@latest`.

## Phases

### Phase 1 — build + dev-serve matrix (fastest to land)

Target examples:

| Example | Type | Start cmd | Ready probe |
| --- | --- | --- | --- |
| [`examples/checkout-demo`](examples/checkout-demo) | Next.js | `pnpm --filter checkout-demo dev` | GET `/` -> 200 |
| [`examples/hosted-checkout-demo`](examples/hosted-checkout-demo) | Next.js | `pnpm --filter hosted-checkout-demo dev` | GET `/` -> 200 |
| [`examples/shadcn-checkout`](examples/shadcn-checkout) | Next.js | `pnpm --filter shadcn-checkout dev` | GET `/` -> 200 |
| [`examples/tailwind-checkout`](examples/tailwind-checkout) | Next.js | `pnpm --filter tailwind-checkout dev` | GET `/` -> 200 |
| [`examples/spa-checkout`](examples/spa-checkout) | Vite SPA | `pnpm --filter spa-checkout dev` | GET `/` -> 200 |
| [`examples/express-basic`](examples/express-basic) | Node server | `pnpm --filter express-basic dev` | GET `/health` -> 200 |

For each: `pnpm build` must exit 0, dev server must respond within 60s. No click-through yet.

Additionally a **preview-install job** that scaffolds each example from a copy (or uses `create-next-app`-style git clone), swaps `workspace:*` -> `@preview`, runs `npm install` and `npm run build`. This is the gate that catches publish-time drift.

### Phase 2 — Playwright happy-path

One spec per browser-facing example. Shared fixtures under `examples/shared/e2e/` handle:

- Supabase test user bootstrap (sign-up + confirm email via Supabase admin API) — needed for `spa-checkout`.
- Stripe 4242 card fill helper — wraps the PaymentElement iframe boundary so each spec stays ~10 lines.
- Env wiring so every example hits the same sandbox product.

Each spec: `/` -> `/checkout` -> pick plan -> 4242 -> wait for `onResult('paid')` -> assert URL or visible dashboard content.

### Phase 3 — Gate, topup, cancel

One spec per flow per example where the flow is demonstrated:

- `<PurchaseGate>` (all examples that show a gated route): blocked -> checkout -> allowed.
- `<TopupForm>` + `<AmountPicker>` (checkout-demo): pick amount -> pay 4242 -> balance increments.
- `CancelPlanButton` + `CancelledPlanNotice` (checkout-demo, shadcn-checkout): cancel -> banner appears -> re-activate.

## CI wiring

Single workflow file `example-smoke.yml`:

- Triggers: `on: pull_request` (Phase 1 only), `on: workflow_run: publish-preview` completed (all phases).
- Matrix: one job per example from the table above.
- Artifacts: Playwright screenshots + traces on failure.
- Branch protection: green `example-smoke.yml` required before any `publish-stable` workflow runs. (`publish-stable` does not exist yet — will be added alongside stable-cut planning.)

## Non-goals

- Full browser matrix. Chromium only until we see real cross-browser regressions.
- Mobile / touch coverage — defer to a dedicated mobile-checkout plan.
- Load testing — separate concern.
- `examples/supabase-edge` — backend-only, covered by the existing [Gap 4 deno-preview](.cursor/plans/sdk_gaps_for_lovable_skill_0be93609.plan.md) spike and its future CI job.

## Sequencing

Do not start this plan until:

1. The Lovable skill try-out (final todo of the go-live plan) has surfaced any obvious SDK drift and those patches are committed.
2. A decision has been made on merging both feature branches — this plan's CI job should run against `main`, not against each feature branch individually, to avoid wasting CI minutes on preview branches.
