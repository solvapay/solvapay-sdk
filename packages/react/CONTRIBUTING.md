# Contributing to @solvapay/react

This package ships two tiers:

- **`@solvapay/react`** — default tree. Drop-in components (`CheckoutLayout`, `PaymentForm`, …) that render a golden-path UI. Internally, they are thin shims over the primitives.
- **`@solvapay/react/primitives`** — unstyled compound primitives. Consumers compose these to build fully custom UIs.

This file is the canonical contract for primitives until the cross-repo Mintlify docs land. Every primitive you add or edit MUST follow these rules.

## Primitive contract

### Compound API

Every primitive is a compound: a `Root` plus named subcomponents.

```tsx
<PlanSelector.Root>
  <PlanSelector.Heading />
  <PlanSelector.Grid>
    <PlanSelector.Card>
      <PlanSelector.CardName />
      <PlanSelector.CardPrice />
    </PlanSelector.Card>
  </PlanSelector.Grid>
</PlanSelector.Root>
```

- Export subcomponents as properties on the `Root` (`PlanSelector.Card`) **and** as named exports from `./primitives` for tree-shake-friendly use.
- No render-prop children. No `classNames` prop. No `unstyled` flag.

### `asChild`

Every leaf subcomponent accepts `asChild?: boolean`. When `true`, it renders its single child via `<Slot>` and merges props/ref onto the child.

```tsx
<PlanSelector.Card asChild>
  <Card>{/* shadcn/ui card */}</Card>
</PlanSelector.Card>
```

Use `Slot` from `./primitives/slot`. Refs are merged via `composeRefs`; event handlers are chained via `composeEventHandlers` (consumer runs first; `preventDefault()` skips the primitive handler).

### `data-state` vocabulary

Every stateful subcomponent emits a `data-state` attribute from a fixed, documented vocabulary. States are driven by context (`PlanSelectionContext`, `PaymentFormContext`), never by subcomponent-local state.

| Primitive | `data-state` values |
| --- | --- |
| `PlanSelector.Card` | `idle` \| `selected` \| `current` \| `disabled` |
| `PaymentForm.SubmitButton` | `idle` \| `processing` \| `disabled` |
| `ActivationFlow.Root` | `summary` \| `activating` \| `selectAmount` \| `topupPayment` \| `retrying` \| `activated` \| `error` |
| `CreditGate.Root` | `allowed` \| `blocked` \| `loading` |
| `PurchaseGate.Root` | `allowed` \| `blocked` \| `loading` |
| `CancelledPlanNotice.Root` | `active` \| `expired` |
| `CancelPlanButton` | `idle` \| `cancelling` |
| `BalanceBadge` | `loading` \| `zero` \| `low` \| `ok` |
| `AmountPicker.Option` | `idle` \| `selected` \| `disabled` |

Secondary flags use `data-<flag>` (e.g. `data-free`, `data-popular`, `data-has-reason`).

### Opaque selectors

Every primitive root emits `data-solvapay-<primitive>` (and subcomponents emit `data-solvapay-<primitive>-<part>` when they need to be targetable). Do not rely on internal class names; those are not a public API.

### `.Loading` and `.Error`

Every async primitive exposes `.Loading` and `.Error` subcomponents that render when the context reports loading/error. They render `null` otherwise. Always provide a fallback UI path — don't rely on consumers remembering to add them.

### Errors self-heal

Throw structured errors from `src/utils/errors.ts` for wiring mistakes:

- `MissingProviderError` — primitive rendered outside `<SolvaPayProvider>`.
- `MissingEnvVarError` — required env var not set.
- `MissingApiRouteError` — backend route not installed.
- `MissingProductRefError` — primitive needs `productRef` and none was provided.

Each error includes `code`, `message` (fix + docs URL), and `docsUrl`.

## Prohibited patterns

When touching a primitive, these must stay gone:

- `classNames` prop, `unstyled` prop, `RenderArgs` / function-child overloads.
- Inline `style={{ ... }}` inside `src/primitives/**`.
- `next/*` imports (the package must bundle on Vite/Remix).
- `as any`, `as unknown as ...` except when unavoidable; justify with a comment.
- Implicit `enum`; use union types.

## TDD checklist per primitive

Write the primitive and its test file in the same commit. Every primitive test covers:

1. **Default render** — subcomponents render the expected DOM.
2. **`asChild` composition** — refs merge, handlers chain, `data-*` + `aria-*` forward to the child element.
3. **`data-state` transitions** — context-driven state flips the attribute correctly.
4. **`.Loading` / `.Error`** — rendered when context signals loading/error.
5. **Provider-missing + env-missing** — the correct structured error class is thrown with its docs URL.

Delete legacy tests that assert on `classNames` / function-child / `RenderArgs` **before** landing the rewrite.

## Adding a new primitive (checklist)

1. Write the test file following the TDD checklist above.
2. Create `src/primitives/<Name>.tsx` with `Root` + subcomponents + `asChild` + `data-state`.
3. Re-export from `src/primitives/index.ts`.
4. If the primitive is part of the default tree, update the shim in `src/components/<Name>.tsx` to render it with the golden-path children.
5. Update the `data-state` table in this file if you introduce a new state.
6. Keep the package-local README cheat sheet in sync.

## Commands

```bash
pnpm --filter @solvapay/react test        # run the primitive + component tests
pnpm --filter @solvapay/react build       # tsup build (top-level + primitives entry)
pnpm --filter @solvapay/react lint        # eslint
```
