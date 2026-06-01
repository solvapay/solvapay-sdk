---
name: amount-pills-rounded-rect
overview: "Change amount-picker pills in both the SDK base stylesheet and the MCP stylesheet from fully-rounded capsules (`border-radius: 999px`) to subtly rounded rectangles (`border-radius: 8px`), so chat-checkout-demo, mcp-checkout-app, and any merchant using the default styles all render with the same softer rectangular shape."
todos:
  - id: sdk_base_radius
    content: Update .solvapay-amount-picker-pill / [data-solvapay-amount-picker-option] border-radius from 999px to 8px in packages/react/src/styles.css
    status: pending
  - id: mcp_radius
    content: Update .solvapay-mcp-amount-option border-radius from 999px to 8px in packages/react/src/mcp/styles.css and refresh the comment header to say 'rounded-rectangle' instead of 'pill-shaped'
    status: pending
  - id: changeset
    content: Add .changeset/amount-pills-rounded-rect.md (patch @solvapay/react) describing the visual change and the override path for consumers who want capsules back
    status: pending
  - id: verify
    content: Run packages/react tests and visually spot-check both demos render the new shape consistently
    status: pending
isProject: false
---

# Amount pill shape: capsule → subtly rounded rect

## Why

The chat-checkout-demo amount picker ($10/$50/$100/$500) currently renders as fully-rounded pills (`border-radius: 999px`) which the user finds too round. The MCP variant (`solvapay-mcp-amount-option`) uses the same `999px` rule, so technically the two demos already match — but the chat-checkout-demo's wider `max-w-2xl` container makes the capsule shape read as more pronounced. The user wants both demos to look identical AND less round (~6-8px).

The SDK base style is also consumed by the hosted topup page and any merchant calling `<CheckoutSteps.AmountPicker>` / `<AmountPicker>` directly, so this is an SDK-wide visual update — not a breaking API change. Per the SDK rules, this needs a changeset.

## Files to change

### 1. SDK base stylesheet — [packages/react/src/styles.css](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/styles.css)

Line 740-753 — change the rule shared by `[data-solvapay-amount-picker-option]` and `.solvapay-amount-picker-pill`:

```739:743:packages/react/src/styles.css
[data-solvapay-amount-picker-option],
.solvapay-amount-picker-pill {
  background: var(--solvapay-surface);
  border: 1px solid var(--solvapay-border);
  border-radius: 999px;
```

Set `border-radius: 8px`. This propagates to:
- `<CheckoutSteps.AmountPicker>` (used by chat-checkout-demo via [InlineCheckout.tsx](/Users/tommy/projects/solvapay/solvapay-sdk/examples/chat-checkout-demo/components/InlineCheckout.tsx) line 115)
- The `<AmountPicker>` shim at [packages/react/src/components/AmountPicker.tsx](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/components/AmountPicker.tsx)
- The hosted topup page

### 2. MCP stylesheet — [packages/react/src/mcp/styles.css](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/mcp/styles.css)

Line 379-391 — change `.solvapay-mcp-amount-option`:

```379:382:packages/react/src/mcp/styles.css
.solvapay-mcp-amount-option {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border-secondary, #e2e8f0);
```

Set `border-radius: 8px`. Also update the comment block immediately above (lines 368-372) so it doesn't claim the chips are "Pill-shaped" any more — change the leading sentence to "Rounded-rectangle quick-amount chips. Mirrors the `.solvapay-amount-picker-pill` shape…".

This propagates to all `<Mcp*View>` checkout/topup surfaces via [AmountStep.tsx](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/mcp/views/checkout/steps/AmountStep.tsx) and [McpTopupView.tsx](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/mcp/views/McpTopupView.tsx).

### 3. Changeset — `.changeset/amount-pills-rounded-rect.md`

Patch-level for `@solvapay/react`, brief note explaining the visual change and that consumers wanting the old capsule shape can override `.solvapay-amount-picker-pill` / `.solvapay-mcp-amount-option` with `border-radius: 999px`.

## Out of scope

- The top-level scenario switcher in [chat-checkout-demo App.tsx](/Users/tommy/projects/solvapay/solvapay-sdk/examples/chat-checkout-demo/App.tsx) lines 297-317 (Upgrade to Subscription / Top Up Credits / Lifetime Access) — those are demo-specific UI not related to the SDK pills, and the user confirmed they only want the inner amount pills changed.
- Other `border-radius: 999px` uses in the MCP stylesheet (status badges line 787, tour replay button line 1002, avatar bubbles) — those are intentionally pill-shaped and not "amount pills".
- No code or test changes needed: the existing test at [McpCheckoutView.test.tsx:822](/Users/tommy/projects/solvapay/solvapay-sdk/packages/react/src/mcp/views/__tests__/McpCheckoutView.test.tsx) only asserts on the class name, not on computed style.

## Verification

After the edits:
1. Run `pnpm --filter @solvapay/react test` to confirm the existing class-based assertions still pass.
2. Visually verify in `examples/chat-checkout-demo` (Top Up Credits scenario → trigger 402 → "Add credits to continue") and `examples/mcp-checkout-app` (`/topup` flow) that the pills now render as subtly rounded rectangles and look the same in both surfaces.
