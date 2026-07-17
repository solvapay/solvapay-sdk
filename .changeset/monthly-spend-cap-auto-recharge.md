---
'@solvapay/server': major
---

Replace the auto-recharge lifetime count cap (`maxRecharges` / `rechargeCount`) with an optional monthly spend cap (`maxMonthlySpendMajor` on input; `maxMonthlySpendMinor`, `monthlySpendMinor`, and `monthlySpendPeriod` on the stored config).

**Migration for integrators**

- Rename `AutoRechargeInput.maxRecharges` → `maxMonthlySpendMajor` (display-currency major units, same convention as `thresholdAmountMajor` / `topupAmountMajor`).
- Read `config.maxMonthlySpendMinor`, `config.monthlySpendMinor`, and `config.monthlySpendPeriod` instead of `maxRecharges` / `rechargeCount`.
- The cap resets each UTC calendar month; configs no longer flip to `completed` when the cap is hit — status stays `active` and charges resume next month.
- Legacy `maxRecharges` / `rechargeCount` fields are stripped on read; no backfill is required.
