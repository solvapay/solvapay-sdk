---
'@solvapay/react': patch
---

Make the committed amount the visual hero of the MCP topup
pay-with-card step. The amount the customer is about to charge is
the most useful thing on the screen at that moment, so it sits
above the form in tabular numerals; the existing balance and the
credits-added preview drop to a single muted context line beneath
it. The `<BalanceBadge>` keeps its prominent slot on the
AmountPicker step and the success step, where balance is the
right hero. The submit button also gains an explicit `Top up
{amount}` label so the action mirrors the hero.

- New `topupAmountHero` and `topupBalanceContext` className slots
  on `McpViewClassNames` (default classes
  `solvapay-mcp-topup-amount-hero` / `solvapay-mcp-topup-balance-context`).
