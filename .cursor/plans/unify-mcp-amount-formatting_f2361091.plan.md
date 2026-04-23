---
name: unify-mcp-amount-formatting
overview: Route every MCP widget through one `formatPrice` helper and make it render whole amounts without trailing zeros (`SEK 100`, not `SEK100` or `SEK 100.00`) while keeping two decimals for fractional amounts (`SEK 100.50`).
todos:
  - id: extend-format-price
    content: Change `formatPrice` default to trim trailing zeros on whole major units + update tests
    status: pending
  - id: fix-amount-picker-primitive
    content: Replace manual symbol+amount concat in `AmountPicker.Option` with `formatPrice`
    status: pending
  - id: fix-checkout-aria-label
    content: Route `McpCheckoutView` PresetAmountRow aria-label through `formatPrice`
    status: pending
  - id: remove-topup-duplicate
    content: Delete local `formatCurrency` in `McpTopupView` and switch all call sites to `formatPrice`
    status: pending
  - id: fix-upgrade-pill
    content: Route `McpAppShell.formatUpgradeLabel` through `formatPrice`
    status: pending
  - id: fix-detail-card-approx
    content: Route `detail-cards` balance approx-value through `formatPrice`
    status: pending
  - id: fix-selector-errors
    content: Swap `${currencySymbol}${amount}` error strings in `useTopupAmountSelector` for `formatPrice`
    status: pending
  - id: update-tests
    content: Update AmountPicker + McpCheckoutView tests for new format output
    status: pending
isProject: false
---

## Decisions (locked)

- **Single source of truth**: the canonical [`formatPrice`](packages/react/src/utils/format.ts) helper. Every MCP widget goes through it — no local duplicates, no inline `Intl.NumberFormat`, no `${symbol}${amount}` concatenation.
- **Currency display**: stay on `Intl.NumberFormat`'s default `currencyDisplay: 'symbol'`. That gives `$`, `€`, `£`, `¥` when unambiguous; `SEK` (ISO code) in English locales where `kr` would collide with NOK/DKK/ISK; `kr` for Swedish users actually in `sv-SE`. No override.
- **Trailing zeros**: trimmed by default when the amount is a whole major unit. `SEK 100`, `SEK 1,000`, `$99/mo`. Fractional amounts keep exactly two decimals: `SEK 100.50`, `$9.99`. Zero-decimal currencies (JPY, KRW, …) unchanged.
- **Spacing**: comes for free from Intl (`SEK 100`, not `SEK100`). No CSS or hand-inserted space.
- **Scope**: MCP widgets only. Hosted checkout example pages are deferred to a follow-up; they can duplicate the format then.
- **Non-MCP ripple**: because the change is to `formatPrice`'s default (not a new flag), non-MCP React surfaces that already call `formatPrice` (`PaymentForm`, `CheckoutSummary`, `PlanSelector`, `ProductBadge`, `UsageMeter`) also switch from `$10.00` → `$10` on whole prices. That's the desired unified behavior.

## Goal

One formatter, one output style, across chips, totals, success copy, aria-labels, upgrade pills, balance approx-value, and topup-selector error messages.

## 1. Change the canonical helper's default

File: [`packages/react/src/utils/format.ts`](packages/react/src/utils/format.ts)

Make trailing-zero trimming the **default behavior** (no new flag needed): when `amountMinor` is a whole major unit, render 0 fraction digits; otherwise render the currency's natural fraction count (2 for USD/EUR/SEK/…, 0 for JPY/KRW/… already handled by the `ZERO_DECIMAL_CURRENCIES` set).

```ts
const minorPerMajor = getMinorUnitsPerMajor(currency)
const naturalFractionDigits = getFractionDigits(currency)
const isWhole = amountMinor % minorPerMajor === 0
const fractionDigits = isWhole ? 0 : naturalFractionDigits
```

No `currencyDisplay` override — stay on the `'symbol'` default so Intl picks the most user-friendly form per locale+currency pair.

Update tests in [`packages/react/src/utils/format.test.ts`](packages/react/src/utils/format.test.ts):
- `formatPrice(10000, 'sek', { locale: 'en' })` → `SEK 100` *(was `SEK 100.00`)*
- `formatPrice(10050, 'sek', { locale: 'en' })` → `SEK 100.50`
- `formatPrice(1999, 'usd')` → `$19.99` *(unchanged — fractional)*
- `formatPrice(500, 'gbp', { locale: 'en-GB' })` → `£5` *(was `£5.00`)*
- `formatPrice(10000, 'sek', { locale: 'sv-SE' })` → `100 kr` *(was `100,00 kr`)*
- `formatPrice(1000, 'jpy')` → `¥1,000` *(unchanged — zero-decimal currency)*

## 2. AmountPicker primitive — the `SEK100` bug

File: [`packages/react/src/primitives/AmountPicker.tsx`](packages/react/src/primitives/AmountPicker.tsx)

- Replace the default children in `Option` (lines 189–194 and 200–205) with a single `formatPrice(amount * getMinorUnitsPerMajor(currency), currency, { free: '' })` call. Whole-major presets (100, 500, 1000, 5000) render as `SEK 100`, `SEK 1,000`, etc. — trailing zeros are now trimmed by default. `free: ''` keeps `0` rendering as `SEK 0`.
- Leave `locale` undefined so the primitive picks up the browser default — this keeps the shared primitive agnostic of MCP vs. hosted contexts. MCP consumers needing host locale can override via `asChild`.
- Retire the homegrown `getCurrencySymbol(currency)` + `currencySymbol` field in [`useTopupAmountSelector.ts`](packages/react/src/hooks/useTopupAmountSelector.ts) once all internal consumers are gone (see step 7). Keep the `currencySymbol` public field for back-compat, but re-derive it via Intl inside the hook so the test suite still passes.
- `components/AmountPicker.tsx` line 69 keeps rendering `ctx.currencySymbol` next to the custom input — unchanged, since we're keeping the field exposed.

