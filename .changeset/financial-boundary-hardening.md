---
"@solvapay/core": patch
"@solvapay/react": patch
"@solvapay/server": patch
---

Financial boundary hardening: backend `display.*` blocks are the source of truth for credit and currency rendering.

- **`@solvapay/core`**: conversion-contract e2e extended to pin backend display formulas against the core reference.
- **`@solvapay/react`**: `TransportBalanceResult` and `BalanceStatus` accept optional `display` from the balance API; negative `adjustBalance` schedules a grace refetch; usage demo refetches after debit.
- **`@solvapay/server`**: `AutoRechargeConfig`, balance, and credit-debit types document backend-computed `display` blocks and `autoRecharge.triggered` as charge-initiated (not credits booked inline).
