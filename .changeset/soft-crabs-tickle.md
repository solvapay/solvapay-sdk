---
'@solvapay/react': minor
---

`useLimits` now reports an unlimited allowance explicitly.

The backend signals "no finite cap on this meter" with `remaining: -1`. Consumers
treating that as a plain count rendered "0 left" (and an upgrade CTA) for
customers who actually had unlimited access, and `adjustRemaining` compounded it
by clamping the sentinel to a real `0` on the first gated action.

- `useLimits()` returns a new `unlimited: boolean | null` field. Branch on it
  instead of comparing `remaining` directly.
- `adjustRemaining` is now a no-op on an unlimited allowance, so the sentinel
  survives optimistic updates.
- New exported `isUnlimited(remaining)` helper for code that handles a raw
  `LimitResponse.remaining` outside the hook.

`remaining` still carries the raw `-1`, so the wire contract is unchanged.