## 3. McpCheckoutView presets aria-label

File: [`packages/react/src/mcp/views/McpCheckoutView.tsx`](packages/react/src/mcp/views/McpCheckoutView.tsx)

Line 775: swap the manual concatenation for `formatPrice(amount * getMinorUnitsPerMajor(currency), currency, { locale, free: '' })`. Pull `currency` from the picker context (already available).

## 4. McpTopupView — delete the duplicate

File: [`packages/react/src/mcp/views/McpTopupView.tsx`](packages/react/src/mcp/views/McpTopupView.tsx)

- Delete local `formatCurrency` (lines 46–51).
- Replace all four call sites (127, 155, 173, 220) with `formatPrice(amountMinor, currency, { locale, free: '' })`. Call sites already have the minor-unit value on hand (`justPaidMinor`, `committedAmountMinor`, `amountMinor`), so drop the `toMajorUnits` wrapping — `formatPrice` handles the conversion internally.
- `free: ''` stays so a 0 topup still shows the numeric form instead of `Free` (unreachable in practice but keeps semantics correct for the committed-amount branch).

## 5. McpAppShell upgrade pill

File: [`packages/react/src/mcp/McpAppShell.tsx`](packages/react/src/mcp/McpAppShell.tsx)

`formatUpgradeLabel` (lines 509–521): replace the inline `Intl.NumberFormat` with `formatPrice(plan.price, plan.currency, { locale })`. Trailing zeros trim automatically on whole-major plan prices (e.g. `$99/mo`, `SEK 99/mo`; `$9.99/mo` if the plan has fractional cents). Keep the `/${plan.billingCycle.slice(0,2)}` suffix (`/mo`, `/ye`) — this pill intentionally uses a different cycle shorthand than `formatPrice`'s `/ month` interval rendering, so don't route through the `interval` option.

## 6. detail-cards balance approx-value

File: [`packages/react/src/mcp/views/detail-cards.tsx`](packages/react/src/mcp/views/detail-cards.tsx)

Lines 138–142: render `~{formatPrice(Math.round(approxValue * getMinorUnitsPerMajor(displayCurrency)), displayCurrency, { locale, free: '' })}`. Restores consistent spacing (`~SEK 0` when balance is zero, `~SEK 1.50` with fractional cents, `~SEK 10` otherwise).

## 7. Topup selector error messages

File: [`packages/react/src/hooks/useTopupAmountSelector.ts`](packages/react/src/hooks/useTopupAmountSelector.ts)

Lines 105 and 113 interpolate `${currencySymbol}${minAmount}` / `${currencySymbol}${maxAmount.toLocaleString()}`. Swap for `formatPrice(minAmount * getMinorUnitsPerMajor(currency), currency, { free: '' })`. This removes the last internal user of the homegrown `getCurrencySymbol` helper — keep `currencySymbol` on the returned type for back-compat, re-derived via Intl (`formatPrice(0, currency, { free: '' }).replace(/[\d\s.,]/g, '')` or equivalent), to avoid a public-API break in v0.x.

## 8. Tests to update

- [`packages/react/src/utils/format.test.ts`](packages/react/src/utils/format.test.ts): the `'$5.00'` / `'$25.00 / 3 months'` / `'$99.00 / year'` expectations need adjusting — the zero-trimming default collapses `$5.00 → $5`, `$99.00 → $99`, `$25.00 → $25`. `$19.99` and `$9.99 / month` are unaffected (fractional). Also flip the `sek` locale expectation to `100 kr` without decimals.
- [`packages/react/src/components/AmountPicker.test.tsx`](packages/react/src/components/AmountPicker.test.tsx) line 87 asserts `currencySymbol` — still passes if we re-derive via Intl.
- [`packages/react/src/hooks/useTopupAmountSelector.test.ts`](packages/react/src/hooks/useTopupAmountSelector.test.ts) lines 61, 66, 330, 333 assert `currencySymbol` values — still pass.
- [`packages/react/src/mcp/views/__tests__/McpCheckoutView.test.tsx`](packages/react/src/mcp/views/__tests__/McpCheckoutView.test.tsx) — re-run to catch aria-label assertions and any `$N.00` text assertions (need to drop the `.00` on whole-major plan prices).
- Grep for hardcoded `.00` test expectations across `packages/react/src` and relax to the new output. Most likely hits: `PaymentForm.test.tsx`, `CheckoutSummary`-related tests, `ProductBadge.test.tsx`.

## 9. Non-goals

- No hosted-checkout example page changes — deferred.
- No i18n copy changes; only numeric formatting.
- No visual/CSS changes — the spacing fix comes from Intl.
- No `currencyDisplay` override — Intl's default is what we want.
- No caller opt-outs for the new trimming default — it's globally desired.

## Outcome

Before → after, same user locale, currency `SEK`:

- Preset chip: `SEK100` → `SEK 100`
- Preset chip (1k): `SEK1,000` → `SEK 1,000`
- Fractional custom amount: (bug — no formatter) → `SEK 100.50`
- Continue CTA: `Continue — SEK 100.00` → `Continue — SEK 100`
- Balance approx: `~SEK 0.00` → `~SEK 0`
- Upgrade pill: `Upgrade to Pro — SEK 99/mo` (unchanged style, now trimmed)
- Validation error: `Amount must be at least SEK1` → `Amount must be at least SEK 1`

A Swedish user in `sv-SE` sees the same amounts as `100 kr`, `1 000 kr`, `100,50 kr`. A USD user sees `$100`, `$1,000`, `$9.99`. JPY/KRW unchanged.
