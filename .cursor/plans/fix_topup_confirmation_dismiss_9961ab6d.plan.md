---
name: fix topup confirmation dismiss
overview: Topup `payment_required` gates carry a `balance.creditsPerUnit` block but `usePaywallResolver` ignores it for that kind, so the post-topup success card never auto-dismisses. Fix the resolver to treat balance-carrying `payment_required` gates like `activation_required` ones.
todos:
  - id: resolver
    content: Extend `usePaywallResolver` so `payment_required` gates also resolve on wallet replenishment when `content.balance` is present
    status: in_progress
  - id: tests
    content: Add resolver tests for the new `payment_required` + balance branches and a regression test for the no-balance fallback
    status: pending
  - id: changeset
    content: Add `@solvapay/react` patch changeset describing the resolver fix
    status: pending
  - id: verify
    content: Run `pnpm --filter @solvapay/react test` and smoke-test the topup scenario in `examples/chat-checkout-demo` to confirm the success card auto-dismisses
    status: pending
isProject: false
---

# Fix topup credits confirmation dismiss

## Root cause

After a customer activates a usage-based plan once, subsequent topup 402s come back as `kind: 'payment_required'` (because `limits.activationRequired === false`), with a `balance: { creditBalance, creditsPerUnit, … }` block attached.

`usePaywallResolver` only checks `hasPaidPurchase` for that kind:

```30:35:packages/react/src/hooks/usePaywallResolver.ts
    if (content.kind === 'payment_required') {
      return Boolean(hasPaidPurchase && productMatches)
    }
```

A topup creates a balance transaction, **not** a paid plan purchase, so `hasPaidPurchase` never flips → `<PaywallNotice.Root onResolved>` never fires → demo's `handleFormSuccess` never runs → the `<CheckoutSteps.Success>` card stays static.

The activation_required branch already handles wallet replenishment:

```47:60:packages/react/src/hooks/usePaywallResolver.ts
    const balance = content.balance
    if (balance && typeof balance.remainingUnits === 'number' && balance.remainingUnits > 0) {
      return true
    }
    if (balance && credits != null && balance.creditsPerUnit && credits >= balance.creditsPerUnit) {
      return true
    }
```

`payment_required` needs the same treatment when it carries a balance block.

## Fix (SDK)

In `[packages/react/src/hooks/usePaywallResolver.ts](packages/react/src/hooks/usePaywallResolver.ts)`, extend the `payment_required` branch to also resolve on wallet replenishment:

```ts
if (content.kind === 'payment_required') {
  if (hasPaidPurchase && productMatches) return true
  // Topup-shaped payment_required gate: customer has an active
  // usage-based plan but ran out of credits. Resolves the same way
  // as activation_required when a balance block is attached.
  const balance = content.balance
  if (balance?.remainingUnits != null && balance.remainingUnits > 0) return true
  if (balance && credits != null && balance.creditsPerUnit && credits >= balance.creditsPerUnit) {
    return true
  }
  return false
}
```

Then refactor the duplicated balance check into a small helper used by both branches to keep the logic in one place.

## Tests

Update `[packages/react/src/hooks/__tests__/usePaywallResolver.test.tsx](packages/react/src/hooks/__tests__/usePaywallResolver.test.tsx)`:

- New: `payment_required` + `balance.remainingUnits > 0` → resolves
- New: `payment_required` + `credits >= balance.creditsPerUnit` → resolves
- New: `payment_required` + balance present but `credits < creditsPerUnit` and no paid purchase → does NOT resolve (regression guard)
- Existing tests stay green (back-compat for non-topup `payment_required`).

## Why nothing else changes

- The demo (`InlineCheckout.tsx`, `App.tsx`) already wires `handleFormSuccess` correctly via `<PaywallNotice.Root onResolved={onSuccess}>`. With the resolver fixed, the existing optimistic `adjustBalance(creditsAdded)` in `useCheckoutFlow.recordPaygSuccess` makes the resolver flip on the same render the success card paints — giving the natural "flash for ~1s, then dismiss" UX the user remembers.
- No changes to `<CheckoutSteps.Success>` — the success card is correct as a brief success surface; it just shouldn't get stuck.
- No backend/gate-shape changes needed.

## Changeset

Add `[.changeset/topup-payment-required-resolver.md](.changeset/topup-payment-required-resolver.md)`:

```md
---
'@solvapay/react': patch
---

Fix `usePaywallResolver` so `payment_required` gates carrying a `balance.creditsPerUnit` block resolve once the customer's wallet covers the next unit. This makes topup-shaped 402s (where the customer already has an active usage-based plan) dismiss automatically after a successful topup, instead of leaving consumers stuck on a static success surface.
```
