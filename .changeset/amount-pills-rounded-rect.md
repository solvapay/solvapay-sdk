---
'@solvapay/react': patch
---

Soften amount-picker quick-pick chips from fully-rounded capsules (`border-radius: 999px`) to subtly rounded rectangles (`border-radius: 8px`) in both the SDK base stylesheet (`.solvapay-amount-picker-pill` / `[data-solvapay-amount-picker-option]`) and the MCP variant (`.solvapay-mcp-amount-option`). Keeps `<CheckoutSteps.AmountPicker>`, `<AmountPicker>`, the hosted topup page, and every `<Mcp*View>` topup/checkout surface visually consistent — the previous capsule shape read inconsistently between narrow MCP iframes (~520px) and wider web containers (~672px+).

Consumers who prefer the previous capsule shape can restore it with a single override:

```css
.solvapay-amount-picker-pill,
[data-solvapay-amount-picker-option],
.solvapay-mcp-amount-option {
  border-radius: 999px;
}
```

Quick-pick chips inside `.solvapay-amount-picker-pills` (the SDK's default amount-picker row used by `<AmountPicker>`, `<ActivationFlow.AmountPicker>`, and `<CheckoutSteps.AmountPicker>`) now stretch evenly across the row via `flex: 1; min-width: 0` instead of hugging their text content. Matches the dense, even-row look that hosted MCP surfaces already render via host CSS. The container's `flex-wrap: wrap` is preserved so chips wrap to a new line when the row is too narrow to fit them. Consumers who want the previous content-width behaviour can opt out with:

```css
.solvapay-amount-picker-pills > [data-solvapay-amount-picker-option],
.solvapay-amount-picker-pills > .solvapay-amount-picker-pill {
  flex: 0 0 auto;
}
```

The default amount-picker tree (`<AmountPicker>` shim and `<CheckoutSteps.AmountPicker>` `DefaultAmountTree`) now reserves vertical space for the credit-estimate line at all times instead of mounting it conditionally on first valid amount entry. Previously the form would jump downward by ~1 line the moment a user typed a custom amount or selected a quick-pick chip; the line is now always present, rendered with a non-breaking-space placeholder and `aria-hidden="true"` until an estimate is available. Behaviour is unchanged for hosts that pass `showCreditEstimate={false}` to the standalone `<AmountPicker>` shim — the line is omitted entirely there as before.
