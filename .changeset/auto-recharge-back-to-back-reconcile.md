---
'@solvapay/react': patch
---

Fix balance reconciliation stopping after the first auto-recharge when multiple usage debits trigger back-to-back.

- **`balance.reconcileAfterUsageDebit`**: tracks a pending recharge count so each expected top-up is polled and applied before reconciliation finishes, instead of clearing after the first observed increase.
